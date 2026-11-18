# Knovites — PRD Phase 1: Ringkasan, Keputusan, Arsitektur

*Knovites (Knowledge Visual Notes) · Knowledge Core · v0.1 · 16 November 2026. Bagian dari PRD yang dipecah; lihat `README.md`. Penomoran § sama di semua file.*

## 0. Cara memakai dokumen ini

Dokumen ini ditulis untuk dua pembaca: pemilik proyek, dan coding agent (opencode, Antigravity, dsb.) yang akan mengimplementasikannya.

- **[LOCKED]** = keputusan final. Agent tidak boleh menggantinya tanpa persetujuan eksplisit pemilik.
- **[OPEN]** = detail yang boleh diputuskan implementer selama acceptance criteria terpenuhi.
- **P0** wajib untuk Phase 1 selesai. **P1** sebaiknya ada. **P2** hanya jika waktu sisa.
- Setiap requirement punya ID (contoh `FR-MAP-03`) untuk dirujuk di commit, test, dan task.
- Kalau ada yang ambigu: pilih opsi paling sederhana yang konsisten dengan prinsip di §1.3, catat di `docs/open-questions.md`, lalu lanjutkan. Jangan menambah fitur di luar dokumen ini.
- Phase 1 **tidak** berisi Lab, terminal, atau eksekusi kode apa pun.

## 1. Ringkasan produk

### 1.1 Visi

Aplikasi web catatan pengetahuan berbentuk pohon visual untuk belajar keamanan siber dan CTF. Setiap node (misalnya PWN → Stack → ret2win) punya halaman kanvas bebas berisi teks berformat dan gambar yang bisa digeser ke mana saja. Seluruh data disimpan di repo GitHub milik pengguna sebagai file biasa. Aplikasi hanyalah klien: kalau aplikasinya hilang, datanya tetap terbaca.

### 1.2 Pengguna dan konteks

- Pengguna tunggal: pemilik proyek, pelajar CTF. Tidak ada akun, multi-user, atau kolaborasi di Phase 1.
- Perangkat utama: browser desktop. Kadang ada perangkat kedua, sehingga sinkronisasi dan konflik harus aman.
- Bahasa UI: English **[LOCKED]**. Semua string UI di satu berkas `src/i18n/en.ts` supaya bisa diterjemahkan nanti. Isi catatan bebas bahasa apa pun.
- Proyek open-source: kode aplikasi publik, data pengetahuan di repo privat milik pengguna.

### 1.3 Prinsip desain (dipakai untuk memutuskan hal yang ambigu)

1. **Data milik pengguna.** Semua tersimpan di file terbuka di Git, tanpa lock-in.
2. **Layout diturunkan, bukan disimpan.** Posisi node di peta dihitung dari struktur pohon.
3. **Satu jenis objek: node.** Tidak ada konsep board atau paper terpisah.
4. **Local-first.** UI tidak pernah menunggu jaringan. Sinkronisasi terjadi di belakang layar.
5. **Mencatat harus cepat.** Visual boleh memukau, tetapi tidak boleh menghalangi pekerjaan mencatat.
6. **Sederhana dulu.** Pilih solusi paling sederhana yang memenuhi acceptance criteria.

## 2. Tujuan, non-tujuan, dan kriteria sukses

### 2.1 Tujuan Phase 1

- **G1.** Peta pohon yang indah dan dinamis, tetap nyaman dipakai saat node banyak atau tidak seimbang.
- **G2.** Setiap node punya kanvas bebas: teks berformat (font, ukuran, warna, dll.) dan gambar yang di-paste lalu di-drag bebas.
- **G3.** Penyimpanan di repo GitHub (satu node = satu folder), otomatis dan aman, dengan penanganan konflik.
- **G4.** Pencarian cepat, link silang antar-node, dan backlink.
- **G5.** Berjalan tanpa backend: situs statis yang bicara langsung ke GitHub API.

### 2.2 Non-goals (jangan dikerjakan di Phase 1)

- Lab, terminal, compile atau run kode, sandbox, container.
- Backend, database server, akun pengguna, login selain token GitHub.
- Kolaborasi real-time atau multi-user.
- Fitur AI di dalam aplikasi.
- Editing di mobile (tampilan baca boleh, P1).
- Shape, panah atau konektor, gambar tangan bebas di kanvas (P2, lihat backlog di `appendix.md`).
- Graph view penuh, mastery checklist, export Markdown atau PDF.

### 2.3 Kriteria sukses (terukur)

- **S1.** Dataset uji 150 node tidak seimbang: pan, zoom, dan perpindahan fokus pada peta berjalan ≥ 55 fps di laptop kelas menengah.
- **S2.** Round-trip serialisasi (parse lalu serialize) menghasilkan byte identik untuk semua fixture.
- **S3.** Edit di perangkat A, sync, lalu buka di perangkat B menghasilkan data identik. Semua skenario konflik di §6.12 lulus tanpa kehilangan data.
- **S4.** Dari nol sampai catatan pertama tersimpan di GitHub dalam kurang dari 3 menit (onboarding).
- **S5.** Pemilik berhasil mencatat satu materi nyata (misalnya ret2win) tanpa perlu kembali ke aplikasi catatan lain.

