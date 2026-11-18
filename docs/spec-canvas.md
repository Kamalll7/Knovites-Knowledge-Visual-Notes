# Knovites — Spesifikasi Halaman Node, Kanvas, Teks, Gambar (§6.3-§6.6)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file. Format: **ID (prioritas)** deskripsi. Format data: `data-format.md` §5.4 dan §5.6.*

### 6.3 Halaman node (FR-PAGE)

- **FR-PAGE-01 (P0)** Rute `#/n/:id`. Layout: bar atas (breadcrumb, indikator sync, tombol cari, kembali ke peta); strip header (judul inline-edit, pilihan tipe, pilihan status, chip tag); kanvas memenuhi sisa ruang; panel kanan yang bisa disembunyikan dengan tab **Links** (link keluar dan backlink, tambah link), **Children** (daftar, klik untuk membuka, Add child), **Info** (dibuat dan diubah kapan, ID dengan tombol salin, path folder). Panel tertutup secara default pada lebar di bawah 1280 px.
- **FR-PAGE-02 (P0)** ID tidak ditemukan: halaman 404 dengan tautan ke peta. Node dihapus dari remote saat sedang dibuka: banner dengan opsi menyimpan salinan sebagai node baru atau kembali ke peta.
- **FR-PAGE-03 (P0)** Tombol kembali ke peta: peta memfokuskan node ini.
- **FR-PAGE-04 (P0)** Mengganti judul memperbarui `title` dan `updatedAt`, tanpa mengubah slug atau folder.
- **FR-PAGE-05 (P0)** Kanvas dimuat lazy dari IndexedDB (skeleton selama memuat). Jika belum ada di cache, ambil dari GitHub.
- **FR-PAGE-06 (P0)** Node `corrupt` atau bersekema lebih baru: tampilkan banner dan mode baca saja.

### 6.4 Kanvas node (FR-CVS)

- **FR-CVS-01 (P0) Kanvas tak terbatas** dengan React Flow. Pan: `Space` + drag, drag tombol tengah, atau scroll dua jari di trackpad. Zoom: `Ctrl/Cmd` + roda atau pinch (batas 0.1 sampai 4). Pintasan fit ke seluruh isi. Latar titik-titik (bisa dimatikan).
- **FR-CVS-02 (P0) Alat.** Select (default; drag di area kosong = seleksi kotak), Hand (`H`, pan dengan drag), Text (`T`, klik atau drag area untuk membuat kotak teks), Image (`I`, buka pemilih file). Klik dua kali di area kosong juga membuat kotak teks. Kotak teks baru berlebar 320, langsung fokus dan siap diketik.
- **FR-CVS-03 (P0) Manipulasi elemen.** Seleksi (klik, `Shift`+klik, kotak); pindah (drag; panah = 1 px, `Shift`+panah = 10 px); ubah ukuran lewat handle (teks: lebar saja, tinggi otomatis mengikuti isi; gambar: rasio terkunci, `Shift` = bebas); hapus (`Delete` atau `Backspace` saat tidak sedang mengedit teks); duplikat (`Ctrl/Cmd+D`); salin dan tempel antar-elemen dan antar-node (ID baru, offset 20 px, aset gambar ikut disalin); urutan tumpukan (`]` naik, `[` turun, ke depan atau belakang lewat menu).
- **FR-CVS-04 (P0) Mode edit teks.** Klik dua kali kotak teks = masuk mode edit. `Esc` atau klik di luar = keluar. Selama mengedit, drag dan scroll tidak boleh memindahkan kotak (`nodrag` dan `nowheel` di React Flow). Pemindahan lewat gagang di tepi atas kotak yang muncul saat hover atau terseleksi. Ini sumber bug yang umum, wajib ada tes e2e.
- **FR-CVS-05 (P0) Gaya kotak.** Warna latar dan border (palet, hex bebas, Auto/None). Warna teks default mengikuti tema (`color` kosong = warisan). Warna eksplisit disimpan sebagai hex.
- **FR-CVS-06 (P0) Undo/redo tingkat kanvas** (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) untuk: membuat, menghapus, memindah, mengubah ukuran, gaya, urutan, tempel. Maksimal 100 langkah, tidak dipersist. Saat mengedit teks, pakai riwayat ProseMirror. Saat keluar dari mode edit, seluruh sesi edit dicatat sebagai satu langkah kanvas.
- **FR-CVS-07 (P0) Autosave.** Perubahan apa pun ditulis ke IndexedDB dengan debounce 400 ms. Flush paksa saat blur, `visibilitychange`, dan `pagehide`. Indikator status di bar atas.
- **FR-CVS-08 (P0) Performa.** Kanvas dengan 300 elemen (50 gambar) menjaga 50 fps ke atas saat pan dan zoom: aktifkan `onlyRenderVisibleElements`; elemen teks yang tidak sedang diedit dirender dengan **renderer statis** (FR-TXT-08), bukan instance editor; gambar dimuat lazy; object URL di-cache dan di-revoke.
- **FR-CVS-09 (P1)** Snap ke grid 8 px (toggle). **FR-CVS-10 (P1)** Menu konteks klik kanan pada elemen. **FR-CVS-11 (P1)** Minimap kanvas. **FR-CVS-12 (P1)** Paste teks dari clipboard (HTML) dimasukkan sebagai konten terformat terbatas sesuai whitelist.
- **FR-CVS-13 (P2)** Panah atau konektor, shape, gambar tangan bebas, rotasi, guide perataan pintar.

