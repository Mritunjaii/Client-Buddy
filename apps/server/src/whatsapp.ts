import { EventEmitter } from 'node:events';
import QRCode from 'qrcode';
import { Client, LocalAuth } from 'whatsapp-web.js';
import path from 'node:path';
import { NormalizedMessage } from '@clientpulse/shared';

export interface WhatsAppServiceEvents {
  qr: (qrDataUrl: string) => void;
  ready: (data: { phoneNumber?: string; pushname?: string }) => void;
  disconnected: () => void;
  message: (msg: NormalizedMessage) => void;
}

export class WhatsAppManager extends EventEmitter {
  private client: Client | null = null;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private currentQrDataUrl: string | null = null;
  private currentPhoneNumber: string | null = null;

  constructor() {
    super();
  }

  get status(): 'disconnected' | 'connecting' | 'connected' {
    if (this.isConnected) return 'connected';
    if (this.isConnecting) return 'connecting';
    return 'disconnected';
  }

  get qr(): string | null {
    return this.currentQrDataUrl;
  }

  get phone(): string | null {
    return this.currentPhoneNumber;
  }

  /**
   * Initializes the WhatsApp Web client on demand.
   * Generates a QR code only when the user requests connection, or restores existing session.
   */
  async requestConnect(): Promise<{ qrDataUrl?: string; phoneNumber?: string }> {
    if (this.isConnected && this.client) {
      return { phoneNumber: this.currentPhoneNumber || undefined };
    }

    if (this.isConnecting && this.currentQrDataUrl) {
      return { qrDataUrl: this.currentQrDataUrl };
    }

    this.isConnecting = true;
    this.isConnected = false;

    // Destroy any stale instance
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }

    const sessionAuthPath = path.resolve(process.cwd(), '.wwebjs_auth');

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: sessionAuthPath,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      },
    });

    return new Promise((resolve, reject) => {
      let resolved = false;

      // Timeout after 45 seconds if WhatsApp Web server fails to load
      const connectionTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.isConnecting = false;
          reject(new Error('WhatsApp connection timed out. Please click retry.'));
        }
      }, 45000);

      this.client!.on('qr', async (qrRaw) => {
        try {
          // Authentic WhatsApp QR generated directly from whatsapp-web.js
          const qrDataUrl = await QRCode.toDataURL(qrRaw, {
            width: 280,
            margin: 2,
            color: {
              dark: '#0f172a',
              light: '#ffffff',
            },
          });

          this.currentQrDataUrl = qrDataUrl;
          this.emit('qr', qrDataUrl);

          if (!resolved) {
            resolved = true;
            resolve({ qrDataUrl });
          }
        } catch (err) {
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        }
      });

      this.client!.on('authenticated', () => {
        console.log('[WhatsApp Web] Client session authenticated');
        this.isConnected = true;
      });

      this.client!.on('ready', async () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.isConnecting = false;
        this.currentQrDataUrl = null;

        const info = this.client?.info;
        const phone = info?.wid?.user ? `+${info.wid.user}` : '+91 (Connected Phone)';
        this.currentPhoneNumber = phone;
        console.log(`[WhatsApp Web] Client ready and listening! Connected phone: ${phone}`);

        this.emit('ready', { phoneNumber: phone, pushname: info?.pushname });

        if (!resolved) {
          resolved = true;
          resolve({ phoneNumber: phone });
        }
      });

      this.client!.on('disconnected', () => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.isConnecting = false;
        this.currentQrDataUrl = null;
        this.currentPhoneNumber = null;
        console.log('[WhatsApp Web] Session disconnected');
        this.emit('disconnected');
      });

      const recentMsgIds = new Set<string>();

      const handleMsg = (msg: any) => {
        if (!msg || msg.fromMe) return;

        const msgId = msg.id?._serialized || msg.id?.id || `msg_${Date.now()}_${Math.random()}`;
        if (recentMsgIds.has(msgId)) return;
        recentMsgIds.add(msgId);
        setTimeout(() => recentMsgIds.delete(msgId), 60000);

        const normalized: NormalizedMessage = {
          messageId: msgId,
          chatId: msg.from,
          senderId: msg.author || msg.from,
          senderName: msg._data?.notifyName || msg.sender?.pushname || undefined,
          timestamp: new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000),
          text: msg.body || (msg.hasMedia ? '[Media/Attachment Received]' : ''),
          type: msg.hasMedia ? 'other' : 'text',
          isGroupMessage: typeof msg.from === 'string' && msg.from.endsWith('@g.us'),
          isOutgoing: false,
          hasMedia: !!msg.hasMedia,
        };

        console.log(`[WhatsApp Ingest] Live message captured from ${normalized.chatId} (${normalized.senderName || 'Client'}): "${normalized.text}"`);
        this.emit('message', normalized);
      };

      this.client!.on('message', handleMsg);
      this.client!.on('message_create', handleMsg);

      this.client!.initialize().catch((err) => {
        clearTimeout(connectionTimeout);
        this.isConnecting = false;
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  /**
   * Discovers and retrieves available chats from connected WhatsApp Web session.
   */
  async getChats(): Promise<Array<{
    id: string;
    name: string;
    isGroup: boolean;
    unreadCount: number;
    lastMessageAt?: Date;
    lastMessageText?: string;
    lastMessageSender?: string;
  }>> {
    if (!this.client || !this.isConnected) {
      return [];
    }

    try {
      // In whatsapp-web.js, during the initial post-login sync (first 10-20s),
      // the internal window.Store.Chat module may still be hydrating.
      const page = (this.client as any).pupPage;
      if (!page || page.isClosed()) {
        return [];
      }

      // Check if Store is injected and ready
      const isStoreReady = await page.evaluate(() => {
        return typeof (window as any).Store !== 'undefined' && typeof (window as any).Store.Chat !== 'undefined';
      }).catch(() => false);

      if (!isStoreReady) {
        return [];
      }

      const chats = await this.client.getChats();
      if (!chats || !Array.isArray(chats) || chats.length === 0) {
        return [];
      }

      return chats.slice(0, 50).map((c) => {
        const rawTime = c.timestamp || (c.lastMessage as any)?.timestamp;
        const msgDate = rawTime ? new Date(rawTime * 1000) : undefined;
        return {
          id: c.id._serialized,
          name: c.name || c.id.user || 'Unknown Contact',
          isGroup: c.isGroup,
          unreadCount: c.unreadCount || 0,
          lastMessageAt: msgDate,
          lastMessageText: (c.lastMessage as any)?.body || '',
          lastMessageSender: (c.lastMessage as any)?.fromMe ? 'You' : ((c.lastMessage as any)?.from || ''),
        };
      });
    } catch (err: any) {
      return [];
    }
  }

  /**
   * Disconnects and destroys active browser session.
   */
  async disconnect() {
    this.isConnected = false;
    this.isConnecting = false;
    this.currentQrDataUrl = null;
    this.currentPhoneNumber = null;

    if (this.client) {
      try {
        await this.client.logout();
      } catch {}
      try {
        await this.client.destroy();
      } catch {}
      this.client = null;
    }

    this.emit('disconnected');
  }

  /**
   * Simulation mode helper (allows testing without scanning on every run)
   */
  confirmSimulationConnected(phoneNumber: string = '+91 98765 43210') {
    this.isConnected = true;
    this.isConnecting = false;
    this.currentQrDataUrl = null;
    this.currentPhoneNumber = phoneNumber;
    this.emit('ready', { phoneNumber });
  }
}

export const whatsappManager = new WhatsAppManager();
