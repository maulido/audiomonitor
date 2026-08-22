/**
 * ============================================================================
 * AUDIO MONITOR AGENT - KODE INTI ANTARMUKA (App.jsx)
 * ============================================================================
 * Berkas ini merupakan "otak" utama dari aplikasi Agent yang berjalan di setiap PC Studio.
 * Aplikasi ini dibangun menggunakan React (berjalan di dalam Electron).
 * 
 * Fungsi Utama:
 * 1. Manajemen State (Hook): Menyimpan setelan lokal (localStorage) seperti IP OBS, 
 *    Batas Pecah (clipping), Noise Gate, dan setelan waktu (Silence, Dead Mic).
 * 2. Pemantauan Audio (AudioProcessor): Menangkap volume mic secara real-time.
 * 3. Pemantauan OBS (OBSClient): Menangkap status streaming dan volume meter dari OBS.
 * 4. Pemantauan Perangkat Keras: Membaca CPU dan RAM lewat Electron IPC.
 * 5. Mesin Hibrida Bahaya (Hybrid Danger System): Menghitung skor bahaya (dangerScore) 
 *    berdasarkan keheningan (silence), mikrofon mati (dead mic), atau audio pecah (clipping).
 * 6. Telemetri (TelemetryClient): Mengirim seluruh data di atas ke Dashboard secara real-time.
 * 7. Peringatan Luring (Offline Alert): Jika server Dashboard mati, Agent akan 
 *    mengambil alih tugas mengirim pesan Telegram secara mandiri (Fallback).
 * ============================================================================
 */

import React, { useState, useEffect, useRef } from 'react';
import './style.css';

import AudioProcessor from './core/AudioProcessor';
import OBSClient from './core/OBSClient';
import TelemetryClient from './core/TelemetryClient';

