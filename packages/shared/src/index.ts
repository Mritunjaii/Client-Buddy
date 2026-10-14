import { z } from 'zod';

export const UserAccountSchema = z.object({
  _id: z.string().optional(),
  userId: z.string(),
  email: z.string().email(),
  passwordHash: z.string(),
  name: z.string(),
  whatsappConnected: z.boolean().default(false),
  whatsappPhone: z.string().optional(),
  monitoringMode: z.enum(['all', 'selective']).default('all'),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});
export type UserAccount = z.infer<typeof UserAccountSchema>;

export const NormalizedMessageSchema = z.object({
  messageId: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  timestamp: z.coerce.date(),
  text: z.string(),
  type: z.enum(['text', 'image', 'audio', 'document', 'other']).default('text'),
  isGroupMessage: z.boolean().default(false),
  isOutgoing: z.boolean().default(false),
  hasMedia: z.boolean().default(false),
});
export type NormalizedMessage = z.infer<typeof NormalizedMessageSchema>;

export const BatchStatusSchema = z.enum([
  'pending',
  'processing',
  'processed',
  'failed',
]);
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

export const PendingBatchSchema = z.object({
  _id: z.string().optional(),
  batchId: z.string(),
  accountId: z.string(),
  chatId: z.string(),
  contactName: z.string().optional(),
  messages: z.array(NormalizedMessageSchema),
  flushAt: z.coerce.date(),
  maxFlushAt: z.coerce.date(),
  status: BatchStatusSchema,
  batchVersion: z.number().int().default(1),
  leaseOwner: z.string().nullable().optional(),
  leaseUntil: z.coerce.date().nullable().optional(),
  attemptCount: z.number().int().default(0),
  lastError: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type PendingBatch = z.infer<typeof PendingBatchSchema>;

export const UrgencyLevelSchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
export type UrgencyLevel = z.infer<typeof UrgencyLevelSchema>;

export const ReminderStatusSchema = z.enum([
  'upcoming',
  'overdue',
  'completed',
  'dismissed',
  'needs_confirmation',
]);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

export const ExtractedReminderCandidateSchema = z.object({
  title: z.string(),
  description: z.string(),
  dateText: z.string().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
  sourceMessageRefs: z.array(z.string()).default([]),
});
export type ExtractedReminderCandidate = z.infer<typeof ExtractedReminderCandidateSchema>;

export const AIAnalysisOutputSchema = z.object({
  summary: z.string(),
  urgency: UrgencyLevelSchema,
  urgencyReason: z.string(),
  confidence: z.number().min(0).max(1).default(0.8),
  requirements: z.array(z.string()).default([]),
  deadlines: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  actionItems: z.array(z.string()).default([]),
  suggestedReply: z.string(),
  reminders: z.array(ExtractedReminderCandidateSchema).default([]),
});
export type AIAnalysisOutput = z.infer<typeof AIAnalysisOutputSchema>;

export const SummaryRecordSchema = z.object({
  _id: z.string().optional(),
  summaryId: z.string(),
  accountId: z.string(),
  chatId: z.string(),
  contactName: z.string().optional(),
  batchId: z.string(),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
  summary: z.string(),
  urgency: UrgencyLevelSchema,
  urgencyReason: z.string(),
  confidence: z.number(),
  requirements: z.array(z.string()),
  deadlines: z.array(z.string()),
  openQuestions: z.array(z.string()),
  actionItems: z.array(z.string()),
  suggestedReply: z.string(),
  sourceMessageRefs: z.array(z.string()),
  createdAt: z.coerce.date(),
  sourceExpiresAt: z.coerce.date().optional(),
});
export type SummaryRecord = z.infer<typeof SummaryRecordSchema>;

export const ReminderRecordSchema = z.object({
  _id: z.string().optional(),
  reminderId: z.string(),
  accountId: z.string(),
  chatId: z.string(),
  contactName: z.string().optional(),
  summaryId: z.string(),
  batchId: z.string(),
  title: z.string(),
  description: z.string(),
  dateText: z.string().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  timezone: z.string().default('UTC'),
  confidence: z.number(),
  status: ReminderStatusSchema,
  sourceMessageRefs: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().nullable().optional(),
});
export type ReminderRecord = z.infer<typeof ReminderRecordSchema>;

export const SourceMessageRecordSchema = z.object({
  _id: z.string().optional(),
  accountId: z.string(),
  chatId: z.string(),
  messageId: z.string(),
  senderId: z.string(),
  senderName: z.string().optional(),
  timestamp: z.coerce.date(),
  text: z.string(),
  expiresAt: z.coerce.date(),
});
export type SourceMessageRecord = z.infer<typeof SourceMessageRecordSchema>;

export const ContactPreferenceSchema = z.object({
  chatId: z.string(),
  displayName: z.string(),
  enabled: z.boolean().default(true),
  isGroup: z.boolean().default(false),
  urgencySensitivity: z.enum(['low', 'standard', 'high']).default('standard'),
  projectScope: z.string().optional(),
  preferredTone: z.string().optional(),
  lastMessageAt: z.coerce.date().optional(),
  lastMessageText: z.string().optional(),
  lastMessageSender: z.string().optional(),
});
export type ContactPreference = z.infer<typeof ContactPreferenceSchema>;

