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
  const uuidRef = useRef(uuid);
  useEffect(() => { uuidRef.current = uuid; }, [uuid]);

  const [appVersion, setAppVersion] = useState('1.0.2');
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => {
        if (v) setAppVersion(v);
      }).catch(() => {});
    }
  }, []);

  const [rawMicLevel, setRawMicLevel] = useState(0);
  const [micDb, setMicDb] = useState(-100);
  const [micClipping, setMicClipping] = useState(false);
  const [obsSources, setObsSources] = useState([]);
  const [micLevel, setMicLevel] = useState(0);
  const [obsLevel, setObsLevel] = useState(0);
  const [obsDb, setObsDb] = useState(-100);
  const [status, setStatus] = useState('AMAN');
  const [obsConnected, setObsConnected] = useState(false);
  const [isObsMutedBtn, setIsObsMutedBtn] = useState(false);
    const [obsError, setObsError] = useState('');
    const [isConnectingOBS, setIsConnectingOBS] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const [globalMonitoring, setGlobalMonitoring] = useState(true);
  const [pcMonitoring, setPcMonitoring] = useState(true);
  const isMonitoringActive = globalMonitoring && pcMonitoring;

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(isRecording);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);


  // Settings state (Persisted to localStorage)
  const [agentName, setAgentName] = useState(() => localStorage.getItem('agentName') || 'PC-Studio-1');
  const agentNameRef = useRef(agentName);
  useEffect(() => { 
    agentNameRef.current = agentName; 
    if (telemetryClient.current && typeof telemetryClient.current.setAgentName === 'function') {
      telemetryClient.current.setAgentName(agentName);
    }
  }, [agentName]);

  const [serverIp, setServerIp] = useState(() => localStorage.getItem('serverIp') || 'http://localhost:4000');
  const serverIpRef = useRef(serverIp);
  useEffect(() => { serverIpRef.current = serverIp; }, [serverIp]);

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
    const [speakingThreshold, setSpeakingThreshold] = useState(() => {
      const saved = localStorage.getItem('speakingThreshold');
      return saved !== null ? Number(saved) : 10;
    });
    const [obsMuteTimeoutSec, setObsMuteTimeoutSec] = useState(() => {
      const saved = localStorage.getItem('obsMuteTimeoutSec');
      return saved !== null ? Number(saved) : 3;
    });
    const [autoRecoveryUnmute, setAutoRecoveryUnmute] = useState(() => {
      const saved = localStorage.getItem('autoRecoveryUnmute');
      return saved === 'true';
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
              const currentSource = sources.find(s => s.name === obsSourceNameRef.current);
              if (currentSource) setIsObsMutedBtn(currentSource.muted);
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

  const [autoStart, setAutoStart] = useState(() => localStorage.getItem('autoStart') === 'true');
  
    const [obsSyncRecording, setObsSyncRecording] = useState(() => localStorage.getItem('obsSyncRecording') === 'true');
    const obsSyncRecordingRef = useRef(obsSyncRecording);

    const [recordDir, setRecordDir] = useState(() => localStorage.getItem('recordDir') || '');
    const recordDirRef = useRef(recordDir);
    useEffect(() => { recordDirRef.current = recordDir; localStorage.setItem('recordDir', recordDir); }, [recordDir]);

    useEffect(() => { obsSyncRecordingRef.current = obsSyncRecording; localStorage.setItem('obsSyncRecording', obsSyncRecording); }, [obsSyncRecording]);

    const [obsSyncStreaming, setObsSyncStreaming] = useState(() => localStorage.getItem('obsSyncStreaming') === 'true');
  const obsSyncStreamingRef = useRef(obsSyncStreaming);
  useEffect(() => { obsSyncStreamingRef.current = obsSyncStreaming; localStorage.setItem('obsSyncStreaming', obsSyncStreaming); }, [obsSyncStreaming]);

  const [telemetryInterval, setTelemetryInterval] = useState(() => {
    const saved = localStorage.getItem('telemetryInterval');
    return saved ? parseInt(saved, 10) : 500;
  });
  const telemetryIntervalRef = useRef(telemetryInterval);
  useEffect(() => { telemetryIntervalRef.current = telemetryInterval; localStorage.setItem('telemetryInterval', telemetryInterval); }, [telemetryInterval]);
  
  const [enableWindowsNotif, setEnableWindowsNotif] = useState(() => {
    const saved = localStorage.getItem('enableWindowsNotif');
    return saved === null ? true : saved === 'true';
  });
  const enableWindowsNotifRef = useRef(enableWindowsNotif);
  useEffect(() => { enableWindowsNotifRef.current = enableWindowsNotif; localStorage.setItem('enableWindowsNotif', enableWindowsNotif); }, [enableWindowsNotif]);

    const [telegramConfig, setTelegramConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('telegramConfig')) || null; } catch(e){ return null; }
  });

  const [localStorageInfo, setLocalStorageInfo] = useState({ exists: false, totalMb: '0.0', totalGb: '0.00', folderCount: 0, fileCount: 0, sessions: [] });
  const [isCleaningStorage, setIsCleaningStorage] = useState(false);
  const [cleanupFeedback, setCleanupFeedback] = useState('');
  const [localRetentionDays, setLocalRetentionDays] = useState(() => {
    const saved = localStorage.getItem('localRetentionDays');
    return saved !== null ? parseInt(saved, 10) : 0;
  });

  const fetchLocalStorageInfo = async () => {
    if (window.electronAPI && window.electronAPI.getStorageInfo) {
      try {
        const info = await window.electronAPI.getStorageInfo(recordDirRef.current);
        if (info) setLocalStorageInfo(info);
      } catch (e) {}
    }
  };

  const handleDeleteAudioFiles = async (deleteMode = 'all', days = 0) => {
    if (isCleaningStorage) return;

    // Refresh info storage terbaru
    if (window.electronAPI && window.electronAPI.getStorageInfo) {
      try {
        const freshInfo = await window.electronAPI.getStorageInfo(recordDirRef.current);
        if (freshInfo) setLocalStorageInfo(freshInfo);
      } catch (e) {}
    }

    const availableUploadedMb = parseFloat(localStorageInfo.uploadedMb || '0');
    const uploadedFolders = localStorageInfo.uploadedFolderCount || 0;

    if (uploadedFolders === 0 && availableUploadedMb === 0) {
      setCleanupFeedback('Info: Tidak ada file audio terupload untuk dibersihkan (Penyimpanan lokal sudah bersih atau belum ada rekaman yang selesai diunggah ke Server).');
      setTimeout(() => setCleanupFeedback(''), 6000);
      return;
    }

    let confirmMsg = '';
    if (deleteMode === 'all') {
      confirmMsg = `Hapus file rekaman audio lokal di PC ini yang SUDAH BERHASIL TERUPLOAD ke Server?\n\nTotal saat ini: ${localStorageInfo.uploadedMb || localStorageInfo.totalMb} MB (${uploadedFolders} folder sesi) siap dibersihkan.\nFile yang belum terupload akan tetap aman dan tidak akan dihapus.`;
    } else if (deleteMode === 'older_than_days') {
      confirmMsg = `Hapus file rekaman lokal (yang sudah terupload) yang usianya lebih dari ${days} hari?`;
    }

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setIsCleaningStorage(true);
    setCleanupFeedback('Sedang menghapus file audio yang sudah terupload...');
    try {
      if (window.electronAPI && window.electronAPI.deleteLocalRecordings) {
        const res = await window.electronAPI.deleteLocalRecordings({
          recordDir: recordDirRef.current,
          deleteMode,
          days,
          onlyUploaded: true
        });
        if (res?.success) {
          const protectMsg = res.skippedUnuploaded > 0 ? ` (${res.skippedUnuploaded} sesi belum terupload dilindungi)` : '';
          setCleanupFeedback(`Berhasil membebaskan ${res.freedMb} MB (${res.deletedFolders} folder dihapus)${protectMsg}`);
          await fetchLocalStorageInfo();
          setTimeout(() => setCleanupFeedback(''), 6000);
        } else {
          setCleanupFeedback(`Gagal: ${res?.error || 'Terjadi kesalahan'}`);
        }
      }
    } catch (err) {
      setCleanupFeedback(`Error: ${err.message}`);
    } finally {
      setIsCleaningStorage(false);
    }
  };

  const handleOpenRecordingsFolder = async () => {
    if (window.electronAPI && window.electronAPI.openRecordingsFolder) {
      await window.electronAPI.openRecordingsFolder(recordDirRef.current);
    }
  };

  useEffect(() => {
    fetchLocalStorageInfo();
    const interval = setInterval(fetchLocalStorageInfo, 10000);
    return () => clearInterval(interval);
  }, [recordDir]);

  // Auto-retention check on mount
  useEffect(() => {
    if (localRetentionDays > 0 && window.electronAPI && window.electronAPI.deleteLocalRecordings) {
      window.electronAPI.deleteLocalRecordings({
        recordDir: recordDirRef.current,
        deleteMode: 'older_than_days',
        days: localRetentionDays
      }).then(res => {
        if (res && res.deletedFolders > 0) {
          fetchLocalStorageInfo();
        }
      }).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.getAutostart) {
      window.electronAPI.getAutostart().then(val => {
        if (typeof val === 'boolean') {
          setAutoStart(val);
          localStorage.setItem('autoStart', val ? 'true' : 'false');
        }
      }).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (window.electronAPI && window.electronAPI.resizeWindow) {
      if (activeTab === 'monitoring') {
        window.electronAPI.resizeWindow(380, 370);
      } else {
        window.electronAPI.resizeWindow(380, 540);
      }
    }
  }, [activeTab]);

  const handleToggleAutoStart = (newVal) => {
    setAutoStart(newVal);
    localStorage.setItem('autoStart', newVal ? 'true' : 'false');
    if (window.electronAPI && window.electronAPI.setAutostart) {
      window.electronAPI.setAutostart(newVal).catch(err => {
        console.error('Failed to set autostart:', err);
      });
    }
  };

  
  
  const handleConfigUpdate = (config) => {
    if (config.agentName !== undefined) setAgentName(config.agentName);
    if (config.noiseGate !== undefined) setNoiseGate(config.noiseGate);
    if (config.silenceTimeoutSec !== undefined) setSilenceTimeoutSec(config.silenceTimeoutSec);
    if (config.deadMicTimeoutSec !== undefined) setDeadMicTimeoutSec(config.deadMicTimeoutSec);
    if (config.clippingThreshold !== undefined) setClippingThreshold(config.clippingThreshold);
    if (config.clippingDurationSec !== undefined) setClippingDurationSec(config.clippingDurationSec);
      if (config.speakingThreshold !== undefined) setSpeakingThreshold(config.speakingThreshold);
      if (config.obsMuteTimeoutSec !== undefined) setObsMuteTimeoutSec(config.obsMuteTimeoutSec);
      if (config.autoRecoveryUnmute !== undefined) setAutoRecoveryUnmute(config.autoRecoveryUnmute);
      if (config.obsSyncRecording !== undefined) setObsSyncRecording(config.obsSyncRecording);
      if (config.obsSyncStreaming !== undefined) setObsSyncStreaming(config.obsSyncStreaming);
      if (config.telemetryInterval !== undefined) setTelemetryInterval(config.telemetryInterval);
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
    localStorage.setItem('speakingThreshold', speakingThreshold.toString());
    localStorage.setItem('obsMuteTimeoutSec', obsMuteTimeoutSec.toString());
    localStorage.setItem('autoRecoveryUnmute', autoRecoveryUnmute.toString());
  }, [agentName, serverIp, obsIp, obsPassword, obsSourceName, selectedMicId, noiseGate, silenceTimeoutSec, deadMicTimeoutSec, clippingThreshold, clippingDurationSec, speakingThreshold, obsMuteTimeoutSec, autoRecoveryUnmute, obsSyncRecording, obsConnected, isObsMutedBtn, isRecording]);

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
      telemetryClient.current = new TelemetryClient(committedServerIp, uuid, agentName);
      telemetryClient.current.connect();
      
      const socket = telemetryClient.current.socket;
      if (socket) {
        socket.on('connect', () => setServerConnected(true));
        socket.on('disconnect', () => setServerConnected(false));
        socket.on('connect_error', () => setServerConnected(false));
      }

        telemetryClient.current.setMonitoringListener(uuid, (active) => {
          setPcMonitoring(active);
        });

        telemetryClient.current.setGlobalMonitoringListener((active) => {
          setGlobalMonitoring(active);
        });

      telemetryClient.current.setRenameListener((newName) => {
          setAgentName(newName);
        });

        
        telemetryClient.current.setRecordListener((shouldRecord) => {
          if (shouldRecord && audioProcessor.current) {
            const success = audioProcessor.current.startRecording(agentNameRef.current, recordDirRef.current, uuidRef.current, serverIpRef.current);
            if (success) setIsRecording(true);
          } else if (!shouldRecord && audioProcessor.current) {
            audioProcessor.current.stopRecording();
            setIsRecording(false);
          }
        });

        telemetryClient.current.setConfigUpdateListener((config) => {
          if (handleConfigUpdateRef.current) handleConfigUpdateRef.current(config);
        });

        telemetryClient.current.setTelegramConfigListener((config) => {
          if (config) {
            setTelegramConfig(config);
            localStorage.setItem('telegramConfig', JSON.stringify(config));
          }
        });

        // Listener Perintah Pembaruan dari Server LAN
        let isUpdating = false;
        const handleExecuteUpdate = async (data) => {
          const downloadUrl = data?.downloadUrl;
          if (!downloadUrl || isUpdating) return;
          
          if (window.electronAPI && window.electronAPI.installUpdate) {
            isUpdating = true;
            socket.emit('agent-update-progress', { uuid: uuidRef.current, progress: 0, status: 'starting' });
            let unbind = null;
            try {
              unbind = window.electronAPI.onUpdateProgress((prog) => {
                socket.emit('agent-update-progress', { uuid: uuidRef.current, ...prog });
              });
              
              const res = await window.electronAPI.installUpdate(downloadUrl);
              if (!res?.success) {
                socket.emit('agent-update-progress', { uuid: uuidRef.current, status: 'error', error: res?.error || 'Unknown error' });
              }
            } catch (err) {
              socket.emit('agent-update-progress', { uuid: uuidRef.current, status: 'error', error: err.message });
            } finally {
              if (unbind) unbind();
              isUpdating = false;
            }
          }
        };

        socket.on('execute-update', handleExecuteUpdate);

        // Listener Perintah Pembersihan Storage Audio Lokal dari Dashboard
        const handleCleanLocalStorage = async (data) => {
          if (window.electronAPI && window.electronAPI.deleteLocalRecordings) {
            const { deleteMode = 'all', days = 0, onlyUploaded = true } = data || {};
            try {
              const res = await window.electronAPI.deleteLocalRecordings({
                recordDir: recordDirRef.current,
                deleteMode,
                days,
                onlyUploaded
              });
              fetchLocalStorageInfo();
              socket.emit('agent-storage-cleaned', { uuid: uuidRef.current, ...res });
            } catch (err) {
              socket.emit('agent-storage-cleaned', { uuid: uuidRef.current, success: false, error: err.message });
            }
          }
        };

        socket.on('clean-local-storage', handleCleanLocalStorage);

      return () => {
        socket.off('execute-update', handleExecuteUpdate);
        socket.off('clean-local-storage', handleCleanLocalStorage);
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
             setPcMonitoring(status.outputActive);
           }
           if (obsSyncRecordingRef.current && audioProcessor.current) {
             if (status.outputActive && !isRecordingRef.current) {
               if (audioProcessor.current.startRecording(agentNameRef.current, recordDirRef.current, uuidRef.current, serverIpRef.current)) setIsRecording(true);
             } else if (!status.outputActive && isRecordingRef.current) {
               audioProcessor.current.stopRecording();
               setIsRecording(false);
             }
           }

        }).catch(console.error);
        
        obsClient.current.obs.call('GetCurrentProgramScene').then(res => {
           setCurrentScene(res ? res.currentProgramSceneName : '');
        }).catch(() => {});
        
        obsClient.current.onSceneChange = (sceneName) => {
           setCurrentScene(sceneName);
        };
      obsClient.current.onMuteStateChange = (inputName, isMuted) => {
        if (inputName === obsSourceNameRef.current) {
          setIsObsMutedBtn(isMuted);
        }
      };
      },
      () => { setObsConnected(false); if (window.electronAPI && window.electronAPI.writeLog) window.electronAPI.writeLog('WARN', 'OBS Terputus'); },
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
          setPcMonitoring(isActive);
        }
        if (obsSyncRecordingRef.current && audioProcessor.current) {
             if (isActive && !isRecordingRef.current) {
               if (audioProcessor.current.startRecording(agentNameRef.current, recordDirRef.current, uuidRef.current, serverIpRef.current)) setIsRecording(true);
             } else if (!isActive && isRecordingRef.current) {
               audioProcessor.current.stopRecording();
               setIsRecording(false);
             }
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
      try {
        await audioProcessor.current.start(newMicId);
      } catch (err) {
        console.error("Failed to start new microphone:", err);
      }
    }
  };

  const silenceScore = useRef(0);
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
      silenceScore.current = 0;
      return;
    }

    let nextStatus = status;
    const isTalking = currentMicLevel.current > speakingThreshold;
    const isObsMuted = currentObsLevel.current < 0.5;

    // Clipping Logic (build score if rawMicLevel exceeds threshold)
    if (currentRawMicLevel.current >= clippingThreshold) {
      clippingScore.current += 100;
    } else {
      clippingScore.current = Math.max(0, clippingScore.current - 100);
    }

    // Build up danger score if talking while OBS is muted. Drain it if not.
    const isActuallyMuted = isObsMutedBtn || isObsMuted;
    if (!obsConnected) {
      dangerScore.current = 0;
    } else if (isTalking && isActuallyMuted) {
      dangerScore.current += 100;
    } else if (isActuallyMuted) {
      // Masih mute tapi jeda bicara: kurangi perlahan (50ms per 100ms tick) agar jeda napas/kata tidak menghapus akumulasi skor
      if (dangerScore.current > 0) {
        dangerScore.current = Math.max(0, dangerScore.current - 50);
      }
    } else {
      // Sudah unmute: reset atau kurangi cepat
      if (dangerScore.current > 0) {
        dangerScore.current = Math.max(0, dangerScore.current - 500);
      } else {
        dangerScore.current = 0;
      }
    }

    if (dangerScore.current >= (obsMuteTimeoutSec * 1000)) {
      if (autoRecoveryUnmute && obsClient.current && obsConnected) {
        obsClient.current.setMute(obsSourceNameRef.current, false);
        dangerScore.current = -2000; // grace period of 2 seconds to allow meter to recover
      } else {
        nextStatus = 'BAHAYA_OBS_MUTE';
      }
    } else if (clippingScore.current >= clippingDurationSec * 1000) {
      nextStatus = 'BAHAYA_AUDIO_PECAH';
    } else if (dangerScore.current <= 0 && clippingScore.current <= 0 && (status === 'BAHAYA_OBS_MUTE' || status === 'BAHAYA_AUDIO_PECAH')) {
      nextStatus = 'AMAN';
    }

    // Silence & Dead Mic Logic via tick score
    if (currentMicLevel.current < 2 && currentObsLevel.current < 2) {
      silenceScore.current += 100;
      if (silenceScore.current >= deadMicTimeoutSec * 1000) {
        if (nextStatus !== 'BAHAYA_OBS_MUTE' && nextStatus !== 'BAHAYA_AUDIO_PECAH') {
          nextStatus = 'BAHAYA_MIC_MATI';
        }
      } else if (silenceScore.current >= silenceTimeoutSec * 1000) {
        if (nextStatus !== 'BAHAYA_OBS_MUTE' && nextStatus !== 'BAHAYA_AUDIO_PECAH') {
          nextStatus = 'STANDBY_DIAM';
        }
      }
    } else {
      silenceScore.current = 0;
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
      if (now - lastNotificationTime.current > 10000 && enableWindowsNotifRef.current) { // 10 seconds throttle
        window.electronAPI.showNotification(
          'Bahaya Audio: OBS Mute!',
          'Suara mikrofon terdeteksi aktif, namun input OBS dalam keadaan MUTE. Buka mute di OBS!'
        );
        lastNotificationTime.current = now;
      }
    } else if (nextStatus === 'BAHAYA_AUDIO_PECAH' && window.electronAPI) {
      const now = Date.now();
      if (now - lastNotificationTime.current > 10000 && enableWindowsNotifRef.current) {
        window.electronAPI.showNotification(
          'Audio Clipping / Suara Pecah!',
          'Volume mikrofon melebihi batas toleransi aman dan berisiko distorsi di siaran.'
        );
        lastNotificationTime.current = now;
      }
    } else if (nextStatus === 'BAHAYA_MIC_MATI' && window.electronAPI) {
      const now = Date.now();
      if (now - lastNotificationTime.current > 10000 && enableWindowsNotifRef.current) {
        window.electronAPI.showNotification(
          'Hardware Mic Tidak Merespons!',
          'Tidak ada sinyal suara fisik dari mikrofon selama batas waktu yang ditentukan. Periksa kabel atau mute fisik!'
        );
        lastNotificationTime.current = now;
      }
    }
  }, [obsConnected, status, silenceTimeoutSec, deadMicTimeoutSec, isMonitoringActive, tick, clippingThreshold, clippingDurationSec, isObsMutedBtn, speakingThreshold, obsMuteTimeoutSec, autoRecoveryUnmute]);

  // Refs to hold latest values for telemetry throttling
  
  const lastAlertState = useRef({ status: '', time: 0 });
  
  useEffect(() => {
    if (status.startsWith('BAHAYA') && !serverConnected && telegramConfig && telegramConfig.token && telegramConfig.chatId) {
      const now = Date.now();
      const throttleMs = (telegramConfig.interval || 60) * 1000;
      const isNewStatus = lastAlertState.current.status !== status;
      const canSendAlert = now - lastAlertState.current.time > throttleMs;
      
      if (canSendAlert) {
        lastAlertState.current = { status, time: now };
        const msg = `[OFFLINE ALERT] <b>AUDIO ISSUE</b>\nPC <b>${agentName}</b> mengalami masalah: <b>${status}</b>\n<i>(Pesan ini dikirim otomatis oleh Agent karena Server Induk sedang terputus/mati)</i>`;
        fetch(`https://api.telegram.org/bot${telegramConfig.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: telegramConfig.chatId, text: msg, parse_mode: 'HTML' })
        }).catch(err => console.error('Offline Telegram Error:', err));
      } else if (isNewStatus) {
        lastAlertState.current.status = status;
      }
    } else if (status === 'AMAN') {
      lastAlertState.current = { status: '', time: 0 };
    }
  }, [status, serverConnected, telegramConfig, agentName, tick]);

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
        isObsMutedBtn,
        status,
      cpuUsage: hardwareUsage.cpuUsage,
      ramUsage: hardwareUsage.ramUsage,
      localIp: hardwareUsage.localIp,
      isRecording,
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
          speakingThreshold,
          obsMuteTimeoutSec,
          autoRecoveryUnmute,
          obsSyncRecording,
          obsSyncStreaming,
          telemetryInterval,
          appVersion,
          audioDevices: audioDevicesRef.current.map(d => d.label || 'Default Microphone')
      };
  }, [micLevel, rawMicLevel, micDb, micClipping, obsSources, noiseGate, obsLevel, obsDb, status, hardwareUsage, uuid, agentName, micDriverName, obsSourceName, isMonitoringActive, isStreaming, streamTimecode, streamBitrate, streamDroppedFrames, streamTotalFrames, currentScene, silenceTimeoutSec, deadMicTimeoutSec, clippingThreshold, clippingDurationSec, speakingThreshold, obsMuteTimeoutSec, autoRecoveryUnmute, obsSyncRecording, obsSyncStreaming, telemetryInterval, obsConnected, isObsMutedBtn, isRecording, appVersion]);

  // Telemetry Sender (Dynamic Interval)
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (telemetryClient.current && latestTelemetryData.current.uuid && latestTelemetryData.current.uuid !== 'Loading...') {
        telemetryClient.current.sendTelemetry({
          ...latestTelemetryData.current,
          timestamp: Date.now()
        });
      }
    }, telemetryInterval);
    return () => clearInterval(intervalId);
  }, [telemetryInterval]);

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
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
          <div style={{ fontSize: '11px', color: '#777', fontFamily: 'monospace' }} title={uuid}>
            ID: {uuid.length > 15 ? uuid.substring(0, 8) + '...' + uuid.slice(-4) : uuid}
          </div>
        </div>

        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button 
              onClick={() => {
                if (isRecording) {
                  audioProcessor.current.stopRecording();
                  setIsRecording(false);
                } else {
                  if (audioProcessor.current.startRecording(agentNameRef.current, recordDirRef.current, uuidRef.current, serverIpRef.current)) setIsRecording(true);
                }
              }}
              style={{
                background: isRecording ? '#c0392b' : '#2c2c2c',
                color: '#fff',
                border: '1px solid ' + (isRecording ? '#e74c3c' : '#444'),
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}
            >
              <i className="fa-solid fa-circle" style={{ fontSize: '8px', color: isRecording ? '#fff' : '#e74c3c' }}></i>
              {isRecording ? 'Stop REC' : 'Manual REC'}
            </button>
            <div className={`status-badge ${status}`} style={{ opacity: isMonitoringActive ? 1 : 0.5, margin: 0, padding: '4px 10px', fontSize: '11px' }}>
              {isMonitoringActive ? status.replace(/_/g, ' ') : 'PAUSED'}
            </div>
          </div>

          <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isRecording && (
              <span style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: '10px', animation: 'pulse 1.5s infinite', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <i className="fa-solid fa-circle" style={{ fontSize: '6px' }}></i> REC
              </span>
            )}
            {isStreaming ? (
              <span style={{ color: '#e74c3c', fontWeight: 'bold', fontSize: '10px', background: '#301313', padding: '1px 5px', borderRadius: '3px', border: '1px solid #632222' }}>
                ● LIVE {streamTimecode}
              </span>
            ) : (
              <span style={{ color: '#777', fontSize: '10px' }}>
                OBS: {obsConnected ? 'Connected' : 'Standby'}
              </span>
            )}
          </div>
        </div>
      </div>

        <div className="tabs">
        <div className={`tab ${activeTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveTab('monitoring')}>Monitoring</div>
        <div className={`tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveTab('settings'); fetchLocalStorageInfo(); }}>Settings</div>
      </div>

      <div className="tab-content" style={{ padding: '12px' }}>
        {activeTab === 'monitoring' ? (
          <div className="meters-grid">
            <div className="meter-row">
              <div className="meter-header">
                <span title={micDriverName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                  Hardware Mic ({micDriverName.length > 20 ? micDriverName.substring(0,20)+'...' : micDriverName})
                </span>
                <span className="meter-val" style={{ color: micLevel === 0 ? '#888' : '#fff' }}>
                  {rawMicLevel.toFixed(1)}%
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
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                  OBS Output ({obsSourceName})
                </span>
                <span className="meter-val">{obsLevel.toFixed(1)}%</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill obs" style={{ width: `${Math.min(obsLevel, 100)}%` }}></div>
              </div>
            </div>

            <button 
              className="toggle-btn"
              onClick={() => {
                const newState = !pcMonitoring;
                setPcMonitoring(newState);
                if (telemetryClient.current && telemetryClient.current.socket) {
                  telemetryClient.current.socket.emit('agent-monitoring', { uuid, active: newState });
                }
              }}
              style={{
                background: isMonitoringActive ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.12)',
                color: isMonitoringActive ? '#4caf50' : '#f44336',
                borderColor: isMonitoringActive ? 'rgba(76, 175, 80, 0.4)' : 'rgba(244, 67, 54, 0.4)',
                borderRadius: '6px',
                padding: '9px 12px',
                fontWeight: 'bold',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              {isMonitoringActive ? '● MONITORING ON' : '● MONITORING OFF'}
            </button>
          </div>
        ) : (
          <div className="settings-grid">
            <div className="setting-group full" style={{ marginBottom: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ margin: 0, fontWeight: 'bold', color: '#fff', fontSize: '12px' }}>Server URL</label>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: serverConnected ? '#4caf50' : '#e74c3c',
                  background: serverConnected ? '#132817' : '#2b1414',
                  border: '1px solid ' + (serverConnected ? '#23522b' : '#5c2222'),
                  padding: '2px 7px',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <i className="fa-solid fa-circle" style={{ fontSize: '6px' }}></i>
                  {serverConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <input 
                type="text" 
                value={serverIp} 
                onChange={e => setServerIp(e.target.value)} 
                onBlur={e => setCommittedServerIp(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setCommittedServerIp(e.target.value); }}
                placeholder="http://192.168.1.100:4000" 
                style={{ fontSize: '12px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            
            
              <div className="setting-group full" style={{ marginTop: '5px', paddingTop: '10px', borderTop: '1px dashed #333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                  <label style={{ margin: 0, fontWeight: 'bold', color: '#fff', fontSize: '12px', whiteSpace: 'nowrap' }}>Penyimpanan Audio Host</label>
                  <span style={{ fontSize: '10px', color: '#4caf50', fontWeight: 'bold', background: '#132817', padding: '2px 6px', borderRadius: '3px', border: '1px solid #23522b', whiteSpace: 'nowrap' }}>
                    {localStorageInfo.uploadedMb || '0.0'} / {localStorageInfo.totalMb || '0.0'} MB Terupload
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '5px', marginBottom: '8px' }}>
                  <input 
                    type="text" 
                    value={recordDir} 
                    onChange={e => setRecordDir(e.target.value)} 
                    placeholder="Default: Documents/AudioMonitor-Recordings" 
                    style={{ flex: 1, fontSize: '11px' }}
                  />
                  <button 
                    onClick={async () => {
                      if (window.electronAPI && window.electronAPI.selectFolder) {
                        const folder = await window.electronAPI.selectFolder();
                        if (folder) setRecordDir(folder);
                      }
                    }}
                    style={{ background: '#444', color: '#fff', border: '1px solid #555', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}
                    title="Pilih folder kustom"
                  >
                    Pilih
                  </button>
                  <button 
                    onClick={handleOpenRecordingsFolder}
                    style={{ background: '#2c3e50', color: '#ecf0f1', border: '1px solid #34495e', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '11px' }}
                    title="Buka folder rekaman di Windows File Explorer"
                  >
                    Buka
                  </button>
                </div>

                {/* Card Bersihkan Audio & Auto-Retention */}
                <div style={{ background: '#181818', border: '1px solid #2e2e2e', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Baris 1: Filter Dropdown dan Tombol Eksekusi Bersihkan */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                      <span style={{ color: '#aaa' }}>Bersihkan Audio:</span>
                      <select 
                        disabled={isCleaningStorage}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          if (val === 'all') handleDeleteAudioFiles('all');
                          else handleDeleteAudioFiles('older_than_days', parseInt(val, 10));
                          e.target.value = '';
                        }}
                        defaultValue=""
                        style={{ background: '#222', color: '#ccc', border: '1px solid #3c3c3c', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', width: '58%' }}
                      >
                        <option value="" disabled>Pilih Opsi Hapus...</option>
                        <option value="all">Semua Terupload ({localStorageInfo.uploadedMb || '0.0'} MB)</option>
                        <option value="1">Hapus Terupload &gt; 1 Hari</option>
                        <option value="3">Hapus Terupload &gt; 3 Hari</option>
                        <option value="7">Hapus Terupload &gt; 7 Hari</option>
                        <option value="14">Hapus Terupload &gt; 14 Hari</option>
                        <option value="30">Hapus Terupload &gt; 30 Hari</option>
                      </select>
                    </div>

                    <button 
                      onClick={() => handleDeleteAudioFiles('all')}
                      disabled={isCleaningStorage}
                      style={{
                        width: '100%',
                        background: (localStorageInfo.uploadedFolderCount > 0 || parseFloat(localStorageInfo.uploadedMb || '0') > 0) && !isCleaningStorage ? '#c0392b' : '#2b2b2b',
                        color: (localStorageInfo.uploadedFolderCount > 0 || parseFloat(localStorageInfo.uploadedMb || '0') > 0) ? '#fff' : '#888',
                        border: '1px solid ' + ((localStorageInfo.uploadedFolderCount > 0 || parseFloat(localStorageInfo.uploadedMb || '0') > 0) ? '#e74c3c' : '#3d3d3d'),
                        padding: '6px 10px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        cursor: isCleaningStorage ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                        transition: 'all 0.2s'
                      }}
                      title="Hapus file rekaman lokal yang SUDAH TERUPLOAD ke Server"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                      {isCleaningStorage ? 'Sedang Membersihkan Storage...' : `Hapus Audio Terupload (${localStorageInfo.uploadedMb || '0.0'} MB)`}
                    </button>
                  </div>

                  {/* Keterangan Aman */}
                  <div style={{ fontSize: '10px', color: '#777', fontStyle: 'italic', lineHeight: '1.3' }}>
                    * Aman: Hanya file yang telah terverifikasi sukses terunggah ke Server yang dapat dihapus. Rekaman yang belum terupload otomatis dilindungi.
                  </div>

                  {/* Baris 2: Pembersihan Otomatis (Auto-Retention) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#aaa', borderTop: '1px solid #252525', paddingTop: '8px' }}>
                    <span>Pembersihan Otomatis:</span>
                    <select 
                      value={localRetentionDays}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setLocalRetentionDays(val);
                        localStorage.setItem('localRetentionDays', val.toString());
                      }}
                      style={{ background: '#222', color: '#ccc', border: '1px solid #3c3c3c', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', width: '58%' }}
                    >
                      <option value="0">Tidak Pernah (Manual)</option>
                      <option value="1">Otomatis Hapus &gt; 1 Hari</option>
                      <option value="3">Otomatis Hapus &gt; 3 Hari</option>
                      <option value="7">Otomatis Hapus &gt; 7 Hari</option>
                      <option value="14">Otomatis Hapus &gt; 14 Hari</option>
                      <option value="30">Otomatis Hapus &gt; 30 Hari</option>
                    </select>
                  </div>

                  {cleanupFeedback && (
                    <div style={{ fontSize: '11px', color: cleanupFeedback.startsWith('Gagal') || cleanupFeedback.startsWith('Error') ? '#e74c3c' : (cleanupFeedback.startsWith('Info') ? '#f39c12' : '#2ecc71'), fontWeight: 'bold', textAlign: 'center', background: '#111', padding: '4px 8px', borderRadius: '4px', border: '1px solid #333' }}>
                      {cleanupFeedback}
                    </div>
                  )}
                </div>
              </div>

              <div className="setting-group full" style={{ marginTop: '5px', paddingTop: '10px', borderTop: '1px dashed #333' }}>
                <label style={{ margin: '0 0 6px 0', fontWeight: 'bold', color: '#fff', fontSize: '12px' }}>System Settings</label>
                
                <div style={{ background: '#181818', border: '1px solid #2e2e2e', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#eee', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={autoStart} onChange={e => handleToggleAutoStart(e.target.checked)} />
                      <span className="slider"></span>
                    </div>
                    Auto Start with Windows
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#eee', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={obsSyncStreaming} onChange={e => setObsSyncStreaming(e.target.checked)} />
                      <span className="slider"></span>
                    </div>
                    Auto-Monitor on OBS Live
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#eee', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={autoRecoveryUnmute} onChange={e => setAutoRecoveryUnmute(e.target.checked)} />
                      <span className="slider"></span>
                    </div>
                    Auto-Unmute OBS
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#eee', fontSize: '12px' }}>
                    <div className="switch">
                      <input type="checkbox" checked={obsSyncRecording} onChange={e => setObsSyncRecording(e.target.checked)} />
                      <span className="slider"></span>
                    </div>
                    Auto-Record on OBS Live
                  </label>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#eee', fontSize: '12px', margin: 0 }}>
                      <div className="switch">
                        <input type="checkbox" checked={enableWindowsNotif} onChange={e => setEnableWindowsNotif(e.target.checked)} />
                        <span className="slider"></span>
                      </div>
                      Windows Notification
                    </label>
                    {enableWindowsNotif && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.electronAPI && window.electronAPI.showNotification) {
                            window.electronAPI.showNotification(
                              'Uji Notifikasi Windows',
                              'Notifikasi Windows Audio Monitor Agent berfungsi dengan baik dan siap memberikan peringatan!'
                            );
                          }
                        }}
                        style={{
                          background: '#2c3e50',
                          color: '#ecf0f1',
                          border: '1px solid #34495e',
                          padding: '2px 8px',
                          borderRadius: '3px',
                          fontSize: '10px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title="Kirim notifikasi uji coba ke Windows Action Center"
                      >
                        <i className="fa-solid fa-bell"></i>
                        Tes Notif
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#aaa', borderTop: '1px solid #252525', paddingTop: '8px', marginTop: '2px' }}>
                    <span>Data Polling Rate:</span>
                    <select 
                      value={telemetryInterval}
                      onChange={e => setTelemetryInterval(parseInt(e.target.value, 10))}
                      style={{ background: '#222', color: '#ccc', border: '1px solid #3c3c3c', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', width: '58%' }}
                    >
                      <option value="500">Realtime (0.5s)</option>
                      <option value="2000">Normal (2s)</option>
                      <option value="5000">Eco Mode (5s)</option>
                    </select>
                  </div>
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
                <span>Sensitivitas Bicara (%)</span>
                <span style={{ color: '#2196F3', fontWeight: 'bold' }}>{speakingThreshold}%</span>
              </label>
              <input type="range" className="slider-accent" min="1" max="100" value={speakingThreshold} onChange={e => setSpeakingThreshold(Number(e.target.value))} style={{ width: '100%', cursor: 'pointer' }} />
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
                  <label>Mute OBS (s)</label>
                  <input type="number" min="1" max="60" value={obsMuteTimeoutSec} onChange={e => setObsMuteTimeoutSec(Number(e.target.value))} style={{ height: "28px", margin: 0 }} />
                </div>
                <div className="setting-group" style={{ flex: 1 }}>
                  <label>Pecah (s)</label>
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
