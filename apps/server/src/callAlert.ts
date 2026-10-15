import dotenv from 'dotenv';
dotenv.config();

export interface CallAlertPayload {
  summaryId: string;
  chatId: string;
  contactName: string;
  urgency: 'CRITICAL';
  reason: string;
  time: Date;
  summaryText?: string;
}

export interface CallAlertResult {
  success: boolean;
  provider: 'elevenlabs_convai' | 'twilio_elevenlabs' | 'simulated_local';
  phoneCalled?: string;
  audioUrl?: string;
  audioBase64?: string;
  message: string;
}

// In-memory cache for synthesized ElevenLabs audio clips
const audioCache = new Map<string, { buffer: Buffer; contentType: string; createdAt: Date }>();

// Rate-limiting / deduplication cooldown for phone calls (max 1 call per chat per 3 mins)
const callCooldownMap = new Map<string, number>();

export class CallAlertService {
  private elevenLabsApiKey: string;
  private elevenLabsVoiceId: string;
  private elevenLabsAgentId: string;
  private twilioAccountSid: string;
  private twilioAuthToken: string;
  private twilioPhoneNumber: string;
  private defaultAlertPhone: string;

  constructor() {
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
    this.elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel (default natural voice)
    this.elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID || '';
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER || '';
    this.defaultAlertPhone = process.env.ALERT_PHONE_NUMBER || '+918091983263';
  }

  /**
   * Checks if user has provided real credentials or placeholders
   */
  private isKeyConfigured(key: string): boolean {
    return Boolean(key && !key.includes('your_') && !key.includes('placeholder') && key.trim().length > 6);
  }

