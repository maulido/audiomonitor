# 🎙️ AudioMonitor

AudioMonitor adalah sistem pengawasan audio jarak jauh (Remote Telemetry) kelas enterprise yang dirancang khusus untuk studio siaran langsung (*live streaming*). Sistem ini secara cerdas menggabungkan pembacaan fisik (Hardware Microphone) dan pembacaan perangkat lunak (OBS Studio) secara bersamaan untuk mencegah insiden fatal selama siaran.

![AudioMonitor Dashboard](https://img.shields.io/badge/UI-Dashboard_Ready-success)
![Platform](https://img.shields.io/badge/Platform-Windows_|_Electron-blue)
![Stack](https://img.shields.io/badge/Stack-Node.js_|_React-yellow)

## ✨ Fitur Utama
*   **Pemantauan Hibrida (Mic + OBS):** Sistem membaca volume langsung dari *driver hardware* mikrofon sekaligus menyadap status *output* dari dalam OBS Studio (via WebSocket) secara bersamaan.
*   **Deteksi Cerdas 3 Bahaya Utama:**
    1.  **Mic Mati / Terlepas:** Mendeteksi jika ruangan hening total melebihi batas waktu toleransi.
    2.  **Suara Pecah (Clipping):** Mendeteksi jika level audio (dB) menabrak batas atas terlalu lama.
    3.  **Bocor Tanpa Suara (OBS Mute):** Mendeteksi jika ada orang berbicara kencang di mikrofon, namun suara tersebut terblokir/Mute di dalam OBS.
*   **Notifikasi Telegram (Anti-Spam):** Mengirimkan peringatan instan ke grup/chat Telegram hanya saat bahaya terjadi, lengkap dengan interval pengingat.
*   **Doomsday Protocol (Offline Fallback):** Jika Central Server mati listrik, setiap PC (Agent) akan mengambil alih tugas pengiriman peringatan Telegram menggunakan koneksi internet mereka masing-masing.
*   **Silent Auto-Update (OTA):** Pembaruan aplikasi PC secara diam-diam (*Seamless*) melalui GitHub Releases. Pengguna PC tidak akan diganggu oleh *wizard* instalasi.

---

## 🏗️ Arsitektur Sistem (Monorepo)

Proyek ini dibangun menggunakan struktur Monorepo (NPM Workspaces) yang memuat 3 aplikasi terpisah:

1.  **`packages/server` (Pusat Komando):** Aplikasi backend Node.js (Socket.io) yang menerima seluruh telemetri dari berbagai PC, mencatat log insiden ke SQLite, dan menembakkan pesan Telegram.
2.  **`packages/dashboard` (Pusat Kontrol):** Aplikasi web React (Vite) yang menyediakan antarmuka visual (Dashboard) untuk memantau puluhan PC sekaligus dari satu layar.
3.  **`packages/agent` (Pasukan Pemantau):** Aplikasi desktop rahasia (Electron) yang dipasang di setiap komputer siaran. Berjalan diam-diam di *System Tray* untuk membaca sensor suara dan OBS.

---

## 🚀 Cara Menjalankan (Development)

### 1. Persiapan
Pastikan Anda memiliki Node.js (v18+) terinstal.
```bash
git clone https://github.com/maulido/audiomonitor.git
cd audiomonitor
npm install
```

### 2. Menjalankan Central Server & Dashboard
Buka terminal pertama dan jalankan perintah:
```bash
npm run dev --workspace=packages/server
```
Buka browser dan akses `http://localhost:3000`. Masukkan PIN default: `1234`.

### 3. Menjalankan Agent (Electron)
Buka terminal kedua dan jalankan perintah:
```bash
npm run dev --workspace=packages/agent
```

---

## 📦 Build & Distribusi (Production)

### Build Agent (Installer Windows .exe)
```bash
npm run build --workspace=packages/agent
```
*Installer akan otomatis dibuat di folder `packages/agent/out/`.*

### Rilis OTA (Auto-Update) via GitHub
1. Ubah nomor versi (misal ke `1.0.2`) di `packages/agent/package.json`.
2. Lakukan *build* seperti di atas.
3. Buat rilis baru di halaman GitHub Releases dengan tag `v1.0.2`.
4. Unggah file `AudioMonitor_Agent_Installer_v1.0.2.exe`, file `.blockmap`, dan `latest.yml` ke rilis tersebut.
5. Seluruh PC Agent yang sedang menyala akan otomatis mendownload dan memperbarui dirinya sendiri.

---

## ⚙️ Penyesuaian Sensitivitas (Dari Dashboard)
*   **Noise Gate:** Batas minimal volume agar sistem tidak tertipu oleh suara AC/Kipas.
*   **Silence Timeout (Detik):** Batas waktu jeda napas/bicara sebelum masuk mode Standby.
*   **Dead Mic Timeout (Detik):** Batas toleransi keheningan maksimal (contoh: 600 detik / 10 menit) sebelum membunyikan alarm `BAHAYA_MIC_MATI`.
*   **Clipping Threshold (dB) & Duration:** Ambang batas volume maksimum sebelum dianggap pecah.

---
*Dibuat untuk keandalan siaran tingkat tinggi.* 🎧
