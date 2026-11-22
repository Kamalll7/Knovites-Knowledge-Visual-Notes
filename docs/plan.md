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

- **Task prasyarat sisi data home root (`Opsi 1`, `'__root__'`)** *(menyentuh `docs/data-format.md` §5.1 & §5.9, `schema`, `buildTree`, `Dexie`, & `store` sekaligus saat dijalankan; lihat keputusan di [`docs/open-questions.md`](open-questions.md) — `docs/data-format.md` **tidak** diubah sebelum task ini dijalankan):*
  - **Yang dibangun:** dukungan `canvas.json` + `assets/` opsional langsung di akar repo knowledge untuk root virtual `'__root__'` (pembuatan malas saat pertama kali diedit, pemisahan file akar pengguna seperti `README.md`/`.gitignore` sebagai `rootExtraFiles`, penolakan operasi `delete`/`move`/`rename`/`reorder` ke `'__root__'`, serta penghilangan asumsi join `canvas`/`assets` -> `db.nodes` untuk `nodeId = '__root__'` dan helper path bebas leading slash agar `'canvas.json'` & `'assets/...'` valid di Git Data API).
  - **Lapisan target di `src/`:** `domain` (`src/domain/schema/`, `src/domain/tree/` — tetap murni sesuai `eslint.config.js`), `storage` (`src/storage/repository.ts`, `src/storage/migrations.ts`, `src/storage/types.ts`), dan `app` (`src/app/store.ts`), ditambah kontrak indeks/rute yang disiapkan untuk M4/M5/M6 (`FR-MAP-01`, `FR-PAGE`, `FR-NODE`, `FR-SRC-01`, `FR-SYNC-03`).
  - **Ketergantungan:** bergantung pada **M1 (`T1.1`–`T1.3`)**, **M2 (`T2.1`–`T2.2`)**, dan keputusan pemilik `[D3]` (`Opsi 1`).
  - **Task M3/M4 yang bergantung padanya:** di M3 terutama **`T3.7`** (buka halaman home dari node pusat & proteksi aksi root); di M4 **`T4.1`**, **`T4.2`**, **`T4.7`**, dan **`T4.8`** (dan pada milestone berikutnya **`T5.1`** pencarian `"Home"` serta **`T6.3`–`T6.5`**, **`T6.8`** sync path root).
  - **Tes yang dituntut:** unit/property `domain/tree` (`buildTree` menjaga `missing_parent_ignored`, memisahkan `rootExtraFiles`/`rootAssets`, menolak mutasi pohon terhadap `'__root__'`, menolak slug `'assets'`); unit `storage` (`nodeId = '__root__'` tanpa baris `nodes` di `applyChangeset`, `loadTreeBuildEntries`, `collectDirtyFiles` menghasilkan `'canvas.json'`/`'assets/...'` bukan `'/canvas.json'`, `getEffectiveDeletes`, `getMovedBasePaths`, pembuatan malas saat kosong, dan tes migrasi Dexie); tes `store` (`hydrate` dan guard delete root).
