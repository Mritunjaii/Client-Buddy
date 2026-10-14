import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { BatchManager } from '../src/batching.js';
import { initIndexes } from '../src/db.js';
import { NormalizedMessage } from '@clientpulse/shared';

describe('BatchManager Sliding Window & Atomic Claim', () => {
  let client: MongoClient;
  let db: Db;
  let batchManager: BatchManager;
  const testDbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/clientpulse_test';

  beforeAll(async () => {
    client = new MongoClient(testDbUri);
    await client.connect();
    db = client.db('clientpulse_test');
    await initIndexes(db);
    batchManager = new BatchManager(db, {
      quietWindowMs: 1000, // 1 second for fast testing
      maxBatchAgeMs: 3000,  // 3 seconds max age
      sourceRetentionMs: 60000,
    });
  });

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    await db.collection('pendingBatches').deleteMany({});
    await db.collection('sourceMessages').deleteMany({});
  });

  it('creates a new pending batch on first message and extends deadline on second message', async () => {
    const msg1: NormalizedMessage = {
      messageId: 'msg_1',
      chatId: 'chat_123',
      senderId: 'client_a',
      timestamp: new Date(),
      text: 'Hey, I need a landing page.',
      type: 'text',
      isGroupMessage: false,
      isOutgoing: false,
      hasMedia: false,
    };

    const res1 = await batchManager.ingestMessage('user_1', msg1, 'Alice');
    expect(res1.isNewBatch).toBe(true);

    const batchAfterFirst = await db.collection('pendingBatches').findOne({ batchId: res1.batchId });
    expect(batchAfterFirst).not.toBeNull();
    expect(batchAfterFirst?.messages.length).toBe(1);
    expect(batchAfterFirst?.status).toBe('pending');

    const firstFlushAt = batchAfterFirst!.flushAt.getTime();

    // Sleep 200ms
    await new Promise((r) => setTimeout(r, 200));

    // Message 2 from same chat
    const msg2: NormalizedMessage = {
      messageId: 'msg_2',
      chatId: 'chat_123',
      senderId: 'client_a',
      timestamp: new Date(),
      text: 'Needs to be mobile responsive too.',
      type: 'text',
      isGroupMessage: false,
      isOutgoing: false,
      hasMedia: false,
    };

    const res2 = await batchManager.ingestMessage('user_1', msg2);
    expect(res2.isNewBatch).toBe(false);
    expect(res2.batchId).toBe(res1.batchId);

    const batchAfterSecond = await db.collection('pendingBatches').findOne({ batchId: res1.batchId });
    expect(batchAfterSecond?.messages.length).toBe(2);
    // flushAt should have moved forward!
    expect(batchAfterSecond!.flushAt.getTime()).toBeGreaterThan(firstFlushAt);
  });

  it('caps the sliding flushAt at maxFlushAt to prevent infinite delay', async () => {
    const msg1: NormalizedMessage = {
      messageId: 'msg_1',
      chatId: 'chat_starve',
      senderId: 'client_a',
      timestamp: new Date(),
      text: 'Starting message',
      type: 'text',
      isGroupMessage: false,
      isOutgoing: false,
      hasMedia: false,
    };

    const res1 = await batchManager.ingestMessage('user_1', msg1);
    const batch = await db.collection('pendingBatches').findOne({ batchId: res1.batchId });
    const maxFlushAt = batch!.maxFlushAt.getTime();

    // Fast-forward or append multiple times
    for (let i = 2; i <= 5; i++) {
      await batchManager.ingestMessage('user_1', {
        ...msg1,
        messageId: `msg_${i}`,
        text: `Message ${i}`,
      });
    }

    const updatedBatch = await db.collection('pendingBatches').findOne({ batchId: res1.batchId });
    // flushAt must never exceed maxFlushAt
    expect(updatedBatch!.flushAt.getTime()).toBeLessThanOrEqual(maxFlushAt);
  });

  it('atomically claims a due batch without race conditions', async () => {
    const msg: NormalizedMessage = {
      messageId: 'msg_due',
      chatId: 'chat_due',
      senderId: 'client_a',
      timestamp: new Date(),
      text: 'Urgent task please check',
      type: 'text',
      isGroupMessage: false,
      isOutgoing: false,
      hasMedia: false,
    };

    const { batchId } = await batchManager.ingestMessage('user_1', msg);

    // Not yet due
    const claimTooEarly = await batchManager.claimDueBatch('worker_1');
    expect(claimTooEarly).toBeNull();

    // Wait for quiet window (1.1s)
    await new Promise((r) => setTimeout(r, 1100));

    // Two workers attempt to claim concurrently
    const [workerAClaim, workerBClaim] = await Promise.all([
      batchManager.claimDueBatch('worker_A'),
      batchManager.claimDueBatch('worker_B'),
    ]);

    // Exactly one worker must succeed!
    const claims = [workerAClaim, workerBClaim].filter(Boolean);
    expect(claims.length).toBe(1);
    expect(claims[0]?.batchId).toBe(batchId);
    expect(claims[0]?.status).toBe('processing');

    // A message arriving now must create a separate pending batch
    const msgWhileProcessing: NormalizedMessage = {
      messageId: 'msg_late',
      chatId: 'chat_due',
      senderId: 'client_a',
      timestamp: new Date(),
      text: 'Also one more detail',
      type: 'text',
      isGroupMessage: false,
      isOutgoing: false,
      hasMedia: false,
    };

    const resLate = await batchManager.ingestMessage('user_1', msgWhileProcessing);
    expect(resLate.isNewBatch).toBe(true);
    expect(resLate.batchId).not.toBe(batchId);
  });
});
