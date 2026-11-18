# Knovites — Spesifikasi Onboarding, Penyimpanan Lokal, Sync, Konflik, Export (§6.1, §6.10-§6.13)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file. Format: **ID (prioritas)** deskripsi. Format data: `data-format.md`.*

**Catatan verifikasi:** detail endpoint GitHub API di file ini ditulis dari pengetahuan yang belum diverifikasi. Spike S1 (`plan.md`) menguji semuanya terhadap repo sungguhan. Jika hasil spike berbeda dari file ini, hasil spike menang dan file ini diperbarui.

### 6.1 Onboarding dan koneksi (FR-ONB)

- **FR-ONB-01 (P0)** Saat pertama dibuka (belum ada koneksi dan data lokal), tampilkan layar sambutan dengan dua pilihan: **Connect GitHub** dan **Try locally** (data demo).
- **FR-ONB-02 (P0)** Form koneksi: repo (`owner/nama` atau URL), branch (default: branch default repo), token. Sertakan petunjuk singkat membuat fine-grained token: hanya satu repo, Contents read/write.
- **FR-ONB-03 (P0)** Validasi sebelum menyimpan: `GET /repos/{owner}/{repo}` harus sukses dan izin push harus true. Pesan error spesifik untuk: token salah atau kedaluwarsa (401), repo tidak ditemukan atau token tanpa akses (404), tidak ada izin tulis, branch tidak ada.
- **FR-ONB-04 (P0)** Repo kosong (belum ada commit): Git Data API tidak bisa dipakai pada repo tanpa ref, jadi buat commit pertama berisi `knovites.json` lewat Contents API (`PUT /contents/knovites.json`), lalu lanjut normal.
- **FR-ONB-05 (P0)** Repo berisi file tetapi tanpa `knovites.json`: tampilkan konfirmasi **Initialize here** (file lama tidak disentuh) atau batal. Repo dengan `knovites.json`: langsung initial pull.
- **FR-ONB-06 (P0)** Token disimpan di IndexedDB, tidak pernah di URL, `localStorage`, atau log. Tombol **Disconnect** menghapus token (dengan opsi menghapus data lokal juga).
- **FR-ONB-07 (P0)** Mode demo: muat dataset demo (sekitar 40 node PWN/RE/CRYPTO, dibuat dari generator) ke database lokal dengan flag `demo`. Saat kemudian menyambungkan GitHub, tawarkan membuang data demo.
- **FR-ONB-08 (P0)** Initial pull menampilkan progress (n/total file), bisa dibatalkan, dan bisa dilanjutkan (cache per blob SHA).
- **Acceptance:** tes e2e dengan fake GitHub (`testing.md` §9.3) lulus untuk: repo kosong, inisialisasi, node pertama muncul di repo; repo berisi data, muncul di peta; token salah, pesan error yang benar.

### 6.10 Persistensi lokal (FR-LOC)

- **FR-LOC-01 (P0)** Setiap perubahan ditulis ke IndexedDB sebelum dianggap tersimpan lokal.
- **FR-LOC-02 (P0)** Reload memulihkan rute, tema, mode layout, dan perubahan yang belum tersinkron (tetap berstatus dirty).
- **FR-LOC-03 (P0)** Skema Dexie berversi dengan migrasi yang dites.
- **FR-LOC-04 (P0)** IndexedDB tidak tersedia atau kuota habis: tampilkan banner pemblokir dan jangan membuang edit diam-diam. Panggil `navigator.storage.persist()` agar data tidak digusur browser.
- **FR-LOC-05 (P0)** Multi-tab: pakai Web Locks API untuk memilih satu tab penulis. Tab lain berstatus baca saja dengan banner dan tombol **Take over**.

### 6.11 Sinkronisasi GitHub (FR-SYNC)

Istilah: `base` = SHA commit terakhir yang berhasil disinkronkan. `HEAD` = SHA ujung branch di remote saat ini.