- **T3.1** `computeVisible` dan tes properti (FR-MAP-02).
- **T3.2** Layout radial dan tes invarian (FR-MAP-03).
- **T3.3** Layout horizontal (FR-MAP-04).
- **T3.4** Renderer SVG statis: node, edge, warna cabang, ukuran, badge, bubble `+N`, memakai dataset demo (FR-MAP-09, FR-MAP-10 sebagian).
- **T3.5** Pan dan zoom (`d3-zoom`), semantic zoom, fit dan recenter (FR-MAP-06, FR-MAP-08). **Checkpoint pemilik.**
- **T3.6** Transisi fokus: interpolasi per id, dapat disela, reduced-motion (FR-MAP-05). **Checkpoint pemilik.**
- **T3.7** Keyboard, breadcrumb, toolbar node, dialog Create, Rename, Move to, Delete, ubah tipe, status, warna (FR-MAP-07, FR-MAP-10, FR-MAP-11, `spec-nodes-search.md` §6.7) — *[bergantung pada Task sisi data home root untuk membuka halaman home & mengunci root dari Delete/Move/Rename]*.
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
  - **[Belum terbukti]** Jaminan nol tumpang tindih pada 300 node terlihat di layout radial (`FR-MAP-03`): investigasi `T3.2e` membuktikan bentuk 300 node yang dapat dicapai `computeVisible` default (`worstCase300_default`, `deepChainPlusFan_default`) belum konvergen pada batas `maxCollisionPasses = 36` (menyisakan `17` dan `13` tumpang tindih; baru konvergen di pass `113` dan `98`), sementara bentuk non-default `fans12x24_pinned300` masih menyisakan `11` tumpang tindih di pass `400`. Perbaikan konvergensi membutuhkan keputusan pemilik karena akan mengubah golden radial.
  - **[Keputusan menunggu pemilik]** (tercatat di `docs/open-questions.md` & `docs/spikes/s3-radial.md`): (i) gaya node peta: kapsul berlabel vs lingkaran (`tanpa FR`, terkait `FR-MAP-09`); (ii) sub-cincin stagger untuk fan sibling lebar `>= 12` (`FR-MAP-03`); (iii) formula bobot sudut: subtree terlihat *bottom-up* + boost jalur fokus & koefisien tersembunyi lebih kecil (`FR-MAP-03`).
- **Done when:** S1 (kriteria sukses) tercapai, semua FR-MAP P0 dan FR-NODE P0 lulus, e2e E1 dan E2 hijau.

#### Rencana detail M3 (persiapan eksekusi `T3.1`–`T3.9`, tanpa mengubah spesifikasi tugas di atas)

