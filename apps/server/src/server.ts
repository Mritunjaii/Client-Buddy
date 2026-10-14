import express, { Request, Response } from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { connectMongo, getDb } from './db.js';
import { BatchManager } from './batching.js';
import { OllamaAnalyzer } from './ai.js';
import { BatchWorker } from './worker.js';
import { whatsappManager } from './whatsapp.js';
import { NormalizedMessage, UserAccount, ContactPreference } from '@clientpulse/shared';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/clientpulse';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma:2b';
const JWT_SECRET = process.env.JWT_SECRET || 'clientpulse_secret_key_2026';

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// Application state
let batchManager: BatchManager;
let batchWorker: BatchWorker;
let analyzer: OllamaAnalyzer;

// Auth Middleware
interface AuthRequest extends Request {
  user?: { userId: string; email: string };
}

function authenticateToken(req: AuthRequest, res: Response, next: Function) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// =================== AUTHENTICATION ROUTES =================== //

// 1. Register User
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const db = getDb();
    const existing = await db.collection<UserAccount>('users').findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = `user_${crypto.randomUUID().slice(0, 8)}`;
    const newUser: UserAccount = {
      userId,
      email: email.toLowerCase(),
      passwordHash,
      name,
      whatsappConnected: false,
      createdAt: new Date(),
    };

    await db.collection<UserAccount>('users').insertOne(newUser);
    const token = jwt.sign({ userId, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        userId,
        email: newUser.email,
        name: newUser.name,
        whatsappConnected: false,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Login User
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const db = getDb();
    const user = await db.collection<UserAccount>('users').findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.userId, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        whatsappConnected: !!user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Current User Profile
app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const user = await db.collection<UserAccount>('users').findOne({ userId: req.user?.userId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        whatsappConnected: !!user.whatsappConnected,
        whatsappPhone: user.whatsappPhone,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =================== WHATSAPP ONBOARDING FLOW =================== //

// 4. Request WhatsApp Connection & Generate QR on Demand
app.post('/api/whatsapp/request-qr', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await whatsappManager.requestConnect();
    if (result.qrDataUrl) {
      io.emit('whatsapp:qr', { qrDataUrl: result.qrDataUrl });
    }
    res.json({ success: true, qrDataUrl: result.qrDataUrl });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Confirm / Scan QR Pairing
app.post('/api/whatsapp/confirm-pairing', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const phoneNumber = req.body.phoneNumber || '+91 98765 43210';
    whatsappManager.confirmSimulationConnected(phoneNumber);

    await db.collection<UserAccount>('users').updateOne(
      { userId: req.user?.userId },
      { $set: { whatsappConnected: true, whatsappPhone: phoneNumber, updatedAt: new Date() } }
    );

    io.emit('whatsapp:status', { status: 'connected', phoneNumber });
    res.json({ success: true, whatsappConnected: true, phoneNumber });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Disconnect WhatsApp
app.post('/api/whatsapp/disconnect', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    await whatsappManager.disconnect();

    await db.collection<UserAccount>('users').updateOne(
      { userId: req.user?.userId },
      { $set: { whatsappConnected: false, whatsappPhone: undefined, updatedAt: new Date() } }
    );

    io.emit('whatsapp:status', { status: 'disconnected' });
    res.json({ success: true, whatsappConnected: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// =================== DASHBOARD & BRIEFS =================== //

// 7. Health & Status
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    whatsapp: whatsappManager.status,
    ollama: { baseUrl: OLLAMA_BASE_URL, model: OLLAMA_MODEL },
  });
});

// 7.1 Discover and list contacts
app.get('/api/contacts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const chats = await whatsappManager.getChats();
    const storedPreferences = await db
      .collection<ContactPreference>('contacts')
      .find({})
      .toArray();

    const prefMap = new Map(storedPreferences.map((p) => [p.chatId, p]));

    const result = chats.map((c) => {
      const pref = prefMap.get(c.id);
      return {
        chatId: c.id,
        displayName: pref?.displayName || c.name,
        enabled: pref !== undefined ? pref.enabled : true, // Default to monitored
        isGroup: c.isGroup,
        projectScope: pref?.projectScope,
        preferredTone: pref?.preferredTone,
      };
    });

    res.json({ contacts: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7.2 Toggle or update contact monitoring preferences
app.put('/api/contacts/:chatId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { enabled, displayName, projectScope, preferredTone } = req.body;
    const chatId = req.params.chatId;

    const updated = await db.collection<ContactPreference>('contacts').findOneAndUpdate(
      { chatId },
      {
        $set: {
          chatId,
          displayName: displayName || chatId,
          enabled: typeof enabled === 'boolean' ? enabled : true,
          projectScope,
          preferredTone,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.json({ success: true, contact: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Fetch Summaries
app.get('/api/summaries', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { chatId } = req.query;
    const filter: any = { accountId: req.user?.userId };
    if (chatId) filter.chatId = chatId;

    const summaries = await db
      .collection('summaries')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    res.json({ summaries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 9. View Source Messages (Inspection feature)
app.get('/api/summaries/:summaryId/source', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const summary = await db.collection('summaries').findOne({
      summaryId: req.params.summaryId,
      accountId: req.user?.userId,
    });
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }

    const messages = await db
      .collection('sourceMessages')
      .find({ messageId: { $in: summary.sourceMessageRefs } })
      .sort({ timestamp: 1 })
      .toArray();

    res.json({
      summaryId: summary.summaryId,
      sourceExpiresAt: summary.sourceExpiresAt,
      messages,
      isExpired: messages.length === 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Fetch Reminders
app.get('/api/reminders', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { status } = req.query;
    const filter: any = { accountId: req.user?.userId };
    if (status) filter.status = status;

    const reminders = await db
      .collection('reminders')
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ reminders });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Update Reminder Status
app.patch('/api/reminders/:reminderId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { status } = req.body;
    const result = await db.collection('reminders').findOneAndUpdate(
      { reminderId: req.params.reminderId, accountId: req.user?.userId },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Reminder not found' });
    io.emit('reminder:updated', result);
    res.json({ reminder: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Ingest Incoming Message
app.post('/api/mock/incoming-message', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { chatId, text, isUrgent } = req.body;
    const userId = req.user!.userId;
    const targetChatId = chatId || 'chat_client_aarav';

    const db = getDb();

    // 1. Check if contact is muted
    const contactPref = await db.collection<ContactPreference>('contacts').findOne({ chatId: targetChatId });
    if (contactPref && contactPref.enabled === false) {
      return res.status(200).json({
        success: true,
        ignored: true,
        message: 'Message dropped: Contact is currently muted per your monitoring preferences.',
      });
    }

    const contactName = contactPref?.displayName || (
      targetChatId === 'chat_client_priya' ? 'Priya Patel' :
      targetChatId === 'chat_project_team' ? 'Website Redesign Team' : 'Aarav Sharma'
    );

    const msg: NormalizedMessage = {
      messageId: `msg_${crypto.randomUUID().slice(0, 8)}`,
      chatId: targetChatId,
      senderId: targetChatId,
      senderName: contactName,
      timestamp: new Date(),
      text: text || (isUrgent ? 'URGENT: Checkout is broken!' : 'Please send the update by tomorrow.'),
      type: 'text',
      isGroupMessage: targetChatId.includes('team') || targetChatId.includes('group'),
      isOutgoing: false,
      hasMedia: false,
    };

    const result = await batchManager.ingestMessage(userId, msg, contactName);
    io.emit('message:incoming', { message: msg, batchId: result.batchId, isNewBatch: result.isNewBatch });

    res.json({ success: true, message: msg, batchResult: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 12.1 Immediately flush pending sliding window batch for instant testing
app.post('/api/mock/flush-now', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const { chatId } = req.body;
    const filter: any = { accountId: userId, status: 'pending' };
    if (chatId) filter.chatId = chatId;
    const result = await db.collection('pendingBatches').updateMany(filter, {
      $set: { flushAt: new Date() },
    });
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Export Data (GDPR / Privacy Compliance)
app.get('/api/data/export', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;

    const [summaries, reminders, contacts] = await Promise.all([
      db.collection('summaries').find({ accountId: userId }).toArray(),
      db.collection('reminders').find({ accountId: userId }).toArray(),
      db.collection('contacts').find({}).toArray(),
    ]);

    res.json({
      exportedAt: new Date(),
      userId,
      summaries,
      reminders,
      contacts,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Purge Source Message Cache Immediately (Zero-Footprint Mode)
app.delete('/api/data/source-cache', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    const result = await db.collection('sourceMessages').deleteMany({ accountId: userId });
    res.json({ success: true, message: `Purged ${result.deletedCount} source inspection message records.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 15. Clear All User Data
app.delete('/api/data', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.user!.userId;
    await Promise.all([
      db.collection('pendingBatches').deleteMany({ accountId: userId }),
      db.collection('sourceMessages').deleteMany({ accountId: userId }),
      db.collection('summaries').deleteMany({ accountId: userId }),
      db.collection('reminders').deleteMany({ accountId: userId }),
    ]);
    res.json({ success: true, message: 'All data cleared' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  socket.emit('whatsapp:status', { status: whatsappManager.status });
});

export async function startServer() {
  const db = await connectMongo(MONGODB_URI);
  console.log('[Database] Connected to MongoDB');

  batchManager = new BatchManager(db, {
    quietWindowMs: 120000, // 2 minutes quiet inactivity window per conversation
    maxBatchAgeMs: 600000, // 10 minutes max batch age cap
    sourceRetentionMs: 7 * 24 * 60 * 60 * 1000,
  });

  analyzer = new OllamaAnalyzer({
    baseUrl: OLLAMA_BASE_URL,
    model: OLLAMA_MODEL,
  });

  batchWorker = new BatchWorker(db, batchManager, analyzer, io, 1500);
  batchWorker.start();
  console.log('[Worker] Sliding window batch worker running');

  // Ingest live messages from real WhatsApp Web session
  whatsappManager.on('message', async (normalizedMsg) => {
    try {
      // 1. Verify if chat is enabled/monitored
      const contactPref = await db.collection<ContactPreference>('contacts').findOne({ chatId: normalizedMsg.chatId });
      if (contactPref && contactPref.enabled === false) {
        // Ignored: User opted out of monitoring this contact
        return;
      }

      // 2. Route to active user
      const user = await db.collection<UserAccount>('users').findOne({ whatsappConnected: true });
      if (user) {
        const contactName = contactPref?.displayName || normalizedMsg.senderName;
        const result = await batchManager.ingestMessage(user.userId, normalizedMsg, contactName);
        io.emit('message:incoming', {
          message: normalizedMsg,
          batchId: result.batchId,
          isNewBatch: result.isNewBatch,
        });
      }
    } catch (err) {
      console.error('[WhatsApp Ingest Error]:', err);
    }
  });

  whatsappManager.on('qr', (qrDataUrl) => {
    io.emit('whatsapp:qr', { qrDataUrl });
  });

  whatsappManager.on('ready', async (data) => {
    io.emit('whatsapp:status', { status: 'connected', phoneNumber: data.phoneNumber });
    const user = await db.collection<UserAccount>('users').findOne({});
    if (user) {
      await db.collection<UserAccount>('users').updateOne(
        { userId: user.userId },
        { $set: { whatsappConnected: true, whatsappPhone: data.phoneNumber, updatedAt: new Date() } }
      );
    }
  });

  server.listen(PORT, () => {
    console.log(`[Server] Client Buddy backend listening on http://127.0.0.1:${PORT}`);
  });
}

if (process.argv[1]?.includes('server.ts') || process.argv[1]?.includes('server.js')) {
  startServer().catch(console.error);
}
