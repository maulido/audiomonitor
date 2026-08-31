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

    if (this.queue.some(item => item.filePath === filePath)) {
      return false;
    }

    this.queue.push({ filePath, sessionFolder, fileName, pcName, enqueuedAt: Date.now() });
    logger.info(`[Whisper] File ditambahkan ke antrean transkripsi: ${fileName} (${this.queue.length} antre)`);
    
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
    if (!config.apiUrl) {
      throw new Error('URL Whisper API belum dikonfigurasi.');
    }

    logger.info(`[Whisper] Mengirim audio (${(stat.size / 1024 / 1024).toFixed(2)} MB) ke Whisper API (${config.apiUrl}): ${fileName}`);

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
            fs.unlinkSync(tempPath);
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
    if (!text || !Array.isArray(keywords) || keywords.length === 0) return [];
    
    const lowerText = String(text || '').toLowerCase();
    const matched = [];

    for (const kw of keywords) {
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
        return JSON.parse(raw);
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
          lastTranscribedAt = data.transcribedAt || lastTranscribedAt;
        } catch (err) {}
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

  broadcastStatus(sessionFolder, fileName, status, error = null) {
    if (this.telemetryHub && this.telemetryHub.io) {
      this.telemetryHub.io.to('dashboards').emit('transcription-status', {
        sessionFolder,
        fileName,
        status,
        error,
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = TranscriptionManager;