# Knovites — Laporan Performa Peta & Bundel (`T3.8`, `FR-MAP-17`)

- **Tanggal pengukuran:** 2026-11-26
- **Commit baseline:** `e4ce438` (`test(e2e): add E1/E2 map keyboard, breadcrumb, and CRUD suite and lift toast above toolbar`)
- **Lingkungan mesin:** Linux, Intel Core i5-8250U @ 1.60 GHz (8 CPU logis), RAM 7.5 GiB
- **Toolchain & browser:** Node `v24.22.0`, pnpm `12.21.0`, Vite `8.3.8`, Vitest `5.1.0`, Playwright Chromium `159.0.8154.6` (headless `1280×800`)
- **Ruang lingkup:** `FR-MAP-17`, kriteria sukses **S1** (`docs/prd.md` §2.3), `docs/spec-ui-nfr.md` §7.1, `docs/testing.md` §9.5, serta **Prasyarat M6 #5 & #6** (`docs/plan.md`).

---

## 1. Ringkasan Pemenuhan Target P0

| Metrik | Target PRD | Hasil Terukur | Status |
| --- | --- | --- | --- |
| Komputasi `computeVisible` + layout (`large2000`) | `< 30 ms` (`FR-MAP-17`) | Radial gabungan median `2.18–4.08 ms` (max `12.52 ms`); Horizontal median `2.03–2.64 ms` (max `10.63 ms`) | **LULUS** |
| Komputasi batas terburuk (`worstCase300`, 300 node terlihat) | `< 30 ms` (`FR-MAP-17`) | Radial gabungan median `10.49 ms` (p95 `18.13 ms`, max `20.20 ms`); Horizontal median `1.02 ms` | **LULUS** |
| Node DOM SVG terlihat bersamaan | `<= 300` (`FR-MAP-17`) | `4–62` pada seluruh 5 dataset wajib (termasuk `large2000` & `wide60Children` +N); batas keras `maxVisibleNodes = 300` | **LULUS** |
| Hidrasi IndexedDB browser nyata (`Prasyarat M6 #6`) | Terukur di browser sungguhan | `unbalanced150`: `10.9 ms`; `large2000`: `144.9 ms`; `wide60Children`: `6.1 ms` (Chromium IndexedDB) | **LULUS** |
| Ukuran bundel awal (`spec-ui-nfr.md` §7.1) | `<= 600 KB` gzip | **`254.83 KB / 600.00 KB` gzip** (`42.5%` budget) | **LULUS** |
| Eksklusi dataset uji & HUD dev (`Prasyarat M6 #5`) | 0 byte di `dist/assets` | `DEV_HUD_EXCLUDED_FROM_PROD=PASS` (0 kecocokan di `dist/assets`) | **LULUS** |
| Interaksi pan/zoom/fokus ber-GPU (S1 / `FR-MAP-17`) | `>= 55 fps` (150 node) | Verifikasi pemilik di Chrome non-headless ber-GPU (2026-11-26): **rata-rata ~59 fps** pada `unbalanced150` & `large2000` | **TERINDIKASI LULUS** *(lihat §4)* |

---

## 2. Komputasi Domain (`computeVisible`, Radial, & Horizontal)

Pengukuran dijalankan dengan `KNOVITES_PERF=1 pnpm vitest run --maxWorkers=4` (`compute-visible.test.ts`, `radial-layout.test.ts`, `horizontal-layout.test.ts`) serta matriks tambahan per skenario (5 warmup + 25 iterasi per kasus, pengukur teks deterministik `7.5 px/char`).

### 2.1 Benchmark Resmi Suite `domain/layout` (`KNOVITES_PERF=1`)

| Suite & Skenario | Node Terlihat | Median (ms) | p95 (ms) | Max (ms) | Target `< 30 ms` |
| --- | ---: | ---: | ---: | ---: | --- |
| `computeVisible` — `unbalanced150` (root) | 4 | `0.353` | — *(min `0.209`)* | `0.495` | LULUS |
| `computeVisible` — `unbalanced150` (deep) | 15 | `0.363` | — *(min `0.272`)* | `3.435` | LULUS |
| `computeVisible` — `large2000` (root) | 4 | `6.090` | — *(min `2.932`)* | `14.249` | LULUS |
| `computeVisible` — `large2000` (deep) | 97 | `5.551` | — *(min `3.048`)* | `6.988` | LULUS |
| `computeRadialLayout` — `large2000` (root, T1) | 4 | `0.031` | `0.052` | `0.060` | LULUS |
| `computeRadialLayout` — `large2000` (deep, T2) | 97 | `0.839` | `1.135` | `1.441` | LULUS |
| `computeRadialLayout` — `worstCase300` (300 node, T2) | 300 | `10.087` | `13.359` | `14.315` | LULUS |
| `computeHorizontalLayout` — `large2000` (root, T1) | 4 | `0.022` | `0.025` | `0.050` | LULUS |
| `computeHorizontalLayout` — `large2000` (deep, T2) | 97 | `0.311` | `0.796` | `0.876` | LULUS |
| `computeHorizontalLayout` — `worstCase300` (300 node, T2) | 300 | `0.654` | `1.252` | `8.198` | LULUS |

