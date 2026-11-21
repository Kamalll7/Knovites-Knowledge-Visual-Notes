# Knovites — Rencana Implementasi untuk Agent (§10)

*Bagian dari PRD Knovites v0.1. Lihat `README.md` untuk file mana yang dibaca per milestone. Penomoran § sama di semua file.*

## 10. Rencana implementasi untuk agent

Aturan eksekusi:

- Kerjakan milestone **berurutan** (M0, M1, M2, spike S1-S3, M3, ... M8). Jangan memulai milestone berikutnya sebelum semua P0 milestone sebelumnya selesai dan CI hijau.
- Satu task = satu branch atau PR kecil, idealnya di bawah sekitar 400 baris diff di luar tes dan fixture. Task yang lebih besar dipecah dulu.
- Tiap task dirujuk dengan ID (`T3.2`) dan requirement (`FR-MAP-03`) di pesan commit.
- **Checkpoint pemilik:** akhir spike S3 (tampilan awal peta), akhir M3 (peta lengkap), akhir M4 (rasa kanvas), akhir M6 (sync pada repo sungguhan). Pemilik menyetujui sebelum lanjut. Pada checkpoint, agent berhenti dan melapor dengan screenshot atau rekaman.
- Ikuti aturan verifikasi dokumentasi di `AGENTS.md`: baca dokumentasi resmi sebelum memakai API atau library.

### M0 — Fondasi dan guardrail

- **T0.1 Scaffold.** Vite, React, TypeScript strict, pnpm, ESLint, Prettier, Vitest, Playwright, Tailwind, shadcn/ui, alias path, struktur direktori `prd.md` §4.1. Aturan import antar-layer ditegakkan lint (`no-restricted-imports` atau `eslint-plugin-boundaries`). `.gitignore` memuat `.env.local`. **Done when:** `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e` hijau pada app kosong dan pelanggaran layer terdeteksi lint.
- **T0.2 Dokumentasi agent.** Pastikan `AGENTS.md` di root dan `docs/` sudah di tempatnya, template ADR ada, `docs/open-questions.md` ada. **Done when:** semuanya tertaut dari README repo.
- **T0.3 CI.** GitHub Actions sesuai `testing.md` §9.6. **Done when:** PR kosong hijau.
- **T0.4 Shell dan tokens.** Design tokens dark dan light, shell aplikasi (bar atas, HashRouter dengan tiga rute placeholder), toast, error boundary, `i18n/en.ts`. **Done when:** tema berganti, rute berpindah, ada tes e2e dan screenshot.

### M1 — Inti domain (murni)

- **T1.1 Skema.** Zod dan tipe untuk knovites.json, node, canvas; sanitizer whitelist TipTap; fixture v1. **Done when:** validasi menerima dan menolak sesuai `data-format.md` §5.3 dan §5.4, dengan tes untuk tiap batas.
- **T1.2 Serializer kanonik.** Tes properti round-trip. **Done when:** S2 lulus.
- **T1.3 Operasi pohon.** Build dari daftar file, derivasi path, slugify, ordering fractional, create, rename, move, reorder, delete (murni, mengembalikan changeset), pencegahan siklus, perbaikan ID duplikat. **Done when:** tes unit dan properti lulus (tanpa siklus, slug unik, order stabil).
- **T1.4 Dataset.** Generator seeded dan dataset demo sekitar 40 node. **Done when:** semua dataset di `spec-map.md` tersedia dan deterministik.

### M2 — Storage dan state

- **T2.1 Dexie.** Skema `data-format.md` §5.9, repository, tes migrasi.
- **T2.2 Store.** Zustand, hydration dari IndexedDB, pelacakan dirty dari changeset, undo delete 10 detik.
- **T2.3 Perlindungan.** Web Locks tab penulis tunggal, `storage.persist()`, banner error storage.
- **Done when:** reload mempertahankan data dan tab kedua berstatus baca saja (e2e E11 sebagian).

### Spike S1-S3 — Uji asumsi berisiko (sebelum M3)

Tujuan: menguji tiga asumsi paling berisiko dengan kode sekali pakai **sebelum** desain dikunci. Kode spike ada di `spikes/<nama>/` (di luar `src/` dan build produksi). Aturan kualitas dilonggarkan: lint dan format tetap, tes unit tidak wajib. Hasil wajib ditulis di `docs/spikes/<nama>.md`: apa yang diuji, hasil per butir, keputusan, dan perubahan yang perlu pada PRD.