function App() {
  const [uuid, setUuid] = useState('Loading...');
  const [rawMicLevel, setRawMicLevel] = useState(0);
  const [micDb, setMicDb] = useState(-100);
  const [micClipping, setMicClipping] = useState(false);
  const [obsSources, setObsSources] = useState([]);
  const [micLevel, setMicLevel] = useState(0);
  const [obsLevel, setObsLevel] = useState(0);
  const [obsDb, setObsDb] = useState(-100);
  const [status, setStatus] = useState('AMAN');
  const [obsConnected, setObsConnected] = useState(false);
    const [obsError, setObsError] = useState('');
    const [isConnectingOBS, setIsConnectingOBS] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [isMonitoringActive, setIsMonitoringActive] = useState(true);

  // Settings state (Persisted to localStorage)
  const [agentName, setAgentName] = useState(() => localStorage.getItem('agentName') || 'PC-Studio-1');
  const [serverIp, setServerIp] = useState(() => localStorage.getItem('serverIp') || 'http://localhost:4000');
  const [committedServerIp, setCommittedServerIp] = useState(serverIp);
  const [obsIp, setObsIp] = useState(() => localStorage.getItem('obsIp') || 'localhost:4455');
  const [obsPassword, setObsPassword] = useState(() => localStorage.getItem('obsPassword') || '');
  const [obsSourceName, setObsSourceName] = useState(() => localStorage.getItem('obsSourceName') || 'Mic/Aux');
  const [selectedMicId, setSelectedMicId] = useState(() => localStorage.getItem('selectedMicId') || '');
  const [noiseGate, setNoiseGate] = useState(() => {
    const saved = localStorage.getItem('noiseGate');
    return saved !== null ? Number(saved) : 15;
  });
  const [silenceTimeoutSec, setSilenceTimeoutSec] = useState(() => {
    const saved = localStorage.getItem('silenceTimeoutSec');
    return saved !== null ? Number(saved) : 10;
  });
  const [deadMicTimeoutSec, setDeadMicTimeoutSec] = useState(() => {
    const saved = localStorage.getItem('deadMicTimeoutSec');
    return saved !== null ? Number(saved) : 60;
  });
  const [clippingThreshold, setClippingThreshold] = useState(() => {
    const saved = localStorage.getItem('clippingThreshold');
    return saved !== null ? Number(saved) : 95;
  });
  const [clippingDurationSec, setClippingDurationSec] = useState(() => {
    const saved = localStorage.getItem('clippingDurationSec');
    return saved !== null ? Number(saved) : 3;
  });
  const [audioDevices, setAudioDevices] = useState([]);
  const audioDevicesRef = useRef([]);
  useEffect(() => { audioDevicesRef.current = audioDevices; }, [audioDevices]);


  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(interval);
  }, []);
  const [obsInputs, setObsInputs] = useState([]);
  const [micDriverName, setMicDriverName] = useState('');
  const [hardwareUsage, setHardwareUsage] = useState({ cpuUsage: 0, ramUsage: 0 });
  const [activeTab, setActiveTab] = useState('monitoring');
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamTimecode, setStreamTimecode] = useState('00:00:00');
  const [streamBitrate, setStreamBitrate] = useState(0);
  const [streamDroppedFrames, setStreamDroppedFrames] = useState(0);
  const [streamTotalFrames, setStreamTotalFrames] = useState(0);
  const [currentScene, setCurrentScene] = useState('');
  const lastStreamBytes = useRef({ bytes: 0, time: 0 });

  useEffect(() => {
    let streamTimer;
    let sourcesTimer;
    if (obsConnected) {
      // Fetch detailed sources once on connect, then every 10s
      const fetchSources = () => {
        if (obsClient.current) {
          obsClient.current.getDetailedSources().then(sources => {
            setObsSources(sources);
          }).catch(console.error);
        }
      };
      fetchSources();
      sourcesTimer = setInterval(fetchSources, 10000);

      streamTimer = setInterval(() => {
        if (obsClient.current) {
          let timeoutId;
          Promise.race([
            obsClient.current.getStreamStatus(),
            new Promise((_, rej) => { timeoutId = setTimeout(() => rej(new Error('Timeout')), 3000); })
          ]).then(status => {
            clearTimeout(timeoutId);
            setIsStreaming(status.outputActive);
              if (status.outputActive && status.outputTimecode) {
                 setStreamTimecode(status.outputTimecode.split('.')[0]);
                 const now = Date.now();
                 if (lastStreamBytes.current.bytes > 0 && status.outputBytes > lastStreamBytes.current.bytes) {
                    const diffBytes = status.outputBytes - lastStreamBytes.current.bytes;
                    const diffTime = (now - lastStreamBytes.current.time) / 1000;
                    if (diffTime > 0) {
                       const kbps = Math.round((diffBytes * 8) / 1000 / diffTime);
                       setStreamBitrate(kbps);
                    }
                 }
                 lastStreamBytes.current = { bytes: status.outputBytes || 0, time: now };
                 setStreamDroppedFrames(status.outputSkippedFrames || 0);
                 setStreamTotalFrames(status.outputTotalFrames || 0);
              } else {
                 setStreamTimecode('00:00:00');
                 setStreamBitrate(0);
                 lastStreamBytes.current = { bytes: 0, time: 0 };
              }
          }).catch(() => {
            clearTimeout(timeoutId);
          });
        }
      }, 1000);
    } else {
      setIsStreaming(false);
      setStreamTimecode('00:00:00');
    }
    return () => {
      clearInterval(streamTimer);
      clearInterval(sourcesTimer);
    };
  }, [obsConnected]);
  const [autoStart, setAutoStart] = useState(false);
  const [obsSyncStreaming, setObsSyncStreaming] = useState(() => localStorage.getItem('obsSyncStreaming') === 'true');
  const obsSyncStreamingRef = useRef(obsSyncStreaming);
  useEffect(() => { obsSyncStreamingRef.current = obsSyncStreaming; localStorage.setItem('obsSyncStreaming', obsSyncStreaming); }, [obsSyncStreaming]);

  const [telegramConfig, setTelegramConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('telegramConfig')) || null; } catch(e){ return null; }
  });

  useEffect(() => {
    window.electronAPI.getAutostart().then(val => setAutoStart(val)).catch(console.error);
  }, []);

  
  
  const handleConfigUpdate = (config) => {
    if (config.agentName !== undefined) setAgentName(config.agentName);
    if (config.noiseGate !== undefined) setNoiseGate(config.noiseGate);
    if (config.silenceTimeoutSec !== undefined) setSilenceTimeoutSec(config.silenceTimeoutSec);
    if (config.deadMicTimeoutSec !== undefined) setDeadMicTimeoutSec(config.deadMicTimeoutSec);
    if (config.clippingThreshold !== undefined) setClippingThreshold(config.clippingThreshold);
    if (config.clippingDurationSec !== undefined) setClippingDurationSec(config.clippingDurationSec);
    if (config.obsSourceName !== undefined) setObsSourceName(config.obsSourceName);
    if (config.micDriverName !== undefined) {
      const devices = audioDevicesRef.current;
      const targetDevice = devices.find(d => d.label === config.micDriverName || (d.label || 'Default Microphone') === config.micDriverName);
      if (targetDevice) {
        setSelectedMicId(targetDevice.deviceId);
        setMicDriverName(targetDevice.label || 'Default Microphone');
        if (audioProcessor.current) {
          audioProcessor.current.stop();
          audioProcessor.current.start(targetDevice.deviceId).catch(console.error);
        }
      }
    }
  };
  const handleConfigUpdateRef = useRef(handleConfigUpdate);
  useEffect(() => { handleConfigUpdateRef.current = handleConfigUpdate; });
  
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
    localStorage.setItem('deadMicTimeoutSec', deadMicTimeoutSec.toString());
    localStorage.setItem('clippingThreshold', clippingThreshold.toString());
    localStorage.setItem('clippingDurationSec', clippingDurationSec.toString());
  }, [agentName, serverIp, obsIp, obsPassword, obsSourceName, selectedMicId, noiseGate, silenceTimeoutSec, deadMicTimeoutSec, clippingThreshold, clippingDurationSec, obsConnected]);

  // Core Instances (useRef to persist across renders without triggering re-renders)
  const audioProcessor = useRef(null);
  const obsClient = useRef(null);
  const telemetryClient = useRef(null);
  const lastNotificationTime = useRef(0);

  // Initial Hardware UUID Fetch
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getUUID().then(id => setUuid(id)).catch(console.error);
    } else {
      setUuid('browser-dev-id'); // fallback for browser
    }
  }, []);

  // Initialize Telemetry Client when UUID is ready
  useEffect(() => {
    if (uuid !== 'Loading...') {
      telemetryClient.current = new TelemetryClient(committedServerIp);
      telemetryClient.current.connect();
      
      const socket = telemetryClient.current.socket;
      if (socket) {
        socket.on('connect', () => setServerConnected(true));
        socket.on('disconnect', () => setServerConnected(false));
        socket.on('connect_error', () => setServerConnected(false));
      }

      telemetryClient.current.setMonitoringListener(uuid, (active) => {
        setIsMonitoringActive(active);
      });

      telemetryClient.current.setRenameListener((newName) => {
          setAgentName(newName);
        });

        telemetryClient.current.setConfigUpdateListener((config) => {
          if (handleConfigUpdateRef.current) handleConfigUpdateRef.current(config);
        });

      return () => {
        telemetryClient.current.disconnect();
      };
    }
  }, [uuid, committedServerIp]);

  // Initialize Audio & OBS Clients
  useEffect(() => {
    audioProcessor.current = new AudioProcessor(({ level, db, isClipping }) => {
      setMicDb(db);
      setMicClipping(isClipping);
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
      
      audioProcessor.current.start(micToUse).catch(console.error);
    }).catch(console.error);

    obsClient.current = new OBSClient(
      () => {
        setObsConnected(true);
          if (window.electronAPI && window.electronAPI.writeLog) window.electronAPI.writeLog('INFO', 'OBS Terhubung');
        obsClient.current.getAudioInputs().then(inputs => setObsInputs(inputs)).catch(console.error);
        obsClient.current.getStreamStatus().then(status => {
           if (obsSyncStreamingRef.current) {
             setIsMonitoringActive(status.outputActive);
           }
        }).catch(console.error);
        
        obsClient.current.obs.call('GetCurrentProgramScene').then(res => {
           setCurrentScene(res ? res.currentProgramSceneName : '');
        }).catch(() => {});
        
        obsClient.current.onSceneChange = (sceneName) => {
           setCurrentScene(sceneName);
        };
      },
      () => () => { setObsConnected(false); if (window.electronAPI && window.electronAPI.writeLog) window.electronAPI.writeLog('WARN', 'OBS Terputus'); },
      (inputs) => {
        const source = inputs.find(i => i.inputName === obsSourceNameRef.current);
        if (source && source.inputLevelsMul && source.inputLevelsMul[0] && source.inputLevelsMul[0].length > 0) {
          const levelMul = source.inputLevelsMul[0][1] || source.inputLevelsMul[0][0] || 0; 
          const db = levelMul > 0 ? 20 * Math.log10(levelMul) : -100;
          const mappedLevel = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
          setObsLevel(mappedLevel);
          setObsDb(db);
        } else {
          setObsLevel(0);
          setObsDb(-100);
        }
      },
      (isActive) => {
        if (obsSyncStreamingRef.current) {
          setIsMonitoringActive(isActive);
        }
      }
    );

    
      // Safe Auto-Connect on Mount
      if (obsIp && obsPassword && obsClient.current) {
        setIsConnectingOBS(true);
        obsClient.current.connect(obsIp, obsPassword).then(() => {
          setIsConnectingOBS(false);
        }).catch(() => {
          setIsConnectingOBS(false);
        });
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
      if (window.electronAPI && window.electronAPI.writeLog) window.electronAPI.writeLog('INFO', 'Mengganti Mic ke: ' + newMicId);
    
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
  const deadMicTimeout = useRef(null);
  const dangerScore = useRef(0);
  const lastTickRef = useRef(0);
  const clippingScore = useRef(0);

  const currentMicLevel = useRef(0);
  const currentObsLevel = useRef(0);
  const currentRawMicLevel = useRef(0);
  useEffect(() => { currentMicLevel.current = micLevel; }, [micLevel]);
  useEffect(() => { currentObsLevel.current = obsLevel; }, [obsLevel]);
  useEffect(() => { currentRawMicLevel.current = rawMicLevel; }, [rawMicLevel]);

    useEffect(() => {
      if (!obsConnected) {
      setObsLevel(0);
      setObsDb(-100);
    }
    }, [obsConnected]);

  // Hybrid Monitoring Logic
  useEffect(() => {
    if (!isMonitoringActive) {
      if (status !== 'AMAN') setStatus('AMAN');
      dangerScore.current = 0;
      clippingScore.current = 0;
      if (silenceTimeout.current) clearTimeout(silenceTimeout.current);
      if (deadMicTimeout.current) clearTimeout(deadMicTimeout.current);
      silenceTimeout.current = null;
      deadMicTimeout.current = null;
      return;
    }

    let nextStatus = status;
    const isTalking = currentMicLevel.current > 10;
    const isObsMuted = currentObsLevel.current < 0.5;

    // Clipping Logic (build score if rawMicLevel exceeds threshold)
    if (currentRawMicLevel.current >= clippingThreshold) {
      clippingScore.current += 100;
    } else {
      clippingScore.current = Math.max(0, clippingScore.current - 100);
    }

    // Build up danger score if talking while OBS is muted. Drain it if not.
    if (isTalking && isObsMuted && obsConnected) {
      dangerScore.current += 100;
    } else {
      dangerScore.current = Math.max(0, dangerScore.current - 100); // Drains twice as fast during pauses
    }

    if (dangerScore.current >= 3000) { // 3 seconds of "mostly" talking while muted
      nextStatus = 'BAHAYA_OBS_MUTE';
    } else if (clippingScore.current >= clippingDurationSec * 1000) {
      nextStatus = 'BAHAYA_AUDIO_PECAH';
    } else if (dangerScore.current === 0 && clippingScore.current === 0 && (status === 'BAHAYA_OBS_MUTE' || status === 'BAHAYA_AUDIO_PECAH')) {
      nextStatus = 'AMAN';
    }

    if (currentMicLevel.current < 2 && currentObsLevel.current < 2) {
      // Start standby timer if quiet
      if (!silenceTimeout.current && status !== 'STANDBY_DIAM' && status !== 'BAHAYA_MIC_MATI' && nextStatus !== 'BAHAYA_OBS_MUTE' && nextStatus !== 'BAHAYA_AUDIO_PECAH') {
        silenceTimeout.current = setTimeout(() => {
          silenceTimeout.current = null;
          setStatus('STANDBY_DIAM');
        }, silenceTimeoutSec * 1000);
      }
      // Start dead mic timer
      if (!deadMicTimeout.current && status !== 'BAHAYA_MIC_MATI' && nextStatus !== 'BAHAYA_OBS_MUTE' && nextStatus !== 'BAHAYA_AUDIO_PECAH') {
        deadMicTimeout.current = setTimeout(() => {
          deadMicTimeout.current = null;
          setStatus('BAHAYA_MIC_MATI');
        }, deadMicTimeoutSec * 1000);
      }
    } else {
      // Clear standby and dead mic timers if there is sound
      if (silenceTimeout.current) {
        clearTimeout(silenceTimeout.current);
        silenceTimeout.current = null;
      }
      if (deadMicTimeout.current) {
        clearTimeout(deadMicTimeout.current);
        deadMicTimeout.current = null;
      }
      if (nextStatus === 'STANDBY_DIAM' || nextStatus === 'BAHAYA_MIC_MATI') {
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
    } else if (nextStatus === 'BAHAYA_AUDIO_PECAH' && window.electronAPI) {
      const now = Date.now();
      if (now - lastNotificationTime.current > 10000) {
        window.electronAPI.showNotification(
          'Suara Pecah / Clipping!',
          'Volume mikrofon terlalu keras dan berisiko pecah di siaran!'
        );
        lastNotificationTime.current = now;
      }
    } else if (nextStatus === 'BAHAYA_MIC_MATI' && window.electronAPI) {
      const now = Date.now();
      if (now - lastNotificationTime.current > 10000) {
        window.electronAPI.showNotification(
          'Hardware Mic Mati!',
          'Tidak ada suara fisik yang masuk ke mikrofon selama beberapa waktu. Cek mute fisik atau kabel!'
        );
        lastNotificationTime.current = now;
      }
    }
  }, [obsConnected, status, silenceTimeoutSec, deadMicTimeoutSec, isMonitoringActive, tick, clippingThreshold, clippingDurationSec, obsConnected]);

  // Refs to hold latest values for telemetry throttling
  
  const lastAlertStatus = useRef('');
  useEffect(() => {
    if (status.startsWith('BAHAYA') && !serverConnected && telegramConfig && telegramConfig.token && telegramConfig.chatId) {
      if (lastAlertStatus.current !== status) {
        lastAlertStatus.current = status;
        const msg = `⚠️ <b>[OFFLINE ALERT]</b> AUDIO ISSUE\nPC <b>${agentName}</b> mengalami masalah: <b>${status}</b>\n<i>(Pesan ini dikirim otomatis oleh Agent karena Server Induk sedang terputus/mati)</i>`;
        fetch(`https://api.telegram.org/bot${telegramConfig.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: telegramConfig.chatId, text: msg, parse_mode: 'HTML' })
        }).catch(err => console.error('Offline Telegram Error:', err));
      }
    } else if (status === 'AMAN') {
      lastAlertStatus.current = '';
    }
  }, [status, serverConnected, telegramConfig, agentName]);

  const latestTelemetryData = useRef({});
  useEffect(() => {
    latestTelemetryData.current = {
      uuid,
      name: agentName,
      micDriverName,
      obsSourceName,
      micLevel,
      rawMicLevel, micDb, micClipping, obsSources, noiseGate, obsLevel,
      obsDb,
        obsConnected,
        status,
      cpuUsage: hardwareUsage.cpuUsage,
      ramUsage: hardwareUsage.ramUsage,
      isMonitoringActive,
      isStreaming,
      streamTimecode,
      streamBitrate,
      streamDroppedFrames,
      streamTotalFrames,
      currentScene,
        silenceTimeoutSec,
        deadMicTimeoutSec,
        clippingThreshold,
        clippingDurationSec,
        audioDevices: audioDevicesRef.current.map(d => d.label || 'Default Microphone')
      };
  }, [micLevel, rawMicLevel, micDb, micClipping, obsSources, noiseGate, obsLevel, obsDb, status, hardwareUsage, uuid, agentName, micDriverName, obsSourceName, isMonitoringActive, isStreaming, streamTimecode, streamBitrate, streamDroppedFrames, streamTotalFrames, currentScene, silenceTimeoutSec, deadMicTimeoutSec, clippingThreshold, clippingDurationSec, obsConnected]);

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

  const disconnectOBS = () => {
      if (obsClient.current) {
        obsClient.current.disconnect();
      }
      setObsConnected(false);
      setObsError('');
      setIsConnectingOBS(false);
    };

    const connectOBS = async () => {
      if (isConnectingOBS) return;
      setObsError('');
      setIsConnectingOBS(true);
      if (obsClient.current) {
        try {
          await obsClient.current.connect(obsIp, obsPassword);
          setIsConnectingOBS(false);
        } catch (error) {
          setIsConnectingOBS(false);
          setObsError('Gagal: ' + (error.message || error));
        }
      } else {
        setIsConnectingOBS(false);
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

      <div className="main-status">
        <div>
          <input 
            type="text" 
            className="pc-name-input" 
            value={agentName} 
            onChange={e => setAgentName(e.target.value)} 
            onBlur={() => {
              if (telemetryClient.current && telemetryClient.current.socket) {
                telemetryClient.current.socket.emit('agent-rename', { uuid, newName: agentName });
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (telemetryClient.current && telemetryClient.current.socket) {
                  telemetryClient.current.socket.emit('agent-rename', { uuid, newName: agentName });
                }
                e.target.blur();
              }
            }}
            title="Klik untuk mengubah nama PC"
          />
          <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }} title={uuid}>
            ID: {uuid.length > 15 ? uuid.substring(0, 8) + '...' + uuid.slice(-4) : uuid}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`status-badge ${status}`} style={{ opacity: isMonitoringActive ? 1 : 0.5 }}>
            {isMonitoringActive ? status.replace(/_/g, ' ') : 'PAUSED'}
          </div>
          <div style={{ fontSize: '11px', color: isStreaming ? '#f44336' : '#666', marginTop: '6px', fontWeight: 'bold' }}>
            {isStreaming ? `🔴 LIVE - ${streamTimecode}` : '⚫ OFFLINE'}
          </div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${activeTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveTab('monitoring')}>Monitoring</div>
        <div className={`tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</div>
      </div>

      <div className="tab-content" style={{ padding: activeTab === 'settings' ? '10px 15px' : '15px' }}>
        {activeTab === 'monitoring' ? (
          <div className="meters-grid">
            <div className="meter-row">
              <div className="meter-header">
                <span title={micDriverName}>Hardware Mic ({micDriverName.length > 20 ? micDriverName.substring(0,20)+'...' : micDriverName})</span>
                <span className="meter-val" style={{ color: micLevel === 0 ? '#888' : '#fff' }}>
                  {rawMicLevel.toFixed(1).padStart(4, '0')} dB
                </span>
              </div>
              <div className="meter-bar" style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: `${noiseGate}%`, top: 0, bottom: 0, width: '2px', backgroundColor: '#ff9800', zIndex: 10
                }} title={`Batas Noise Gate (${noiseGate}%)`}></div>
                <div className="meter-fill mic" style={{ 
                  width: `${Math.min(rawMicLevel, 100)}%`,
                  filter: micLevel === 0 ? 'grayscale(100%) opacity(0.4)' : 'none'
                }}></div>
              </div>
            </div>

            <div className="meter-row">
              <div className="meter-header">
                <span>OBS Output ({obsSourceName})</span>
                <span className="meter-val">{obsLevel.toFixed(1).padStart(4, '0')} dB</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill obs" style={{ width: `${Math.min(obsLevel, 100)}%` }}></div>
              </div>
            </div>

            <button 
              className="toggle-btn"
              onClick={() => {
                const newState = !isMonitoringActive;
                setIsMonitoringActive(newState);
                if (telemetryClient.current && telemetryClient.current.socket) {
                  telemetryClient.current.socket.emit('agent-monitoring', { uuid, active: newState });
                }
              }}
              style={{
                background: isMonitoringActive ? '#1e3a24' : '#3a1e1e',
                color: isMonitoringActive ? '#4caf50' : '#f44336',
                borderColor: isMonitoringActive ? '#4caf50' : '#f44336'
              }}
            >
              {isMonitoringActive ? '● MONITORING ON' : '● MONITORING OFF'}
            </button>
          </div>
        ) : (
          <div className="settings-grid">
            <div className="setting-group full">
              <label>Server URL {serverConnected ? <span style={{color: '#4caf50'}}>(Connected)</span> : <span style={{color: '#f44336'}}>(Disconnected)</span>}</label>
              <input 
                type="text" 
                value={serverIp} 
                onChange={e => setServerIp(e.target.value)} 
                onBlur={e => setCommittedServerIp(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setCommittedServerIp(e.target.value); }}
                placeholder="http://192.168.1.100:4000" 
              />
            </div>

            
            <div className="setting-group full" style={{ marginTop: '5px', paddingTop: '10px', borderTop: '1px dashed #333' }}>
              <label>System Settings</label>
              <div style={{ display: 'flex', gap: '20px', marginTop: '5px', color: '#ccc', fontSize: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={autoStart} onChange={e => {
                        const val = e.target.checked;
                        setAutoStart(val);
                        window.electronAPI.setAutostart(val);
                      }} />
                      <span className="slider"></span>
                    </div>
                    Auto Start with Windows
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#fff', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={obsSyncStreaming} onChange={e => setObsSyncStreaming(e.target.checked)} />
                      <span className="slider"></span>
                    </div>
                    Auto-Monitor on OBS Live
                  </label>
                </div>
            </div>

            <div className="setting-group full" style={{ marginTop: '5px', paddingTop: '10px', borderTop: '1px dashed #333' }}>
              <label>Hardware Microphone</label>
              <select value={selectedMicId} onChange={handleMicChange}>
                {audioDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${device.deviceId.slice(0,5)}...`}
                  </option>
                ))}
              </select>
            </div>

            <div className="setting-group full">
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span>Noise Gate (%)</span>
                <span style={{ color: '#ff9800', fontWeight: 'bold' }}>{noiseGate}%</span>
              </label>
              <input type="range" className="slider-warning" min="0" max="100" value={noiseGate} onChange={e => setNoiseGate(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            <div className="setting-group full">
              <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span>Batas Pecah (%)</span>
                <span style={{ color: '#f44336', fontWeight: 'bold' }}>{clippingThreshold}%</span>
              </label>
              <input type="range" className="slider-danger" min="50" max="100" value={clippingThreshold} onChange={e => setClippingThreshold(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
            </div>

            <div className="setting-group full">
              <div className="split-row">
                <div className="setting-group" style={{ flex: 1 }}>
                  <label>Silence (s)</label>
                  <input type="number" min="5" max="3600" value={silenceTimeoutSec} onChange={e => setSilenceTimeoutSec(Number(e.target.value))} style={{ height: "28px", margin: 0 }} />
                </div>
                <div className="setting-group" style={{ flex: 1 }}>
                  <label>Dead Mic (s)</label>
                  <input type="number" min="15" max="7200" value={deadMicTimeoutSec} onChange={e => setDeadMicTimeoutSec(Number(e.target.value))} style={{ height: "28px", margin: 0 }} />
                </div>
                <div className="setting-group" style={{ flex: 1 }}>
                  <label>Durasi Pecah (s)</label>
                  <input type="number" min="1" max="10" value={clippingDurationSec} onChange={e => setClippingDurationSec(Number(e.target.value))} style={{ height: "28px", margin: 0 }} />
                </div>
              </div>
            </div>

            

            <div className="setting-group full" style={{ marginTop: '5px', paddingTop: '10px', borderTop: '1px dashed #333' }}>
              <label>OBS IP & Port</label>
              <div className="split-row">
                <input type="text" value={obsIp} onChange={e => setObsIp(e.target.value)} placeholder="localhost:4455" style={{ flex: 2 }} />
                <input type="password" value={obsPassword} onChange={e => setObsPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') connectOBS(); }} placeholder="Password" style={{ flex: 1 }} />
              </div>
            </div>

            <div className="setting-group full">
                <label>OBS Source Name</label>
                <div style={{ marginBottom: '10px' }}>
                  {obsConnected && obsInputs.length > 0 ? (
                    <select value={obsSourceName} onChange={e => setObsSourceName(e.target.value)}>
                      {!obsInputs.find(i => i.inputName === obsSourceName) && (
                        <option value={obsSourceName}>{obsSourceName}</option>
                      )}
                      {obsInputs.map(input => (
                        <option key={input.inputName} value={input.inputName}>{input.inputName}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" value={obsSourceName} onChange={e => setObsSourceName(e.target.value)} />
                  )}
                </div>
                {obsError && <div style={{color: '#f44336', fontSize: '11px', marginBottom: '8px', textAlign: 'center', fontWeight: 'bold'}}>{obsError}</div>}
                <button 
                  onClick={obsConnected ? disconnectOBS : connectOBS} 
                  disabled={isConnectingOBS}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: obsConnected ? '#5c1f1f' : (isConnectingOBS ? '#555' : '#2196f3'),
                    color: obsConnected ? '#ff8a8a' : '#fff',
                    border: '1px solid ' + (obsConnected ? '#ff5252' : 'transparent'),
                    borderRadius: '4px', cursor: isConnectingOBS ? 'default' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  {obsConnected ? 'Disconnect from OBS' : (isConnectingOBS ? 'Connecting...' : 'Connect to OBS')}
                </button>
              </div>

          </div>
        )}
      </div>

    </div>
  );
}

export default App;
