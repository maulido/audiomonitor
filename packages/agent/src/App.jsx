import React, { useState, useEffect, useRef } from 'react';
import './style.css';
import AudioProcessor from './core/AudioProcessor';
import OBSClient from './core/OBSClient';
import TelemetryClient from './core/TelemetryClient';

function App() {
  const [uuid, setUuid] = useState('Loading...');
  const [rawMicLevel, setRawMicLevel] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [obsLevel, setObsLevel] = useState(0);
  const [status, setStatus] = useState('AMAN');
  const [obsConnected, setObsConnected] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);

  // Settings state (Persisted to localStorage)
  const [agentName, setAgentName] = useState(() => localStorage.getItem('agentName') || 'PC-Studio-1');
  const [serverIp, setServerIp] = useState(() => localStorage.getItem('serverIp') || 'http://localhost:4000');
  const [obsIp, setObsIp] = useState(() => localStorage.getItem('obsIp') || 'localhost:4455');
  const [obsPassword, setObsPassword] = useState(() => localStorage.getItem('obsPassword') || '');
  const [obsSourceName, setObsSourceName] = useState(() => localStorage.getItem('obsSourceName') || 'Mic/Aux');
  const [selectedMicId, setSelectedMicId] = useState(() => localStorage.getItem('selectedMicId') || '');
  const [noiseGate, setNoiseGate] = useState(() => Number(localStorage.getItem('noiseGate')) || 15);
  const [silenceTimeoutSec, setSilenceTimeoutSec] = useState(() => Number(localStorage.getItem('silenceTimeoutSec')) || 10);
  const [audioDevices, setAudioDevices] = useState([]);
  const [obsInputs, setObsInputs] = useState([]);
  const [micDriverName, setMicDriverName] = useState('');
  const [hardwareUsage, setHardwareUsage] = useState({ cpuUsage: 0, ramUsage: 0 });
  
  const obsSourceNameRef = useRef(obsSourceName);
  const noiseGateRef = useRef(noiseGate);
  
  useEffect(() => {
    obsSourceNameRef.current = obsSourceName;
    noiseGateRef.current = noiseGate;
    localStorage.setItem('agentName', agentName);
    localStorage.setItem('serverIp', serverIp);
    localStorage.setItem('obsIp', obsIp);
    localStorage.setItem('obsPassword', obsPassword);
    localStorage.setItem('obsSourceName', obsSourceName);
    localStorage.setItem('selectedMicId', selectedMicId);
    localStorage.setItem('noiseGate', noiseGate.toString());
    localStorage.setItem('silenceTimeoutSec', silenceTimeoutSec.toString());
  }, [agentName, serverIp, obsIp, obsPassword, obsSourceName, selectedMicId, noiseGate, silenceTimeoutSec]);

  // Core Instances (useRef to persist across renders without triggering re-renders)
  const audioProcessor = useRef(null);
  const obsClient = useRef(null);
  const telemetryClient = useRef(null);
  const lastNotificationTime = useRef(0);

  // Initial Hardware UUID Fetch
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getUUID().then(id => setUuid(id));
    } else {
      setUuid('browser-dev-id'); // fallback for browser
    }
  }, []);

  // Initialize Telemetry Client when UUID is ready
  useEffect(() => {
    if (uuid !== 'Loading...') {
      telemetryClient.current = new TelemetryClient(serverIp, uuid);
      telemetryClient.current.connect();
      
      const socket = telemetryClient.current.socket;
      if (socket) {
        socket.on('connect', () => setServerConnected(true));
        socket.on('disconnect', () => setServerConnected(false));
        socket.on('connect_error', () => setServerConnected(false));
      }

      return () => {
        telemetryClient.current.disconnect();
      };
    }
  }, [uuid, serverIp]);

  // Initialize Audio & OBS Clients
  useEffect(() => {
    audioProcessor.current = new AudioProcessor((level) => {
      setRawMicLevel(level);
      const gate = noiseGateRef.current;
      setMicLevel(level < gate ? 0 : level);
    });
    
    // Fetch Devices
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputs);
      
      let micToUse = selectedMicId;
      if (!micToUse && audioInputs.length > 0) {
        micToUse = audioInputs[0].deviceId;
        setSelectedMicId(micToUse);
      }
      
      const selectedDevice = audioInputs.find(d => d.deviceId === micToUse);
      if (selectedDevice) {
        setMicDriverName(selectedDevice.label || 'Default Microphone');
      }
      
      audioProcessor.current.start(micToUse);
    });

    obsClient.current = new OBSClient(
      () => {
        setObsConnected(true);
        obsClient.current.getAudioInputs().then(inputs => setObsInputs(inputs));
      },
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

    // Auto-connect to OBS if credentials exist
    if (obsIp) {
      obsClient.current.connect(obsIp, obsPassword).catch(() => console.log("Auto-connect OBS failed"));
    }

    return () => {
      if (audioProcessor.current) audioProcessor.current.stop();
      if (obsClient.current) obsClient.current.disconnect();
    };
  }, []);

  // Hardware Telemetry Polling
  useEffect(() => {
    const fetchTelemetry = async () => {
      if (window.electronAPI && window.electronAPI.getHardwareTelemetry) {
        try {
          const stats = await window.electronAPI.getHardwareTelemetry();
          setHardwareUsage(stats);
        } catch(e) {
          console.error("Failed to fetch hardware stats", e);
        }
      }
    };
    
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 2000); // every 2s
    return () => clearInterval(interval);
  }, []);

  // Change Microphone
  const handleMicChange = async (e) => {
    const newMicId = e.target.value;
    setSelectedMicId(newMicId);
    
    const selectedDevice = audioDevices.find(d => d.deviceId === newMicId);
    if (selectedDevice) {
      setMicDriverName(selectedDevice.label || 'Default Microphone');
    }

    if (audioProcessor.current) {
      audioProcessor.current.stop();
      await audioProcessor.current.start(newMicId);
    }
  };

  const silenceTimeout = useRef(null);
  const dangerScore = useRef(0);

  // Hybrid Monitoring Logic
  useEffect(() => {
    let nextStatus = status;
    const isTalking = micLevel > 10;
    const isObsMuted = obsLevel < 0.5; // Lowered threshold to ensure we only catch true mutes or extremely low volumes

    // Build up danger score if talking while OBS is muted. Drain it if not.
    if (isTalking && isObsMuted && obsConnected) {
      dangerScore.current += 50; // Approximates 50ms per tick
    } else {
      dangerScore.current = Math.max(0, dangerScore.current - 100); // Drains twice as fast during pauses
    }

    if (dangerScore.current >= 3000) { // 3 seconds of "mostly" talking while muted
      nextStatus = 'BAHAYA_OBS_MUTE';
    } else if (dangerScore.current === 0) {
      // Safe zone
      if (micLevel < 2 && obsLevel < 2) {
        if (!silenceTimeout.current && status !== 'STANDBY_DIAM') {
          silenceTimeout.current = setTimeout(() => {
            setStatus('STANDBY_DIAM');
          }, silenceTimeoutSec * 1000);
        }
      } else {
        if (silenceTimeout.current) {
          clearTimeout(silenceTimeout.current);
          silenceTimeout.current = null;
        }
        nextStatus = 'AMAN';
      }
    }

    if (status !== nextStatus) {
      setStatus(nextStatus);
    }

    // Telemetry/Desktop Notification Throttle
    if (nextStatus === 'BAHAYA_OBS_MUTE' && window.electronAPI) {
      const now = Date.now();
      if (now - lastNotificationTime.current > 10000) { // 10 seconds throttle
        window.electronAPI.showNotification(
          'Bahaya Audio!',
          'Suara masuk ke Mic, tapi tidak masuk ke OBS. Periksa mute di OBS!'
        );
        lastNotificationTime.current = now;
      }
    }
  }, [micLevel, obsLevel, obsConnected, status, silenceTimeoutSec]);

  // Refs to hold latest values for telemetry throttling
  const latestTelemetryData = useRef({});
  useEffect(() => {
    latestTelemetryData.current = {
      uuid,
      name: agentName,
      micDriverName,
      obsSourceName,
      micLevel,
      rawMicLevel,
      noiseGate,
      obsLevel,
      status,
      cpuUsage: hardwareUsage.cpuUsage,
      ramUsage: hardwareUsage.ramUsage
    };
  }, [micLevel, rawMicLevel, noiseGate, obsLevel, status, hardwareUsage, uuid, agentName, micDriverName, obsSourceName]);

  // Telemetry Sender (Throttled to 500ms)
  useEffect(() => {
    const telemetryInterval = setInterval(() => {
      if (telemetryClient.current && latestTelemetryData.current.uuid && latestTelemetryData.current.uuid !== 'Loading...') {
        telemetryClient.current.sendTelemetry({
          ...latestTelemetryData.current,
          timestamp: Date.now()
        });
      }
    }, 500);

    return () => clearInterval(telemetryInterval);
  }, []);

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
      <div className="header">
        <h1>Audio Monitor Agent</h1>
        <div className="header-stats">
          CPU: {hardwareUsage.cpuUsage}% | RAM: {hardwareUsage.ramUsage}%
        </div>
      </div>

      <div className="info-panel">
        <div>
          <h2 style={{margin: '0 0 5px 0', fontSize: '1.2em'}}>{agentName}</h2>
          <p className="pc-id" title={uuid}>ID: <span>{uuid.length > 15 ? uuid.substring(0, 8) + '...' + uuid.slice(-4) : uuid}</span></p>
        </div>
        <div className={`status-badge ${status}`}>
          {status.replace(/_/g, ' ')}
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-card full-width">
          <h2>Server Settings</h2>
          <div className="form-group">
            <input 
              type="text" 
              value={agentName} 
              onChange={e => setAgentName(e.target.value)} 
              placeholder="Nama PC (misal: PC Studio 1)" 
            />
            <input 
              type="text" 
              value={serverIp} 
              onChange={e => setServerIp(e.target.value)} 
              placeholder="http://192.168.1.100:4000" 
            />
            <p style={{ margin: 0, fontSize: '0.85em', color: serverConnected ? '#4caf50' : '#ff5252' }}>
              {serverConnected ? '✅ Terhubung ke Server' : '❌ Terputus dari Server'}
            </p>
          </div>
        </div>
        
        <div className="settings-card">
          <h2>Audio Settings</h2>
          <div className="form-group">
            <select value={selectedMicId} onChange={handleMicChange}>
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0,5)}...`}
                </option>
              ))}
            </select>
            
            <div className="slider-group">
              <label>Mic Noise Gate: {noiseGate}%</label>
              <input 
                type="range" 
                min="0" max="100" 
                value={noiseGate} 
                onChange={e => setNoiseGate(Number(e.target.value))} 
                title="Abaikan suara berisik/statis di bawah batas ini"
              />
            </div>
            
            <div className="slider-group" style={{ marginTop: '10px' }}>
              <label>Silence Timeout: {silenceTimeoutSec}s</label>
              <input 
                type="range" 
                min="5" max="120" step="5"
                value={silenceTimeoutSec} 
                onChange={e => setSilenceTimeoutSec(Number(e.target.value))} 
                title="Durasi hening (detik) sebelum PC dianggap STANDBY"
              />
            </div>
          </div>
        </div>

        <div className="settings-card">
          <h2>OBS Settings</h2>
          <div className="form-group">
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
            {obsConnected && obsInputs.length > 0 ? (
              <select value={obsSourceName} onChange={e => setObsSourceName(e.target.value)} title="Pilih input audio dari OBS">
                {/* Fallback in case current selection isn't in the list */}
                {!obsInputs.find(i => i.inputName === obsSourceName) && (
                  <option value={obsSourceName}>{obsSourceName}</option>
                )}
                {obsInputs.map(input => (
                  <option key={input.inputName} value={input.inputName}>{input.inputName}</option>
                ))}
              </select>
            ) : (
              <input 
                type="text" 
                value={obsSourceName} 
                onChange={e => setObsSourceName(e.target.value)} 
                placeholder="OBS Audio Source Name" 
                title="Ketik nama sumber audio jika OBS belum terhubung"
              />
            )}
            <button className="primary-btn" onClick={connectOBS} disabled={obsConnected}>
              {obsConnected ? 'Connected' : 'Connect to OBS'}
            </button>
          </div>
        </div>
      </div>

      <div className="meters-section">
        <div className="meter-box">
          <h3>Hardware Mic</h3>
          <div className="meter-bar" style={{ position: 'relative' }}>
            {/* Indikator visual batas Noise Gate */}
            <div style={{
              position: 'absolute',
              left: `${noiseGate}%`,
              top: 0,
              bottom: 0,
              width: '2px',
              backgroundColor: '#ff9800',
              zIndex: 10
            }} title={`Batas Noise Gate (${noiseGate}%)`}></div>
            
            <div 
              className="meter-fill mic" 
              style={{ 
                width: `${Math.min(rawMicLevel, 100)}%`,
                filter: micLevel === 0 ? 'grayscale(100%) opacity(0.4)' : 'none'
              }}
            ></div>
          </div>
          <p className="meter-val" style={{ color: micLevel === 0 ? '#888' : '#fff' }}>
            {rawMicLevel.toFixed(1).padStart(4, '0')} dB {micLevel === 0 ? '(Tertahan Gate)' : ''}
          </p>
        </div>
        <div className="meter-box">
          <h3>OBS Output</h3>
          <div className="meter-bar">
            <div className="meter-fill obs" style={{ width: `${Math.min(obsLevel, 100)}%` }}></div>
          </div>
          <p className="meter-val">{obsLevel.toFixed(1).padStart(4, '0')} dB</p>
        </div>
      </div>
    </div>
  );
}

export default App;