Jika sebuah asumsi PRD ternyata salah, agent **berhenti dan melapor ke pemilik** sebelum mengubah PRD.

- **S1 — Git Data API dari browser.** Halaman atau skrip kecil yang memakai fine-grained token ke repo privat sementara milik pemilik (token dari `.env.local`, di-gitignore, tidak pernah di-commit). Uji:
  1. Inisialisasi repo kosong lewat Contents API.
  2. Ambil ref, commit, dan tree rekursif.
  3. Buat blob (teks dan gambar base64), buat tree dengan `base_tree` termasuk penghapusan (`sha: null`) dan pemindahan (path baru dengan blob SHA yang sama), buat commit, update ref tanpa force.
  4. Buktikan update ref ditolak saat non-fast-forward (catat kode status dan bentuk pesan error).
  5. Periksa CORS dari browser, header rate limit, dan perilaku ETag (`If-None-Match` mengembalikan 304).
  6. Ukur latensi untuk sekitar 50 file.
  7. Apakah git tree dengan sha null untuk path yang tidak ada ditolak GitHub?
  - **Done when:** `docs/spikes/s1-github.md` memuat hasil tiap butir (berhasil atau gagal, kode status, catatan) dan daftar perbedaan dari `spec-storage-sync.md` §6.1 dan §6.11.
- **S2 — TipTap di dalam React Flow.** Halaman uji dengan satu kanvas React Flow, banyak elemen teks statis, dan satu editor TipTap aktif.
  - **Done when:** mengetik, memilih teks dengan mouse, memakai toolbar melayang, dan scroll di dalam kotak tidak menggeser kotak atau mengubah zoom; gagang drag memindahkan; pan dan zoom kanvas tetap berfungsi; 100 elemen statis + 1 editor tetap lancar. Laporan `docs/spikes/s2-tiptap-reactflow.md` mencatat solusi yang dipilih.
- **S3 — Prototipe peta radial.** Halaman uji dengan `computeVisible` sederhana dan layout radial d3 pada dataset 150 node tidak seimbang: fokus, transisi, zoom. Tanpa editor dan tanpa storage.
  - **Done when:** screenshot dan rekaman singkat untuk semua dataset di `spec-map.md`; laporan `docs/spikes/s3-radial.md`; **checkpoint pemilik** menilai tampilan. Prototipe boleh dibuang atau dipakai ulang sebagai dasar T3.1 sampai T3.6.

### M3 — Peta pohon

