# AudioMonitor

AudioMonitor adalah sistem pengawasan audio jarak jauh (*Remote Audio Telemetry*) dan manajemen rekaman siaran kelas enterprise yang dirancang khusus untuk studio siaran langsung (*live streaming*) dan lingkungan multi-PC broadcast. Sistem ini menggabungkan pemantauan perangkat keras fisik (*Hardware Microphone Driver*) dan pembacaan perangkat lunak (*OBS Studio WebSocket*) secara bersamaan untuk mencegah insiden audio fatal selama siaran langsung.

---

## Fitur Utama

### 1. Pemantauan Audio Hibrida Real-Time (Mic + OBS)
- **Multi-Source Telemetry:** Membaca volume dan sinyal suara langsung dari driver mikrofon fisik sekaligus menyadap status level audio, scene aktif, dan status mute dari OBS Studio secara real-time.
- **Deteksi Cerdas 3 Status Bahaya:**
  1. **Mic Mati / Hening Total (`BAHAYA_MIC_MATI`):** Mendeteksi jika ruangan hening melebihi batas waktu toleransi (*Dead Mic Timeout*).
  2. **Suara Pecah (`BAHAYA_AUDIO_PECAH`):** Mendeteksi jika level audio (dB) menabrak batas atas (*Clipping*) dalam durasi tertentu.
  3. **Bocor Tanpa Suara / OBS Mute (`BAHAYA_OBS_MUTE`):** Mendeteksi jika host berbicara di mikrofon namun jalur audio di OBS dalam status Mute.
- **Fitur Auto-Recovery (Auto-Unmute OBS):** Fitur otomatis untuk membuka Mute pada OBS secara mandiri seketika saat host mulai berbicara, mencegah status bahaya tanpa memerlukan intervensi manual operator.

### 2. Integrasi AI Speech-to-Text (Whisper AI) & Analisis Kata Kunci
- **Transkripsi Otomatis Audio:** Mengubah rekaman percakapan audio host ke dalam bentuk teks secara otomatis melalui integrasi OpenAI Whisper API maupun server lokal Whisper.
- **Deteksi Kata Kunci Bahaya (*Keyword Alerting*):** Memindai percakapan secara otomatis terhadap daftar kata-kata sensitif / terlarang yang dapat dikonfigurasi melalui Dashboard.
- **Pencarian Transkrip Multi-PC:** Fitur pencarian kata kunci di seluruh transkrip rekaman yang tersimpan, dilengkapi filter tanggal (*Start/End Date*) dan filter nama PC.
- **Sinkronisasi Timestamp & Audio Player:** Mengklik baris teks transkrip akan otomatis mengarahkan (*seek*) pemutar audio ke detik yang tepat pada rekaman.

### 3. Manajemen File Rekaman & Pemutar Audio Cerdas
- **Perekaman Otomatis Sesi Siaran (*Auto-Record*):** Perekaman audio host sinkron otomatis saat OBS Streaming/Recording aktif. Audio dipotong otomatis setiap 10 menit (*rollover chunk*) dan diunggah langsung ke Central Server.
- **Unified Continuous Audio Player:** Pemutar audio terintegrasi yang mampu memutar seluruh potongan part rekaman dalam satu timeline linier tanpa jeda, dilengkapi kontrol kecepatan pemutaran (1x, 1.25x, 1.5x, 2x), seek antar-part, dan perbaikan otomatis WebM EBML header.
- **Pengorganisasian & Paginasi per PC:**
  - Tampilan accordion per PC yang dapat dilipat/dibuka (*collapsible*) dengan badge ringkasan sesi, total part, kapasitas file, status transkrip, dan tingkat bahaya.
  - Paginasi independen per PC (`5 / 10 / 25 / Semua`).
  - **Mode Tampilan Ganda:** Mode **Detail** (kartu lengkap dengan cuplikan transkrip dan part chips) dan Mode **Ringkas** (tampilan satu baris yang hemat tempat).
  - Tampilan UUID PC utuh tanpa pemotongan karakter.

### 4. Pusat Pembaruan Aplikasi (Server & Agent Hub)
- **Pembaruan Mandiri Server (*1-Click Server Self-Update*):**
  - Pemeriksaan dan instalasi otomatis pembaruan Server langsung dari GitHub Release.
  - Opsi upload file installer Server (`.exe`) dari browser untuk pembaruan mandiri di latar belakang.
- **Distribusi Pembaruan Agent via Jaringan Lokal (LAN):**
  - Unduh paket installer Agent dari GitHub atau upload manual ke Server.
  - Tombol **"Sebarkan ke Seluruh PC Agent"** untuk memicu pembaruan dan *silent install* serentak ke seluruh PC klien di jaringan lokal tanpa perlu mendatangi PC satu per satu.

### 5. Notifikasi Telegram & Doomsday Protocol
- **Peringatan Instan Terpusat (Anti-Spam):** Mengirimkan notifikasi darurat instan ke grup/chat Telegram saat terjadi insiden bahaya, lengkap dengan pengaturan interval pengingat.
- **Doomsday Protocol (Offline Fallback):** Jika Central Server offline atau mengalami gangguan, setiap PC Agent secara mandiri mengambil alih pengiriman notifikasi Telegram darurat menggunakan koneksi internet masing-masing.