- **FR-SYNC-01 (P0) Status:** `local-only`, `saved-locally` (ada perubahan belum di-push), `syncing`, `synced`, `offline`, `error`, `conflict`. Indikator di bar atas dengan tooltip (waktu sync terakhir, jumlah file pending). Klik membuka panel sync: daftar file pending, log (100 entri), error, tombol **Sync now** dan **Pull only**.
- **FR-SYNC-02 (P0) Initial pull.** Ambil ref `heads/<branch>`, lalu commit, lalu `GET git/trees/<sha>?recursive=1`. Jika respons `truncated`, telusuri per direktori tanpa recursive. Tentukan node (folder berisi `node.json`). Ambil semua `node.json` (konkurensi 6, retry dengan backoff, hormati header rate limit). `canvas.json` diambil di latar belakang berprioritas rendah dan on-demand saat node dibuka. Aset hanya on-demand. Cache per blob SHA: blob yang SHA-nya sudah ada tidak diunduh ulang. Optimasi batch lewat GraphQL ditunda sampai terbukti perlu.
- **FR-SYNC-03 (P0) Push** (satu siklus = satu commit):
  1. Ambil snapshot changeset dari record dirty dan `pendingDeletes`.
  2. Hitung SHA blob Git secara lokal (SHA-1 atas header `blob <panjang>`, byte nol, lalu isi file). Lewati file yang SHA-nya sudah sama dengan yang ada di repo.
  3. Buat blob untuk file baru atau berubah (JSON sebagai utf-8, aset sebagai base64), konkurensi 4.
  4. Ambil ref terbaru. Jika SHA tidak sama dengan `base`: lakukan pull-merge (FR-SYNC-05) lebih dulu, lalu ulangi dari langkah 1.
  5. Buat tree dengan `base_tree` = tree dari `base`. Entri berbentuk `path`, `mode` 100644, `type` blob, `sha`. Penghapusan memakai `sha: null`. Pemindahan = hapus path lama + path baru yang merujuk blob SHA yang sama.
  6. Buat commit dengan `parents: [base]`. Pesan otomatis: baris pertama maksimal 72 karakter (contoh: `knovites: update ret2win, add 2 images`), badan berisi daftar path (maksimal 20).
  7. Update ref dengan `force: false`. Jika ditolak karena bukan fast-forward (422 atau 409): kembali ke pull-merge, maksimal 3 percobaan, lalu status `error`.
  8. Sukses: `base` = commit baru. Flag dirty hanya dibersihkan untuk file yang tidak berubah sejak snapshot, sehingga edit yang masuk saat push tetap dirty.
- **FR-SYNC-04 (P0) Pemicu.** Otomatis setelah 30 detik tanpa edit (dapat diatur 10 detik sampai 5 menit, atau dimatikan), `Ctrl/Cmd+S`, event `online`, dan upaya terbaik saat tab disembunyikan. Hanya satu sync berjalan sekaligus, dan semua perubahan dalam satu siklus masuk satu commit.
- **FR-SYNC-05 (P0) Pull-merge.** Bandingkan tree `base` dengan tree remote untuk mendapat path yang berubah di remote. Per path: remote berubah dan lokal bersih, ambil remote; lokal berubah dan remote tidak, pertahankan lokal; keduanya berubah, jalankan three-way merge (§6.12, isi base diambil ulang lewat blob SHA). Hasil merge tanpa konflik diterapkan otomatis dan dicatat di log. Setelah selesai `base` = HEAD remote. Jika hasil berbeda dari remote, record tetap dirty dan siap di-push.
- **FR-SYNC-06 (P0) Error.** 401 atau 403 pada token: hentikan auto-sync dan minta token baru. 404: repo atau branch hilang. 5xx dan masalah jaringan: backoff eksponensial dengan jitter (mulai 2 detik, maksimal 5 menit). Rate limit (`x-ratelimit-remaining: 0` atau `Retry-After`): tunggu sampai reset dan tampilkan di UI. Data lokal tidak pernah hilang karena error.
- **FR-SYNC-07 (P0) Penjaga ukuran.** File di atas 25 MB memunculkan peringatan. File di atas 90 MB diblokir: file itu ditandai di panel sync dengan pesan jelas, sementara file lain tetap dikirim.
- **FR-SYNC-08 (P0) Polling remote.** Saat tab terlihat, cek ref tiap 60 detik dengan ETag (`If-None-Match`, respons 304 tidak menghabiskan rate limit) dan juga saat tab kembali aktif. Jika ada perubahan, jalankan pull-merge otomatis (bila tidak konflik) dan tampilkan toast.
- **FR-SYNC-09 (P0)** File tidak valid dari remote (misalnya diedit manual di GitHub): node ditandai `corrupt` dan tidak pernah ditimpa (`data-format.md` §5.7).
- **FR-SYNC-10 (P1) Riwayat.** Daftar 30 commit terakhir yang menyentuh folder node (`GET commits?path=`) dengan tautan ke GitHub.
- **FR-SYNC-11 (P1)** Branch protected: pesan jelas bila update ref ditolak aturan branch.
- **FR-SYNC-12 (P2)** Pulihkan versi lama sebuah node dari riwayat.
- **Larangan:** force push tidak pernah dipakai. Tidak ada operasi yang menghapus branch atau menulis ulang history.