1. **Urutan kerja yang disarankan, ketergantungan, lapisan `src/`, & tuntutan tes per task:**
   Aturan keras layer ([`eslint.config.js`](../eslint.config.js)): `src/domain/` **murni** (tanpa React, DOM, `window`/`document`, IO, Dexie, atau fungsi tak murni — waktu & pembuat ID/pengukur teks harus diteruskan sebagai parameter; saat ini `DOMAIN_ALLOWED_EXTERNALS = ['zod', 'fractional-indexing']`, jadi bila `T3.2`/`T3.3` memakai `d3-hierarchy` sesuai ADR `0002`, `eslint.config.js` perlu mengizinkannya atau logika hierarki ditulis murni TS, sedangkan `d3-shape`/`d3-zoom`/`d3-selection`/`d3-interpolate`/`d3-ease` hanya di `src/features/map/`); `src/features/*` dilarang saling import; penyimpanan & mutasi pohon lewat `src/app/store.ts` (`useWorkspaceStore`).

   | Task & Urutan | Ketergantungan | Apa yang Dibangun | File / Lapisan Target (`src/`) | Tes yang Dituntut |
   | --- | --- | --- | --- | --- |
   | **1. `T3.1`** (`FR-MAP-02`) | `M1`, `M2` | Seleksi node terlihat (`computeVisible`: root, ancestor fokus, fokus, maks `24` child + bubble `+N`, sibling collapsed `· N`, cucu di Tier >= 2, batas ~300 node) & kontrak injeksi dimensi/teks. | `src/domain/layout/compute-visible.ts`, `src/domain/layout/index.ts` (**domain** murni) | Unit & property test `fast-check` (`src/domain/layout/*.test.ts`): deterministik, fokus + jalur selalu terlihat, `hiddenCount + visibleDescendants === totalDescendants`, tidak melebihi batas render. |
   | **2. `T3.2`** (`FR-MAP-03`) | `T3.1` | Layout radial murni: bobot sudut *bottom-up* subtree terlihat + boost fokus + `0.35 * log2(1+hidden)`, sub-cincin stagger (`>=12` -> 2, `>=34` -> 3) & busur terarah `<= 255°`, `MIN_GAP_PX = 12`, lebar kapsul dari parameter pengukur teks (`measureWidth`), dan titik awal edge di tepi kapsul. *(Catatan `T3.2a`/`T3.2b`: implementasi `T3.2a` sudah mencakup resolusi tabrakan, edge dari tepi kapsul, dan `resolveScreenZoomTier` di `domain/layout/`.)* | `src/domain/layout/radial-layout.ts`, `src/domain/layout/collision.ts`, `src/domain/layout/types.ts` (**domain** murni) | Unit & property test (`fast-check` pohon acak + 5 dataset wajib): 0 tumpang tindih (`gap = 12px`), deterministik, urutan sibling terjaga, anak di dalam irisan induk, kapsul muat teks nyata, komputasi 2.000 node `< 30 ms` (`FR-MAP-17`). |
   | **3. `T3.3`** (`FR-MAP-04`) | `T3.1`, `T3.2` | **`T3.3a`:** Layout horizontal kiri-ke-kanan sebagai fungsi murni dengan kontrak posisi node/edge & visibilitas seragam (`src/domain/layout/horizontal-layout.ts`, `src/domain/layout/horizontal-types.ts`). **`T3.3b` (dipisah, dikerjakan bersama/dekat `T3.5` saat tombol toggle tersedia):** penyimpanan preferensi layout per perangkat (`settings` Dexie / lokal). | `src/domain/layout/horizontal-layout.ts`, `src/domain/layout/horizontal-types.ts`, `src/domain/layout/index.ts` (**domain** murni); preferensi `T3.3b` di `src/storage/` / `src/app/` | Unit & property test: deterministik, `MIN_GAP = 12px`, 0 tumpang tindih pada 5 dataset wajib, spasi vertikal proporsional turunan terlihat. |
   | **4. `T3.4`** (`FR-MAP-09`, `FR-MAP-10` sebagian) | `T3.2`, `T3.3`, `T0.4` | Renderer SVG statis peta: kapsul berlabel (`…` hanya di akhir), lingkaran eksternal di Tier 0, titik + ikon status (`none/learning/practiced/mastered`), warna 8 cabang + keturunan + `node.color`, halo stroke fokus (tanpa `<filter>` blur), edge dari tepi kapsul + fade pangkal fan lebar, bubble `+N`, state kosong (`FR-MAP-12`), & util pengukur teks nyata DOM/Canvas2D. | `src/features/map/` (`MapSvgView.tsx`, `MapNodePill.tsx`, `MapEdges.tsx`, `map-colors.ts`, `map-measure.ts`, `map-edge-path.ts`), rute `/` di `src/app/App.tsx` (**feature + app**) | Unit helper warna/kontras/truncate + Playwright render 5 dataset & dataset demo: 0 error console, kontras tema light WCAG AA, uji edge melintas node, label tidak keluar kapsul. |
   | **5. `T3.5`** (`FR-MAP-06`, `FR-MAP-08`) **[Checkpoint pemilik]** | `T3.4` | Pan & zoom (`d3-zoom`, batas `0.2..3`), kontrol zoom in/out/fit/recenter dengan padding aman agar HUD tidak menimpa node, semantic zoom berbasis **ukuran font di layar (`>= 11 px` untuk Tier 1 & Tier 2)** (*catatan: `resolveScreenZoomTier` sudah ada di `domain/layout/` dan `T3.5` HARUS memakainya ulang, bukan menduplikasi*), pembekuan feedback `zoomTier` saat animasi, aturan kamera (daun vs node ber-children), toggle radial/horizontal. | `src/features/map/` (`useMapZoom.ts`, `map-camera.ts`, `MapHudControls.tsx`, `MapViewport.tsx`) (**feature**) | Unit `computeCameraForFocus` & `resolveScreenFontTier` + Playwright: klik/double-click (`#/n/<id>`), pan/zoom, rule kamera daun & non-daun, `fontSize * k >= 11 px` di Tier 1 & Tier 2, HUD tidak menimpa node, screenshot Tier 0/1/2. |
   | **6. `T3.6`** (`FR-MAP-05`) **[Checkpoint pemilik]** | `T3.5` | Animasi transisi fokus 450–600 ms (`easeCubicOut`, interpolasi per `id` via `requestAnimationFrame` + DOM ref tanpa React re-render per frame), node baru tumbuh dari induk, dapat disela tanpa lompatan posisi, dukungan `prefers-reduced-motion`, sinkron kamera `minK = 0.54` non-root. | `src/features/map/` (`useFocusTransition.ts`, `MapViewport.tsx`) (**feature**) | Tes unit interpolator & pembatalan RAF + Playwright: interupsi klik tengah animasi menuju target baru tanpa loncat, reduced-motion instan, perekaman & screenshot. |
   | **7. `T3.7`** (`FR-MAP-07`, `FR-MAP-10`, `FR-MAP-11`, `FR-NODE-01..06`) | `T3.4`–`T3.6`, `M2` (`store`), `Task sisi data home root` | Navigasi keyboard (`ArrowLeft/Right/Up/Down`, `Enter`, `Esc`, ring fokus jelas), breadcrumb terklik di bar atas, toolbar aksi node (Open termasuk buka halaman `'__root__'`, Add child inline, Rename, Status, Move to picker, Move earlier/later, Delete konfirmasi + Undo 10s dengan proteksi root, ubah tipe/warna/tag) memanggil `useWorkspaceStore`. | `src/features/map/` (`MapBreadcrumb.tsx`, `NodeActionToolbar.tsx`, `NodeCrudDialogs.tsx`, `useMapKeyboard.ts`), sambungan route `/n/:nodeId` / `#/` di `src/app/` (**feature + app**) | Unit keyboard reducer/picker + Playwright e2e **E1** & **E2** (buat hierarki 3 level, rename, move, reorder, delete + Undo 10s + reload tetap ada) + proteksi delete/rename root + ring fokus. |
   | **8. `T3.8`** (`FR-MAP-17`) | `T3.4`–`T3.7` | Optimasi & pengukuran performa dataset 150 (`unbalanced150`) dan 2.000 (`large2000`) node + rute verifikasi dev + tangkapan screenshot seluruh 5 dataset wajib (dark & light) + laporan `docs/perf.md`. *(Catatan `T3.2c`: optimasi grid spasial + AABB datar + dirty-rect di `domain/layout/` sudah menurunkan `worstCase300` dari `479.07 ms` menjadi `~25.3 ms` dan `large2000_deep` menjadi `~3.1 ms`, `0` alokasi, keluaran identik byte; `T3.8` fokus pada DOM/viewport & pengukuran browser nyata.)* | `src/features/map/`, rute dev `import()` dinamis (`src/app/`), `docs/perf.md` | Benchmark Vitest `< 30 ms` pada 2.000 node + Playwright `<= 300` DOM node + screenshot semua 5 dataset diperiksa visual + cek bundle (`check:bundle` tetap aman) + uji pemilik ber-GPU. |
   | **9. `T3.9 (P1)`** (`FR-MAP-13`..`16`) | `T3.7`, `T3.8` | Minimap pojok kanan bawah, outline view aksesibel sejajar data/aksi, drag-and-drop pindah node (tolak turunan sendiri), busur cross-link putus-putus node fokus/hover. | `src/features/map/` (`MapMinimap.tsx`, `MapOutlineView.tsx`, `MapCrossLinks.tsx`, `useMapDragReparent.ts`) | Unit guard siklus D&D & geometry minimap + Playwright klik minimap, toggle outline keyboard, D&D pindah & tolak self/descendant, cross-link tampil saat fokus/hover. |

