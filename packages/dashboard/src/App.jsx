import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import DashboardClient from './core/DashboardClient';

const SERVER_URL = 'http://localhost:4000';

function App() {
  const [agents, setAgents] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [renameData, setRenameData] = useState({ uuid: '', name: '' });
  
  const client = useRef(null);

  useEffect(() => {
    client.current = new DashboardClient(
      SERVER_URL,
      (connected) => setIsConnected(connected),
      (data) => {
        setAgents((prev) => {
          const prevData = prev[data.uuid] || {};
          const isOffline = data.status === 'OFFLINE';
          return {
            ...prev,
            [data.uuid]: {
              timestamp: Date.now(),
              ...prevData,
              ...data,
              micLevel: isOffline ? 0 : (data.micLevel !== undefined ? data.micLevel : prevData.micLevel || 0),
              obsLevel: isOffline ? 0 : (data.obsLevel !== undefined ? data.obsLevel : prevData.obsLevel || 0)
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

  const handleRename = async (e) => {
    e.preventDefault();
    if (client.current) {
      try {
        await client.current.renamePC(renameData.uuid, renameData.name);
        
        // Optimistically update the UI immediately
        setAgents((prev) => {
          if (prev[renameData.uuid]) {
            return {
              ...prev,
              [renameData.uuid]: {
                ...prev[renameData.uuid],
                pcName: renameData.name
              }
            };
          }
          return prev;
        });
        
        alert('PC Renamed successfully.');
        setRenameData({ uuid: '', name: '' });
      } catch (err) {
        console.error(err);
        alert('Error renaming PC');
      }
    }
  };

  return (
    <div className="dashboard">
      <header>
        <h1>Central Audio Dashboard</h1>
        <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? 'Server Connected' : 'Disconnected'}
        </div>
      </header>

      <div className="grid">
        {Object.values(agents).map(agent => (
          <div key={agent.uuid} className={`agent-card ${agent.status}`}>
            <h2>{agent.pcName}</h2>
            <p className="uuid">{agent.uuid}</p>
            <h3 className="status-text">{agent.status.replace(/_/g, ' ')}</h3>
            
            <div className="meter-container">
              <label>Mic</label>
              <div className="meter-bg">
                <div 
                  className="meter-fill mic" 
                  style={{ width: `${Math.min(agent.micLevel, 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="meter-container">
              <label>OBS</label>
              <div className="meter-bg">
                <div 
                  className="meter-fill obs" 
                  style={{ width: `${Math.min(agent.obsLevel, 100)}%` }}
                ></div>
              </div>
            </div>
            <p className="timestamp">Last update: {new Date(agent.timestamp).toLocaleTimeString()}</p>
          </div>
        ))}
        {Object.keys(agents).length === 0 && (
          <p className="empty-state">Waiting for PC Streaming connections...</p>
        )}
      </div>

      <div className="admin-panel">
        <h2>Rename PC</h2>
        <form onSubmit={handleRename}>
          <input 
            type="text" 
            placeholder="UUID (e.g. ab12-cd34)" 
            value={renameData.uuid}
            onChange={e => setRenameData({...renameData, uuid: e.target.value})}
            required
          />
          <input 
            type="text" 
            placeholder="New Name (e.g. PC Valorant 1)" 
            value={renameData.name}
            onChange={e => setRenameData({...renameData, name: e.target.value})}
            required
          />
          <button type="submit">Rename</button>
        </form>
      </div>
    </div>
  );
}

export default App;
