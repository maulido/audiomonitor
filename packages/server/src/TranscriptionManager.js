const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

/**
 * Class TranscriptionManager
 * Bertugas mengelola antrean transkripsi audio ke teks (Speech-to-Text)
 * via API OpenAI Whisper (baik lokal Mac M1 Worker maupun cloud),
 * menyimpan hasil transkrip ke file JSON, serta memindai kata kunci bahaya.
 */
class TranscriptionManager {
  constructor(configManager, dbManager, alertManager, telemetryHub) {
    this.configManager = configManager;
    this.dbManager = dbManager;
    this.alertManager = alertManager;
    this.telemetryHub = telemetryHub;

    this.queue = [];
    this.isProcessing = false;
    this.currentTask = null;
    this.activeTasks = new Map();
  }

  /**
   * Menambahkan file rekaman ke antrean transkripsi otomatis di latar belakang.
   */
  enqueueFile(filePath, sessionFolder, fileName, pcName) {
    const config = this.configManager.getTranscriptionConfig();
    if (!config.enabled || !config.apiUrl) {
      return false;
    }
    if (config.autoTranscribe === false) {
      return false;
    }

    if (this.activeTasks.has(filePath) || this.queue.some(item => item.filePath === filePath)) {
      return false;
    }

    this.queue.push({ filePath, sessionFolder, fileName, pcName, enqueuedAt: Date.now() });
    logger.info(`[Whisper] File ditambahkan ke antrean transkripsi: ${fileName} (${this.queue.length} antre)`);
    
    this.broadcastStatus(sessionFolder, fileName, 'queued');
    this.processQueue();
    return true;
  }

