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
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.fftSize = 1024;
      this.microphone.connect(this.analyser);

      const pcmData = new Float32Array(this.analyser.fftSize);
      
      const updateLevel = () => {
        this.analyser.getFloatTimeDomainData(pcmData);
        let sum = 0;
        for (let i = 0; i < pcmData.length; i++) {
          // pcmData values are -1 to 1 roughly
          sum += pcmData[i] * pcmData[i];
        }
        
        let rms = Math.sqrt(sum / pcmData.length);
        
        // Convert RMS to decibels
        let db = rms > 0 ? 20 * Math.log10(rms) : -100;
        
        // Map -60dB (0%) to 0dB (100%)
        let level = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
        
        if (this.onLevelChange) {
          this.onLevelChange(level);
        }
        
        this.animationFrame = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
    } catch (err) {
      console.error("Microphone access denied or error:", err);
    }
  }

  stop() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    if (this.audioContext) this.audioContext.close();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}

export default AudioProcessor;
