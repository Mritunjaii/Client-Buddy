import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { io, Socket } from 'socket.io-client';
import {
  MessageSquare,
  Clock,
  ShieldCheck,
  Bell,
  Copy,
  Check,
  AlertTriangle,
  Send,
  Eye,
  CheckCircle,
  Calendar,
  Sparkles,
  RefreshCw,
  Trash2,
  QrCode,
  Smartphone,
  LogOut,
  UserCheck,
  Lock,
  Mail,
  ArrowRight,
  Volume2,
  VolumeX,
  Download,
  Settings
} from 'lucide-react';

interface User {
  userId: string;
  email: string;
  name: string;
  whatsappConnected: boolean;
  whatsappPhone?: string;
}

interface SummaryRecord {
  summaryId: string;
  chatId: string;
  contactName?: string;
  batchId: string;
  summary: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  urgencyReason: string;
  requirements: string[];
  deadlines: string[];
  openQuestions: string[];
  actionItems: string[];
  suggestedReply: string;
  createdAt: string;
  sourceMessageRefs: string[];
}

interface ReminderRecord {
  reminderId: string;
  chatId: string;
  contactName?: string;
  title: string;
  description: string;
  dateText?: string;
  status: 'upcoming' | 'overdue' | 'completed' | 'dismissed' | 'needs_confirmation';
  createdAt: string;
}

interface SourceMessage {
  messageId: string;
  senderName?: string;
  senderId: string;
  timestamp: string;
  text: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

export default function App() {
  // Authentication state
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // WhatsApp onboarding QR state
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [simulatingPairing, setSimulatingPairing] = useState(false);

  // Dashboard state
  const [activeTab, setActiveTab] = useState<'briefs' | 'reminders'>('briefs');
  const [summaries, setSummaries] = useState<SummaryRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [selectedChat, setSelectedChat] = useState<string>('chat_client_aarav');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [urgentAlert, setUrgentAlert] = useState<any>(null);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);