2. **Pemetaan kode Spike S3 ([`spikes/s3-radial/`](../spikes/s3-radial/)) ke `src/` (larangan keras: `src/` tidak boleh mengimpor dari `spikes/`):**
   - **Dipindahkan (disesuaikan ke aturan layer & bersih dari asumsi spike):**
     - `spikes/s3-radial/compute-visible.ts` -> `src/domain/layout/compute-visible.ts` (`MAX_CHILDREN_SHOWN = 24`, `+N` bubble, collapsed `· N`, filter cucu di Tier 2).
     - `spikes/s3-radial/radial-layout.ts` -> `src/domain/layout/radial-layout.ts` (bobot bottom-up terlihat + `0.35 * log2(1+hidden)`, sub-cincin stagger `>=12`/`>=34`, busur terarah `<= 255°`, resolusi tabrakan `MIN_GAP_PX = 12`, `polarToCartesian` jam 12) — tanpa bergantung pada `d3-hierarchy` jika memilih menjaga `eslint.config.js` tanpa menambah eksternal `domain/`.
     - Dari `spikes/s3-radial/RadialMapSpike.tsx`: logika `computeCameraForFocus`, pembekuan `zoomTier` saat animasi terprogram, palet/pencarian warna cabang dengan anti-tabrakan sibling, interpolasi RAF berbasis `id` lewat DOM refs, `d3-zoom`, dan underlay halo stroke fokus -> dipisah menjadi util & komponen di `src/features/map/`.
   - **Ditulis ulang:**
     - **Pengukuran teks & ukuran kapsul:** perkiraan panjang karakter `labelLen * 7.6` pada `measureNodeDimensions` ditulis ulang menggunakan pengukur teks nyata (mis. canvas `measureText` di-cache per font di `features/map/`, diteruskan sebagai fungsi murni ke `domain/layout/`).
     - **Geometri & fade edge:** `buildEdgePath` yang berawal di pusat node `(srcTheta, srcR)` ditulis ulang agar berawal tepat dari **tepi kapsul** induk/anak dan menambahkan gradien/opasitas memudar di dekat induk untuk fan lebar.
     - **Semantic zoom berbasis ukuran font di layar & kamera daun:** `tierForScale(k)` statis ditulis ulang agar memperhitungkan `screenFontPx >= 11 px` (Tier 1 & 2); kamera daun disempurnakan untuk selalu memasukkan **parent + sibling** (bukan hanya parent) agar orientasi konteks tetap utuh.
     - **Koneksi Store, CRUD, Tema Light WCAG AA, & Layout Horizontal:** `SpikeApp.tsx` (state lokal + dataset statis) diganti dengan integrasi penuh ke `useWorkspaceStore`, router `#/n/<id>`, seluruh operasi node M1/M2 (`T3.7`), dan audit kontras light theme (`T3.4`).
   - **Dibuang:** `spikes/s3-radial/index.html`, `main.tsx`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `window.__S3_API__`, tombol demo spike, serta artifak `spikes/s3-radial/out/` (setelah M3 diverifikasi).

