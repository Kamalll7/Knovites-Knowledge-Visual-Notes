# Laporan Spike S2 — TipTap di Dalam `@xyflow/react` (Pembaruan S2b)

- **Verdict:** **LOLOS BERSYARAT (Conditional Pass) — `FR-CVS-08 belum terbukti`.** Seluruh kebutuhan inti S2 dan **S2b** (frame teks `"none"` tanpa properti baru, kontrak `resizePolicy` 8-handle generik di `<ViewportPortal>`, mode teks `reflow` vs `scale` non-destruktif `[0.5, 3.0]` + undo 1 langkah per gestur, blok kode `white-space: pre; overflow-x: auto` + paritas sempit `200 px` & `340 px`, auto-zoom + `setCenter` saat edit dari zoom `< LOD`, penghapusan `attrs: { textAlign: null }` + penolakan `justify`, seluruh **40 kombinasi token warna semantik & `Highlight`** lulus WCAG AA `>= 4.5:1` di dark/light × `card`/`none`, serta gerbang benchmark `meanFps >= 30`, `p95Ms <= 50`, `maxMs <= 50.1` pada **seluruh** skenario pan, zoom dinamis, dan `zoom-out-all`) lulus **22/22 tes Playwright** (`2.2m`) pada Chromium headless. **`FR-CVS-08 belum terbukti`** penuh karena: (1) uji berjalan di Playwright Chromium headless tanpa GPU desktop; (2) benchmark spike memakai bitmap lokal sintetis bukan foto terkompresi/thumbnail impor nyata (`FR-IMG-03`); (3) suite spike **tidak dijalankan di GitHub Actions CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) hanya menjalankan `pnpm test:e2e` pada `e2e/`).
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s2-tiptap-reactflow/`](../../spikes/s2-tiptap-reactflow/)
- **Artifak screenshot di `spikes/s2-tiptap-reactflow/out/` (hanya 5 PNG berikut yang dipertahankan; berkas lain di `out/` di-gitignore via [`out/.gitignore`](../../spikes/s2-tiptap-reactflow/out/.gitignore)):**
  - [`canvas-static-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png)
  - [`canvas-edit-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)
  - [`canvas-static-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png)
  - [`canvas-edit-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)
  - [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)
- **Versi library terpasang & dokumentasi resmi yang dirujuk sebelum implementasi:**
  - `@xyflow/react@13.0.2` (`NodeResizeControl`, `ResizeControlVariant`, `useReactFlow().setCenter`, `useKeyPress`, `ViewportPortal`, `onlyRenderVisibleElements`): https://reactflow.dev/api-reference/components/node-resize-control dan deklarasi tipe lokal `node_modules/@xyflow/react/dist/index.d.ts` (mengonfirmasi `NodeResizeControl` menambahkan `.nodrag` secara internal, **tidak** menyertakan `.nopan`/`.nowheel`, mendukung ke-8 posisi handle lewat `variant={ResizeControlVariant.Handle}`, serta meneruskan event `position` + `dimensions`).
  - `@tiptap/react@3.34.0`, `@tiptap/starter-kit@3.34.0`, `@tiptap/static-renderer@3.34.0`, `@tiptap/extension-text-style@3.34.0`, `@tiptap/extension-highlight@3.34.0`, `@tiptap/extension-text-align@3.34.0` (https://www.tiptap.dev/api/extensions/text-align dan `node_modules/@tiptap/extension-text-align/dist/index.js`, yang secara bawaan menetapkan `defaultAlignment: null` sehingga menulis `attrs: { textAlign: null }` pada paragraf polos).
- **Dokumen rujukan:** [`docs/spec-canvas.md`](../spec-canvas.md) (§6.4 `FR-CVS-01`, `FR-CVS-03`, `FR-CVS-04`, `FR-CVS-05`, `FR-CVS-06`, `FR-CVS-08`; §6.5 `FR-TXT-01`, `FR-TXT-03`, `FR-TXT-04`, `FR-TXT-06`, `FR-TXT-08`; `FR-IMG-03`), [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) (§7.1, §7.4, §8.1), [`docs/testing.md`](../testing.md) (§9.4–§9.5), [`docs/data-format.md`](../data-format.md) (§5.4), ADR [`0003-xyflow-and-tiptap-packages.md`](../decisions/0003-xyflow-and-tiptap-packages.md), dan [`docs/open-questions.md`](../open-questions.md).

---

## 1. Solusi yang Dipilih (S2 + S2b)

1. **Renderer statis tanpa `dangerouslySetInnerHTML` + cache `WeakMap` per `doc`:**
   [`StaticTextContent.tsx`](../../spikes/s2-tiptap-reactflow/StaticTextContent.tsx) memakai `@tiptap/static-renderer/pm/react@3.34.0` (`MIT`, `renderToReactElement`) tanpa HTML string. Untuk mencegah `renderToReactElement` membangun ulang schema ProseMirror & pemetaan ekstensi ~64 kali dalam 1 frame saat *mount burst* culling (`zoom`), hasil pohon React element yang bersifat immutable di-cache dalam `WeakMap<TipTapDoc, ReactNode>` berdasarkan referensi objek `doc` (bersama pemisahan `FloatingToolbarBody` ke dalam `React.memo` dan posisi `translate3d`, menurunkan `maxMs` skenario zoom `cullOn` menjadi **`33.4–50.1 ms`**).
2. **Satu instance TipTap aktif (MIT only), `NoNullTextAlign`, & token semantik:**
   Hanya node berstatus `isEditing === true` yang me-mount `ActiveTipTapEditor` (`TipTap instances: 0 | 1`). Ekstensi MIT: `StarterKit` (`heading: { levels: [1, 2, 3] }`, `link: false`, `underline: false`, `trailingNode: false`), `Underline`, `Link` (allowlist `http`, `https`, `mailto`, `knovites:`, `rel="noopener noreferrer"` pada render statis), `TextStyle`, `FontFamily`, `FontSize`, `SemanticColor` (token `accent`, `warning`, `success`, `danger`, `violet`), `Highlight` (berpasangan latar+teks per tema di [`spike.css`](../../spikes/s2-tiptap-reactflow/spike.css)), dan `NoNullTextAlign` (`alignments: ['left', 'center', 'right']`, membungkus `editor.getJSON()` untuk menghapus `textAlign: null` dan objek `attrs` kosong, serta menolak `justify` di editor, paste, dan `sanitizeSpikeDoc`).
3. **Frame teks `"none"` tanpa properti baru (`FR-CVS-05`):**
   `style.bg` dan `style.border` menerima `null` (`Auto`) | `#rrggbb` | `"none"` (tanpa properti `frame` baru di state/snapshot spike; skema `src/domain/schema/` tetap tidak diubah). Toggle **"Box"/"None"** di toolbar menyetel `bg` dan `border` sekaligus. Mode `"none"` memakai tinggi otomatis (`Auto`), seluruh *bounding box* (termasuk ruang kosong kanan/bawah paragraf pendek) tetap menerima klik/double-click, border `1px` dipertahankan `transparent` dan ring hover/seleksi/edit dirender via `box-shadow` / `outline` agar nol pergeseran layout, serta node kosong menampilkan garis putus-putus (`Empty note…` + `[data-empty="true"]`) agar tidak hilang.
4. **Kontrak `resizePolicy` generik, 8 handle di `<ViewportPortal>`, & mode `reflow` vs `scale`:**
   - Komponen bersama [`ResizeHandles.tsx`](../../spikes/s2-tiptap-reactflow/ResizeHandles.tsx) merender **8 handle** (4 sisi + 4 sudut via `NodeResizeControl` `ResizeControlVariant.Handle`) **hanya ketika node `selected || isEditing`**, dengan pembungkus kelas `nodrag nopan nowheel` + handler `onWheelCapture`/`onPointerDownCapture` agar wheel/drag pada handle tidak memicu pan/zoom kanvas.
   - Kontrak [`RESIZE_POLICIES`](../../spikes/s2-tiptap-reactflow/rich-text-config.ts):
     - **`text`:** `minW: 160`, `maxW: 1200`, `minScale: 0.5`, `maxScale: 3.0`, mode **`reflow`** (lebar `w` berubah, `fontSize` dokumen utuh, tinggi otomatis) atau **`scale`** (skala visual non-destruktif `transform: scale(textScale)` proporsional, `fontSize` dokumen tetap utuh).
     - **`image`:** `minW: 80`, `minH: 60`, `maxW: 2000`, `maxH: 2000`, `keepAspectRatio: true` secara default (sisi & sudut proporsional), terbuka ke bebas saat `Shift` ditahan (`useKeyPress('Shift')` di [`ImageCanvasNode.tsx`](../../spikes/s2-tiptap-reactflow/ImageCanvasNode.tsx)).
     - **`terminal` (kontrak dokumen konseptual saja, belum ada widget runtime):** `minW: 320`, `maxW: 1400`, `minH: 180`, `maxH: 900`, `kind: 'free'` (`keepAspectRatio: false`).
   - **Undo resize & `Ctrl+Z` edit:** 1 gestur resize utuh (`onResizeStart` -> banyak `onResize` -> `onResizeEnd`) mendorong tepat **1 snapshot undo** jika geometri berubah; selama mode edit aktif, `Ctrl+Z` hanya meng-undo riwayat ProseMirror (tidak menggeser kanvas atau ukuran).
   - **`ResizeObserver` kondisional:** Pada node teks di jalur statis/normal (`scale === 1 && resizeMode === 'reflow'`), `ResizeObserver` tidak dipasang sehingga tidak menambah biaya reflow layout saat benchmark; observer hanya aktif untuk node ber-`textScale !== 1` atau mode `scale` untuk menjaga ukuran *bounding box* ter-skala.
5. **Perbandingan `reflow` vs `scale` & opsi UX (toggle vs gestur sudut):**

   | Aspek | Mode `reflow` (default teks) | Mode `scale` (`textScale`) |
   | --- | --- | --- |
   | Efek drag handle | Mengubah `width` (`160–1200 px`), baris membungkus ulang, tinggi otomatis (`Auto`). | Mengubah `textScale` (`0.5–3.0x`) lewat `transform: scale(textScale)`, *font size* dokumen & lebar logis `w` tetap utuh. |
   | Efek ke PDF/Markdown/diff JSON | Nihil pada dokumen (hanya `w` berubah). | Minimal (hanya 1 properti `textScale` pada elemen, tidak mengubah `fontSize` di ratusan run teks). |
   | Keunggulan di viewport | Keterbacaan tetap konstan sesuai ukuran font dokumen. | Dapat memperbesar judul/diagram kecil secara instan layaknya papan tulis visual. |
   | **Trade-off UX (menunggu keputusan pemilik)** | **Toggle toolbar (`Reflow`/`Scale`):** prediktif di semua 8 handle tanpa kejutan saat merapikan lebar lewat sudut (1 klik tambahan). | **Gestur sisi vs sudut (alternatif):** sisi = `reflow`, sudut = `scale` lebih cepat tanpa toggle, tetapi rentan salah-skala saat pengguna hanya ingin menyeret sudut untuk melebarkan kartu. |

6. **Blok kode scroll horizontal (`FR-TXT-03`) & paritas lebar sempit:**
   [`spike.css`](../../spikes/s2-tiptap-reactflow/spike.css) menyetel `white-space: pre; overflow-x: auto; max-width: 100%;` baik pada `.knovites-richtext pre` maupun `.knovites-richtext .ProseMirror pre`, dan [`TextCanvasNode.tsx`](../../spikes/s2-tiptap-reactflow/TextCanvasNode.tsx) mengisolasi event wheel (`deltaX`, `Shift+Wheel`, atau saat mengedit) di dalam `<pre>` yang meluap agar kanvas tidak ikut zoom/pan saat menggeser baris kode panjang.
7. **Auto-zoom & `setCenter` saat masuk edit dari zoom `< LOD` (`FR-CVS-01`, `FR-CVS-04`):**
   Di [`SpikeApp.tsx`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx), memanggil `enterEditMode` ketika `zoom < LOD_ENTER_ZOOM` (`0.32`) langsung memusatkan kamera ke titik tengah kotak pada `zoom: 1` (`reactFlow.setCenter(cx, cy, { zoom: 1, duration: 220 })` / `0` bila `prefers-reduced-motion`).
8. **Toolbar tetap di luar transform kanvas (`FR-TXT-01`) & HUD di footer terpisah:**
   [`FloatingToolbar.tsx`](../../spikes/s2-tiptap-reactflow/FloatingToolbar.tsx) berukuran konstan **`616×38 px`** (tombol `28 px`) di luar `.react-flow__viewport`, memuat kontrol Align (`L`/`C`/`R`), 5 swatch token warna semantik, Highlight (`W`/`S`/`A`/`D`), toggle frame (`Box`/`None`), toggle mode resize (`Reflow`/`Scale`), serta indikator efektif ukuran font (`toolbar-size-effective`, mis. `24px` saat `16px × 1.5`) ketika `textScale !== 1`. HUD FPS ditempatkan di `<footer data-testid="s2-status-footer">` terpisah agar tidak menimpa node maupun atribusi React Flow.

---

## 2. Daftar Tes Playwright (22 Tes), Paritas Visual, Toolbar Zoom & Kontras WCAG

Seluruh suite dijalankan lokal di Playwright Chromium (`pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts`) — **`22 passed (2.2m)`**. Suite spike ini **tidak** dijalankan di GitHub Actions CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) hanya menjalankan `pnpm test:e2e` pada `e2e/`).