## 3. Keputusan teknis [LOCKED]

Pakai versi stabil terbaru saat inisialisasi, kunci dengan lockfile, dan jangan naik major version selama Phase 1. Dependency baru di luar daftar ini butuh catatan keputusan (`docs/decisions/NNNN-judul.md`).

**Catatan verifikasi:** nama library, versi, dan detail API di seluruh PRD belum diverifikasi terhadap dokumentasi terbaru. Ikuti aturan verifikasi dokumentasi di `AGENTS.md`: dokumentasi resmi menang atas PRD, dan perbedaannya dicatat.

- **Runtime dan build:** Vite + React + TypeScript (`strict`), pnpm. Situs statis tanpa backend.
- **Routing:** React Router `HashRouter`. Rute: `#/` (peta), `#/n/<nodeId>` (halaman node), `#/settings`. Alasan: hosting statis tanpa konfigurasi fallback. URL node memakai ID, bukan path.
- **State:** Zustand + immer. **Database lokal:** Dexie (IndexedDB). **Validasi:** Zod.
- **Peta pohon:** React (SVG) + `d3-hierarchy`, `d3-zoom`, `d3-shape`, `d3-interpolate`, `d3-ease`. React Flow **tidak** dipakai untuk peta.
- **Kanvas node:** `@xyflow/react` (React Flow) dengan custom node `text` dan `image`, tanpa edge. Alasan: pan, zoom, drag, resize, seleksi, dan minimap sudah tersedia, dan node berupa HTML biasa. tldraw tidak dipakai karena pertimbangan lisensi.
- **Editor teks:** TipTap (ProseMirror), hanya ekstensi open-source (MIT). Dilarang memakai ekstensi TipTap berbayar atau Pro.
- **Pencarian:** MiniSearch. **ID:** `ulid` (node), `nanoid` (elemen). **Urutan:** `fractional-indexing`.
- **GitHub:** Octokit langsung dari browser, memakai fine-grained PAT untuk satu repo (Contents: read/write, Metadata: read). Tanpa OAuth app dan tanpa proxy di Phase 1.
- **UI:** Tailwind CSS, shadcn/ui (Radix), lucide-react, Framer Motion untuk UI non-peta. Animasi peta memakai d3 atau `requestAnimationFrame` sendiri.
- **Font:** self-hosted lewat `@fontsource` (Inter, Lora, JetBrains Mono, Caveat, dan 1-2 lainnya). Tidak ada request ke CDN font.
- **Pengujian:** Vitest, Testing Library, Playwright, msw, fast-check.
- **Kualitas:** ESLint, Prettier, `tsc --noEmit`. Dilarang memakai `any` tanpa komentar alasan.
- **Hosting:** statis (GitHub Pages atau Cloudflare Pages).

## 4. Arsitektur

### 4.1 Struktur direktori

```
knovites/
├── AGENTS.md
├── docs/                  # PRD terpecah, decisions/, spikes/, open-questions.md
├── e2e/                   # tes Playwright
├── spikes/                # kode sekali pakai untuk spike, di luar src/ dan build
└── src/
    ├── domain/            # TS murni, tanpa React/DOM/IO
    │   ├── schema/        # Zod, tipe, migrasi
    │   ├── tree/          # build, slug, order, move, delete, validasi
    │   ├── layout/        # computeVisible, radial, horizontal
    │   ├── merge/         # three-way merge node.json dan canvas.json
    │   ├── serialize/     # serialisasi kanonik
    │   └── search/        # flatten teks, bangun index
    ├── storage/           # Dexie dan repository
    ├── sync/              # klien GitHub, planner, pull, push, scheduler
    ├── app/               # store Zustand, router, provider
    ├── features/          # map, page, canvas, onboarding, search, settings, sync-status
    ├── ui/                # komponen bersama dan design tokens
    ├── i18n/
    └── testing/           # fixture, dataset generator, fake GitHub (msw)
```

### 4.2 Aturan layer

- `domain/` adalah TypeScript murni: tanpa React, DOM, IndexedDB, atau network. Semua logika bisnis yang bisa diuji unit ada di sini.
- Dexie hanya dipanggil dari `storage/`. Octokit hanya dari `sync/`.
- `features/*` tidak saling import. Komunikasi lewat store di `app/`.
- Tidak ada request jaringan selain ke `api.github.com`.

### 4.3 Alur data

1. UI action memanggil store action.
2. Store action memanggil fungsi domain murni yang mengembalikan state baru plus **changeset** (daftar file yang berubah).
3. `storage/` menyimpan ke IndexedDB (debounce) dan menandai dirty.
4. Sync engine mengamati dirty set dan menjadwalkan push (§6.11).
5. Perubahan remote: pull, lalu merge (domain), lalu storage, lalu store.

IndexedDB adalah salinan kerja. Repo Git adalah sumber kebenaran jarak jauh. Store Zustand hanyalah cache untuk rendering.
