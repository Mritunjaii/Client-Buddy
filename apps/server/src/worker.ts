import { Db } from 'mongodb';
import { BatchManager } from './batching.js';
import { OllamaAnalyzer } from './ai.js';
import {
  ContactPreference,
  ReminderRecord,
  SummaryRecord,
  UrgencyLevel,
} from '@clientpulse/shared';
import crypto from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { callAlertService } from './callAlert.js';

export class BatchWorker {
  private isRunning: boolean = false;
  private timerHandle: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private batchManager: BatchManager,
    private analyzer: OllamaAnalyzer,
    private io?: SocketIOServer,
    private pollIntervalMs: number = 2000,
    private workerId: string = `worker_${crypto.randomUUID().slice(0, 8)}`
  ) {}

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private async loop() {
    if (!this.isRunning) return;

    try {
      await this.processNextBatch();
    } catch (err) {
      console.error('[Worker Error]:', err);
    }

    if (this.isRunning) {
      this.timerHandle = setTimeout(() => this.loop(), this.pollIntervalMs);
    }
  }

  /**
   * Attempts to claim one due batch and process it.
   */
  async processNextBatch(): Promise<boolean> {
    const batch = await this.batchManager.claimDueBatch(this.workerId);
    if (!batch) return false;

    try {
      // 1. Fetch contact preference context if available
      const contact = await this.db
        .collection<ContactPreference>('contacts')
        .findOne({ chatId: batch.chatId });

      // 2. Run analysis
      const analysis = await this.analyzer.analyze(batch.messages, {
        clientName: batch.contactName || contact?.displayName,
        projectScope: contact?.projectScope,
        preferredTone: contact?.preferredTone,
      });

      // 3. Persist summary record
      const summaryId = `sum_${crypto.randomUUID()}`;
      const now = new Date();
      const summaryRecord: SummaryRecord = {
        summaryId,
        accountId: batch.accountId,
        chatId: batch.chatId,
        contactName: batch.contactName || contact?.displayName,
        batchId: batch.batchId,
        windowStart: batch.messages[0]?.timestamp || now,
        windowEnd: batch.messages[batch.messages.length - 1]?.timestamp || now,
        summary: analysis.summary,
        urgency: analysis.urgency,
        urgencyReason: analysis.urgencyReason,
        confidence: analysis.confidence,
        requirements: analysis.requirements,
        deadlines: analysis.deadlines,
        openQuestions: analysis.openQuestions,
        actionItems: analysis.actionItems,
        suggestedReply: analysis.suggestedReply,
        sourceMessageRefs: batch.messages.map((m) => m.messageId),
        createdAt: now,
        sourceExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7-day retention
      };

      await this.db.collection<SummaryRecord>('summaries').insertOne(summaryRecord);

      // 4. Persist extracted reminders
      const reminderDocs: ReminderRecord[] = analysis.reminders.map((r) => ({
        reminderId: `rem_${crypto.randomUUID()}`,
        accountId: batch.accountId,
        chatId: batch.chatId,
        contactName: batch.contactName || contact?.displayName,
        summaryId,
        batchId: batch.batchId,
        title: r.title,
        description: r.description,
        dateText: r.dateText,
        dueAt: r.dueAt,
        timezone: 'UTC',
        confidence: r.confidence,
        status: r.dueAt ? 'upcoming' : 'needs_confirmation',
        sourceMessageRefs: r.sourceMessageRefs.length > 0 ? r.sourceMessageRefs : batch.messages.map((m) => m.messageId),
        createdAt: now,
      }));

      if (reminderDocs.length > 0) {
        await this.db.collection<ReminderRecord>('reminders').insertMany(reminderDocs);
      }

      // 5. Mark batch processed
      await this.batchManager.markBatchProcessed(batch.batchId);

      // 6. Push real-time Socket.IO events if active
      if (this.io) {
        this.io.emit('summary:new', summaryRecord);
        if (summaryRecord.urgency === 'CRITICAL') {
          // Trigger Outbound ElevenLabs Call Alert
          callAlertService.executeCriticalCallAlert({
            summaryId,
            chatId: batch.chatId,
            contactName: batch.contactName || 'Client',
            urgency: 'CRITICAL',
            reason: summaryRecord.urgencyReason,
            time: now,
            summaryText: summaryRecord.summary,
          }).then((callRes) => {
            if (this.io) {
              this.io.emit('alert:call', {
                summaryId,
                chatId: batch.chatId,
                contactName: batch.contactName || 'Client',
                urgency: 'CRITICAL',
                reason: summaryRecord.urgencyReason,
                time: now,
                callResult: callRes,
              });
            }
          }).catch((err) => {
            console.error('[Call Alert Error]:', err);
          });

          this.io.emit('alert:urgent', {
            summaryId,
            chatId: batch.chatId,
            contactName: batch.contactName,
            urgency: summaryRecord.urgency,
            reason: summaryRecord.urgencyReason,
            time: now,
          });
        }
        for (const rem of reminderDocs) {
          this.io.emit('reminder:new', rem);
        }
      }

      return true;
    } catch (err: any) {
      await this.batchManager.markBatchFailed(batch.batchId, err.message || 'Worker processing error');
      return false;
    }
  }
}
