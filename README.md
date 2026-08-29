# AudioMonitor

AudioMonitor adalah sistem pengawasan audio jarak jauh (Remote Audio Telemetry) kelas enterprise yang dirancang khusus untuk studio siaran langsung (live streaming) dan multi-PC broadcast environment. Sistem ini menggabungkan pembacaan fisik (Hardware Microphone) dan pembacaan perangkat lunak (OBS Studio WebSocket) secara bersamaan untuk mencegah insiden audio fatal selama siaran berlangsung.

---

## Fitur Utama

- **Pemantauan Audio Hibrida (Mic + OBS):** Membaca volume dan sinyal suara langsung dari driver mikrofon fisik sekaligus menyadap status level audio dan status mute dari OBS Studio secara real-time.
- **Deteksi Cerdas 3 Status Bahaya:**
  1. **Mic Mati / Hening Total (BAHAYA_MIC_MATI):** Mendeteksi jika ruangan hening melebihi batas waktu toleransi (Dead Mic Timeout).
  2. **Suara Pecah (BAHAYA_AUDIO_PECAH):** Mendeteksi jika level audio (dB) menabrak batas atas (Clipping) dalam durasi tertentu.
  3. **Bocor Tanpa Suara / OBS Mute (BAHAYA_OBS_MUTE):** Mendeteksi jika host berbicara di mikrofon namun jalur audio di OBS dalam status Mute.
- **Fitur Auto-Recovery (Auto-Unmute OBS):** Fitur otomatis untuk membuka Mute pada OBS secara mandiri seketika saat host mulai berbicara, mencegah status bahaya tanpa memerlukan intervensi manual operator.
- **Perekaman Otomatis Sesi Siaran (Auto-Record):** Sinkronisasi otomatis perekaman audio host saat OBS Streaming/Recording aktif. Audio dipotong otomatis setiap 10 menit (rollover chunk) dan langsung diunggah ke penyimpanan Central Server.
- **Unified Continuous Audio Player:** Pemutar audio terintegrasi pada Dashboard Web yang mampu memutar seluruh potongan part rekaman dalam satu timeline linier tanpa jeda, dilengkapi kontrol kecepatan pemutaran (1x, 1.25x, 1.5x, 2x), seek antar-part, dan perbaikan otomatis WebM EBML header.
- **Centralized LAN Auto-Update Hub (Hybrid Update System):**
  - **Sinkronisasi 1-Klik dari GitHub Releases:** Server dapat langsung memeriksa dan mengunduh file installer Agent versi terbaru dari repositori GitHub.
  - **Upload Manual dari Web Dashboard:** Operator dapat mengunggah file installer `.exe` baru langsung melalui antarmuka web Dashboard.
  - **Broadcast Pembaruan LAN:** Server menyiarkan perintah pembaruan ke seluruh atau salah satu PC Agent di jaringan lokal untuk melakukan download dan silent install secara otomatis di latar belakang tanpa mengganggu host.
- **Peringatan Terpusat Telegram (Anti-Spam):** Mengirimkan peringatan instan ke grup atau chat Telegram saat terjadi insiden bahaya, dilengkapi pengaturan interval pengingat.
- **Doomsday Protocol (Offline Fallback):** Jika Central Server offline atau mati listrik, setiap PC Agent secara otomatis mengambil alih pengiriman notifikasi Telegram secara mandiri menggunakan koneksi internet masing-masing.
- **Pencatatan Insiden & Ekspor CSV:** Riwayat kejadian disimpan dan dapat difilter berdasarkan tanggal, nama PC, serta tipe status, lengkap dengan fitur ekspor ke format CSV.
- **Konfigurasi Jarak Jauh (Remote Config):** Pengaturan sensitivitas bicara, batas clipping, nama PC, dan polling rate dapat diubah langsung dari Web Dashboard tanpa perlu menyentuh komputer Agent.

---

## Arsitektur Sistem

Proyek ini menggunakan struktur Monorepo (NPM Workspaces) yang terdiri dari tiga komponen utama:

1. **`packages/server` (Central Server & Update Hub):**
   - Backend Node.js berbasis Express dan Socket.io.
   - Melayani endpoint API, WebSocket telemetri, penyimpanan database insiden, arsip rekaman audio, dan distribusi file pembaruan aplikasi.
   - Menyajikan antarmuka Dashboard Web yang telah ter-bundle di port `4000`.
   - Berjalan sebagai aplikasi background dengan System Tray Windows.

2. **`packages/dashboard` (Web Monitoring Dashboard):**
   - Antarmuka web modern berbasis React dan Vite.
   - Menampilkan visualisasi real-time sparkline meter audio, status perangkat keras (CPU, RAM, bitrate stream), kontrol pemutar audio, log insiden, dan panel pengaturan server.