  // Contacts state
  interface ContactItem {
    chatId: string;
    displayName: string;
    enabled: boolean;
    isGroup: boolean;
    projectScope?: string;
    preferredTone?: string;
  }
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactFilter, setContactFilter] = useState<'all' | 'monitored'>('all');
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  // Reminders state
  const [reminderFilter, setReminderFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  // Inspection drawer state
  const [inspectingSummaryId, setInspectingSummaryId] = useState<string | null>(null);
  const [sourceMessages, setSourceMessages] = useState<SourceMessage[]>([]);
  const [loadingSources, setLoadingSources] = useState<boolean>(false);

  // Message burst simulation state
  const [customMsg, setCustomMsg] = useState('');
  const [isUrgentSim, setIsUrgentSim] = useState(false);
  const [simLoading, setSimLoading] = useState(false);

  // Initial token check
  useEffect(() => {
    const savedToken = localStorage.getItem('cp_token');
    if (savedToken) {
      setToken(savedToken);
      fetchUserProfile(savedToken);
    }
  }, []);

  // Real-time socket listener
  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(BACKEND_URL);

    socket.on('summary:new', (newSummary: SummaryRecord) => {
      setSummaries((prev) => [newSummary, ...prev]);
    });

    socket.on('reminder:new', (newRem: ReminderRecord) => {
      setReminders((prev) => [newRem, ...prev]);
    });

    socket.on('alert:urgent', (alertData) => {
      setUrgentAlert(alertData);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && speechEnabled) {
        // Privacy-safe neutral notification (does not blurt private client message text across room)
        const utterance = new SpeechSynthesisUtterance(
          `Priority alert: Urgent request received from client ${alertData.contactName || ''}`
        );
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      }
    });

    socket.on('whatsapp:qr', (data: { qrDataUrl: string }) => {
      if (data.qrDataUrl) {
        setQrCodeData(data.qrDataUrl);
      }
    });

    socket.on('whatsapp:status', (data) => {
      if (data.status === 'connected') {
        setCurrentUser((prev) => (prev ? { ...prev, whatsappConnected: true, whatsappPhone: data.phoneNumber } : prev));
        setQrCodeData(null);
      } else if (data.status === 'disconnected') {
        setCurrentUser((prev) => (prev ? { ...prev, whatsappConnected: false, whatsappPhone: undefined } : prev));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [token]);

  // Fetch summaries and reminders when WhatsApp is connected
  useEffect(() => {
    if (token && currentUser?.whatsappConnected) {
      fetchDashboardData(token);
    }
  }, [token, currentUser?.whatsappConnected]);

  const fetchUserProfile = async (authToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      } else {
        handleLogout();
      }
    } catch {
      handleLogout();
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const payload = authMode === 'login' 
      ? { email: authEmail, password: authPassword }
      : { email: authEmail, password: authPassword, name: authName };

    try {
      const res = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Authentication failed');
      } else {
        localStorage.setItem('cp_token', data.token);
        setToken(data.token);
        setCurrentUser(data.user);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('cp_token');
    setToken(null);
    setCurrentUser(null);
    setSummaries([]);
    setReminders([]);
    setQrCodeData(null);
  };

  const requestWhatsAppQr = async () => {
    setGeneratingQr(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/request-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.qrDataUrl) {
        setQrCodeData(data.qrDataUrl);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingQr(false);
    }
  };

  const confirmWhatsAppPairing = async () => {
    setSimulatingPairing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/whatsapp/confirm-pairing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ phoneNumber: '+91 98765 43210' }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentUser((prev) => (prev ? { ...prev, whatsappConnected: true, whatsappPhone: '+91 98765 43210' } : prev));
        setQrCodeData(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSimulatingPairing(false);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!confirm('Disconnect WhatsApp account? Monitoring will be paused.')) return;
    try {
      await fetch(`${BACKEND_URL}/api/whatsapp/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setCurrentUser((prev) => (prev ? { ...prev, whatsappConnected: false, whatsappPhone: undefined } : prev));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDashboardData = async (authToken: string) => {
    try {
      const [sumRes, remRes, contactRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/summaries`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${BACKEND_URL}/api/reminders`, { headers: { Authorization: `Bearer ${authToken}` } }),
        fetch(`${BACKEND_URL}/api/contacts`, { headers: { Authorization: `Bearer ${authToken}` } }),
      ]);
      const sumData = await sumRes.json();
      const remData = await remRes.json();
      const contactData = await contactRes.json();
      if (sumData.summaries) setSummaries(sumData.summaries);
      if (remData.reminders) setReminders(remData.reminders);
      if (contactData.contacts) setContacts(contactData.contacts);
    } catch (e) {
      console.error('Error fetching dashboard data:', e);
    }
  };

  const toggleContactMonitoring = async (chatId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/${chatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.chatId === chatId ? { ...c, enabled: !currentEnabled } : c))
        );
      }
    } catch (err) {
      console.error('Error toggling contact monitoring:', err);
    }
  };

  const copyReply = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const inspectSource = async (summaryId: string) => {
    setInspectingSummaryId(summaryId);
    setLoadingSources(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/summaries/${summaryId}/source`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSourceMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSources(false);
    }
  };

  const toggleReminderStatus = async (reminderId: string, nextStatus: 'upcoming' | 'completed') => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reminders/${reminderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        setReminders((prev) =>
          prev.map((r) => (r.reminderId === reminderId ? { ...r, status: nextStatus } : r))
        );
      }
    } catch (err) {
      console.error('Failed to update reminder:', err);
    }
  };

  const filteredReminders = reminders.filter((r) => {
    if (reminderFilter === 'all') return true;
    return r.status === reminderFilter;
  });

  const sendSimulatedBurst = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMsg.trim() || !token) return;
    setSimLoading(true);
    try {
      await fetch(`${BACKEND_URL}/api/mock/incoming-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          chatId: selectedChat,
          senderName: 'Aarav Sharma (Client)',
          text: customMsg,
          isUrgent: isUrgentSim,
        }),
      });
      setCustomMsg('');
    } catch (err) {
      console.error(err);
    } finally {
      setSimLoading(false);
    }
  };

  const exportData = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/data/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clientpulse-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const purgeSourceCache = async () => {
    if (!confirm('Purge raw source message cache now? Briefs and reminders will remain, but original text will be permanently erased.')) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/data/source-cache`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      alert(data.message || 'Source cache purged.');
    } catch (err) {
      console.error(err);
    }
  };

  const clearAllData = async () => {
    if (!confirm('Clear all your summaries and reminders?')) return;
    await fetch(`${BACKEND_URL}/api/data`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setSummaries([]);
    setReminders([]);
    setUrgentAlert(null);
  };

  // ================= VIEW 1: AUTHENTICATION (LOGIN / REGISTER) ================= //
  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 font-sans">
        <Head>
          <title>Sign In | Client Buddy</title>
        </Head>

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide">Client Buddy</h1>
            <p className="text-xs text-slate-400">
              Privacy-first WhatsApp client intelligence for freelancers & agencies.
            </p>
          </div>

          <div className="flex bg-slate-800/80 p-1 rounded-xl text-xs font-semibold border border-slate-700">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(null); }}
              className={`flex-1 py-2 rounded-lg transition ${
                authMode === 'login' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setAuthMode('register'); setAuthError(null); }}
              className={`flex-1 py-2 rounded-lg transition ${
                authMode === 'register' ? 'bg-emerald-600 text-white' : 'text-slate-400'
              }`}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="Mritunjai Gupta"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl pl-9 pr-3 py-2.5 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="name@agency.com"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl pl-9 pr-3 py-2.5 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl pl-9 pr-3 py-2.5 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2 mt-2"
            >
              {authLoading ? 'Verifying...' : authMode === 'login' ? 'Sign In to Dashboard' : 'Register Account'}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="text-center text-[11px] text-slate-500">
            Secure offline-first AI inference with Gemma via Ollama.
          </div>
        </div>
      </div>
    );
  }

  // ================= VIEW 2: WHATSAPP ONBOARDING (CONNECT FIRST) ================= //
  if (!currentUser.whatsappConnected) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
        <Head>
          <title>Connect WhatsApp | Client Buddy</title>
        </Head>

        {/* Top Navbar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/80 px-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-white">Client Buddy</span>
          </div>

          <div className="flex items-center space-x-4 text-xs">
            <span className="text-slate-400">Signed in as: <strong className="text-slate-200">{currentUser.name}</strong></span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-slate-400 hover:text-rose-400 transition"
            >
              <LogOut className="w-3.5 h-3.5" /> Log Out
            </button>
          </div>
        </header>

        {/* Connect WhatsApp Prompt Container */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <Smartphone className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">WhatsApp Account Required</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                You must connect your WhatsApp session before accessing the intelligence dashboard. 
                Click below to request your connection QR code.
              </p>
            </div>

            {!qrCodeData ? (
              <div className="py-4 space-y-4">
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-left text-xs space-y-2 text-slate-300">
                  <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" /> Privacy Guarantee
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Client Buddy monitors only selected contacts. Messages are grouped by sliding windows and analyzed locally using open-weight Gemma models. The application never sends messages automatically.
                  </p>
                </div>

                <button
                  onClick={requestWhatsAppQr}
                  disabled={generatingQr}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                >
                  <QrCode className="w-4 h-4" />
                  {generatingQr ? 'Generating QR Code...' : 'Connect WhatsApp (Generate QR Code)'}
                </button>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in duration-300">
                <div className="p-4 bg-white rounded-2xl inline-block shadow-inner mx-auto">
                  <img src={qrCodeData} alt="WhatsApp QR Code" className="w-56 h-56 mx-auto rounded" />
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-200">Scan this QR Code with WhatsApp</p>
                  <p className="text-[11px] text-slate-400">
                    Open WhatsApp on your phone → Settings → Linked Devices → Link a Device.
                  </p>
                </div>

                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    onClick={confirmWhatsAppPairing}
                    disabled={simulatingPairing}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow transition flex items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {simulatingPairing ? 'Pairing device...' : 'Simulate / Confirm Device Linked'}
                  </button>

                  <button
                    onClick={() => setQrCodeData(null)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ================= VIEW 3: FULL INTELLIGENCE DASHBOARD ================= //
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Head>
        <title>Client Buddy | WhatsApp Client Brief Dashboard</title>
      </Head>

      {/* Top Navbar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
              Client Buddy
              <span className="text-[10px] uppercase font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
                Privacy-First
              </span>
            </h1>
            <p className="text-xs text-slate-400">Sliding-Window WhatsApp Client Intelligence</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-300">Gemma (Ollama Local)</span>
          </div>

          <div className="flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-300">WA: {currentUser.whatsappPhone || 'Connected'}</span>
          </div>

          <button
            onClick={() => setSpeechEnabled(!speechEnabled)}
            title={speechEnabled ? 'Mute spoken urgency alerts' : 'Enable spoken urgency alerts'}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition flex items-center gap-1 ${
              speechEnabled
                ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-750'
                : 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-300'
            }`}
          >
            {speechEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            {speechEnabled ? 'Voice Alerts' : 'Muted'}
          </button>

          <button
            onClick={disconnectWhatsApp}
            title="Disconnect WhatsApp"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-800 text-slate-400 hover:text-amber-300 transition flex items-center gap-1"
          >
            <Smartphone className="w-3.5 h-3.5" /> Disconnect
          </button>

          <button
            onClick={exportData}
            title="Export all client briefs, reminders, and preferences (GDPR/Compliance JSON)"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-emerald-300 transition"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={purgeSourceCache}
            title="Purge raw source message cache immediately"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-amber-950/60 border border-slate-700 hover:border-amber-800 text-slate-400 hover:text-amber-300 transition"
          >
            <ShieldCheck className="w-4 h-4" />
          </button>

          <button
            onClick={clearAllData}
            title="Reset simulation data"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-800 text-slate-400 hover:text-rose-300 transition"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleLogout}
            title="Log out"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Urgent Alert Banner */}
      {urgentAlert && (
        <div className="bg-rose-950/80 border-b border-rose-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3 text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-400 animate-bounce" />
            <span className="text-sm font-semibold">
              CRITICAL CLIENT EVENT: {urgentAlert.contactName || 'Client'} — {urgentAlert.reason}
            </span>
          </div>
          <button
            onClick={() => setUrgentAlert(null)}
            className="text-xs text-rose-400 hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <div className="flex rounded-lg bg-slate-800/80 p-1 border border-slate-700 text-xs font-medium">
              <button
                onClick={() => setActiveTab('briefs')}
                className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'briefs' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Client Briefs
              </button>
              <button
                onClick={() => setActiveTab('reminders')}
                className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'reminders' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Reminders ({reminders.length})
              </button>
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Contacts
              </div>
              <div className="flex gap-1 text-[10px]">
                <button
                  onClick={() => setContactFilter('all')}
                  className={`px-2 py-0.5 rounded transition ${
                    contactFilter === 'all' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-500'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setContactFilter('monitored')}
                  className={`px-2 py-0.5 rounded transition ${
                    contactFilter === 'monitored' ? 'bg-emerald-950 text-emerald-400 font-semibold' : 'text-slate-500'
                  }`}
                >
                  Monitored
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {(contacts.length > 0 ? contacts : [
                { chatId: 'chat_client_aarav', displayName: 'Aarav Sharma', enabled: true, isGroup: false },
                { chatId: 'chat_client_priya', displayName: 'Priya Patel', enabled: true, isGroup: false },
                { chatId: 'chat_project_team', displayName: 'Website Redesign Team', enabled: false, isGroup: true },
              ])
                .filter((c) => (contactFilter === 'monitored' ? c.enabled : true))
                .map((contact) => (
                  <div
                    key={contact.chatId}
                    onClick={() => setSelectedChat(contact.chatId)}
                    className={`p-3 rounded-xl border transition cursor-pointer ${
                      selectedChat === contact.chatId
                        ? 'bg-slate-800/90 border-emerald-500/50 shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-white">{contact.displayName}</span>
                        {contact.isGroup && (
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-1 rounded">Group</span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleContactMonitoring(contact.chatId, contact.enabled);
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded border transition ${
                          contact.enabled
                            ? 'text-emerald-400 bg-emerald-950 border-emerald-800 hover:bg-emerald-900/50'
                            : 'text-slate-500 bg-slate-950 border-slate-800 hover:text-slate-300'
                        }`}
                      >
                        {contact.enabled ? 'Monitored' : 'Muted'}
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {/* Test Simulation Controls */}
            <div className="mt-6 pt-4 border-t border-slate-800">
              <span className="text-xs uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Simulate WhatsApp Burst
              </span>
              <p className="text-[11px] text-slate-400 mt-1">
                Send messages from this client. Each new message resets the 2-minute quiet window to combine all updates into one brief card.
              </p>

              <form onSubmit={sendSimulatedBurst} className="mt-3 space-y-2">
                <textarea
                  rows={3}
                  value={customMsg}
                  onChange={(e) => setCustomMsg(e.target.value)}
                  placeholder="e.g. Can you update the hero design and add the lead form by Friday?"
                  className="w-full text-xs p-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-500 text-slate-200 focus:outline-none"
                />

                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-1.5 text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isUrgentSim}
                      onChange={(e) => setIsUrgentSim(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-rose-500 focus:ring-0"
                    />
                    Urgent Flag
                  </label>
                  <button
                    type="submit"
                    disabled={simLoading || !customMsg.trim()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-medium flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" /> Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        </aside>

        {/* Right Content View */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'briefs' ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Client Brief Feed</h2>
                  <p className="text-xs text-slate-400">
                    Grouped by sliding quiet window. No automated messages are ever sent.
                  </p>
                </div>
                <button
                  onClick={() => fetchDashboardData(token)}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {summaries.filter((s) => !selectedChat || s.chatId === selectedChat).length === 0 ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
                  <Clock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">No client briefs for this contact yet.</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Send a simulated burst from the left sidebar to generate a new brief for this contact!
                  </p>
                </div>
              ) : (
                summaries
                  .filter((s) => !selectedChat || s.chatId === selectedChat)
                  .map((s) => (
                  <div
                    key={s.summaryId}
                    className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 transition space-y-4 shadow-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">
                          {s.contactName || (contacts.find((c) => c.chatId === s.chatId)?.displayName) || 'Client'}
                        </span>
                        <span className="text-xs text-slate-400">• {new Date(s.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          s.urgency === 'HIGH' || s.urgency === 'CRITICAL'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {s.urgency} Priority
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 leading-relaxed font-medium">
                      {s.summary}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {s.requirements.length > 0 && (
                        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                          <span className="font-semibold text-emerald-400 block mb-1">Key Requirements</span>
                          <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                            {s.requirements.map((req, i) => (
                              <li key={i}>{req}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {s.deadlines.length > 0 && (
                        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                          <span className="font-semibold text-amber-400 block mb-1">Extracted Deadlines</span>
                          <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                            {s.deadlines.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {s.suggestedReply && (
                      <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5" /> Suggested Reply (Manual Copy Only)
                          </span>
                          <button
                            onClick={() => copyReply(s.summaryId, s.suggestedReply)}
                            className="text-xs flex items-center gap-1 text-emerald-300 hover:text-white px-2 py-0.5 rounded bg-emerald-900/40 hover:bg-emerald-900/80 transition"
                          >
                            {copiedId === s.summaryId ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" /> Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" /> Copy Draft
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-xs text-slate-300 italic">{s.suggestedReply}</p>
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-between border-t border-slate-800/60 text-xs">
                      <button
                        onClick={() => inspectSource(s.summaryId)}
                        className="text-slate-400 hover:text-slate-200 flex items-center gap-1 transition"
                      >
                        <Eye className="w-3.5 h-3.5" /> View original messages ({s.sourceMessageRefs.length})
                      </button>
                      <span className="text-[11px] text-slate-500">
                        Source retained for 7 days per policy
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="text-lg font-bold text-white">Extracted Reminders & Deadlines</h2>
              <p className="text-xs text-slate-400">
                Action items extracted from client bursts. Each item references the original conversation.
              </p>

              {/* Reminder status filter pills */}
              <div className="flex gap-2 pt-2">
                {(['all', 'upcoming', 'completed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setReminderFilter(tab)}
                    className={`text-xs px-3 py-1 rounded-lg capitalize border transition ${
                      reminderFilter === tab
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800 font-semibold'
                        : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="grid gap-3 mt-4">
                {filteredReminders.length === 0 ? (
                  <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
                    <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-400">No {reminderFilter !== 'all' ? reminderFilter : ''} reminders found.</p>
                  </div>
                ) : (
                  filteredReminders.map((r) => (
                    <div
                      key={r.reminderId}
                      className={`p-4 rounded-xl border flex items-center justify-between transition ${
                        r.status === 'completed'
                          ? 'bg-slate-950/60 border-slate-900 opacity-60'
                          : 'bg-slate-900/80 border-slate-800 shadow-md'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold text-sm ${r.status === 'completed' ? 'line-through text-slate-500' : 'text-white'}`}>
                            {r.title}
                          </span>
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                              r.status === 'completed'
                                ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                                : 'bg-amber-950 text-amber-300 border-amber-800'
                            }`}
                          >
                            {r.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{r.description}</p>
                        {r.dateText && (
                          <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
                            <Clock className="w-3.5 h-3.5 text-amber-400" /> Deadline: {r.dateText}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => toggleReminderStatus(r.reminderId, r.status === 'completed' ? 'upcoming' : 'completed')}
                        className={`px-3 py-1.5 rounded-lg border text-xs transition flex items-center gap-1.5 ${
                          r.status === 'completed'
                            ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                            : 'bg-slate-800 hover:bg-emerald-950/70 border-slate-700 hover:border-emerald-800 text-slate-300 hover:text-emerald-300'
                        }`}
                      >
                        <CheckCircle className={`w-3.5 h-3.5 ${r.status === 'completed' ? 'text-emerald-400' : ''}`} />
                        {r.status === 'completed' ? 'Completed' : 'Mark Done'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Source Messages Modal */}
      {inspectingSummaryId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" /> Original Source Messages
              </h3>
              <button
                onClick={() => setInspectingSummaryId(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-2.5">
              {loadingSources ? (
                <p className="text-xs text-slate-400 text-center py-6">Loading source messages...</p>
              ) : sourceMessages.length === 0 ? (
                <p className="text-xs text-amber-400 text-center py-6">
                  Source messages have expired or were cleared per retention policy.
                </p>
              ) : (
                sourceMessages.map((m) => (
                  <div key={m.messageId} className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span className="font-semibold text-slate-300">{m.senderName || m.senderId}</span>
                      <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-slate-200">{m.text}</p>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 text-right">
              <button
                onClick={() => setInspectingSummaryId(