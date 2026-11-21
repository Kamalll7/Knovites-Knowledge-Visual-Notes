# Laporan Spike S2 — TipTap di Dalam `@xyflow/react`

- **Verdict:** **LOLOS BERSYARAT (Conditional Pass) — `FR-CVS-08 belum terbukti`.** Isolasi input/wheel/drag, toolbar berukuran layar tetap di luar transformasi kanvas, satu instance TipTap aktif (MIT), paritas visual (`diffPixels: 0` di dark & light), ketahanan unmount editor aktif via `<ViewportPortal>` (termasuk **drag gagang, resize lebar + reflow + scale saat edit**, **edit penuh pada zoom `< LOD`**, dan **unmount bersih tanpa hilang teks saat node edit dihapus/dipindahkan pilihannya**), LOD ber-hysteresis (`0.32`/`0.40`, judul `>= 11 px` layar atau tersembunyi tanpa kedip), pasangan kontras `Highlight` per tema (dark & light semua `passAA: true`), serta gerbang benchmark `meanFps >= 30`, `p95Ms <= 50`, dan `maxMs <= 100` (pan/`zoom-out-all`) seluruhnya **17/17 lulus** di Chromium headless (**300 kaya + 50 gambar `zoom-out-all`: `59.9 fps`, `p95 16.7 ms`, `max 16.8–33.4 ms`**). **`FR-CVS-08 belum terbukti`** penuh karena: (1) uji berjalan di Chromium headless tanpa GPU desktop; (2) pada zoom dinamis `cullOn` (`DOM 10–74`), *mount burst* node baru masih bisa menyentuh `maxMs 100.1–149.9 ms` (`p95Ms 27.8–33.4 ms <= 50 ms`); (3) suite spike **tidak dijalankan di GitHub Actions CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) hanya menjalankan `pnpm test:e2e` pada `e2e/`); dan (4) warna teks hex tetap pada tema light gagal WCAG AA ([`docs/open-questions.md`](../open-questions.md)).
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s2-tiptap-reactflow/`](../../spikes/s2-tiptap-reactflow/)
- **Artifak screenshot di `spikes/s2-tiptap-reactflow/out/` (hanya 5 PNG berikut yang dipertahankan; berkas lain di `out/` di-gitignore via [`out/.gitignore`](../../spikes/s2-tiptap-reactflow/out/.gitignore)):**
  - [`canvas-static-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png)
  - [`canvas-edit-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)
  - [`canvas-static-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png)
  - [`canvas-edit-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)
  - [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)
- **Dokumen rujukan:** [`docs/spec-canvas.md`](../spec-canvas.md) (§6.4 `FR-CVS-04`, `FR-CVS-05`, `FR-CVS-06`, `FR-CVS-08`; §6.5 `FR-TXT-01`, `FR-TXT-06`, `FR-TXT-08`), [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) (§7.1, §7.4, §8.1), [`docs/testing.md`](../testing.md) (§9.4–§9.5), [`docs/data-format.md`](../data-format.md) (§5.4), ADR [`0003-xyflow-and-tiptap-packages.md`](../decisions/0003-xyflow-and-tiptap-packages.md), dan [`docs/open-questions.md`](../open-questions.md).

---

## 1. Solusi yang Dipilih

1. **Renderer statis tanpa `dangerouslySetInnerHTML`:**
   Paket `@tiptap/static-renderer@3.34.0` berlisensi **MIT** dan sub-paket `@tiptap/static-renderer/pm/react` (`renderToReactElement`) memetakan JSON ProseMirror menjadi elemen React lewat `React.createElement` tanpa string HTML atau `dangerouslySetInnerHTML` (`StaticTextContent.tsx`). Anchor statis (`<a>`) mewarisi `HTMLAttributes: { rel: 'noopener noreferrer' }`.
2. **Satu instance TipTap aktif (MIT only):**
   Hanya node berstatus `isEditing === true` yang me-mount `ActiveTipTapEditor` (`useEditor`). Pelacakan berbasis `Set<string>` (`useId()`) menjaga maksimal **1** instance TipTap hidup pada satu waktu (`TipTap instances: 0 | 1`). Ekstensi MIT: `StarterKit` (`heading: { levels: [1, 2, 3] }`, `link: false`, `underline: false`, `trailingNode: false`), `Underline`, `Link` (allowlist `http`, `https`, `mailto`, `knovites:<ulid>`, menolak spasi depan & karakter kontrol via `isAllowedSpikeHref`), `TextStyle`, `Color`, `FontFamily`, `FontSize` (`@tiptap/extension-text-style/font-size`), `Highlight`, dan `TextAlign`.
3. **Toolbar di luar transformasi kanvas (ukuran layar tetap):**
   [`FloatingToolbar.tsx`](../../spikes/s2-tiptap-reactflow/FloatingToolbar.tsx) dirender langsung di dalam `<main data-testid="canvas-stage">` **di luar `.react-flow__viewport`**, diposisikan dari bounding-rect layar node aktif (`useViewport` + `useLayoutEffect`). Toolbar selalu berukuran tetap (`374×38 px`, tombol `28 px`), terbaca di zoom `0.25` hingga `2.5`, dan otomatis membalik ke bawah kartu bila dekat tepi atas sehingga **tidak pernah menutupi node yang sedang diedit**.
4. **HUD benchmark di luar kanvas & isolasi `useViewport()`:**
   [`s2-fps-hud`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx) ditempatkan di dalam `<footer data-testid="s2-status-footer">` terpisah di bawah `<main>` sehingga **tidak menimpa node maupun atribusi `.react-flow__attribution`**. Pembacaan `useViewport()` diisolasi hanya pada komponen daun [`FooterZoomLabel`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx) dan [`FloatingToolbarOverlay`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx) (ukuran kotak di-cache saat buka/edit, posisi toolbar dihitung secara matematis tanpa `getBoundingClientRect()` berulang saat pan/zoom) agar `<ReactFlow>` dan 300 wrapper node tidak ikut re-render tiap frame viewport.
5. **Ketahanan unmount, drag, resize, & pembersihan editor di `<ViewportPortal>` (`Task S2c` + `S2c-F`):**
   - Saat node diedit dengan `onlyRenderVisibleElements={true}`, permukaan aktif [`TextBoxSurface`](../../spikes/s2-tiptap-reactflow/TextCanvasNode.tsx) dirender di `<ViewportPortal>`, sementara slot node di `.react-flow__node` menyimpan placeholder `visibility: hidden` + `pointer-events: none`, gagang drag (`.knovites-drag-handle`), dan gagang resize lebar-saja (`<NodeResizeControl position="right" resizeDirection="horizontal" minWidth={160} maxWidth={720}>`) dengan `pointer-events: all`.
   - Aturan `.knovites-richtext pre { white-space: pre-wrap; }` menyamakan pembungkusan blok kode dengan `.ProseMirror pre`, sehingga saat lebar diubah atau kanvas di-zoom sambil mengedit, editor di `<ViewportPortal>` ikut berpindah, reflow, dan berskala identik dengan node (`<= 1.5 px` selisih ukuran kotak vs editor) tanpa lompatan.
   - Menghapus node yang sedang diedit (`remove` change / `deleteNode`) atau memindahkan pilihan ke node/area lain (`select` change / klik luar) otomatis me-unmount `ActiveTipTapEditor` (`TipTap instances` bersih ke `0` atau `1`), membuka kunci pintasan kanvas, serta mempertahankan teks ketikan di renderer statis dan snapshot `Ctrl+Z`.
6. **LOD ber-hysteresis, font `>= 11 px` layar, & pasangan warna `Highlight` (`Task S2c` + `S2c-F`):**
   - `LodViewportObserver` (`useOnViewportChange`) + [`LodZoomProvider`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx) menerapkan *deadband* hysteresis **`LOD_ENTER_ZOOM = 0.32` / `LOD_EXIT_ZOOM = 0.40`** serta **`LOD_TITLE_HIDE_ZOOM = 0.19` / `LOD_TITLE_SHOW_ZOOM = 0.23`** di [`rich-text-config.ts`](../../spikes/s2-tiptap-reactflow/rich-text-config.ts) agar zoom yang berosilasi di sekitar ambang tidak menimbulkan kedip (0 pergantian).
   - Pada zoom menengah (`>= 0.23`, mis. `0.25`), ukuran font judul LOD di-bucket per `0.05` (`lodFontPx = Math.ceil(12 / zBucket)`) sehingga selalu tampil `>= 11 px` di layar (`>= 12 px`); di bawah `0.19` (mis. `zoom-out-all` `0.105`), judul disembunyikan dan diganti rangka kartu + thumbnail PNG `64×40` ([`ImageCanvasNode.tsx`](../../spikes/s2-tiptap-reactflow/ImageCanvasNode.tsx)).
   - **Edit pada zoom `< LOD` (butir #19):** mengklik ganda kotak teks saat mode LOD (`0.25`) mempertahankan zoom kamera di `0.25` dan langsung beralih ke editor TipTap penuh + toolbar ukuran layar di `<ViewportPortal>` dengan caret, seleksi teks, dan format aktif.
   - Pasangan latar+teks `mark` (`highlight`) per tema didefinisikan di [`spike.css`](../../spikes/s2-tiptap-reactflow/spike.css).
7. **Isolasi input, gagang drag, & undo pra-drag:**
   `dragHandle: '.knovites-drag-handle'`, kelas `nodrag nowheel nopan` pada permukaan kartu saat edit, `onWheelCapture` untuk kontainer bertinggi terbatas (`box-scroll`), `stopPropagation` pada `keydown` di `ActiveTipTapEditor.tsx` (`handleKeyDown` & `EditorContent`), `panActivationKeyCode={null}` & `deleteKeyCode={null}` saat edit, plus snapshot undo pra-drag & pra-resize.

---

## 2. Daftar Tes Playwright (17 Tes), Paritas Visual, Toolbar Zoom & Kontras WCAG

Seluruh suite dijalankan di Playwright Chromium (`pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts`) — **17 passed (3.3m)**. Suite spike ini **tidak** dijalankan di GitHub Actions CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) hanya menjalankan `pnpm test:e2e` untuk `e2e/`).

**Alasan keberadaan tes tambahan (Tes #10–#17):** Review bertahap menambahkan uji toolbar di luar transform (**Tes #10**), kontras WCAG 2.1 (**Tes #11**), ketahanan unmount editor aktif (**Tes #12**), drag gagang + resize lebar reflow & scale di `<ViewportPortal>` (**Tes #13**), edit penuh di zoom `< LOD` (**Tes #14**), cleanup unmount saat node edit dihapus atau pilihan berpindah (**Tes #15**), aturan font `>= 11 px`/sembunyi & hysteresis anti-kedip LOD (**Tes #16**), dan benchmark FPS 3 kali jalan beserta gerbang `meanFps`/`p95Ms`/`maxMs` (**Tes #17**).

| # | Nama Tes di `s2.spec.ts` | Status | Hasil / Mekanisme Terverifikasi |
| --- | --- | :---: | --- |
| 1 | `1. mengetik teks termasuk spasi tidak memicu pan (Space) maupun tool shortcut H, T, I, ], [` | **Lulus** | Mengetik spasi, `H/T/I`, `]/[`, serta menahan `Space` + drag tidak mengubah `tool`, `zIndex`, maupun viewport; `getLeakedCanvasKeydowns() === 0`. |
| 2 | `2. Backspace dan Delete saat mengedit TIDAK menghapus elemen` | **Lulus** | Saat edit node tidak terhapus; `Escape` meng-unmount editor (`TipTap instances: 0`) dan `Delete` di luar edit menghapus node. |
| 3 | `3. memilih teks dengan drag mouse tidak memindahkan kotak` | **Lulus** | Drag teks di `.ProseMirror` memilih karakter tanpa mengubah `(x, y)`; saat `dragHandle` dilepas di tes, `.nodrag` tetap menghentikan `d3-drag`. |
| 4 | `4. scroll/wheel/nopan di dalam kotak tidak mengubah zoom atau pan kanvas` | **Lulus** | `onWheelCapture` (box-scroll statis), `.nowheel` (box-edit non-scroll), dan `.nopan` (drag padding saat tool Hand) semuanya terisolasi. |
| 5 | `5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format` | **Lulus** | Bold, Color (`#7c9cff`), Size (`24px`), Font (`JetBrains Mono`) diterapkan ke `'Alpha'` sambil menjaga seleksi non-collapsed. |
| 6 | `6. gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi` | **Lulus** | Drag pada `[data-testid="drag-handle-box-second"]` memindahkan kotak; `Space`+drag pan dan `Ctrl`+wheel zoom tetap jalan. |
| 7 | `7. Ctrl/Cmd+Z saat mengedit hanya membatalkan teks, bukan operasi kanvas` | **Lulus** | `Ctrl+Z` saat edit hanya membatalkan teks; setelah keluar edit (`Escape`), `Ctrl+Z` membatalkan perpindahan drag kanvas ke `x = 470`. |
| 8 | `8. paste teks berformat dibersihkan sesuai whitelist` | **Lulus** | Paste berbahaya dan 5 payload `href` (`JaVaScRiPt:`, `"java\nscript:"`, spasi depan `" javascript:..."`, `data:text/html`, `vbscript:`) disanitasi; JSON buatan ke `parseCanvasJson` langsung membuang ke-5 link berbahaya (`disallowed_link_href`) & mencatat `{ textAlign: null }`. |
| 9 | `9. tampilan statis dan mode edit identik secara visual dan tangkap screenshot` | **Lulus** | Memverifikasi `<a href="https://example.com/heap" rel="noopener noreferrer">` statis; paritas dark & light `diffPixels: 0` (`0%`). |
| 10 | `10. toolbar berukuran tetap di luar transform kanvas, terbaca di semua zoom, dan tidak menutupi node` | **Lulus** | `closest('.react-flow__viewport') === null`; ukuran identik `374×38 px` (tombol `28 px`) di zoom `1.0`, `0.25`, & `2.5` dengan zero overlap vs `card-surface-box-edit`, dan flip ke bawah saat di tepi atas. |
| 11 | `11. ukur rasio kontras WCAG 2.1 untuk mark color & highlight di tema dark/light dan frame card/none` | **Lulus** | Memverifikasi seluruh pasangan highlight (`HighlightAmber/Emerald/Blue/Rose`) pada tema dark (`9.57–11.89`) & light (`12.66–14.63`) lulus WCAG AA (`passAA: true`); warna teks hex tetap pada mode light tercatat di §2.2. |
| 12 | `12. editor aktif tetap hidup saat node di-pan keluar layar (culling ON): tanpa vs dengan mitigasi ViewportPortal` | **Lulus** | Tanpa mitigasi: unmount offscreen, seleksi & undo hilang. Dengan `<ViewportPortal>`: tetap ter-mount (`activeEditor: 1`), teks, seleksi (`start..end`), fokus, & riwayat undo utuh. |
| 13 | `13. resize dan drag gagang saat mengedit di ViewportPortal mengikuti posisi dan ukuran tanpa lompatan (reflow & scale)` | **Lulus** | Drag gagang memindahkan kotak & portal (`<= 1.5 px` deviasi tengah-drag & akhir); resize lebar `-140 px` memicu reflow tinggi tumbuh identik (`cardBox == phBox <= 1.5 px`, lebar editor + padding cocok) dan skalanya cocok di zoom `0.75` & `1.5`. |
| 14 | `14. edit di zoom < ambang LOD: editor tampil penuh tanpa reset zoom dengan caret & seleksi berfungsi` | **Lulus** | Double-click pada zoom `0.25` menjaga kamera tetap `0.25` dan me-mount editor penuh (`TipTap instances: 1`) + toolbar; ketik, navigasi caret, seleksi `Shift+Arrow`, dan Bold (`strong`) berfungsi. |
| 15 | `15. node yang sedang diedit dihapus atau pilihan berpindah: editor unmount bersih tanpa kebocoran dan tanpa kehilangan teks` | **Lulus** | Pindah edit ke node lain, `selectNodes(['box-rich'])`, dan `deleteNode('box-edit')` saat aktif edit seluruhnya meng-unmount bersih (`0`/`1` instance), membuka kunci pintasan (`t`), serta menjaga teks di statis & `Ctrl+Z`. |
| 16 | `16. LOD: font judul placeholder >= 11 px di layar atau disembunyikan dan bebas kedip di sekitar ambang zoom` | **Lulus** | Zoom `0.25`: font layar `>= 11 px`; zoom `0.105`: judul disembunyikan; osilasi di `[0.33..0.39]` mencatat **0 pergantian** LOD berkat hysteresis `0.32`/`0.40`. |
| 17 | `benchmark FPS pan-only, zoom-only, culling ON vs OFF, 3 runs per scenario (LOD + rich text + 50 images)` | **Lulus** | 13 skenario × **3 kali jalan**, menegakkan `meanFps >= 30`, `p95Ms <= 50` (seluruh `cullOn`), dan `maxMs <= 100` (pan/`zoom-out-all`) / `<= 200` (`mean <= 150` zoom dinamis `cullOn`). |

### 2.1 Metode Perbandingan Paritas Visual (Tes #9) & Invariansi Toolbar (Tes #10)

- **Paritas (Tes #9):** Screenshot `[data-testid="richtext-body-box-rich"]` pada dark ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)) dan light ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)) diukur lewat `OffscreenCanvas` 2D pixel diff (`|ΔRGB| > 8`): keduanya `310×255`, **`diffPixels: 0` (`diffPercent: 0%`)**.
- **Invariansi Toolbar (Tes #10):** `S2_TOOLBAR_ZOOM_INVARIANCE`:
  - `zoom: 1` -> `374×38`, tombol `28 px`, `overlapsNode: false`
  - `zoom: 0.25` -> `374×38`, tombol `28 px`, `overlapsNode: false`
  - `zoom: 2.5` -> `374×38`, tombol `28 px`, `overlapsNode: false`

### 2.2 Rasio Kontras Terhitung WCAG 2.1 (`S2_CONTRAST_RATIOS`, Tes #11)

Dihitung langsung dengan rumus relative-luminance WCAG 2.1 dari `getComputedStyle(el).color` vs latar efektif terukur (target AA teks normal `>= 4.5:1`):

| Sampel Teks / Mark | Dark `card` (`rgb(17,21,29)`) | Dark `frame: "none"` (`rgb(20,20,20)`) | Light `card` (`rgb(255,255,255)`) | Light `frame: "none"` (`rgb(246,248,252)`) |
| --- | :---: | :---: | :---: | :---: |
| `AutoText` (`--fg`) | **15.04** (Lulus) | **15.16** (Lulus) | **17.85** (Lulus) | **16.79** (Lulus) |
| `AccentBlue` (`#7c9cff`) | **7.01** (Lulus) | **7.07** (Lulus) | **2.61** (GAGAL) | **2.45** (GAGAL) |
| `AmberText` (`#fbbf24`) | **10.95** (Lulus) | **11.04** (Lulus) | **1.67** (GAGAL) | **1.57** (GAGAL) |
| `EmeraldText` (`#34d399`) | **9.51** (Lulus) | **9.58** (Lulus) | **1.92** (GAGAL) | **1.81** (GAGAL) |
| `RoseText` (`#f87171`) | **6.61** (Lulus) | **6.66** (Lulus) | **2.77** (GAGAL) | **2.60** (GAGAL) |
| `VioletText` (`#a78bfa`) | **6.72** (Lulus) | **6.77** (Lulus) | **2.72** (GAGAL) | **2.56** (GAGAL) |
| `HighlightAmber` (`mark #fbbf24`) | **9.57** (Lulus — bg `#4a350a`, fg `#e6e9f0`) | **9.57** (Lulus — bg `#4a350a`, fg `#e6e9f0`) | **14.33** (Lulus — bg `#fde68a`, fg `#0f172a`) | **14.33** (Lulus — bg `#fde68a`, fg `#0f172a`) |
| `HighlightEmerald` (`mark #34d399`) | **10.27** (Lulus — bg `#0d3b2e`, fg `#e6e9f0`) | **10.27** (Lulus — bg `#0d3b2e`, fg `#e6e9f0`) | **13.92** (Lulus — bg `#a7f3d0`, fg `#0f172a`) | **13.92** (Lulus — bg `#a7f3d0`, fg `#0f172a`) |
| `HighlightBlue` (`mark #7c9cff`) | **10.95** (Lulus — bg `#1e2d5a`, fg `#e6e9f0`) | **10.95** (Lulus — bg `#1e2d5a`, fg `#e6e9f0`) | **14.63** (Lulus — bg `#dbeafe`, fg `#0f172a`) | **14.63** (Lulus — bg `#dbeafe`, fg `#0f172a`) |
| `HighlightRose` (`mark #f87171`) | **11.89** (Lulus — bg `#4c1722`, fg `#e6e9f0`) | **11.89** (Lulus — bg `#4c1722`, fg `#e6e9f0`) | **12.66** (Lulus — bg `#fecdd3`, fg `#0f172a`) | **12.66** (Lulus — bg `#fecdd3`, fg `#0f172a`) |

Pembahasan opsi **warna semantik (token tema) vs hex tetap `#rrggbb`**, dampaknya terhadap `data-format.md` §5.4, serta kasus **frame `"none"`** ditulis lengkap di [`docs/open-questions.md`](../open-questions.md).

---

## 3. Hasil Benchmark FPS Campuran (LOD + Rich Text + 50 Gambar): Cull ON vs OFF, 3 Kali Jalan per Skenario

Dataset: `100` node (`17` `imageBox` PNG lokal + node kaya heading/list/mark/link/code + statis) dan `300` node (`50` `imageBox` PNG lokal + node kaya + statis). Setiap skenario dijalankan **3 kali** (`>= 3.2s`, `>= 150` frame per jalan) pada Chromium headless `1280×800` tanpa GPU ([`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)).

**Gerbang benchmark yang ditegakkan pada seluruh skenario `cullOn` (Tes #17):**
- `meanFps >= 30` per run & rata-rata antar-jalan ([`docs/testing.md`](../testing.md) §9.5),
- `p95Ms <= 50 ms` per run & rata-rata antar-jalan (sub-50 ms di bawah batas responsivitas operasi lokal `< 100 ms` di [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) §7.1),
- `maxMs <= 100 ms` per run & rata-rata antar-jalan pada skenario pan dan `zoom-out-all` (`spec-ui-nfr.md` §7.1), dan `maxMs <= 200 ms` (`mean maxMs <= 150 ms`) pada skenario `zoom` dinamis `cullOn` akibat *mount burst* ~64 node baru masuk viewport sekaligus.

| Skenario (`S2_FPS_BENCHMARKS`) | Node / Gbr | Ed | Gerak | Cull | `meanFps` (mean / median / `[min..max]`) | `p50Fps` | `p95Fps` | `p95Ms` (mean / `[min..max]`) | `maxMs` (mean / `[min..max]`) | `frameCount` | DOM / EdMin |
| --- | :---: | :---: | --- | :---: | --- | :---: | :---: | --- | --- | :---: | :---: |
| `s100_pan_1editor_cullOn` | 100 / 17 | 1 | pan | **ON** | **58.5 / 58.5** `[58.1..59.0]` | 59.9 | 59.6 | 16.8 `[16.7..16.8]` | 44.5 `[33.4..50.0]` | 187–189 | 9–22 / 1 |
| `s100_pan_1editor_cullOff` | 100 / 17 | 1 | pan | **OFF** | **60.2 / 60.3** `[60.1..60.3]` | 59.9 | 59.9 | 16.7 `[16.7..16.7]` | 16.8 `[16.8..16.8]` | 193–193 | 100–100 / 1 |
| `s100_zoom_1editor_cullOn` | 100 / 17 | 1 | zoom | **ON** | **52.7 / 52.9** `[52.0..53.2]` | 59.9 | 30.0 | 33.3 `[33.2..33.3]` | 83.4 `[83.4..83.4]` | 167–171 | 10–70 / 1 |
| `s100_zoom_1editor_cullOff` | 100 / 17 | 1 | zoom | **OFF** | **60.0 / 60.0** `[60.0..60.0]` | 59.9 | 59.6 | 16.8 `[16.7..16.8]` | 16.8 `[16.8..16.8]` | 193–193 | 100–100 / 1 |
| `s300_pan_0editor_cullOn` | 300 / 50 | 0 | pan | **ON** | **59.2 / 59.2** `[58.8..59.6]` | 59.9 | 59.5 | 16.8 `[16.8..16.8]` | 33.4 `[33.4..33.4]` | 189–191 | 9–22 / 0 |
| `s300_pan_0editor_cullOff` | 300 / 50 | 0 | pan | **OFF** | **60.1 / 60.1** `[60.0..60.2]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 22.3 `[16.8..33.3]` | 192–193 | 300–300 / 0 |
| `s300_pan_1editor_cullOn` | 300 / 50 | 1 | pan | **ON** | **59.0 / 59.2** `[58.5..59.3]` | 59.9 | 59.6 | 16.8 `[16.7..16.8]` | 33.4 `[33.3..33.4]` | 188–190 | 9–22 / 1 |
| `s300_pan_1editor_cullOff` | 300 / 50 | 1 | pan | **OFF** | **60.1 / 60.1** `[60.1..60.2]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 16.8 `[16.8..16.8]` | 193–193 | 300–300 / 1 |
| `s300_zoom_0editor_cullOn` | 300 / 50 | 0 | zoom | **ON** | **53.3 / 53.2** `[53.0..53.8]` | 59.9 | 30.0 | 33.3 `[33.3..33.3]` | 88.9 `[83.4..100.0]` | 170–173 | 10–74 / 0 |
| `s300_zoom_0editor_cullOff` | 300 / 50 | 0 | zoom | **OFF** | **59.8 / 59.7** `[59.7..60.0]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 27.9 `[16.8..33.4]` | 192–193 | 300–300 / 0 |
| `s300_zoom_1editor_cullOn` | 300 / 50 | 1 | zoom | **ON** | **51.8 / 51.4** `[51.3..52.6]` | 59.9 | 39.8 | 27.8 `[16.8..33.4]` | 89.0 `[83.4..100.1]` | 165–169 | 10–74 / 1 |
| `s300_zoom_1editor_cullOff` | 300 / 50 | 1 | zoom | **OFF** | **59.4 / 59.7** `[58.8..59.8]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 33.3 `[33.3..33.4]` | 189–192 | 300–300 / 1 |
| `s300_zoom_out_all_visible_1editor` | 300 / 50 | 1 | zoom-out-all (LOD) | **ON** | **59.9 / 59.9** `[59.8..60.1]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 27.8 `[16.8..33.4]` | 192–193 | 300–300 / 1 |

Detail `s300_zoom_out_all_visible_1editor` (`cullOn`, LOD enter `< 0.32` / title hidden `< 0.19`, 3 kali jalan):
- **Run 1:** `meanFps: 60.1`, `p50Fps: 59.9`, `p95Fps: 59.9`, `p95Ms: 16.7 ms`, `maxMs: 16.8 ms`, `frameCount: 193`, `durationMs: 3208.7 ms`
- **Run 2:** `meanFps: 59.9`, `p50Fps: 59.9`, `p95Fps: 59.5`, `p95Ms: 16.8 ms`, `maxMs: 33.4 ms`, `frameCount: 192`, `durationMs: 3203.7 ms`
- **Run 3:** `meanFps: 59.8`, `p50Fps: 59.9`, `p95Fps: 59.9`, `p95Ms: 16.7 ms`, `maxMs: 33.3 ms`, `frameCount: 192`, `durationMs: 3208.8 ms`

**Temuan arsitektural kunci (`Task S2c` & `S2c-F`):**
1. **Memisahkan `useViewport()` & posisi toolbar keluar dari komponen induk kanvas sama krusialnya dengan LOD:** Isolasi `FooterZoomLabel` & `FloatingToolbarOverlay` plus `LodViewportObserver` membuat `zoom-out-all` berjalan stabil pada **`59.9 fps` (`p95 16.7 ms`, `max 27.8 ms` rata-rata)** dan seluruh skenario `cullOn` bertahan di **`51.8–59.9 fps` (`p95Ms <= 33.4 ms`)**.
2. **Hysteresis LOD anti-kedip (`0.32` / `0.40` & `0.19` / `0.23`):** Menghindari 300 langganan `useViewportStore` per-node sekaligus memastikan osilasi zoom di sekitar batas LOD menghasilkan **0** pergantian mode dan font judul selalu `>= 11 px` di layar (atau disembunyikan saat kartu terlalu kecil).
3. **Ketahanan unmount editor aktif (Tes #12 & `activeEditorMinDuringRun: 1` di semua skenario 1-editor):**

| Kondisi (`S2_EDITOR_UNMOUNT_RESILIENCE`) | Status Mount saat Pan Off-Screen | Teks & Seleksi Setelah Pan Balik | Fokus & Undo Teks | Dampak Benchmark `cullOn` |
| --- | --- | --- | --- | --- |
| **Tanpa mitigasi** (node di dalam `.react-flow__node`) | Ter-unmount (`unmountedOffscreen: true`) | Seleksi & isi terputus (`selectionPreserved: false`) | Riwayat undo TipTap hilang (`undoPreserved: false`) | `activeEditorMinDuringRun: 0` saat pan off-screen |
| **Mitigasi `<ViewportPortal>`** (`SpikeApp.tsx`) | Tetap hidup (`remainedMountedOffscreen: true`) | Seleksi terjaga (`selectionPreserved: true`) | Fokus & undo utuh (`focusPreserved: true`, `undoPreserved: true`) | `activeEditorMinDuringRun: 1`; pan `58.5–59.0 fps`, parity `diffPixels: 0` |

---

## 4. Uji Mutasi per Penahan & Cakupan Browser / CI

### Mutasi Penahan (diterapkan satu per satu lalu di-revert; `git diff --exit-code` bersih setelah setiap revert)

| # | Mutasi Penahan | File | Tes yang Gagal & Fakta Kegagalan | Diff Bersih Setelah Revert |
| --- | --- | --- | --- | --- |
| 1 | Hapus `nodrag` | `TextCanvasNode.tsx` | **Tes #3 gagal** (`Expected: 80, Received: 203` saat drag pada node edit dengan `dragHandle` dilepas di tes); dalam eksekusi termutasi yang sama Tes #5 (`initialSelection: ""`) dan Tes #7 (`"Alpha Bravo Charlie DeltaTRA_WORD"`) juga terdampak. | `git diff --exit-code` -> exit `0` |
| 2 | Hapus `nowheel` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`vpEditAfterWheel` berubah menjadi `{ x: -70.85..., y: -297.70..., zoom: 1.283... }`). | `git diff --exit-code` -> exit `0` |
| 3 | Hapus `nopan` | `TextCanvasNode.tsx` | **Tes #4 gagal** (drag pada padding `card-surface-box-edit` di mode `Hand` menggeser viewport ke `{ x: 120, y: 60, zoom: 1 }`); pada eksekusi tersebut Tes #5 (`initialSelection: ""`) juga gagal. | `git diff --exit-code` -> exit `0` |
| 4 | Hapus `onWheelCapture` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`scrollStaticAfter === 0`, `box-scroll` statis gagal scroll). | `git diff --exit-code` -> exit `0` |
| 5 | Hapus `stopPropagation` pada `keydown` | `ActiveTipTapEditor.tsx` | **Tes #1 gagal** (`getLeakedCanvasKeydowns()` mengembalikan **`22`**, seharusnya **`0`**). | `git diff --exit-code` -> exit `0` |

### Pengujian Lintas Browser (`Playwright`) & Status CI

- **Chromium:** **17/17 lulus** (`3.3m` pada suite lokal `spikes/s2-tiptap-reactflow/playwright.config.ts`).
- **Firefox & WebKit:** Tidak tersedia biner Playwright terpasang di cache lokal (`Executable doesn't exist`).
- **Apakah suite spike dijalankan di GitHub Actions CI?** **Tidak.** Workflow [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) menjalankan `pnpm test:e2e` yang hanya mengeksekusi Playwright config root (`e2e/`), dan tidak ditambah job spike tanpa persetujuan pemilik.

---

## 5. Audit Whitelist Skema (`src/domain/schema` vs TipTap Output) & Sanitasi `href`

1. **Paragraf tanpa perataan (`{ textAlign: null }`):**
   Di Tes #8 (`S2_PLAIN_PARAGRAPH_CHECK`), mengetik teks biasa tanpa perataan menghasilkan **`attrs: { "textAlign": null }`**, sehingga **`parseCanvasJson`** asli melaporkan `disallowed_tiptap_attr` (`Removed disallowed attributes on "paragraph" node.`) lalu mengembalikan `status: "ok"`. Skema tetap tidak diubah.
2. **Atribut ekstra `Link`:** `@tiptap/extension-link@3.34.0` menyertakan `target`, `rel`, `class`, `title` di `mark.attrs`.
3. **Uji langsung JSON buatan ke `parseCanvasJson` (`S2_CRAFTED_HREF_SCHEMA`, tanpa paste):** ke-5 payload berbahaya dibuang (`disallowed_link_href`); hanya `http`, `https`, dan `mailto` yang dipertahankan.

---

## 6. Audit `GHSA-fc5q-39xc-vjpf` (`picomatch`) — Keluaran `gh api` & Selisih Halaman Web

- **URL Advisory GitHub:** https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- **Keluaran `gh api /advisories/GHSA-fc5q-39xc-vjpf --jq '{ghsa_id, html_url, type, summary, severity, withdrawn_at, updated_at, published_at, vulnerabilities}'`:**

```json
{
  "ghsa_id": "GHSA-fc5q-39xc-vjpf",
  "html_url": "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  "published_at": "2026-10-19T18:32:12Z",
  "severity": "high",
  "summary": "Withdrawn Advisory: picomatch vulnerable to ReDoS through single-branch repeated extglobs",
  "type": "reviewed",
  "updated_at": "2026-11-18T15:38:58Z",
  "vulnerabilities": [
    {
      "first_patched_version": null,
      "package": {
        "ecosystem": "npm",
        "name": "picomatch"
      },
      "vulnerable_functions": [],
      "vulnerable_version_range": "<= 4.0.7"
    }
  ],
  "withdrawn_at": "2026-11-18T15:38:56Z"
}
```

- **Penjelasan selisih `gh api` vs halaman web advisory (`Unreviewed`, tanpa paket):**
  1. Advisory awalnya berstatus `reviewed` (`github_reviewed_at: "2026-11-17T15:56:42Z"`), namun kemudian **ditarik** (`withdrawn_at: "2026-11-18T15:38:56Z"`, `updated_at: "2026-11-18T15:38:58Z"`, deskripsi mencatat: *"This advisory has been withdrawn... This link is maintained to preserve external references."*).
  2. Ketika ditarik, GitHub melepas entri dari indeks advisory reviewed aktif (Dependents/Dependabot/`npm audit`/`pnpm audit`) sehingga di halaman web UI tampil sebagai advisory ditarik/`Unreviewed` tanpa paket terdampak aktif, sedangkan endpoint REST `/advisories/GHSA-fc5q-39xc-vjpf` tetap mempertahankan snapshot metadata historis (`type: "reviewed"` dan array `vulnerabilities` asli `picomatch <= 4.0.7`).
- **Output mentah `pnpm audit --json` (`2026-11-19`, identik dengan `--config.auditConfig.ignoreGhsas=`):** `advisories: {}`, semua hitungan kerentanan `0` (`dependencies: 171`, `devDependencies: 337`, `optionalDependencies: 84`, `totalDependencies: 525`).
- **Status di `pnpm-workspace.yaml` (Task S2c):** Entri `ignoreGhsas: [GHSA-fc5q-39xc-vjpf]` telah **dihapus** dari [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml); baik `pnpm audit --prod` maupun `pnpm audit` tetap bersih (`0` kerentanan).

---

## 7. Risiko yang Belum Diuji pada Spike S2

1. **Komposisi IME (CJK / aksara non-ASCII).**
2. **Interaksi sentuh / mobile (pinch zoom, long-press drag, keyboard virtual).**
3. **Aksesibilitas lanjutan & warna teks hex tema light:** screen reader ARIA, fokus `Tab` ke toolbar, serta pemilihan **warna semantik vs hex tetap** pada `textStyle.color` di mode light (seluruh 4 pasangan `Highlight` dark & light sudah lulus WCAG AA pada Task S2c).
4. **Uji Firefox & WebKit/Safari sungguhan serta verifikasi FPS `> 50` pada browser desktop ber-GPU** (ketahanan unmount editor aktif saat `cullOn` sudah tervalidasi lewat `<ViewportPortal>`).