  /**
   * Synthesize natural speech audio using ElevenLabs Text-to-Speech API
   */
  async synthesizeSpeech(text: string, voiceId?: string): Promise<Buffer | null> {
    dotenv.config();
    const key = process.env.ELEVENLABS_API_KEY || this.elevenLabsApiKey;
    if (!this.isKeyConfigured(key)) {
      console.log('[ElevenLabs] API Key is not configured in .env. Skipping external synthesis.');
      return null;
    }

    const selectedVoice = voiceId || process.env.ELEVENLABS_VOICE_ID || this.elevenLabsVoiceId;

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key.trim(),
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.35,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ElevenLabs API Error] Status ${response.status}: ${errorText}`);
        // If library voice fails on free plan (402/400), seamlessly retry with high quality premade voice
        if (selectedVoice !== 'EXAVITQu4vr4xnSDxMaL' && (response.status === 402 || response.status === 400)) {
          console.log('[ElevenLabs] Retrying with premade voice (EXAVITQu4vr4xnSDxMaL)...');
          return this.synthesizeSpeech(text, 'EXAVITQu4vr4xnSDxMaL');
        }
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err: any) {
      console.error('[ElevenLabs Network Error]:', err.message);
      return null;
    }
  }

  /**
   * Place an outbound phone call via Twilio
   */
  async placeTwilioPhoneCall(toPhone: string, speechScript: string, audioStreamUrl?: string): Promise<{ success: boolean; sid?: string; error?: string }> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || this.twilioAccountSid;
    const authToken = process.env.TWILIO_AUTH_TOKEN || this.twilioAuthToken;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER || this.twilioPhoneNumber;

    if (!this.isKeyConfigured(accountSid) || !this.isKeyConfigured(authToken) || !this.isKeyConfigured(fromPhone)) {
      console.log('[Twilio] Credentials not configured in .env. Outbound phone call skipped.');
      return { success: false, error: 'Twilio credentials not configured in .env' };
    }

    try {
      // Create inline TwiML: if we have an ElevenLabs audio stream URL, play it; otherwise say message with natural voice
      const twiml = audioStreamUrl
        ? `<Response><Play>${audioStreamUrl}</Play><Pause length="1"/><Say voice="Polly.Joanna">To repeat this message, please check your Client Buddy dashboard. Goodbye.</Say></Response>`
        : `<Response><Say voice="Polly.Joanna">${speechScript}</Say></Response>`;

      const params = new URLSearchParams();
      params.append('To', toPhone);
      params.append('From', fromPhone);
      params.append('Twiml', twiml);

      const authHeader = Buffer.from(`${accountSid.trim()}:${authToken.trim()}`).toString('base64');
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid.trim()}/Calls.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.message || `Twilio HTTP ${response.status}` };
      }

      console.log(`[Twilio Call Placed] Call SID: ${data.sid} to ${toPhone}`);
      return { success: true, sid: data.sid };
    } catch (err: any) {
      console.error('[Twilio Error]:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Place an outbound phone call via ElevenLabs Conversational AI Agent (if configured)
   */
  async placeElevenLabsConvAiCall(toPhone: string, alertData: CallAlertPayload): Promise<{ success: boolean; error?: string }> {
    const key = process.env.ELEVENLABS_API_KEY || this.elevenLabsApiKey;
    const agentId = process.env.ELEVENLABS_AGENT_ID || this.elevenLabsAgentId;

    if (!this.isKeyConfigured(key) || !this.isKeyConfigured(agentId)) {
      return { success: false, error: 'ElevenLabs Conversational AI Agent ID not set' };
    }

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}/calls`, {
        method: 'POST',
        headers: {
          'xi-api-key': key.trim(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: toPhone,
          prompt: `You are Client Buddy Emergency Alert Assistant. You are immediately calling the user to notify them that their client ${alertData.contactName} sent a CRITICAL priority emergency on WhatsApp. Reason: ${alertData.reason}. Be concise, urgent, professional, and clear.`,
          first_message: `Urgent alert from Client Buddy: A critical emergency request was received from client ${alertData.contactName}. Details: ${alertData.reason}.`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }

      console.log(`[ElevenLabs ConvAI Call] Triggered call to ${toPhone}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Orchestrates the complete Critical Call Alert:
   * 1. Composes natural urgency script.
   * 2. Synthesizes crystal-clear ElevenLabs voice audio.
   * 3. Triggers real phone call via Twilio / ElevenLabs ConvAI.
   * 4. Returns payload for in-app alert banner & audio preview.
   */
  async executeCriticalCallAlert(alertData: CallAlertPayload, recipientPhone?: string): Promise<CallAlertResult> {
    dotenv.config();
    const targetPhone = recipientPhone || process.env.ALERT_PHONE_NUMBER || this.defaultAlertPhone;
    const script = `Critical alert from Client Buddy: A high-priority emergency was reported by your client, ${alertData.contactName || 'Client'}. ${alertData.reason}. Please review your dashboard immediately.`;

    console.log(`[Call Alert] Initiating Critical Call Alert for ${alertData.contactName} (Target: ${targetPhone})`);

    // 1. Synthesize realistic ElevenLabs voice audio
    const audioBuffer = await this.synthesizeSpeech(script);
    let audioBase64: string | undefined;

    if (audioBuffer) {
      audioCache.set(alertData.summaryId, {
        buffer: audioBuffer,
        contentType: 'audio/mpeg',
        createdAt: new Date(),
      });
      audioBase64 = audioBuffer.toString('base64');
      console.log(`[ElevenLabs] Successfully generated ${audioBuffer.length} bytes of realistic alert audio`);
    }

    // Check 3-minute cooldown for outbound phone calls per chat
    const nowMs = Date.now();
    const lastCallTime = callCooldownMap.get(alertData.chatId);
    const isCooldownActive = Boolean(lastCallTime && (nowMs - lastCallTime < 3 * 60 * 1000));

    // 2. Attempt ElevenLabs Conversational AI Outbound Call
    if (!isCooldownActive && this.isKeyConfigured(process.env.ELEVENLABS_AGENT_ID || this.elevenLabsAgentId)) {
      const convRes = await this.placeElevenLabsConvAiCall(targetPhone, alertData);
      if (convRes.success) {
        callCooldownMap.set(alertData.chatId, nowMs);
        return {
          success: true,
          provider: 'elevenlabs_convai',
          phoneCalled: targetPhone,
          audioBase64,
          message: `ElevenLabs Conversational AI outbound phone call placed to ${targetPhone}`,
        };
      }
    }

    // 3. Attempt Twilio Call with ElevenLabs Audio
    let twilioErrorNotice: string | undefined;
    if (!isCooldownActive && this.isKeyConfigured(process.env.TWILIO_ACCOUNT_SID || this.twilioAccountSid)) {
      const twilioRes = await this.placeTwilioPhoneCall(targetPhone, script);
      if (twilioRes.success) {
        callCooldownMap.set(alertData.chatId, nowMs);
        return {
          success: true,
          provider: 'twilio_elevenlabs',
          phoneCalled: targetPhone,
          audioBase64,
          message: `Outbound phone call placed to ${targetPhone} via Twilio (Call SID: ${twilioRes.sid})`,
        };
      } else {
        twilioErrorNotice = twilioRes.error;
      }
    }

    // 4. Default / Simulated fallback mode (when user has placeholder keys or trial limit)
    let finalMessage = '';
    if (isCooldownActive) {
      finalMessage = `ElevenLabs voice synthesized! Outbound call on 3-min cooldown for this client to prevent duplicate ringing.`;
    } else if (audioBuffer) {
      finalMessage = twilioErrorNotice
        ? `ElevenLabs voice synthesized! Twilio notice: ${twilioErrorNotice}`
        : `ElevenLabs voice synthesized! Add Twilio credentials in .env to dispatch outbound GSM calls to ${targetPhone}.`;
    } else {
      finalMessage = `ElevenLabs Call Alert initialized for ${targetPhone}. Fill in your ELEVENLABS_API_KEY in apps/server/.env to activate live phone voice audio.`;
    }

    return {
      success: true,
      provider: 'simulated_local',
      phoneCalled: targetPhone,
      audioBase64,
      message: finalMessage,
    };
  }

  /**
   * Retrieve cached audio stream buffer
   */
  getAudio(summaryId: string): { buffer: Buffer; contentType: string } | null {
    const item = audioCache.get(summaryId);
    return item ? { buffer: item.buffer, contentType: item.contentType } : null;
  }
}

export const callAlertService = new CallAlertService();