**Penambahan tes pada S2b (#17–#21) dan pembaruan #9, #11, #14, #22:** Menambahkan uji khusus frame teks `"none"` (**Tes #17**), blok kode `pre` + wheel horizontal + paritas `200 px`/`340 px` (**Tes #18**), 8-handle `resizePolicy` + isolasi handle + default rasio gambar (**Tes #19**), `reflow` vs `scale` + undo 1 langkah + caret/seleksi skala di zoom `0.5/1/2` (**Tes #20**), serta `textAlign` tanpa `null` & penolakan `justify` (**Tes #21**), plus pembaruan whole-node parity dark/light × auto/none (**Tes #9**), token semantik WCAG AA (**Tes #11**), dan auto-zoom+center dari `< LOD` (**Tes #14**).

| # | Nama Tes di `s2.spec.ts` | Status | Hasil / Mekanisme Terverifikasi |
| --- | --- | :---: | --- |
| 1 | `1. mengetik teks termasuk spasi tidak memicu pan (Space) maupun tool shortcut H, T, I, ], [` | **Lulus** | Mengetik spasi, `H/T/I`, `]/[`, serta menahan `Space` + drag tidak mengubah `tool`, `zIndex`, maupun viewport; `getLeakedCanvasKeydowns() === 0`. |
| 2 | `2. Backspace dan Delete saat mengedit TIDAK menghapus elemen` | **Lulus** | Saat edit node tidak terhapus; `Escape` meng-unmount editor (`TipTap instances: 0`) dan `Delete` di luar edit menghapus node. |
| 3 | `3. memilih teks dengan drag mouse tidak memindahkan kotak` | **Lulus** | Drag teks di `.ProseMirror` memilih karakter tanpa mengubah `(x, y)`; saat `dragHandle` dilepas di tes, `.nodrag` tetap menghentikan `d3-drag`. |
| 4 | `4. scroll/wheel/nopan di dalam kotak tidak mengubah zoom atau pan kanvas` | **Lulus** | `onWheelCapture` (`box-scroll`), `.nowheel`, dan `.nopan` saat tool Hand mengisolasi scroll dan drag isi. |
| 5 | `5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format` | **Lulus** | Bold, warna token `accent`, ukuran `24px`, Font `JetBrains Mono`, dan `textAlign: center` diterapkan sambil menjaga seleksi non-collapsed. |
| 6 | `6. gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi` | **Lulus** | Drag pada `[data-testid="drag-handle-box-second"]` memindahkan kotak; `Space`+drag pan dan `Ctrl`+wheel zoom tetap jalan. |
| 7 | `7. Ctrl/Cmd+Z saat mengedit hanya membatalkan teks, bukan operasi kanvas` | **Lulus** | `Ctrl+Z` saat edit hanya membatalkan teks; setelah keluar edit (`Escape`), `Ctrl+Z` membatalkan perpindahan drag kanvas. |
| 8 | `8. paste teks berformat dibersihkan sesuai whitelist` | **Lulus** | 5 payload `href` berbahaya disanitasi via paste & `parseCanvasJson` (`disallowed_link_href`); paragraf polos `stateParaAttrs: null`, `editorGetJsonParaAttrs: null`. |
| 9 | `9. paritas visual & geometri seluruh node (border/ring/padding) untuk frame auto & none di tema dark & light` | **Lulus** | Seluruh geometri (`width: 340`, `height: 283.05`, `borderWidth: 1px`, `padding: 14px`) identik pada `dark/light × auto/none`; piksel beda hanya `0.702–0.816%` (*outer focus ring*). |
| 10 | `10. toolbar berukuran tetap di luar transform kanvas, terbaca di semua zoom, dan tidak menutupi node` | **Lulus** | `closest('.react-flow__viewport') === null`; ukuran konstan **`616×38 px`** (tombol `28 px`) pada zoom `1.0`, `0.25`, `2.5` dengan `overlapsNode: false`, dan flip ke bawah dekat tepi atas. |
| 11 | `11. ukur rasio kontras WCAG 2.1 untuk token warna semantik & highlight di tema dark/light dan frame card/none (semua >= 4.5)` | **Lulus** | Seluruh **40 pasangan** (`Auto`, 5 token teks, 4 token highlight × dark/light × `card`/`none`) mencapai `5.16–17.85:1` (`passAA: true`). |
| 12 | `12. editor aktif tetap hidup saat node di-pan keluar layar (culling ON): tanpa vs dengan mitigasi ViewportPortal` | **Lulus** | Tanpa mitigasi: unmount offscreen, seleksi & undo hilang. Dengan `<ViewportPortal>`: tetap hidup (`activeEditor: 1`), seleksi, fokus, & undo utuh. |
| 13 | `13. resize dan drag gagang saat mengedit di ViewportPortal mengikuti posisi dan ukuran tanpa lompatan (reflow & scale)` | **Lulus** | Drag gagang memindahkan kotak & portal selaras (`<= 1.5 px`); resize `-140 px` me-reflow tinggi identik dan berskala di zoom `0.75` & `1.5`. |
| 14 | `14. edit di zoom < ambang LOD: zoom otomatis ke tingkat terbaca dan memusatkan node dengan caret & seleksi berfungsi` | **Lulus** | Double-click dari zoom `0.25` otomatis menaikkan viewport ke `zoom = 1` dan memusatkan node di layar (`<= 48 px` deviasi pusat); editor, caret, seleksi, & format aktif. |
| 15 | `15. node yang sedang diedit dihapus atau pilihan berpindah: editor unmount bersih tanpa kebocoran dan tanpa kehilangan teks` | **Lulus** | Berpindah pilih & menghapus node saat aktif edit meng-unmount bersih (`0`/`1` instance) tanpa kehilangan teks maupun `Ctrl+Z`. |
| 16 | `16. LOD: font judul placeholder >= 11 px di layar atau disembunyikan dan bebas kedip di sekitar ambang zoom` | **Lulus** | Zoom `0.25`: font layar `>= 11 px`; zoom `0.105`: judul disembunyikan; osilasi `[0.33..0.39]` mencatat **0 pergantian** (hysteresis `0.32`/`0.40`). |
| 17 | `17. frame teks "none": toggle bg/border sekaligus, tinggi otomatis, area kosong dapat diklik, dan node kosong tetap terlihat` | **Lulus** | `toolbar-frame-toggle` mengubah `style.bg` & `style.border` ke `"none"` sekaligus dan memulihkan `null`; tinggi auto + box-shadow hover/seleksi tanpa geser layout; klik ruang kanan kartu masuk edit; node kosong tampil dashed (`[data-empty="true"]`). |
| 18 | `18. blok kode white-space: pre (scroll horizontal di overflow), isolasi wheel horizontal, dan paritas lebar sempit 200 px & 340 px` | **Lulus** | Static & `.ProseMirror pre` memakai `white-space: pre`, `overflow-x: auto`, `scrollWidth > clientWidth`; wheel horizontal di dalam `<pre>` tidak memindahkan viewport; paritas `richtext-body` `diffPercent: 0%` di `200 px` & `340 px`. |
| 19 | `19. resize generik 8 handle hanya saat terpilih, isolasi pan/zoom/drag handle, batas minimum, & rasio gambar terkunci default` | **Lulus** | 8 handle hanya saat `selected`; `Ctrl+Wheel` & drag mode `Hand` di atas handle menjaga viewport tetap `{0,0,1}`; batas `minW=160` (`text`) & `minW=80, minH=60` (`image`); rasio aspek gambar `240:150` (`1.6`) tetap terjaga (`|diff| < 0.06`). |
| 20 | `20. teks mode reflow vs scale (textScale, undo 1 langkah, fontSize doc utuh, & caret/seleksi di scale zoom 0.5/1/2)` | **Lulus** | Drag `+170 px` di mode `scale` menghasilkan `textScale` proporsional (`|textScale - expected| <= 0.06`), lebar kotak mengikuti `+170 px` (`<= 6 px`), `doc` `fontSize` utuh, `Ctrl+Z` edit hanya membatalkan ketikan, keluar edit meng-undo seluruh gestur dalam **1 langkah** (`undoCount` kembali), dan mengetik + seleksi bekerja pada scale zoom `0.5`, `1`, `2`. |
| 21 | `21. textAlign: editor.getJSON() tanpa attrs null; center/right diterima; justify ditolak di editor, paste & sanitasi` | **Lulus** | Paragraf polos `editor.getJSON()` bebas key `attrs`; `center` & `right` tercatat; paste HTML & JSON langsung `justify` dibersihkan tanpa lolos ke state atau domain sanitizer. |
| 22 | `22. benchmark FPS pan-only, zoom-only, culling ON vs OFF, 3 runs per scenario (LOD + rich text + 50 images)` | **Lulus** | 7 skenario `cullOn` (1/3 node `frame: "none"` + resize handle aktif) × **3 kali jalan** lulus `meanFps >= 30` (`56.6–59.8 fps`), `p95Ms <= 50` (`16.7–22.3 ms`), dan `maxMs <= 50.1 ms`. |

### 2.1 Ringkasan Paritas Visual Whole-Node (Tes #9), Kode `200/340 px` (Tes #18), & Toolbar (Tes #10)

- **Whole-node `card-surface-box-rich` (`340×283.05 px`, border `1px`, padding `14px`, static vs edit):**
  - `dark_auto`: `diffPixels: 678` (`0.702%`) — [`canvas-static-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png) vs [`canvas-edit-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)
  - `light_auto`: `diffPixels: 788` (`0.816%`) — [`canvas-static-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png) vs [`canvas-edit-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)
  - `dark_none`: `diffPixels: 688` (`0.713%`); `light_none`: `diffPixels: 745` (`0.772%`)
  - *Catatan:* perbedaan piksel seluruh kartu semata berasal dari anti-aliasing *outer focus ring* (`box-shadow: 0 0 0 2px var(--accent)`) pada 4 sisi/sudut; geometri `width`, `height`, `borderWidth`, dan `padding` identik presisi.
- **Paritas blok kode (`white-space: pre; overflow-x: auto`, Tes #18):**
  - `200 px`: `card-surface` `200×129` (`diffPercent: 2.085%` perimeter ring), `richtext-body` `170×99` (**`diffPercent: 0%`**).
  - `340 px`: `card-surface` `340×104` (`diffPercent: 0.962%` perimeter ring), `richtext-body` `310×74` (**`diffPercent: 0%`**).
- **Invariansi toolbar (`S2_TOOLBAR_ZOOM_INVARIANCE`, Tes #10):** `616×38 px`, tombol Bold `28 px`, `overlapsNode: false` pada zoom `1.0`, `0.25`, dan `2.5`.

### 2.2 Rasio Kontras Terhitung WCAG 2.1 (`S2_CONTRAST_RATIOS`, Tes #11)

Semua **40** kombinasi warna teks semantik + `Highlight` terukur lewat `getComputedStyle(el)` memenuhi batas minimum WCAG AA (`>= 4.5:1`):

| Sampel Token | Dark `card` (`rgb(17,21,29)`) | Dark `frame: "none"` (`rgb(20,20,20)`) | Light `card` (`rgb(255,255,255)`) | Light `frame: "none"` (`rgb(246,248,252)`) |
| --- | :---: | :---: | :---: | :---: |
| `AutoText` (`--fg`) | **15.04** (`rgb(230,233,240)`) | **15.16** | **17.85** (`rgb(15,23,42)`) | **16.79** |
| `TokenAccent` | **7.01** (`rgb(124,156,255)`) | **7.07** | **6.47** (`rgb(52,81,209)`) | **6.09** |
| `TokenWarning` | **10.95** (`rgb(251,191,36)`) | **11.04** | **7.09** (`rgb(146,64,14)`) | **6.67** |
| `TokenSuccess` | **9.51** (`rgb(52,211,153)`) | **9.58** | **5.48** (`rgb(4,120,87)`) | **5.16** |
| `TokenDanger` | **6.61** (`rgb(248,113,113)`) | **6.66** | **6.47** (`rgb(185,28,28)`) | **6.09** |
| `TokenViolet` | **6.72** (`rgb(167,139,250)`) | **6.77** | **7.10** (`rgb(109,40,217)`) | **6.68** |
| `HighlightWarning` | **9.57** (bg `74,53,10` / fg `230,233,240`) | **9.57** | **14.33** (bg `253,230,138` / fg `15,23,42`) | **14.33** |
| `HighlightSuccess` | **10.27** (bg `13,59,46` / fg `230,233,240`) | **10.27** | **13.92** (bg `167,243,208` / fg `15,23,42`) | **13.92** |
| `HighlightAccent` | **10.95** (bg `30,45,90` / fg `230,233,240`) | **10.95** | **14.63** (bg `219,234,254` / fg `15,23,42`) | **14.63** |
| `HighlightDanger` | **11.89** (bg `76,23,34` / fg `230,233,240`) | **11.89** | **12.66** (bg `254,205,211` / fg `15,23,42`) | **12.66** |

Pembahasan proposal dampak skema warna semantik vs `#rrggbb` saat paste ditulis di [`docs/open-questions.md`](../open-questions.md).

---

## 3. Hasil Benchmark FPS S2b (`cullOn` × 3 Runs, `frame: "none"` + Handle Resize Aktif + Cache `StaticTextContent`)

Dataset S2b mempertahankan komposisi `100` (`17` `imageBox`) dan `300` node (`50` `imageBox` + node kaya heading/list/link/kode) dengan tambahan **1/3 node ber-`frame: "none"`** serta **1 node `selected` menampilkan 8 handle resize** selama pengukuran (`3 runs × >= 3.2s`, `>= 150` frame/run, [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)). *Catatan cakupan:* pada S2b dijalankan penuh ke-7 skenario ber-gerbang `cullOn` (perbandingan `cullOff` sebelumnya pada S2c menghasilkan `14.0–21.0 fps` tanpa optimasi isolasi viewport vs `59.4–60.2 fps` setelah isolasi `useViewport()`).

| Skenario (`S2_FPS_BENCHMARKS`, S2b) | Node / Gbr | Ed | Gerak | `meanFps` (mean / median / `[min..max]`) | `p50Fps` | `p95Fps` | `p95Ms` (mean / `[min..max]`) | `maxMs` (mean / `[min..max]`) | `frameCount` | DOM / EdMin |
| --- | :---: | :---: | --- | --- | :---: | :---: | --- | --- | :---: | :---: |
| `s100_pan_1editor_cullOn` | 100 / 17 | 1 | pan | **59.8 / 60.0** `[59.3..60.2]` | 59.9 | 59.6 | 16.8 `[16.7..16.8]` | 22.3 `[16.8..33.4]` | 190–193 | 9–21 / 1 |
| `s100_zoom_1editor_cullOn` | 100 / 17 | 1 | zoom | **57.5 / 57.5** `[57.2..57.7]` | 59.9 | 59.5 | 16.8 `[16.8..16.8]` | 33.4 `[33.4..33.4]` | 184–185 | 10–70 / 1 |
| `s300_pan_0editor_cullOn` | 300 / 50 | 0 | pan | **59.5 / 59.8** `[59.0..59.8]` | 59.9 | 59.6 | 16.8 `[16.7..16.8]` | 38.8 `[33.2..50.0]` | 189–192 | 9–22 / 0 |
| `s300_pan_1editor_cullOn` | 300 / 50 | 1 | pan | **59.6 / 59.7** `[59.4..59.7]` | 59.9 | 59.9 | 16.7 `[16.7..16.7]` | 33.4 `[33.3..33.4]` | 190–192 | 9–22 / 1 |
| `s300_zoom_0editor_cullOn` | 300 / 50 | 0 | zoom | **56.6 / 56.6** `[56.0..57.1]` | 59.9 | 49.7 | 22.3 `[16.8..33.3]` | 39.0 `[33.4..50.1]` | 180–183 | 10–74 / 0 |
| `s300_zoom_1editor_cullOn` | 300 / 50 | 1 | zoom | **56.9 / 57.2** `[56.3..57.2]` | 59.9 | 59.5 | 16.8 `[16.8..16.8]` | 38.9 `[33.4..50.0]` | 181–184 | 10–74 / 1 |
| `s300_zoom_out_all_visible_1editor` | 300 / 50 | 1 | zoom-out-all (LOD) | **59.3 / 59.7** `[58.3..60.0]` | 59.9 | 59.8 | 16.7 `[16.7..16.8]` | 38.9 `[33.3..50.0]` | 187–192 | 300–300 / 1 |

Detail `s300_zoom_out_all_visible_1editor` (`cullOn`, LOD, 3 runs):
- **Run 1:** `meanFps: 59.7`, `p50Fps: 59.9`, `p95Fps: 59.9`, `p95Ms: 16.7 ms`, `maxMs: 33.4 ms`, `frameCount: 191`, `durationMs: 3201.0 ms`
- **Run 2:** `meanFps: 60.0`, `p50Fps: 59.9`, `p95Fps: 59.9`, `p95Ms: 16.7 ms`, `maxMs: 33.3 ms`, `frameCount: 192`, `durationMs: 3202.2 ms`
- **Run 3:** `meanFps: 58.3`, `p50Fps: 59.9`, `p95Fps: 59.5`, `p95Ms: 16.8 ms`, `maxMs: 50.0 ms`, `frameCount: 187`, `durationMs: 3207.1 ms`

**Temuan optimasi S2b:** Menghindari `ResizeObserver` pada node mode `reflow` (`scale === 1`), men-cache elemen React hasil `renderToReactElement` dalam `WeakMap` berbasis referensi `doc`, serta memoisasi `FloatingToolbarBody` + memosisikan wrapper via `translate3d` (tanpa re-render 25 tombol toolbar pada tiap frame pan/zoom) menjaga `maxMs` **semua** skenario (termasuk *mount burst* `zoom` dengan `frame: "none"` dan handle aktif) berada di **`16.8–50.1 ms`** dengan **`p95Ms: 16.7–22.3 ms`** dan **`56.6–59.8 fps`** (di bawah batas responsivitas `< 100 ms` di [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) §7.1).

| Kondisi (`S2_EDITOR_UNMOUNT_RESILIENCE`, Tes #12) | Status Mount saat Pan Off-Screen | Teks & Seleksi Setelah Pan Balik | Fokus & Undo Teks | Status di `cullOn` |
| --- | --- | --- | --- | --- |
| **Tanpa mitigasi** | `unmountedOffscreen: true` | `selectionPreserved: false` | `undoPreserved: false` | `activeEditorMin: 0` |
| **Mitigasi `<ViewportPortal>`** | `remainedMountedOffscreen: true` | `selectionPreserved: true` | `focusPreserved: true`, `undoPreserved: true` | `activeEditorMin: 1` |

---

## 4. Uji Mutasi Manual, Lintas Browser, & Status CI

### Mutasi Manual S2b `(a)–(f)` (satu per satu, seluruhnya di-revert & `git diff` bersih pada file termutasi)

*(Melengkapi 5 mutasi penahan input S2-fix sebelumnya pada `nodrag`/`nowheel`/`nopan`/`onWheelCapture`/`keydown stopPropagation` yang tetap terjaga lewat Tes #1–#4 dan #19.)*

| # | Mutasi Manual (S2b) | File Termutasi | Tes yang Gagal & Fakta Kegagalan Teramati | Status Revert |
| :---: | --- | --- | --- | --- |
| `(a)` | Hapus kelas `nopan nowheel` & `onWheelCapture` pembungkus handle resize | `ResizeHandles.tsx` | **Tes #19 gagal** (`s2.spec.ts:1564`): `Ctrl+Wheel` pada handle men-zoom kanvas ke `1.3947` alih-alih mempertahankan `{ x: 0, y: 0, zoom: 1 }`. | Di-revert bersih (`diff` kosong) |
| `(b)` | Turunkan batas minimum (`text.minW = 10`, `image.minW = 10, minH = 10`) | `rich-text-config.ts` | **Tes #19 gagal** (`s2.spec.ts:1586`): drag kiri menyusutkan kotak hingga `70 px` (seharusnya `>= 160 px`). | Di-revert bersih (`diff` kosong) |
| `(c)` | Patahkan formula proporsional `computeNextTextScale` (`/ 1000` alih-alih `/ safeBase`) | `rich-text-config.ts` | Semula lolos asersi longgar; setelah Tes #20 diperketat dengan asersi proporsional (`|textScale - expected| <= 0.06`), **Tes #20 gagal** (`s2.spec.ts:1668`, galat `0.33 > 0.06`). | Di-revert bersih (`diff` kosong) |
| `(d)` | Dorong snapshot undo di `handleResizeStart` dan juga di `handleResizeEnd` | `SpikeApp.tsx` | **Tes #20 gagal** (`s2.spec.ts:1662`): `getCanvasUndoCount()` bertambah menjadi `4` langkah alih-alih `3` (`Expected: 3, Received: 4`). | Di-revert bersih (`diff` kosong) |
| `(e)` | Hilangkan hysteresis LOD (`LOD_EXIT_ZOOM = 0.32 === LOD_ENTER_ZOOM`) | `rich-text-config.ts` | **Tes #16 gagal** (`s2.spec.ts:1298`): osilasi zoom di batas memicu perpindahan LOD berulang (`Expected: 3, Received: 4`). | Di-revert bersih (`diff` kosong) |
| `(f)` | Kembalikan `.knovites-richtext pre` menjadi `white-space: pre-wrap` | `spike.css` | **Tes #18 gagal** (`s2.spec.ts:1471`): `getComputedStyle(pre).whiteSpace` terbaca `"pre-wrap"` alih-alih `"pre"`. | Di-revert bersih (`diff` kosong) |

### Pengujian Lintas Browser (`Playwright`) & Status CI

- **Chromium:** **22/22 lulus** (`2.2m`, suite lokal `spikes/s2-tiptap-reactflow/playwright.config.ts`).
- **Firefox & WebKit:** Tidak tersedia biner Playwright terpasang di cache lokal (`[Belum terbukti]`).
- **CI GitHub Actions:** Suite spike **tidak dijalankan di CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) hanya menjalankan `pnpm test:e2e` pada `e2e/`).

---

## 5. Audit Whitelist Skema (`src/domain/schema` vs TipTap Output) & Sanitasi `textAlign`/`href`

1. **Paragraf polos bebas `{ textAlign: null }` (`S2_PLAIN_PARAGRAPH_CHECK`, Tes #8 & #21):**
   `NoNullTextAlign` di prototipe membungkus `editor.getJSON()` sehingga paragraf polos tidak menyertakan `attrs: { textAlign: null }`; validasi ke `parseCanvasJson` menghasilkan `issues: []`.
2. **Penolakan `textAlign: 'justify'` & sanitasi `href` (`Tes #8 & #21`):**
   `justify` ditolak pada editor aktif, paste HTML (`text/html`), `sanitizeSpikeDoc`, dan parser domain asli (`S2_CRAFTED_HREF_SCHEMA` tetap membuang ke-5 skema berbahaya: `JaVaScRiPt:`, `"java\nscript:"`, spasi depan, `data:text/html`, `vbscript:`).
3. **Atribut ekstra `Link`:** `@tiptap/extension-link@3.34.0` menyertakan `target`, `rel`, `class`, `title`; di M4 wajib tetap di-strip saat menulis ke penyimpanan permanen.

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

- **Penjelasan selisih `gh api` vs halaman web advisory (`Unreviewed`, tanpa paket):** Advisory telah ditarik (`withdrawn_at: "2026-11-18T15:38:56Z"`), dilepas dari indeks Dependabot/`pnpm audit`, tetapi endpoint REST tetap menyajikan snapshot historis. `ignoreGhsas` telah **dihapus** dari [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) dan `pnpm audit --prod` serta `pnpm audit` bersih (`0` kerentanan).

---

## 7. Risiko yang Belum Diuji pada Spike S2b (`[Belum terbukti]`)

1. **Komposisi IME (CJK / aksara non-ASCII),** terutama mengetik IME di dalam elemen ter-transform `transform: scale(textScale)`.
2. **Interaksi sentuh / mobile** (pinch zoom, long-press drag, drag 8 handle via pointer touch, keyboard virtual).
3. **Aksesibilitas lanjutan (screen reader ARIA, fokus keyboard `Tab` ke toolbar & handle resize).**
4. **Firefox & WebKit/Safari sungguhan serta verifikasi FPS `>= 50` di browser desktop ber-GPU (`FR-CVS-08`)** dengan foto nyata & thumbnail hasil impor (`FR-IMG-03`).
5. **Uji runtime drag `Shift + sudut` untuk membuka kunci rasio gambar secara bebas:** perilaku default terkunci (`240:150`) sudah teruji di Tes #19 dan binding `useKeyPress('Shift')` terpasang di [`ImageCanvasNode.tsx`](../../spikes/s2-tiptap-reactflow/ImageCanvasNode.tsx), namun gestur `Shift + drag` interaktif pada gambar belum ditegaskan langsung oleh Playwright.
6. **Eksekusi gerbang benchmark spike di CI** (saat ini hanya dijalankan lokal).

---

## 8. Ringkasan Status, Rekomendasi, & Keputusan Menunggu untuk M4

### `[Fakta terukur]` (seluruh angka bersumber dari §§2–6 di atas)

- **Benchmark `cullOn` S2b (`frame: "none"` + 8 handle aktif + `WeakMap` `StaticTextContent` + `FloatingToolbarBody` memo):** seluruh 7 skenario (3 runs/skenario) mencapai **`56.6–59.8 fps`**, `p95Ms: 16.7–22.3 ms`, `maxMs: 16.8–50.1 ms`, `renderedDomNodes: 9–74` (`300` pada `zoom-out-all`).
- **Frame `"none"`, paritas, & blok kode (`FR-CVS-05`, `FR-TXT-03`, `FR-TXT-08`):** whole-node `card-surface` (`340×283.05 px`) identik ukuran/padding/border pada `dark/light × auto/none` (diff piksel hanya `0.702–0.816%` outer ring); blok kode `white-space: pre; overflow-x: auto` mencapai **`diffPercent: 0%`** pada `richtext-body` di `200 px` & `340 px` plus isolasi wheel horizontal.
- **Resize generik & `scale` non-destruktif (`FR-CVS-03`, `FR-CVS-06`):** 8 handle hanya tampil saat dipilih, tahan `Ctrl+Wheel` & mode `Hand`, `textScale` proporsional di `[0.5, 3.0]` tanpa mengubah `fontSize` dokumen, **1 gestur = 1 undo kanvas**, dan `Ctrl+Z` edit tetap khusus ProseMirror; `<ViewportPortal>` menjaga mount (`activeEditorMinDuringRun: 1`), seleksi, fokus, & undo saat off-screen atau resize/drag.
- **Auto-zoom LOD & sanitasi (`FR-CVS-01`, `FR-CVS-04`, `FR-TXT-06`):** double-click dari zoom `0.25` otomatis memusatkan node pada `zoom: 1`; `NoNullTextAlign` menghilangkan `attrs: { textAlign: null }` dari `editor.getJSON()` dan menolak `justify`; seluruh **40 kombinasi token semantik & `Highlight`** lulus WCAG AA (`5.16–17.85:1`).

### `[Belum terbukti]`

- `FR-CVS-08` (`>= 50 fps` pada 300 elemen) di browser desktop non-headless ber-GPU dengan foto asli (`FR-IMG-03`).
- IME (khususnya di dalam `transform: scale`), sentuh/pinch/keyboard virtual, a11y penuh, Firefox/WebKit, gestur interaktif `Shift + drag` gambar di Playwright, serta eksekusi gerbang benchmark di CI.

### `[Rekomendasi]` (belum diputuskan pemilik — lihat detail di [`docs/open-questions.md`](../open-questions.md))

1. Mode resize teks **`Reflow` vs `Scale`**: pertahankan toggle toolbar eksplisit (`Opsi A`) vs gestur sudut/sisi (`Opsi B`).
2. Perlakuan **hex `#rrggbb` saat paste**: petakan ke token semantik terdekat (atau jatuhkan ke `Auto`), jangan simpan hex bebas sebagai warna teks semantik.
3. Indikator ukuran font pada **toolbar** saat `textScale !== 1`: tampilkan base + ukuran efektif terhitung (`toolbar-size-effective`).
4. Kebijakan **`style.bg` / `style.border` untuk latar kartu kustom**: selaraskan dengan token tema atau aturan kontras sebelum M4 agar token teks tetap memenuhi AA di atas kartu berwarna kustom.