### 6. Pengaturan Fleksibel & Keamanan
- **Anchor Navigation Pills:** Navigasi cepat antar-bagian pengaturan pada halaman Settings.
- **Ringkasan Status Sistem:** Kartu ringkasan live yang menampilkan versi sistem, status koneksi PC, status bot Telegram, AI Whisper, dan kapasitas retensi log.
- **Masking Token Telegram:** Input token bot disamarkan secara default dengan tombol toggle *show/hide* (ikon mata).
- **Tag/Chip Interaktif Kata Kunci Whisper:** Menambah dan menghapus kata kunci sensitif semudah mengklik tombol chip.
- **Perlindungan Zona Bahaya (*Danger Zone*):** Tombol pembersihan seluruh log insiden dikunci sampai operator mengetik kata konfirmasi `HAPUS`.

---

## Arsitektur Sistem

Proyek ini menggunakan arsitektur Monorepo (NPM Workspaces) yang terdiri dari 3 paket:

```
audiomonitor/
├── packages/
│   ├── server/           # Central Server, REST API, WebSocket Hub, Whisper STT & Update Hub
│   │   ├── dashboard-dist/ # Bundle produksi Web Dashboard
│   │   └── src/          # ServerApp.js, TranscriptionManager.js, TelemetryHub.js, etc.
│   ├── dashboard/        # Frontend Web Dashboard (React + Vite)
│   │   └── src/          # App.jsx, DashboardClient.js, style.css
│   └── agent/            # Desktop Client Agent (Electron + React)
│       ├── electron/     # main.js (System Tray, Audio Capture, Auto-Update)
│       └── src/          # AudioProcessor.js, OBSClient.js, TelemetryClient.js
└── tests/
    └── whitebox.test.js  # 30 Test Suites / 305 Automated Tests (100% Pass)
```

---

## Persyaratan Sistem

- **Sistem Operasi:** Windows 10 / Windows 11 (64-bit).
- **Node.js:** Versi 18.0.0 atau lebih baru.
- **OBS Studio:** Versi 28 ke atas (WebSocket Server bawaan aktif).
- **Jaringan:** Terhubung dalam satu jaringan lokal (LAN/Wi-Fi yang sama) antara Central Server dan seluruh PC Agent.

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
npm run start:server
```
Server akan berjalan di port `4000`. Akses Web Dashboard melalui browser:
```
http://localhost:4000
```
PIN keamanan default: `1234`.

### 3. Menjalankan Web Dashboard (Mode Dev Vite)
```bash
npm run start:dashboard
```
Dashboard dev server akan berjalan di `http://localhost:5173`.

### 4. Menjalankan Client Agent (Mode Dev Electron)
```bash
npm run start:agent
```

---

## Build & Distribusi Produksi

### 1. Build Bundle Web Dashboard
```bash
npm run build --workspace=packages/dashboard
```
Salin folder `dist` ke `packages/server/dashboard-dist` agar disajikan langsung oleh server.

### 2. Build Server Installer Windows (`.exe`)
```bash
npm run build --workspace=packages/server
```
File installer akan dibuat di folder:
`packages/server/out/AudioMonitor_Server_Installer_v1.0.3.exe`

### 3. Build Agent Installer Windows (`.exe`)
```bash
npm run build --workspace=packages/agent
```
File installer akan dibuat di folder:
`packages/agent/out/AudioMonitor_Agent_Installer_v1.0.3.exe`

---

## Pengujian Otomatis (Automated Testing)

Proyek ini dilengkapi dengan suite pengujian otomatis *whitebox & integration test* menyeluruh:

```bash
npm test
```

### Cakupan 30 Test Suites (305 Tests / 100% PASS):
- **Database JSON & Konfigurasi:** Atomic save, auto-cleanup retensi log, migrasi schema.
- **Autentikasi PIN & Keamanan Input:** Validasi PIN, penolakan brute-force, otorisasi per-endpoint.
- **Streaming Audio, WebM Repair & Media:** Range HTTP 206, perbaikan EBML duration header.
- **State Machine Audio Agent & OBS Sync:** Deteksi clipping, dead mic, OBS mute, dan recovery decay.
- **Socket.io Telemetry & Multi-PC:** Manajemen koneksi socket, broadcast per-room, zero memory leak.
- **Whisper Speech-to-Text & Filter Search:** Mock transcription, sanitasi keyword scanner, combinatorics filter tanggal & PC.
- **Pusat Pembaruan Terpusat (Update Hub):** Validasi rilis GitHub, silent install execution, upload installer.
- **Uji Ketahanan & Concurrency Benchmark:** 20 concurrent queries, failover recovery, fuzzing & sanitasi path traversal.

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
2. Buka Web Dashboard di tab **Settings** pada bagian **Pusat Pembaruan Aplikasi**.
3. Pilih salah satu metode penyediaan file installer:
   - Klik **Cek Rilis GitHub** lalu klik **Unduh Installer ke Server**, atau
   - Klik **Upload File Installer Agent Manual** dan pilih file `.exe` yang baru dibuat.
4. Klik **Sebarkan ke Seluruh PC Agent** (atau tombol update per PC pada kartu agent).
5. Seluruh PC Agent akan mengunduh file secara lokal via HTTP LAN dan mengeksekusi instalasi otomatis tanpa memunculkan jendela wizard.

---

## Lisensi

Didistribusikan di bawah lisensi FOSS (Free and Open Source Software).