### 6.12 Konflik dan merge (FR-CNF)

Three-way merge atas `base`, `local`, `remote`. Dua nilai dianggap sama bila deep-equal dengan mengabaikan `updatedAt`.

**canvas.json, per elemen** (gabungan ID dari ketiga versi):

- Sama di local dan remote: ambil.
- Berubah hanya di satu sisi dibanding base: ambil sisi itu.
- Ditambah hanya di satu sisi: tambahkan.
- Dihapus di satu sisi dan tidak berubah di sisi lain: hapus.
- Dihapus di satu sisi dan diubah di sisi lain: **konflik** (delete vs edit).
- Diubah di kedua sisi: merge per field (`x`, `y`, `w`, `h`, `z`, `style.bg`, `style.border`, `asset`, `alt`, `content`). Field berbeda yang diubah digabung. Field yang sama diubah berbeda: **konflik**. `content` yang berubah di kedua sisi selalu konflik (merge teks tingkat karakter adalah P2).

**node.json, per field:**

- `title`, `type`, `status`, `color`, `order`: diubah berbeda di kedua sisi menjadi konflik.
- `tags`: merge set tiga arah (penambahan dan penghapusan digabung).
- `links`: merge set tiga arah berdasarkan `to`. Label berbeda di kedua sisi menjadi konflik.
- `updatedAt`: nilai terbaru.

Requirement:

- **FR-CNF-01 (P0)** Aturan di atas diimplementasikan di `domain/merge` sebagai fungsi murni dengan tes tabel untuk tiap aturan, plus properti: `merge(b, x, x) = x`, `merge(b, x, b) = x`, `merge(b, b, y) = y`.
- **FR-CNF-02 (P0) UI konflik.** Daftar per node. Tiap konflik menampilkan pratinjau kedua versi (render mini elemen, atau diff field). Pilihan: **Keep mine**, **Keep GitHub's**, **Keep both** (untuk elemen: duplikat dengan penanda konflik dan offset, tidak berlaku untuk field node), dan **Apply to all**. Selama ada konflik belum selesai, status `conflict` dan push ditahan, sedangkan editing lokal tetap boleh. Hasil merge sementara disimpan di `syncState.pendingMerge` agar tahan reload.
- **FR-CNF-03 (P0)** Tidak ada penyelesaian otomatis yang bersifat merusak. Merge tanpa konflik tetap dicatat di log.
- **FR-CNF-04 (P0) Konflik struktural:**
  - Node dihapus di remote tetapi diubah lokal: pertahankan versi lokal (hidupkan kembali) dan catat di log.
  - Node diubah di remote tetapi dihapus lokal: dialog **Keep** atau **Delete**.
  - Node yang sama dipindah ke parent berbeda di kedua sisi: dialog memilih lokasi.
  - Dua node berbeda berakhir di path yang sama (dibuat bersamaan): slug node lokal diberi sufiks otomatis, data tidak berubah, dicatat di log.
  - ID duplikat: aturan `data-format.md` §5.3.
- **FR-CNF-05 (P0)** Setiap aturan di atas punya fixture dan tes: unit untuk merge, integrasi dengan fake GitHub untuk alur push ditolak, lalu merge, lalu push ulang.

### 6.13 Export dan import (FR-EXP)

- **FR-EXP-01 (P0)** Export seluruh knowledge base sebagai `.zip` dengan struktur identik repo (fflate atau JSZip).
- **FR-EXP-02 (P1)** Import zip ke database lokal kosong (mode local-only).
- **FR-EXP-03 (P1)** Export subtree satu node.
- **FR-EXP-04 (P2)** Export ke Markdown, PDF, atau PNG.
