import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import DashboardClient from './core/DashboardClient';

const SERVER_URL = window.location.port.startsWith('517') ? `http://${window.location.hostname}:4000` : window.location.origin;

function App() {
  const [agents, setAgents] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Logs View State
  const [currentView, setCurrentView] = useState('live'); // 'live', 'logs', 'settings'
  const [logs, setLogs] = useState([]);
  
  // Settings State
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
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
    }
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

  const fetchLogs = async () => {
    try {
      const res = await apiFetch('/api/incidents');
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (isAuthenticated && currentView === 'logs') {
      fetchLogs();
    } else if (isAuthenticated && currentView === 'settings') {
      fetchConfig();
    }
  }, [currentView, isAuthenticated]);

  useEffect(() => {
    localStorage.setItem('enableBeep', enableBeep);
  }, [enableBeep]);

  const client = useRef(null);

  useEffect(() => {

    client.current = new DashboardClient(
      SERVER_URL,
      (connected) => setIsConnected(connected),
      (data) => {
        setAgents((prev) => {
          const prevData = prev[data.uuid] || {};
          const isOffline = data.status === 'OFFLINE';
          const mic = isOffline ? 0 : (data.micLevel !== undefined ? data.micLevel : prevData.micLevel || 0);
          const obs = isOffline ? 0 : (data.obsLevel !== undefined ? data.obsLevel : prevData.obsLevel || 0);

          return {
            ...prev,
            [data.uuid]: {
              ...prevData,
              ...data,
              timestamp: Date.now(),
              micLevel: mic,
              obsLevel: obs,
              micHistory: [...(prevData.micHistory || Array(30).fill(0)), mic].slice(-30),
              obsHistory: [...(prevData.obsHistory || Array(30).fill(0)), obs].slice(-30)
            }
          };
        });
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
      }
    );

    client.current.connect();

    return () => {
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
        alert('Error renaming PC');
      }
    }
  };

  const saveTelegramConfig = async () => {
    try {
      const res = await apiFetch(`/api/config/telegram`, {
        method: 'POST',
        body: JSON.stringify({ token: telegramToken, chatId: telegramChatId })
      });
      if (res.ok) alert('Telegram Configuration Saved & Bot Reloaded!');
    } catch (e) {
      alert('Failed to save configuration');
    }
  };

  const savePinConfig = async () => {
    if (newPinInput.length < 4) {
      alert('PIN minimal 4 karakter');
      return;
    }
    try {
      const res = await apiFetch(`/api/config/pin`, {
        method: 'POST',
        body: JSON.stringify({ newPin: newPinInput })
      });
      if (res.ok) {
        alert('PIN Berhasil Diubah!');
        setPin(newPinInput);
        sessionStorage.setItem('dashboardPin', newPinInput);
        setNewPinInput('');
      }
    } catch (e) {
      alert('Gagal mengubah PIN');
    }
  };

  const testTelegram = async () => {
    try {
      const res = await apiFetch(`/api/telegram/test`, { method: 'POST' });
      if (res.ok) alert('Test signal sent! Check your Telegram.');
    } catch (e) {
      alert('Failed to send test signal');
    }
  };

  const clearDatabase = async () => {
    if (window.confirm("ARE YOU SURE? This will permanently delete all incident logs from the server database.")) {
      try {
        const res = await apiFetch(`/api/incidents`, { method: 'DELETE' });
        if (res.ok) {
          alert('Database cleared!');
          if (currentView === 'logs') fetchLogs();
        }
      } catch (e) {
        alert('Failed to clear database');
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
      alert('Failed to toggle PC monitoring');
    }
  };

  const agentsArray = Object.values(agents);
  const totalConnected = agentsArray.filter(a => a.status !== 'OFFLINE').length;
  const totalBahaya = agentsArray.filter(a => a.status?.startsWith('BAHAYA') && a.isMonitoringActive !== false).length;
  const totalStandby = agentsArray.filter(a => a.status === 'STANDBY_DIAM').length;

  const statusPriority = {
    'BAHAYA_OBS_MUTE': 1,
    'BAHAYA_MIC_MATI': 1,
    'AMAN': 2,
    'STANDBY_DIAM': 3,
    'OFFLINE': 4
  };

  const sortedFilteredAgents = agentsArray
    .filter(agent => filterStatus === 'ALL' || agent.status === filterStatus)
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
          <h2><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "8px", verticalAlign: "text-bottom"}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>AudioMonitor Server</h2>
          <p>Masukkan PIN untuk masuk ke Dashboard</p>
          <input 
            type="password" 
            placeholder="Masukkan PIN..." 
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
          {loginError && <div className="login-error">{loginError}</div>}
          <button type="submit">Masuk</button>
        </form>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <h1>Central Audio Dashboard</h1>
          <div className="view-toggles">
            <button className={`view-btn ${currentView === 'live' ? 'active' : ''}`} onClick={() => setCurrentView('live')}>Live Status</button>
            <button className={`view-btn ${currentView === 'logs' ? 'active' : ''}`} onClick={() => setCurrentView('logs')}>Incident Logs</button>
            <button className={`view-btn ${currentView === 'settings' ? 'active' : ''}`} onClick={() => setCurrentView('settings')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>Settings</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? 'Server Connected' : 'Disconnected'}
          </div>
        </div>
      </header>

      {currentView === 'live' ? (
        <>
          <div className="summary-container">
            <div className="summary-card active">
              <div className="summary-value">{totalConnected}</div>
              <div className="summary-label">PC Terhubung</div>
            </div>
            <div className="summary-card danger">
              <div className="summary-value">{totalBahaya}</div>
              <div className="summary-label">Bahaya / Mute</div>
            </div>
            <div className="summary-card standby">
              <div className="summary-value">{totalStandby}</div>
              <div className="summary-label">Standby</div>
            </div>
          </div>

          <div className="controls-bar">
            <input
              type="text"
              placeholder="Cari PC..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="filter-select">
              <option value="ALL">Semua Status</option>
              <option value="AMAN">Aman</option>
              <option value="BAHAYA_OBS_MUTE">Bahaya (OBS Mute)</option>
              <option value="BAHAYA_MIC_MATI">Bahaya (Mic Mati)</option>
              <option value="STANDBY_DIAM">Standby (Diam)</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </div>

          <div className="grid">
            {sortedFilteredAgents.map(agent => {
              const isHardwareWarning = agent.cpuUsage > 85 || agent.ramUsage > 85;
              return (
                <div key={agent.uuid} className={`agent-card ${agent.status}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                    {editingId === agent.uuid ? (
                      <form onSubmit={(e) => submitInlineRename(e, agent.uuid)} style={{ display: 'flex', gap: '5px', width: '100%' }}>
                        <input
                          autoFocus
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          style={{ padding: '5px', borderRadius: '4px', border: 'none', width: '100%' }}
                        />
                        <button type="submit" style={{ padding: '5px', cursor: 'pointer', background: '#2196f3', color: 'white', border: 'none', borderRadius: '4px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></button>
                        <button type="button" onClick={() => setEditingId(null)} style={{ padding: '5px', cursor: 'pointer', background: '#555', color: 'white', border: 'none', borderRadius: '4px' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                      </form>
                    ) : (
                      <>
                        <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>{agent.pcName}</h2>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button 
                            onClick={() => togglePcMonitoring(agent.uuid, agent.isMonitoringActive === false ? true : false)}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '12px',
                              border: `1px solid ${agent.isMonitoringActive !== false ? '#4caf50' : '#f44336'}`,
                              background: agent.isMonitoringActive !== false ? '#1e3a24' : '#3a1e1e',
                              color: agent.isMonitoringActive !== false ? '#4caf50' : '#f44336',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              fontSize: '0.7rem'
                            }}
                          >
                            {agent.isMonitoringActive !== false ? '● ON' : '● OFF'}
                          </button>
                          
                          <button 
                            onClick={() => { setEditingId(agent.uuid); setEditingName(agent.pcName); }} 
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid transparent', color: '#888', cursor: 'pointer', flexShrink: 0, padding: '6px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
                            onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#888'; }}
                            title="Ubah Nama PC"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="pc-meta" style={{ marginBottom: '15px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, paddingRight: '15px' }}>
                      <span className="uuid" style={{ fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.6 }}>{agent.uuid}</span>
                    </div>
                    {agent.cpuUsage !== undefined && (
                      <span className={`hardware-stats ${isHardwareWarning ? 'warning' : ''}`} style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        CPU: {agent.cpuUsage}% | RAM: {agent.ramUsage}%
                      </span>
                    )}
                  </div>

                  <h3 className="status-text">{agent.status.replace(/_/g, ' ')}</h3>

                  <div className="meter-container">
                      <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, paddingRight: '10px' }}>
                          <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Mic {agent.micLevel === 0 && agent.rawMicLevel > 0 ? '(Gated)' : ''}</label>
                          {agent.micDriverName && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', color: '#888', fontSize: '0.75rem' }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                <line x1="12" y1="19" x2="12" y2="22"></line>
                              </svg>
                              <span style={{ fontStyle: 'italic', wordBreak: 'break-word', lineHeight: '1.2' }}>{agent.micDriverName.replace('Default - ', '')}</span>
                            </div>
                          )}
                        </div>
                        {agent.micHistory && (
                          <svg width="120" height="25" className="sparkline" style={{ marginTop: '2px', flexShrink: 0 }}>
                          <polyline
                            points={agent.micHistory.map((val, i) => `${i * 4},${25 - ((val || 0) / 100) * 25}`).join(' ')}
                            fill="none" stroke="#4caf50" strokeWidth="2"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="meter-bg" style={{ position: 'relative' }}>
                      {agent.noiseGate !== undefined && (
                        <div style={{
                          position: 'absolute', left: `${agent.noiseGate}%`, top: 0, bottom: 0, width: '3px', backgroundColor: '#ff9800', zIndex: 10
                        }}></div>
                      )}
                      <div
                        className="meter-fill mic"
                        style={{ 
                          width: `${Math.min(agent.rawMicLevel !== undefined ? agent.rawMicLevel : agent.micLevel, 100)}%`,
                          filter: agent.micLevel === 0 && agent.rawMicLevel > 0 ? 'grayscale(100%) opacity(0.4)' : 'none'
                        }}
                      ></div>
                    </div>
                  </div>

                  <div className="meter-container" style={{ marginTop: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, paddingRight: '10px' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>OBS Output</label>
                        {agent.obsSourceName && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', color: '#888', fontSize: '0.75rem', marginTop: '2px' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                              <line x1="12" y1="19" x2="12" y2="22"></line>
                            </svg>
                            <span style={{ fontStyle: 'italic', wordBreak: 'break-word', lineHeight: '1.2' }}>{agent.obsSourceName}</span>
                          </div>
                        )}
                      </div>
                      {agent.obsHistory && (
                        <svg width="120" height="25" className="sparkline" style={{ marginTop: '2px', flexShrink: 0 }}>
                          <polyline
                            points={agent.obsHistory.map((val, i) => `${i * 4},${25 - ((val || 0) / 100) * 25}`).join(' ')}
                            fill="none" stroke="#2196f3" strokeWidth="2"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="meter-bg">
                      <div
                        className="meter-fill obs"
                        style={{ width: `${Math.min(agent.obsLevel, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  <p className="timestamp">Last update: {new Date(agent.timestamp).toLocaleTimeString()}</p>
                </div>
              );
            })}
            {Object.keys(agents).length === 0 && (
              <p className="empty-state">Waiting for PC Streaming connections...</p>
            )}
          </div>
        </>
      ) : currentView === 'logs' ? (
        <div className="logs-container">
          <h2>Recent Incidents</h2>
          <button className="primary-btn" onClick={fetchLogs} style={{ marginBottom: '15px' }}>Refresh Logs</button>
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>PC Name</th>
                <th>Type</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan="4" style={{ textAlign: 'center', padding: '20px' }}>No incidents recorded yet.</td></tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className={(log.incidentType || '').includes('RECOVERY') ? 'recovery-row' : (log.incidentType || '').includes('BAHAYA') ? 'danger-row' : ''}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.pcName}</td>
                    <td>{(log.incidentType || '').replace(/_/g, ' ')}</td>
                    <td>{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : currentView === 'settings' ? (
        <div className="logs-container">
          <h2><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>Dashboard Settings</h2>
          
          <div style={{ background: '#222', padding: '20px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #2196f3' }}>
            <h3 style={{ marginTop: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "8px", verticalAlign: "text-bottom"}}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>Telegram Alerts</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem' }}>Konfigurasi bot Telegram untuk menerima peringatan jika ada audio yang bermasalah.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', maxWidth: '500px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>Bot Token</label>
                <input 
                  type="text" 
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  className="search-input" 
                  style={{ width: '100%' }}
                  placeholder="e.g., 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', color: '#ccc' }}>Chat ID</label>
                <input 
                  type="text" 
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  className="search-input" 
                  style={{ width: '100%' }}
                  placeholder="e.g., -100123456789"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="primary-btn" onClick={saveTelegramConfig}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>Save Configuration</button>
                <button className="view-btn" onClick={testTelegram} style={{ background: '#4caf50', color: 'white' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>Test Alert</button>
              </div>
            </div>
          </div>

          <div style={{ background: '#222', padding: '20px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #9c27b0' }}>
            <h3 style={{ marginTop: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "8px", verticalAlign: "text-bottom"}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Keamanan Akses (PIN)</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem' }}>Ubah PIN untuk mengakses Dashboard ini.</p>
            <div style={{ display: 'flex', gap: '10px', maxWidth: '300px' }}>
              <input 
                type="password" 
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value)}
                className="search-input" 
                style={{ width: '100%' }}
                placeholder="PIN Baru..."
              />
              <button className="primary-btn" onClick={savePinConfig}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>Ubah</button>
            </div>
          </div>

          <div style={{ background: '#222', padding: '20px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #ff9800' }}>
            <h3 style={{ marginTop: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "8px", verticalAlign: "text-bottom"}}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>Local Dashboard Audio</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem' }}>Pengaturan suara peringatan yang berbunyi langsung di browser ini.</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={enableBeep}
                onChange={(e) => setEnableBeep(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
              <span style={{ fontSize: '1.1rem' }}>Nyalakan suara "Beep" jika ada PC dalam status BAHAYA</span>
            </label>
          </div>

          <div style={{ background: '#3a1515', padding: '20px', borderRadius: '8px', borderLeft: '4px solid #f44336' }}>
            <h3 style={{ marginTop: 0, color: '#f44336' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "8px", verticalAlign: "text-bottom"}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>Danger Zone</h3>
            <p style={{ color: '#aaa', fontSize: '0.9rem' }}>Tindakan destruktif yang tidak dapat dibatalkan.</p>
            <button 
              className="primary-btn" 
              onClick={clearDatabase}
              style={{ background: '#f44336' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", verticalAlign: "text-bottom"}}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>Clear All Incident Logs
            </button>
          </div>

        </div>
      ) : null}
    </div>
  );
}

export default App;