- **T3.1** `computeVisible` dan tes properti (FR-MAP-02).
- **T3.2** Layout radial dan tes invarian (FR-MAP-03).
- **T3.3** Layout horizontal (FR-MAP-04).
- **T3.4** Renderer SVG statis: node, edge, warna cabang, ukuran, badge, bubble `+N`, memakai dataset demo (FR-MAP-09, FR-MAP-10 sebagian).
- **T3.5** Pan dan zoom (`d3-zoom`), semantic zoom, fit dan recenter (FR-MAP-06, FR-MAP-08). **Checkpoint pemilik.**
- **T3.6** Transisi fokus: interpolasi per id, dapat disela, reduced-motion (FR-MAP-05). **Checkpoint pemilik.**
- **T3.7** Keyboard, breadcrumb, toolbar node, dialog Create, Rename, Move to, Delete, ubah tipe, status, warna (FR-MAP-07, FR-MAP-10, FR-MAP-11, `spec-nodes-search.md` §6.7).
- **T3.8** Performa: ukur dataset 150 dan 2.000 node, perbaiki, screenshot semua dataset, laporan `docs/perf.md` (FR-MAP-17).
- **T3.9 (P1)** Minimap, outline view, drag-and-drop pindah node, busur cross-link.
- **Syarat M3 (tinjauan screenshot Spike S3, wajib terpenuhi di M3):**
  - Lebar kapsul dihitung dari pengukuran teks nyata (tidak boleh ada judul terpotong di awal; truncation hanya di akhir dengan ellipsis `…`) (`tanpa FR`, terkait `FR-MAP-09`).
  - Tier semantic zoom ditentukan oleh **ukuran font di layar** (minimal `11 px` di layar untuk Tier 1 dan Tier 2), bukan hanya skala `k` (`FR-MAP-08`, batas `11 px` `tanpa FR`); screenshot Tier 2 wajib diambil pada skala yang memenuhinya.
  - Aturan kamera: fokus node daun menampilkan parent dan sibling-nya; fokus node ber-children menampilkan fokus + children-nya; tidak ada node penting yang terpotong keluar viewport (`FR-MAP-05`, `FR-MAP-02`).
  - Edge dimulai dari tepi kapsul node (bukan menembus tengah teks) dan memudar dekat induk untuk fan lebar (`FR-MAP-09`).
  - Uji tema light: pastikan kontras teks pada tint warna cabang memenuhi WCAG AA serta perbedaan antar-hue cabang tetap jelas terbaca (`FR-MAP-09`, `spec-ui-nfr.md` §7.4).
  - HUD (chip zoom, kontrol, breadcrumb/metrics) tidak boleh menimpa node (beri padding viewport saat auto-fit / recenter; `tanpa FR`, terkait `spec-ui-nfr.md` §8.2).
  - Tes otomatis tambahan (selain cek overlap antar-node): cek edge yang melintas di atas node, label yang terpotong di luar batas kapsul, dan ukuran font minimum di layar (`FR-MAP-03`, `tanpa FR` untuk metrik tambahan).
  - **[Belum terbukti]** Ukur FPS pada `unbalanced150` dan `large2000` oleh pemilik di browser **non-headless dengan GPU** sebelum kriteria sukses S1 / `FR-MAP-17` (`>= 55 fps`) dinyatakan tercapai (angka `~60 fps` Spike S3 berasal dari Chromium headless).
  - **[Keputusan menunggu pemilik]** (tercatat di `docs/open-questions.md` & `docs/spikes/s3-radial.md`): (i) gaya node peta: kapsul berlabel vs lingkaran (`tanpa FR`, terkait `FR-MAP-09`); (ii) sub-cincin stagger untuk fan sibling lebar `>= 12` (`FR-MAP-03`); (iii) formula bobot sudut: subtree terlihat *bottom-up* + boost jalur fokus & koefisien tersembunyi lebih kecil (`FR-MAP-03`).
- **Done when:** S1 (kriteria sukses) tercapai, semua FR-MAP P0 dan FR-NODE P0 lulus, e2e E1 dan E2 hijau.

### M4 — Halaman node dan kanvas

