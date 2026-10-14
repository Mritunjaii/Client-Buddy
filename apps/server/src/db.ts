import { Db, MongoClient } from 'mongodb';
import {
  PendingBatch,
  SourceMessageRecord,
  SummaryRecord,
  ReminderRecord,
  ContactPreference,
  UserAccount,
} from '@clientpulse/shared';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(uri: string, dbName: string = 'clientpulse'): Promise<Db> {
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  await initIndexes(db);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectMongo first.');
  }
  return db;
}

export async function initIndexes(database: Db): Promise<void> {
  const users = database.collection<UserAccount>('users');
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ userId: 1 }, { unique: true });

  const pendingBatches = database.collection<PendingBatch>('pendingBatches');
  await pendingBatches.createIndex({ status: 1, flushAt: 1 });
  await pendingBatches.createIndex({ accountId: 1, chatId: 1, status: 1 });
  await pendingBatches.createIndex({ batchId: 1 }, { unique: true });
  await pendingBatches.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const sourceMessages = database.collection<SourceMessageRecord>('sourceMessages');
  await sourceMessages.createIndex({ accountId: 1, chatId: 1, messageId: 1 }, { unique: true });
  await sourceMessages.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  const summaries = database.collection<SummaryRecord>('summaries');
  await summaries.createIndex({ summaryId: 1 }, { unique: true });
  await summaries.createIndex({ accountId: 1, chatId: 1, createdAt: -1 });
  await summaries.createIndex({ batchId: 1 });

  const reminders = database.collection<ReminderRecord>('reminders');
  await reminders.createIndex({ reminderId: 1 }, { unique: true });
  await reminders.createIndex({ accountId: 1, status: 1, dueAt: 1 });
  await reminders.createIndex({ summaryId: 1 });

  const contacts = database.collection<ContactPreference>('contacts');
  await contacts.createIndex({ chatId: 1 }, { unique: true });
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
