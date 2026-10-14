import { Db } from 'mongodb';
import { NormalizedMessage, PendingBatch, SourceMessageRecord } from '@clientpulse/shared';
import crypto from 'node:crypto';

export interface BatchingConfig {
  quietWindowMs: number; // default: 120,000 (2 minutes)
  maxBatchAgeMs: number; // default: 600,000 (10 minutes)
  sourceRetentionMs: number; // default: 7 days (604,800,000 ms)
}

export const DEFAULT_BATCHING_CONFIG: BatchingConfig = {
  quietWindowMs: 120 * 1000,
  maxBatchAgeMs: 10 * 60 * 1000,
  sourceRetentionMs: 7 * 24 * 60 * 60 * 1000,
};

export class BatchManager {
  constructor(
    private db: Db,
    private config: BatchingConfig = DEFAULT_BATCHING_CONFIG
  ) {}

  /**
   * Ingest an incoming normalized message.
   * If a batch is currently 'pending', appends and resets flushAt (up to maxFlushAt).
   * If no 'pending' batch exists (or the previous is 'processing'), creates a new batch.
   */
  async ingestMessage(
    accountId: string,
    message: NormalizedMessage,
    contactName?: string
  ): Promise<{ batchId: string; isNewBatch: boolean }> {
    const now = new Date();
    const newFlushAt = new Date(now.getTime() + this.config.quietWindowMs);
    const newMaxFlushAt = new Date(now.getTime() + this.config.maxBatchAgeMs);

    // 1. Save message to sourceMessages for raw inspection with 7-day TTL
    const sourceExpiresAt = new Date(now.getTime() + this.config.sourceRetentionMs);
    await this.db.collection<SourceMessageRecord>('sourceMessages').updateOne(
      { accountId, chatId: message.chatId, messageId: message.messageId },
      {
        $setOnInsert: {
          accountId,
          chatId: message.chatId,
          messageId: message.messageId,
          senderId: message.senderId,
          senderName: message.senderName,
          timestamp: message.timestamp,
          text: message.text,
          expiresAt: sourceExpiresAt,
        },
      },
      { upsert: true }
    );

    // 2. Find existing pending batch
    const pendingBatches = this.db.collection<PendingBatch>('pendingBatches');

    // Attempt to atomically append to an existing pending batch
    const updateResult = await pendingBatches.findOneAndUpdate(
      {
        accountId,
        chatId: message.chatId,
        status: 'pending',
      },
      [
        {
          $set: {
            // Push message only if not already in array
            messages: {
              $cond: {
                if: { $in: [message.messageId, '$messages.messageId'] },
                then: '$messages',
                else: { $concatArrays: ['$messages', [message]] },
              },
            },
            // Reset flushAt, but cap it at maxFlushAt
            flushAt: {
              $cond: {
                if: { $gt: [newFlushAt, '$maxFlushAt'] },
                then: '$maxFlushAt',
                else: newFlushAt,
              },
            },
            batchVersion: { $add: ['$batchVersion', 1] },
            contactName: contactName || '$contactName',
            updatedAt: now,
          },
        },
      ],
      { returnDocument: 'after' }
    );

    if (updateResult) {
      return { batchId: updateResult.batchId, isNewBatch: false };
    }

    // 3. If no pending batch existed, create a new one
    const newBatchId = `batch_${crypto.randomUUID()}`;
    const newBatch: PendingBatch = {
      batchId: newBatchId,
      accountId,
      chatId: message.chatId,
      contactName,
      messages: [message],
      flushAt: newFlushAt,
      maxFlushAt: newMaxFlushAt,
      status: 'pending',
      batchVersion: 1,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // Cleanup abandoned pending batches after 24h
    };

    try {
      await pendingBatches.insertOne(newBatch);
      return { batchId: newBatchId, isNewBatch: true };
    } catch (err: any) {
      // Handle potential race where another message inserted at the same millisecond
      if (err.code === 11000) {
        return this.ingestMessage(accountId, message, contactName);
      }
      throw err;
    }
  }

  /**
   * Atomically claim a due batch for processing with lease lock.
   */
  async claimDueBatch(
    workerId: string,
    leaseDurationMs: number = 60000
  ): Promise<PendingBatch | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseDurationMs);
    const pendingBatches = this.db.collection<PendingBatch>('pendingBatches');

    // Due condition:
    // 1. Status is 'pending' AND (flushAt <= now OR maxFlushAt <= now)
    // OR 2. Status is 'processing' AND lease has expired (worker crashed)
    const claimed = await pendingBatches.findOneAndUpdate(
      {
        $or: [
          {
            status: 'pending',
            $or: [{ flushAt: { $lte: now } }, { maxFlushAt: { $lte: now } }],
          },
          {
            status: 'processing',
            leaseUntil: { $lte: now },
            attemptCount: { $lt: 5 }, // Bounded retries
          },
        ],
      },
      {
        $set: {
          status: 'processing',
          leaseOwner: workerId,
          leaseUntil: leaseUntil,
          updatedAt: now,
        },
        $inc: { attemptCount: 1 },
      },
      {
        sort: { flushAt: 1 },
        returnDocument: 'after',
      }
    );

    return claimed;
  }

  /**
   * Mark a batch as processed and clear its active pending record.
   */
  async markBatchProcessed(batchId: string): Promise<void> {
    const pendingBatches = this.db.collection<PendingBatch>('pendingBatches');
    await pendingBatches.updateOne(
      { batchId },
      {
        $set: {
          status: 'processed',
          updatedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
        },
      }
    );
  }

  /**
   * Mark a batch as failed (can be retried if attemptCount < limit).
   */
  async markBatchFailed(batchId: string, errorMessage: string): Promise<void> {
    const pendingBatches = this.db.collection<PendingBatch>('pendingBatches');
    await pendingBatches.updateOne(
      { batchId },
      {
        $set: {
          status: 'failed',
          lastError: errorMessage,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: new Date(),
        },
      }
    );
  }
}
