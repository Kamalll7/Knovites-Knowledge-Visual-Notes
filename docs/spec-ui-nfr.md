# Knovites — Settings, Non-Fungsional, UI/UX (§6.14, §7, §8)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file.*

### 6.14 Settings dan shell (FR-SET)

- **FR-SET-01 (P0)** Tema: system, dark, light. Default dark.
- **FR-SET-02 (P0)** Halaman settings: koneksi (repo, branch, ganti token, disconnect), mode layout default, auto-sync (on atau off, interval), pemakaian storage, dan **Reset local data** (zona bahaya, konfirmasi dengan mengetik nama repo).
- **FR-SET-03 (P0)** Dialog pintasan keyboard (`?`).
- **FR-SET-04 (P0)** Error boundary per rute, sistem toast, dan log error lokal (100 entri, dapat dilihat dan disalin dari settings). Tidak ada telemetri eksternal.

## 7. Persyaratan non-fungsional

### 7.1 Kompatibilitas dan performa

- Chrome, Edge, Firefox, dan Safari desktop, dua versi stabil terakhir. Mobile: tampilan baca adalah P1, edit tidak didukung.
- Bundle awal maksimal 600 KB gzip. Chunk halaman node (React Flow dan TipTap) maksimal 500 KB gzip dan dimuat lazy per rute. Interaktif di bawah 3 detik di broadband. Operasi lokal terasa di bawah 100 ms.

### 7.2 Keandalan: invarian tidak ada data hilang

1. Edit ditulis ke IndexedDB sebelum sync.
2. Push tidak pernah memakai force.
3. Data lokal yang dirty tidak pernah ditimpa oleh pull tanpa merge.
4. File remote yang tidak valid atau tidak dikenal tidak pernah ditimpa atau dihapus.
5. Penghapusan bisa dibatalkan 10 detik secara lokal dan selalu terekam di riwayat Git.

### 7.3 Keamanan

- Token hanya di IndexedDB. Tidak pernah di log, URL, atau pesan error. UI dan README memberi peringatan jelas bahwa token berada di browser: pakai fine-grained token satu repo dan jangan dipakai di perangkat bersama.
- Content Security Policy lewat meta tag: `default-src 'self'`, `connect-src 'self' https://api.github.com`, `img-src 'self' blob: data:`, tanpa `unsafe-eval`. Inline style hanya jika memang diperlukan.
- ESLint melarang `dangerouslySetInnerHTML` dan `innerHTML`.
- Isi repo diperlakukan sebagai data tak tepercaya: validasi Zod dan whitelist di setiap load.
- `pnpm audit` di CI, lockfile di-commit, dan jangan jalankan postinstall script yang tidak perlu.

### 7.4 Aksesibilitas, observabilitas, privasi

- Semua fitur utama dapat dioperasikan dengan keyboard, ring fokus terlihat, kontras teks memenuhi WCAG AA, `prefers-reduced-motion` dihormati, status tidak hanya lewat warna, kontrol ikon punya label ARIA.
- Logger terstruktur (debug, info, warn, error) ke console dan log lokal. Token dan isi catatan tidak pernah dicatat.
- Tanpa analitik atau telemetri. Satu-satunya host eksternal adalah `api.github.com`.

## 8. Spesifikasi UI dan UX

### 8.1 Arah desain

Dark-first, tenang, dengan aksen bercahaya (glow) yang dipakai hemat. Banyak ruang kosong, tipografi bersih (Inter), sudut membulat, kontras jelas. Peta adalah bintang utamanya, jadi UI di sekelilingnya harus minimal dan tidak bersaing. Semua nilai visual berasal dari design tokens (CSS variables), bukan angka yang tersebar di komponen.

**Token [OPEN, nilai awal boleh disetel selama kontras WCAG AA terpenuhi]:**

- Spasi: skala 4 px. Radius: 8, 12, 16 px.
- Durasi motion: 150 ms (mikro), 250 ms (UI), 500 ms (peta). Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Warna dasar dark: `--bg #0B0E14`, `--surface #11151D`, `--surface-2 #171C27`, `--border #232A38`, `--fg #E6E9F0`, `--fg-muted #8A93A6`, `--accent #7C9CFF`.
- Status: `learning` amber `#FBBF24`, `practiced` biru `#60A5FA`, `mastered` hijau `#34D399`.
- Palet cabang (8-12 hue, tiap hue punya 3 tingkat kecerahan untuk kedalaman): mulai dari `#7C9CFF`, `#5EEAD4`, `#F9A8D4`, `#FBBF24`, `#A78BFA`, `#34D399`, `#FB7185`, `#38BDF8`.
- Tema light disediakan dengan token yang sama (nilai berbeda).

### 8.2 Wireframe

Peta (`#/`):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Root / PWN / Stack     [ Search  Ctrl+K ]  [Radial | Tree]  ● Synced │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│             RE · 12                        ROP Chain                 │
│                ╲                          ╱                          │
│    CRYPTO · 8 ── ( ROOT ) ── PWN ── Stack ── (Buffer Overflow)       │
│                ╱                          ╲                          │
│           MISC · 5                         Format String             │
│                                                                      │
│   [Open] [+ Child] [Rename] [Status] [...]            [ - + fit ]    │
└──────────────────────────────────────────────────────────────────────┘
```

Halaman node (`#/n/:id`):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Root / PWN / Buffer Overflow / ret2win      [Search]    ● Synced     │
│ ret2win   [technique v] [practiced v]  #pwn #stack  [+tag]  [panel]  │
├──────────────────────────────────────────────────────┬───────────────┤
│  [Select] [Hand] [Text] [Image]          zoom 100%   │ Links         │
│                                                      │ Children      │
│     ┌───────────────┐      ┌──────────────┐          │ Info          │
│     │ Return to win │      │  (gambar)    │          │ ───────────── │
│     │ teks ...      │      │              │          │ Backlinks (3) │
│     └───────────────┘      └──────────────┘          │ ROP Chain     │
│                                                      │ + Add link    │
└──────────────────────────────────────────────────────┴───────────────┘
```

Dialog konflik:

```
┌──────────────────────────────────────────────────────┐
│ Sync conflict in ret2win (1 of 2)                    │
│ ┌──────────── Mine ──────────┐ ┌──── GitHub's ─────┐ │
│ │ pratinjau elemen / field   │ │ pratinjau         │ │
│ └────────────────────────────┘ └───────────────────┘ │
│ [Keep mine] [Keep GitHub's] [Keep both]  [Apply to all]│
└──────────────────────────────────────────────────────┘
```

### 8.3 Mikro-interaksi

- Hover node peta: membesar sedikit, label penuh muncul.
- Fokus baru: transisi kamera dan layout (FR-MAP-05), jalur root ke fokus menyala.
- Pencarian: hasil dipilih, kamera terbang ke node dan jalur menyala.
- Sync sukses: indikator berdenyut sekali. Error: indikator berubah merah dengan tooltip penyebab.
- Memuat: skeleton, bukan spinner penuh layar.
- Hapus: toast dengan tombol Undo dan hitung mundur.
- Semua animasi dimatikan atau dipersingkat bila `prefers-reduced-motion`.

### 8.4 Teks UI

Bahasa Inggris, singkat, kalimat aktif. Pesan error menjelaskan apa yang terjadi dan langkah berikutnya (contoh: `GitHub rejected the token. Update it in Settings > Connection.`). Tidak ada istilah teknis Git di UI utama kecuali di panel sync.
