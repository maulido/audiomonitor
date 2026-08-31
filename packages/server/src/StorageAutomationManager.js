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
}

module.exports = StorageAutomationManager;
