/**
 * Class AudioProcessor
 * Bertanggung jawab untuk menangkap aliran audio dari mikrofon perangkat keras,
 * menganalisis frekuensi/level volumenya, dan menghitung persentase tingkat kebisingan (Noise Level).
 */
class AudioProcessor {
  /**
   * Konstruktor untuk menginisiasi prosesor audio.
   * @param {Function} onLevelChange - Fungsi callback yang akan dipanggil setiap kali ada pembaruan level audio.
   */
  constructor(onLevelChange) {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.animationFrame = null;
    this.onLevelChange = onLevelChange; // Callback for UI
  }

  /**
   * Memulai pemantauan mikrofon.
   * Akan meminta izin mikrofon, membuat AudioContext, dan menjalankan loop analisis audio.
   * @param {string|null} deviceId - ID Perangkat mikrofon yang ingin digunakan. Jika null, menggunakan mikrofon default.
   */
  async start(deviceId = null) {
    this.stop(); // Bersihkan context dan stream lama sebelum membuat yang baru
    try {
      // Mendefinisikan aturan permintaan media (hanya audio)
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };
      
      // Meminta akses aliran (stream) mikrofon dari sistem operasi
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream.getTracks().forEach(track => {
        track.onended = () => {
          this.stopRecording();
        };
      });
      
      // Membuat AudioContext standar Web Audio API
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Membuat node Analyser untuk membaca gelombang suara (PCM)
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      // Mengatur seberapa mulus pergerakan nilai audio dan ukuran sampel FFT (2048 untuk resolusi frekuensi tinggi)
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.fftSize = 2048;
      this.microphone.connect(this.analyser);

      // Buffer array untuk menampung gelombang data audio mentah dan data frekuensi
      const pcmData = new Float32Array(this.analyser.fftSize);
      const freqData = new Uint8Array(this.analyser.frequencyBinCount);
      const sampleRate = this.audioContext.sampleRate || 48000;
      const binWidth = sampleRate / this.analyser.fftSize; // ~23.4 Hz per bin

      let isRunning = true;
      this.isRunning = isRunning;
      let minRmsEnergy = 1.0;
      let energySmoothed = 0.0001;
      
      /**
       * Fungsi loop internal untuk terus membaca data mikrofon secara real-time.
       */
      const updateLevel = () => {
        if (!this.isRunning) return;
        
        // Memasukkan data gelombang suara (time-domain) dan spektrum frekuensi
        this.analyser.getFloatTimeDomainData(pcmData);
        this.analyser.getByteFrequencyData(freqData);

        let sum = 0;
        let maxAbs = 0;
        let clipCount = 0;
        
        // Mengkalkulasi RMS, True Peak, dan clipping
        for (let i = 0; i < pcmData.length; i++) {
          const val = pcmData[i];
          const absVal = Math.abs(val);
          sum += val * val;
          if (absVal > maxAbs) maxAbs = absVal;
          if (absVal >= 0.99) clipCount++;
        }
        
        // Menghitung nilai Root Mean Square (RMS) dan mengkonversinya ke Decibel (dB)
        const rms = Math.sqrt(sum / pcmData.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        const truePeak = maxAbs > 0 ? 20 * Math.log10(maxAbs) : -100;

        // BS.1770 / EBU R128 Momentary LUFS Approximation (-60 to 0 LUFS)
        energySmoothed = 0.85 * energySmoothed + 0.15 * (rms * rms);
        let lufs = energySmoothed > 0 ? -0.691 + 10 * Math.log10(energySmoothed) : -70;
        if (!isFinite(lufs) || isNaN(lufs) || lufs < -70) lufs = -70;
        if (lufs > 0) lufs = 0;

        // Dynamic Noise Floor estimation
        if (rms > 0.00001 && rms < minRmsEnergy) {
          minRmsEnergy = 0.98 * minRmsEnergy + 0.02 * rms;
        } else {
          minRmsEnergy = minRmsEnergy * 1.002; // slow drift recovery
        }
        const noiseFloorDb = minRmsEnergy > 0 ? Math.max(-90, 20 * Math.log10(minRmsEnergy)) : -90;
        
        // Memetakan nilai dB (-60 sampai 0) menjadi nilai presentase (0% sampai 100%)
        const level = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));

        // 8-Band Equalizer Spectrum Breakdown (0 - 100% per band)
        // Band 1: 20-60Hz, Band 2: 60-250Hz, Band 3: 250-500Hz, Band 4: 500-2kHz,
        // Band 5: 2k-4kHz, Band 6: 4k-6kHz, Band 7: 6k-12kHz, Band 8: 12k-20kHz
        const getBandEnergy = (minHz, maxHz) => {
          const startBin = Math.max(0, Math.floor(minHz / binWidth));
          const endBin = Math.min(freqData.length - 1, Math.ceil(maxHz / binWidth));
          if (startBin >= endBin) return 0;
          let bSum = 0;
          for (let b = startBin; b <= endBin; b++) {
            bSum += freqData[b];
          }
          const avg = bSum / (endBin - startBin + 1);
          return Math.round((avg / 255) * 100);
        };

        const spectrum8Band = [
          getBandEnergy(20, 60),      // Sub-bass
          getBandEnergy(60, 250),     // Bass
          getBandEnergy(250, 500),    // Low-mid
          getBandEnergy(500, 2000),   // Mid
          getBandEnergy(2000, 4000),  // High-mid
          getBandEnergy(4000, 6000),  // Presence
          getBandEnergy(6000, 12000), // Brilliance
          getBandEnergy(12000, 20000) // Air
        ];

        // Ground Loop Hum Detection (50Hz / 60Hz electrical noise)
        const bin50 = Math.round(50 / binWidth);
        const bin60 = Math.round(60 / binWidth);
        const energy50 = freqData[bin50] || 0;
        const energy60 = freqData[bin60] || 0;
        const avgNeighbor = ((freqData[bin50 - 1] || 0) + (freqData[bin50 + 1] || 0) + (freqData[bin60 - 1] || 0) + (freqData[bin60 + 1] || 0)) / 4;
        let humDetected = null;
        if (energy50 > 80 && energy50 > avgNeighbor + 35) {
          humDetected = '50Hz';
        } else if (energy60 > 80 && energy60 > avgNeighbor + 35) {
          humDetected = '60Hz';
        }
        
        if (this.onLevelChange) {
          // Menentukan apakah audio "pecah" (clipping) jika lebih dari 5 sampel menyentuh puncak
          const isClipping = clipCount > 5;
          // Mengirim hasil lengkap audio engineering ke callback UI
          this.onLevelChange({
            level,
            db: parseFloat(db.toFixed(1)),
            isClipping,
            lufs: parseFloat(lufs.toFixed(1)),
            truePeak: parseFloat(truePeak.toFixed(1)),
            noiseFloorDb: parseFloat(noiseFloorDb.toFixed(1)),
            humDetected,
            spectrum8Band
          });
        }
        
        this.animationFrame = setTimeout(updateLevel, 50); // ~20fps polling
      };
      
