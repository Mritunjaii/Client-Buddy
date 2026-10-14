import React, { useEffect, useState, useMemo } from 'react';
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
  Settings,
  Search,
  Edit3,
  HelpCircle,
  ListChecks,
  BarChart3,
  FileText,
  ExternalLink,
  TrendingUp,
  Users,
  UserPlus,
  Globe,
  CheckSquare,
  PhoneCall,
  Phone,
  Play,
  Pause
} from 'lucide-react';

interface User {
  userId: string;
  email: string;
  name: string;
  whatsappConnected: boolean;
  whatsappPhone?: string;
  monitoringMode?: 'all' | 'selective';
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
  const [activeTab, setActiveTab] = useState<'briefs' | 'reminders' | 'digest'>('briefs');
  const [summaries, setSummaries] = useState<SummaryRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [selectedChat, setSelectedChat] = useState<string>('all');
  const [incomingAlert, setIncomingAlert] = useState<{
    contactName: string;
    text: string;
    chatId: string;
    timestamp: Date;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [urgentAlert, setUrgentAlert] = useState<any>(null);
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);
  const [callAlertData, setCallAlertData] = useState<{
    summaryId: string;
    chatId: string;
    contactName: string;
    urgency: 'CRITICAL';
    reason: string;
    time: Date;
    callResult?: {
      success: boolean;
      provider: string;
      phoneCalled?: string;
      audioBase64?: string;
      message: string;
    };
  } | null>(null);
  const [testingCallAlert, setTestingCallAlert] = useState<boolean>(false);

  // Daily digest state
  interface DailyDigestData {
    date: string;
    metrics: {
      totalBriefsToday: number;
      activeClientsCount: number;
      criticalIncidentsCount: number;
      pendingRemindersCount: number;
      scopeAlertsCount: number;
    };
    standupReport: string;
    criticalIncidents: Array<{ client: string; summary: string; urgency: string; time: string }>;
    upcomingDeadlines: Array<{ title: string; deadline?: string; client?: string }>;
    scopeAlerts: string[];
    clientBreakdown: Record<string, { briefsCount: number; hasCritical: boolean; lastActivity: string }>;
  }
  const [digestData, setDigestData] = useState<DailyDigestData | null>(null);
  const [loadingDigest, setLoadingDigest] = useState(false);
  const [copiedDigest, setCopiedDigest] = useState(false);

  // Contacts state
  interface ContactItem {
    chatId: string;
    displayName: string;
    enabled: boolean;
    isGroup: boolean;
    projectScope?: string;
    preferredTone?: string;
    lastMessageAt?: string | Date;
    lastMessageText?: string;
    lastMessageSender?: string;
  }
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [contactFilter, setContactFilter] = useState<'all' | 'monitored'>('all');
  const [editingContact, setEditingContact] = useState<ContactItem | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  // Helper to format last message timestamp nicely
  const formatLastMessageTime = (val?: string | Date) => {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Sort contact list descending according to the last message sent
  const sortedContacts = useMemo(() => {
    return [...contacts]
      .filter((c) => (contactFilter === 'monitored' ? c.enabled : true))
      .sort((a, b) => {
        const timeA = a.lastMessageAt
          ? new Date(a.lastMessageAt).getTime()
          : (summaries.find((s) => s.chatId === a.chatId)?.createdAt
              ? new Date(summaries.find((s) => s.chatId === a.chatId)!.createdAt).getTime()
              : 0);

        const timeB = b.lastMessageAt
          ? new Date(b.lastMessageAt).getTime()
          : (summaries.find((s) => s.chatId === b.chatId)?.createdAt
              ? new Date(summaries.find((s) => s.chatId === b.chatId)!.createdAt).getTime()
              : 0);

        if (timeB !== timeA) return timeB - timeA;
        return (a.displayName || a.chatId).localeCompare(b.displayName || b.chatId);
      });
  }, [contacts, contactFilter, summaries]);

  // Add new selective contact state
  const [addingContactModal, setAddingContactModal] = useState(false);
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactScope, setNewContactScope] = useState('');
  const [newContactTone, setNewContactTone] = useState('');
  const [addingContactLoading, setAddingContactLoading] = useState(false);

