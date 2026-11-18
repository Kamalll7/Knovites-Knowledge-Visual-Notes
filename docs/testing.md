# Knovites — Strategi Pengujian (§9)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file.*

## 9. Strategi pengujian

### 9.1 Prinsip

Agent tidak bisa menilai hasil hanya dari membaca kode, jadi setiap perilaku penting harus bisa diverifikasi mesin. Logika kompleks (layout, merge, operasi pohon, serialisasi, perencana sync) ditaruh di `domain/` supaya bisa diuji unit dan properti tanpa browser.

### 9.2 Unit dan properti (Vitest, fast-check)

- **Skema:** validasi menerima dan menolak sesuai batas; sanitizer membuang node dan mark di luar whitelist.
- **Serialisasi:** `serialize(parse(serialize(x))) === serialize(x)`; urutan key deterministik.
- **Pohon:** slugify dan bentrok slug; order fractional (sisip di antara, stabil); move tidak pernah membuat siklus; delete dan create menghasilkan changeset benar; perbaikan ID duplikat.
- **Visibilitas:** fokus dan jalur selalu terlihat; konservasi jumlah (terlihat + tersembunyi = total); deterministik.
- **Layout:** tidak ada tumpang tindih; deterministik; urutan sibling terjaga; anak di dalam irisan induk. Diuji pada ribuan pohon acak dan dataset ekstrem.
- **Merge:** tabel tes untuk setiap aturan `spec-storage-sync.md` §6.12 dan properti identitas (`merge(b, x, x) = x`, dst).
- **Sync planner:** changeset dari record dirty; hitung SHA blob cocok dengan vektor uji Git yang diketahui.
- **Pencarian:** flatten teks dari JSON TipTap; boost dan fuzzy.

### 9.3 Fake GitHub (msw)

Dibangun di `src/testing/fake-github` dan dipakai tes integrasi serta e2e. Berupa penyimpanan in-memory berperilaku seperti Git: blob, tree, commit, ref dengan SHA benar. Endpoint: get repo, get ref, update ref (menolak non-fast-forward), get dan create commit, get tree (rekursif, dengan opsi `truncated`), get dan create tree (mendukung `base_tree` dan `sha: null`), get dan create blob, put contents (inisialisasi repo kosong), list commits per path.

Perilaku fake harus **disesuaikan dengan temuan spike S1** (`plan.md`), bukan dengan asumsi. Jika spike menunjukkan perilaku API yang berbeda, fake diperbarui mengikutinya.

Fault injection yang wajib tersedia: push konkuren (ref maju di antara dua langkah push), rate limit (403/429 dengan header), 5xx sementara, 401, tree terpotong, latensi acak.

### 9.4 Alur e2e (Playwright, Chromium; CI mingguan juga Firefox)

- **E1** Mode demo: peta tampil, fokus dan buka halaman node.
- **E2** Buat hierarki 3 level, rename, move, reorder, delete + undo, lalu reload dan data tetap ada.
- **E3** Kanvas: buat teks, format (font, ukuran, warna, kode), paste gambar (clipboard disimulasikan), drag, resize, reload dan tata letak identik.
- **E4** Mode edit versus drag: mengetik dan memilih teks tidak menggeser kotak; gagang drag memindahkan.
- **E5** Pencarian: temukan node dari isi teks, `Enter` di peta dan di halaman.
- **E6** Link silang, backlink, dan broken link setelah delete.
- **E7** Sync push: perubahan menghasilkan satu commit dengan isi file yang benar di fake GitHub.
- **E8** Pull: perubahan remote muncul di UI tanpa reload.
- **E9** Konflik: elemen sama diedit di kedua sisi, dialog muncul, **Keep both** menghasilkan dua elemen.
- **E10** Offline: edit saat offline, kembali online, sync otomatis.
- **E11** Dua tab: tab kedua baca saja, **Take over** berfungsi.
- **E12** Export zip: struktur dan isi sama dengan yang di fake repo.

### 9.5 Visual dan performa

- Playwright mengambil screenshot peta untuk tiap dataset (`spec-map.md`) dan halaman node dengan kanvas contoh. Agent wajib **melihat** screenshot itu dan memperbaiki masalah yang tampak (tumpang tindih, label terpotong, kontras) sebelum menutup task UI.
- Skrip performa mengukur frame time saat pan, zoom, dan perpindahan fokus pada dataset 150 node dan kanvas 300 elemen. Hasil dicatat di `docs/perf.md`. CI gagal jika di bawah 30 fps (ambang kasar, target nyata ada di S1).

### 9.6 CI

GitHub Actions: install dengan lockfile beku, typecheck, lint (termasuk aturan layer), unit, build, cek ukuran bundle, e2e Chromium, `pnpm audit`. Merge hanya jika semuanya hijau.

### 9.7 QA manual dengan repo GitHub sungguhan

Dijalankan di akhir M6 dan M8 memakai repo privat sementara dan fine-grained token:

1. Onboarding ke repo kosong, node pertama muncul sebagai commit.
2. Edit dari dua browser, sync, konflik, selesaikan.
3. Token dicabut atau salah: pesan error jelas, data lokal aman.
4. Edit `node.json` manual di GitHub dengan JSON rusak: node ditandai corrupt dan tidak ditimpa.
5. Repo dengan lebih dari 200 node: initial pull selesai tanpa kena rate limit.
6. Putus jaringan di tengah push: tidak ada commit setengah jadi, push berikutnya pulih.