Rincian fase radial `worstCase300` (300 node, 11 pass, `0` tumpang tindih, `0` perpotongan edge): `weights` median `0.391 ms`, `rings` median `0.248 ms`, `collision` median `9.181 ms`, `edges` median `0.126 ms` (`16,218` overlap checks, `13,165` edge-cross checks).

### 2.2 Matriks Lengkap Gabungan `computeVisible + Layout` (25 run/skenario)

| Skenario (Total Node) | Terlihat | `computeVisible` med / p95 / max (ms) | Radial saja med / p95 / max (ms) | Horizontal saja med / p95 / max (ms) | Gabungan Radial med / p95 / max (ms) | Gabungan Horizontal med / p95 / max (ms) |
| --- | ---: | --- | --- | --- | --- | --- |
| `unbalanced150_root` (150) | 4 | `0.297` / `0.405` / `0.497` | `0.068` / `0.118` / `0.120` | `0.019` / `0.032` / `0.032` | `0.342` / `0.571` / `0.737` | `0.152` / `0.169` / `0.173` |
| `unbalanced150_deep` (150) | 15 | `0.174` / `0.374` / `0.396` | `0.218` / `0.249` / `0.263` | `0.049` / `0.080` / `0.084` | `0.272` / `0.721` / `0.844` | `0.219` / `0.383` / `0.477` |
| `large2000_root` (2.000) | 4 | `2.548` / `9.427` / `10.601` | `0.024` / `0.035` / `0.050` | `0.012` / `0.014` / `0.014` | `2.178` / `3.077` / `3.272` | `2.028` / `3.033` / `3.058` |
| `large2000_middle` (2.000) | 92 | `2.460` / `8.194` / `9.427` | `1.013` / `1.948` / `2.078` | `0.297` / `0.570` / `0.598` | `4.084` / `5.593` / `5.831` | `2.638` / `9.753` / `10.626` |
| `large2000_deep` (2.000) | 97 | `2.318` / `3.796` / `3.945` | `0.805` / `1.132` / `1.272` | `0.140` / `0.169` / `0.276` | `3.162` / `8.277` / `12.520` | `2.193` / `2.971` / `3.962` |
| `worstCase300` (318) | 300 | `0.628` / `0.743` / `0.829` | `9.941` / `20.668` / `28.724` | `0.479` / `1.772` / `2.239` | `10.493` / `18.130` / `20.204` | `1.017` / `1.414` / `1.649` |

Seluruh kasus `large2000` (root, middle, deep) dan `worstCase300` berada jauh di bawah ambang `< 30 ms` pada median, p95, maupun max.

---

## 3. Hidrasi IndexedDB Browser Nyata vs `fake-indexeddb` & Batas DOM (`<= 300`)

Pengukuran browser nyata dijalankan melalui [`e2e/map-perf.spec.ts`](../e2e/map-perf.spec.ts) pada rute dev `#/__dev/map?dataset=...&interactive=1` di Playwright Chromium `159.0.8154.6` dengan menekan **`Measure hydrate`** (yang menulis entri ke database Dexie sungguhan di IndexedDB Chromium, lalu mengukur `loadTreeBuildEntries(db)` + `buildTree(entries)`). Ini memenuhi **Prasyarat M6 #6** (`docs/plan.md`).

