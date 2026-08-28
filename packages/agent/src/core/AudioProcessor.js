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
    try {
      // Mendefinisikan aturan permintaan media (hanya audio)
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };
      
      // Meminta akses aliran (stream) mikrofon dari sistem operasi
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Membuat AudioContext standar Web Audio API
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Membuat node Analyser untuk membaca gelombang suara (PCM)
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      // Mengatur seberapa mulus pergerakan nilai audio dan ukuran sampel FFT
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.fftSize = 1024;
      this.microphone.connect(this.analyser);

      // Buffer array untuk menampung gelombang data audio mentah
      const pcmData = new Float32Array(this.analyser.fftSize);
      
      let isRunning = true;
      this.isRunning = isRunning;
      
      /**
       * Fungsi loop internal untuk terus membaca data mikrofon secara real-time.
       */
      const updateLevel = () => {
        if (!this.isRunning) return;
        
        // Memasukkan data gelombang suara (time-domain) ke dalam pcmData
        this.analyser.getFloatTimeDomainData(pcmData);
        let sum = 0;
        let clipCount = 0;
        
        // Mengkalkulasi jumlah kuadrat amplitudo (RMS) dan mengecek apakah gelombang mencapai puncak (clipping)
        for (let i = 0; i < pcmData.length; i++) {
          sum += pcmData[i] * pcmData[i];
          if (Math.abs(pcmData[i]) >= 0.99) clipCount++;
        }
        
        // Menghitung nilai Root Mean Square (RMS) dan mengkonversinya ke Decibel (dB)
        let rms = Math.sqrt(sum / pcmData.length);
        let db = rms > 0 ? 20 * Math.log10(rms) : -100;
        
        // Memetakan nilai dB (-60 sampai 0) menjadi nilai presentase (0% sampai 100%)
        let level = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
        
        if (this.onLevelChange) {
          // Menentukan apakah audio "pecah" (clipping) jika lebih dari 5 sampel menyentuh puncak
          const isClipping = clipCount > 5;
          // Mengirim hasil kembali ke callback UI
          this.onLevelChange({ level, db: parseFloat(db.toFixed(1)), isClipping });
        }
        
        // Menggunakan setTimeout agar iterasi tetap berjalan walaupun jendela tertutup (Background mode)
        this.animationFrame = setTimeout(updateLevel, 50); // ~20fps polling
      };
      
      updateLevel();
    } catch (err) {
      console.error("Microphone access denied or error:", err);
    }
  }

  startRecording(agentName, recordDir) {
    if (!this.stream) return false;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') return true;

    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
      const safeName = (agentName || 'Agent').replace(/[^a-z0-9]/gi, '_');
      this.sessionFolderName = `${safeName}_${timestamp}`;
      this.recordDir = recordDir;
      this.partNumber = 1;
      
      this._startMediaRecorderChunk();
      
      return true;
    } catch (e) {
      console.error('Failed to start recording:', e);
      return false;
    }
  }

  _startMediaRecorderChunk() {
    if (window.electronAPI && window.electronAPI.startRecording) {
      window.electronAPI.startRecording(this.sessionFolderName, this.partNumber, this.recordDir);
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
        this.mediaRecorder.onstop = () => {
          if (window.electronAPI && window.electronAPI.stopRecording) {
            window.electronAPI.stopRecording();
          }
          this.partNumber++;
          this._startMediaRecorderChunk();
        };
        this.mediaRecorder.stop();
      }
    }, 10 * 60 * 1000);
  }

  stopRecording() {
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = () => {
        if (window.electronAPI && window.electronAPI.stopRecording) {
          window.electronAPI.stopRecording();
        }
      }; // prevent starting the next chunk
      this.mediaRecorder.stop();
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
