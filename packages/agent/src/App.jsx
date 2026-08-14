import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import AudioProcessor from './core/AudioProcessor';
import OBSClient from './core/OBSClient';
import TelemetryClient from './core/TelemetryClient';

const SERVER_URL = 'http://localhost:4000'; // Central Server URL

function App() {
  const [uuid, setUuid] = useState('Loading...');
  const [micLevel, setMicLevel] = useState(0);
  const [obsLevel, setObsLevel] = useState(0);
  const [status, setStatus] = useState('AMAN');
  const [obsConnected, setObsConnected] = useState(false);

  // Settings state (Persisted to localStorage)
  const [obsIp, setObsIp] = useState(() => localStorage.getItem('obsIp') || 'localhost:4455');
  const [obsPassword, setObsPassword] = useState(() => localStorage.getItem('obsPassword') || '');
  const [obsSourceName, setObsSourceName] = useState(() => localStorage.getItem('obsSourceName') || 'Mic/Aux');
  const [noiseGate, setNoiseGate] = useState(() => Number(localStorage.getItem('noiseGate')) || 15);
  
  const obsSourceNameRef = useRef(obsSourceName);
  const noiseGateRef = useRef(noiseGate);
  
  useEffect(() => {
    obsSourceNameRef.current = obsSourceName;
    noiseGateRef.current = noiseGate;
    localStorage.setItem('obsIp', obsIp);
    localStorage.setItem('obsPassword', obsPassword);
    localStorage.setItem('obsSourceName', obsSourceName);
    localStorage.setItem('noiseGate', noiseGate);
  }, [obsSourceName, obsIp, obsPassword, noiseGate]);

  // Core Instances (useRef to persist across renders without triggering re-renders)
  const audioProcessor = useRef(null);
  const obsClient = useRef(null);
  const telemetryClient = useRef(null);
  const lastNotificationTime = useRef(0);

  useEffect(() => {
    // Get UUID from Electron
    if (window.electronAPI) {
      window.electronAPI.getUUID().then(id => setUuid(id));
    } else {
      setUuid('browser-dev-id'); // fallback for browser
    }

    // Initialize Core Classes
    telemetryClient.current = new TelemetryClient(SERVER_URL);
    telemetryClient.current.connect();

    audioProcessor.current = new AudioProcessor((level) => {
      const gate = noiseGateRef.current;
      setMicLevel(level < gate ? 0 : level);
    });
    audioProcessor.current.start();

    obsClient.current = new OBSClient(
      () => setObsConnected(true),
      () => setObsConnected(false),
      (inputs) => {
        // Find the specific source the user typed in
        const source = inputs.find(i => i.inputName === obsSourceNameRef.current);
        if (source && source.inputLevelsMul) {
          // inputLevelsMul returns an array of channels [left, right, etc] containing multipliers (0.0 to 1.0)
          // index 1 is usually the peak multiplier for the channel
          const levelMul = source.inputLevelsMul[0][1] || source.inputLevelsMul[0][0]; 
          
          // Convert multiplier to decibels
          const db = levelMul > 0 ? 20 * Math.log10(levelMul) : -100;
          
          // Map -60dB (0%) to 0dB (100%)
          const mappedLevel = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
          setObsLevel(mappedLevel);
        }
      }
    );

    return () => {
      if (audioProcessor.current) audioProcessor.current.stop();
      if (telemetryClient.current) telemetryClient.current.disconnect();
      if (obsClient.current) obsClient.current.disconnect();
    };
  }, []);

  // Hybrid Monitoring Logic
  useEffect(() => {
    let currentStatus = 'AMAN';
    
    // Example logic:
    if (micLevel > 10 && obsLevel < 2 && obsConnected) {
      currentStatus = 'BAHAYA_OBS_MUTE';
    } else if (micLevel < 2 && obsLevel < 2) {
      currentStatus = 'MIC_MATI_ATAU_DIAM';
    }

    if (currentStatus !== status) {
      setStatus(currentStatus);
      if (currentStatus === 'BAHAYA_OBS_MUTE' && window.electronAPI) {
        const now = Date.now();
        if (now - lastNotificationTime.current > 10000) { // 10 seconds throttle
          window.electronAPI.showNotification(
            'Bahaya Audio!',
            'Suara masuk ke Mic, tapi tidak masuk ke OBS. Periksa mute di OBS!'
          );
          lastNotificationTime.current = now;
        }
      }
    }

    // Send telemetry to server
    if (telemetryClient.current && uuid !== 'Loading...') {
      telemetryClient.current.sendTelemetry({
        uuid,
        micLevel,
        obsLevel,
        status: currentStatus,
        timestamp: Date.now()
      });
    }

  }, [micLevel, obsLevel, obsConnected, status, uuid]);

  const connectOBS = async () => {
    if (obsClient.current) {
      try {
        await obsClient.current.connect(obsIp, obsPassword);
      } catch (error) {
        alert('Gagal koneksi ke OBS. Periksa IP dan Password.');
      }
    }
  };

  return (
    <div className="container">
      <h1>Audio Monitor Agent</h1>
      <div className="info">
        <p><strong>PC ID:</strong> {uuid}</p>
        <p className={`status ${status}`}>{status.replace(/_/g, ' ')}</p>
      </div>

      <div className="settings">
        <h2>OBS Settings</h2>
        <input 
          type="text" 
          value={obsIp} 
          onChange={e => setObsIp(e.target.value)} 
          placeholder="IP:Port (localhost:4455)" 
        />
        <input 
          type="password" 
          value={obsPassword} 
          onChange={e => setObsPassword(e.target.value)} 
          placeholder="OBS WebSocket Password" 
        />
        <input 
          type="text" 
          value={obsSourceName} 
          onChange={e => setObsSourceName(e.target.value)} 
          placeholder="OBS Audio Source Name" 
        />
        <div className="slider-group">
          <label>Mic Noise Gate: {noiseGate}%</label>
          <input 
            type="range" 
            min="0" max="60" 
            value={noiseGate} 
            onChange={e => setNoiseGate(Number(e.target.value))} 
            title="Abaikan suara berisik/statis di bawah batas ini"
          />
        </div>
        <button onClick={connectOBS} disabled={obsConnected}>
          {obsConnected ? 'Connected' : 'Connect'}
        </button>
      </div>

      <div className="meters">
        <div className="meter-box">
          <h3>Hardware Mic</h3>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${Math.min(micLevel, 100)}%`, backgroundColor: '#4caf50' }}></div>
          </div>
          <p>{micLevel.toFixed(1)}</p>
        </div>
        <div className="meter-box">
          <h3>OBS Output</h3>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${Math.min(obsLevel, 100)}%`, backgroundColor: '#2196f3' }}></div>
          </div>
          <p>{obsLevel.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
}

export default App;