3. **`packages/agent` (Client Monitoring Agent):**
   - Aplikasi desktop berbasis Electron yang berjalan di System Tray setiap PC siaran.
   - Memantau hardware audio via Web Audio API, menghubungkan ke OBS Studio via WebSocket (obs-websocket-js v5), merekam chunk audio, dan mengeksekusi silent auto-update.

---

## Persyaratan Sistem

- **Sistem Operasi:** Windows 10 / Windows 11 (64-bit).
- **Node.js:** Versi 18.0.0 atau lebih baru.
- **OBS Studio:** Versi 28 ke atas (WebSocket Server bawaan aktif).
- **Jaringan:** Terhubung dalam satu jaringan lokal (LAN/Wi-Fi yang sama) antara komputer Server dan seluruh PC Agent.

---

## Panduan Instalasi & Pengembangan (Development)

### 1. Kloning Repositori
```bash
git clone https://github.com/maulido/audiomonitor.git
cd audiomonitor
npm install
```

### 2. Menjalankan Central Server
```bash
npm run start --workspace=packages/server
```
Server akan berjalan di port `4000`. Akses Web Dashboard melalui browser:
```
http://localhost:4000
```
PIN keamanan default: `1234`.

### 3. Menjalankan Dashboard (Mode Dev Vite)
```bash
npm run dev --workspace=packages/dashboard
```
Dashboard dev server akan berjalan di `http://localhost:5173`.

### 4. Menjalankan Agent (Mode Dev Electron)
```bash
npm run dev --workspace=packages/agent
```

---

## Build & Distribusi Produksi

### 1. Build Bundle Web Dashboard
```bash
npm run build --workspace=packages/dashboard
```
Salin folder `dist` ke `packages/server/dashboard-dist` agar otomatis disajikan oleh server.

### 2. Build Server Installer Windows (`.exe`)
```bash
npm run build --workspace=packages/server
```
File installer akan dibuat di folder `packages/server/out/AudioMonitor_Server_Installer_v1.0.1.exe`.

### 3. Build Agent Installer Windows (`.exe`)
```bash
npm run build --workspace=packages/agent
```
File installer akan dibuat di folder `packages/agent/out/AudioMonitor_Agent_Installer_v1.0.1.exe`.

---

## Konfigurasi Parameter Sensitivitas

Seluruh parameter berikut dapat disesuaikan per-komputer melalui Dashboard Modal Settings:

| Parameter | Fungsi | Nilai Default |
|---|---|---|
| **Speaking Threshold** | Ambang sensitivitas volume mikrofon agar dianggap sedang berbicara | 10% |
| **Silence Timeout** | Waktu jeda hening sebelum masuk status Standby Diam | 30 detik |
| **Dead Mic Timeout** | Batas waktu hening maksimal sebelum alarm Mic Mati berbunyi | 600 detik (10 menit) |
| **OBS Mute Timeout** | Batas waktu toleransi berbicara saat OBS termute sebelum alarm berbunyi | 5 detik |
| **Clipping Threshold** | Ambang batas volume maksimum sebelum dianggap suara pecah | 98% (-0.5 dB) |
| **Clipping Duration** | Durasi suara pecah terus-menerus sebelum alarm Suara Pecah aktif | 3 detik |
| **Auto-Recovery Unmute** | Memaksa buka Mute di OBS seketika saat host mulai berbicara | Aktif |
| **Auto-Record on OBS Live** | Otomatis merekam audio host saat OBS aktif streaming/recording | Nonaktif |
| **Data Polling Rate** | Frekuensi pengiriman data telemetri (Realtime 0.5s / Normal 2s / Eco 5s) | Realtime (500ms) |

---

## Alur Pembaruan Otomatis (LAN Auto-Update)

1. Kompilasi versi baru Agent menggunakan perintah `npm run build --workspace=packages/agent`.
2. Buka Web Dashboard di tab **Settings** pada bagian **Pembaruan Aplikasi Terpusat**.
3. Pilih salah satu metode penyediaan file installer:
   - Klik **Cek Rilis GitHub** lalu klik **Unduh Installer ke Server**, atau
   - Klik **Upload File Installer Manual** dan pilih file `.exe` yang baru dibuat.
4. Klik **Sebarkan ke Seluruh PC Agent** (atau tombol update per PC pada kartu agent).
5. Seluruh PC Agent akan mengunduh file secara lokal via HTTP LAN dan mengeksekusi instalasi otomatis tanpa memunculkan jendela wizard.

---

## Lisensi

Didistribusikan di bawah lisensi FOSS (Free and Open Source Software).
