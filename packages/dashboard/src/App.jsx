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

const getMediaUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${SERVER_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

function App() {
  const [agents, setAgents] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
    const [dialogParams, setDialogParams] = useState(null);
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
  const [systemLogs, setSystemLogs] = useState('');
  const [showSystemLogs, setShowSystemLogs] = useState(false);

  // Helper untuk format tanggal lokal (WIB / UTC+7 aman tanpa pergeseran hari)
  const getLocalDateStr = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

  // Auth State
  const [pin, setPin] = useState(sessionStorage.getItem('dashboardPin') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(null); // null = checking
  const [loginError, setLoginError] = useState('');

  const apiFetch = async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      'x-pin': pin,
      ...(options.headers || {})
    };
    const res = await fetch(`${SERVER_URL}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      setIsAuthenticated(false);
      sessionStorage.removeItem('dashboardPin');
    }
    return res;
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
      const res = await fetch(`${SERVER_URL}/api/updates/upload-agent`, {
        method: 'POST',
        headers: {
          'x-pin': pin,
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

  useEffect(() => {
    fetchConfig();
    checkServerUpdates();
  }, []);

  const fetchRecords = async () => {
    try {
      const res = await apiFetch('/api/records');
      if (res.ok) {
        setRecords(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch records', e);
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
    let ctx = null;

    // Decode exact sample-accurate durations with single reusable AudioContext
    const probeExactDurations = async () => {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const results = await Promise.all(
          playingSession.parts.map(async (p, idx) => {
            try {
              const res = await fetch(getMediaUrl(p.url), { signal: abortController.signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const buf = await res.arrayBuffer();
              const decoded = await ctx.decodeAudioData(buf);
              const d = decoded.duration;
              if (d && isFinite(d) && !isNaN(d) && d > 0) {
                return d;
              }
            } catch (err) {
              if (err.name !== 'AbortError') {
                console.warn(`Duration probe failed for ${p.fileName}:`, err.message);
              }
            }
            return initialEstimated[idx] || 0;
          })
        );

        if (!abortController.signal.aborted) {
          setPartDurations(results);
        }
      } catch (e) {
        // ignore abort
      } finally {
        if (ctx && ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
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
    } else if (isAuthenticated && currentView === 'settings') {
      fetchConfig();
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
               micHistory: (d.micHistory || existing.micHistory || []).slice(-30),
               obsHistory: (d.obsHistory || existing.obsHistory || []).slice(-30)
             };
          }
          hasChanges = true;
        }

        if (agentBuffer.length > 0) {
          const toProcess = agentBuffer;
          agentBuffer = [];
          
          for (const data of toProcess) {
            const prevData = next[data.uuid] || {};
            const isOffline = data.status === 'OFFLINE';
            const mic = isOffline ? 0 : (data.micLevel !== undefined ? data.micLevel : prevData.micLevel || 0);
            const obs = isOffline ? 0 : (data.obsLevel !== undefined ? data.obsLevel : prevData.obsLevel || 0);
            const updatedObsSources = isOffline ? [] : (data.obsSources || prevData.obsSources);
            
            next[data.uuid] = {
              ...prevData,
              ...data,
              timestamp: Date.now(),
              obsSources: updatedObsSources,
              micLevel: mic,
              obsLevel: obs,
              micHistory: [...(prevData.micHistory || Array(30).fill(0)), mic].slice(-30),
              obsHistory: [...(prevData.obsHistory || Array(30).fill(0)), obs].slice(-30)
            };
          }
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
      }
    );

    client.current.connect();

    return () => {
      clearInterval(flushBuffer);
      if (client.current) client.current.disconnect();
    };
  }, []);

  const submitInlineRename = async (e, uuid) => {
    e.preventDefault();
    if (client.current && editingName.trim() !== '') {
      try {
        await client.current.renamePC(uuid, editingName.trim(), pin);

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
        await customAlert('Error renaming PC', 'Error');
      }
    }
  };

  const saveTelegramConfig = async () => {
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
    }
  };

  const saveRetentionConfig = async () => {
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
    const confirmed = await customConfirm('Apakah Anda yakin ingin menghapus PC ini dari Dashboard?', 'Hapus PC?');
      if (confirmed) {
      try {
        await client.current.deletePC(uuid, pin);
      } catch (e) {
        await customAlert('Gagal menghapus PC', 'Error');
      }
    }
  };

  const togglePcMonitoring = async (uuid, active) => {
    // Optimistically update local state so button responds immediately
    setAgents(prev => ({
      ...prev,
      [uuid]: { ...prev[uuid], isMonitoringActive: active }
    }));

    try {
      await apiFetch(`/api/pc/${uuid}/monitoring`, {
        method: 'POST',
        body: JSON.stringify({ active })
      });
    } catch (e) {
      // Revert on failure
      setAgents(prev => ({
        ...prev,
        [uuid]: { ...prev[uuid], isMonitoringActive: !active }
      }));
      await customAlert('Failed to toggle PC monitoring', 'Error');
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
          <div className="modal" style={{ maxWidth: '400px', backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{dialogParams.title}</h3>
              <button type="button" className="close-btn" onClick={dialogParams.onCancel}>&times;</button>
            </div>
            <div className="modal-body" style={{ padding: '24px' }}>
              <p style={{ margin: 0, fontSize: '0.95rem', color: '#ccc' }}>{dialogParams.message}</p>
            </div>
            <div className="modal-footer" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {dialogParams.type === 'confirm' && (
                <button type="button" style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} onClick={dialogParams.onCancel}>Batal</button>
              )}
              <button type="button" style={{ background: dialogParams.type === 'confirm' ? 'var(--danger)' : 'var(--accent)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }} onClick={dialogParams.onConfirm}>OK</button>
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
                              <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)} className="form-input" style={{padding: '4px 8px'}} />
                              <button type="submit" className="icon-btn" style={{background: 'var(--accent)', color: '#fff'}}><i className="fa-solid fa-check"></i></button>
                              <button type="button" onClick={() => setEditingId(null)} className="icon-btn"><i className="fa-solid fa-times"></i></button>
                            </form>
                          ) : (
                            <>
                              <div className="pc-name-wrapper">
                                <span className="pc-name-title" title={agent.pcName}>{agent.pcName}</span>
                                <span className="badge-agent-version">v{agent.appVersion || '1.0.1'}</span>
                                {agent.isStreaming && (
                                  <span className="live-badge">LIVE {agent.streamTimecode || ''}</span>
                                )}
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

                                <button className="icon-btn" title="Hapus PC" onClick={() => handleDeletePC(agent.uuid)}>
                                  <i className="fa-solid fa-trash"></i>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="pc-meta-row">
                          <span className="pc-meta-item">IP: {agent.localIp || 'Unknown'}</span>
                          {agent.currentScene && (
                            <span className="pc-meta-item scene-pill"><i className="fa-solid fa-film" style={{ marginRight: '4px' }}></i>{agent.currentScene}</span>
                          )}
                          {!isCompactMode && (
                            <span className="pc-meta-item id-pill" title={agent.uuid}>ID: {agent.uuid.substring(0, 8)}...</span>
                          )}
                        </div>
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
                        {agent.micHistory && (
                          <svg width="100%" height="20" viewBox="0 0 80 20" preserveAspectRatio="none" className="sparkline">
                            <polyline
                              points={agent.micHistory.map((val, i) => `${i * (80/30)},${20 - ((val || 0) / 100) * 20}`).join(' ')}
                              fill="none" stroke="#10b981" strokeWidth="1.5"
                            />
                          </svg>
                        )}
                        
                        <div className="meter-db-value">
                          {isFinite(Number(agent.micDb)) ? Number(agent.micDb).toFixed(1) + ' dB' : '-60.0 dB'}
                        </div>
                        {agent.micClipping && <span className="clipping-tag">PECAH</span>}
                      </div>

                      <div className="meter-row" style={{ opacity: (agent.obsConnected === false) ? 0.4 : 1 }}>
                        <div className="meter-info">
                          <span className="meter-title">OBS Output</span>
                          {!isCompactMode && (
                            <span className="meter-device">{agent.obsConnected === false ? 'Terputus dari OBS' : (agent.obsSourceName || 'Mic/Aux')}</span>
                          )}
                        </div>
                        {agent.obsHistory && (
                          <svg width="100%" height="20" viewBox="0 0 80 20" preserveAspectRatio="none" className="sparkline">
                            {agent.obsConnected === false ? (
                              <line x1="0" y1="10" x2="80" y2="10" stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="4 2" />
                            ) : agent.isObsMutedBtn ? (
                              <line x1="0" y1="19" x2="80" y2="19" stroke="var(--warning)" strokeWidth="1.5" />
                            ) : (
                              <polyline
                                points={agent.obsHistory.map((val, i) => `${i * (80/30)},${20 - ((val || 0) / 100) * 20}`).join(' ')}
                                fill="none" stroke="#3b82f6" strokeWidth="1.5"
                              />
                            )}
                          </svg>
                        )}
                        <div className="meter-db-value" style={{ color: agent.obsConnected === false ? 'var(--danger)' : (agent.isObsMutedBtn ? 'var(--warning)' : undefined) }}>
                          {agent.obsConnected === false ? 'DISCONNECTED' : (agent.isObsMutedBtn ? 'MUTED' : (isFinite(Number(agent.obsDb)) ? Number(agent.obsDb).toFixed(1) + ' dB' : '-60.0 dB'))}
                        </div>
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

        {currentView === 'records' && (
          <div className="settings-layout" style={{ maxWidth: '1050px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="settings-header" style={{ marginBottom: 0 }}>File Rekaman</h1>
                <button className="btn-filter secondary" onClick={fetchRecords}><i className="fa-solid fa-rotate"></i> Muat Ulang</button>
              </div>
              <p className="settings-desc">Daftar rekaman insiden suara berdasarkan sesi kejadian. Potongan audio (part) dapat diputar berurutan secara otomatis.</p>
            </div>

            {/* Quick Filters */}
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

            {/* Filter Bar */}
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

            {(() => {
              // 1. Group records by PC
              // 2. Inside each PC, group by folderName (Session)
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
                
                // Gunakan baseSessionKey agar part sebelum & sesudah rename tetap bersatu dalam 1 sesi kejadian
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
                    createdAt: r.createdAt,
                    totalSize: 0,
                    parts: []
                  };
                }
                
                const sess = pcGrouped[r.pcName].sessions[sessionKey];
                // Jika file ini berasal dari folder yang sudah ada jam stop-nya, perbarui info waktu sesi
                const isThisRecordCompleted = r.isCompleted || (r.folderName && r.folderName.includes('_to_'));
                if (isThisRecordCompleted && !sess.isCompleted) {
                  sess.isCompleted = true;
                  sess.timeStr = r.timeStr;
                  sess.folderName = r.folderName;
                }

                sess.totalSize += (r.size || 0);
                sess.parts.push(r);
              });

              // Sort parts inside each session by fileName
              Object.values(pcGrouped).forEach(pcData => {
                Object.values(pcData.sessions).forEach(sess => {
                  sess.parts.sort((a, b) => (a.fileName || '').localeCompare(b.fileName || ''));
                });
              });

              const pcNames = Object.keys(pcGrouped);

              if (pcNames.length === 0) {
                return (
                  <div className="settings-card">
                    <div className="settings-card-content" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      {recordPcFilter 
                        ? `Tidak ada file rekaman untuk PC "${recordPcFilter}".` 
                        : 'Belum ada file rekaman yang tersimpan di server.'}
                    </div>
                  </div>
                );
              }

              return pcNames.map(pc => {
                const pcData = pcGrouped[pc];
                const sessions = Object.values(pcData.sessions).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                const totalPcParts = sessions.reduce((acc, s) => acc + s.parts.length, 0);

                return (
                  <div className="settings-card" key={pc} style={{ marginBottom: '24px' }}>
                    <div className="settings-card-accent purple"></div>
                    <div className="settings-card-content" style={{ padding: '0' }}>
                      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center' }}>
                            <i className="fa-solid fa-desktop" style={{ marginRight: '8px', color: 'var(--accent)' }}></i> 
                            {pc} 
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: '12px' }}>
                              ({sessions.length} Sesi Kejadian &bull; {totalPcParts} Total Potongan)
                            </span>
                          </h3>
                        </div>
                        {pcData.uuid && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '4px', marginLeft: '24px' }}>
                            ID: {pcData.uuid}
                          </div>
                        )}
                      </div>

                      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        {sessions.map((session, sIdx) => {
                          const isSessionActive = playingSession?.folderName === session.folderName;

                          return (
                            <div 
                              key={session.folderName || sIdx} 
                              className={`record-session-box ${isSessionActive ? 'active-playing' : ''}`}
                            >
                              <div className="session-box-header">
                                <div>
                                  <div className="session-time-title">
                                    <i className="fa-solid fa-calendar-day" style={{ marginRight: '6px', color: 'var(--accent)' }}></i>
                                    <strong>{session.isParsed ? session.dateStr : new Date(session.createdAt).toLocaleDateString()}</strong>
                                    <span className="session-time-badge">
                                      <i className="fa-solid fa-clock" style={{ marginRight: '4px' }}></i>
                                      {session.isParsed ? session.timeStr : new Date(session.createdAt).toLocaleTimeString()}
                                    </span>
                                    {!session.isParsed && <span style={{ fontSize: "0.75rem", color: "var(--warning)", marginLeft: "8px" }}>Format lama</span>}
                                  </div>
                                  <div className="session-meta">
                                    Total: {session.parts.length} Potongan &bull; {(session.totalSize / 1024 / 1024).toFixed(2)} MB
                                  </div>
                                </div>

                                <div>
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

                              <div className="session-parts-list">
                                <span className="parts-label">Pilih Potongan:</span>
                                <div className="part-chips-wrapper">
                                  {session.parts.map((part, pIdx) => {
                                    const isPartPlaying = isSessionActive && currentPartIndex === pIdx;

                                    return (
                                      <button
                                        key={`${part.url || ''}-${pIdx}`}
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
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {currentView === 'settings' && (
          <div className="settings-layout">
            <div>
              <h1 className="settings-header">Dashboard Settings</h1>
              <p className="settings-desc">Kelola konfigurasi sistem peringatan pusat dan keamanan akses dashboard.</p>
            </div>

            <div className="settings-card">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                  Telegram Alerts
                </h2>
                <p className="settings-card-subtitle">Konfigurasi bot Telegram untuk menerima peringatan terpusat jika ada audio PC yang bermasalah.</p>
                
                <div className="form-group">
                  <label className="form-label">Bot Token</label>
                  <input type="text" className="form-input" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder="e.g., 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" />
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
                  <button className="btn btn-primary" onClick={saveTelegramConfig}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    Save Configuration
                  </button>
                  <button className="btn btn-success" onClick={testTelegram}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    Test Alert
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-accent purple"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  Keamanan Akses (PIN)
                </h2>
                <p className="settings-card-subtitle">Ubah PIN master yang digunakan untuk menghapus PC atau mengakses pengaturan.</p>
                <div style={{ display: 'flex', gap: '16px', maxWidth: '400px' }}>
                  <input type="password" className="form-input" value={newPinInput} onChange={(e) => setNewPinInput(e.target.value)} placeholder="Masukkan PIN Baru..." />
                  <button className="btn btn-primary" onClick={savePinConfig} style={{ whiteSpace: 'nowrap' }}>Ubah PIN</button>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-accent green"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
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
                  <button className="btn btn-primary" onClick={saveRetentionConfig}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    Simpan Batas Retensi
                  </button>
                  <button className="btn btn-secondary" onClick={handleManualCleanupNow} style={{ background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Bersihkan Log Lama Sekarang
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-accent teal"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                  Local Dashboard Audio
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

            {/* Centralized Update Management Card (Hybrid: GitHub + Direct Upload + LAN Broadcast) */}
            <div className="settings-card">
              <div className="settings-card-accent blue"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title">
                  <i className="fa-solid fa-cloud-arrow-down" style={{ marginRight: '8px' }}></i>
                  Pembaruan Aplikasi Terpusat (LAN Auto-Update Hub)
                </h2>
                <p className="settings-card-subtitle">
                  Kelola dan sebarkan pembaruan versi Agent ke seluruh komputer di jaringan lokal tanpa menyalin file manual ke komputer server.
                </p>

                {/* Grid 2 Opsi Sumber: GitHub Sync & Direct Upload */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                  
                  {/* Opsi 1: GitHub 1-Click Sync */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '0.95rem', color: '#60a5fa', marginBottom: '8px' }}>
                      <i className="fa-brands fa-github" style={{ fontSize: '1.2rem' }}></i>
                      1-Klik Unduh dari GitHub
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                      Server akan memeriksa dan mengunduh rilis installer terbaru langsung dari repositori GitHub.
                    </p>

                    {githubReleaseInfo && githubReleaseInfo.hasRelease && (
                      <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '6px', padding: '10px', marginBottom: '12px', fontSize: '0.8rem' }}>
                        <div><strong>Rilis:</strong> {githubReleaseInfo.name || githubReleaseInfo.tag}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                          File: {githubReleaseInfo.asset ? `${githubReleaseInfo.asset.name} (${(((githubReleaseInfo.asset.size || 0)) / 1024 / 1024).toFixed(1)} MB)` : 'Tidak ada installer .exe'}
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

                  {/* Opsi 2: Upload File .exe via Browser */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', fontSize: '0.95rem', color: '#34d399', marginBottom: '8px' }}>
                      <i className="fa-solid fa-file-arrow-up" style={{ fontSize: '1.1rem' }}></i>
                      Upload File Installer Manual
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                      Pilih file <code>.exe</code> dari komputer Anda untuk dikirimkan langsung ke Server tanpa perlu buka explorer Server.
                    </p>

                    <label className={`btn-filter secondary ${isUploadingInstaller ? 'disabled' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                      <i className={`fa-solid fa-upload ${isUploadingInstaller ? 'fa-spin' : ''}`} style={{ marginRight: '6px' }}></i>
                      {isUploadingInstaller ? 'Mengupload File...' : 'Pilih File Installer (.exe)'}
                      <input type="file" accept=".exe" onChange={handleUploadInstaller} style={{ display: 'none' }} disabled={isUploadingInstaller} />
                    </label>
                  </div>

                </div>

                {/* Status Distribusi Installer di Server */}
                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>
                        Paket Installer yang Siap di Server:
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
                            Belum ada file installer di Server. Silakan unduh dari GitHub atau upload file di atas.
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

            <div className="settings-card">
              <div className="settings-card-accent red"></div>
              <div className="settings-card-content">
                <h2 className="settings-card-title" style={{color: 'var(--danger)'}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                  Danger Zone
                </h2>
                <p className="settings-card-subtitle">Tindakan destruktif yang tidak dapat dibatalkan.</p>
                <button className="btn btn-danger" onClick={clearDatabase}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  Clear All Incident Logs
                </button>
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
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>v{configModalAgent.appVersion || '1.0.1'}</div>
                      </div>
                      {serverUpdateInfo?.hasUpdate && (
                        <button 
                          type="button" 
                          className="btn-filter primary" 
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => triggerAgentUpdate(configModalAgent.uuid)}
                        >
                          <i className="fa-solid fa-cloud-arrow-down"></i> Update ke v{serverUpdateInfo.version}
                        </button>
                      )}
                    </div>
                  </div>

                  <button type="submit" className="btn-primary" style={{ marginTop: '24px' }}>Save & Sync to Agent</button>
                </form>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

export default function AppWithErrorBoundary(props) { return <ErrorBoundary><App {...props} /></ErrorBoundary>; };

