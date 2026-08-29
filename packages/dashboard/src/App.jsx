import React, { useState, useEffect, useRef } from 'react';
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
  const [remoteConfig, setRemoteConfig] = useState({});
  const [editingName, setEditingName] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [isCompactMode, setIsCompactMode] = useState(() => localStorage.getItem('isCompactMode') === 'true');
  useEffect(() => { localStorage.setItem('isCompactMode', isCompactMode); }, [isCompactMode]);
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Logs View State
  const [currentView, setCurrentView] = useState('live'); // 'live', 'logs', 'records', 'settings'
  const [logs, setLogs] = useState([]);
  const [records, setRecords] = useState([]);
  const [playingAudio, setPlayingAudio] = useState(null);
  const [systemLogs, setSystemLogs] = useState('');
  const [showSystemLogs, setShowSystemLogs] = useState(false);


  // Incident Filter State
  const getDefaultStartDate = () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); };
  const [incidentStartDate, setIncidentStartDate] = useState(getDefaultStartDate());
  const [incidentEndDate, setIncidentEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [incidentPcFilter, setIncidentPcFilter] = useState('');
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('');
  const [incidentPcNames, setIncidentPcNames] = useState([]);
  const [incidentPage, setIncidentPage] = useState(1);
  const logsPerPage = 15;
  
  
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
    const res = await fetch(`${SERVER_URL}/api/config`, { headers: { 'x-pin': pin } });
    if (res.ok) {
      setIsAuthenticated(true);
      sessionStorage.setItem('dashboardPin', pin);
      setLoginError('');
      fetchConfigData(await res.json());
    } else {
      setLoginError('PIN Salah');
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
    const end = new Date().toISOString().slice(0, 10);
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
    const startStr = startObj.toISOString().slice(0, 10);
    const endStr = endObj.toISOString().slice(0, 10);
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

  const exportToCSV = () => {
    if (logs.length === 0) {
      alert('Tidak ada data untuk diunduh.');
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
    link.setAttribute("download", `Incident_Logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    fetchConfig();
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

  useEffect(() => {
    if (isAuthenticated && currentView === 'logs') {
      fetchLogs({ startDate: incidentStartDate, endDate: incidentEndDate });
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
          interval: parseInt(telegramInterval, 10) || 60,
          logRetentionDays: logRetentionDays
        })
      });
      if (res.ok) await customAlert('Telegram Configuration Saved & Bot Reloaded!', 'Sukses');
    } catch (e) {
      await customAlert('Failed to save configuration', 'Error');
    }
  };

  
  const handleRemoteConfigSave = (e) => {
    e.preventDefault();
    if (!configModalAgent || !client.current || !client.current.socket) return;
    
    client.current.socket.emit('agent-config-update', {
      uuid: configModalAgent.uuid,
      config: remoteConfig
    });

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
          <button className={`nav-btn ${currentView === 'records' ? 'active' : ''}`} onClick={() => setCurrentView('records')}><i className="fa-solid fa-file-audio"></i> File Rekaman</button>
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
                              <h2 className="pc-name">
                                {agent.pcName}
                                {agent.isStreaming && (
                                  <div className="live-badge">LIVE {agent.streamTimecode || ''}</div>
                                )}
                              </h2>
                              <div className="card-actions">
                                <button 
                                  className={`toggle-btn ${agent.isMonitoringActive ? '' : 'off'}`}
                                  onClick={() => togglePcMonitoring(agent.uuid, !agent.isMonitoringActive)}
                                >
                                    {agent.isMonitoringActive ? <i className="fa-solid fa-pause" style={{marginRight: '4px'}}></i> : <i className="fa-solid fa-play" style={{marginRight: '4px'}}></i>} {agent.isMonitoringActive ? 'ON' : 'OFF'}
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

                                <button className="icon-btn" title="Delete PC" onClick={() => handleDeletePC(agent.uuid)}>
                                    <i className="fa-solid fa-trash"></i>
                                  </button>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="pc-id">ID: {agent.uuid} &bull; IP: {agent.localIp || 'Unknown'}</div>
                        {agent.currentScene && <div className="pc-id" style={{ marginTop: '2px', color: 'var(--accent)', fontWeight: 'bold' }}>Scene: {agent.currentScene}</div>}
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
                    </div>

                    <div className="meters">
                      <div className="meter-row" style={{ position: 'relative' }}>
                        <div className="meter-info" style={{ width: '145px', flexShrink: 0 }}>
                          <span className="meter-title">MIC Input</span>
                          <span className="meter-device" style={{ whiteSpace: 'normal', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.2' }}>{agent.micDriverName || 'No Device'}</span>
                        </div>
                        {agent.micHistory && (
                          <svg width="100%" height="20" viewBox="0 0 80 20" preserveAspectRatio="none" className="sparkline" style={{ flex: 1, margin: "0 10px" }}>
                            <polyline
                              points={agent.micHistory.map((val, i) => `${i * (80/30)},${20 - ((val || 0) / 100) * 20}`).join(' ')}
                              fill="none" stroke="#10b981" strokeWidth="1.5"
                            />
                          </svg>
                        )}
                        
                        <div style={{ width: '65px', textAlign: 'right', fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{agent.micDb !== undefined ? agent.micDb + ' dB' : ''}</div>
                        {agent.micClipping && <span style={{ position: 'absolute', top: '-22px', right: 0, background: 'var(--danger)', color: '#fff', fontSize: '0.6rem', padding: '2px 4px', borderRadius: '4px', fontWeight: 'bold' }}>⚠️ PECAH</span>}
                      </div>

                      
                        
                        <div className="meter-row" style={{ opacity: (agent.obsConnected === false) ? 0.4 : 1 }}>
                            <div className="meter-info" style={{ width: '145px', flexShrink: 0 }}>
                              <span className="meter-title">OBS Output</span>
                                  <span className="meter-device" style={{ whiteSpace: 'normal', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.2' }}>{agent.obsConnected === false ? 'Terputus dari OBS' : (agent.obsSourceName || 'System / Desktop')}
                                    {agent.obsConnected !== false && agent.obsSources && agent.obsSources.find(s => s.name === agent.obsSourceName) && (() => {
                                          const hw = agent.obsSources.find(s => s.name === agent.obsSourceName).hardwareId;
                                          const displayHw = (hw === 'Unknown' || hw === 'default' || hw === 'Default') ? (agent.micDriverName ? agent.micDriverName : hw) : hw;
                                          return <span style={{ color: '#888' }}> - {displayHw}</span>;
                                      })()}
                                  </span>
                                </div>
                              {agent.obsHistory && (
                                <svg width="100%" height="20" viewBox="0 0 80 20" preserveAspectRatio="none" className="sparkline" style={{ flex: 1, margin: "0 10px" }}>
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
                              <div style={{ width: '65px', textAlign: 'right', fontSize: '0.75rem', fontFamily: 'monospace', color: (agent.obsConnected === false) ? 'var(--danger)' : (agent.isObsMutedBtn ? 'var(--warning)' : 'var(--text-muted)') }}>
                                { agent.obsConnected === false ? 'DISCONNECTED' : (agent.isObsMutedBtn ? 'MUTED' : Number(agent.obsDb != null ? agent.obsDb : ((agent.obsLevel || 0) * 0.6 - 60)).toFixed(1) + ' dB') }
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
          
          // Chart Data (sorted by date ascending)
          const chartData = Object.entries(dayCounts)
            .map(([date, count]) => ({ date: new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }), count }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

          // Top Offenders Table Data
          const topOffenders = Object.entries(pcCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

          // Pagination logic
          const indexOfLastLog = incidentPage * logsPerPage;
          const indexOfFirstLog = indexOfLastLog - logsPerPage;
          const currentLogs = logs.slice(indexOfFirstLog, indexOfLastLog);
          const totalPages = Math.ceil(logs.length / logsPerPage) || 1;

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
                      {topOffenders.map(([pc, count], i) => (
                        <tr key={i}>
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
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Menampilkan {indexOfFirstLog + 1}-{Math.min(indexOfLastLog, totalIncidents)} dari {totalIncidents}</div>
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
                      <tr key={i}>
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
                    <button className="btn-page" disabled={incidentPage === 1} onClick={() => setIncidentPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                    <span className="page-info">Halaman {incidentPage} dari {totalPages}</span>
                    <button className="btn-page" disabled={incidentPage === totalPages} onClick={() => setIncidentPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {currentView === 'records' && (
          <div className="settings-layout" style={{ maxWidth: '1000px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 className="settings-header" style={{ marginBottom: 0 }}>File Rekaman</h1>
                <button className="btn-filter secondary" onClick={fetchRecords}><i className="fa-solid fa-rotate"></i> Muat Ulang</button>
              </div>
              <p className="settings-desc">Daftar file rekaman audio dari insiden yang disimpan oleh Agent.</p>
            </div>
            
            {/* Audio Player */}
            {playingAudio && (
              <div className="settings-card" style={{ marginBottom: '16px', background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                <div className="settings-card-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      <i className="fa-solid fa-volume-high" style={{ marginRight: '8px' }}></i>
                      Memutar: {playingAudio.name}
                    </div>
                    <button className="btn-filter secondary" style={{ padding: '4px 8px' }} onClick={() => setPlayingAudio(null)}><i className="fa-solid fa-xmark"></i> Tutup</button>
                  </div>
                  <audio controls autoPlay src={playingAudio.url} style={{ width: '100%', outline: 'none' }} />
                </div>
              </div>
            )}

            <div className="settings-card">
              <div className="settings-card-accent purple"></div>
              <div className="settings-card-content" style={{ padding: '0' }}>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Nama PC</th>
                      <th>Nama File (Waktu)</th>
                      <th>Ukuran</th>
                      <th style={{ textAlign: 'center' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((rec, i) => (
                      <tr key={i}>
                        <td><strong>{rec.pcName}</strong></td>
                        <td>{rec.fileName}<br/><span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{new Date(rec.createdAt).toLocaleString()}</span></td>
                        <td>{(rec.size / 1024 / 1024).toFixed(2)} MB</td>
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="btn-filter primary" 
                            style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                            onClick={() => setPlayingAudio({ url: rec.url, name: `${rec.pcName} - ${rec.fileName}` })}
                          >
                            <i className="fa-solid fa-play"></i> Play
                          </button>
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && (
                      <tr><td colSpan="4" style={{textAlign: 'center', color: 'var(--text-muted)'}}>Belum ada file rekaman yang tersimpan di server.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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
                          {configModalAgent.audioDevices.map((dev, i) => <option key={i} value={dev}>{dev}</option>)}
                        </select>
                      ) : (
                        <input className="form-input" value={remoteConfig.micDriverName || ''} onChange={e => setRemoteConfig({...remoteConfig, micDriverName: e.target.value})} />
                      )}
                    </div>
                    <div className="setting-group" style={{ marginBottom: 0 }}>
                      <label>OBS Source Name</label>
                      {configModalAgent.obsSources && configModalAgent.obsSources.length > 0 ? (
                        <select className="form-input" value={remoteConfig.obsSourceName || ''} onChange={e => setRemoteConfig({...remoteConfig, obsSourceName: e.target.value})}>
                          {configModalAgent.obsSources.map((s, i) => <option key={i} value={s.name}>{s.name}</option>)}
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
                        <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{remoteConfig.speakingThreshold || 10}%</span>
                      </label>
                      <input className="range-slider range-accent" type="range" value={remoteConfig.speakingThreshold || 10} onChange={e => setRemoteConfig({...remoteConfig, speakingThreshold: Number(e.target.value)})} min="1" max="100" />
                    </div>

                    <div className="setting-group">
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Noise Gate</span>
                        <span style={{ color: 'var(--warning)', fontWeight: 'bold' }}>{remoteConfig.noiseGate || 15}%</span>
                      </label>
                      <input className="range-slider range-warning" type="range" value={remoteConfig.noiseGate || 15} onChange={e => setRemoteConfig({...remoteConfig, noiseGate: Number(e.target.value)})} min="0" max="100" />
                    </div>
    
                    <div className="setting-group" style={{ marginBottom: 0 }}>
                      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Batas Pecah (Clipping Threshold)</span>
                        <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{remoteConfig.clippingThreshold || 95}%</span>
                      </label>
                      <input className="range-slider range-danger" type="range" value={remoteConfig.clippingThreshold || 95} onChange={e => setRemoteConfig({...remoteConfig, clippingThreshold: Number(e.target.value)})} min="50" max="100" />
                    </div>
                  </div>

                  <div className="modal-section" style={{ marginBottom: '24px' }}>
                    <div className="modal-section-title">Timeout Rules</div>
                    <div className="timeout-grid">
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Silence (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.silenceTimeoutSec || 15} onChange={e => setRemoteConfig({...remoteConfig, silenceTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Dead Mic (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.deadMicTimeoutSec || 30} onChange={e => setRemoteConfig({...remoteConfig, deadMicTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                        <label>Mute OBS (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.obsMuteTimeoutSec || 3} onChange={e => setRemoteConfig({...remoteConfig, obsMuteTimeoutSec: Number(e.target.value)})} min="1" />
                      </div>
                      <div className="setting-group" style={{ marginBottom: 0 }}>
                    <label>Pecah (s)</label>
                        <input className="form-input" type="number" value={remoteConfig.clippingDurationSec || 3} onChange={e => setRemoteConfig({...remoteConfig, clippingDurationSec: Number(e.target.value)})} min="1" />
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