  // Brief search and urgency filter state
  const [briefSearchQuery, setBriefSearchQuery] = useState('');
  const [briefUrgencyFilter, setBriefUrgencyFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'>('ALL');
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editedReplyText, setEditedReplyText] = useState<string>('');

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
    });

    socket.on('alert:call', (callData) => {
      setCallAlertData(callData);
      if (callData.callResult?.audioBase64) {
        try {
          const audio = new Audio(`data:audio/mpeg;base64,${callData.callResult.audioBase64}`);
          audio.play().catch(console.error);
        } catch (e) {
          console.error(e);
        }
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

    socket.on('message:incoming', (data: { message: any; batchId: string; contactName?: string }) => {
      setIncomingAlert({
        contactName: data.contactName || data.message.senderName || 'Client',
        text: data.message.text,
        chatId: data.message.chatId,
        timestamp: new Date(),
      });
      // Auto-refresh contacts so any new active contact appears immediately in sidebar
      fetch(`${BACKEND_URL}/api/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.contacts) setContacts(d.contacts);
        })
        .catch(console.error);
    });

    socket.on('contacts:updated', () => {
      fetch(`${BACKEND_URL}/api/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.contacts) setContacts(d.contacts);
        })
        .catch(console.error);
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

  const fetchDailyDigest = async () => {
    if (!token) return;
    setLoadingDigest(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/digest/daily`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDigestData(data);
      }
    } catch (e) {
      console.error('Error fetching daily digest:', e);
    } finally {
      setLoadingDigest(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'digest' && token) {
      fetchDailyDigest();
    }
  }, [activeTab, token]);

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

  const updateContactProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact || !token) return;
    setSavingContact(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts/${editingContact.chatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: editingContact.displayName,
          enabled: editingContact.enabled,
          projectScope: editingContact.projectScope,
          preferredTone: editingContact.preferredTone,
        }),
      });
      if (res.ok) {
        setContacts((prev) =>
          prev.map((c) => (c.chatId === editingContact.chatId ? editingContact : c))
        );
        setEditingContact(null);
      }
    } catch (err) {
      console.error('Failed to update contact profile:', err);
    } finally {
      setSavingContact(false);
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

  const filteredSummaries = summaries.filter((s) => {
    if (selectedChat && selectedChat !== 'all' && s.chatId !== selectedChat) return false;
    if (briefUrgencyFilter !== 'ALL' && s.urgency !== briefUrgencyFilter) return false;
    if (briefSearchQuery.trim()) {
      const q = briefSearchQuery.toLowerCase();
      const matchText = (s.summary + ' ' + (s.requirements || []).join(' ') + ' ' + (s.deadlines || []).join(' ')).toLowerCase();
      if (!matchText.includes(q)) return false;
    }
    return true;
  });

  const downloadIcsReminder = (reminder: ReminderRecord) => {
    const title = reminder.title;
    const desc = `${reminder.description || ''}\nExtracted by Client Buddy for ${reminder.contactName || 'Client'}`;
    const nowStr = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const startStr = tomorrow.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const endStr = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Client Buddy//Reminder Sync//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${reminder.reminderId}@clientbuddy.local`,
      `DTSTAMP:${nowStr}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:${title.replace(/[\r\n]+/g, ' ')}`,
      `DESCRIPTION:${desc.replace(/[\r\n]+/g, ' ')}`,
      `STATUS:CONFIRMED`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reminder-${reminder.reminderId.slice(0, 8)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleMonitoringMode = async (mode: 'all' | 'selective') => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/user/monitoring-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        setCurrentUser((prev) => (prev ? { ...prev, monitoringMode: mode } : prev));
      }
    } catch (err) {
      console.error('Failed to update monitoring mode:', err);
    }
  };

  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newContactPhone.trim()) return;
    setAddingContactLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phoneOrChatId: newContactPhone,
          displayName: newContactName,
          projectScope: newContactScope,
          preferredTone: newContactTone,
        }),
      });
      if (res.ok) {
        setAddingContactModal(false);
        setNewContactPhone('');
        setNewContactName('');
        setNewContactScope('');
        setNewContactTone('');
        // Refresh contacts
        const cRes = await fetch(`${BACKEND_URL}/api/contacts`, { headers: { Authorization: `Bearer ${token}` } });
        const cData = await cRes.json();
        if (cData.contacts) setContacts(cData.contacts);
      }
    } catch (err) {
      console.error('Failed to add contact:', err);
    } finally {
      setAddingContactLoading(false);
    }
  };

  const deleteContact = async (chatId: string) => {
    if (!confirm('Remove this contact from your monitored contacts list?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/contacts/${encodeURIComponent(chatId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setContacts((prev) => prev.filter((c) => c.chatId !== chatId));
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  const triggerTestCallAlert = async () => {
    if (!token) return;
    setTestingCallAlert(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/alerts/test-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contactName: 'Aarav Sharma',
          reason: 'Production checkout payment gateway outage reported.',
        }),
      });
      const data = await res.json();
      console.log('Test call alert response:', data);
    } catch (e) {
      console.error('Failed to trigger test call alert:', e);
    } finally {
      setTestingCallAlert(false);
    }
  };

  const sendSimulatedBurst = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMsg.trim() || !token) return;
    setSimLoading(true);
    const targetChat = selectedChat && selectedChat !== 'all' ? selectedChat : (contacts[0]?.chatId || 'test_contact');
    const matchedContact = contacts.find((c) => c.chatId === targetChat);
    try {
      const res = await fetch(`${BACKEND_URL}/api/mock/incoming-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          chatId: targetChat,
          senderName: matchedContact?.displayName || 'Test Client',
          text: customMsg,
          isUrgent: isUrgentSim,
        }),
      });
      const data = await res.json();
      if (data.ignored) {
        alert(data.message);
      }
      setCustomMsg('');
    } catch (err) {
      console.error(err);
    } finally {
      setSimLoading(false);
    }
  };

  const flushBatchNow = async () => {
    if (!token) return;
    const targetChat = selectedChat && selectedChat !== 'all' ? selectedChat : undefined;
    try {
      await fetch(`${BACKEND_URL}/api/mock/flush-now`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chatId: targetChat }),
      });
    } catch (err) {
      console.error(err);
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
      a.download = `clientbuddy-export-${new Date().toISOString().slice(0, 10)}.json`;
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
            onClick={triggerTestCallAlert}
            disabled={testingCallAlert}
            title="Test ElevenLabs & Outbound Phone Call Alert"
            className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-800 bg-rose-950/80 hover:bg-rose-900 text-rose-300 font-medium transition flex items-center gap-1.5"
          >
            <PhoneCall className={`w-3.5 h-3.5 text-rose-400 ${testingCallAlert ? 'animate-bounce' : ''}`} />
            {testingCallAlert ? 'Dialing Call...' : 'Test 11Labs Call'}
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

      {/* ElevenLabs Critical Call Alert Banner */}
      {callAlertData && (
        <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-rose-950 border-b-2 border-rose-600 px-6 py-3.5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center space-x-3 text-rose-100">
            <div className="p-2.5 rounded-full bg-rose-600/30 border border-rose-500 animate-bounce shrink-0">
              <PhoneCall className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-extrabold tracking-wider bg-rose-600 text-white px-2 py-0.5 rounded shadow">
                  🚨 Outbound Phone Call Alert (ElevenLabs)
                </span>
                <span className="text-xs text-rose-300 font-medium">
                  Destination: <strong className="text-white">{callAlertData.callResult?.phoneCalled || '+918091983263'}</strong>
                </span>
              </div>
              <p className="text-sm font-semibold text-white mt-1">
                Emergency from {callAlertData.contactName}: {callAlertData.reason}
              </p>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {callAlertData.callResult?.message}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
            {callAlertData.callResult?.audioBase64 && (
              <button
                onClick={() => {
                  const audio = new Audio(`data:audio/mpeg;base64,${callAlertData.callResult!.audioBase64}`);
                  audio.play();
                }}
                className="px-3 py-1.5 bg-rose-800/90 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
              >
                <Play className="w-3.5 h-3.5 text-white" /> Replay Voice Briefing
              </button>
            )}
            <button
              onClick={() => setCallAlertData(null)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition"
            >
              Dismiss Call Alert
            </button>
          </div>
        </div>
      )}

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

      {/* Live Message Ingest Notification Banner */}
      {incomingAlert && (
        <div className="bg-emerald-950/90 border-b border-emerald-800 px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span>
              <strong>Live Message Received</strong> from <strong className="text-white">{incomingAlert.contactName}</strong>: &ldquo;{incomingAlert.text}&rdquo; <span className="text-emerald-400 font-mono text-[11px]">(Quiet window active)</span>
            </span>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              onClick={async () => {
                try {
                  await fetch(`${BACKEND_URL}/api/mock/flush-now`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ chatId: incomingAlert.chatId }),
                  });
                  setIncomingAlert(null);
                } catch (e) {
                  console.error(e);
                }
              }}
              className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition text-xs flex items-center gap-1 shadow-sm"
            >
              <Clock className="w-3 h-3" /> Analyze Now (Skip 2-min Wait)
            </button>
            <button
              onClick={() => setIncomingAlert(null)}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 border-r border-slate-800 bg-slate-900/40 flex flex-col">
          <div className="p-4 border-b border-slate-800">
            <div className="grid grid-cols-3 rounded-lg bg-slate-800/80 p-1 border border-slate-700 text-xs font-medium gap-1">
              <button
                onClick={() => setActiveTab('briefs')}
                className={`py-1.5 rounded-md flex items-center justify-center gap-1 transition text-[11px] ${
                  activeTab === 'briefs' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquare className="w-3 h-3" />
                Briefs
              </button>
              <button
                onClick={() => setActiveTab('reminders')}
                className={`py-1.5 rounded-md flex items-center justify-center gap-1 transition text-[11px] ${
                  activeTab === 'reminders' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-3 h-3" />
                Tasks ({reminders.length})
              </button>
              <button
                onClick={() => setActiveTab('digest')}
                className={`py-1.5 rounded-md flex items-center justify-center gap-1 transition text-[11px] ${
                  activeTab === 'digest' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="w-3 h-3" />
                Digest
              </button>
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            {/* Ingest Mode Card */}
            <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Ingest Mode
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                  (currentUser?.monitoringMode || 'all') === 'all'
                    ? 'bg-blue-950/70 text-blue-300 border-blue-800'
                    : 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                }`}>
                  {(currentUser?.monitoringMode || 'all') === 'all' ? 'All Contacts (Open)' : 'Selective (Whitelist)'}
                </span>
              </div>

              <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => toggleMonitoringMode('all')}
                  className={`py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1 font-medium ${
                    (currentUser?.monitoringMode || 'all') === 'all'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  All Contacts
                </button>
                <button
                  type="button"
                  onClick={() => toggleMonitoringMode('selective')}
                  className={`py-1.5 px-2 rounded-lg text-center transition flex items-center justify-center gap-1 font-medium ${
                    (currentUser?.monitoringMode || 'all') === 'selective'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <CheckSquare className="w-3 h-3" />
                  Selective Only
                </button>
              </div>

              <p className="text-[10px] text-slate-400 leading-relaxed">
                {(currentUser?.monitoringMode || 'all') === 'all'
                  ? 'Ingests messages from anyone who contacts you on WhatsApp.'
                  : 'Ingests bursts ONLY from enabled contacts below. Unregistered senders are dropped.'}
              </p>

              <button
                type="button"
                onClick={() => setAddingContactModal(true)}
                className="w-full py-1.5 px-2.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/80 text-emerald-300 hover:text-white text-xs transition flex items-center justify-center gap-1.5 font-medium shadow-sm"
              >
                <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
                <span>+ Add New Contact</span>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-xs uppercase font-bold text-slate-500 tracking-wider">
                Contacts List
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
              <div
                onClick={() => setSelectedChat('all')}
                className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                  selectedChat === 'all'
                    ? 'bg-slate-800/90 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-semibold text-xs text-white">All Conversations</span>
                </div>
                <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                  {summaries.length}
                </span>
              </div>

              {sortedContacts.length === 0 ? (
                <div className="p-4 text-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-500">
                  <Users className="w-5 h-5 mx-auto mb-1.5 text-slate-600" />
                  <p>No contacts found yet.</p>
                  <p className="text-[10px] text-slate-600 mt-1">
                    {(currentUser?.monitoringMode || 'all') === 'all'
                      ? 'Incoming messages will automatically register contacts here.'
                      : 'Click "+ Add New Contact" above to add contacts to monitor.'}
                  </p>
                </div>
              ) : (
                sortedContacts.map((contact) => {
                  const lastTimeStr = formatLastMessageTime(contact.lastMessageAt);
                  return (
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-xs text-white truncate">{contact.displayName}</span>
                          {contact.isGroup && (
                            <span className="text-[9px] bg-slate-800 text-slate-400 px-1 rounded flex-shrink-0">Group</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {lastTimeStr && (
                            <span className="text-[10px] text-slate-500 mr-1 font-mono">
                              {lastTimeStr}
                            </span>
                          )}
                          <a
                            href={`https://web.whatsapp.com/send?phone=${contact.chatId.replace(/[^0-9]/g, '') || ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open conversation in WhatsApp Web"
                            className="p-1 rounded text-slate-500 hover:text-emerald-400 hover:bg-slate-800 transition"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingContact(contact);
                            }}
                            title="Configure client scope & tone profile"
                            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
                          >
                            <Settings className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteContact(contact.chatId);
                            }}
                            title="Remove from contacts list"
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
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
                      {contact.lastMessageText && (
                        <p className="text-[11px] text-slate-400 mt-1 truncate">
                          {contact.lastMessageSender ? <span className="text-slate-500">{contact.lastMessageSender}: </span> : null}
                          {contact.lastMessageText}
                        </p>
                      )}
                      {contact.projectScope && (
                        <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                          Scope: {contact.projectScope}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Test Simulation Controls (Temporarily Commented Out for Live Mode)
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

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={flushBatchNow}
                    className="w-full text-center py-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-[11px] text-amber-300 hover:text-amber-200 transition flex items-center justify-center gap-1.5 font-medium"
                  >
                    <Clock className="w-3 h-3 text-amber-400" /> Process Burst Now (Skip Wait)
                  </button>
                </div>
              </form>
            </div>
            */}
          </div>
        </aside>

        {/* Right Content View */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'briefs' ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">Client Brief Feed</h2>
                  <p className="text-xs text-slate-400">
                    Grouped by sliding quiet window. No automated messages are ever sent.
                  </p>
                </div>
                <button
                  onClick={() => fetchDashboardData(token)}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {/* Search and Urgency Filter Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={briefSearchQuery}
                    onChange={(e) => setBriefSearchQuery(e.target.value)}
                    placeholder="Search briefs by keyword (e.g. checkout, dark mode, TestFlight)..."
                    className="w-full bg-slate-900/80 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl pl-8 pr-3 py-2 focus:outline-none"
                  />
                  {briefSearchQuery && (
                    <button
                      onClick={() => setBriefSearchQuery('')}
                      className="absolute right-2.5 top-2 text-xs text-slate-500 hover:text-slate-300"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 text-xs">
                  {(['ALL', 'CRITICAL', 'HIGH', 'NORMAL'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setBriefUrgencyFilter(lvl)}
                      className={`px-2.5 py-1.5 rounded-lg font-medium transition text-[11px] border ${
                        briefUrgencyFilter === lvl
                          ? lvl === 'CRITICAL'
                            ? 'bg-rose-950 text-rose-300 border-rose-800'
                            : lvl === 'HIGH'
                            ? 'bg-amber-950 text-amber-300 border-amber-800'
                            : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {lvl === 'ALL' ? 'All Priorities' : lvl}
                    </button>
                  ))}
                </div>
              </div>

              {filteredSummaries.length === 0 ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
                  <Clock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
                  <p className="text-sm text-slate-400">
                    {briefSearchQuery || briefUrgencyFilter !== 'ALL'
                      ? 'No client briefs match your search/filter criteria.'
                      : 'No client briefs for this contact yet.'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {/* Send a simulated burst from the left sidebar to generate a new brief for this contact! */}
                    Incoming WhatsApp messages from this contact will be automatically captured and briefed here.
                  </p>
                </div>
              ) : (
                filteredSummaries.map((s) => (
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

                    {/* Requirements and Deadlines */}
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

                    {/* Action Items & Scope Clarifications */}
                    {((s.actionItems && s.actionItems.length > 0) || (s.openQuestions && s.openQuestions.length > 0)) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        {s.actionItems && s.actionItems.length > 0 && (
                          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                            <span className="font-semibold text-sky-400 block mb-1 flex items-center gap-1">
                              <ListChecks className="w-3.5 h-3.5" /> Action Items
                            </span>
                            <ul className="list-disc list-inside space-y-0.5 text-slate-300">
                              {s.actionItems.map((item, i) => (
                                <li key={i}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {s.openQuestions && s.openQuestions.length > 0 && (
                          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                            <span className="font-semibold text-purple-400 block mb-1 flex items-center gap-1">
                              <HelpCircle className="w-3.5 h-3.5" /> Scope Notes & Clarifications
                            </span>
                            <ul className="space-y-1 text-slate-300">
                              {s.openQuestions.map((q, i) => (
                                <li
                                  key={i}
                                  className={`flex items-start gap-1.5 ${
                                    q.toLowerCase().includes('scope alert') || q.toLowerCase().includes('scope check')
                                      ? 'text-amber-300 font-medium'
                                      : ''
                                  }`}
                                >
                                  {(q.toLowerCase().includes('scope alert') || q.toLowerCase().includes('scope check')) && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                  )}
                                  <span>{q}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Suggested Reply Draft */}
                    {s.suggestedReply && (
                      <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5" /> Suggested Reply (Manual Copy Only)
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (editingReplyId === s.summaryId) {
                                  setEditingReplyId(null);
                                } else {
                                  setEditingReplyId(s.summaryId);
                                  setEditedReplyText(s.suggestedReply);
                                }
                              }}
                              className="text-xs flex items-center gap-1 text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded bg-slate-800/60 transition"
                            >
                              <Edit3 className="w-3 h-3" /> {editingReplyId === s.summaryId ? 'Done' : 'Edit Draft'}
                            </button>
                            <button
                              onClick={() => copyReply(s.summaryId, editingReplyId === s.summaryId ? editedReplyText : s.suggestedReply)}
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
                        </div>
                        {editingReplyId === s.summaryId ? (
                          <textarea
                            rows={3}
                            value={editedReplyText}
                            onChange={(e) => setEditedReplyText(e.target.value)}
                            className="w-full text-xs p-2 rounded-lg bg-slate-950 border border-emerald-800 text-slate-200 focus:outline-none"
                          />
                        ) : (
                          <p className="text-xs text-slate-300 italic">{s.suggestedReply}</p>
                        )}
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
          ) : activeTab === 'reminders' ? (
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadIcsReminder(r)}
                          title="Download iCalendar (.ics) file to sync with Google / Apple / Outlook Calendar"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-755 text-slate-400 hover:text-slate-200 text-xs transition flex items-center gap-1"
                        >
                          <Download className="w-3.5 h-3.5 text-amber-400" />
                          <span className="hidden sm:inline">Add to Calendar</span>
                        </button>
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
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Executive Daily Digest View */
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-emerald-400" /> Executive Daily Digest & Standup Briefing
                  </h2>
                  <p className="text-xs text-slate-400">
                    High-level agency overview for {digestData?.date || new Date().toISOString().slice(0, 10)}. AI synthesized for fast morning reviews.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchDailyDigest}
                    disabled={loadingDigest}
                    className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingDigest ? 'animate-spin' : ''}`} /> Refresh Digest
                  </button>
                  {digestData?.standupReport && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(digestData.standupReport);
                        setCopiedDigest(true);
                        setTimeout(() => setCopiedDigest(false), 2000);
                      }}
                      className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition shadow-sm"
                    >
                      {copiedDigest ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-200" /> Copied Standup!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy Standup
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {loadingDigest && !digestData ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
                  <RefreshCw className="w-8 h-8 text-slate-600 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-slate-400">Compiling executive briefing metrics...</p>
                </div>
              ) : !digestData ? (
                <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
                  <p className="text-sm text-slate-400">No activity logged today yet. Burst client messages to generate briefing.</p>
                </div>
              ) : (
                <>
                  {/* KPI Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Briefs Today</span>
                      <span className="text-2xl font-bold text-white mt-1">{digestData.metrics.totalBriefsToday}</span>
                      <span className="text-[10px] text-slate-500 mt-1">Processed batches</span>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Active Clients</span>
                      <span className="text-2xl font-bold text-emerald-400 mt-1">{digestData.metrics.activeClientsCount}</span>
                      <span className="text-[10px] text-slate-500 mt-1">Engaged today</span>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Critical Events</span>
                      <span className={`text-2xl font-bold mt-1 ${digestData.metrics.criticalIncidentsCount > 0 ? 'text-red-400' : 'text-slate-300'}`}>
                        {digestData.metrics.criticalIncidentsCount}
                      </span>
                      <span className="text-[10px] text-slate-500 mt-1">Requires priority triage</span>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Active Deadlines</span>
                      <span className="text-2xl font-bold text-amber-400 mt-1">{digestData.metrics.pendingRemindersCount}</span>
                      <span className="text-[10px] text-slate-500 mt-1">Pending reminders</span>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col justify-between col-span-2 sm:col-span-1">
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Scope Advisories</span>
                      <span className={`text-2xl font-bold mt-1 ${digestData.metrics.scopeAlertsCount > 0 ? 'text-amber-300' : 'text-slate-300'}`}>
                        {digestData.metrics.scopeAlertsCount}
                      </span>
                      <span className="text-[10px] text-slate-500 mt-1">Contract checks</span>
                    </div>
                  </div>

                  {/* Standup Briefing Card */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white font-semibold text-sm">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        Automated Daily Standup Briefing
                      </div>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                        Ready to Share
                      </span>
                    </div>
                    <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-4 text-xs font-mono text-slate-300 whitespace-pre-line leading-relaxed">
                      {digestData.standupReport}
                    </div>
                  </div>

                  {/* 2-Column Section: Critical Incidents & Upcoming Deadlines */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Critical Incidents Card */}
                    <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> High-Urgency Incidents ({digestData.criticalIncidents.length})
                      </h3>
                      {digestData.criticalIncidents.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 rounded-lg bg-slate-950/40 border border-slate-800/50">
                          <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto mb-1 opacity-70" />
                          Zero critical incidents. All systems nominal.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {digestData.criticalIncidents.map((inc, i) => (
                            <div key={i} className="p-3 rounded-lg bg-red-950/20 border border-red-900/40 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-red-300">{inc.client}</span>
                                <span className="text-[10px] text-red-400 uppercase font-bold px-1.5 py-0.5 rounded bg-red-950/60 border border-red-800">
                                  {inc.urgency}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300">{inc.summary}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Upcoming Deadlines Card */}
                    <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-amber-400" /> Priority Deadlines ({digestData.upcomingDeadlines.length})
                      </h3>
                      {digestData.upcomingDeadlines.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500 rounded-lg bg-slate-950/40 border border-slate-800/50">
                          <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto mb-1 opacity-70" />
                          No active deadlines currently outstanding.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {digestData.upcomingDeadlines.map((dl, i) => (
                            <div key={i} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1 flex items-center justify-between">
                              <div>
                                <span className="font-semibold text-xs text-slate-200 block">{dl.title}</span>
                                {dl.client && <span className="text-[11px] text-slate-400">{dl.client}</span>}
                              </div>
                              {dl.deadline && (
                                <span className="text-[10px] font-medium text-amber-300 px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/60">
                                  {dl.deadline}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Scope Creep Advisories (if any) */}
                  {digestData.scopeAlerts.length > 0 && (
                    <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/50 space-y-2">
                      <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Contract Scope Advisories ({digestData.scopeAlerts.length})
                      </h3>
                      <div className="space-y-1.5">
                        {digestData.scopeAlerts.map((alert, i) => (
                          <div key={i} className="text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/40 rounded-lg p-2.5">
                            {alert}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Client Activity Breakdown */}
                  <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-emerald-400" /> Client Volume & Status Breakdown
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {Object.entries(digestData.clientBreakdown).map(([clientName, stat]) => (
                        <div key={clientName} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                              {clientName}
                              {stat.hasCritical && (
                                <span className="w-2 h-2 rounded-full bg-red-400 inline-block animate-pulse" title="High Urgency Activity" />
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500">
                              {stat.briefsCount} brief{stat.briefsCount > 1 ? 's' : ''} processed
                            </span>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                            stat.hasCritical ? 'bg-red-950 text-red-300 border-red-800' : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {stat.hasCritical ? 'Critical' : 'Normal'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
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
                onClick={() => setInspectingSummaryId(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Contact Context Profile Modal */}
      {editingContact && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">
                  Client Context Profile: {editingContact.displayName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingContact(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={updateContactProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Client Display Name
                </label>
                <input
                  type="text"
                  value={editingContact.displayName}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, displayName: e.target.value })
                  }
                  required
                  placeholder="e.g., Aarav Sharma"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Monitoring Status
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingContact({ ...editingContact, enabled: true })
                    }
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                      editingContact.enabled
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    Monitored (Active Analysis)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingContact({ ...editingContact, enabled: false })
                    }
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                      !editingContact.enabled
                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    Muted (Ignored)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Agreed Project Scope
                </label>
                <textarea
                  rows={3}
                  value={editingContact.projectScope || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, projectScope: e.target.value })
                  }
                  placeholder="e.g. Next.js web application redesign, 3 milestone reviews, out-of-scope backend migrations..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none resize-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Injected into Gemma inference to flag scope creep and classify actionable deliverables.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Preferred Reply Tone
                </label>
                <input
                  type="text"
                  value={editingContact.preferredTone || ''}
                  onChange={(e) =>
                    setEditingContact({ ...editingContact, preferredTone: e.target.value })
                  }
                  placeholder="e.g. Friendly & concise, Formal enterprise, Technical & direct"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Gemma customizes manual reply drafts to match this communication style.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingContact(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingContact}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg transition"
                >
                  {savingContact ? 'Saving...' : 'Save Context Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Add New Selective Contact Modal */}
      {addingContactModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">
                  Add Contact for Selective Monitoring
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAddingContactModal(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              In <strong>Selective Mode</strong>, incoming WhatsApp bursts will only be processed for contacts registered in your list.
            </p>

            <form onSubmit={handleAddContactSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Phone Number or WhatsApp Chat ID <span className="text-emerald-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210 or 919876543210"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Client Display Name
                </label>
                <input
                  type="text"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins (Fintech Client)"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2.5 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Agreed Project Scope (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newContactScope}
                  onChange={(e) => setNewContactScope(e.target.value)}
                  placeholder="e.g. MVP React Native App, Stripe integration..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Preferred Tone (Optional)
                </label>
                <input
                  type="text"
                  value={newContactTone}
                  onChange={(e) => setNewContactTone(e.target.value)}
                  placeholder="e.g. Concise, Professional, Friendly"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 text-xs text-slate-200 rounded-xl px-3 py-2 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingContactModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingContactLoading}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg transition flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {addingContactLoading ? 'Adding...' : 'Add & Monitor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