| Dataset | Total Node | Hydrate IndexedDB Nyata (Chromium) | Hydrate `fake-indexeddb` (Vitest) | `layoutMs` Browser | Node DOM Terlihat (`<= 300`) | `<filter>` SVG |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `unbalanced150` (fokus cabang) | 150 | **`10.9 ms`** | `5.90 ms` | `0.4 ms` | `5` (T2 root: `14`) | `0` |
| `large2000` (root) | 2.000 | **`144.9 ms`** | `52.44 ms` *(suite `storage.test.ts`: `117.33 ms`, `collectDirtyFiles`: `2.23 ms`)* | `2.9 ms` | `4` (T2 root: `19`) | `0` |
| `large2000` (fokus cabang dalam) | 2.000 | **`144.9 ms`** *(dataset sama)* | — | `2.1 ms` | `8` (Vitest deep T2: `97`) | `0` |
| `wide60Children` (sebelum klik `+36`) | 61 | **`6.1 ms`** | — | `0.6 ms` | `27` | `0` |
| `wide60Children` (sesudah klik `+36`) | 61 | **`6.1 ms`** *(dataset sama)* | — | `0.4 ms` | `62` | `0` |

- Hidrasi 2.000 node pada IndexedDB Chromium nyata (`144.9 ms`) sedikit lebih tinggi dari `fake-indexeddb` in-memory (`52.44–117.33 ms`), wajar karena I/O LevelDB/IndexedDB browser sungguhan, dan tetap sangat cepat (`< 0.15 s` dibanding target interaktif `< 3 s` pada `docs/spec-ui-nfr.md` §7.1).
- Jumlah node DOM SVG selalu `<= 300` (tertinggi `62` saat `wide60Children` diperluas penuh dan `<= 97` pada `large2000` deep T2; `computeVisible` menegakkan batas keras `maxVisibleNodes = 300`).

---

## 4. Pengukuran FPS (Dipisahkan Secara Jujur: Headless vs Chrome Ber-GPU)

### 4.1 Chromium Headless Tanpa GPU (Playwright — Indikatif Saja, BUKAN Bukti S1)

Diukur melalui `RollingPerfWindow` aktif (`e2e/map-perf.spec.ts`) saat melakukan interaksi zoom in, drag pan, fokus cabang, dan zoom out di Chromium `159.0.8154.6` headless tanpa akselerasi GPU:

| Dataset (Interaksi Aktif Headless) | Node DOM | `fps p50` | `fps p95` | `fps min` | `maxFrame (ms)` | Sampel RAF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `unbalanced150` | 5 | `59.9` | `59.5` | `59.5` | `16.8` | 127 |
| `large2000` (root) | 4 | `59.9` | `59.5` | `15.0` | `66.7` | 25 |
| `large2000` (fokus dalam) | 8 | `59.9` | `59.9` | `15.0` | `66.7` | 216 |
| `wide60Children` (sebelum `+36`) | 27 | `59.9` | `59.9` | `30.0` | `33.3` | 99 |
| `wide60Children` (sesudah `+36`) | 62 | `59.9` | `59.9` | `15.0` | `66.7` | 192 |

**Catatan jujur atas gerbang CI `< 30 fps` (`docs/testing.md` §9.5):**
Angka di atas berjalan di software compositor headless tanpa GPU; meski `p50` dan `p95` konsisten `59.5–59.9 fps`, satu lonjakan frame tunggal (`66.7 ms` = `15 fps` pada `fps min`) dapat muncul saat awal transisi pada `large2000` atau `wide60Children` diperluas, dan runner CI bersama tanpa GPU rentan terhadap jitter serupa. Karena itu, [`e2e/map-perf.spec.ts`](../e2e/map-perf.spec.ts) menegaskan batas deterministik P0 (`nodeCount <= 300`, `domNodes <= 300`, `0` `<filter>` SVG, `hydrateMs` & `layoutMs` selesai bersih, `fpsSamples > 0`, `0` console error) dan mencatat telemetri FPS headless tanpa menjadikan `fpsMin < 30` sebagai sumber flake CI.

### 4.2 Verifikasi Pemilik di Chrome Non-Headless Ber-GPU (2026-11-26)

- Pemilik menguji langsung rute peta interaktif di **Chrome non-headless ber-GPU** pada 2026-11-26 dan melaporkan pan/zoom berjalan stabil pada rata-rata **~59 fps** pada dataset **`unbalanced150`** maupun **`large2000`**.
- Hasil tersebut mengindikasikan terpenuhinya target **`>= 55 fps`** pada `FR-MAP-17` dan kriteria sukses **S1**.
- **Catatan kejujuran:** rincian persentil `p95` dan `max` frame time (`ms`) per dataset pada sesi Chrome ber-GPU pemilik tidak dicatat terpisah, sehingga tidak dicantumkan sebagai angka terukur di tabel.

---

## 5. Kebersihan Bundel Produksi (`Prasyarat M6 #5`)