- **T4.1** Shell halaman, rute, header, panel kanan (tab kosong), pemuatan kanvas lazy (FR-PAGE).
- **T4.2** Kanvas React Flow: pemetaan `CanvasDoc` ke node React Flow, elemen teks dengan renderer statis, autosave 400 ms (FR-CVS-01, FR-CVS-07, FR-TXT-08).
- **T4.3** Manipulasi elemen: seleksi, pindah, resize, hapus, duplikat, salin-tempel, z-order, keyboard (FR-CVS-02, FR-CVS-03).
- **T4.4** Mode edit TipTap (satu instance), gagang drag, toolbar melayang, font self-hosted (FR-CVS-04, FR-TXT-01). Ikuti hasil spike S2.
- **T4.5** Input rules Markdown, blok kode dengan highlight, tautan, sanitasi (FR-TXT-02, FR-TXT-03, FR-TXT-06).
- **T4.6** Gaya kotak dan perilaku warna Auto dengan tema (FR-CVS-05).
- **T4.7** Undo dan redo kanvas (FR-CVS-06).
- **T4.8** Pipeline gambar: paste, drop, picker, aset di IndexedDB, render dan placeholder (FR-IMG).
- **T4.9** Performa kanvas 300 elemen, e2e E3 dan E4 (FR-CVS-08). **Checkpoint pemilik.**
- **Syarat M4 (hasil Spike S2 — `docs/spikes/s2-tiptap-reactflow.md`):**
  - **[Fakta terukur]** Culling (`onlyRenderVisibleElements`) wajib (`FR-CVS-08`): pada dataset 300 node kaya + 50 gambar di S2 awal, tanpa culling jatuh ke `14.0–21.0 fps` (`DOM 300`); dengan culling + isolasi render mencapai `51.8–60.2 fps` (`DOM 9–74`).
  - **[Fakta terukur]** Editor aktif ter-unmount oleh culling saat node keluar viewport (seleksi & riwayat undo hilang); mitigasi `<ViewportPortal>` memulihkannya (`remainedMountedOffscreen: true`, `activeEditorMinDuringRun: 1`, `FR-CVS-04`, `FR-CVS-08`).
  - **[Fakta terukur]** `useViewport()` di komponen berat memicu re-render per frame; batasi hanya pada komponen daun (`tanpa FR`).
  - **[Fakta terukur]** LOD ber-histeresis (masuk `0.32` / keluar `0.40`; judul disembunyikan `< 0.19` / tampil `>= 0.23` minimal `11 px` layar) menaikkan `zoom-out-all` 300 node dari `13.1 fps` menjadi `59.9 fps` (`p95Ms 16.7 ms`, `tanpa FR`).
  - **[Fakta terukur]** Toolbar melayang harus berada di luar transform kanvas dengan ukuran layar tetap (`374×38 px` pada zoom `0.25–2.5`, `FR-TXT-01`).
  - **[Fakta terukur]** TipTap v3 (`3.34.0`): `trailingNode: false`, `@tiptap/starter-kit` sudah memuat `Link`/`Underline`/`UndoRedo`, dan `@tiptap/extension-text-align` menulis `attrs: { textAlign: null }` pada paragraf polos (dibuang `parseCanvasJson` dengan `disallowed_tiptap_attr`).
  - **[Fakta terukur]** Sanitasi (`FR-TXT-06`, `data-format.md` §5.4): allowlist `href` (`http`, `https`, `mailto`, `knovites:`), anchor statis wajib `rel="noopener noreferrer"`, dan validasi tetap dijalankan saat memuat JSON dari repo (`parseCanvasJson`).
  - **[Fakta terukur]** Kontras (`FR-CVS-05`, `spec-ui-nfr.md` §7.4): 5 swatch hex gagal AA di tema light (`1.57–2.77:1`); satu hex tidak mungkin lolos `4.5:1` di kedua tema; pasangan latar+teks `Highlight` per tema lulus AA (`9.57–11.89:1` dark, `12.66–14.63:1` light).
  - **[Fakta terukur]** Resize horizontal (`160–720 px`, `FR-CVS-03`) + drag gagang (`FR-CVS-04`) di `<ViewportPortal>` terbukti tanpa lompatan (`<= 1.5 px` deviasi ukuran kotak vs editor setelah `pre { white-space: pre-wrap }`); paritas statis vs edit `diffPixels: 0` (khusus area kotak isi `richtext-body`, `FR-TXT-08`).
  - **[Belum terbukti]** `FR-CVS-08` (`>= 50 fps` pada 300 elemen): seluruh angka berasal dari Chromium headless tanpa GPU dengan gambar sintetis kecil; wajib diukur di browser non-headless ber-GPU dengan foto asli dan thumbnail yang dibuat saat impor (`FR-IMG-03`).
  - **[Belum terbukti]** IME, touch/pinch, keyboard virtual, aksesibilitas (ARIA/Tab), Firefox/WebKit, caret/seleksi pada elemen ter-transform (mode scale), dan resize vertikal (gambar, `FR-CVS-03`).
  - **[Belum terbukti]** Gerbang benchmark spike (`meanFps >= 30`, `p95Ms <= 50 ms`, `maxMs <= 100/200 ms`) hanya berjalan lokal (tidak di CI).
  - **[Rekomendasi]** (belum dikunci): `textAlign` masuk skema (`enum`, default tidak ditulis; normalisasi editor agar tidak menulis `null`); warna sebagai token semantik tema; edit di zoom rendah otomatis zoom ke tingkat terbaca; adopsi bersyarat culling + LOD + `<ViewportPortal>` hasil S2.
  - **[Keputusan menunggu pemilik]** (lihat `docs/open-questions.md`): (1) `textAlign` (`FR-TXT-01`, `data-format.md` §5.4); (2) warna semantik vs hex (`FR-CVS-05`); (3) frame teks (`style.bg`/`border` di `data-format.md` §5.4 saat ini memakai `null | #rrggbb` sehingga `"style": { "bg": null, "border": null }` bentrok makna antara `Auto` dan `None` — cek konvensi nilai `style.bg`/`border` sebelum menambah properti `frame` baru, `FR-CVS-05`); (4) blok kode `pre-wrap` vs scroll horizontal (`FR-TXT-03`, `FR-TXT-08`); (5) perilaku edit di zoom rendah (`FR-CVS-01`, `FR-CVS-04`).
