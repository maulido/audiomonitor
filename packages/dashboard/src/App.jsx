import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import DashboardClient from './core/DashboardClient';

const SERVER_URL = `http://${window.location.hostname || 'localhost'}:4000`;

function App() {
  const [agents, setAgents] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Logs View State
  const [currentView, setCurrentView] = useState('live'); // 'live' or 'logs'
  const [logs, setLogs] = useState([]);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/incidents`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  useEffect(() => {
    if (currentView === 'logs') {
      fetchLogs();
    }
  }, [currentView]);

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
        await client.current.renamePC(uuid, editingName.trim());

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

  const agentsArray = Object.values(agents);
  const totalConnected = agentsArray.filter(a => a.status !== 'OFFLINE').length;
  const totalBahaya = agentsArray.filter(a => a.status === 'BAHAYA_OBS_MUTE').length;
  const totalStandby = agentsArray.filter(a => a.status === 'STANDBY_DIAM').length;

  const statusPriority = {
    'BAHAYA_OBS_MUTE': 1,
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
  useEffect(() => {
    if (totalBahaya > 0) {
      if (!alarmIntervalRef.current) {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
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
  }, [totalBahaya]);

  return (
    <div className="dashboard">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h1>Central Audio Dashboard</h1>
          <div className="view-toggles">
            <button className={`view-btn ${currentView === 'live' ? 'active' : ''}`} onClick={() => setCurrentView('live')}>Live Status</button>
            <button className={`view-btn ${currentView === 'logs' ? 'active' : ''}`} onClick={() => setCurrentView('logs')}>Incident Logs</button>
          </div>
        </div>
        <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'Server Connected' : 'Disconnected'}
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
                        <button type="submit" style={{ padding: '5px', cursor: 'pointer', background: '#2196f3', color: 'white', border: 'none', borderRadius: '4px' }}>✓</button>
                        <button type="button" onClick={() => setEditingId(null)} style={{ padding: '5px', cursor: 'pointer', background: '#555', color: 'white', border: 'none', borderRadius: '4px' }}>✕</button>
                      </form>
                    ) : (
                      <>
                        <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>{agent.pcName}</h2>
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
                      </>
                    )}
                  </div>

                  <div className="pc-meta">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, paddingRight: '15px' }}>
                      <span className="uuid" style={{ fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.6 }}>{agent.uuid}</span>
                      {agent.micDriverName && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', color: '#888', fontSize: '0.75rem' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                            <line x1="12" y1="19" x2="12" y2="22"></line>
                          </svg>
                          <span style={{ fontStyle: 'italic', wordBreak: 'break-word', lineHeight: '1.2' }}>{agent.micDriverName.replace('Default - ', '')}</span>
                        </div>
                      )}
                      {agent.obsSourceName && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', color: '#888', fontSize: '0.75rem', marginTop: '-2px' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
                            <polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                          </svg>
                          <span style={{ fontStyle: 'italic', wordBreak: 'break-word', lineHeight: '1.2' }}>{agent.obsSourceName}</span>
                        </div>
                      )}
                    </div>
                    {agent.cpuUsage !== undefined && (
                      <span className={`hardware-stats ${isHardwareWarning ? 'warning' : ''}`} style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        CPU: {agent.cpuUsage}% | RAM: {agent.ramUsage}%
                      </span>
                    )}
                  </div>

                  <h3 className="status-text">{agent.status.replace(/_/g, ' ')}</h3>

                  <div className="meter-container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', alignItems: 'flex-end', marginBottom: '8px' }}>
                      <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Mic {agent.micLevel === 0 && agent.rawMicLevel > 0 ? '(Gated)' : ''}</label>
                      {agent.micHistory && (
                        <svg width="120" height="25" className="sparkline">
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
                      <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>OBS Output</label>
                      {agent.obsHistory && (
                        <svg width="120" height="25" className="sparkline">
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
      ) : (
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
                  <tr key={log.id} className={log.incidentType.includes('RECOVERY') ? 'recovery-row' : log.incidentType.includes('BAHAYA') ? 'danger-row' : ''}>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                    <td>{log.pcName}</td>
                    <td>{log.incidentType.replace(/_/g, ' ')}</td>
                    <td>{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