  /**
   * Pemrosesan antrean transkripsi berurutan (FIFO).
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const task = this.queue.shift();
    this.currentTask = task;

    try {
      this.activeTasks.set(task.filePath, 'processing');
      this.broadcastStatus(task.sessionFolder, task.fileName, 'processing');

      await this.transcribeFile(task.filePath, task.sessionFolder, task.fileName, task.pcName);
      
      this.activeTasks.delete(task.filePath);
      this.broadcastStatus(task.sessionFolder, task.fileName, 'completed');
    } catch (err) {
      logger.error(`[Whisper] Gagal mentranskripsi ${task.fileName}: ${err.message}`);
      this.activeTasks.delete(task.filePath);
      this.broadcastStatus(task.sessionFolder, task.fileName, 'failed', err.message);
    } finally {
      this.currentTask = null;
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processQueue(), 500);
      }
    }
  }

  /**
   * Mengirim file audio ke API Whisper dan memproses hasilnya.
   */
  async transcribeFile(filePath, sessionFolder, fileName, pcName) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File audio tidak ditemukan di disk: ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      throw new Error(`File audio kosong (0 bytes): ${fileName}`);
    }

    const config = this.configManager.getTranscriptionConfig();

    // VAD Pre-Filter: Jika ukuran file mikro/rusak (< 64 bytes), lewati request API dan tandai sebagai hening
    if (stat.size < 64) {
      logger.info(`[Whisper] File ${fileName} sangat kecil (${stat.size} bytes), ditandai hening secara instan.`);
      const silentResponse = {
        text: "[Rekaman Hening / Tanpa Percakapan]",
        language: config.language || 'id',
        duration: 0,
        segments: []
      };
      const normalized = this.normalizeResponse(silentResponse, fileName, sessionFolder, pcName, config.language);
      const transcriptPath = `${filePath}.transcript.json`;
      this.atomicWriteJsonSync(transcriptPath, normalized);
      return normalized;
    }

    if (!config.apiUrl) {
      throw new Error('URL Whisper API belum dikonfigurasi.');
    }

    // Auto-repair WebM header jika file berformat .webm (misal chunk rollover Part 2, Part 3, dll)
    if (filePath.endsWith('.webm')) {
      this.repairWebMFile(filePath);
    }

    const currentStat = fs.existsSync(filePath) ? fs.statSync(filePath) : stat;
    logger.info(`[Whisper] Mengirim audio (${(currentStat.size / 1024 / 1024).toFixed(2)} MB) ke Whisper API (${config.apiUrl}): ${fileName}`);

    const fileBuffer = fs.readFileSync(filePath);
    const mimeType = fileName.endsWith('.wav') ? 'audio/wav' : (fileName.endsWith('.mp3') ? 'audio/mpeg' : 'audio/webm');
    
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('model', 'whisper-1');
    if (config.language) {
      formData.append('language', config.language);
    }
    formData.append('response_format', 'verbose_json');

    const headers = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
      headers['x-api-key'] = config.apiKey;
    }

    const controller = new AbortController();
    const timeoutMs = 120000;
    const timeoutId = setTimeout(() => controller.abort(new Error('Whisper API request timeout')), timeoutMs);

    let rawData;
    try {
      const res = await fetch(config.apiUrl, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`API error HTTP ${res.status}: ${errText.substring(0, 200)}`);
      }

      const resText = await res.text();
      try {
        rawData = JSON.parse(resText);
      } catch (jsonErr) {
        // Fallback jika API mengembalikan raw text
        rawData = { text: resText };
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const normalized = this.normalizeResponse(rawData, fileName, sessionFolder, pcName, config.language);
    const keywordsFound = this.scanAlertKeywords(normalized.text, config.alertKeywords || []);
    normalized.keywordsFound = keywordsFound;

    const transcriptPath = `${filePath}.transcript.json`;
    this.atomicWriteJsonSync(transcriptPath, normalized);
    logger.info(`[Whisper] Transkrip berhasil disimpan: ${transcriptPath}`);

    if (keywordsFound.length > 0) {
      this.handleKeywordAlert(pcName, sessionFolder, fileName, keywordsFound, normalized.text);
    }

    return normalized;
  }

  atomicWriteJsonSync(targetPath, data, maxRetries = 3) {
    const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(data, null, 2);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(tempPath, payload, 'utf8');

    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        fs.renameSync(tempPath, targetPath);
        return true;
      } catch (err) {
        attempts++;
        if (attempts >= maxRetries) {
          try {
            fs.copyFileSync(tempPath, targetPath);
            try { fs.unlinkSync(tempPath); } catch (uErr) {}
            return true;
          } catch (copyErr) {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) {}
            throw err;
          }
        }
      }
    }
  }

  normalizeResponse(raw, fileName, sessionFolder, pcName, language, fileDuration = 0) {
    let fullText = '';
    let segments = [];
    let duration = 0;

    if (typeof raw === 'string') {
      fullText = raw.trim();
    } else if (raw && typeof raw === 'object') {
      if (raw.error) {
        throw new Error(`Worker Whisper error: ${typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error)}`);
      }
      fullText = raw.text || raw.transcription || raw.result || '';
      if (typeof raw.duration === 'number' && raw.duration > 0) {
        duration = raw.duration;
      }
      
      if (Array.isArray(raw.segments)) {
        segments = raw.segments.map((seg, idx) => ({
          id: seg.id !== undefined ? seg.id : idx,
          start: typeof seg.start === 'number' ? seg.start : 0,
          end: typeof seg.end === 'number' ? seg.end : 0,
          text: String(seg.text || '').trim()
        }));

        if (!duration && segments.length > 0) {
          const lastSeg = segments[segments.length - 1];
          if (lastSeg && typeof lastSeg.end === 'number' && lastSeg.end > 0) {
            duration = lastSeg.end;
          }
        }
      }
    }

    if (segments.length === 0 && fullText) {
      segments.push({
        id: 0,
        start: 0,
        end: duration || 0,
        text: fullText
      });
    }

    return {
      fileName,
      sessionFolder,
      pcName: pcName || 'Unknown PC',
      transcribedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      language: language || 'id',
      duration: duration || fileDuration || 0,
      text: fullText,
      segments,
      keywordsFound: []
    };
  }

  scanAlertKeywords(text, keywords = []) {
    if (!text) return [];
    let kwList = [];
    if (Array.isArray(keywords)) {
      kwList = keywords;
    } else if (typeof keywords === 'string') {
      kwList = keywords.split(',').map(k => k.trim()).filter(Boolean);
    } else {
      return [];
    }
    if (kwList.length === 0) return [];
    
    const lowerText = String(text || '').toLowerCase();
    const matched = [];

    for (const kw of kwList) {
      const cleanKw = String(kw || '').trim().toLowerCase();
      if (cleanKw && lowerText.includes(cleanKw)) {
        matched.push(cleanKw);
      }
    }
    return [...new Set(matched)];
  }

  handleKeywordAlert(pcName, sessionFolder, fileName, keywordsFound, textSnippet) {
    const kwList = keywordsFound.join(', ');
    const snippet = textSnippet.length > 120 ? textSnippet.substring(0, 120) + '...' : textSnippet;

    logger.warn(`[Whisper Alert] Terdeteksi kata bahaya [${kwList}] pada ${pcName} (${fileName})`);

    if (this.dbManager) {
      this.dbManager.logIncident(
        pcName, 
        pcName, 
        'KEYWORD_ALERT', 
        `Terdeteksi kata: "${kwList}". Cuplikan: "${snippet}"`
      );
    }

    if (this.alertManager) {
      const msg = `[KEYWORD ALERT] <b>DETEKSI KATA BAHAYA</b>\n<b>PC:</b> ${this.alertManager.escapeHtml(pcName)}\n<b>File:</b> ${this.alertManager.escapeHtml(fileName)}\n<b>Kata Kunci:</b> <code>${this.alertManager.escapeHtml(kwList)}</code>\n<b>Cuplikan:</b> <i>"${this.alertManager.escapeHtml(snippet)}"</i>`;
      this.alertManager.sendTelegramAlert(msg);
    }

    if (this.telemetryHub && this.telemetryHub.io) {
      this.telemetryHub.io.to('dashboards').emit('keyword-alert', {
        pcName,
        sessionFolder,
        fileName,
        keywords: keywordsFound,
        snippet,
        timestamp: new Date().toISOString()
      });
    }
  }

  getTranscriptForFile(filePath) {
    const transcriptPath = `${filePath}.transcript.json`;
    if (fs.existsSync(transcriptPath)) {
      try {
        const raw = fs.readFileSync(transcriptPath, 'utf8');
        const data = JSON.parse(raw);
        const activeKeywords = this.configManager ? (this.configManager.getTranscriptionConfig().alertKeywords || []) : [];
        if (activeKeywords.length > 0 && data.text) {
          const dynamicKeywords = this.scanAlertKeywords(data.text, activeKeywords);
          data.keywordsFound = Array.from(new Set([...(Array.isArray(data.keywordsFound) ? data.keywordsFound : []), ...dynamicKeywords]));
        }
        return data;
      } catch (e) {
        logger.error(`Gagal membaca file transkrip ${transcriptPath}: ${e.message}`);
      }
    }
    return null;
  }

  getTranscriptForSession(sessionDir) {
    if (!fs.existsSync(sessionDir)) return null;

    try {
      const files = fs.readdirSync(sessionDir);
      const transcriptFiles = files.filter(f => f.endsWith('.transcript.json')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      
      if (transcriptFiles.length === 0) return null;

      const combinedSegments = [];
      let fullText = '';
      let allKeywords = new Set();
      let lastTranscribedAt = '';
      let cumulativeOffsetSec = 0;
      let totalSessionDuration = 0;
      const activeKeywords = this.configManager ? (this.configManager.getTranscriptionConfig().alertKeywords || []) : [];

      for (const tf of transcriptFiles) {
        try {
          const tPath = path.join(sessionDir, tf);
          const data = JSON.parse(fs.readFileSync(tPath, 'utf8'));
          
          if (data.text) {
            fullText += (fullText ? '\n' : '') + data.text;
          }

          let partDuration = (typeof data.duration === 'number' && data.duration > 0) ? data.duration : 0;

          if (Array.isArray(data.segments)) {
            for (const seg of data.segments) {
              const segStart = (typeof seg.start === 'number' ? seg.start : 0) + cumulativeOffsetSec;
              const segEnd = (typeof seg.end === 'number' ? seg.end : 0) + cumulativeOffsetSec;
              combinedSegments.push({
                ...seg,
                id: combinedSegments.length,
                start: segStart,
                end: segEnd,
                partFile: data.fileName || tf.replace('.transcript.json', '')
              });
              if (!partDuration && seg.end > 0) {
                partDuration = Math.max(partDuration, seg.end);
              }
            }
          }
          if (!partDuration) {
            partDuration = 600; // Default chunk 10m
          }

          cumulativeOffsetSec += partDuration;
          totalSessionDuration += partDuration;

          if (Array.isArray(data.keywordsFound)) {
            data.keywordsFound.forEach(k => allKeywords.add(k));
          }
          if (activeKeywords.length > 0 && data.text) {
            const dynamicFound = this.scanAlertKeywords(data.text, activeKeywords);
            dynamicFound.forEach(k => allKeywords.add(k));
          }
          lastTranscribedAt = data.transcribedAt || lastTranscribedAt;
        } catch (err) {}
      }

      if (activeKeywords.length > 0 && fullText) {
        const sessionDynamic = this.scanAlertKeywords(fullText, activeKeywords);
        sessionDynamic.forEach(k => allKeywords.add(k));
      }

      return {
        sessionFolder: path.basename(sessionDir),
        transcribedAt: lastTranscribedAt,
        partsCount: transcriptFiles.length,
        duration: totalSessionDuration,
        text: fullText,
        segments: combinedSegments,
        keywordsFound: Array.from(allKeywords)
      };
    } catch (e) {
      logger.error(`Gagal mengumpulkan transkrip sesi ${sessionDir}: ${e.message}`);
      return null;
    }
  }

  /**
   * Memindai ulang seluruh berkas transkrip historis terhadap daftar kata bahaya aktif saat ini.
   * Memperbarui keywordsFound secara permanen ke file JSON di disk.
   */
  rescanAllTranscripts(recordsDir) {
    if (!recordsDir || !fs.existsSync(recordsDir)) {
      return { scannedFolders: 0, scannedFiles: 0, updatedFiles: 0, keywordsFoundCount: 0 };
    }
    const activeKeywords = this.configManager ? (this.configManager.getTranscriptionConfig().alertKeywords || []) : [];
    let scannedFolders = 0;
    let scannedFiles = 0;
    let updatedFiles = 0;
    let keywordsFoundCount = 0;

    try {
      const folders = fs.readdirSync(recordsDir);
      for (const folder of folders) {
        const folderPath = path.join(recordsDir, folder);
        try {
          if (!fs.statSync(folderPath).isDirectory()) continue;
          scannedFolders++;
          const files = fs.readdirSync(folderPath);
          const tFiles = files.filter(f => f.endsWith('.transcript.json'));
          
          for (const tf of tFiles) {
            scannedFiles++;
            const tPath = path.join(folderPath, tf);
            try {
              const data = JSON.parse(fs.readFileSync(tPath, 'utf8'));
              const oldKeywords = Array.isArray(data.keywordsFound) ? data.keywordsFound : [];
              const newKeywords = this.scanAlertKeywords(data.text || '', activeKeywords);
              
              const oldSet = new Set(oldKeywords);
              const isDifferent = oldKeywords.length !== newKeywords.length || !newKeywords.every(k => oldSet.has(k));
              
              if (isDifferent) {
                data.keywordsFound = newKeywords;
                this.atomicWriteJsonSync(tPath, data);
                updatedFiles++;
              }
              if (newKeywords.length > 0) {
                keywordsFoundCount += newKeywords.length;
              }
            } catch (readErr) {
              logger.warn(`[Whisper] Gagal memindai berkas transkrip ${tf}: ${readErr.message}`);
            }
          }
        } catch (fErr) {}
      }
    } catch (e) {
      logger.error(`[Whisper] Error rescanAllTranscripts: ${e.message}`);
    }

    logger.info(`[Whisper] Pemindaian ulang kata bahaya selesai: ${scannedFiles} file diperiksa (${scannedFolders} folder), ${updatedFiles} file transkrip diperbarui.`);
    return { scannedFolders, scannedFiles, updatedFiles, keywordsFoundCount };
  }

  searchTranscripts(query, recordDir, filters = {}) {
    if (!query || !recordDir || !fs.existsSync(recordDir)) return [];

    const lowerQuery = String(query).trim().substring(0, 200).toLowerCase();
    if (!lowerQuery) return [];

    const { startDate, endDate, pcFilter } = filters;
    const targetPc = pcFilter ? String(pcFilter).trim().toLowerCase() : '';
    const cleanStartDate = startDate ? String(startDate).trim() : '';
    const cleanEndDate = endDate ? String(endDate).trim() : '';

    const results = [];

    try {
      const folders = fs.readdirSync(recordDir);
      for (const folder of folders) {
        try {
          const folderPath = path.join(recordDir, folder);
          if (!fs.statSync(folderPath).isDirectory()) continue;

          // Parse folder date & PC name if available:
          // Format: PC_Testing_3365df9b-62ec-46ed-8644-83db7d225868_2026-08-29_00-48-53...
          const folderMatch = folder.match(/^(.*)_([a-f0-9\-]{36})_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/i);
          let folderDate = folderMatch ? folderMatch[3] : '';
          let folderPc = folderMatch ? folderMatch[1].replace(/_/g, ' ') : '';
          let folderUuid = folderMatch ? folderMatch[2] : '';

          const files = fs.readdirSync(folderPath);
          const tFiles = files.filter(f => f.endsWith('.transcript.json'));

          for (const tf of tFiles) {
            try {
              const tPath = path.join(folderPath, tf);
              const data = JSON.parse(fs.readFileSync(tPath, 'utf8'));

              const itemPc = String(data.pcName || folderPc || folderUuid || folder).trim();
              const itemDate = folderDate || (data.transcribedAt ? data.transcribedAt.substring(0, 10) : '');

              // Check PC Filter
              if (targetPc) {
                const lowerItemPc = itemPc.toLowerCase();
                const lowerFolderPc = folderPc.toLowerCase();
                const lowerFolderUuid = folderUuid.toLowerCase();
                const lowerFolder = folder.toLowerCase();

                const isPcMatch = lowerItemPc.includes(targetPc) ||
                                  targetPc.includes(lowerItemPc) ||
                                  lowerFolderPc.includes(targetPc) ||
                                  lowerFolderUuid.includes(targetPc) ||
                                  lowerFolder.includes(targetPc);
                if (!isPcMatch) continue;
              }

              // Check Date Filters (YYYY-MM-DD comparison)
              if (cleanStartDate && itemDate && itemDate < cleanStartDate) {
                continue;
              }
              if (cleanEndDate && itemDate && itemDate > cleanEndDate) {
                continue;
              }

              const text = (data.text || '').toLowerCase();

              if (text.includes(lowerQuery)) {
                const matchingSegments = (data.segments || []).filter(s => 
                  (s.text || '').toLowerCase().includes(lowerQuery)
                );

                results.push({
                  folderName: folder,
                  fileName: data.fileName || tf.replace('.transcript.json', ''),
                  pcName: data.pcName || itemPc,
                  dateStr: itemDate,
                  transcribedAt: data.transcribedAt,
                  matchedSegmentsCount: matchingSegments.length,
                  segments: matchingSegments.slice(0, 5),
                  audioUrl: `/media/${encodeURIComponent(folder)}/${encodeURIComponent(data.fileName || tf.replace('.transcript.json', ''))}`
                });
              }
            } catch (tErr) {}
          }
        } catch (fErr) {
          // Abaikan jika ada subfolder terkunci/terhapus, lanjutkan scan folder lain
        }
      }
    } catch (err) {
      logger.error(`Error searching transcripts: ${err.message}`);
    }

    return results;
  }

  async testConnection(apiUrl, apiKey) {
    if (!apiUrl || typeof apiUrl !== 'string') {
      return { success: false, error: 'URL API tidak boleh kosong.' };
    }

    const cleanUrl = apiUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      return { success: false, error: 'URL API harus diawali dengan http:// atau https://' };
    }

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const headers = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
      }

      let res = null;
      try {
        res = await fetch(cleanUrl, { method: 'GET', headers, signal: controller.signal });
      } catch (getErr) {
        try {
          res = await fetch(cleanUrl, { method: 'OPTIONS', headers, signal: controller.signal });
        } catch (optErr) {
          res = null;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      const latencyMs = Date.now() - startTime;

      if (!res || (!res.ok && res.status >= 400 && res.status !== 405 && res.status !== 404)) {
        return {
          success: false,
          latencyMs,
          error: res ? `Server merespon dengan error HTTP ${res.status}` : `Tidak dapat terhubung ke ${cleanUrl}`
        };
      }

      return {
        success: true,
        latencyMs,
        message: `Terhubung ke Whisper API dalam ${latencyMs}ms (HTTP ${res.status}).`
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        success: false,
        latencyMs,
        error: `Gagal terhubung ke ${cleanUrl}: ${err.message}`
      };
    }
  }

  getQueueStatus() {
    return {
      isProcessing: this.isProcessing,
      currentTask: this.currentTask ? {
        sessionFolder: this.currentTask.sessionFolder,
        fileName: this.currentTask.fileName,
        pcName: this.currentTask.pcName
      } : null,
      queue: this.queue.map((item, idx) => ({
        position: idx + 1,
        sessionFolder: item.sessionFolder,
        fileName: item.fileName,
        pcName: item.pcName,
        enqueuedAt: item.enqueuedAt
      })),
      queueLength: this.queue.length
    };
  }

  /**
   * Memeriksa dan memperbaiki header WebM EBML jika rusak, tergeser oleh cluster sampah, atau hilang total.
   * Sangat penting untuk chunk rekaman rollover (Part 2, Part 3, dst.) agar dapat dibaca FFmpeg & Whisper API.
   * @param {string} filePath - Path absolut ke file .webm
   * @returns {boolean} True jika file sudah valid atau berhasil diperbaiki
   */
  repairWebMFile(filePath) {
    if (!fs.existsSync(filePath) || !filePath.endsWith('.webm')) return false;

    let fd = null;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < 4) return false;

      fd = fs.openSync(filePath, 'r');
      const magic = Buffer.alloc(4);
      fs.readSync(fd, magic, 0, 4, 0);
      fs.closeSync(fd);
      fd = null;

      // Jika sudah diawali signature EBML baku (1a 45 df a3)
      if (magic.toString('hex') === '1a45dfa3') {
        return true;
      }

      logger.warn(`[Whisper Media] Berkas ${path.basename(filePath)} tidak diawali EBML header valid (magic: ${magic.toString('hex')}), memproses auto-repair...`);

      const currentData = fs.readFileSync(filePath);
      const ebmlMarker = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      const clusterMarker = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);

      // Kasus A: EBML header ada di dalam berkas namun tergeser karena ada prefix cluster lama (offset > 0)
      const ebmlOffset = currentData.indexOf(ebmlMarker);
      if (ebmlOffset > 0 && ebmlOffset < 1048576) {
        const strippedData = currentData.slice(ebmlOffset);
        const tempPath = `${filePath}.repaired_${Date.now()}`;
        fs.writeFileSync(tempPath, strippedData);
        try {
          fs.renameSync(tempPath, filePath);
        } catch (rnErr) {
          fs.copyFileSync(tempPath, filePath);
          try { fs.unlinkSync(tempPath); } catch (e) {}
        }
        logger.info(`[Whisper Media] Berhasil memotong prefix sampah (${ebmlOffset} bytes) dan memulihkan EBML header untuk: ${path.basename(filePath)}`);
        return true;
      }

      // Kasus B: EBML header hilang total. Pinjam header dari Part_001.webm pada folder sesi yang sama / folder sibling
      const parentDir = path.dirname(filePath);
      let p1Path = path.join(parentDir, 'Part_001.webm');

      if (!fs.existsSync(p1Path)) {
        const baseFolder = path.basename(parentDir).replace(/_to_\d{2}-\d{2}-\d{2}$/i, '');
        const rootDir = path.dirname(parentDir);
        if (fs.existsSync(rootDir)) {
          const siblings = fs.readdirSync(rootDir);
          for (const sib of siblings) {
            if (sib.startsWith(baseFolder)) {
              const candidate = path.join(rootDir, sib, 'Part_001.webm');
              if (fs.existsSync(candidate)) {
                p1Path = candidate;
                break;
              }
            }
          }
        }
      }

      if (fs.existsSync(p1Path) && path.resolve(p1Path) !== path.resolve(filePath)) {
        let p1Fd = null;
        try {
          p1Fd = fs.openSync(p1Path, 'r');
          const p1HeaderSample = Buffer.alloc(131072); // 128 KB
          const bytesRead = fs.readSync(p1Fd, p1HeaderSample, 0, 131072, 0);
          const p1Buf = p1HeaderSample.slice(0, bytesRead);
          const clusterIdx = p1Buf.indexOf(clusterMarker);

          if (clusterIdx > 0 && p1Buf.slice(0, 4).toString('hex') === '1a45dfa3') {
            const headerBuf = p1Buf.slice(0, clusterIdx);
            const repairedData = Buffer.concat([headerBuf, currentData]);
            const tempPath = `${filePath}.repaired_${Date.now()}`;
            fs.writeFileSync(tempPath, repairedData);
            try {
              fs.renameSync(tempPath, filePath);
            } catch (rnErr) {
              fs.copyFileSync(tempPath, filePath);
              try { fs.unlinkSync(tempPath); } catch (e) {}
            }
            logger.info(`[Whisper Media] Berhasil menyematkan EBML header dari ${path.basename(p1Path)} ke ${path.basename(filePath)}`);
            return true;
          }
        } finally {
          if (p1Fd !== null) try { fs.closeSync(p1Fd); } catch(e) {}
        }
      }

      return false;
    } catch (err) {
      logger.warn(`[Whisper Media] Gagal memperbaiki WebM ${path.basename(filePath)}: ${err.message}`);
      return false;
    } finally {
      if (fd !== null) try { fs.closeSync(fd); } catch(e) {}
    }
  }

  broadcastStatus(sessionFolder, fileName, status, error = null) {
    if (this.telemetryHub && this.telemetryHub.io) {
      this.telemetryHub.io.to('dashboards').emit('transcription-status', {
        sessionFolder,
        fileName,
        status,
        error,
        queueStatus: this.getQueueStatus(),
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = TranscriptionManager;