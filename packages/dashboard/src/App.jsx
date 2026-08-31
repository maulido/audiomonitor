import React, { useState, useEffect, useRef, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white', background: 'red', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Something went wrong in Dashboard App.jsx</h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            <summary>Click for error details</summary>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children; 
  }
}

import './style.css';
import DashboardClient from './core/DashboardClient';

const SERVER_URL = window.location.port.startsWith('517') ? `http://${window.location.hostname}:4000` : window.location.origin;

// Cache global untuk menyimpan durasi audio yang telah didecode (menghemat CPU & network)
const audioDurationCache = new Map();
const setAudioDurationCache = (url, duration) => {
  if (audioDurationCache.size >= 500) {
    const firstKey = audioDurationCache.keys().next().value;
    if (firstKey) audioDurationCache.delete(firstKey);
  }
  audioDurationCache.set(url, duration);
};

const getMediaUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${SERVER_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

let sharedAudioContext = null;
function getSharedAudioContext() {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('AudioContext not available:', e);
    }
  }
  return sharedAudioContext;
}

function App() {
  const [agents, setAgents] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [dialogParams, setDialogParams] = useState(null);
  const [dialogInputValue, setDialogInputValue] = useState('');

  const customAlert = (message, title = 'Notifikasi') => {
    return new Promise((resolve) => {
      setDialogParams({
        type: 'alert', title, message,
        onConfirm: () => { setDialogParams(null); resolve(true); },
        onCancel: () => { setDialogParams(null); resolve(false); }
      });
    });
  };

  const customConfirm = (message, title = 'Konfirmasi') => {
    return new Promise((resolve) => {
      setDialogParams({
        type: 'confirm', title, message,
        onConfirm: () => { setDialogParams(null); resolve(true); },
        onCancel: () => { setDialogParams(null); resolve(false); }
      });
    });
  };

  const customPrompt = (message, title = 'Input Diperlukan', defaultValue = '', isPassword = false) => {
    setDialogInputValue(defaultValue);
    return new Promise((resolve) => {
      setDialogParams({
        type: 'prompt', title, message, isPassword,
        onConfirm: (val) => { setDialogParams(null); resolve(val); },
        onCancel: () => { setDialogParams(null); resolve(null); }
      });
    });
  };

  const [configModalAgent, setConfigModalAgent] = useState(null);
  const [remoteConfig, setRemoteConfig] = useState({
    agentName: '',
    micDriverName: '',
    obsSourceName: '',
    speakingThreshold: 10,
    noiseGate: 15,
    clippingThreshold: 95,
    silenceTimeoutSec: 15,
    deadMicTimeoutSec: 30,
    obsMuteTimeoutSec: 3,
    clippingDurationSec: 3,
    obsSyncStreaming: false,
    obsSyncRecording: false,
    autoRecoveryUnmute: true,
    telemetryInterval: 500
  });
  const [editingName, setEditingName] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [isCompactMode, setIsCompactMode] = useState(() => localStorage.getItem('isCompactMode') === 'true');
  useEffect(() => { localStorage.setItem('isCompactMode', isCompactMode); }, [isCompactMode]);
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Logs View State
  const [currentView, setCurrentView] = useState('live'); // 'live', 'logs', 'records', 'settings'
  const [logs, setLogs] = useState([]);
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [playingSession, setPlayingSession] = useState(null); // { folderName, pcName, dateStr, timeStr, parts: [] }
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [partDurations, setPartDurations] = useState([]);
  const [localCurrentTime, setLocalCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef(null);
  const pendingSeekOffsetRef = useRef(null);
  const [recordPcFilter, setRecordPcFilter] = useState('');
  const [recordStartDate, setRecordStartDate] = useState('');
  const [recordEndDate, setRecordEndDate] = useState('');
  const [recordStatusFilter, setRecordStatusFilter] = useState('all'); // 'all', 'ready', 'none', 'alert'
  const [recordSortOrder, setRecordSortOrder] = useState('newest'); // 'newest', 'oldest', 'size_desc', 'duration_desc'
  const [collapsedPcs, setCollapsedPcs] = useState({}); // { [pcName]: boolean }
  const [pcSessionPages, setPcSessionPages] = useState({}); // { [pcName]: number }
  const [sessionsPerPage, setSessionsPerPage] = useState(5); // 5, 10, 25, 50, 0 (all)
  const [recordViewLayout, setRecordViewLayout] = useState('detailed'); // 'detailed' | 'compact'
  const [systemLogs, setSystemLogs] = useState('');
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [isSavingTelegram, setIsSavingTelegram] = useState(false);
  const [isSavingWhisper, setIsSavingWhisper] = useState(false);
  const [isSavingRetention, setIsSavingRetention] = useState(false);
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [newKeywordInput, setNewKeywordInput] = useState('');
  const [dangerConfirmText, setDangerConfirmText] = useState('');
  const [isUpdatingServer, setIsUpdatingServer] = useState(false);
  const [isUploadingServerInstaller, setIsUploadingServerInstaller] = useState(false);

  // Helper untuk format tanggal lokal (WIB / UTC+7 aman tanpa pergeseran hari)
  const getLocalDateStr = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper format durasi detik ke teks rapi (contoh: 16 dtk, 10m 00s, 1j 24m)
  const formatDurationText = (seconds) => {
    if (!seconds || seconds <= 0 || isNaN(seconds)) return '0 dtk';
    const s = Math.round(seconds);
    if (s < 60) return `${s} dtk`;
    const m = Math.floor(s / 60);
    const remS = s % 60;
    if (m < 60) return remS > 0 ? `${m}m ${String(remS).padStart(2, '0')}s` : `${m} menit`;
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return remM > 0 ? `${h}j ${String(remM).padStart(2, '0')}m` : `${h} jam`;
  };

  // Helper estimasi / kalkulasi durasi rekaman sesi
  const calculateSessionDuration = (session) => {
    if (!session) return 0;

    // 1. Total dari durasi transkrip jika semua part sudah ditranskrip
    const sumPartDurations = (session.parts || []).reduce((acc, p) => acc + (p.transcriptDuration || 0), 0);
    if (sumPartDurations > 0 && session.parts && session.parts.every(p => p.transcriptDuration > 0)) {
      return sumPartDurations;
    }

    // 2. Dari selisih jam mulai dan selesai (untuk sesi yang sudah selesai)
    if (session.startTime && session.endTime && session.isCompleted) {
      const startParts = session.startTime.replace(/-/g, ':').split(':').map(Number);
      const endParts = session.endTime.replace(/-/g, ':').split(':').map(Number);
      if (startParts.length >= 2 && endParts.length >= 2 && !isNaN(startParts[0]) && !isNaN(endParts[0])) {
        const startSec = (startParts[0] || 0) * 3600 + (startParts[1] || 0) * 60 + (startParts[2] || 0);
        let endSec = (endParts[0] || 0) * 3600 + (endParts[1] || 0) * 60 + (endParts[2] || 0);
        if (endSec < startSec) endSec += 24 * 3600; // lewat tengah malam (overnight)
        const diffSec = endSec - startSec;
        if (diffSec > 0) return diffSec;
      }
    }

    // 3. Untuk sesi yang sedang berlangsung (LIVE / Berlanjut...)
    if (!session.isCompleted && session.startTime && session.dateStr) {
      try {
        const startParts = session.startTime.replace(/-/g, ':').split(':').map(Number);
        const dateParts = session.dateStr.split('-').map(Number);
        if (dateParts.length === 3 && startParts.length >= 2 && !isNaN(startParts[0]) && !isNaN(dateParts[0])) {
          const startDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], startParts[0], startParts[1], startParts[2] || 0);
          const now = new Date();
          const elapsedSec = Math.round((now.getTime() - startDate.getTime()) / 1000);
          if (elapsedSec > 0 && elapsedSec < 7 * 86400) {
            return elapsedSec;
          }
        }
      } catch (e) {}
    }

    // 4. Hitung dari potongan part (estimasi per-part berdasar ukuran ~16KB/s Opus WebM)
    if (session.parts && session.parts.length > 0) {
      const partsDuration = session.parts.reduce((acc, p) => {
        if (p.transcriptDuration && p.transcriptDuration > 0) return acc + p.transcriptDuration;
        return acc + Math.max(1, Math.round((p.size || 0) / 16000));
      }, 0);
      if (partsDuration > 0) return partsDuration;
    }

    // 5. Fallback estimasi dari total ukuran WebM Opus (~16 KB/s / 128 kbps)
    if (session.totalSize > 0) {
      return Math.max(1, Math.round(session.totalSize / 16000));
    }
    return 0;
  };

  // Incident Filter State
  const getDefaultStartDate = () => { const d = new Date(); d.setDate(d.getDate() - 7); return getLocalDateStr(d); };
  const [incidentStartDate, setIncidentStartDate] = useState(getDefaultStartDate());
  const [incidentEndDate, setIncidentEndDate] = useState(getLocalDateStr());
  const [incidentPcFilter, setIncidentPcFilter] = useState('');
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('');
  const [incidentPcNames, setIncidentPcNames] = useState([]);
  const [incidentPage, setIncidentPage] = useState(1);
  const logsPerPage = 15;

  useEffect(() => {
    const totalPages = Math.ceil(logs.length / logsPerPage) || 1;
    if (incidentPage > totalPages) {
      setIncidentPage(totalPages);
    }
  }, [logs.length]);
  
  
  // Settings State
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramInterval, setTelegramInterval] = useState(60);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [newPinInput, setNewPinInput] = useState('');
  const [isMonitoringActive, setIsMonitoringActive] = useState(true);
  const [enableBeep, setEnableBeep] = useState(() => {
    const saved = localStorage.getItem('enableBeep');
    return saved !== null ? saved === 'true' : true; // Default true
  });

  // Update Management State
  const [agentUpdateProgress, setAgentUpdateProgress] = useState({});
  const [serverUpdateInfo, setServerUpdateInfo] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [githubReleaseInfo, setGithubReleaseInfo] = useState(null);
  const [isCheckingGithub, setIsCheckingGithub] = useState(false);
  const [isDownloadingGithub, setIsDownloadingGithub] = useState(false);
  const [isUploadingInstaller, setIsUploadingInstaller] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Whisper Speech-to-Text State
  const [transcriptionConfig, setTranscriptionConfig] = useState({
    enabled: false,
    apiUrl: '',
    apiKey: '',
    language: 'id',
    autoTranscribe: true,
    alertKeywords: []
  });
  const [alertKeywordsInput, setAlertKeywordsInput] = useState('');
  const [isTestingWhisperApi, setIsTestingWhisperApi] = useState(false);
  const [whisperTestResult, setWhisperTestResult] = useState(null);
  const [activeTranscriptModal, setActiveTranscriptModal] = useState(null);
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('');
  const [transcriptSearchResults, setTranscriptSearchResults] = useState([]);
  const [isSearchingTranscript, setIsSearchingTranscript] = useState(false);
  const [transcribingFiles, setTranscribingFiles] = useState({});
  const [whisperQueueStatus, setWhisperQueueStatus] = useState({ isProcessing: false, currentTask: null, queue: [], queueLength: 0 });
  const [keywordAlertToast, setKeywordAlertToast] = useState(null);

  // Smart Storage & Cloud Sync State
  const [storageStatus, setStorageStatus] = useState(null);
  const [storageConfig, setStorageConfig] = useState({
    autoArchiveDays: 14,
    minFreeDiskGb: 5,
    cloudSyncEnabled: false,
    cloudSyncUrl: '',
    backupDirectory: '',
    archiveQuality: 'low_opus'
  });
  const [isSavingStorageConfig, setIsSavingStorageConfig] = useState(false);
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const [isTriggeringArchive, setIsTriggeringArchive] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState(null);

  const searchDebounceRef = useRef(null);
  const latestSearchQueryRef = useRef('');
  const searchReqIdRef = useRef(0);
  const toastTimerRef = useRef(null);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/transcription/queue`);
      if (res.ok) {
        const data = await res.json();
        if (data.status) {
          setWhisperQueueStatus(data.status);
          const map = {};
          if (data.status.currentTask) {
            map[`${data.status.currentTask.sessionFolder}/${data.status.currentTask.fileName}`] = 'processing';
          }
          if (Array.isArray(data.status.queue)) {
            data.status.queue.forEach(q => {
              map[`${q.sessionFolder}/${q.fileName}`] = 'queued';
            });
          }
          setTranscribingFiles(prev => ({ ...prev, ...map }));
        }
      }
    } catch (e) {}
  };

  // Auth State
  const [pin, setPin] = useState(sessionStorage.getItem('dashboardPin') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = checking
  const [loginError, setLoginError] = useState('');

  const apiFetch = async (endpoint, options = {}) => {
    let activePin = pin || sessionStorage.getItem('dashboardPin') || '';
    const headers = {
      'Content-Type': 'application/json',
      'x-pin': activePin,
      ...(options.headers || {})
    };
    const res = await fetch(`${SERVER_URL}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      setIsAuthenticated(false);
      sessionStorage.removeItem('dashboardPin');
    }
    return res;
  };

  const ensurePin = async () => {
    let currentPin = pin || sessionStorage.getItem('dashboardPin') || '';
    if (!currentPin) {
      const entered = await customPrompt('Masukkan PIN Dashboard (default: 1234) untuk otorisasi:', 'PIN Diperlukan', '', true);
      if (!entered) return null;
      currentPin = entered.trim();
      setPin(currentPin);
      sessionStorage.setItem('dashboardPin', currentPin);
    }
    return currentPin;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${SERVER_URL}/api/config`, { headers: { 'x-pin': pin } });
      if (res.ok) {
        setIsAuthenticated(true);
        sessionStorage.setItem('dashboardPin', pin);
        setLoginError('');
        fetchConfigData(await res.json());
      } else {
        setLoginError('PIN Salah');
      }
    } catch (err) {
      setLoginError('Tidak dapat terhubung ke server');
    }
  };

  const fetchConfigData = (data) => {
    if (data.telegram) {
      setTelegramToken(data.telegram.token || '');
      setTelegramChatId(data.telegram.chatId || '');
      setTelegramInterval(data.telegram.interval || 60);
    }
    if (data.logRetentionDays) setLogRetentionDays(data.logRetentionDays);
    if (data.transcription) {
      setTranscriptionConfig(data.transcription);
      setAlertKeywordsInput(Array.isArray(data.transcription.alertKeywords) ? data.transcription.alertKeywords.join(', ') : '');
    }
    if (data.storageAutomation) {
      setStorageConfig(data.storageAutomation);
    }
    fetchStorageAutomationStatus();
  };

  const fetchConfig = async () => {
    try {
      const res = await apiFetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setIsAuthenticated(true);
        fetchConfigData(data);
      }
    } catch (e) {
      console.error('Failed to fetch config', e);
    }
  };

  const fetchTranscriptionConfig = async () => {
    try {
      const res = await apiFetch('/api/config/transcription');
      if (res.ok) {
        const data = await res.json();
        if (data.transcription) {
          setTranscriptionConfig(data.transcription);
          setAlertKeywordsInput(Array.isArray(data.transcription.alertKeywords) ? data.transcription.alertKeywords.join(', ') : '');
        }
      }
    } catch (err) {
      console.error('Failed to fetch transcription config:', err);
    }
  };

  const fetchStorageAutomationStatus = async () => {
    try {
      const res = await apiFetch('/api/storage/automation-status');
      if (res.ok) {
        const data = await res.json();
        setStorageStatus(data);
        if (data.config) setStorageConfig(data.config);
      }
    } catch (err) {
      console.error('Failed to fetch storage status:', err);
    }
  };

  const saveStorageAutomationConfig = async () => {
    if (!ensurePin()) return;
    setIsSavingStorageConfig(true);
    try {
      const res = await apiFetch('/api/storage/automation-config', {
        method: 'POST',
        body: JSON.stringify(storageConfig)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await customAlert('Konfigurasi Smart Storage & Cloud Sync berhasil disimpan.', 'Tersimpan');
        fetchStorageAutomationStatus();
      } else {
        await customAlert(data.error || 'Gagal menyimpan konfigurasi.', 'Error');
      }
    } catch (err) {
      await customAlert(err.message, 'Error');
    } finally {
      setIsSavingStorageConfig(false);
    }
  };

  const triggerManualBackupSync = async () => {
    if (!ensurePin()) return;
    setIsTriggeringSync(true);
    setSyncStatusMsg(null);
    try {
      const res = await apiFetch('/api/storage/trigger-sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setSyncStatusMsg({ type: 'success', text: `Sinkronisasi selesai: ${data.syncedCount} sesi rekaman berhasil dicadangkan.` });
        fetchStorageAutomationStatus();
      } else {
        setSyncStatusMsg({ type: 'error', text: data.message || data.error || 'Gagal menjalankan sinkronisasi.' });
      }
    } catch (err) {
      setSyncStatusMsg({ type: 'error', text: err.message });
    } finally {
      setIsTriggeringSync(false);
    }
  };

  const triggerManualArchive = async () => {
    if (!ensurePin()) return;
    setIsTriggeringArchive(true);
    try {
      const res = await apiFetch('/api/storage/trigger-archive', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        await customAlert(`${data.archivedCount} sesi rekaman lawas berhasil diarsipkan.`, 'Pengarsipan Selesai');
        fetchStorageAutomationStatus();
      } else {
        await customAlert(data.error || 'Gagal menjalankan pengarsipan.', 'Error');
      }
    } catch (err) {
      await customAlert(err.message, 'Error');
    } finally {
      setIsTriggeringArchive(false);
    }
  };

  const saveTranscriptionConfig = async () => {
    setIsSavingWhisper(true);
    try {
      const keywordsArray = alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean);
      const res = await apiFetch('/api/config/transcription', {
        method: 'POST',
        body: JSON.stringify({
          ...transcriptionConfig,
          alertKeywords: keywordsArray
        })
      });
      if (res.ok) {
        await customAlert('Pengaturan integrasi Whisper berhasil disimpan.', 'Tersimpan');
      } else {
        await customAlert('Gagal menyimpan konfigurasi Whisper.', 'Error');
      }
    } catch (err) {
      await customAlert('Error: ' + err.message, 'Error');
    } finally {
      setIsSavingWhisper(false);
    }
  };

  const removeAlertKeyword = (keywordToRemove) => {
    const arr = alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    const updated = arr.filter(k => k.toLowerCase() !== keywordToRemove.toLowerCase());
    setAlertKeywordsInput(updated.join(', '));
  };

  const addAlertKeyword = (newKw) => {
    const trimmed = (newKw || '').trim();
    if (!trimmed) return;
    const arr = alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean);
    if (!arr.some(k => k.toLowerCase() === trimmed.toLowerCase())) {
      arr.push(trimmed);
      setAlertKeywordsInput(arr.join(', '));
    }
    setNewKeywordInput('');
  };

  const testWhisperApiConnection = async () => {
    setIsTestingWhisperApi(true);
    setWhisperTestResult(null);
    try {
      const res = await apiFetch('/api/transcription/test-api', {
        method: 'POST',
        body: JSON.stringify({
          apiUrl: transcriptionConfig.apiUrl,
          apiKey: transcriptionConfig.apiKey
        })
      });
      const data = await res.json();
      setWhisperTestResult(data);
    } catch (err) {
      setWhisperTestResult({ success: false, error: err.message });
    } finally {
      setIsTestingWhisperApi(false);
    }
  };

  const openTranscriptModal = async (folderName, fileName = null, pcName = '') => {
    setActiveTranscriptModal({
      isOpen: true,
      folderName,
      fileName,
      pcName,
      transcript: null,
      loading: true,
      error: null
    });

    try {
      const query = fileName ? `?folder=${encodeURIComponent(folderName)}&file=${encodeURIComponent(fileName)}` : `?folder=${encodeURIComponent(folderName)}`;
      const res = await apiFetch(`/api/records/transcript${query}`);
      if (res.ok) {
        const data = await res.json();
        setActiveTranscriptModal(prev => prev ? { ...prev, transcript: data.transcript, loading: false } : null);
      } else {
        const errData = await res.json().catch(() => ({}));
        setActiveTranscriptModal(prev => prev ? { ...prev, loading: false, error: errData.error || 'Belum ada transkrip untuk rekaman ini.' } : null);
      }
    } catch (err) {
      setActiveTranscriptModal(prev => prev ? { ...prev, loading: false, error: err.message } : null);
    }
  };

  const handleManualTranscribe = async (folderName, fileName = null, pcName = '') => {
    try {
      setActiveTranscriptModal(prev => prev ? { ...prev, loading: true, error: null } : null);
      const payload = { folder: folderName, pcName };
      if (fileName) payload.file = fileName;

      const res = await apiFetch('/api/records/transcribe', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActiveTranscriptModal(prev => prev ? { ...prev, transcript: data.transcript, loading: false } : null);
        fetchRecords();
      } else {
        setActiveTranscriptModal(prev => prev ? { ...prev, loading: false, error: data.error || 'Gagal mentranskripsi audio.' } : null);
      }
    } catch (err) {
      setActiveTranscriptModal(prev => prev ? { ...prev, loading: false, error: err.message } : null);
    }
  };

  const handleSearchTranscripts = (query, customFilters = null) => {
    setTranscriptSearchQuery(query);
    const reqId = ++searchReqIdRef.current;
    latestSearchQueryRef.current = query;

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!query || !query.trim()) {
      setTranscriptSearchResults([]);
      setIsSearchingTranscript(false);
      return;
    }

    const sDate = customFilters?.startDate !== undefined ? customFilters.startDate : recordStartDate;
    const eDate = customFilters?.endDate !== undefined ? customFilters.endDate : recordEndDate;
    const pc = customFilters?.pcFilter !== undefined ? customFilters.pcFilter : recordPcFilter;

    setIsSearchingTranscript(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query.trim()
        });
        if (sDate) params.append('startDate', sDate);
        if (eDate) params.append('endDate', eDate);
        if (pc) params.append('pcFilter', pc);

        const res = await apiFetch(`/api/records/search-transcript?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (searchReqIdRef.current === reqId) {
            setTranscriptSearchResults(data.results || []);
          }
        }
      } catch (err) {
        console.error('Failed to search transcripts:', err);
      } finally {
        if (searchReqIdRef.current === reqId) {
          setIsSearchingTranscript(false);
        }
      }
    }, 300);
  };

  useEffect(() => {
    if (transcriptSearchQuery && transcriptSearchQuery.trim()) {
      handleSearchTranscripts(transcriptSearchQuery);
    }
  }, [recordStartDate, recordEndDate, recordPcFilter]);

  const downloadTranscriptFile = (transcript, format = 'txt') => {
    if (!transcript) return;
    let content = '';
    let mimeType = 'text/plain';
    let fileExt = 'txt';

    const safeFolderName = String(transcript.sessionFolder || 'audio').replace(/[/\\?%*:|"<>]/g, '_');

    if (format === 'json') {
      content = JSON.stringify(transcript, null, 2);
      mimeType = 'application/json';
      fileExt = 'json';
    } else if (format === 'srt') {
      fileExt = 'srt';
      const formatSrtTime = (seconds) => {
        const validSec = (typeof seconds === 'number' && !isNaN(seconds) && isFinite(seconds)) ? Math.max(0, seconds) : 0;
        const d = new Date(validSec * 1000);
        const hh = String(Math.floor(validSec / 3600)).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');
        const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
        return `${hh}:${mm}:${ss},${ms}`;
      };
      if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
        content = transcript.segments.map((seg, idx) => {
          const s = typeof seg.start === 'number' ? seg.start : 0;
          const e = typeof seg.end === 'number' ? seg.end : s + 3;
          return `${idx + 1}\n${formatSrtTime(s)} --> ${formatSrtTime(e)}\n${seg.text || ''}\n`;
        }).join('\n');
      } else {
        content = `1\n00:00:00,000 --> 00:10:00,000\n${transcript.text || ''}\n`;
      }
    } else {
      content = `TRANSKRIP REKAMAN AUDIO\nSesi: ${transcript.sessionFolder || ''}\nPC: ${transcript.pcName || ''}\nWaktu: ${transcript.transcribedAt || ''}\n\n`;
      if (Array.isArray(transcript.segments) && transcript.segments.length > 0) {
        content += transcript.segments.map(seg => {
          const validSec = typeof seg.start === 'number' ? Math.max(0, seg.start) : 0;
          const m = Math.floor(validSec / 60);
          const s = Math.floor(validSec % 60);
          const timePill = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
          return `${timePill} ${seg.text || ''}`;
        }).join('\n');
      } else {
        content += transcript.text || '';
      }
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transkrip_${safeFolderName}.${fileExt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const quickDownloadSessionTranscript = async (session, format = 'txt') => {
    if (!session) return;
    try {
      const res = await apiFetch(`/api/records/transcript?folder=${encodeURIComponent(session.folderName)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.transcript) {
          downloadTranscriptFile(data.transcript, format);
        } else {
          customAlert('Transkrip belum tersedia untuk sesi ini.', 'Info');
        }
      } else {
        customAlert('Transkrip belum tersedia untuk sesi ini.', 'Info');
      }
    } catch (err) {
      customAlert('Gagal mengunduh transkrip: ' + err.message, 'Error');
    }
  };

  const fetchSystemLogs = async () => {
    try {
      const res = await apiFetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setSystemLogs(data.logs || 'No logs available.');
      }
    } catch(e) {
      setSystemLogs('Failed to fetch system logs.');
    }
  };

  const fetchLogs = async (filters = {}) => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.pcName) params.set('pcName', filters.pcName);
      if (filters.status) params.set('status', filters.status);
      params.set('limit', '500');
      const res = await apiFetch(`/api/incidents?${params.toString()}`);
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  const fetchPcNames = async () => {
    try {
      const res = await apiFetch('/api/incidents/pc-names');
      if (res.ok) setIncidentPcNames(await res.json());
    } catch (e) { /* ignore */ }
  };

  const applyIncidentFilters = () => {
    setIncidentPage(1);
    fetchLogs({
      startDate: incidentStartDate || undefined,
      endDate: incidentEndDate || undefined,
      pcName: incidentPcFilter || undefined,
      status: incidentStatusFilter || undefined
    });
  };

  const resetIncidentFilters = () => {
    const start = getDefaultStartDate();
    const end = getLocalDateStr();
    setIncidentStartDate(start);
    setIncidentEndDate(end);
    setIncidentPcFilter('');
    setIncidentStatusFilter('');
    setIncidentPage(1);
    fetchLogs({ startDate: start, endDate: end });
  };

  const setQuickFilter = (days) => {
    const endObj = new Date();
    const startObj = new Date();
    if (days > 0) {
      startObj.setDate(endObj.getDate() - days);
    }
    const startStr = getLocalDateStr(startObj);
    const endStr = getLocalDateStr(endObj);
    setIncidentStartDate(startStr);
    setIncidentEndDate(endStr);
    setIncidentPage(1);
    fetchLogs({
      startDate: startStr,
      endDate: endStr,
      pcName: incidentPcFilter || undefined,
      status: incidentStatusFilter || undefined
    });
  };

  const exportToCSV = async () => {
    if (logs.length === 0) {
      await customAlert('Tidak ada data untuk diunduh.', 'Peringatan');
      return;
    }
    const headers = ['Waktu Kejadian', 'PC Name', 'UUID', 'Status', 'Detail'];
    const rows = logs.map(log => [
      `"${new Date(log.timestamp).toLocaleString()}"`,
      `"${log.pcName || ''}"`,
      `"${log.uuid || ''}"`,
      `"${log.incidentType || log.status || ''}"`,
      `"${(log.details || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(',') + "\n" 
      + rows.map(e => e.join(',')).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Incident_Logs_${getLocalDateStr()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const checkServerUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await apiFetch('/updates/agent/info');
      if (res.ok) {
        const data = await res.json();
        setServerUpdateInfo(data);
      }
    } catch (e) {
      console.error('Failed to check updates', e);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const checkGithubRelease = async () => {
    setIsCheckingGithub(true);
    try {
      const res = await apiFetch('/api/updates/check-github');
      if (res.ok) {
        const data = await res.json();
        setGithubReleaseInfo(data);
        if (!data.hasRelease) {
          await customAlert('Tidak ada rilis yang ditemukan di repositori GitHub.', 'Info');
        }
      } else {
        await customAlert('Gagal memeriksa rilis GitHub. Pastikan komputer Server terhubung ke internet.', 'Koneksi Gagal');
      }
    } catch (e) {
      await customAlert(`Gagal memeriksa rilis GitHub: ${e.message}`, 'Error');
    } finally {
      setIsCheckingGithub(false);
    }
  };

  const downloadGithubRelease = async () => {
    if (!githubReleaseInfo?.asset?.downloadUrl) {
      await customAlert('File installer Agent tidak ditemukan pada rilis GitHub ini.', 'Peringatan');
      return;
    }

    const sizeMb = githubReleaseInfo.asset.size ? (githubReleaseInfo.asset.size / 1024 / 1024).toFixed(1) : '0';
    const confirmed = await customConfirm(
      `Unduh installer ${githubReleaseInfo.asset.name} (${sizeMb} MB) dari GitHub ke Server?`,
      'Konfirmasi Unduhan'
    );
    if (!confirmed) return;

    setIsDownloadingGithub(true);
    try {
      const res = await apiFetch('/api/updates/download-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadUrl: githubReleaseInfo.asset.downloadUrl,
          fileName: githubReleaseInfo.asset.name
        })
      });
      if (res.ok) {
        await customAlert('Installer Agent berhasil diunduh ke Server dan siap disebarkan ke seluruh PC Agent!', 'Sukses');
        await checkServerUpdates();
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal mengunduh installer: ${err.error || 'Server error'}`, 'Gagal');
      }
    } catch (e) {
      await customAlert(`Koneksi gagal: ${e.message}`, 'Error');
    } finally {
      setIsDownloadingGithub(false);
    }
  };

  const handleUploadInstaller = async (e) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.exe')) {
      inputEl.value = '';
      await customAlert('Hanya file installer (.exe) yang diperbolehkan.', 'Format Salah');
      return;
    }

    const sizeMb = file.size ? (file.size / 1024 / 1024).toFixed(1) : '0';
    const confirmed = await customConfirm(
      `Upload file ${file.name} (${sizeMb} MB) langsung ke Server?`,
      'Konfirmasi Upload'
    );
    if (!confirmed) {
      inputEl.value = '';
      return;
    }

    setIsUploadingInstaller(true);
    setUploadProgress(0);

    try {
      const activePin = pin || sessionStorage.getItem('dashboardPin') || '';
      const res = await fetch(`${SERVER_URL}/api/updates/upload-agent`, {
        method: 'POST',
        headers: {
          'x-pin': activePin,
          'x-file-name': encodeURIComponent(file.name)
        },
        body: file
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        sessionStorage.removeItem('dashboardPin');
        await customAlert('Sesi habis atau PIN salah.', 'Akses Ditolak');
        return;
      }

      if (res.ok) {
        await customAlert(`File ${file.name} berhasil di-upload ke Server dan siap disebarkan!`, 'Upload Berhasil');
        await checkServerUpdates();
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal upload: ${err.error || 'Server error'}`, 'Upload Gagal');
      }
    } catch (err) {
      await customAlert(`Koneksi error saat upload: ${err.message}`, 'Error');
    } finally {
      setIsUploadingInstaller(false);
      inputEl.value = '';
    }
  };

  const handleServerSelfUpdate = async () => {
    if (!githubReleaseInfo?.serverAsset?.downloadUrl) {
      await customAlert('File installer Server tidak ditemukan pada rilis GitHub ini.', 'Peringatan');
      return;
    }

    const sizeMb = githubReleaseInfo.serverAsset.size ? (githubReleaseInfo.serverAsset.size / 1024 / 1024).toFixed(1) : '0';
    const confirmed = await customConfirm(
      `Perbarui Server ke ${githubReleaseInfo.tag} sekarang?\n\nServer akan mengunduh ${githubReleaseInfo.serverAsset.name} (${sizeMb} MB) dan melakukan instalasi otomatis. Aplikasi Server akan me-restart secara mandiri.`,
      'Konfirmasi Update Server'
    );
    if (!confirmed) return;

    setIsUpdatingServer(true);
    try {
      const res = await apiFetch('/api/updates/server-self-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadUrl: githubReleaseInfo.serverAsset.downloadUrl,
          fileName: githubReleaseInfo.serverAsset.name
        })
      });
      if (res.ok) {
        await customAlert('Installer Server berhasil diunduh! Aplikasi Server sedang memperbarui diri dan me-restart. Silakan muat ulang (refresh) halaman ini dalam 10-15 detik.', 'Server Sedang Diperbarui');
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal memperbarui Server: ${err.error || 'Server error'}`, 'Gagal');
      }
    } catch (e) {
      await customAlert(`Koneksi error: ${e.message}`, 'Error');
    } finally {
      setIsUpdatingServer(false);
    }
  };

  const handleUploadServerInstaller = async (e) => {
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.exe')) {
      inputEl.value = '';
      await customAlert('Hanya file installer (.exe) yang diperbolehkan.', 'Format Salah');
      return;
    }

    const sizeMb = file.size ? (file.size / 1024 / 1024).toFixed(1) : '0';
    const confirmed = await customConfirm(
      `Upload dan pasang installer Server ${file.name} (${sizeMb} MB) sekarang?\n\nAplikasi Server akan langsung memperbarui diri dan me-restart.`,
      'Konfirmasi Update Server'
    );
    if (!confirmed) {
      inputEl.value = '';
      return;
    }

    setIsUploadingServerInstaller(true);

    try {
      const activePin = pin || sessionStorage.getItem('dashboardPin') || '';
      const res = await fetch(`${SERVER_URL}/api/updates/upload-server`, {
        method: 'POST',
        headers: {
          'x-pin': activePin,
          'x-file-name': encodeURIComponent(file.name)
        },
        body: file
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        sessionStorage.removeItem('dashboardPin');
        await customAlert('Sesi habis atau PIN salah.', 'Akses Ditolak');
        return;
      }

      if (res.ok) {
        await customAlert(`File installer Server ${file.name} berhasil diunggah! Server sedang melakukan instalasi dan akan segera me-restart. Silakan muat ulang halaman ini dalam beberapa detik.`, 'Update Server Berhasil Dipicu');
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal upload server installer: ${err.error || 'Server error'}`, 'Upload Gagal');
      }
    } catch (err) {
      await customAlert(`Koneksi error saat upload: ${err.message}`, 'Error');
    } finally {
      setIsUploadingServerInstaller(false);
      inputEl.value = '';
    }
  };

  const triggerAgentUpdate = async (targetUuid = 'all') => {
    if (!serverUpdateInfo || !serverUpdateInfo.hasUpdate) {
      await customAlert('Tidak ada file update Agent yang tersedia di Server.\nSilakan gunakan tombol "Cek GitHub" atau "Upload File" di tab Settings.', 'Pembaruan Tidak Ditemukan');
      return;
    }

    const targetDesc = targetUuid === 'all' ? 'seluruh PC Agent yang terhubung' : `PC Agent (${targetUuid})`;
    const confirmed = await customConfirm(
      `Apakah Anda yakin ingin memicu pembaruan otomatis ke versi v${serverUpdateInfo.version} untuk ${targetDesc}?`,
      'Konfirmasi Pembaruan'
    );
    if (!confirmed) return;

    try {
      const res = await apiFetch('/api/updates/trigger-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUuid, downloadUrl: serverUpdateInfo.downloadUrl })
      });
      if (res.ok) {
        await customAlert(`Perintah pembaruan ke versi v${serverUpdateInfo.version} berhasil disiarkan!`, 'Sukses');
      } else {
        const err = await res.json();
        await customAlert(`Gagal memicu pembaruan: ${err.error || 'Server error'}`, 'Gagal');
      }
    } catch (e) {
      await customAlert(`Koneksi gagal: ${e.message}`, 'Error');
    }
  };

  const handleCleanHostStorage = async (targetUuid = 'all', pcName = null) => {
    const activePin = await ensurePin();
    if (!activePin) return;

    const targetDesc = targetUuid === 'all' 
      ? 'seluruh PC Host Agent yang terhubung' 
      : `PC Host "${pcName || targetUuid}"`;

    const confirmed = await customConfirm(
      `Hapus file rekaman audio lokal di ${targetDesc} yang SUDAH BERHASIL TERUPLOAD ke Server?\n\nFile rekaman yang belum terupload akan tetap dilindungi dan tidak akan dihapus.`,
      'Konfirmasi Pembersihan Audio Host'
    );
    if (!confirmed) return;

    try {
      const res = await apiFetch('/api/agents/clean-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUuid, onlyUploaded: true, deleteMode: 'all' })
      });
      if (res.ok) {
        await customAlert(`Perintah pembersihan storage telah dikirim ke ${targetDesc}. Hanya file yang sudah sukses terupload ke Server yang akan dihapus.`, 'Perintah Terkirim');
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal mengirim perintah: ${err.error || 'Server error'}`, 'Gagal');
      }
    } catch (e) {
      await customAlert(`Koneksi error: ${e.message}`, 'Error');
    }
  };

  useEffect(() => {
    fetchConfig();
    checkServerUpdates();
  }, []);

  const fetchRecords = async () => {
    try {
      setLoadingRecords(true);
      const res = await apiFetch('/api/records');
      if (res.ok) {
        setRecords(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch records', e);
    } finally {
      setLoadingRecords(false);
    }
  };

  // Probe durations whenever a session is selected
  useEffect(() => {
    if (!playingSession || !playingSession.parts || playingSession.parts.length === 0) {
      setPartDurations([]);
      setLocalCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    // Default estimation from file size (~128kbps Opus = ~16KB/s)
    const initialEstimated = playingSession.parts.map(p => {
      if (p.size && p.size > 0) {
        return Math.max(1, Math.round(p.size / 16000));
      }
      return 600;
    });

    setPartDurations(initialEstimated);
    setIsPlaying(true);

    const abortController = new AbortController();

    // Decode exact sample-accurate durations with singleton shared AudioContext
    const probeExactDurations = async () => {
      try {
        const audioCtx = getSharedAudioContext();
        if (!audioCtx) return;

        const promises = playingSession.parts.map(async (p, idx) => {
          const mediaUrl = getMediaUrl(p.url);
          if (audioDurationCache.has(mediaUrl)) {
            return audioDurationCache.get(mediaUrl);
          }
          try {
            const res = await fetch(mediaUrl, { signal: abortController.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (abortController.signal.aborted) return initialEstimated[idx] || 0;
            const decoded = await audioCtx.decodeAudioData(buf);
            const d = decoded.duration;
            if (d && isFinite(d) && !isNaN(d) && d > 0) {
              setAudioDurationCache(mediaUrl, d);
              return d;
            }
          } catch (err) {
            if (err.name !== 'AbortError') {
              console.warn(`Duration probe failed for ${p.fileName}:`, err.message);
            }
          }
          return initialEstimated[idx] || 0;
        });

        const results = await Promise.all(promises);

        if (!abortController.signal.aborted) {
          setPartDurations(results);
        }
      } catch (e) {
        // ignore abort
      }
    };

    probeExactDurations();

    return () => {
      abortController.abort();
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    };
  }, [playingSession?.folderName]);

  const totalSessionDuration = partDurations.reduce((acc, d) => acc + (isFinite(d) ? d : 0), 0);

  const startOffsets = useMemo(() => {
    const offsets = [];
    let currentOffset = 0;
    for (let i = 0; i < partDurations.length; i++) {
      offsets.push(currentOffset);
      currentOffset += (isFinite(partDurations[i]) ? partDurations[i] : 0);
    }
    return offsets;
  }, [partDurations]);

  const globalCurrentTime = (startOffsets[currentPartIndex] || 0) + localCurrentTime;

  const handleGlobalSeek = (targetGlobalTime) => {
    if (!playingSession || !playingSession.parts || playingSession.parts.length === 0) return;
    if (!totalSessionDuration || totalSessionDuration <= 0) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      setLocalCurrentTime(0);
      return;
    }
    targetGlobalTime = Math.max(0, Math.min(Math.max(0, totalSessionDuration - 0.1), targetGlobalTime));

    let accumulated = 0;
    let targetPartIdx = 0;
    let targetLocalOffset = 0;

    for (let i = 0; i < partDurations.length; i++) {
      const dur = isFinite(partDurations[i]) ? partDurations[i] : 0;
      if (targetGlobalTime < accumulated + dur || i === partDurations.length - 1) {
        targetPartIdx = i;
        targetLocalOffset = Math.max(0, targetGlobalTime - accumulated);
        break;
      }
      accumulated += dur;
    }

    if (targetPartIdx === currentPartIndex) {
      if (audioRef.current) {
        audioRef.current.currentTime = targetLocalOffset;
      }
      setLocalCurrentTime(targetLocalOffset);
    } else {
      pendingSeekOffsetRef.current = targetLocalOffset;
      setCurrentPartIndex(targetPartIdx);
    }
  };

  const handleAudioLoadedMetadata = (e) => {
    const audio = e.target;
    // Only update if duration is finite (ignore Infinity from WebM stream headers)
    if (audio.duration && isFinite(audio.duration) && !isNaN(audio.duration) && audio.duration > 0) {
      setPartDurations(prev => {
        const next = [...prev];
        next[currentPartIndex] = audio.duration;
        return next;
      });
    }
    if (pendingSeekOffsetRef.current !== null) {
      const dur = (audio.duration && isFinite(audio.duration) && !isNaN(audio.duration)) ? audio.duration : 0;
      const safeOffset = dur > 0 ? Math.max(0, Math.min(pendingSeekOffsetRef.current, dur - 0.1)) : Math.max(0, pendingSeekOffsetRef.current);
      audio.currentTime = safeOffset;
      setLocalCurrentTime(safeOffset);
      pendingSeekOffsetRef.current = null;
    }
    audio.playbackRate = playbackRate;
    if (isPlaying) {
      audio.play().catch(err => {
        console.log('Autoplay info:', err.message);
        setIsPlaying(false);
      });
    }
  };

  const handleAudioTimeUpdate = (e) => {
    setLocalCurrentTime(e.target.currentTime || 0);
  };

  const handleAudioEnded = () => {
    if (playingSession?.parts && currentPartIndex < playingSession.parts.length - 1) {
      pendingSeekOffsetRef.current = 0;
      setCurrentPartIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  };

  const handleSpeedChange = (rate) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((err) => {
        console.error(err);
        setIsPlaying(false);
      });
    }
  };

  const formatPlaybackTime = (sec) => {
    if (isNaN(sec) || !isFinite(sec) || sec < 0) return '00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };


  useEffect(() => {
    if (isAuthenticated && currentView === 'logs') {
      fetchLogs({
        startDate: incidentStartDate || undefined,
        endDate: incidentEndDate || undefined,
        pcName: incidentPcFilter || undefined,
        status: incidentStatusFilter || undefined
      });
      fetchPcNames();
    } else if (isAuthenticated && currentView === 'records') {
      fetchRecords();
      fetchQueueStatus();
    } else if (isAuthenticated && currentView === 'settings') {
      fetchConfig();
      fetchTranscriptionConfig();
    }
  }, [currentView, isAuthenticated]);

  useEffect(() => {
    localStorage.setItem('enableBeep', enableBeep);
  }, [enableBeep]);

  const client = useRef(null);

  useEffect(() => {

    let agentBuffer = [];
    let fullStateBuffer = [];

    const flushBuffer = setInterval(() => {
      setAgents((prev) => {
        let hasChanges = false;
        const next = { ...prev };
        
        if (fullStateBuffer.length > 0) {
          const dataArray = fullStateBuffer.pop();
          fullStateBuffer = [];
          for (const d of dataArray) {
             const existing = next[d.uuid] || {};
             next[d.uuid] = {
               ...existing,
               ...d,
               micHistory: (d.micHistory || existing.micHistory || Array(30).fill(-60)).slice(-30),
               obsHistory: (d.obsHistory || existing.obsHistory || Array(30).fill(-60)).slice(-30)
             };
             hasChanges = true;
          }
        }

        while (agentBuffer.length > 0) {
          const data = agentBuffer.shift();
          const prevData = next[data.uuid] || {};
          const mic = data.micDb !== undefined ? data.micDb : (data.micLevel !== undefined ? data.micLevel : -60);
          const obs = data.obsDb !== undefined ? data.obsDb : (data.obsLevel !== undefined ? data.obsLevel : -60);
          
          let updatedObsSources = prevData.obsSources || [];
          if (data.obsSources && Array.isArray(data.obsSources) && data.obsSources.length > 0) {
            updatedObsSources = data.obsSources;
          }

          const existingMicHistory = (prevData.micHistory && prevData.micHistory.length > 0)
            ? prevData.micHistory 
            : Array(30).fill(Number(mic) || -60);
          const existingObsHistory = (prevData.obsHistory && prevData.obsHistory.length > 0)
            ? prevData.obsHistory 
            : Array(30).fill(Number(obs) || -60);

          next[data.uuid] = {
            ...prevData,
            ...data,
            timestamp: Date.now(),
            obsSources: updatedObsSources,
            micLevel: mic,
            obsLevel: obs,
            micHistory: [...existingMicHistory, Number(mic)].slice(-30),
            obsHistory: [...existingObsHistory, Number(obs)].slice(-30)
          };
          hasChanges = true;
        }
        
        return hasChanges ? next : prev;
      });
    }, 500);

    client.current = new DashboardClient(
      SERVER_URL,
      (connected) => setIsConnected(connected),
      (data) => {
        agentBuffer.push(data);
      },
      (status) => setIsMonitoringActive(status),
      ({ uuid, active }) => {
        // Instant per-PC monitoring update from server
        setAgents(prev => {
          if (!prev[uuid]) return prev;
          return { ...prev, [uuid]: { ...prev[uuid], isMonitoringActive: active } };
        });
      },
      (states) => {
        // Initial batch of per-PC monitoring states from server
        setAgents(prev => {
          const updated = { ...prev };
          for (const [uuid, active] of Object.entries(states)) {
            if (updated[uuid]) {
              updated[uuid] = { ...updated[uuid], isMonitoringActive: active };
            }
          }
          return updated;
        });
      },
      (dataArray) => {
        fullStateBuffer.push(dataArray);
      },
      (uuid) => {
        setAgents(prev => {
          const next = { ...prev };
          delete next[uuid];
          return next;
        });
        setAgentUpdateProgress(prev => {
          if (!prev[uuid]) return prev;
          const next = { ...prev };
          delete next[uuid];
          return next;
        });
      },
      (updateProg) => {
        if (updateProg && updateProg.uuid) {
          setAgentUpdateProgress(prev => ({
            ...prev,
            [updateProg.uuid]: updateProg
          }));
        }
      },
      (transData) => {
        if (transData) {
          setTranscribingFiles(prev => {
            const next = { ...prev };
            if (transData.status === 'completed' || transData.status === 'failed') {
              delete next[`${transData.sessionFolder}/${transData.fileName}`];
            } else {
              next[`${transData.sessionFolder}/${transData.fileName}`] = transData.status;
            }
            return next;
          });
          if (transData.queueStatus) {
            setWhisperQueueStatus(transData.queueStatus);
          }
          if (transData.status === 'completed') {
            fetchRecords();
          }
        }
      },
      (alertData) => {
        if (alertData) {
          if (toastTimerRef.current) {
            clearTimeout(toastTimerRef.current);
          }
          setKeywordAlertToast(alertData);
          toastTimerRef.current = setTimeout(() => setKeywordAlertToast(null), 8000);
        }
      },
      (storageData) => {
        if (storageData && storageData.success) {
          customAlert(
            `Pembersihan audio lokal di PC Host "${storageData.pcName || storageData.uuid}" selesai.\n\nMembebaskan ${storageData.freedMb} MB (${storageData.deletedFolders} folder rekaman dihapus, ${storageData.skippedUnuploaded || 0} folder yang belum terupload tetap aman).`,
            'Pembersihan Host Selesai'
          );
        }
      }
    );

    client.current.connect();

    return () => {
      clearInterval(flushBuffer);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (client.current) client.current.disconnect();
    };
  }, []);

  const submitInlineRename = async (e, uuid) => {
    e.preventDefault();
    if (editingName.trim() === '') return;

    const activePin = await ensurePin();
    if (!activePin) return;

    try {
      if (client.current) {
        await client.current.renamePC(uuid, editingName.trim(), activePin);
      }

      // Optimistically update the UI immediately
      setAgents((prev) => {
        if (prev[uuid]) {
          return {
            ...prev,
            [uuid]: {
              ...prev[uuid],
              pcName: editingName.trim()
            }
          };
        }
        return prev;
      });

      setEditingId(null);
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes('401')) {
        sessionStorage.removeItem('dashboardPin');
        setPin('');
        setIsAuthenticated(false);
        await customAlert('PIN salah atau otorisasi ditolak.', 'PIN Salah');
      } else {
        await customAlert('Gagal mengubah nama PC', 'Error');
      }
    }
  };

  const saveTelegramConfig = async () => {
    setIsSavingTelegram(true);
    try {
      const res = await apiFetch(`/api/config/telegram`, {
        method: 'POST',
        body: JSON.stringify({ 
          token: telegramToken, 
          chatId: telegramChatId, 
          interval: parseInt(telegramInterval, 10) || 60
        })
      });
      if (res.ok) await customAlert('Konfigurasi Telegram berhasil disimpan!', 'Sukses');
    } catch (e) {
      await customAlert('Gagal menyimpan konfigurasi Telegram: ' + e.message, 'Error');
    } finally {
      setIsSavingTelegram(false);
    }
  };

  const saveRetentionConfig = async () => {
    setIsSavingRetention(true);
    try {
      const days = parseInt(logRetentionDays, 10) || 30;
      const res = await apiFetch(`/api/config/retention`, {
        method: 'POST',
        body: JSON.stringify({ days })
      });
      if (res.ok) {
        await customAlert(`Batas retensi log insiden berhasil diubah menjadi ${days} hari.`, 'Sukses');
      } else {
        await customAlert('Gagal menyimpan batas retensi log.', 'Error');
      }
    } catch (e) {
      await customAlert('Error: ' + e.message, 'Error');
    } finally {
      setIsSavingRetention(false);
    }
  };

  const handleManualCleanupNow = async () => {
    const confirmed = await customConfirm(
      `Apakah Anda yakin ingin menghapus seluruh log insiden yang berusia lebih dari ${logRetentionDays} hari sekarang?`,
      'Konfirmasi Pembersihan Log'
    );
    if (!confirmed) return;

    try {
      const res = await apiFetch(`/api/incidents/cleanup-now`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        await customAlert(`Pembersihan selesai. Sebanyak ${data.removedCount || 0} catatan log lama telah dihapus dari database server.`, 'Pembersihan Sukses');
        fetchLogs();
      } else {
        await customAlert('Gagal membersihkan log lama.', 'Error');
      }
    } catch (e) {
      await customAlert('Error: ' + e.message, 'Error');
    }
  };

  
  const handleRemoteConfigSave = async (e) => {
    e.preventDefault();
    if (!configModalAgent) return;
    
    if (client.current && client.current.socket) {
      client.current.socket.emit('agent-config-update', {
        uuid: configModalAgent.uuid,
        config: remoteConfig
      });
    }

    try {
      await apiFetch(`/api/pc/${configModalAgent.uuid}/config`, {
        method: 'POST',
        body: JSON.stringify(remoteConfig)
      });
    } catch (err) {
      console.warn('REST config sync fallback notice:', err.message);
    }

    setAgents(prev => {
      if (prev[configModalAgent.uuid]) {
        return {
          ...prev,
          [configModalAgent.uuid]: {
            ...prev[configModalAgent.uuid],
            ...remoteConfig,
            pcName: remoteConfig.agentName
          }
        };
      }
      return prev;
    });

    setConfigModalAgent(null);
  };

  const savePinConfig = async () => {
    if (newPinInput.length < 4) {
      await customAlert('PIN minimal 4 karakter', 'Peringatan');
      return;
    }
    setIsSavingPin(true);
    try {
      const res = await apiFetch(`/api/config/pin`, {
        method: 'POST',
        body: JSON.stringify({ newPin: newPinInput })
      });
      if (res.ok) {
        await customAlert('PIN Berhasil Diubah!', 'Sukses');
        setPin(newPinInput);
        sessionStorage.setItem('dashboardPin', newPinInput);
        setNewPinInput('');
      }
    } catch (e) {
      await customAlert('Gagal mengubah PIN', 'Error');
    } finally {
      setIsSavingPin(false);
    }
  };

  const testTelegram = async () => {
    try {
      const res = await apiFetch(`/api/telegram/test`, { method: 'POST' });
      if (res.ok) await customAlert('Test signal sent! Check your Telegram.', 'Sukses');
    } catch (e) {
      await customAlert('Failed to send test signal', 'Error');
    }
  };

  const getLogClass = (type) => {
    if (!type) return 'log-info';
    const t = type.toUpperCase();
    if (t.includes('RECOVERY') || t === 'AMAN') return 'log-success';
    if (t.includes('WARNING') || t.includes('STANDBY')) return 'log-warning';
    if (t.includes('OFFLINE') || t.includes('BAHAYA')) return 'log-danger';
    return 'log-info';
  };

  const clearDatabase = async () => {
    const confirmed = await customConfirm("ARE YOU SURE? This will permanently delete all incident logs from the server database.", "Hapus Database?");
      if (confirmed) {
      try {
        const res = await apiFetch(`/api/incidents`, { method: 'DELETE' });
        if (res.ok) {
          await customAlert('Database cleared!', 'Sukses');
          if (currentView === 'logs') applyIncidentFilters();
        }
      } catch (e) {
        await customAlert('Failed to clear database', 'Error');
      }
    }
  };


  const handleDeletePC = async (uuid) => {
    const pcObj = agents[uuid];
    const pcName = pcObj?.pcName || uuid;
    const confirmed = await customConfirm(`Apakah Anda yakin ingin menghapus "${pcName}" dari Dashboard?`, 'Hapus PC?');
    if (!confirmed) return;

    const activePin = await ensurePin();
    if (!activePin) return;

    try {
      const res = await fetch(`${SERVER_URL}/api/pc/${uuid}`, {
        method: 'DELETE',
        headers: { 'x-pin': activePin }
      });

      if (res.status === 401) {
        sessionStorage.removeItem('dashboardPin');
        setPin('');
        setIsAuthenticated(false);
        await customAlert('PIN salah atau otorisasi ditolak. PC gagal dihapus.', 'PIN Salah');
        return;
      }

      if (res.ok) {
        setAgents(prev => {
          const next = { ...prev };
          delete next[uuid];
          return next;
        });
        await customAlert(`PC "${pcName}" berhasil dihapus dari Dashboard.`, 'Berhasil Dihapus');
      } else {
        const err = await res.json().catch(() => ({}));
        await customAlert(`Gagal menghapus PC: ${err.message || err.error || 'Server error'}`, 'Gagal');
      }
    } catch (e) {
      await customAlert(`Gagal menghapus PC: ${e.message}`, 'Error');
    }
  };

  const togglePcMonitoring = async (uuid, active) => {
    const activePin = await ensurePin();
    if (!activePin) return;

    // Optimistically update local state so button responds immediately
    setAgents(prev => ({
      ...prev,
      [uuid]: { ...prev[uuid], isMonitoringActive: active }
    }));

    try {
      const res = await fetch(`${SERVER_URL}/api/pc/${uuid}/monitoring`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pin': activePin
        },
        body: JSON.stringify({ active })
      });

      if (res.status === 401) {
        sessionStorage.removeItem('dashboardPin');
        setPin('');
        setIsAuthenticated(false);
        setAgents(prev => ({
          ...prev,
          [uuid]: { ...prev[uuid], isMonitoringActive: !active }
        }));
        await customAlert('PIN salah atau otorisasi ditolak.', 'PIN Salah');
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (e) {
      // Revert on failure
      setAgents(prev => ({
        ...prev,
        [uuid]: { ...prev[uuid], isMonitoringActive: !active }
      }));
      await customAlert('Gagal mengubah status monitoring PC', 'Error');
    }
  };

  const agentsArray = Object.values(agents);
  const totalConnected = agentsArray.filter(a => a.status !== 'OFFLINE').length;
  const totalBahaya = agentsArray.filter(a => a.status?.startsWith('BAHAYA') && a.isMonitoringActive !== false).length;
  const totalStandby = agentsArray.filter(a => a.status === 'STANDBY_DIAM').length;

  const statusPriority = {
    'BAHAYA_OBS_MUTE': 1,
    'BAHAYA_AUDIO_PECAH': 2,
    'BAHAYA_MIC_MATI': 3,
    'STANDBY_DIAM': 4,
    'AMAN': 5,
    'OFFLINE': 99
  };

  const sortedFilteredAgents = agentsArray
    .filter(agent => filterStatus === 'ALL' || (filterStatus === 'BAHAYA' ? agent.status?.startsWith('BAHAYA') : agent.status === filterStatus))
    .filter(agent => !searchTerm || (agent.pcName && agent.pcName.toLowerCase().includes(searchTerm.toLowerCase())))
    .sort((a, b) => {
      const pA = statusPriority[a.status] || 99;
      const pB = statusPriority[b.status] || 99;
      if (pA !== pB) return pA - pB;
      return (a.pcName || '').localeCompare(b.pcName || '');
    });

  // Audio Alarm Logic
  const alarmIntervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  useEffect(() => {
    if (totalBahaya > 0 && enableBeep && isMonitoringActive) {
      if (!alarmIntervalRef.current) {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const audioCtx = audioCtxRef.current;
        
        const playBeep = () => {
          if (audioCtx.state === 'suspended') audioCtx.resume();
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          
          oscillator.type = 'square';
          oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
          
          gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
          
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 0.5);
        };
        
        playBeep(); // play immediately
        alarmIntervalRef.current = setInterval(playBeep, 1000); // loop every 1s
      }
    } else {
      if (alarmIntervalRef.current) {
        clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }
    }
    
    return () => {
      if (alarmIntervalRef.current) {
        clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [totalBahaya, enableBeep, isMonitoringActive]);

  if (isAuthenticated === null) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>Connecting to Server...</div>;
  }

  if (isAuthenticated === false) {
    return (
      <div className="login-screen">
        <form onSubmit={handleLogin} className="login-box">
          <h2>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
            Audio Monitor
          </h2>
          <p>Masukkan PIN Keamanan untuk mengakses Dashboard</p>
          <input 
            type="password" 
            placeholder="PIN Master..." 
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          {loginError && <div className="login-error">{loginError}</div>}
          <button type="submit">Masuk Dashboard</button>
        </form>
      </div>
    );
  }

  return (
    <div className="dashboard">
      
      {dialogParams && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ maxWidth: '420px', backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{dialogParams.title}</h3>
              <button type="button" className="close-btn" onClick={dialogParams.onCancel}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <p style={{ margin: 0, fontSize: '0.95rem', color: '#ccc', lineHeight: '1.4' }}>{dialogParams.message}</p>
              {dialogParams.type === 'prompt' && (
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    dialogParams.onConfirm(dialogInputValue);
                  }}
                  style={{ marginTop: '16px' }}
                >
                  <input
                    autoFocus
                    type={dialogParams.isPassword ? 'password' : 'text'}
                    className="form-input"
                    value={dialogInputValue || ''}
                    onChange={(e) => setDialogInputValue(e.target.value)}
                    placeholder={dialogParams.isPassword ? 'Masukkan PIN Dashboard...' : ''}
                    style={{ width: '100%', padding: '10px 14px' }}
                  />
                </form>
              )}
            </div>
            <div className="modal-footer" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {(dialogParams.type === 'confirm' || dialogParams.type === 'prompt') && (
                <button type="button" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} onClick={dialogParams.onCancel}>Batal</button>
              )}
              <button 
                type="button" 
                style={{ background: dialogParams.type === 'confirm' ? 'var(--danger)' : 'var(--accent)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} 
                onClick={() => {
                  if (dialogParams.type === 'prompt') {
                    dialogParams.onConfirm(dialogInputValue);
                  } else {
                    dialogParams.onConfirm();
                  }
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="navbar">

        <div className="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
          Audio Monitor
        </div>
        <div className="nav-links">
          <button className={`nav-btn ${currentView === 'live' ? 'active' : ''}`} onClick={() => setCurrentView('live')}>Live Status</button>
          <button className={`nav-btn ${currentView === 'logs' ? 'active' : ''}`} onClick={() => setCurrentView('logs')}>Incident Logs</button>
          <button className={`nav-btn ${currentView === 'records' ? 'active' : ''}`} onClick={() => setCurrentView('records')}>File Rekaman</button>
          <button className={`nav-btn ${currentView === 'settings' ? 'active' : ''}`} onClick={() => setCurrentView('settings')}>Settings</button>
        </div>
        <div className={`server-status ${isConnected ? 'connected' : 'disconnected'}`}>
          <div className="dot"></div> {isConnected ? 'Server Connected' : 'Disconnected'}
        </div>
      </nav>

      <div className="container">
        {currentView === 'live' && (
          <>
            <div className="summary-grid">
                <div className="summary-card total">
                  <div className="summary-value">
                    <span style={{color: '#fff'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE').length}</span>
                    <span style={{fontSize: '1.2rem', color: '#444', margin: '0 8px'}}>/</span>
                    <span style={{color: 'var(--text-muted)'}}>{Object.values(agents).filter(a => a.status === 'OFFLINE').length}</span>
                  </div>
                  <div className="summary-label">PC Online / Offline</div>
                </div>
                <div className="summary-card danger">
                  <div className="summary-value">
                    <span style={{color: 'var(--danger)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && a.status && (a.status === 'BAHAYA_MIC_MATI' || a.status === 'BAHAYA_AUDIO_PECAH')).length}</span>
                    <span style={{fontSize: '1.2rem', color: '#444', margin: '0 8px'}}>/</span>
                    <span style={{color: 'var(--warning)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && a.status === 'BAHAYA_OBS_MUTE').length}</span>
                  </div>
                  <div className="summary-label">Bahaya / Mute</div>
                </div>
                <div className="summary-card standby">
                  <div className="summary-value">
                    <span style={{color: 'var(--success)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && a.status === 'AMAN').length}</span>
                    <span style={{fontSize: '1.2rem', color: '#444', margin: '0 8px'}}>/</span>
                    <span style={{color: 'var(--text-main)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && (!a.status || a.status === 'STANDBY_DIAM')).length}</span>
                  </div>
                  <div className="summary-label">Aman / Standby</div>
                </div>
                <div className="summary-card monitoring">
                  <div className="summary-value">
                    <span style={{color: 'var(--success)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && a.isMonitoringActive !== false).length}</span>
                    <span style={{fontSize: '1.2rem', color: '#444', margin: '0 8px'}}>/</span>
                    <span style={{color: 'var(--text-muted)'}}>{Object.values(agents).filter(a => a.status !== 'OFFLINE' && a.isMonitoringActive === false).length}</span>
                  </div>
                  <div className="summary-label">Monitor ON / OFF</div>
                </div>
              </div>
  
              <div className="toolbar">
              <input 
                type="text" 
                className="search-input" 
                placeholder="Cari nama PC atau ID..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <button 
                  className={`nav-btn ${isCompactMode ? 'active' : ''}`} 
                  onClick={() => setIsCompactMode(!isCompactMode)}
                  title="Toggle Mode Ringkas"
                >
                  {isCompactMode ? 'Mode Detail' : 'Mode Ringkas'}
                </button>
                <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="ALL">Semua Status</option>
                <option value="BAHAYA">Hanya Bahaya</option>
                <option value="AMAN">Hanya Aman</option>
              </select>
            </div>

            <div className={`agent-grid ${isCompactMode ? 'compact' : ''}`}>
              {sortedFilteredAgents.map(agent => {
                const isOffline = agent.status === 'OFFLINE';
                const isDanger = agent.status && agent.status.startsWith('BAHAYA');
                const isStandby = agent.status && agent.status.startsWith('STANDBY');
                
                let cardClass = 'agent-card';
                if (isOffline) cardClass += ' offline';
                else if (isDanger) cardClass += ' danger';
                else if (isStandby) cardClass += ' standby';
                
                if (agent.isMonitoringActive === false && !isOffline) cardClass += ' monitoring-off';

                let statusAreaClass = 'status-area';
                if (isOffline) statusAreaClass += ' offline';
                else if (isDanger) statusAreaClass += ' danger';

                return (
                  <div key={agent.uuid} className={cardClass}>
                    <div className="card-header">
                      <div className="pc-info">
                        <div className="pc-name-row">
                          {editingId === agent.uuid ? (
                            <form onSubmit={(e) => submitInlineRename(e, agent.uuid)} style={{display: 'flex', gap: '5px', width: '100%'}}>
                              <input autoFocus value={editingName || ''} onChange={e => setEditingName(e.target.value)} className="form-input" style={{padding: '4px 8px'}} />
                              <button type="submit" className="icon-btn" style={{background: 'var(--accent)', color: '#fff'}}><i className="fa-solid fa-check"></i></button>
                              <button type="button" onClick={() => setEditingId(null)} className="icon-btn"><i className="fa-solid fa-times"></i></button>
                            </form>
                          ) : (
                            <>
                              <div className="pc-name-wrapper">
                                <span className="pc-name-title" title={agent.pcName || agent.name || agent.uuid}>{agent.pcName || agent.name || agent.uuid}</span>
                                <span className="badge-agent-version">v{agent.appVersion || '1.0.2'}</span>
                              </div>
                              <div className="card-actions">
                                <button 
                                  className={`toggle-btn ${agent.isMonitoringActive ? '' : 'off'}`}
                                  onClick={() => togglePcMonitoring(agent.uuid, !agent.isMonitoringActive)}
                                  title={agent.isMonitoringActive ? 'Monitoring Aktif (Klik untuk Pause)' : 'Monitoring Nonaktif (Klik untuk Resume)'}
                                >
                                  {agent.isMonitoringActive ? <i className="fa-solid fa-pause" style={{marginRight: '3px'}}></i> : <i className="fa-solid fa-play" style={{marginRight: '3px'}}></i>}
                                  {agent.isMonitoringActive ? 'ON' : 'OFF'}
                                </button>
                                <button className="icon-btn" title="Remote Config" onClick={() => { 
                                  setConfigModalAgent(agent); 
                                  setRemoteConfig({
                                    agentName: agent.pcName,
                                    micDriverName: agent.micDriverName || '',
                                    noiseGate: agent.noiseGate ?? 15,
                                    silenceTimeoutSec: agent.silenceTimeoutSec ?? 10,
                                    deadMicTimeoutSec: agent.deadMicTimeoutSec ?? 60,
                                    clippingThreshold: agent.clippingThreshold ?? 95,
                                    clippingDurationSec: agent.clippingDurationSec ?? 3,
                                    speakingThreshold: agent.speakingThreshold ?? 10,
                                    obsMuteTimeoutSec: agent.obsMuteTimeoutSec ?? 3,
                                    autoRecoveryUnmute: agent.autoRecoveryUnmute ?? false,
                                    obsSyncRecording: agent.obsSyncRecording ?? false,
                                    obsSyncStreaming: agent.obsSyncStreaming ?? false,
                                    telemetryInterval: agent.telemetryInterval ?? 500,
                                    obsSourceName: agent.obsSourceName || 'Mic/Aux'
                                  }); 
                                }}><i className="fa-solid fa-gear"></i></button>

                                <button className="icon-btn" title="Lihat File Rekaman PC ini" onClick={() => {
                                  setRecordPcFilter(agent.pcName || agent.uuid);
                                  setCurrentView('records');
                                }}>
                                  <i className="fa-solid fa-file-audio"></i>
                                </button>

                                <button 
                                  className="icon-btn" 
                                  title={agent.isRecording ? 'Stop Recording (Manual)' : 'Start Recording (Manual)'} 
                                  style={{ color: agent.isRecording ? '#f44336' : 'inherit' }}
                                  onClick={() => {
                                     if (client.current && client.current.socket) {
                                       client.current.socket.emit('agent-record', { uuid: agent.uuid, record: !agent.isRecording });
                                     }
                                  }}>
                                  <i className="fa-solid fa-circle"></i>
                                </button>

                                <button 
                                  className="icon-btn" 
                                  title="Bersihkan file audio lokal di PC Host ini (yang sudah terupload ke Server)" 
                                  style={{ color: '#f87171' }}
                                  onClick={() => handleCleanHostStorage(agent.uuid, agent.pcName || agent.uuid)}
                                >
                                  <i className="fa-solid fa-broom"></i>
                                </button>

                                <button className="icon-btn" title="Hapus PC" onClick={() => handleDeletePC(agent.uuid)}>
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {isCompactMode ? (
                          <div className="pc-meta-row">
                            {agent.isStreaming && (
                              <span className="live-badge">LIVE {agent.streamTimecode || ''}</span>
                            )}
                            <span className="pc-meta-item">IP: {agent.localIp || 'Unknown'}</span>
                            {agent.currentScene && (
                              <span className="pc-meta-item scene-pill" title={agent.currentScene}>
                                <i className="fa-solid fa-film" style={{ marginRight: '4px' }}></i>{agent.currentScene}
                              </span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="pc-meta-row">
                              {agent.isStreaming && (
                                <span className="live-badge">LIVE {agent.streamTimecode || ''}</span>
                              )}
                              <span className="pc-id" style={{ margin: 0 }}>ID: {agent.uuid} &bull; IP: {agent.localIp || 'Unknown'}</span>
                            </div>
                            {agent.currentScene && (
                              <div className="pc-id pc-scene-line" title={agent.currentScene}>
                                <i className="fa-solid fa-film" style={{ marginRight: '5px' }}></i>Scene: {agent.currentScene}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className={statusAreaClass}>
                      <h3 className="status-text">{(agent.status || '').replace(/_/g, ' ')}</h3>
                      {!isOffline && (
                          <>
                          <div className="hw-stats">
                            <span style={{ color: agent.cpuUsage > 85 ? 'var(--warning)' : 'inherit' }}>CPU: {agent.cpuUsage || 0}%</span>
                            <span style={{ color: agent.ramUsage > 85 ? 'var(--warning)' : 'inherit' }}>RAM: {agent.ramUsage || 0}%</span>
                          </div>
                          {agent.isStreaming && agent.streamBitrate !== undefined && (
                            <div className="hw-stats" style={{ marginTop: '4px', color: (agent.streamDroppedFrames > 0 && agent.streamTotalFrames > 0 && (agent.streamDroppedFrames / agent.streamTotalFrames) > 0.05) ? 'var(--danger)' : 'var(--accent)', fontSize: '0.75rem' }}>
                               <span style={{ fontWeight: 'bold' }}>{agent.streamBitrate} Kbps</span>
                               {agent.streamDroppedFrames > 0 && <span style={{ marginLeft: '6px' }}>({agent.streamDroppedFrames} Drop)</span>}
                            </div>
                          )}
                          </>
                        )}
                        {agentUpdateProgress[agent.uuid] && (
                          <div className={`update-progress-container ${agentUpdateProgress[agent.uuid].status === 'error' ? 'error' : ''}`}>
                            <div 
                              className="update-progress-bar" 
                              style={{ 
                                width: `${agentUpdateProgress[agent.uuid].progress || 0}%`,
                                background: agentUpdateProgress[agent.uuid].status === 'error' ? 'var(--danger)' : undefined 
                              }}
                            ></div>
                            <span className="update-progress-text">
                              {agentUpdateProgress[agent.uuid].status === 'error' 
                                ? `Gagal: ${agentUpdateProgress[agent.uuid].error || 'Update gagal'}` 
                                : agentUpdateProgress[agent.uuid].status === 'installing' 
                                  ? 'Memasang update...' 
                                  : `Mengunduh ${agentUpdateProgress[agent.uuid].progress || 0}%`}
                            </span>
                          </div>
                        )}
                    </div>

                    <div className="meters">
                      <div className="meter-row" style={{ position: 'relative' }}>
                        <div className="meter-info">
                          <span className="meter-title">MIC Input</span>
                          {!isCompactMode && (
                            <span className="meter-device">{agent.micDriverName || 'Default Microphone'}</span>
                          )}
                        </div>
                        {(() => {
                          const history = (agent.micHistory && agent.micHistory.length > 0)
                            ? agent.micHistory
                            : Array(30).fill(isFinite(Number(agent.micDb)) ? Number(agent.micDb) : -60);
                          const stepX = 80 / Math.max(1, history.length - 1);
                          const points = history.map((val, i) => {
                            const num = Number(val);
                            const safeDb = (!isFinite(num) || num <= -60) ? -60 : (num >= 0 ? 0 : num);
                            const norm = (safeDb + 60) / 60; // 0.0 at -60dB, 1.0 at 0dB
                            const y = (33 - (norm * 30)).toFixed(1);
                            return `${(i * stepX).toFixed(1)},${y}`;
                          }).join(' ');

                          return (
                            <svg width="100%" height="36" viewBox="0 0 80 36" preserveAspectRatio="none" className="sparkline">
                              <polyline 
                                points={points} 
                                fill="none" 
                                stroke="#10b981" 
                                strokeWidth="2" 
                                strokeLinecap="round" 
                                strokeLinejoin="round" 
                              />
                            </svg>
                          );
                        })()}
                        
                        <div className="meter-db-value">
                          {isFinite(Number(agent.micDb)) ? Number(agent.micDb).toFixed(1) + ' dB' : '-60.0 dB'}
                        </div>
                        {agent.micClipping && <span className="clipping-tag">PECAH</span>}
                      </div>

                      <div className="meter-row" style={{ opacity: (agent.obsConnected === false) ? 0.4 : 1 }}>
                        <div className="meter-info">
                          <span className="meter-title">OBS Output</span>
                          {!isCompactMode && (
                            <span className="meter-device">
                              {agent.obsConnected === false ? 'Terputus dari OBS' : (agent.obsSourceName || 'Mic/Aux')}
                              {agent.obsConnected !== false && agent.obsSources && agent.obsSources.find(s => s.name === agent.obsSourceName) && (() => {
                                const hw = agent.obsSources.find(s => s.name === agent.obsSourceName).hardwareId;
                                const displayHw = (hw === 'Unknown' || hw === 'default' || hw === 'Default') ? (agent.micDriverName ? agent.micDriverName : hw) : hw;
                                return <span style={{ color: '#888' }}> - {displayHw}</span>;
                              })()}
                            </span>
                          )}
                        </div>
                        {(() => {
                          const history = (agent.obsHistory && agent.obsHistory.length > 0)
                            ? agent.obsHistory
                            : Array(30).fill(isFinite(Number(agent.obsDb)) ? Number(agent.obsDb) : -60);
                          const stepX = 80 / Math.max(1, history.length - 1);
                          const points = history.map((val, i) => {
                            const num = Number(val);
                            const safeDb = (!isFinite(num) || num <= -60) ? -60 : (num >= 0 ? 0 : num);
                            const norm = (safeDb + 60) / 60;
                            const y = (33 - (norm * 30)).toFixed(1);
                            return `${(i * stepX).toFixed(1)},${y}`;
                          }).join(' ');

                          return (
                            <svg width="100%" height="36" viewBox="0 0 80 36" preserveAspectRatio="none" className="sparkline">
                              {agent.obsConnected === false ? (
                                <line x1="0" y1="18" x2="80" y2="18" stroke="var(--danger)" strokeWidth="2" strokeDasharray="4 2" />
                              ) : agent.isObsMutedBtn ? (
                                <line x1="0" y1="33" x2="80" y2="33" stroke="var(--warning)" strokeWidth="2" />
                              ) : (
                                <polyline 
                                  points={points} 
                                  fill="none" 
                                  stroke="#3b82f6" 
                                  strokeWidth="2" 
                                  strokeLinecap="round" 
                                  strokeLinejoin="round" 
                                />
                              )}
                            </svg>
                          );
                        })()}
                        <div className="meter-db-value" style={{ color: agent.obsConnected === false ? 'var(--danger)' : (agent.isObsMutedBtn ? 'var(--warning)' : undefined) }}>
                          {agent.obsConnected === false ? 'DISCONNECTED' : (agent.isObsMutedBtn ? 'MUTED' : (isFinite(Number(agent.obsDb)) ? Number(agent.obsDb).toFixed(1) + ' dB' : '-60.0 dB'))}
                        </div>
                      </div>
                    </div>

                    {/* Audio Engineering & Spectrum Visualizer */}
                    <div style={{ padding: '6px 14px 10px 14px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '5px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <i className="fa-solid fa-wave-square" style={{ color: '#38bdf8' }}></i>
                          <span>Loudness: <strong style={{ color: agent.lufs !== undefined && agent.lufs >= -18 && agent.lufs <= -10 ? '#4ade80' : (agent.lufs > -10 ? '#f87171' : '#fbbf24') }}>{agent.lufs !== undefined && agent.lufs > -70 ? `${agent.lufs.toFixed(1)} LUFS` : 'Hening'}</strong></span>
                        </span>
                        <span>Peak: <strong style={{ color: agent.truePeak !== undefined && agent.truePeak >= -1 ? '#f87171' : 'var(--text-main)' }}>{agent.truePeak !== undefined && agent.truePeak > -90 ? `${agent.truePeak.toFixed(1)} dBFS` : '-'}</strong></span>
                        {agent.humDetected && (
                          <span style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171', padding: '1px 5px', borderRadius: '4px', fontWeight: 'bold' }}>
                            HUM {agent.humDetected}!
                          </span>
                        )}
                      </div>

                      {/* 8-Band Equalizer Spectrum */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '3px', height: '18px', alignItems: 'flex-end', background: 'rgba(0,0,0,0.25)', padding: '2px', borderRadius: '4px' }}>
                        {((agent.spectrum8Band && agent.spectrum8Band.length === 8) ? agent.spectrum8Band : [0,0,0,0,0,0,0,0]).map((bandVal, bIdx) => {
                          const heightPct = Math.max(8, Math.min(100, isOffline ? 8 : bandVal));
                          const bandColors = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#84cc16', '#eab308', '#f97316', '#ef4444'];
                          return (
                            <div 
                              key={bIdx} 
                              style={{ 
                                height: `${heightPct}%`, 
                                background: isOffline ? 'rgba(255,255,255,0.1)' : bandColors[bIdx], 
                                borderRadius: '1px',
                                transition: 'height 0.1s ease'
                              }}
                              title={`Band ${bIdx + 1}: ${bandVal}%`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    <div className="card-footer">
                      <span>{isOffline ? 'Terputus' : 'Tersambung via WebSocket'}</span>
                      <span>Update: {agent.timestamp ? new Date(agent.timestamp).toLocaleTimeString() : '-'}</span>
                    </div>
    </div>
  );
})}
              {sortedFilteredAgents.length === 0 && (
                <div style={{ color: 'var(--text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '40px' }}>Tidak ada agen yang sesuai filter.</div>
              )}
            </div>
          </>
        )}

        {currentView === 'logs' && (() => {
          // Hitung statistik ringkasan dari data logs yang sudah terfilter
          const totalIncidents = logs.length;
          const pcCounts = {};
          const typeCounts = {};
          const dayCounts = {};
          
          logs.forEach(log => {
            if (log.pcName) pcCounts[log.pcName] = (pcCounts[log.pcName] || 0) + 1;
            const t = (log.incidentType || log.status || 'UNKNOWN').toUpperCase();
            if (t !== 'RECOVERY' && t !== 'AMAN') typeCounts[t] = (typeCounts[t] || 0) + 1;
            const day = (log.timestamp || '').substring(0, 10);
            if (day) dayCounts[day] = (dayCounts[day] || 0) + 1;
          });

          // Sort arrays for display
          const affectedPcs = Object.keys(pcCounts);
          const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
          const worstDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
          
          // Chart Data (sorted by date ISO string ascending)
          const chartData = Object.entries(dayCounts)
            .sort(([dA], [dB]) => dA.localeCompare(dB))
            .map(([date, count]) => ({ date: new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }), count }));

          // Top Offenders Table Data
          const topOffenders = Object.entries(pcCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          // Pagination logic with auto-clamping
          const totalPages = Math.ceil(logs.length / logsPerPage) || 1;
          const safePage = Math.min(Math.max(1, incidentPage), totalPages);
          const indexOfLastLog = safePage * logsPerPage;
          const indexOfFirstLog = indexOfLastLog - logsPerPage;
          const currentLogs = logs.slice(indexOfFirstLog, indexOfLastLog);

          return (
          <div className="settings-layout" style={{ maxWidth: '1100px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h1 className="settings-header" style={{ marginBottom: 0 }}>Incident Logs</h1>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn-primary" onClick={exportToCSV} style={{ background: '#10b981' }}><i className="fa-solid fa-file-csv"></i> Unduh CSV</button>
                    <button className="btn-primary" onClick={() => { setShowSystemLogs(true); fetchSystemLogs(); }}><i className="fa-solid fa-terminal"></i> System Logs</button>
                  </div>
                </div>
              <p className="settings-desc">Rekam jejak dan analisis masalah audio dari seluruh PC.</p>
            </div>

            {/* Quick Filters */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '-16px' }}>
              <button className="btn-filter secondary" onClick={() => setQuickFilter(0)}>Hari Ini</button>
              <button className="btn-filter secondary" onClick={() => setQuickFilter(7)}>7 Hari Terakhir</button>
              <button className="btn-filter secondary" onClick={() => setQuickFilter(30)}>30 Hari Terakhir</button>
            </div>

            {/* Filter Bar */}
            <div className="settings-card">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content" style={{ padding: '0' }}>
                <div className="incident-filter-bar">
                  <div className="incident-filter-group">
                    <label>Tanggal Mulai</label>
                    <input type="date" className="incident-filter-input" value={incidentStartDate} onChange={e => setIncidentStartDate(e.target.value)} />
                  </div>
                  <div className="incident-filter-group">
                    <label>Tanggal Akhir</label>
                    <input type="date" className="incident-filter-input" value={incidentEndDate} onChange={e => setIncidentEndDate(e.target.value)} />
                  </div>
                  <div className="incident-filter-group">
                    <label>Nama PC</label>
                    <select className="incident-filter-input" value={incidentPcFilter} onChange={e => setIncidentPcFilter(e.target.value)}>
                      <option value="">Semua PC</option>
                      {incidentPcNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                  <div className="incident-filter-group">
                    <label>Status</label>
                    <select className="incident-filter-input" value={incidentStatusFilter} onChange={e => setIncidentStatusFilter(e.target.value)}>
                      <option value="">Semua Status</option>
                      <option value="BAHAYA">BAHAYA</option>
                      <option value="OFFLINE">OFFLINE</option>
                      <option value="RECOVERY">RECOVERY</option>
                    </select>
                  </div>
                  <div className="incident-filter-actions">
                    <button className="btn-filter primary" onClick={applyIncidentFilters}><i className="fa-solid fa-search"></i> Terapkan</button>
                    <button className="btn-filter secondary" onClick={resetIncidentFilters}><i className="fa-solid fa-rotate-left"></i> Reset</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="incident-summary-grid">
              <div className="incident-summary-card">
                <div className="summary-icon"><i className="fa-solid fa-list"></i> Total Insiden</div>
                <div className="summary-value">{totalIncidents}</div>
                <div className="summary-label">kejadian tercatat</div>
              </div>
              <div className="incident-summary-card red">
                <div className="summary-icon"><i className="fa-solid fa-desktop"></i> PC Terkena</div>
                <div className="summary-value">{affectedPcs.length}</div>
                <div className="summary-detail">{affectedPcs.length > 0 ? (() => {
                  const sorted = affectedPcs.sort((a, b) => pcCounts[b] - pcCounts[a]);
                  const top3 = sorted.slice(0, 3).map(pc => `${pc} (${pcCounts[pc]})`).join(', ');
                  const rest = sorted.length - 3;
                  return rest > 0 ? `${top3}, +${rest} lainnya` : top3;
                })() : '-'}</div>
              </div>
              <div className="incident-summary-card orange">
                <div className="summary-icon"><i className="fa-solid fa-triangle-exclamation"></i> Tipe Terbanyak</div>
                <div className="summary-value" style={{ fontSize: topType ? '1.1rem' : '1.8rem' }}>{topType ? topType[0].replace(/_/g, ' ') : '-'}</div>
                <div className="summary-detail">{topType ? `${topType[1]} kejadian` : 'Belum ada data'}</div>
              </div>
              <div className="incident-summary-card purple">
                <div className="summary-icon"><i className="fa-solid fa-calendar-xmark"></i> Hari Terburuk</div>
                <div className="summary-value" style={{ fontSize: worstDay ? '1.2rem' : '1.8rem' }}>{worstDay ? new Date(worstDay[0]).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</div>
                <div className="summary-detail">{worstDay ? `${worstDay[1]} insiden di hari itu` : 'Belum ada data'}</div>
              </div>
            </div>

            {/* Complex Grid: Chart & Top Offenders */}
            <div className="incident-complex-grid">
              {/* Chart */}
              <div className="settings-card">
                <div className="settings-card-content">
                  <h3 className="settings-card-title">Tren Insiden Harian</h3>
                  <div style={{ width: '100%', height: 250, marginTop: '20px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="date" stroke="#888" fontSize={12} tickMargin={10} />
                        <YAxis stroke="#888" fontSize={12} allowDecimals={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e1e1e', borderColor: '#333' }} />
                        <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Jumlah Insiden" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Top Offenders */}
              <div className="settings-card">
                <div className="settings-card-content" style={{ padding: '0' }}>
                  <div style={{ padding: '24px 24px 12px 24px' }}>
                    <h3 className="settings-card-title">PC Paling Bermasalah (Top 5)</h3>
                  </div>
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>Nama PC</th>
                        <th style={{ textAlign: 'right' }}>Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topOffenders.map(([pc, count]) => (
                        <tr key={pc}>
                          <td><strong>{pc}</strong></td>
                          <td style={{ textAlign: 'right' }}><span className="log-danger">{count}x</span></td>
                        </tr>
                      ))}
                      {topOffenders.length === 0 && (
                        <tr><td colSpan="2" style={{textAlign: 'center', color: 'var(--text-muted)'}}>Belum ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            
            {/* Tabel Insiden */}
            <div className="settings-card">
              <div className="settings-card-accent orange"></div>
              <div className="settings-card-content" style={{ padding: '0' }}>
                <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className="settings-card-title" style={{ margin: 0 }}>Riwayat Insiden</h3>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {totalIncidents === 0 
                      ? 'Menampilkan 0 dari 0' 
                      : `Menampilkan ${indexOfFirstLog + 1}-${Math.min(indexOfLastLog, totalIncidents)} dari ${totalIncidents}`
                    }
                  </div>
                </div>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Waktu Kejadian</th>
                      <th>PC / UUID</th>
                      <th>Status Peringatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentLogs.map((log, i) => (
                      <tr key={log.id || `${log.uuid}-${log.timestamp}-${i}`}>
                        <td>{new Date(log.timestamp).toLocaleString()}</td>
                        <td><strong>{log.pcName}</strong><br/><span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace" }}>{log.uuid}</span></td>
                        <td><span className={getLogClass(log.incidentType || log.status)}>{log.incidentType || log.status || "UNKNOWN"}</span><div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>{log.details}</div></td>
                      </tr>
                    ))}
                    {currentLogs.length === 0 && (
                      <tr><td colSpan="3" style={{textAlign: 'center', color: 'var(--text-muted)'}}>Belum ada insiden tercatat dalam rentang waktu ini.</td></tr>
                    )}
                  </tbody>
                </table>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="pagination-controls">
                    <button className="btn-page" disabled={safePage === 1} onClick={() => setIncidentPage(Math.max(1, safePage - 1))}><i className="fa-solid fa-chevron-left"></i></button>
                    <span className="page-info">Halaman {safePage} dari {totalPages}</span>
                    <button className="btn-page" disabled={safePage === totalPages} onClick={() => setIncidentPage(Math.min(totalPages, safePage + 1))}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {currentView === 'records' && (() => {
          // 1. Group and filter raw records by date & PC filter
          const pcGrouped = {};
          records.forEach(r => {
            if (recordPcFilter && r.pcName !== recordPcFilter) return;

            const dateStr = r.isParsed 
              ? r.dateStr 
              : getLocalDateStr(new Date(r.createdAt));

            if (recordStartDate && dateStr < recordStartDate) return;
            if (recordEndDate && dateStr > recordEndDate) return;

            if (!pcGrouped[r.pcName]) {
              pcGrouped[r.pcName] = {
                uuid: r.uuid || '',
                sessions: {}
              };
            }
            if (!pcGrouped[r.pcName].uuid && r.uuid) {
              pcGrouped[r.pcName].uuid = r.uuid;
            }
            
            const sessionKey = r.baseSessionKey || (r.folderName ? r.folderName.replace(/_to_\d{2}-\d{2}-\d{2}$/i, '') : r.folderName);
            if (!pcGrouped[r.pcName].sessions[sessionKey]) {
              pcGrouped[r.pcName].sessions[sessionKey] = {
                sessionKey,
                folderName: r.folderName,
                pcName: r.pcName,
                uuid: r.uuid,
                isParsed: r.isParsed,
                isCompleted: r.isCompleted || (r.folderName && r.folderName.includes('_to_')),
                dateStr: r.dateStr,
                timeStr: r.timeStr,
                startTime: r.startTime,
                endTime: r.endTime,
                createdAt: r.createdAt,
                totalSize: 0,
                hasTranscript: false,
                hasAlertKeyword: false,
                transcriptSnippet: '',
                keywordsFound: [],
                parts: []
              };
            }
            
            const sess = pcGrouped[r.pcName].sessions[sessionKey];
            const isThisRecordCompleted = r.isCompleted || (r.folderName && r.folderName.includes('_to_'));
            if (isThisRecordCompleted && !sess.isCompleted) {
              sess.isCompleted = true;
              sess.timeStr = r.timeStr;
              sess.folderName = r.folderName;
              sess.startTime = r.startTime || sess.startTime;
              sess.endTime = r.endTime || sess.endTime;
            }

            sess.totalSize += (r.size || 0);
            if (r.hasTranscript) sess.hasTranscript = true;
            if (r.transcriptSnippet && !sess.transcriptSnippet) {
              sess.transcriptSnippet = r.transcriptSnippet;
            }
            if (Array.isArray(r.keywordsFound) && r.keywordsFound.length > 0) {
              sess.hasAlertKeyword = true;
              sess.keywordsFound = [...new Set([...sess.keywordsFound, ...r.keywordsFound])];
            }
            sess.parts.push(r);
          });

          // Sort parts inside each session by fileName
          Object.values(pcGrouped).forEach(pcData => {
            Object.values(pcData.sessions).forEach(sess => {
              sess.parts.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));
            });
          });

          // Aggregate all sessions for overall summary stats
          const allSessions = [];
          Object.values(pcGrouped).forEach(pcData => {
            Object.values(pcData.sessions).forEach(sess => {
              allSessions.push(sess);
            });
          });

          const totalSessionCount = allSessions.length;
          const totalPartCount = allSessions.reduce((acc, s) => acc + s.parts.length, 0);
          const totalStorageBytes = allSessions.reduce((acc, s) => acc + s.totalSize, 0);
          const totalTranscribedSessions = allSessions.filter(s => s.hasTranscript).length;
          const totalAlertSessions = allSessions.filter(s => s.hasAlertKeyword).length;
          const transcriptCoveragePct = totalSessionCount > 0 ? Math.round((totalTranscribedSessions / totalSessionCount) * 100) : 0;

          const pcNames = Object.keys(pcGrouped);

          return (
            <div className="settings-layout" style={{ maxWidth: '1050px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <h1 className="settings-header" style={{ marginBottom: 0 }}>File Rekaman</h1>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      className="btn-filter secondary" 
                      onClick={() => handleCleanHostStorage('all')} 
                      style={{ color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.4)' }}
                      title="Hapus file audio lokal di PC Host Agent yang SUDAH BERHASIL TERUPLOAD ke Server"
                    >
                      <i className="fa-solid fa-broom"></i> Bersihkan Audio di PC Host
                    </button>
                    <button className="btn-filter secondary" onClick={fetchRecords} disabled={loadingRecords}>
                      <i className={`fa-solid fa-rotate ${loadingRecords ? 'fa-spin' : ''}`}></i> Muat Ulang
                    </button>
                  </div>
                </div>
                <p className="settings-desc">Daftar rekaman insiden suara berdasarkan sesi kejadian. Potongan audio (part) dapat diputar berurutan secara otomatis.</p>
              </div>

              {/* 1. Summary Stats Cards */}
              <div className="record-stats-grid">
                <div className="record-stat-card">
                  <div className="stat-icon-wrap blue">
                    <i className="fa-solid fa-folder-open"></i>
                  </div>
                  <div className="stat-info">
                    <div className="stat-val">{totalSessionCount}</div>
                    <div className="stat-label">Total Sesi Kejadian</div>
                    <div className="stat-sub">{totalPartCount} Total Potongan Audio</div>
                  </div>
                </div>

                <div className="record-stat-card">
                  <div className="stat-icon-wrap purple">
                    <i className="fa-solid fa-hard-drive"></i>
                  </div>
                  <div className="stat-info">
                    <div className="stat-val">{(totalStorageBytes / 1024 / 1024).toFixed(2)} MB</div>
                    <div className="stat-label">Total Penyimpanan</div>
                    <div className="stat-sub">Format WebM Opus (~32kbps)</div>
                  </div>
                </div>

                <div className="record-stat-card">
                  <div className="stat-icon-wrap green">
                    <i className="fa-solid fa-file-waveform"></i>
                  </div>
                  <div className="stat-info">
                    <div className="stat-val">{totalTranscribedSessions} / {totalSessionCount}</div>
                    <div className="stat-label">Transkrip AI Siap</div>
                    <div className="stat-sub">{transcriptCoveragePct}% Selesai Diproses</div>
                  </div>
                </div>

                <div className="record-stat-card">
                  <div className={`stat-icon-wrap ${totalAlertSessions > 0 ? 'red' : 'amber'}`}>
                    <i className="fa-solid fa-triangle-exclamation"></i>
                  </div>
                  <div className="stat-info">
                    <div className="stat-val" style={{ color: totalAlertSessions > 0 ? '#f87171' : 'inherit' }}>
                      {totalAlertSessions} Sesi
                    </div>
                    <div className="stat-label">Kata Bahaya</div>
                    <div className="stat-sub">{totalAlertSessions > 0 ? 'Perlu Tinjauan Khusus' : 'Tidak Terindikasi'}</div>
                  </div>
                </div>
              </div>

              {/* 2. Search Transcripts Bar */}
              <div className="transcript-search-wrapper" style={{ margin: '0' }}>
                <i className="fa-solid fa-magnifying-glass transcript-search-icon"></i>
                <input
                  type="text"
                  className="transcript-search-input"
                  placeholder="Cari kata kunci dalam transkrip percakapan rekaman..."
                  value={transcriptSearchQuery}
                  onChange={e => handleSearchTranscripts(e.target.value)}
                />
                {isSearchingTranscript && (
                  <div style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--accent)', fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-spinner fa-spin"></i> Mencari...
                  </div>
                )}

                {transcriptSearchQuery.trim() && !isSearchingTranscript && transcriptSearchResults.length === 0 && (
                  <div className="transcript-search-results-box" style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-circle-info" style={{ marginRight: '6px' }}></i> Tidak ada transkrip yang cocok dengan "{transcriptSearchQuery}" pada filter yang dipilih.
                  </div>
                )}

                {transcriptSearchResults.length > 0 && (
                  <div className="transcript-search-results-box">
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div>
                        Ditemukan {transcriptSearchResults.length} file rekaman yang mengandung "{transcriptSearchQuery}"
                        {(recordStartDate || recordEndDate || recordPcFilter) && (
                          <span style={{ color: 'var(--accent)', marginLeft: '6px', fontWeight: 'normal' }}>
                            (Filter: {[
                              recordPcFilter ? `PC: ${recordPcFilter}` : '',
                              recordStartDate ? `Mulai: ${recordStartDate}` : '',
                              recordEndDate ? `Akhir: ${recordEndDate}` : ''
                            ].filter(Boolean).join(' | ')})
                          </span>
                        )}:
                      </div>
                      <button 
                        className="btn-filter secondary" 
                        style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                        onClick={() => {
                          setTranscriptSearchQuery('');
                          setTranscriptSearchResults([]);
                        }}
                      >
                        <i className="fa-solid fa-xmark"></i> Tutup
                      </button>
                    </div>
                    {transcriptSearchResults.map((res, rIdx) => (
                      <div key={`${res.folderName}-${res.fileName}-${rIdx}`} className="transcript-search-result-item">
                        <div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--accent)' }}>
                            <i className="fa-solid fa-desktop" style={{ marginRight: '6px' }}></i> {res.pcName} &bull; <span style={{ color: '#fff' }}>{res.fileName}</span>
                            {res.dateStr && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '8px', fontWeight: 'normal' }}>({res.dateStr})</span>}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {res.segments && res.segments.map((seg, sIdx) => {
                              const validSec = typeof seg.start === 'number' ? Math.max(0, seg.start) : 0;
                              const m = Math.floor(validSec / 60);
                              const s = Math.floor(validSec % 60);
                              const timeStr = `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}]`;
                              return (
                                <span key={`${seg.start || 0}-${sIdx}`} style={{ marginRight: '10px' }}>
                                  <strong style={{ color: '#60a5fa' }}>{timeStr}</strong> {seg.text}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <button 
                          className="btn-filter primary" 
                          style={{ padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                          onClick={() => openTranscriptModal(res.folderName, res.fileName, res.pcName)}
                        >
                          <i className="fa-solid fa-file-lines"></i> Buka Transkrip
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. Quick Date Range Presets */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '-16px', flexWrap: 'wrap' }}>
                <button className="btn-filter secondary" onClick={() => {
                  const today = getLocalDateStr();
                  setRecordStartDate(today);
                  setRecordEndDate(today);
                }}>Hari Ini</button>
                <button className="btn-filter secondary" onClick={() => {
                  const end = getLocalDateStr();
                  const start = new Date();
                  start.setDate(start.getDate() - 7);
                  setRecordStartDate(getLocalDateStr(start));
                  setRecordEndDate(end);
                }}>7 Hari Terakhir</button>
                <button className="btn-filter secondary" onClick={() => {
                  const end = getLocalDateStr();
                  const start = new Date();
                  start.setDate(start.getDate() - 30);
                  setRecordStartDate(getLocalDateStr(start));
                  setRecordEndDate(end);
                }}>30 Hari Terakhir</button>
                {(recordStartDate || recordEndDate || recordPcFilter) && (
                  <button className="btn-filter primary" onClick={() => {
                    setRecordStartDate('');
                    setRecordEndDate('');
                    setRecordPcFilter('');
                  }}>
                    <i className="fa-solid fa-filter-circle-xmark"></i> Tampilkan Semua
                  </button>
                )}
              </div>

              {/* 4. Filter Bar */}
              <div className="settings-card">
                <div className="settings-card-accent blue"></div>
                <div className="settings-card-content" style={{ padding: '0' }}>
                  <div className="incident-filter-bar">
                    <div className="incident-filter-group">
                      <label>Tanggal Mulai</label>
                      <input 
                        type="date" 
                        className="incident-filter-input" 
                        value={recordStartDate} 
                        onChange={e => setRecordStartDate(e.target.value)} 
                      />
                    </div>
                    <div className="incident-filter-group">
                      <label>Tanggal Akhir</label>
                      <input 
                        type="date" 
                        className="incident-filter-input" 
                        value={recordEndDate} 
                        onChange={e => setRecordEndDate(e.target.value)} 
                      />
                    </div>
                    <div className="incident-filter-group">
                      <label>Filter PC</label>
                      <select 
                        className="incident-filter-input" 
                        value={recordPcFilter} 
                        onChange={e => setRecordPcFilter(e.target.value)}
                      >
                        <option value="">Semua PC</option>
                        {[...new Set(records.map(r => r.pcName).filter(Boolean))].sort().map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="incident-filter-actions">
                      <button 
                        className="btn-filter secondary" 
                        onClick={() => {
                          setRecordStartDate('');
                          setRecordEndDate('');
                          setRecordPcFilter('');
                        }}
                      >
                        <i className="fa-solid fa-rotate-left"></i> Reset
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Whisper STT Queue Indicator */}
              {(whisperQueueStatus.isProcessing || whisperQueueStatus.queueLength > 0) && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '10px 16px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '8px', marginBottom: '14px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#93c5fd' }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ color: '#60a5fa', fontSize: '1rem' }}></i>
                    <span>
                      <strong>Antrean Whisper STT:</strong> {whisperQueueStatus.isProcessing ? `Sedang memproses ${whisperQueueStatus.currentTask?.fileName || 'audio'} (${whisperQueueStatus.currentTask?.pcName || 'PC'})` : 'Standby'}
                    </span>
                  </div>
                  {whisperQueueStatus.queueLength > 0 && (
                    <span style={{ padding: '2px 8px', background: 'rgba(59, 130, 246, 0.2)', color: '#bfdbfe', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                      <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '4px' }}></i> {whisperQueueStatus.queueLength} File Menunggu Antrean
                    </span>
                  )}
                </div>
              )}

              {/* 5. Status Filter Pills, View Switcher & Toolbar */}
              <div className="record-filter-toolbar">
                <div className="status-pills-wrap">
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Status:</span>
                  <button 
                    className={`status-pill-btn ${recordStatusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setRecordStatusFilter('all')}
                  >
                    Semua ({totalSessionCount})
                  </button>
                  <button 
                    className={`status-pill-btn ${recordStatusFilter === 'ready' ? 'active' : ''}`}
                    onClick={() => setRecordStatusFilter('ready')}
                  >
                    <i className="fa-solid fa-check" style={{ color: '#34d399' }}></i> Transkrip Siap ({totalTranscribedSessions})
                  </button>
                  <button 
                    className={`status-pill-btn ${recordStatusFilter === 'none' ? 'active' : ''}`}
                    onClick={() => setRecordStatusFilter('none')}
                  >
                    <i className="fa-solid fa-circle-question" style={{ color: 'var(--text-muted)' }}></i> Belum Ditranskrip ({totalSessionCount - totalTranscribedSessions})
                  </button>
                  <button 
                    className={`status-pill-btn alert ${recordStatusFilter === 'alert' ? 'active' : ''}`}
                    onClick={() => setRecordStatusFilter('alert')}
                  >
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#f87171' }}></i> Kata Bahaya ({totalAlertSessions})
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* View Mode Toggle (Detail vs Compact) */}
                  <div className="view-layout-toggle" title="Pilih Format Tampilan Sesi">
                    <button 
                      className={`view-layout-btn ${recordViewLayout === 'detailed' ? 'active' : ''}`}
                      onClick={() => setRecordViewLayout('detailed')}
                    >
                      <i className="fa-solid fa-table-cells-large"></i> Detail
                    </button>
                    <button 
                      className={`view-layout-btn ${recordViewLayout === 'compact' ? 'active' : ''}`}
                      onClick={() => setRecordViewLayout('compact')}
                    >
                      <i className="fa-solid fa-list"></i> Ringkas
                    </button>
                  </div>

                  {/* Collapse All Toggle */}
                  {pcNames.length > 0 && (
                    <button 
                      className="btn-filter secondary" 
                      style={{ padding: '4px 10px', fontSize: '0.75rem', height: '30px' }}
                      onClick={() => {
                        const allCollapsed = pcNames.every(pc => collapsedPcs[pc]);
                        const next = {};
                        pcNames.forEach(pc => { next[pc] = !allCollapsed; });
                        setCollapsedPcs(next);
                      }}
                      title={pcNames.every(pc => collapsedPcs[pc]) ? 'Buka semua daftar PC' : 'Tutup/Minimize semua daftar PC'}
                    >
                      <i className={`fa-solid fa-${pcNames.every(pc => collapsedPcs[pc]) ? 'folder-open' : 'folder'}`}></i>
                      <span style={{ marginLeft: '4px' }}>{pcNames.every(pc => collapsedPcs[pc]) ? 'Buka Semua' : 'Tutup Semua'}</span>
                    </button>
                  )}

                  {/* Pagination Per Page Dropdown */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Per Hal:</span>
                    <select
                      className="incident-filter-input"
                      style={{ minWidth: '70px', padding: '4px 8px', fontSize: '0.8rem', height: '30px' }}
                      value={sessionsPerPage === 0 ? 'all' : String(sessionsPerPage)}
                      onChange={e => {
                        const val = e.target.value === 'all' ? 0 : parseInt(e.target.value, 10);
                        setSessionsPerPage(val);
                      }}
                    >
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="all">Semua</option>
                    </select>
                  </div>

                  {/* Sort Selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Urutkan:</span>
                    <select
                      className="incident-filter-input"
                      style={{ minWidth: '135px', padding: '4px 8px', fontSize: '0.8rem', height: '30px' }}
                      value={recordSortOrder}
                      onChange={e => setRecordSortOrder(e.target.value)}
                    >
                      <option value="newest">Waktu Terbaru</option>
                      <option value="oldest">Waktu Terlama</option>
                      <option value="duration_desc">Durasi Terpanjang</option>
                      <option value="size_desc">Ukuran Terbesar</option>
                    </select>
                  </div>
                </div>
              </div>
              
              {/* Unified Continuous Timeline Audio Player */}
              {playingSession && playingSession.parts && playingSession.parts[currentPartIndex] && (
                <div className="settings-card unified-player-card" style={{ marginBottom: '24px', background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.35)' }}>
                  <div className="settings-card-content" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Hidden underlying audio element */}
                    <audio 
                      ref={audioRef}
                      key={playingSession.parts[currentPartIndex].url}
                      src={getMediaUrl(playingSession.parts[currentPartIndex].url)}
                      onLoadedMetadata={handleAudioLoadedMetadata}
                      onTimeUpdate={handleAudioTimeUpdate}
                      onEnded={handleAudioEnded}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onError={(e) => {
                        console.error('Audio playback error:', e);
                        customAlert('Gagal memuat file rekaman audio. File mungkin telah dipindahkan atau dihapus dari server.', 'Gagal Memutar Audio');
                        setPlayingSession(null);
                      }}
                    />

                    {/* Header: PC Name, Session Time, Part indicator & Close */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className="fa-solid fa-volume-high"></i>
                          <span>{playingSession.pcName}</span>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.85rem' }}>
                            &bull; {playingSession.isParsed ? `${playingSession.dateStr} (${playingSession.timeStr})` : new Date(playingSession.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Memutar rekaman utuh (Sedang memuat Part {currentPartIndex + 1} dari {playingSession.parts.length}: <code>{playingSession.parts[currentPartIndex].fileName}</code>)
                        </div>
                      </div>
                      
                      <button 
                        className="btn-filter secondary" 
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }} 
                        onClick={() => setPlayingSession(null)}
                      >
                        <i className="fa-solid fa-xmark"></i> Tutup Player
                      </button>
                    </div>

                    {/* Main Timeline Slider */}
                    <div className="unified-timeline-container">
                      <input 
                        type="range" 
                        className="range-slider unified-seekbar"
                        min="0" 
                        max={totalSessionDuration > 0 ? totalSessionDuration : 100} 
                        step="0.1" 
                        value={globalCurrentTime}
                        onChange={e => handleGlobalSeek(parseFloat(e.target.value))}
                        style={{ width: '100%', margin: '8px 0', cursor: 'pointer' }}
                      />

                      {/* Timeline Part Markers */}
                      {playingSession.parts.length > 1 && totalSessionDuration > 0 && (
                        <div className="timeline-segment-markers">
                          {playingSession.parts.map((p, idx) => {
                            const pDur = partDurations[idx] || 0;
                            const pPct = (pDur / totalSessionDuration) * 100;
                            const isPartActive = currentPartIndex === idx;

                            return (
                              <div 
                                key={`${p.url || ''}-${idx}`} 
                                className={`timeline-segment ${isPartActive ? 'active' : ''}`} 
                                style={{ width: `${pPct}%` }}
                                onClick={() => handleGlobalSeek(startOffsets[idx] || 0)}
                                title={`Lompat ke Part ${idx + 1}`}
                              >
                                <span>Part {idx + 1}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Player Controls Bar: Play/Pause, -10s, +10s, Time Display, Speed */}
                    <div className="player-controls-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button 
                          className="player-btn-action" 
                          onClick={() => handleGlobalSeek(globalCurrentTime - 10)}
                          title="Mundur 10 detik"
                        >
                          <i className="fa-solid fa-rotate-left"></i>
                          <span style={{ fontSize: '0.7rem', marginLeft: '3px' }}>10s</span>
                        </button>

                        <button 
                          className="player-btn-play" 
                          onClick={togglePlayPause}
                          title={isPlaying ? "Jeda (Pause)" : "Putar (Play)"}
                        >
                          {isPlaying ? <i className="fa-solid fa-pause"></i> : <i className="fa-solid fa-play" style={{ marginLeft: '2px' }}></i>}
                        </button>

                        <button 
                          className="player-btn-action" 
                          onClick={() => handleGlobalSeek(globalCurrentTime + 10)}
                          title="Maju 10 detik"
                        >
                          <i className="fa-solid fa-rotate-right"></i>
                          <span style={{ fontSize: '0.7rem', marginLeft: '3px' }}>10s</span>
                        </button>

                        {/* Time text */}
                        <div className="player-time-display">
                          <span className="current-time">{formatPlaybackTime(globalCurrentTime)}</span>
                          <span className="separator">/</span>
                          <span className="total-time">{formatPlaybackTime(totalSessionDuration)}</span>
                        </div>
                      </div>

                      {/* Speed Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Kecepatan:</span>
                        {[1, 1.25, 1.5, 2].map(speed => (
                          <button
                            key={speed}
                            className={`btn-speed ${playbackRate === speed ? 'active' : ''}`}
                            onClick={() => handleSpeedChange(speed)}
                          >
                            {speed}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 6. PC Grouped Session Cards */}
              {pcNames.length === 0 ? (
                <div className="settings-card">
                  <div className="settings-card-content" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                    <i className="fa-solid fa-folder-open" style={{ fontSize: '2rem', marginBottom: '10px', opacity: 0.5 }}></i>
                    <div>
                      {recordPcFilter 
                        ? `Tidak ada file rekaman untuk PC "${recordPcFilter}".` 
                        : 'Belum ada file rekaman yang tersimpan di server.'}
                    </div>
                  </div>
                </div>
              ) : (
                pcNames.map(pc => {
                  const pcData = pcGrouped[pc];
                  let sessions = Object.values(pcData.sessions);

                  // Apply Status Filter
                  if (recordStatusFilter === 'ready') {
                    sessions = sessions.filter(s => s.hasTranscript);
                  } else if (recordStatusFilter === 'none') {
                    sessions = sessions.filter(s => !s.hasTranscript);
                  } else if (recordStatusFilter === 'alert') {
                    sessions = sessions.filter(s => s.hasAlertKeyword);
                  }

                  // Apply Sort Order
                  sessions.sort((a, b) => {
                    if (recordSortOrder === 'oldest') {
                      return new Date(a.createdAt) - new Date(b.createdAt);
                    } else if (recordSortOrder === 'size_desc') {
                      return b.totalSize - a.totalSize;
                    } else if (recordSortOrder === 'duration_desc') {
                      return calculateSessionDuration(b) - calculateSessionDuration(a);
                    }
                    return new Date(b.createdAt) - new Date(a.createdAt); // newest
                  });

                  const totalPcParts = sessions.reduce((acc, s) => acc + s.parts.length, 0);
                  const totalPcStorage = sessions.reduce((acc, s) => acc + s.totalSize, 0);
                  const totalPcTranscripts = sessions.filter(s => s.hasTranscript).length;
                  const totalPcAlerts = sessions.filter(s => s.hasAlertKeyword).length;

                  if (sessions.length === 0 && recordStatusFilter !== 'all') {
                    return null; // Skip PC if no sessions match status filter
                  }

                  const isPcCollapsed = !!collapsedPcs[pc];

                  // Pagination Calculation per PC
                  const totalSessions = sessions.length;
                  const currentPage = pcSessionPages[pc] || 1;
                  const limit = sessionsPerPage > 0 ? sessionsPerPage : totalSessions;
                  const totalPages = Math.ceil(totalSessions / limit) || 1;
                  const safePage = Math.min(Math.max(1, currentPage), totalPages);
                  const pagedSessions = limit >= totalSessions 
                    ? sessions 
                    : sessions.slice((safePage - 1) * limit, safePage * limit);

                  return (
                    <div className="settings-card" key={pc} style={{ marginBottom: '24px' }}>
                      <div className="settings-card-accent purple"></div>
                      <div className="settings-card-content" style={{ padding: '0' }}>
                        {/* PC Header (Collapsible / Minimize Toggle) */}
                        <div 
                          className="pc-header-collapsible"
                          onClick={() => setCollapsedPcs(prev => ({ ...prev, [pc]: !prev[pc] }))}
                          title="Klik untuk memperluas / mengecilkan daftar rekaman PC ini"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
                              <i className="fa-solid fa-desktop" style={{ marginRight: '8px', color: 'var(--accent)' }}></i> 
                              {pc} 
                            </h3>

                            {/* Summary Pills on Header */}
                            <div className="pc-summary-pills">
                              <span className="pc-summary-pill">{totalSessions} Sesi</span>
                              <span className="pc-summary-pill">{totalPcParts} Part</span>
                              <span className="pc-summary-pill">{(totalPcStorage / 1024 / 1024).toFixed(2)} MB</span>
                              {totalPcTranscripts > 0 && (
                                <span className="pc-summary-pill ready"><i className="fa-solid fa-check"></i> {totalPcTranscripts} Transkrip</span>
                              )}
                              {totalPcAlerts > 0 && (
                                <span className="pc-summary-pill alert"><i className="fa-solid fa-triangle-exclamation"></i> {totalPcAlerts} Bahaya</span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {pcData.uuid && (
                              <button
                                className="btn-filter secondary"
                                style={{ color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.4)', padding: '3px 9px', fontSize: '0.75rem', height: '28px', display: 'flex', alignItems: 'center', gap: '5px' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCleanHostStorage(pcData.uuid, pc);
                                }}
                                title={`Hapus file audio lokal di PC Host "${pc}" yang sudah terupload ke Server`}
                              >
                                <i className="fa-solid fa-trash-can"></i>
                                <span>Hapus Audio di Host</span>
                              </button>
                            )}
                            <button 
                              className="pc-collapse-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCollapsedPcs(prev => ({ ...prev, [pc]: !prev[pc] }));
                              }}
                            >
                              <span>{isPcCollapsed ? 'Buka' : 'Tutup'}</span>
                              <i className={`fa-solid fa-chevron-${isPcCollapsed ? 'down' : 'up'}`}></i>
                            </button>
                          </div>
                        </div>

                        {/* If not collapsed, render session list & pagination */}
                        {!isPcCollapsed && (
                          <>
                            {/* Session Cards List */}
                            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: recordViewLayout === 'compact' ? '8px' : '14px' }}>
                              {pagedSessions.map((session, sIdx) => {
                                const isSessionActive = playingSession?.folderName === session.folderName;
                                const sessionDurationSec = calculateSessionDuration(session);
                                const hasProcessing = session.parts.some(p => transcribingFiles[`${session.folderName}/${p.fileName}`] === 'processing');
                                const hasQueued = session.parts.some(p => transcribingFiles[`${session.folderName}/${p.fileName}`] === 'queued');

                                // COMPACT VIEW RENDERING
                                if (recordViewLayout === 'compact') {
                                  return (
                                    <div 
                                      key={session.folderName || sIdx} 
                                      className={`record-session-compact ${isSessionActive ? 'active-playing' : ''}`}
                                      style={session.hasAlertKeyword ? { borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.04)' } : {}}
                                    >
                                      <div className="compact-left">
                                        {/* Date & Time */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                                          <i className="fa-solid fa-calendar-day" style={{ color: 'var(--accent)', fontSize: '0.8rem' }}></i>
                                          <strong>{session.isParsed ? session.dateStr : new Date(session.createdAt).toLocaleDateString()}</strong>
                                          <span className="session-time-badge" style={{ fontSize: '0.78rem', padding: '1px 6px' }}>
                                            {session.isParsed ? session.timeStr : new Date(session.createdAt).toLocaleTimeString()}
                                          </span>
                                        </div>

                                        {/* Duration Pill */}
                                        {sessionDurationSec > 0 && (
                                          <span className="session-duration-pill" title="Estimasi / Durasi Rekaman Sesi">
                                            <i className="fa-solid fa-stopwatch" style={{ color: 'var(--accent)' }}></i>
                                            {formatDurationText(sessionDurationSec)}
                                          </span>
                                        )}

                                        {/* Live Ongoing Badge */}
                                        {!session.isCompleted && (
                                          <span className="live-recording-badge" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                                            <span className="live-pulse-dot"></span> LIVE
                                          </span>
                                        )}

                                        {/* Status Badge */}
                                        {session.hasAlertKeyword ? (
                                          <span className="transcript-status-badge alert" style={{ fontSize: '0.7rem' }}>
                                            <i className="fa-solid fa-triangle-exclamation"></i> {session.keywordsFound.join(', ')}
                                          </span>
                                        ) : hasProcessing ? (
                                          <span className="transcript-status-badge processing" style={{ fontSize: '0.7rem' }}>
                                            <i className="fa-solid fa-spinner fa-spin"></i> Proses
                                          </span>
                                        ) : hasQueued ? (
                                          <span className="transcript-status-badge queued" style={{ fontSize: '0.7rem' }}>
                                            <i className="fa-solid fa-clock-rotate-left"></i> Antre
                                          </span>
                                        ) : session.hasTranscript ? (
                                          <span className="transcript-status-badge ready" style={{ fontSize: '0.7rem' }}>
                                            <i className="fa-solid fa-check"></i> Siap
                                          </span>
                                        ) : (
                                          <span className="transcript-status-badge none" style={{ fontSize: '0.7rem' }}>
                                            Belum
                                          </span>
                                        )}

                                        {/* Parts & Size count */}
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                          {session.parts.length} Part ({(session.totalSize / 1024 / 1024).toFixed(2)} MB)
                                        </span>

                                        {/* Snippet Preview on Compact */}
                                        {session.transcriptSnippet && (
                                          <span 
                                            className="compact-snippet"
                                            onClick={() => openTranscriptModal(session.folderName, null, session.pcName)}
                                            title="Klik untuk membuka transkrip lengkap"
                                          >
                                            "{session.transcriptSnippet}"
                                          </span>
                                        )}
                                      </div>

                                      {/* Compact Actions */}
                                      <div className="compact-actions">
                                        {session.hasTranscript && (
                                          <button 
                                            className="btn-export-action"
                                            onClick={() => quickDownloadSessionTranscript(session, 'txt')}
                                            title="Unduh transkrip teks (.txt)"
                                          >
                                            TXT
                                          </button>
                                        )}
                                        <button 
                                          className="btn-filter secondary"
                                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                          onClick={() => openTranscriptModal(session.folderName, null, session.pcName)}
                                          title="Buka transkrip sesi ini"
                                        >
                                          <i className="fa-solid fa-file-lines"></i> Transkrip
                                        </button>
                                        <button 
                                          className="btn-filter primary"
                                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                                          onClick={() => {
                                            if (playingSession?.folderName !== session.folderName) {
                                              setPlayingSession(session);
                                            }
                                            pendingSeekOffsetRef.current = 0;
                                            setCurrentPartIndex(0);
                                            setLocalCurrentTime(0);
                                          }}
                                          title="Putar sesi ini"
                                        >
                                          <i className="fa-solid fa-play"></i> Putar
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }

                                // DETAILED VIEW RENDERING
                                return (
                                  <div 
                                    key={session.folderName || sIdx} 
                                    className={`record-session-box ${isSessionActive ? 'active-playing' : ''}`}
                                    style={session.hasAlertKeyword ? { borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.03)' } : {}}
                                  >
                                    <div className="session-box-header">
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="session-time-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                          <i className="fa-solid fa-calendar-day" style={{ color: 'var(--accent)' }}></i>
                                          <strong>{session.isParsed ? session.dateStr : new Date(session.createdAt).toLocaleDateString()}</strong>
                                          
                                          <span className="session-time-badge">
                                            <i className="fa-solid fa-clock" style={{ marginRight: '4px' }}></i>
                                            {session.isParsed ? session.timeStr : new Date(session.createdAt).toLocaleTimeString()}
                                          </span>

                                          {/* Duration Pill */}
                                          {sessionDurationSec > 0 && (
                                            <span className="session-duration-pill" title="Estimasi / Durasi Rekaman Sesi">
                                              <i className="fa-solid fa-stopwatch" style={{ color: 'var(--accent)' }}></i>
                                              {formatDurationText(sessionDurationSec)}
                                            </span>
                                          )}

                                          {/* Live Recording Badge if ongoing */}
                                          {!session.isCompleted && (
                                            <span className="live-recording-badge">
                                              <span className="live-pulse-dot"></span>
                                              MEREKAM (LIVE)
                                            </span>
                                          )}

                                          {/* Transcript Status Badge */}
                                          {session.hasAlertKeyword ? (
                                            <span className="transcript-status-badge alert" title={`Kata bahaya: ${session.keywordsFound.join(', ')}`}>
                                              <i className="fa-solid fa-triangle-exclamation"></i> Kata Bahaya: {session.keywordsFound.join(', ')}
                                            </span>
                                          ) : hasProcessing ? (
                                            <span className="transcript-status-badge processing">
                                              <i className="fa-solid fa-spinner fa-spin"></i> Sedang Diproses...
                                            </span>
                                          ) : hasQueued ? (
                                            <span className="transcript-status-badge queued">
                                              <i className="fa-solid fa-clock-rotate-left"></i> Dalam Antrean Transkripsi
                                            </span>
                                          ) : session.hasTranscript ? (
                                            <span className="transcript-status-badge ready">
                                              <i className="fa-solid fa-check"></i> Transkrip Siap
                                            </span>
                                          ) : (
                                            <span className="transcript-status-badge none">
                                              <i className="fa-solid fa-circle-question"></i> Belum Ditranskrip
                                            </span>
                                          )}

                                          {!session.isParsed && <span style={{ fontSize: "0.75rem", color: "var(--warning)" }}>Format lama</span>}
                                        </div>

                                        <div className="session-meta" style={{ marginTop: '4px' }}>
                                          Total: {session.parts.length} Potongan &bull; {(session.totalSize / 1024 / 1024).toFixed(2)} MB
                                        </div>
                                      </div>

                                      {/* Quick Action Buttons */}
                                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        {/* Download Transcripts (TXT / SRT) if available */}
                                        {session.hasTranscript && (
                                          <>
                                            <button 
                                              className="btn-export-action"
                                              onClick={() => quickDownloadSessionTranscript(session, 'txt')}
                                              title="Unduh transkrip format teks (.txt)"
                                            >
                                              <i className="fa-solid fa-file-lines"></i> TXT
                                            </button>
                                            <button 
                                              className="btn-export-action"
                                              onClick={() => quickDownloadSessionTranscript(session, 'srt')}
                                              title="Unduh transkrip format subtitle (.srt)"
                                            >
                                              <i className="fa-solid fa-closed-captioning"></i> SRT
                                            </button>
                                          </>
                                        )}

                                        {/* Download Audio */}
                                        <button 
                                          className="btn-export-action"
                                          onClick={() => {
                                            session.parts.forEach(p => {
                                              const a = document.createElement('a');
                                              a.href = getMediaUrl(p.url);
                                              a.download = p.fileName || 'audio.webm';
                                              a.click();
                                            });
                                          }}
                                          title="Unduh seluruh potongan audio (.webm)"
                                        >
                                          <i className="fa-solid fa-download"></i> Audio
                                        </button>

                                        {/* View Transcript Modal */}
                                        <button 
                                          className="btn-filter secondary"
                                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                                          onClick={() => openTranscriptModal(session.folderName, null, session.pcName)}
                                          title="Lihat transkrip teks percakapan seluruh sesi ini"
                                        >
                                          <i className="fa-solid fa-file-lines" style={{ color: 'var(--accent)', marginRight: '4px' }}></i> Transkrip Sesi
                                        </button>

                                        {/* Play Continuous Session */}
                                        <button 
                                          className="btn-filter primary"
                                          style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                                          onClick={() => {
                                            if (playingSession?.folderName !== session.folderName) {
                                              setPlayingSession(session);
                                            }
                                            pendingSeekOffsetRef.current = 0;
                                            setCurrentPartIndex(0);
                                            setLocalCurrentTime(0);
                                          }}
                                        >
                                          <i className="fa-solid fa-play"></i> Putar Sesi Ini
                                        </button>
                                      </div>
                                    </div>

                                    {/* Live Snippet Preview Box */}
                                    {session.transcriptSnippet && (
                                      <div 
                                        className={`transcript-snippet-box ${session.hasAlertKeyword ? 'has-alert' : ''}`}
                                        onClick={() => openTranscriptModal(session.folderName, null, session.pcName)}
                                        title="Klik untuk membuka transkrip lengkap sesi ini"
                                      >
                                        <i className="fa-solid fa-quote-left snippet-quote-icon"></i>
                                        <div className="snippet-text">
                                          "{session.transcriptSnippet}"
                                        </div>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--accent)', whiteSpace: 'nowrap', marginLeft: '6px' }}>
                                          Buka <i className="fa-solid fa-arrow-right"></i>
                                        </span>
                                      </div>
                                    )}

                                    {/* Part Chips List */}
                                    <div className="session-parts-list" style={{ marginTop: session.transcriptSnippet ? '10px' : '6px' }}>
                                      <span className="parts-label">Pilih Potongan:</span>
                                      <div className="part-chips-wrapper">
                                        {session.parts.map((part, pIdx) => {
                                          const isPartPlaying = isSessionActive && currentPartIndex === pIdx;
                                          const transStatus = transcribingFiles[`${session.folderName}/${part.fileName}`];

                                          return (
                                            <div key={`${part.url || ''}-${pIdx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                              <button
                                                className={`part-chip-btn ${isPartPlaying ? 'playing' : ''}`}
                                                onClick={() => {
                                                  if (playingSession?.folderName !== session.folderName) {
                                                    setPlayingSession(session);
                                                  }
                                                  pendingSeekOffsetRef.current = 0;
                                                  setCurrentPartIndex(pIdx);
                                                  setLocalCurrentTime(0);
                                                }}
                                                title={`Putar ${part.fileName}`}
                                              >
                                                {isPartPlaying ? (
                                                  <i className="fa-solid fa-volume-high" style={{ color: 'var(--accent)' }}></i>
                                                ) : (
                                                  <i className="fa-solid fa-circle-play"></i>
                                                )}
                                                <span>Part {pIdx + 1}</span>
                                                <span className="chip-size">({(((part.size || 0)) / 1024 / 1024).toFixed(2)} MB)</span>
                                                {part.hasTranscript && (
                                                  <i className="fa-solid fa-file-lines" style={{ color: 'var(--accent)', fontSize: '0.75rem', marginLeft: '4px' }} title="Transkrip tersedia"></i>
                                                )}
                                                {transStatus === 'processing' && (
                                                  <i className="fa-solid fa-spinner fa-spin" style={{ color: '#eab308', fontSize: '0.75rem', marginLeft: '4px' }} title="Sedang diproses transkripsi..."></i>
                                                )}
                                                {transStatus === 'queued' && (
                                                  <i className="fa-solid fa-clock-rotate-left" style={{ color: '#60a5fa', fontSize: '0.75rem', marginLeft: '4px' }} title="Dalam antrean transkripsi..."></i>
                                                )}
                                              </button>
                                              <button
                                                className="btn-filter secondary"
                                                style={{ padding: '4px 6px', fontSize: '0.7rem', borderRadius: '4px' }}
                                                onClick={() => openTranscriptModal(session.folderName, part.fileName, session.pcName)}
                                                title={`Lihat transkrip Part ${pIdx + 1}`}
                                              >
                                                <i className="fa-solid fa-file-lines"></i>
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Pagination Controls Row */}
                            {totalPages > 1 && (
                              <div className="record-pagination-controls">
                                <div className="record-page-info">
                                  Menampilkan {(safePage - 1) * limit + 1} - {Math.min(safePage * limit, totalSessions)} dari {totalSessions} sesi
                                </div>
                                <div className="record-page-buttons">
                                  <button 
                                    className="record-btn-page"
                                    disabled={safePage === 1}
                                    onClick={() => setPcSessionPages(prev => ({ ...prev, [pc]: Math.max(1, safePage - 1) }))}
                                  >
                                    <i className="fa-solid fa-chevron-left"></i> Sebelumnya
                                  </button>
                                  <span style={{ fontSize: '0.78rem', color: '#fff', fontWeight: 600, padding: '0 6px' }}>
                                    {safePage} / {totalPages}
                                  </span>
                                  <button 
                                    className="record-btn-page"
                                    disabled={safePage === totalPages}
                                    onClick={() => setPcSessionPages(prev => ({ ...prev, [pc]: Math.min(totalPages, safePage + 1) }))}
                                  >
                                    Berikutnya <i className="fa-solid fa-chevron-right"></i>
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {currentView === 'settings' && (
          <div className="settings-layout">
            <div>
              <h1 className="settings-header">Dashboard Settings</h1>
              <p className="settings-desc">Kelola konfigurasi sistem peringatan pusat, pemrosesan audio, dan keamanan akses dashboard.</p>
            </div>

            {/* A. Anchor Navigation Pills */}
            <div className="settings-nav-pills">
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-info')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-server"></i> Info Server
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-telegram')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-paper-plane"></i> Telegram
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-whisper')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-microphone-lines"></i> Whisper AI
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-pin')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-key"></i> Keamanan PIN
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-retention')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-clock-rotate-left"></i> Retensi Log
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-smart-storage')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-hard-drive"></i> Smart Storage
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-audio')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-volume-high"></i> Audio Alarm
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-update')?.scrollIntoView({ behavior: 'smooth' })}>
                <i className="fa-solid fa-cloud-arrow-down"></i> Update Hub
              </button>
              <button type="button" className="settings-nav-pill" onClick={() => document.getElementById('sec-danger')?.scrollIntoView({ behavior: 'smooth' })} style={{ color: '#f87171' }}>
                <i className="fa-solid fa-triangle-exclamation"></i> Zona Bahaya
              </button>
            </div>

            {/* 1. Status & Informasi Sistem */}
            <div className="settings-card" id="sec-info">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-server" style={{ color: 'var(--accent)' }}></i>
                  Status & Informasi Sistem
                </h2>
                <p className="settings-card-subtitle">Ringkasan status server pusat Audio Monitor yang sedang aktif.</p>
                
                <div className="server-info-grid">
                  <div className="server-info-item">
                    <span className="server-info-label">Versi Sistem</span>
                    <span className="server-info-value blue">v1.0.2</span>
                  </div>
                  <div className="server-info-item">
                    <span className="server-info-label">Koneksi Server</span>
                    <span className={`server-info-value ${isConnected ? 'green' : 'amber'}`}>
                      {isConnected ? 'TERHUBUNG' : 'TERPUTUS'}
                    </span>
                  </div>
                  <div className="server-info-item">
                    <span className="server-info-label">PC Agent Terhubung</span>
                    <span className="server-info-value">{Object.keys(agents || {}).length} Unit</span>
                  </div>
                  <div className="server-info-item">
                    <span className="server-info-label">Alert Telegram</span>
                    <span className={`server-info-value ${telegramToken ? 'green' : 'muted'}`}>
                      {telegramToken ? 'TERHUBUNG' : 'NONAKTIF'}
                    </span>
                  </div>
                  <div className="server-info-item">
                    <span className="server-info-label">Whisper STT</span>
                    <span className={`server-info-value ${transcriptionConfig?.enabled ? 'green' : 'muted'}`}>
                      {transcriptionConfig?.enabled ? 'AKTIF' : 'NONAKTIF'}
                    </span>
                  </div>
                  <div className="server-info-item">
                    <span className="server-info-label">Retensi Database</span>
                    <span className="server-info-value">{logRetentionDays || 30} Hari</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Telegram Alerts Card */}
            <div className="settings-card" id="sec-telegram">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-paper-plane" style={{ color: '#60a5fa' }}></i>
                  Notifikasi Telegram (Telegram Alerts)
                </h2>
                <p className="settings-card-subtitle">Konfigurasi bot Telegram untuk menerima peringatan terpusat jika ada audio PC yang bermasalah.</p>
                
                <div className="form-group">
                  <label className="form-label">Bot Token</label>
                  <div className="password-field-wrap">
                    <input 
                      type={showTelegramToken ? 'text' : 'password'} 
                      className="form-input" 
                      value={telegramToken} 
                      onChange={(e) => setTelegramToken(e.target.value)} 
                      placeholder="e.g., 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" 
                    />
                    <button 
                      type="button" 
                      className="password-toggle-btn" 
                      onClick={() => setShowTelegramToken(!showTelegramToken)}
                      title={showTelegramToken ? 'Sembunyikan Token' : 'Tampilkan Token'}
                    >
                      <i className={`fa-solid ${showTelegramToken ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Chat ID / Group ID</label>
                    <input type="text" className="form-input" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="e.g., -100123456789" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Interval Pesan (Detik)</label>
                    <input type="number" className="form-input" value={telegramInterval} onChange={(e) => setTelegramInterval(e.target.value)} placeholder="60" />
                    <span className="form-help">Waktu tunda bot berulang</span>
                  </div>
                </div>

                <div className="button-group">
                  <button className={`btn btn-primary ${isSavingTelegram ? 'is-loading' : ''}`} onClick={saveTelegramConfig} disabled={isSavingTelegram}>
                    <i className={`fa-solid ${isSavingTelegram ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                    {isSavingTelegram ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                  </button>
                  <button className="btn btn-success" onClick={testTelegram}>
                    <i className="fa-solid fa-paper-plane"></i>
                    Kirim Tes Alert
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Whisper Speech-to-Text Integration Card */}
            <div className="settings-card" id="sec-whisper">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-microphone-lines" style={{ marginRight: '8px', color: 'var(--accent)' }}></i>
                  Integrasi OpenAI Whisper (Speech-to-Text)
                </h2>
                <p className="settings-card-subtitle">
                  Konfigurasi endpoint API Whisper (Dedicated Mac M1 Worker / Cloud) untuk mengubah audio rekaman menjadi teks dan memindai kata kunci bahaya.
                </p>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <div className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={!!transcriptionConfig.enabled} 
                        onChange={e => setTranscriptionConfig({ ...transcriptionConfig, enabled: e.target.checked })} 
                      />
                      <span className="slider"></span>
                    </div>
                    <div>
                      <strong style={{ color: '#fff', fontSize: '0.9rem' }}>Aktifkan Integrasi Whisper Speech-to-Text</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Mengaktifkan fitur transkripsi dan pencarian kata kunci audio.</div>
                    </div>
                  </label>
                </div>

                <div className="form-group">
                  <label className="form-label">URL Endpoint API Whisper</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={transcriptionConfig.apiUrl || ''} 
                    onChange={e => setTranscriptionConfig({ ...transcriptionConfig, apiUrl: e.target.value })} 
                    placeholder="Contoh: http://192.168.1.150:8000/transcribe atau https://api.openai.com/v1/audio/transcriptions" 
                  />
                  <span className="form-help">Alamat server API Whisper (misal Mac M1 di LAN atau Cloud API).</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">API Key / Token (Opsional)</label>
                    <input 
                      type="password" 
                      className="form-input" 
                      value={transcriptionConfig.apiKey || ''} 
                      onChange={e => setTranscriptionConfig({ ...transcriptionConfig, apiKey: e.target.value })} 
                      placeholder="Kosongkan jika API lokal tanpa auth..." 
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Bahasa Audio</label>
                    <select 
                      className="form-input" 
                      value={transcriptionConfig.language ?? 'id'} 
                      onChange={e => setTranscriptionConfig({ ...transcriptionConfig, language: e.target.value })}
                    >
                      <option value="id">Bahasa Indonesia (id)</option>
                      <option value="en">English (en)</option>
                      <option value="">Deteksi Otomatis</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                    <div className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={transcriptionConfig.autoTranscribe !== false} 
                        onChange={e => setTranscriptionConfig({ ...transcriptionConfig, autoTranscribe: e.target.checked })} 
                      />
                      <span className="slider"></span>
                    </div>
                    <div>
                      <strong style={{ color: '#fff', fontSize: '0.85rem' }}>Transkripsi Otomatis Saat Audio Diunggah</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Otomatis menambahkan file rekaman baru ke antrean transkripsi latar belakang.</div>
                    </div>
                  </label>
                </div>

                {/* Interactive Keyword Tags */}
                <div className="form-group">
                  <label className="form-label">
                    Kata Kunci Bahaya / Alert Keywords
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: '6px' }}>
                      ({alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean).length} kata terdaftar)
                    </span>
                  </label>
                  
                  <div className="keyword-tags-container">
                    {alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean).map((kw, idx) => (
                      <span key={`${kw}-${idx}`} className="keyword-tag">
                        <i className="fa-solid fa-tag"></i> {kw}
                        <button 
                          type="button" 
                          className="keyword-tag-remove" 
                          onClick={() => removeAlertKeyword(kw)}
                          title={`Hapus kata "${kw}"`}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    {alertKeywordsInput.split(',').map(k => k.trim()).filter(Boolean).length === 0 && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Belum ada kata kunci. Tambahkan melalui kolom di bawah.</span>
                    )}
                  </div>

                  <div className="keyword-add-row">
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Ketik kata baru (misal: bocor)..." 
                      value={newKeywordInput}
                      onChange={e => setNewKeywordInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addAlertKeyword(newKeywordInput);
                        }
                      }}
                    />
                    <button 
                      type="button" 
                      className="keyword-add-btn" 
                      onClick={() => addAlertKeyword(newKeywordInput)}
                    >
                      <i className="fa-solid fa-plus"></i> Tambah Kata
                    </button>
                  </div>
                  <span className="form-help">Jika kata-kata ini terucap dalam rekaman, server otomatis mengirim peringatan Telegram & notifikasi Dashboard.</span>
                </div>

                {whisperTestResult && (
                  <div style={{ 
                    padding: '10px 14px', 
                    borderRadius: '8px', 
                    marginBottom: '16px',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: whisperTestResult.success ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${whisperTestResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    color: whisperTestResult.success ? '#4ade80' : '#f87171'
                  }}>
                    <i className={`fa-solid ${whisperTestResult.success ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                    {whisperTestResult.message || whisperTestResult.error}
                  </div>
                )}

                <div className="button-group">
                  <button className={`btn btn-primary ${isSavingWhisper ? 'is-loading' : ''}`} onClick={saveTranscriptionConfig} disabled={isSavingWhisper}>
                    <i className={`fa-solid ${isSavingWhisper ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                    {isSavingWhisper ? 'Menyimpan...' : 'Simpan Pengaturan Whisper'}
                  </button>
                  <button className="btn btn-secondary" onClick={testWhisperApiConnection} disabled={isTestingWhisperApi}>
                    <i className={`fa-solid ${isTestingWhisperApi ? 'fa-spinner fa-spin' : 'fa-network-wired'}`}></i>
                    {isTestingWhisperApi ? 'Menguji Koneksi...' : 'Test Koneksi API'}
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Keamanan Akses PIN Card */}
            <div className="settings-card" id="sec-pin">
              <div className="settings-card-accent purple"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-shield-halved" style={{ color: '#8b5cf6' }}></i>
                  Keamanan Akses (PIN Master)
                </h2>
                <p className="settings-card-subtitle">Ubah PIN master yang digunakan untuk menghapus PC atau mengakses pengaturan.</p>
                <div style={{ display: 'flex', gap: '16px', maxWidth: '400px' }}>
                  <input type="password" className="form-input" value={newPinInput} onChange={(e) => setNewPinInput(e.target.value)} placeholder="Masukkan PIN Baru..." />
                  <button className={`btn btn-primary ${isSavingPin ? 'is-loading' : ''}`} onClick={savePinConfig} disabled={isSavingPin} style={{ whiteSpace: 'nowrap' }}>
                    <i className={`fa-solid ${isSavingPin ? 'fa-spinner fa-spin' : 'fa-key'}`}></i>
                    {isSavingPin ? 'Menyimpan...' : 'Ubah PIN'}
                  </button>
                </div>
              </div>
            </div>

            {/* 5. Retensi Log & Pembersihan Otomatis Card */}
            <div className="settings-card" id="sec-retention">
              <div className="settings-card-accent green"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-clock-rotate-left" style={{ color: '#34d399' }}></i>
                  Retensi Log & Pembersihan Otomatis (Auto-Cleanup)
                </h2>
                <p className="settings-card-subtitle">
                  Atur batas masa simpan riwayat insiden audio/OBS sebelum otomatis dibersihkan oleh server agar database tetap ringan.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 320px) 1fr', gap: '20px', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Batas Retensi Log (Hari)</label>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <input 
                        type="number" 
                        min="1" 
                        max="365" 
                        className="form-input" 
                        value={logRetentionDays} 
                        onChange={(e) => {
                          const val = e.target.value;
                          setLogRetentionDays(val === '' ? '' : parseInt(val, 10));
                        }}
                        onBlur={() => {
                          if (logRetentionDays === '' || isNaN(logRetentionDays) || logRetentionDays < 1) {
                            setLogRetentionDays(30);
                          }
                        }}
                        placeholder="30" 
                        style={{ width: '130px' }}
                      />
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Hari</span>
                    </div>
                    <span className="form-help">Log insiden yang lebih lama dari jumlah hari ini akan dibersihkan otomatis.</span>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>Informasi Pembersihan Server:</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Server menjalankan auto-cleanup setiap kali aplikasi dimulai dan setiap kali batas hari retensi disimpan. Anda juga dapat menjalankan pembersihan seketika melalui tombol di bawah.
                    </div>
                  </div>
                </div>

                <div className="button-group">
                  <button className={`btn btn-primary ${isSavingRetention ? 'is-loading' : ''}`} onClick={saveRetentionConfig} disabled={isSavingRetention}>
                    <i className={`fa-solid ${isSavingRetention ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                    {isSavingRetention ? 'Menyimpan...' : 'Simpan Batas Retensi'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleManualCleanupNow} style={{ background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                    <i className="fa-solid fa-broom"></i>
                    Bersihkan Log Lama Sekarang
                  </button>
                </div>
              </div>
            </div>

            {/* 5B. Otomasi Penyimpanan & Sinkronisasi Cloud / NAS */}
            <div className="settings-card" id="sec-smart-storage">
              <div className="settings-card-accent orange"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-hard-drive" style={{ color: '#f59e0b' }}></i>
                  Otomasi Penyimpanan & Cloud / NAS Sync (Smart Storage)
                </h2>
                <p className="settings-card-subtitle">
                  Kelola otomatisasi pengarsipan file rekaman lawas, pencadangan ke folder jaringan (NAS), dan webhook cloud sync.
                </p>

                {/* Storage Metric Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Ukuran</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#f59e0b', marginTop: '2px' }}>{storageStatus?.totalMb || 0} MB</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>({storageStatus?.totalGb || 0} GB)</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Sesi</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)', marginTop: '2px' }}>{storageStatus?.totalSessions || 0}</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>{storageStatus?.totalFiles || 0} files</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Terarsip</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#10b981', marginTop: '2px' }}>{storageStatus?.archivedSessions || 0}</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Sesi Lama</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tersinkron NAS/Cloud</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38bdf8', marginTop: '2px' }}>{storageStatus?.syncedSessions || 0}</div>
                    <div style={{ fontSize: '0.7rem', color: '#888' }}>Tercadangkan</div>
                  </div>
                </div>

                {syncStatusMsg && (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '0.85rem',
                    background: syncStatusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                    border: `1px solid ${syncStatusMsg.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    color: syncStatusMsg.type === 'success' ? '#4ade80' : '#f87171',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <i className={`fa-solid ${syncStatusMsg.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}`}></i>
                    {syncStatusMsg.text}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Direktori Cadangan Sekunder (NAS / External Drive)</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="Contoh: D:\BackupRekaman atau \\NAS\Audio" 
                      value={storageConfig.backupDirectory || ''} 
                      onChange={(e) => setStorageConfig(prev => ({ ...prev, backupDirectory: e.target.value }))}
                    />
                    <span className="form-help">Jika diisi, server akan mencadangkan file rekaman ke folder ini.</span>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Otomatis Arsipkan Rekaman Lama (Hari)</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="365" 
                      className="form-input" 
                      value={storageConfig.autoArchiveDays || 14} 
                      onChange={(e) => setStorageConfig(prev => ({ ...prev, autoArchiveDays: parseInt(e.target.value, 10) || 14 }))}
                    />
                    <span className="form-help">Rekaman yang lebih lama dari hari ini akan ditandai arsip dan dioptimalkan.</span>
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label className="form-label" style={{ margin: 0 }}>Cloud Webhook Sync</label>
                    <label className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={storageConfig.cloudSyncEnabled || false} 
                        onChange={(e) => setStorageConfig(prev => ({ ...prev, cloudSyncEnabled: e.target.checked }))} 
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="https://api.perusahaan.com/audio-backup-webhook" 
                    value={storageConfig.cloudSyncUrl || ''} 
                    onChange={(e) => setStorageConfig(prev => ({ ...prev, cloudSyncUrl: e.target.value }))}
                    disabled={!storageConfig.cloudSyncEnabled}
                  />
                  <span className="form-help">Mengirim sinyal webhook dan metadata rekaman ke endpoint cloud saat sesi selesai.</span>
                </div>

                <div className="button-group">
                  <button className={`btn btn-primary ${isSavingStorageConfig ? 'is-loading' : ''}`} onClick={saveStorageAutomationConfig} disabled={isSavingStorageConfig}>
                    <i className={`fa-solid ${isSavingStorageConfig ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                    {isSavingStorageConfig ? 'Menyimpan...' : 'Simpan Konfigurasi Storage'}
                  </button>
                  <button className={`btn btn-secondary ${isTriggeringSync ? 'is-loading' : ''}`} onClick={triggerManualBackupSync} disabled={isTriggeringSync}>
                    <i className={`fa-solid ${isTriggeringSync ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
                    {isTriggeringSync ? 'Menyinkronkan...' : 'Sinkronkan Cadangan Sekarang'}
                  </button>
                  <button className={`btn btn-secondary ${isTriggeringArchive ? 'is-loading' : ''}`} onClick={triggerManualArchive} disabled={isTriggeringArchive} style={{ background: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
                    <i className={`fa-solid ${isTriggeringArchive ? 'fa-spinner fa-spin' : 'fa-box-archive'}`}></i>
                    {isTriggeringArchive ? 'Mengarsipkan...' : 'Arsipkan Berkas Lawas'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleCleanHostStorage('all')} style={{ background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                    <i className="fa-solid fa-trash-can"></i> Hapus Audio di Semua PC Host
                  </button>
                </div>
              </div>
            </div>

            {/* 6. Local Dashboard Audio Card */}
            <div className="settings-card" id="sec-audio">
              <div className="settings-card-accent teal"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-volume-high" style={{ color: '#14b8a6' }}></i>
                  Audio Alarm Dashboard Lokal
                </h2>
                <p className="settings-card-subtitle">Konfigurasi pemutaran suara peringatan langsung di browser pusat ini.</p>
                <div className="setting-row">
                  <div>
                    <div className="form-label" style={{ margin: 0 }}>Nyalakan Alarm Bahaya Lokal</div>
                    <span className="form-help" style={{ margin: 0 }}>Dashboard akan mengeluarkan suara 'Beep' jika ada agen berstatus BAHAYA.</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableBeep} onChange={(e) => setEnableBeep(e.target.checked)} />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </div>

            {/* 7. Centralized Update Management Card (Hybrid: GitHub + Direct Upload + LAN Broadcast) */}
            <div className="settings-card" id="sec-update">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-cloud-arrow-down" style={{ marginRight: '8px', color: 'var(--accent)' }}></i>
                  Pusat Pembaruan Aplikasi (Server & Agent Hub)
                </h2>
                <p className="settings-card-subtitle">
                  Perbarui aplikasi Server pusat dan sebarkan pembaruan versi Agent ke seluruh komputer di jaringan lokal secara mandiri.
                </p>

                {/* =========================================================================
                    SUB-SECTION 1: PEMBARUAN APLIKASI SERVER (PUSAT)
                    ========================================================================= */}
                <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '10px', padding: '18px', marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '1rem', color: '#60a5fa' }}>
                        <i className="fa-solid fa-server"></i>
                        Pembaruan Aplikasi Server (Pusat)
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Versi Server yang sedang aktif: <strong style={{ color: '#fff' }}>v1.0.2</strong>
                      </div>
                    </div>
                    {githubReleaseInfo?.serverAsset && (
                      <div style={{ background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '6px', padding: '4px 10px', fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>
                        <i className="fa-solid fa-circle-check" style={{ marginRight: '4px' }}></i>
                        Rilis Server Tersedia: {githubReleaseInfo.tag}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                    {/* Opsi Server 1: 1-Klik Update dari GitHub */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#60a5fa', marginBottom: '6px' }}>
                        <i className="fa-brands fa-github" style={{ marginRight: '6px' }}></i>
                        1-Klik Perbarui Server dari GitHub
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                        {githubReleaseInfo?.serverAsset ? (
                          <>File: <strong>{githubReleaseInfo.serverAsset.name}</strong> ({((githubReleaseInfo.serverAsset.size || 0) / 1024 / 1024).toFixed(1)} MB)</>
                        ) : (
                          'Periksa rilis GitHub untuk mengunduh dan memasang pembaruan Server secara instan.'
                        )}
                      </p>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button className="btn-filter secondary" onClick={checkGithubRelease} disabled={isCheckingGithub}>
                          <i className={`fa-solid fa-arrows-rotate ${isCheckingGithub ? 'fa-spin' : ''}`}></i> {isCheckingGithub ? 'Memeriksa...' : 'Cek Rilis GitHub'}
                        </button>
                        {githubReleaseInfo?.serverAsset && (
                          <button className="btn-filter primary" onClick={handleServerSelfUpdate} disabled={isUpdatingServer}>
                            <i className={`fa-solid ${isUpdatingServer ? 'fa-spinner fa-spin' : 'fa-bolt'}`}></i> {isUpdatingServer ? 'Memperbarui Server...' : '1-Klik Perbarui Server'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Opsi Server 2: Upload File Installer Server Manual */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '14px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#34d399', marginBottom: '6px' }}>
                        <i className="fa-solid fa-file-arrow-up" style={{ marginRight: '6px' }}></i>
                        Upload & Pasang Installer Server Manual
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                        Pilih file <code>AudioMonitor_Server_Installer...exe</code> dari komputer Anda untuk langsung dipasang.
                      </p>
                      <label className={`btn-filter secondary ${isUploadingServerInstaller ? 'disabled' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                        <i className={`fa-solid ${isUploadingServerInstaller ? 'fa-spinner fa-spin' : 'fa-upload'}`} style={{ marginRight: '6px' }}></i>
                        {isUploadingServerInstaller ? 'Memasang Update Server...' : 'Pilih File Installer Server (.exe)'}
                        <input type="file" accept=".exe" onChange={handleUploadServerInstaller} style={{ display: 'none' }} disabled={isUploadingServerInstaller} />
                      </label>
                    </div>
                  </div>
                </div>

                {/* =========================================================================
                    SUB-SECTION 2: PEMBARUAN APLIKASI AGENT (JARINGAN LOKAL)
                    ========================================================================= */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '1rem', color: '#38bdf8', marginBottom: '12px' }}>
                  <i className="fa-solid fa-desktop"></i>
                  Pembaruan PC Agent (Distribusi Jaringan Lokal)
                </div>

                {/* Grid 2 Opsi Sumber Agent: GitHub Sync & Direct Upload */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                  
                  {/* Opsi 1: GitHub 1-Click Sync Agent */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '0.95rem', color: '#60a5fa', marginBottom: '8px' }}>
                      <i className="fa-brands fa-github" style={{ fontSize: '1.2rem' }}></i>
                      1-Klik Unduh Installer Agent dari GitHub
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                      Server akan mengunduh paket installer Agent dari repositori GitHub untuk disimpan di Server.
                    </p>

                    {githubReleaseInfo && githubReleaseInfo.hasRelease && (
                      <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '6px', padding: '10px', marginBottom: '12px', fontSize: '0.8rem' }}>
                        <div><strong>Rilis:</strong> {githubReleaseInfo.name || githubReleaseInfo.tag}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                          File: {githubReleaseInfo.asset ? `${githubReleaseInfo.asset.name} (${(((githubReleaseInfo.asset.size || 0)) / 1024 / 1024).toFixed(1)} MB)` : 'Tidak ada installer Agent .exe'}
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button className="btn-filter secondary" onClick={checkGithubRelease} disabled={isCheckingGithub}>
                        <i className={`fa-solid fa-arrows-rotate ${isCheckingGithub ? 'fa-spin' : ''}`}></i> {isCheckingGithub ? 'Memeriksa...' : 'Cek Rilis GitHub'}
                      </button>
                      {githubReleaseInfo?.asset && (
                        <button className="btn-filter primary" onClick={downloadGithubRelease} disabled={isDownloadingGithub}>
                          <i className={`fa-solid fa-download ${isDownloadingGithub ? 'fa-bounce' : ''}`}></i> {isDownloadingGithub ? 'Mengunduh...' : 'Unduh ke Server'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Opsi 2: Upload File Installer Agent .exe via Browser */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '0.95rem', color: '#34d399', marginBottom: '8px' }}>
                      <i className="fa-solid fa-file-arrow-up" style={{ fontSize: '1.1rem' }}></i>
                      Upload File Installer Agent Manual
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                      Pilih file <code>AudioMonitor_Agent_Installer...exe</code> dari komputer Anda untuk disimpan ke Server.
                    </p>

                    <label className={`btn-filter secondary ${isUploadingInstaller ? 'disabled' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                      <i className={`fa-solid fa-upload ${isUploadingInstaller ? 'fa-spin' : ''}`} style={{ marginRight: '6px' }}></i>
                      {isUploadingInstaller ? 'Mengupload File...' : 'Pilih File Installer Agent (.exe)'}
                      <input type="file" accept=".exe" onChange={handleUploadInstaller} style={{ display: 'none' }} disabled={isUploadingInstaller} />
                    </label>
                  </div>

                </div>

                {/* Status Distribusi Installer di Server */}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
                        Paket Installer Agent yang Siap di Server:
                      </div>
                      <div style={{ fontSize: '0.85rem', color: serverUpdateInfo?.hasUpdate ? 'var(--success)' : 'var(--text-muted)', marginTop: '4px' }}>
                        {serverUpdateInfo?.hasUpdate ? (
                          <>
                            <i className="fa-solid fa-circle-check" style={{ marginRight: '6px' }}></i>
                            Tersedia: <strong>v{serverUpdateInfo.version}</strong> ({serverUpdateInfo.fileName}) &bull; {(serverUpdateInfo.size / 1024 / 1024).toFixed(1)} MB
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-circle-exclamation" style={{ marginRight: '6px', color: 'var(--warning)' }}></i>
                            Belum ada file installer Agent di Server. Silakan unduh dari GitHub atau upload file di atas.
                          </>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn-filter secondary" onClick={checkServerUpdates} disabled={isCheckingUpdate}>
                        <i className={`fa-solid fa-rotate ${isCheckingUpdate ? 'fa-spin' : ''}`}></i> Refresh
                      </button>
                      {serverUpdateInfo?.hasUpdate && (
                        <button className="btn-filter primary" onClick={() => triggerAgentUpdate('all')} style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                          <i className="fa-solid fa-rocket"></i> Sebarkan ke Seluruh PC Agent
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* 8. Danger Zone Card Enhanced */}
            <div className="settings-card danger-zone-card" id="sec-danger">
              <div className="settings-card-accent red"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title" style={{ color: 'var(--danger)' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  Zona Bahaya (Danger Zone)
                </h2>
                <p className="settings-card-subtitle" style={{ marginBottom: '12px' }}>
                  Tindakan destruktif permanen. Harap berhati-hati sebelum mengeksekusi penghapusan database log.
                </p>

                <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.85rem', color: '#fca5a5', lineHeight: '1.5' }}>
                    <i className="fa-solid fa-circle-info" style={{ marginRight: '6px' }}></i>
                    Untuk mencegah tindakan tidak sengaja, ketik <strong>HAPUS</strong> pada kolom di bawah untuk mengaktifkan tombol pembersihan.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <input 
                    type="text" 
                    className="danger-confirm-input" 
                    placeholder="Ketik HAPUS..." 
                    value={dangerConfirmText}
                    onChange={e => setDangerConfirmText(e.target.value)}
                  />
                  <button 
                    className="btn btn-danger" 
                    onClick={() => {
                      clearDatabase();
                      setDangerConfirmText('');
                    }}
                    disabled={dangerConfirmText !== 'HAPUS'}
                    style={{ 
                      opacity: dangerConfirmText === 'HAPUS' ? 1 : 0.4, 
                      cursor: dangerConfirmText === 'HAPUS' ? 'pointer' : 'not-allowed',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <i className="fa-solid fa-trash-can" style={{ marginRight: '6px' }}></i>
                    Hapus Semua Log Insiden
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

      

      

            {showSystemLogs && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: '800px', maxWidth: '95vw', background: 'var(--bg-card)' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}><i className="fa-solid fa-terminal"></i> System Audit Logs</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Real-time server logs for debugging</div>
              </div>
              <button className="close-btn" onClick={() => setShowSystemLogs(false)}><i className="fa-solid fa-times"></i></button>
            </div>
            <div className="modal-body" style={{ padding: '0' }}>
              <pre style={{ 
                background: '#111', 
                color: '#fff', 
                padding: '16px', 
                margin: '0',
                borderRadius: '0 0 8px 8px',
                height: '500px', 
                overflowY: 'auto',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap'
              }}>
                {systemLogs}
              </pre>
            </div>
          </div>
        </div>
      )}
      {configModalAgent && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0 }}>Pengaturan: {configModalAgent.pcName}</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace' }}>ID: {configModalAgent.uuid}</div>
              </div>
              <button className="close-btn" onClick={() => setConfigModalAgent(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '24px' }}>
                <form onSubmit={handleRemoteConfigSave}>
                  
                  <div className="modal-section">
                    <div className="modal-section-title">Identity & Audio Sources</div>
                    <div className="setting-group">
                      <label>PC Name</label>
                      <input className="form-input" value={remoteConfig.agentName || ''} onChange={e => setRemoteConfig({...remoteConfig, agentName: e.target.value})} required />
                    </div>
                    
                    <div className="setting-group">
                      <label>Hardware Microphone</label>
                      {configModalAgent.audioDevices && configModalAgent.audioDevices.length > 0 ? (
                        <select className="form-input" value={remoteConfig.micDriverName || ''} onChange={e => setRemoteConfig({...remoteConfig, micDriverName: e.target.value})}>
                          {configModalAgent.audioDevices.map((dev) => <option key={dev} value={dev}>{dev}</option>)}
                        </select>
                      ) : (
                        <input className="form-input" value={remoteConfig.micDriverName || ''} onChange={e => setRemoteConfig({...remoteConfig, micDriverName: e.target.value})} />
                      )}
                    </div>
                    <div className="setting-group" style={{ marginBottom: 0 }}>
                      <label>OBS Source Name</label>
                      {configModalAgent.obsSources && configModalAgent.obsSources.length > 0 ? (
                        <select className="form-input" value={remoteConfig.obsSourceName || ''} onChange={e => setRemoteConfig({...remoteConfig, obsSourceName: e.target.value})}>
                          {configModalAgent.obsSources.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                      ) : (
                        <input className="form-input" value={remoteConfig.obsSourceName || ''} onChange={e => setRemoteConfig({...remoteConfig, obsSourceName: e.target.value})} />
                      )}
                    </div>
                  </div>

                  <div className="modal-section">
                    <div className="modal-section-title">Volume Thresholds</div>
                    <div className="setting-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Sensitivitas Bicara (Speaking Threshold)</span>
                        <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{remoteConfig.speakingThreshold ?? 10}%</span>
                      </label>
                      <input className="range-slider range-accent" type="range" value={remoteConfig.speakingThreshold ?? 10} onChange={e => setRemoteConfig({...remoteConfig, speakingThreshold: Number(e.target.value)})} min="1" max="100" />
                    </div>

                    <div className="setting-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Noise Gate</span>
                        <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>{remoteConfig.noiseGate ?? 15}%</span>
                      </label>
                      <input className="range-slider range-warning" type="range" value={remoteConfig.noiseGate ?? 15} onChange={e => setRemoteConfig({...remoteConfig, noiseGate: Number(e.target.value)})} min="0" max="100" />
                    </div>
    
                    <div className="setting-group" style={{ marginBottom: 0 }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Batas Pecah (Clipping Threshold)</span>
                        <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{remoteConfig.clippingThreshold ?? 95}%</span>
                      </label>
                      <input className="range-slider range-danger" type="range" value={remoteConfig.clippingThreshold ?? 95} onChange={e => setRemoteConfig({...remoteConfig, clippingThreshold: Number(e.target.value)})} min="50" max="100" />
                    </div>
                  </div>

                  <div className="modal-section" style={{ marginBottom: '24px' }}>
                    <div className="modal-section-title">Timeout Rules</div>
                    <div className="timeout-grid">
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Silence (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.silenceTimeoutSec ?? 15} onChange={e => setRemoteConfig({...remoteConfig, silenceTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Dead Mic (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.deadMicTimeoutSec ?? 30} onChange={e => setRemoteConfig({...remoteConfig, deadMicTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Mute OBS (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.obsMuteTimeoutSec ?? 3} onChange={e => setRemoteConfig({...remoteConfig, obsMuteTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                    <label>Pecah (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.clippingDurationSec ?? 3} onChange={e => setRemoteConfig({...remoteConfig, clippingDurationSec: Number(e.target.value)})} min="1" />
                      </div>
                    </div>
                  </div>

                  <div className="modal-section" style={{ marginTop: '24px', borderTop: '1px dashed #333', paddingTop: '20px' }}>
                    
                    <div className="modal-section-title" style={{ color: '#4caf50' }}>OBS Automations</div>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '15px' }}>
                      <div className="toggle-switch" style={{ marginTop: '2px', flexShrink: 0 }}>
                        <input type="checkbox" checked={!!remoteConfig.obsSyncStreaming} onChange={e => setRemoteConfig({...remoteConfig, obsSyncStreaming: e.target.checked})} />
                        <span className="slider"></span>
                      </div>
                      <div>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold' }}>Auto-Monitor on OBS Live</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>Otomatis menyalakan/mematikan tombol hijau Monitoring Agent mengikuti status Streaming/Recording di OBS.</div>
                      </div>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '15px' }}>
                      <div className="toggle-switch" style={{ marginTop: '2px', flexShrink: 0 }}>
                        <input type="checkbox" checked={!!remoteConfig.obsSyncRecording} onChange={e => setRemoteConfig({...remoteConfig, obsSyncRecording: e.target.checked})} />
                        <span className="slider"></span>
                      </div>
                      <div>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold' }}>Auto-Record on OBS Live</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>Otomatis merekam suara Host saat OBS Streaming/Recording. (File disimpan secara lokal di masing-masing komputer Agent).</div>
                      </div>
                    </label>

                    <div className="modal-section-title" style={{ color: 'var(--success)' }}>Auto-Recovery</div>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '15px' }}>
                      <div className="toggle-switch" style={{ marginTop: '2px', flexShrink: 0 }}>
                        <input type="checkbox" checked={!!remoteConfig.autoRecoveryUnmute} onChange={e => setRemoteConfig({...remoteConfig, autoRecoveryUnmute: e.target.checked})} />
                        <span className="slider"></span>
                      </div>
                      <div>
                        <div style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold' }}>Auto-Unmute OBS</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>Jika fitur ini nyala, Agent tidak akan memunculkan peringatan BAHAYA MUTE, melainkan langsung memaksa klik "Unmute" di OBS secara otomatis ketika streamer mulai berbicara.</div>
                      </div>
                    </label>

                    <div className="modal-section-title" style={{ color: '#9e9e9e', marginTop: '20px' }}>System Settings</div>
                    <div className="setting-group" style={{ marginBottom: 0 }}>
                      <label>Data Polling Rate</label>
                      <select 
                        className="form-input" 
                        value={remoteConfig.telemetryInterval || 500} 
                        onChange={e => setRemoteConfig({...remoteConfig, telemetryInterval: Number(e.target.value)})}
                      >
                        <option value="500">Realtime (0.5s)</option>
                        <option value="2000">Normal (2s)</option>
                        <option value="5000">Eco Mode (5s)</option>
                      </select>
                    </div>

                    <div className="modal-section-title" style={{ color: '#60a5fa', marginTop: '20px' }}>Versi Aplikasi & Pembaruan</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '6px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 'bold' }}>Versi Agent Saat Ini:</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>v{configModalAgent.appVersion || '1.0.2'}</div>
                      </div>
                      {(() => {
                        const semverCompare = (v1, v2) => {
                          const p1 = (v1 || '0.0.0').split('.').map(Number);
                          const p2 = (v2 || '0.0.0').split('.').map(Number);
                          for (let i = 0; i < 3; i++) {
                            if ((p1[i] || 0) > (p2[i] || 0)) return 1;
                            if ((p1[i] || 0) < (p2[i] || 0)) return -1;
                          }
                          return 0;
                        };
                        const hasNewer = serverUpdateInfo?.hasUpdate && semverCompare(serverUpdateInfo.version, configModalAgent.appVersion || '1.0.2') > 0;
                        if (!hasNewer) {
                          return (
                            <span style={{ fontSize: '12px', color: 'var(--success)', fontWeight: 600 }}>
                              <i className="fa-solid fa-circle-check"></i> Versi Terbaru
                            </span>
                          );
                        }
                        return (
                          <button 
                            type="button" 
                            className="btn-filter primary" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            onClick={() => triggerAgentUpdate(configModalAgent.uuid)}
                          >
                            <i className="fa-solid fa-cloud-arrow-down"></i> Update ke v{serverUpdateInfo.version}
                          </button>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="form-group" style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>Penyimpanan Audio Lokal di PC Host</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Hapus file rekaman lokal di PC ini yang SUDAH BERHASIL TERUPLOAD ke Server</div>
                      </div>
                      <button 
                        type="button" 
                        className="btn-filter secondary" 
                        style={{ color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.4)', padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => handleCleanHostStorage(configModalAgent.uuid, configModalAgent.pcName || configModalAgent.uuid)}
                      >
                        <i className="fa-solid fa-broom"></i> Bersihkan Audio Host
                      </button>
                    </div>
                  </div>

                  <button type="submit" className="btn-primary" style={{ marginTop: '24px' }}>Save & Sync to Agent</button>
                </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Transkrip Rekaman Audio */}
      {activeTranscriptModal && activeTranscriptModal.isOpen && (
        <div className="transcript-modal-overlay" onClick={() => setActiveTranscriptModal(null)}>
          <div className="transcript-modal-container" onClick={e => e.stopPropagation()}>
            <div className="transcript-modal-header">
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', color: '#fff' }}>
                  <i className="fa-solid fa-file-lines" style={{ color: 'var(--accent)' }}></i>
                  Transkrip Audio: {activeTranscriptModal.pcName}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {activeTranscriptModal.fileName ? `File: ${activeTranscriptModal.fileName}` : `Sesi: ${activeTranscriptModal.folderName}`}
                </div>
              </div>
              <button 
                className="btn-filter secondary" 
                style={{ padding: '6px 10px', fontSize: '0.85rem' }} 
                onClick={() => setActiveTranscriptModal(null)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="transcript-modal-body">
              {(() => {
                const modalKey = activeTranscriptModal.fileName 
                  ? `${activeTranscriptModal.folderName}/${activeTranscriptModal.fileName}`
                  : null;
                const isModalProcessing = modalKey 
                  ? transcribingFiles[modalKey] === 'processing' 
                  : Object.keys(transcribingFiles).some(k => k.startsWith(`${activeTranscriptModal.folderName}/`) && transcribingFiles[k] === 'processing');
                const isModalQueued = modalKey 
                  ? transcribingFiles[modalKey] === 'queued' 
                  : Object.keys(transcribingFiles).some(k => k.startsWith(`${activeTranscriptModal.folderName}/`) && transcribingFiles[k] === 'queued');

                if (activeTranscriptModal.loading) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '1.8rem', color: 'var(--accent)', marginBottom: '12px' }}></i>
                      <div>Sedang memproses / memuat transkrip audio...</div>
                    </div>
                  );
                }

                if (isModalProcessing && !activeTranscriptModal.transcript) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2.4rem', color: '#eab308', marginBottom: '14px' }}></i>
                      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#fbbf24', marginBottom: '6px' }}>Sedang Diproses Transkripsi</div>
                      <div style={{ fontSize: '0.85rem' }}>Audio sedang aktif dikonversi ke teks oleh Whisper AI. Hasil akan otomatis muncul begitu selesai.</div>
                    </div>
                  );
                }

                if (isModalQueued && !activeTranscriptModal.transcript) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                      <i className="fa-solid fa-clock-rotate-left" style={{ fontSize: '2.4rem', color: '#60a5fa', marginBottom: '14px' }}></i>
                      <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#93c5fd', marginBottom: '6px' }}>Dalam Antrean Transkripsi</div>
                      <div style={{ fontSize: '0.85rem' }}>File audio ini sudah masuk antrean dan sedang menunggu giliran pemrosesan otomatis.</div>
                    </div>
                  );
                }

                if (activeTranscriptModal.error) {
                  return (
                    <div style={{ textAlign: 'center', padding: '30px 20px' }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '0.9rem' }}>
                        {activeTranscriptModal.error}
                      </div>
                      {transcriptionConfig.enabled && transcriptionConfig.apiUrl && (
                        <button 
                          className="btn btn-primary"
                          onClick={() => {
                            handleManualTranscribe(activeTranscriptModal.folderName, activeTranscriptModal.fileName, activeTranscriptModal.pcName);
                          }}
                        >
                          <i className="fa-solid fa-wand-magic-sparkles" style={{ marginRight: '6px' }}></i>
                          {activeTranscriptModal.fileName ? 'Transkrip Potongan Ini Sekarang' : 'Transkrip Seluruh Sesi Sekarang'}
                        </button>
                      )}
                    </div>
                  );
                }

                if (activeTranscriptModal.transcript) {
                  return (
                    <>
                      {/* Meta info & Action bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span className="session-time-badge">
                        <i className="fa-solid fa-language" style={{ marginRight: '4px' }}></i>
                        {activeTranscriptModal.transcript.language ? activeTranscriptModal.transcript.language.toUpperCase() : 'ID'}
                      </span>
                      {activeTranscriptModal.transcript.transcribedAt && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          <i className="fa-solid fa-clock" style={{ marginRight: '4px' }}></i>
                          {activeTranscriptModal.transcript.transcribedAt}
                        </span>
                      )}
                      {activeTranscriptModal.transcript.keywordsFound && activeTranscriptModal.transcript.keywordsFound.length > 0 && (
                        <span className="transcript-keyword-badge">
                          <i className="fa-solid fa-triangle-exclamation"></i>
                          Kata Bahaya: {activeTranscriptModal.transcript.keywordsFound.join(', ')}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button 
                        className="btn-filter secondary" 
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() => downloadTranscriptFile(activeTranscriptModal.transcript, 'txt')}
                        title="Unduh file teks transkrip"
                      >
                        <i className="fa-solid fa-download"></i> TXT
                      </button>
                      <button 
                        className="btn-filter secondary" 
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() => downloadTranscriptFile(activeTranscriptModal.transcript, 'srt')}
                        title="Unduh file subtitle SRT"
                      >
                        <i className="fa-solid fa-file-audio"></i> SRT
                      </button>
                      <button 
                        className="btn-filter secondary" 
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() => downloadTranscriptFile(activeTranscriptModal.transcript, 'json')}
                        title="Unduh format JSON"
                      >
                        <i className="fa-solid fa-code"></i> JSON
                      </button>
                    </div>
                  </div>

                  {/* Segments List with Click-to-Seek */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    {Array.isArray(activeTranscriptModal.transcript.segments) && activeTranscriptModal.transcript.segments.length > 0 ? (
                      activeTranscriptModal.transcript.segments.map((seg, sIdx) => {
                        const validSec = typeof seg.start === 'number' ? Math.max(0, seg.start) : 0;
                        const m = Math.floor(validSec / 60);
                        const s = Math.floor(validSec % 60);
                        const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

                        return (
                          <div 
                            key={seg.id !== undefined ? seg.id : sIdx} 
                            className="transcript-segment-row"
                            onClick={() => {
                              const targetFolder = activeTranscriptModal.folderName;
                              const baseKey = targetFolder ? targetFolder.replace(/_to_\d{2}-\d{2}-\d{2}$/i, '') : '';
                              const matchingRecords = records.filter(r => r.folderName === targetFolder || r.baseSessionKey === baseKey)
                                .sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));

                              if (matchingRecords.length > 0) {
                                let targetPartIdx = 0;
                                let targetOffset = validSec;

                                if (activeTranscriptModal.fileName) {
                                  const foundIdx = matchingRecords.findIndex(p => p.fileName === activeTranscriptModal.fileName);
                                  if (foundIdx >= 0) targetPartIdx = foundIdx;
                                }

                                if (!playingSession || playingSession.folderName !== targetFolder) {
                                  const first = matchingRecords[0];
                                  const newSession = {
                                    folderName: first.folderName,
                                    pcName: first.pcName,
                                    isParsed: first.isParsed,
                                    dateStr: first.dateStr,
                                    timeStr: first.timeStr,
                                    createdAt: first.createdAt,
                                    parts: matchingRecords
                                  };
                                  setPlayingSession(newSession);
                                }

                                pendingSeekOffsetRef.current = targetOffset;
                                setCurrentPartIndex(targetPartIdx);
                                if (audioRef.current && playingSession?.folderName === targetFolder && currentPartIndex === targetPartIdx) {
                                  audioRef.current.currentTime = targetOffset;
                                }
                                setLocalCurrentTime(targetOffset);
                                setIsPlaying(true);
                              }
                            }}
                            title="Klik untuk mendengarkan bagian ini pada pemutar audio"
                          >
                            <span className="transcript-time-pill">
                              <i className="fa-solid fa-play" style={{ fontSize: '0.65rem' }}></i>
                              {timeStr}
                            </span>
                            <div className="transcript-segment-text">
                              {seg.text}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', fontSize: '0.9rem', lineHeight: '1.6' }}>
                        {activeTranscriptModal.transcript.text || 'Tidak ada teks yang dapat ditranskripsi.'}
                      </div>
                    )}
                  </div>
                </>
              );
            }
            return null;
          })()}
            </div>
          </div>
        </div>
      )}

      {/* Keyword Alert Floating Toast */}
      {keywordAlertToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 1050,
          background: '#1e1b2e',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '10px',
          padding: '14px 18px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          maxWidth: '380px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          animation: 'fadeIn 0.3s ease'
        }}>
          <i className="fa-solid fa-triangle-exclamation" style={{ color: '#ef4444', fontSize: '1.2rem', marginTop: '2px' }}></i>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: '#f87171', fontSize: '0.9rem' }}>Deteksi Kata Bahaya!</div>
            <div style={{ fontSize: '0.8rem', color: '#fff', marginTop: '2px' }}>
              <strong>{keywordAlertToast.pcName}</strong>: {keywordAlertToast.keywords?.join(', ')}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
              "{keywordAlertToast.snippet}"
            </div>
          </div>
          <button 
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
            onClick={() => setKeywordAlertToast(null)}
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      </div>
    </div>
  );
}

export default function AppWithErrorBoundary(props) { return <ErrorBoundary><App {...props} /></ErrorBoundary>; };