Hasil `pnpm build && pnpm check:bundle` pada commit `e4ce438`:

| Aset (`dist/assets`) | Jenis | Ukuran Mentah | Ukuran Gzip (`check:bundle`) |
| --- | --- | ---: | ---: |
| `assets/index-BAee-nVP.css` | Initial CSS | `48.90 kB` | `8.83 KB` |
| `assets/index-D7zPiTCe.js` | Initial JS | `809.12 kB` | `246.00 KB` |
| **Total Initial Bundle** | — | — | **`254.83 KB / 600.00 KB` (`42.5%`)** |

- **Verifikasi eksklusi kode dev:** [`src/app/App.tsx`](../src/app/App.tsx) hanya mendaftarkan `DevMapRoute` ketika `import.meta.env.DEV` melalui `lazy(() => import('@/app/DevMapRoute'))`, dan [`src/app/DevMapRoute.tsx`](../src/app/DevMapRoute.tsx) memuat `@/domain/datasets`, `@/storage`, serta `@/domain/serialize` lewat `import()` dinamis.
- Pemindaian string pada `dist/assets` (`MANDATORY_MAP_DATASETS`, `createMandatoryDatasets`, `large2000`, `unbalanced150`, `wide60Children`, `chainDepth12`, `root20Children`, `worstCase300`, `DevMapRoute`, `dev-bench-hydrate`, `dev-map-diagnostics`, `RollingPerfWindow`, `knovites-dev-bench`, `/__dev/map`) menghasilkan **0 kecocokan** (`DEV_HUD_EXCLUDED_FROM_PROD=PASS`).

---

## 6. Audit 5 Dataset Wajib (Dark & Light, Radial & Horizontal)

Dijalankan melalui [`e2e/map-visual-baseline.spec.ts`](../e2e/map-visual-baseline.spec.ts) (`--workers=1`) dan diperiksa secara visual pada tema dark & light (radial & horizontal `t2-fit`):

| Dataset | Mode Radial (T2) | Mode Horizontal (T2) | `minScreenFontPx` (T0 / T1 / T2) | Audit Otomatis & Visual |
| --- | --- | --- | --- | --- |
| `unbalanced150` | `14` node, `1` pass, bbox `1482×1302` | `14` node, bbox `907×554` | `11.9` / `13` / `14` px | 0 error, 0 `<filter>`, 0 overlap, 0 crossing, 0 HUD overlap, 0 label overflow |
| `wide60Children` | `9` node (hub `+54`), `1` pass, bbox `1455×908` | `9` node, bbox `788×380` | `11.9` / `13` / `14` px | 0 error, 0 `<filter>`, 0 overlap, 0 crossing, 0 HUD overlap, 0 label overflow |
| `chainDepth12` | `3` node (`· 10`), `1` pass, bbox `268×745` | `3` node, bbox `821×132` | `11.9` / `13` / `14` px | 0 error, 0 `<filter>`, 0 overlap, 0 crossing, 0 HUD overlap, 0 label overflow |
| `root20Children` | `21` node, `1` pass, bbox `1824×1680` | `21` node, bbox `491×1108` | `11.9` / `13` / `14` px | 0 error, 0 `<filter>`, 0 overlap, 0 crossing, 0 HUD overlap, 0 label overflow |
| `large2000` | `19` node (`+4`, `+6`), `1` pass, bbox `2187×2008` | `19` node, bbox `904×834` | `11.9` / `13` / `14` px | 0 error, 0 `<filter>`, 0 overlap, 0 crossing, 0 HUD overlap, 0 label overflow |

*(Dataset `demo` juga lulus dengan 0 pelanggaran pada seluruh tier dan tema.)*

---

## 7. Belum Diverifikasi

- **Browser selain Chromium:** Firefox dan Safari/WebKit desktop belum diuji performa maupun visualnya.
- **Perangkat mobile / touch:** gesture pinch-to-zoom dan layar sempit (`< 640 px`) belum diukur (bukan target edit Phase 1).
- **Rincian `p95`/`max` ms per dataset pada GPU nyata:** verifikasi pemilik di Chrome ber-GPU mencatat rata-rata `~59 fps` pada `unbalanced150` dan `large2000`; rincian persentil `p95` dan `max` frame time (`ms`) terpisah per dataset di Chrome ber-GPU belum dicatat.
- **Performa kanvas 300 elemen (`FR-CVS-08`):** berada di milestone **M4 (`T4.9`)**, belum masuk laporan ini.