3. **Pemetaan setiap butir Syarat M3 ke tes otomatis & verifikasi GPU pemilik:**

   | Butir Syarat M3 | Verifikasi Otomatis yang Akan Dibuat (Unit / Properti / Playwright) | Perlu GPU / Pemilik? |
   | --- | --- | --- |
   | **Lebar kapsul dari pengukuran teks nyata; ellipsis hanya di akhir** (`tanpa FR`, terkait `FR-MAP-09`) | Unit `domain/layout`: uji kapsul terhadap fungsi `measureWidth` + judul panjang; Playwright DOM: verifikasi lebar terukur `<text>` `<=` ruang dalam kapsul dan pemotongan hanya berakhiran `…` (karakter awal judul utuh). | Tidak |
   | **Tier ditentukan oleh ukuran font di layar `>= 11 px` (Tier 1 & 2); screenshot Tier 2** (`FR-MAP-08`, `tanpa FR`) | Unit fungsi penentu tier; Playwright: hitung ukuran font terproyeksi (`computedFontPx * k`) pada Tier 1 & Tier 2 wajib `>= 11 px`, serta tangkap screenshot Tier 2 khusus pada skala yang memenuhinya (`FR-MAP-08`). | Tidak (inspeksi visual oleh agent & pemilik saat checkpoint) |
   | **Aturan kamera: daun (parent + sibling); ber-children (fokus + children); tanpa node penting terpotong** (`FR-MAP-05`, `FR-MAP-02`) | Unit `computeCameraForFocus` pada node daun vs node bercabang; Playwright: proyeksi kotak layar setiap node wajib-tampil berada di dalam batas viewport aman. | Tidak |
   | **Edge dimulai dari tepi kapsul & memudar dekat induk untuk fan lebar; tes edge melintas node** (`FR-MAP-09`, `FR-MAP-03`) | Unit potong-tepi kapsul (`endpoint` jatuh tepat di batas kapsul, bukan di tengah teks); Playwright SVG: sampel titik sepanjang kurva `<path>` tidak menembus *bounding box* node lain di luar simpul sumber/tujuan & memverifikasi segmen fade fan lebar. | Tidak |
   | **Uji tema light: kontras WCAG AA teks di atas tint cabang & keterpisahan antar-hue** (`FR-MAP-09`, `spec-ui-nfr.md` §7.4) | Unit komputasi rasio kontras palet `--branch-1..8` & varian depth pada `--surface`/`--bg` light (`>= 4.5:1`); Playwright `getComputedStyle` pada tema `light` memeriksa kontras teks + jarak hue antar cabang berdekatan. | Tidak |
   | **HUD (zoom chip, kontrol, breadcrumb/metrics) tidak menimpa node** (`tanpa FR`, terkait `spec-ui-nfr.md` §8.2) | Unit `padding` kamera; Playwright mengecek *bounding rect* semua elemen HUD terhadap *bounding rect* setiap node terlihat setelah auto-fit/fokus (`overlapCount === 0`). | Tidak |
   | **Label terpotong keluar batas kapsul & font minimum layar (tambahan)** (`FR-MAP-03`, `tanpa FR`) | Property test `fast-check` `MIN_GAP_PX = 12` pada pohon acak; Playwright membaca `getBBox()` `<text>` vs kotak kapsul (0 teks keluar batas kapsul), `screenFontPx >= 11` di Tier 1–2, dan menyimpannya bersama screenshot 5 dataset wajib. | Tidak |
   | **FPS `>= 55 fps` pada `unbalanced150` dan `large2000` + `hydrate` nyata** (`FR-MAP-17`, `Prasyarat M6 #6`) | Benchmark Vitest `< 30 ms` layout 2.000 node + skrip Playwright headless `max/p95/p50` (gagal CI bila `< 30 fps`, [`docs/testing.md`](testing.md) §9.5). | **Ya (`[Belum terbukti]` tanpa GPU — wajib diukur pemilik di Chrome non-headless dengan GPU)** |

