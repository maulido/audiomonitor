const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

/**
 * Class StorageAutomationManager
 * Mengelola otomatisasi penyimpanan cerdas (Smart Storage),
 * pencadangan ke direktori sekunder (NAS / Shared Folder),
 * serta integrasi sinkronisasi cloud / webhook.
 */
class StorageAutomationManager {
  constructor(configManager, dbManager) {
    this.configManager = configManager;
    this.dbManager = dbManager;
    this.isSyncing = false;
    this.lastSyncReport = {
      lastRun: null,
      syncedFolders: 0,
      archivedFolders: 0,
      errors: []
    };
  }

  /**
   * Menghitung status kapasitas harddisk dan statistik berkas rekaman.
   */
  getStorageStatus(recordDir) {
    const config = this.configManager.getStorageAutomationConfig();
    const targetDir = recordDir || path.join(process.cwd(), 'records');

    let totalSessions = 0;
    let totalFiles = 0;
    let totalSizeBytes = 0;
    let archivedSessions = 0;
    let syncedSessions = 0;

    if (fs.existsSync(targetDir)) {
      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            totalSessions++;
            const folderPath = path.join(targetDir, entry.name);
            const files = fs.readdirSync(folderPath);
            let hasArchiveMarker = false;
            let hasSyncMarker = false;

            for (const f of files) {
              const fullF = path.join(folderPath, f);
              try {
                const stat = fs.statSync(fullF);
                if (stat.isFile()) {
                  totalFiles++;
                  totalSizeBytes += stat.size;
                  if (f.endsWith('.archived.json') || f.endsWith('.archived')) hasArchiveMarker = true;
                  if (f.endsWith('.synced.json') || f.endsWith('.synced')) hasSyncMarker = true;
                }
              } catch (e) {}
            }

            if (hasArchiveMarker) archivedSessions++;
            if (hasSyncMarker) syncedSessions++;
          }
        }
      } catch (err) {
        logger.error(`[SmartStorage] Gagal memindai direktori ${targetDir}: ${err.message}`);
      }
    }

    const totalMb = (totalSizeBytes / (1024 * 1024)).toFixed(1);
    const totalGb = (totalSizeBytes / (1024 * 1024 * 1024)).toFixed(2);

    return {
      success: true,
      targetDir,
      totalSessions,
      totalFiles,
      totalSizeBytes,
      totalMb,
      totalGb,
      archivedSessions,
      syncedSessions,
      lastSyncReport: this.lastSyncReport,
      config
    };
  }

  /**
   * Menjalankan sinkronisasi pencadangan ke folder sekunder (NAS / External Drive) atau Webhook.
   */
  async runBackupSync(recordDir) {
    if (this.isSyncing) {
      return { success: false, message: 'Proses sinkronisasi sedang berjalan.' };
    }

    const config = this.configManager.getStorageAutomationConfig();
    const sourceDir = recordDir || path.join(process.cwd(), 'records');
    const backupDir = config.backupDirectory;
    const cloudUrl = config.cloudSyncUrl;

    if (!fs.existsSync(sourceDir)) {
      return { success: false, message: 'Direktori sumber rekaman tidak ditemukan.' };
    }

    this.isSyncing = true;
    let syncedCount = 0;
    const errors = [];

    try {
      logger.info(`[SmartStorage] Memulai sinkronisasi rekaman... (Backup NAS: ${backupDir || 'Tidak disetel'}, Cloud Webhook: ${cloudUrl || 'Tidak disetel'})`);
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFolder = entry.name;
        const sessionPath = path.join(sourceDir, sessionFolder);
        const syncMarkerPath = path.join(sessionPath, '.synced.json');

        // Lewati jika sudah pernah disinkronkan sebelumnya
        if (fs.existsSync(syncMarkerPath)) continue;

        // 1. Mirror ke Backup Directory / NAS jika dikonfigurasi
        if (backupDir && fs.existsSync(backupDir)) {
          try {
            const destSessionPath = path.join(backupDir, sessionFolder);
            if (!fs.existsSync(destSessionPath)) {
              fs.mkdirSync(destSessionPath, { recursive: true });
            }
            const files = fs.readdirSync(sessionPath);
            for (const file of files) {
              if (file.startsWith('.')) continue; // lewati temporary files
              const srcFile = path.join(sessionPath, file);
              const dstFile = path.join(destSessionPath, file);
              if (fs.statSync(srcFile).isFile() && !fs.existsSync(dstFile)) {
                fs.copyFileSync(srcFile, dstFile);
              }
            }
          } catch (bErr) {
            errors.push(`NAS copy gagal pada ${sessionFolder}: ${bErr.message}`);
          }
        }

        // 2. Kirim notifikasi/metadata ke Cloud Webhook jika dikonfigurasi
        if (config.cloudSyncEnabled && cloudUrl) {
          try {
            const files = fs.readdirSync(sessionPath);
            const audioFiles = files.filter(f => f.endsWith('.webm') || f.endsWith('.mp3') || f.endsWith('.wav'));
            await fetch(cloudUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'session_backup_sync',
                sessionFolder,
                audioFiles,
                syncedAt: new Date().toISOString()
              })
            });
          } catch (cErr) {
            errors.push(`Cloud webhook gagal pada ${sessionFolder}: ${cErr.message}`);
          }
        }

        // Tulis marker .synced.json
        try {
          fs.writeFileSync(syncMarkerPath, JSON.stringify({
            syncedAt: new Date().toISOString(),
            backupDir: backupDir || null,
            cloudSynced: Boolean(config.cloudSyncEnabled && cloudUrl)
          }));
          syncedCount++;
        } catch (mErr) {}
      }

      this.lastSyncReport = {
        lastRun: new Date().toISOString(),
        syncedFolders: syncedCount,
        archivedFolders: this.lastSyncReport.archivedFolders,
        errors
      };

      logger.info(`[SmartStorage] Sinkronisasi selesai. Berhasil mencadangkan ${syncedCount} sesi baru.`);
      return { success: true, syncedCount, errors };
    } catch (err) {
      logger.error(`[SmartStorage] Error sinkronisasi: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Menjalankan otomatisasi pengarsipan sesi lawas (Old Records Archiving).
   */
  async runAutoArchive(recordDir) {
    const config = this.configManager.getStorageAutomationConfig();
    const sourceDir = recordDir || path.join(process.cwd(), 'records');
    const autoArchiveDays = config.autoArchiveDays || 14;
    const cutoffTime = Date.now() - (autoArchiveDays * 24 * 60 * 60 * 1000);

    if (!fs.existsSync(sourceDir)) return { success: false, archivedCount: 0 };

    let archivedCount = 0;
    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionPath = path.join(sourceDir, entry.name);
        const archiveMarker = path.join(sessionPath, '.archived.json');

        if (fs.existsSync(archiveMarker)) continue;

        try {
          const stat = fs.statSync(sessionPath);
          if (stat.mtimeMs < cutoffTime) {
            fs.writeFileSync(archiveMarker, JSON.stringify({
              archivedAt: new Date().toISOString(),
              retentionDays: autoArchiveDays
            }));
            archivedCount++;
          }
        } catch (e) {}
      }

      this.lastSyncReport.archivedFolders = (this.lastSyncReport.archivedFolders || 0) + archivedCount;
      return { success: true, archivedCount };
    } catch (err) {
      logger.error(`[SmartStorage] Gagal mengarsipkan berkas lama: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Menjalankan pembersihan berkas audio (.webm, .wav, .mp3, dll) lawas secara otomatis
   * berdasarkan usia hari (autoPurgeAudioDays), namun TETAP MEMPERTAHANKAN berkas transkrip teks (.transcript.json, .txt, .srt).
   * @param {string} recordDir - Direktori rekaman server
   * @param {number|null} customDays - Kustom hari retensi (opsional)
   */
  async runAutoPurgeRawAudio(recordDir, customDays = null) {
    const config = this.configManager ? this.configManager.getStorageAutomationConfig() : {};
    const targetDays = customDays !== null && !isNaN(customDays) ? parseInt(customDays) : (parseInt(config.autoPurgeAudioDays) || 0);

    if (targetDays <= 0) {
      return { success: false, message: 'Auto-purge audio dinonaktifkan (hari <= 0)', purgedSessions: 0, freedBytes: 0 };
    }

    const sourceDir = recordDir || path.join(process.cwd(), 'records');
    if (!fs.existsSync(sourceDir)) {
      return { success: false, message: 'Direktori sumber rekaman tidak ditemukan', purgedSessions: 0, freedBytes: 0 };
    }

    const cutoffTime = Date.now() - (targetDays * 24 * 60 * 60 * 1000);
    const AUDIO_EXTS = new Set(['.webm', '.ogg', '.wav', '.mp3', '.m4a']);
    let purgedSessions = 0;
    let deletedFilesCount = 0;
    let preservedTranscriptsCount = 0;
    let totalFreedBytes = 0;

    try {
      const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionFolder = entry.name;
        const sessionPath = path.join(sourceDir, sessionFolder);
        const purgeMarker = path.join(sessionPath, '.audio_purged.json');

        if (fs.existsSync(purgeMarker)) continue;

        try {
          const stat = fs.statSync(sessionPath);
          let sessionAgeMs = stat.mtimeMs;

          // Parse tanggal dari nama folder jika tersedia: PC_Testing_uuid_2026-08-01_...
          const dateMatch = sessionFolder.match(/_(\d{4}-\d{2}-\d{2})_/);
          if (dateMatch) {
            const parsedTime = Date.parse(dateMatch[1]);
            if (!isNaN(parsedTime)) {
              sessionAgeMs = parsedTime;
            }
          }

          if (sessionAgeMs < cutoffTime) {
            const files = fs.readdirSync(sessionPath);
            let sessionFreedBytes = 0;
            let sessionDeletedFiles = 0;
            let sessionPreservedTranscripts = 0;

            for (const file of files) {
              const ext = path.extname(file).toLowerCase();
              const fullFilePath = path.join(sessionPath, file);
              try {
                const fStat = fs.statSync(fullFilePath);
                if (AUDIO_EXTS.has(ext) && fStat.isFile()) {
                  sessionFreedBytes += fStat.size;
                  fs.unlinkSync(fullFilePath);
                  sessionDeletedFiles++;
                } else if (file.endsWith('.transcript.json') || file.endsWith('.txt') || file.endsWith('.srt')) {
                  sessionPreservedTranscripts++;
                }
              } catch (fErr) {}
            }

            if (sessionDeletedFiles > 0) {
              fs.writeFileSync(purgeMarker, JSON.stringify({
                purgedAt: new Date().toISOString(),
                autoPurgeDays: targetDays,
                freedBytes: sessionFreedBytes,
                deletedFiles: sessionDeletedFiles,
                preservedTranscripts: sessionPreservedTranscripts
              }));
              try {
                fs.writeFileSync(path.join(sessionPath, '.audio_purged'), 'purged', 'utf8');
              } catch (mErr) {}

              purgedSessions++;
              deletedFilesCount += sessionDeletedFiles;
              preservedTranscriptsCount += sessionPreservedTranscripts;
              totalFreedBytes += sessionFreedBytes;
            }
          }
        } catch (sErr) {}
      }

      const totalFreedMb = (totalFreedBytes / (1024 * 1024)).toFixed(2);
      if (purgedSessions > 0) {
        logger.audit(`[AutoPurgeAudio] Otomatisasi pembersihan audio lawas (> ${targetDays} hari) selesai: ${purgedSessions} sesi dipurged, ${totalFreedMb} MB dibebaskan, ${preservedTranscriptsCount} transkrip dipertahankan.`);
      }
      return {
        success: true,
        purgedSessions,
        deletedFilesCount,
        preservedTranscriptsCount,
        freedBytes: totalFreedBytes,
        freedMb: totalFreedMb
      };
    } catch (err) {
      logger.error(`[AutoPurgeAudio] Gagal mengeksekusi auto-purge raw audio: ${err.message}`);
      return { success: false, error: err.message, purgedSessions: 0, freedBytes: 0 };
    }
  }
}

module.exports = StorageAutomationManager;
