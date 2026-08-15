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
        <h1>Central Audio Dashboard</h1>
        <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'Server Connected' : 'Disconnected'}
        </div>
      </header>

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
                    <button onClick={() => { setEditingId(agent.uuid); setEditingName(agent.pcName); }} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', flexShrink: 0 }}>✏️</button>
                  </>
                )}
              </div>

              <div className="pc-meta">
                <span className="uuid">{agent.uuid.split('-')[0]}...</span>
                {agent.cpuUsage !== undefined && (
                  <span className={`hardware-stats ${isHardwareWarning ? 'warning' : ''}`}>
                    CPU: {agent.cpuUsage}% | RAM: {agent.ramUsage}%
                  </span>
                )}
              </div>

              <h3 className="status-text">{agent.status.replace(/_/g, ' ')}</h3>

              <div className="meter-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', alignItems: 'flex-end', marginBottom: '8px' }}>
                  <label style={{ fontSize: '1.1rem' }}>Mic {agent.micLevel === 0 && agent.rawMicLevel > 0 ? '(Gated)' : ''}</label>
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

              <div className="meter-container" style={{ marginTop: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
                  <label style={{ fontSize: '1.1rem' }}>OBS</label>
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
    </div>
  );
}

export default App;