4. **Rencana verifikasi nyata untuk pemilik di M3 (`T3.8`, memenuhi Prasyarat M6 #5 dan #6):**
   - Menambahkan **rute dev khusus** (hanya diregistrasikan saat `import.meta.env.DEV`, mis. `#/__dev/map-bench`, dan seluruh `MANDATORY_MAP_DATASETS` beserta util benchmark diimpor lewat **`import()` dinamis** agar bundle produksi `pnpm build` / `pnpm check:bundle` tidak ketambahan byte dataset uji — Prasyarat M6 #5).
   - Rute tersebut menyediakan **HUD pengukuran interaktif** untuk dijalankan langsung oleh pemilik di browser **Chrome non-headless ber-GPU**:
     - Pemilih ke-5 dataset wajib (`unbalanced150`, `wide60Children`, `chainDepth12`, `root20Children`, `large2000`), mode tema `dark`/`light`, dan toggle radial/horizontal.
     - Tombol **Seed & Ukur `hydrate` IndexedDB nyata** (`Prasyarat M6 #6` — bukan `fake-indexeddb`): menulis dataset terpilih ke Dexie, memicu reload atau sesi `hydrate()`, lalu menampilkan durasi nyata `hydrate` (`ms`).
     - Pemicu benchmark **pan, zoom, & transisi fokus** yang melaporkan secara langsung: **FPS / frame time (`p50`, `p95`, `max` ms)**, waktu komputasi `computeVisible + layout` (`ms`), serta **jumlah node DOM SVG tergambar** saat stabil dan selama animasi.

### M4 — Halaman node dan kanvas

- **T4.1** Shell halaman, rute, header, panel kanan (tab kosong), pemuatan kanvas lazy (FR-PAGE) — *[bergantung pada Task sisi data home root untuk rute & muat halaman `'__root__'`, label `"Home"`]*.
- **T4.2** Kanvas React Flow: pemetaan `CanvasDoc` ke node React Flow, elemen teks dengan renderer statis, autosave 400 ms (FR-CVS-01, FR-CVS-07, FR-TXT-08) — *[bergantung pada Task sisi data home root untuk penyimpanan `canvas.json` `'__root__'` secara malas]*.
- **T4.3** Manipulasi elemen: seleksi, pindah, resize, hapus, duplikat, salin-tempel, z-order, keyboard (FR-CVS-02, FR-CVS-03).
- **T4.4** Mode edit TipTap (satu instance), gagang drag, toolbar melayang, font self-hosted (FR-CVS-04, FR-TXT-01). Ikuti hasil spike S2.
- **T4.5** Input rules Markdown, blok kode dengan highlight, tautan, sanitasi (FR-TXT-02, FR-TXT-03, FR-TXT-06).
- **T4.6** Gaya kotak dan perilaku warna Auto dengan tema (FR-CVS-05).
- **T4.7** Undo dan redo kanvas (FR-CVS-06) — *[bergantung pada Task sisi data home root agar elemen kanvas halaman `'__root__'` ikut terkelola tanpa soft-delete node]*.
- **T4.8** Pipeline gambar: paste, drop, picker, aset di IndexedDB, render dan placeholder (FR-IMG) — *[bergantung pada Task sisi data home root untuk penyimpanan aset `nodeId = '__root__'` ke `assets/` akar repo]*.
- **T4.9** Performa kanvas 300 elemen, e2e E3 dan E4 (FR-CVS-08). **Checkpoint pemilik.**
- **Syarat M4 (hasil Spike S2 — [`docs/spikes/s2-tiptap-reactflow.md`](spikes/s2-tiptap-reactflow.md), S2 ditutup 2026-11-21 dengan status `LOLOS BERSYARAT`):**
  - **[Fakta terukur]** Culling (`onlyRenderVisibleElements`) wajib (`FR-CVS-08`): pada dataset 300 node kaya + 50 gambar di S2 awal, tanpa culling jatuh ke `14.0–21.0 fps` (`DOM 300`); dengan culling + isolasi render mencapai `51.8–60.2 fps` (`DOM 9–74`).
  - **[Fakta terukur]** Editor aktif ter-unmount oleh culling saat node keluar viewport (seleksi & riwayat undo hilang); mitigasi `<ViewportPortal>` memulihkannya (`remainedMountedOffscreen: true`, `activeEditorMinDuringRun: 1`, `FR-CVS-04`, `FR-CVS-08`).
  - **[Fakta terukur]** `useViewport()` di komponen berat memicu re-render per frame; batasi hanya pada komponen daun (`tanpa FR`). Dalam S2b, memoisasi isi `FloatingToolbarBody` + memosisikan via `translate3d` serta men-cache hasil `renderToReactElement` pada `WeakMap` berbasis referensi `doc` menurunkan `maxMs` zoom 300 node + 50 gambar dari `~200 ms` menjadi `33.4–50.1 ms` (`56.6–59.8 fps` di Chromium headless).
  - **[Syarat wajib & tes — Cache `WeakMap` per referensi `doc`]:** Cache `WeakMap` berbasis objek `doc` hanya sah bila dokumen **tidak pernah dimutasi di tempat** (`store` memakai `immer` dengan referensi baru di tiap edit). M4 wajib menjadikan ketidakberubahan (*immutability*) objek `doc` sebagai syarat arsitektural sekaligus mengujinya dengan tes unit/store (mengedit dokumen wajib menghasilkan referensi `doc` baru dan langsung menyegarkan static renderer).
  - **[Fakta terukur]** LOD ber-histeresis (masuk `0.32` / keluar `0.40`; judul disembunyikan `< 0.19` / tampil `>= 0.23` minimal `11 px` layar) bersama optimasi toolbar/static cache menjalankan `zoom-out-all` 300 node + 50 gambar pada `59.3 fps` (`p95Ms 16.7 ms`, `tanpa FR`).
  - **[Fakta terukur]** Toolbar melayang harus berada di luar transform kanvas dengan ukuran layar tetap (`616×38 px` di S2b pada zoom `0.25–2.5`, `FR-TXT-01`).
  - **[Fakta terukur]** TipTap v3 (`3.34.0`): `trailingNode: false`, `@tiptap/starter-kit` sudah memuat `Link`/`Underline`/`UndoRedo`; ekstensi pembungkus (`NoNullTextAlign`) menjaga `editor.getJSON()` bersih dari `attrs: { textAlign: null }` dan menolak `justify`.
  - **[Fakta terukur]** Sanitasi (`FR-TXT-06`, `data-format.md` §5.4): allowlist `href` (`http`, `https`, `mailto`, `knovites:`), anchor statis wajib `rel="noopener noreferrer"`, `Link` extra attrs di-strip, dan validasi tetap dijalankan saat memuat JSON dari repo (`parseCanvasJson`).
  - **[Fakta terukur]** Kontras (`FR-CVS-05`, `spec-ui-nfr.md` §7.4): 5 token warna semantik (`accent`, `warning`, `success`, `danger`, `violet`) dan 4 pasangan latar+teks `Highlight` lulus WCAG AA pada seluruh **40 kombinasi** tema dark/light × `card`/`none` (`5.16–17.85:1`); hex tetap di mode light gagal AA sehingga keputusan pemilik memilih token tema semantik.
  - **[Fakta terukur & syarat paritas seluruh node (`FR-TXT-08`)]** Blok kode memakai `white-space: pre; overflow-x: auto` (sesuai keputusan pemilik) dengan isolasi wheel horizontal dan `diffPercent: 0%` di area isi `richtext-body` pada lebar `200 px` dan `340 px`; pada tangkapan **seluruh node (`card-surface`)**, selisih saat ini **`0.702–0.816%`** (dari ambang longgar `1%`) semata akibat *outer focus ring*. **Syarat M4:** tes paritas seluruh node wajib **mengecualikan ring fokus secara eksplisit** (mis. menonaktifkan/mengklip ring edit atau membandingkan tanpa focus shadow pada pass paritas) dan **menuntut selisih `0` piksel di luar ring fokus**.
  - **[Diputuskan pemilik 2026-11-21 — lihat [`docs/open-questions.md`](open-questions.md)]:** (1) `textAlign` masuk skema (`'left' | 'center' | 'right'`, tanpa `null`); (2) warna teks & highlight memakai token tema semantik; (3) frame `"none"` lewat nilai `"none"` pada `style.bg`/`style.border` (tanpa properti `frame` baru); (4) blok kode memakai scroll horizontal (`pre` + `overflow-x: auto`); (5) edit dari zoom `<` ambang LOD otomatis zoom ke tingkat terbaca; (6) **mode resize teks dipilih dengan gesture (handle sudut = `scale` via `textScale`, handle sisi = `reflow`; toggle per node di prototipe S2b bukan desain final)**.
  - **[Belum terbukti]** Caret, seleksi, dan mengetik pada mode `scale` di zoom kanvas `0.5`/`1`/`2` *(perlu verifikasi M4 lanjutan)*, komposisi IME di dalam `transform: scale(...)`, interaksi touch/pinch dan keyboard virtual, aksesibilitas (ARIA/`Tab`), serta perilaku di Firefox & WebKit nyata.
  - **[Belum terbukti]** `FR-CVS-08` (`>= 50 fps` pada 300 elemen) pada browser desktop non-headless **ber-GPU** dengan foto impor nyata dan thumbnail hasil impor (`FR-IMG-03`), serta eksekusi gerbang benchmark spike di CI (saat ini hanya lokal).
  - **[Rekomendasi, belum diputuskan]** Zoom minimum saat masuk edit sekitar **`0.7`** (karena teks `16 px` baru mencapai ukuran layar `11 px` di zoom `~0.69`), bukan hanya di bawah ambang LOD `0.32`; plus perlakuan hex `#rrggbb` saat paste (petakan ke token terdekat vs buang ke `Auto`) dan tampilan indikator ukuran font efektif di toolbar.
  - **[Keputusan menunggu pemilik]** Arah modifier `Shift` pada resize gambar (`FR-CVS-03`): apakah `Shift` mengunci rasio (kebiasaan Figma/Canva) atau membuka kunci rasio (sesuai rumusan awal PRD `spec-canvas.md` §6.4 / S2b); serta kebijakan token vs hex untuk `style.bg` / `style.border` kartu kustom.
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
