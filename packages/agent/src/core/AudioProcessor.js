class AudioProcessor {
  constructor(onLevelChange) {
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.animationFrame = null;
    this.onLevelChange = onLevelChange; // Callback for UI
  }

  async start(deviceId = null) {
    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.fftSize = 1024;
      this.microphone.connect(this.analyser);

      const pcmData = new Float32Array(this.analyser.fftSize);
      
      let isRunning = true;
      this.isRunning = isRunning;
      
      const updateLevel = () => {
        if (!this.isRunning) return;
        
        this.analyser.getFloatTimeDomainData(pcmData);
        let sum = 0;
        let clipCount = 0;
        for (let i = 0; i < pcmData.length; i++) {
          sum += pcmData[i] * pcmData[i];
          if (Math.abs(pcmData[i]) >= 0.99) clipCount++;
        }
        
        let rms = Math.sqrt(sum / pcmData.length);
        let db = rms > 0 ? 20 * Math.log10(rms) : -100;
        let level = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
        
        if (this.onLevelChange) {
          // Send raw level
          const isClipping = clipCount > 5;
          this.onLevelChange({ level, db: parseFloat(db.toFixed(1)), isClipping });
        }
        
        // Use setTimeout instead of requestAnimationFrame so it keeps running when window is minimized/hidden in tray
        this.animationFrame = setTimeout(updateLevel, 50); // ~20fps polling is enough for telemetry
      };
      
      updateLevel();
    } catch (err) {
      console.error("Microphone access denied or error:", err);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrame) clearTimeout(this.animationFrame);
    if (this.audioContext) this.audioContext.close();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}

export default AudioProcessor;