- **Done when:** semua FR-PAGE, FR-CVS, FR-TXT, FR-IMG P0 lulus.

### M5 — Pencarian dan link

- **T5.1** Flatten teks dan index MiniSearch di worker, inkremental (FR-SRC-03).
- **T5.2** Command palette, perintah, perilaku `Enter` (FR-SRC-01, 02, 04).
- **T5.3** Link silang, backlink, broken link (FR-LNK-01 sampai 03).
- **T5.4 (P1)** Mention inline `[[`, filter pencarian.
- **Done when:** FR-SRC dan FR-LNK P0 lulus, e2e E5 dan E6 hijau.

### M6 — GitHub (paling berisiko, kerjakan berurutan)

Semua task M6 mengikuti hasil spike S1 (`docs/spikes/s1-github.md`). Jika ada perbedaan dari spec, hasil spike menang.

#### Prasyarat M6

1. Setelah push sukses: set `baseBlobSha` dan `basePath = path` untuk file yang terkirim, hapus `pendingDeletes` yang terkirim, bersihkan `dirty` hanya untuk file yang tidak berubah sejak snapshot.
2. Planner push hanya menghapus path yang ada di tree remote (verifikasi di spike S1: apakah tree dengan `sha: null` untuk path yang tidak ada ditolak?).
3. Operasi `normalizeSiblingOrders` di `domain/tree`: order kembar (dua perangkat menyisipkan setelah sibling yang sama) harus diberi ulang kunci, hanya `node.json` sibling yang terdampak yang berubah (`reorderNode` kini menolak `order_collision`).
4. Take over saat tab lama punya `hasUnsavedChanges`: tentukan perilakunya.
5. Dataset besar hanya dimuat lewat `import()` dinamis di route dev; cek `check:bundle`.
6. Ukur `hydrate` di browser sungguhan (bukan `fake-indexeddb`) di M3.

- **T6.1** Fake GitHub (msw) dengan semantik Git Data API dan fault injection (`testing.md` §9.3). **Done when:** ada tes bahwa fake menolak non-fast-forward dan menghitung SHA dengan benar.
- **T6.2** Klien GitHub terbungkus di `sync/` (typed, retry dan backoff, rate limit, ETag).
- **T6.3** UI onboarding dan koneksi, inisialisasi repo kosong (FR-ONB).
- **T6.4** Initial pull, cache per blob SHA, progress, resume (FR-SYNC-02).
- **T6.5** Push: changeset, blob, tree, commit, ref, termasuk move dan delete, util SHA blob lokal (FR-SYNC-03).
- **T6.6** Scheduler, state machine status, indikator, panel sync (FR-SYNC-01, 04, 06, 07).
- **T6.7** Polling remote dengan ETag dan pull otomatis (FR-SYNC-08).
- **T6.8** Three-way merge di domain dengan tes tabel dan properti (FR-CNF-01).
- **T6.9** Integrasi merge pada pull-merge dan UI konflik (FR-SYNC-05, FR-CNF-02, 03).
- **T6.10** Konflik struktural (FR-CNF-04) dan fixture integrasi (FR-CNF-05).
- **T6.11** QA manual dengan repo sungguhan (`testing.md` §9.7), perbaiki temuan. **Checkpoint pemilik.**
- **Done when:** S3 dan S4 (kriteria sukses) tercapai, semua FR-SYNC dan FR-CNF P0 lulus, e2e E7 sampai E10 hijau.

### M7 — Export, settings, dan polish

- **T7.1** Export zip (dan import bila P1) (FR-EXP).
- **T7.2** Halaman settings (FR-SET-01, 02).
- **T7.3** Dialog pintasan, state kosong, copywriting, audit aksesibilitas (axe di e2e), cek budget bundle, viewer log error (FR-SET-03, 04, `spec-ui-nfr.md` §7).
- **Done when:** e2e E12 hijau, audit aksesibilitas tanpa pelanggaran serius, budget bundle terpenuhi.

### M8 — Rilis v0.1

- **T8.1** README (apa ini, quickstart, cara membuat token, deploy ke GitHub Pages atau Cloudflare Pages, catatan keamanan token), LICENSE, CONTRIBUTING, workflow deploy, tag `v0.1.0`.
- **Done when:** pemilik membuka situs yang sudah ter-deploy, menyambungkan repo privat, dan mencatat satu materi nyata dari awal sampai tersimpan di GitHub (S5).