### 6.5 Penyuntingan teks (FR-TXT)

- **FR-TXT-01 (P0) Toolbar melayang** muncul di atas kotak yang sedang diedit: font (6 pilihan terkurasi: Inter, Lora, JetBrains Mono, Caveat, ditambah dua lagi), ukuran (stepper dan preset 12, 14, 16, 20, 24, 32, 48, 72), warna teks, highlight, bold, italic, underline, strikethrough, kode inline, rata kiri/tengah/kanan, paragraf dan H1-H3, daftar bullet dan bernomor, blockquote, blok kode (dengan pilihan bahasa), tautan, hapus format.
- **FR-TXT-02 (P0) Input rules Markdown:** `#` + spasi jadi heading, `-` + spasi jadi bullet, `1.` + spasi jadi daftar bernomor, tiga backtick jadi blok kode, `**tebal**`, `*miring*`, dan satu backtick untuk kode inline.
- **FR-TXT-03 (P0) Blok kode:** syntax highlighting dengan lowlight untuk `c`, `cpp`, `python`, `bash`, `x86asm`, `javascript`, `json`, `plaintext`; font monospace; tombol salin.
- **FR-TXT-04 (P0) Default:** Inter 16, warna mengikuti tema.
- **FR-TXT-05 (P0)** Jika kotak terseleksi tetapi tidak dalam mode edit, perintah format diterapkan ke seluruh teks di kotak itu.
- **FR-TXT-06 (P0) Keamanan:** href link divalidasi (blokir `javascript:` dan sejenisnya). Konten di luar whitelist `data-format.md` §5.4 dibuang.
- **FR-TXT-07 (P1)** Menu slash (`/`) untuk menyisipkan blok, dan daftar tugas (checklist).
- **FR-TXT-08 (P0) Renderer statis.** Elemen teks yang tidak sedang diedit dirender dari JSON ke elemen React, tanpa `dangerouslySetInnerHTML` dan tanpa instance TipTap. Hanya satu instance editor yang hidup pada satu waktu. Tampilan statis dan mode edit harus identik secara visual (tes screenshot).
- **FR-TXT-09 (P2)** Tabel.

### 6.6 Gambar dan aset (FR-IMG)

- **FR-IMG-01 (P0) Paste.** `Ctrl/Cmd+V` dengan gambar di clipboard saat tidak mengedit teks menghasilkan elemen gambar di posisi kursor (atau tengah viewport). Jika sedang mengedit teks, gambar tetap menjadi **elemen terpisah** di dekat kotak itu (tidak ada gambar inline di dalam teks).
- **FR-IMG-02 (P0) Drag-and-drop file** dari OS (boleh banyak file, disusun bertingkat dari titik drop) dan tombol Image di toolbar.
- **FR-IMG-03 (P0) Pipeline** (di worker atau `OffscreenCanvas` bila tersedia): validasi tipe lewat magic bytes; tolak SVG dan file di atas 25 MB; decode; kecilkan ke sisi terpanjang maksimal 1920 px; encode ke WebP kualitas 0.85 (bila browser tidak bisa meng-encode WebP, pertahankan format asal dengan resize saja); pakai hasil kompresi hanya jika lebih kecil dari aslinya; GIF dipertahankan apa adanya (peringatan bila di atas 10 MB). Hitung hash, simpan Blob di IndexedDB, buat elemen dengan lebar awal `min(nw, 480)` dan rasio terjaga.
- **FR-IMG-04 (P0) Tampilan:** dimuat lazy saat masuk viewport. Jika aset hilang atau gagal diambil, tampilkan placeholder dengan tombol Retry.
- **FR-IMG-05 (P0) Penyimpanan aset:** kunci `[nodeId+path]` di IndexedDB. Saat pull, aset diambil dari GitHub **sesuai kebutuhan**, bukan semuanya sekaligus.
- **FR-IMG-06 (P1)** Teks alternatif (alt), lightbox pratinjau, ganti gambar, pembersihan aset tak terpakai.
- **FR-IMG-07 (P2)** Crop.