      updateLevel();
      return true;
    } catch (err) {
      console.error("Microphone access denied or error:", err);
      if (this.onLevelChange) {
        this.onLevelChange({ level: 0, db: -100, isClipping: false, error: err.message });
      }
      return false;
    }
  }

  startRecording(agentName, recordDir, agentId, serverIp) {
    if (!this.stream) return false;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return true;

    try {
      this.isRecording = true;
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
      const safeName = (agentName || 'Agent').replace(/[^a-z0-9]/gi, '_');
      const safeId = agentId ? `_${agentId.replace(/[^a-z0-9\-]/gi, '')}` : '';
      this.sessionFolderName = `${safeName}${safeId}_${timestamp}`;
      this.recordDir = recordDir;
      this.agentName = agentName;
      this.serverIp = serverIp;
      this.partNumber = 1;
      
      this._startMediaRecorderChunk();
      
      return true;
    } catch (e) {
      this.isRecording = false;
      console.error('Failed to start recording:', e);
      return false;
    }
  }

  _startMediaRecorderChunk() {
    if (window.electronAPI && window.electronAPI.startRecording) {
      window.electronAPI.startRecording(this.sessionFolderName, this.partNumber, this.recordDir, this.agentName, this.serverIp);
    }

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
    
    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0 && window.electronAPI && window.electronAPI.saveAudioChunk) {
        const arrayBuffer = await e.data.arrayBuffer();
        window.electronAPI.saveAudioChunk(arrayBuffer);
      }
    };

    this.mediaRecorder.start(1000);

    // Split every 10 minutes (600,000 ms)
    this.chunkTimer = setTimeout(() => {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        const oldRecorder = this.mediaRecorder;
        oldRecorder.onstop = () => {
          if (window.electronAPI && window.electronAPI.stopRecording) { 
            window.electronAPI.stopRecording(true); 
          }
          this.partNumber++;
          if (this.isRecording) {
            setTimeout(() => {
              if (this.isRecording) {
                this._startMediaRecorderChunk();
              }
            }, 50);
          }
        };
        try {
          oldRecorder.stop();
        } catch (sErr) {
          console.warn('Error stopping mediaRecorder during rollover:', sErr);
        }
      }
    }, 10 * 60 * 1000);
  }

  stopRecording() {
    const wasRecording = this.isRecording;
    this.isRecording = false;
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.rolloverRestartTimer) {
      clearTimeout(this.rolloverRestartTimer);
      this.rolloverRestartTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {
        if (window.electronAPI && window.electronAPI.stopRecording) { 
          window.electronAPI.stopRecording(false); 
        }
      }; // prevent starting the next chunk
      try { this.mediaRecorder.stop(); } catch (e) {}
    } else if (wasRecording) {
      if (window.electronAPI && window.electronAPI.stopRecording) {
        window.electronAPI.stopRecording(false);
      }
    }
  }

  stop() {
    this.stopRecording();
    this.isRunning = false;
    if (this.animationFrame) clearTimeout(this.animationFrame);
    if (this.audioContext) this.audioContext.close();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}

export default AudioProcessor;
