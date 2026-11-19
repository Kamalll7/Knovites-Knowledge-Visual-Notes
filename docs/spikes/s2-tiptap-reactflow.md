# Laporan Spike S2 — TipTap di Dalam `@xyflow/react`

- **Verdict:** **LOLOS BERSYARAT (Conditional Pass) — `FR-CVS-08 belum terbukti`.** Isolasi input/wheel/drag, toolbar berukuran layar tetap di luar transformasi kanvas, satu instance TipTap aktif (MIT), paritas visual (`diffPixels: 0`), dan sanitasi paste/skema lolos terukur. Namun **`FR-CVS-08 belum terbukti`** karena: (1) uji berjalan di Chromium headless tanpa akselerasi GPU; (2) pada dataset campuran kaya (heading, list, mark, link, dan **50 gambar**) dengan `onlyRenderVisibleElements={true}`, zoom + 1 editor rata-rata **`42.5 fps`** (`p95 20.0–29.9 fps`, `max 100.0–150.0 ms`), dan zoom-out seluruh 300 elemen terlihat bersamaan turun ke **`13.1 fps`**; dan (3) dengan `onlyRenderVisibleElements={false}` seluruh 300 elemen berat ter-mount di DOM, FPS jatuh ke **`14.0–21.0 fps`** (berkebalikan dari dataset teks polos 1-baris sebelumnya). Selain itu, **kontras warna teks hex tetap pada mode light + highlight pada mode dark gagal WCAG AA** dan tercatat sebagai pertanyaan terbuka sebelum M4.
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
4. **HUD benchmark di luar kanvas:**
   [`s2-fps-hud`](../../spikes/s2-tiptap-reactflow/SpikeApp.tsx) ditempatkan di dalam `<footer data-testid="s2-status-footer">` terpisah di bawah `<main>` sehingga **tidak menimpa node maupun atribusi `.react-flow__attribution`**.
5. **Isolasi input, gagang drag, & undo pra-drag:**
   `dragHandle: '.knovites-drag-handle'`, `draggable={!isEditing}`, kelas `nodrag nowheel nopan` hanya pada node aktif edit (`TextCanvasNode.tsx`), `onWheelCapture` untuk kontainer bertinggi terbatas (`box-scroll` statis maupun edit), `stopPropagation` pada `keydown` di `ActiveTipTapEditor.tsx` (`handleKeyDown` & `EditorContent`), `panActivationKeyCode={null}` & `deleteKeyCode={null}` saat edit, plus snapshot undo pra-drag pada `NodeChangeset` saat `PositionChange` `dragging: true`.

---

## 2. Daftar Tes Playwright (12 Tes), Paritas Visual, Toolbar Zoom & Kontras WCAG

Seluruh suite dijalankan di Playwright Chromium (`pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts`) — **12 passed (4.8m)**.

**Alasan keberadaan tes tambahan (Tes #10, #11, dan tes benchmark terakhir):** Prompt S2 awal meminta 9 tes interaksi/paritas bernama jelas plus pengukuran FPS; review tambahan menambahkan uji toolbar di luar transform pada berbagai zoom (**Tes #10**) dan perhitungan kontras WCAG 2.1 di dark/light serta frame `card`/`none` (**Tes #11**), selain tes benchmark terpisah 3 kali jalan.

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
| 11 | `11. ukur rasio kontras WCAG 2.1 untuk mark color & highlight di tema dark/light dan frame card/none` | **Lulus** | Menghitung rasio kontras nyata dari `getComputedStyle` untuk seluruh swatch & highlight pada kedua tema & frame (lihat tabel §2.2). |
| 12 | `benchmark FPS pan-only, zoom-only, culling ON vs OFF, 3 runs per scenario (rich text + 50 images)` | **Lulus** | Dataset `100` (`17` gambar + kaya) & `300` (`50` gambar + kaya), 13 skenario × **3 kali jalan**, serta validasi zero-overlap `s2-fps-hud` vs kanvas & atribusi. |

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
| `HighlightAmber` (`mark #fbbf24`) | **1.37** (GAGAL — teks `#e6e9f0`) | **1.37** (GAGAL — teks `#e6e9f0`) | **10.69** (Lulus — teks `#0f172a`) | **10.69** (Lulus — teks `#0f172a`) |

Pembahasan opsi **warna semantik (token tema) vs hex tetap `#rrggbb`**, dampaknya terhadap `data-format.md` §5.4, serta kasus **frame `"none"`** ditulis lengkap di [`docs/open-questions.md`](../open-questions.md).

---

## 3. Hasil Benchmark FPS Campuran (Rich Text + 50 Gambar): Cull ON vs OFF, 3 Kali Jalan per Skenario

Dataset: `100` node (`17` `imageBox` PNG lokal + node kaya heading/list/mark/link/code + statis) dan `300` node (`50` `imageBox` PNG lokal + node kaya + statis). Setiap skenario dijalankan **3 kali** (`>= 3s`, `>= 150` frame per jalan) pada Chromium headless `1280×800` tanpa GPU (`stress-300-dark.png`: [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)):

| Skenario (`S2_FPS_BENCHMARKS`) | Node / Gbr | Ed | Gerak | Cull (`onlyRenderVisibleElements`) | `meanFps` antar-jalan (mean / median / `[min..max]`) | `p50Fps` (mean / `[min..max]`) | `p95Fps` (mean / `[min..max]`) | `maxMs` (mean / `[min..max]`) | DOM Ter-render |
| --- | :---: | :---: | --- | :---: | --- | --- | --- | --- | :---: |
| `s100_pan_1editor_cullOn` | 100 / 17 | 1 | pan | **ON** | **53.4 / 52.9** `[52.5..54.8]` | 59.9 `[59.9..59.9]` | 30.0 `[29.9..30.0]` | 50.1 `[50.0..50.1]` | 7–22 |
| `s100_pan_1editor_cullOff` | 100 / 17 | 1 | pan | **OFF** | **31.6 / 32.4** `[29.1..33.3]` | 30.0 `[30.0..30.0]` | 18.3 `[15.0..20.0]` | 77.8 `[50.1..116.6]` | 100–100 |
| `s100_zoom_1editor_cullOn` | 100 / 17 | 1 | zoom | **ON** | **42.4 / 42.7** `[41.1..43.4]` | 59.9 `[59.9..59.9]` | 23.3 `[20.0..29.9]` | 116.6 `[99.9..133.3]` | 10–70 |
| `s100_zoom_1editor_cullOff` | 100 / 17 | 1 | zoom | **OFF** | **31.8 / 31.6** `[31.1..32.6]` | 30.0 `[30.0..30.0]` | 20.0 `[20.0..20.0]` | 77.8 `[66.7..83.3]` | 100–100 |
| `s300_pan_0editor_cullOn` | 300 / 50 | 0 | pan | **ON** | **57.8 / 58.2** `[56.8..58.4]` | 59.9 `[59.9..59.9]` | 59.5 `[59.5..59.5]` | 50.0 `[49.9..50.0]` | 9–22 |
| `s300_pan_0editor_cullOff` | 300 / 50 | 0 | pan | **OFF** | **21.0 / 21.1** `[20.9..21.1]` | 20.0 `[20.0..20.0]` | 15.0 `[15.0..15.0]` | 94.5 `[66.8..116.7]` | 300–300 |
| `s300_pan_1editor_cullOn` | 300 / 50 | 1 | pan | **ON** | **55.1 / 55.0** `[54.8..55.4]` | 59.9 `[59.9..59.9]` | 30.0 `[30.0..30.0]` | 38.9 `[33.4..50.0]` | 9–22 |
| `s300_pan_1editor_cullOff` | 300 / 50 | 1 | pan | **OFF** | **14.5 / 14.4** `[14.2..15.0]` | 18.3 `[15.0..20.0]` | 10.0 `[10.0..10.0]` | 122.3 `[116.7..133.3]` | 300–300 |
| `s300_zoom_0editor_cullOn` | 300 / 50 | 0 | zoom | **ON** | **49.5 / 49.4** `[49.1..50.1]` | 59.9 `[59.9..59.9]` | 29.9 `[29.9..29.9]` | 83.3 `[83.3..83.4]` | 10–74 |
| `s300_zoom_0editor_cullOff` | 300 / 50 | 0 | zoom | **OFF** | **20.8 / 20.8** `[20.5..21.0]` | 20.0 `[20.0..20.0]` | 15.0 `[15.0..15.0]` | 94.5 `[66.8..116.6]` | 300–300 |
| `s300_zoom_1editor_cullOn` | 300 / 50 | 1 | zoom | **ON** | **42.5 / 42.3** `[41.9..43.4]` | 59.9 `[59.9..59.9]` | 26.6 `[20.0..29.9]` | 127.8 `[100.0..150.0]` | 10–74 |
| `s300_zoom_1editor_cullOff` | 300 / 50 | 1 | zoom | **OFF** | **14.0 / 13.9** `[13.6..14.4]` | 15.0 `[15.0..15.0]` | 10.0 `[10.0..10.0]` | 139.0 `[133.4..150.1]` | 300–300 |
| `s300_zoom_out_all_visible_1editor` | 300 / 50 | 1 | zoom-out-all | **ON** | **13.1 / 13.0** `[12.8..13.4]` | 14.0 `[12.0..15.0]` | 8.6 `[8.6..8.6]` | 150.0 `[133.4..183.3]` | 300–300 |

**Temuan arsitektural kunci (mengubah kesimpulan benchmark polos sebelumnya):**
1. **Pada konten campuran nyata (`heading`, list, mark, link, dan 50 gambar PNG), `cullOn` (`onlyRenderVisibleElements: true`) jauh lebih cepat daripada `cullOff`:** pada `300` node, `cullOn` menjaga pan **`55.1–57.8 fps`** dan zoom 0-editor **`49.5 fps`** (`DOM 9–74`), sementara membiarkan semua 300 subtree kaya+gambar ter-mount (`cullOff`) menjatuhkan pan dan zoom ke **`14.0–21.0 fps`** (bahkan `p50` hanya `15–20 fps`).
2. **Dua risiko terbuka untuk M4 (penyebab `FR-CVS-08 belum terbukti`):**
   - Saat zoom 300 node dengan **1 editor aktif + `cullOn`**, `meanFps` berada di **`42.5 fps`** (`p95 20.0–29.9 fps`, `max 100.0–150.0 ms`), dan saat seluruh 300 node masuk viewport sekaligus (`zoom-out-all`), FPS jatuh ke **`13.1 fps`**.
   - Ketika node yang sedang diedit digeser keluar viewport saat `cullOn` aktif (`s100_pan_1editor_cullOn`, `s300_pan_1editor_cullOn`), React Flow ikut meng-unmount `TextCanvasNode` aktif (`activeEditorMinDuringRun: 0`), yang menghancurkan instance TipTap di tengah sesi edit. Pada M4, node yang sedang diedit harus dikecualikan/tetap ter-mount meskipun keluar viewport, serta dievaluasi ulang dengan akselerasi GPU desktop.

---

## 4. Uji Mutasi per Penahan & Cakupan Browser

### Mutasi Penahan (diterapkan satu per satu lalu di-revert; `git diff --exit-code` bersih setelah setiap revert)

| # | Mutasi Penahan | File | Tes yang Gagal & Fakta Kegagalan | Diff Bersih Setelah Revert |
| --- | --- | --- | --- | --- |
| 1 | Hapus `nodrag` | `TextCanvasNode.tsx` | **Tes #3 gagal** (`Expected: 80, Received: 203` saat drag pada node edit dengan `dragHandle` dilepas di tes); dalam eksekusi termutasi yang sama Tes #5 (`initialSelection: ""`) dan Tes #7 (`"Alpha Bravo Charlie DeltaTRA_WORD"`) juga terdampak. | `git diff --exit-code` -> exit `0` |
| 2 | Hapus `nowheel` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`vpEditAfterWheel` berubah menjadi `{ x: -70.85..., y: -297.70..., zoom: 1.283... }`). | `git diff --exit-code` -> exit `0` |
| 3 | Hapus `nopan` | `TextCanvasNode.tsx` | **Tes #4 gagal** (drag pada padding `card-surface-box-edit` di mode `Hand` menggeser viewport ke `{ x: 120, y: 60, zoom: 1 }`); pada eksekusi tersebut Tes #5 (`initialSelection: ""`) juga gagal. | `git diff --exit-code` -> exit `0` |
| 4 | Hapus `onWheelCapture` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`scrollStaticAfter === 0`, `box-scroll` statis gagal scroll). | `git diff --exit-code` -> exit `0` |
| 5 | Hapus `stopPropagation` pada `keydown` | `ActiveTipTapEditor.tsx` | **Tes #1 gagal** (`getLeakedCanvasKeydowns()` mengembalikan **`22`**, seharusnya **`0`**). | `git diff --exit-code` -> exit `0` |

### Pengujian Lintas Browser (`Playwright`)

- **Chromium:** **12/12 lulus.**
- **Firefox & WebKit:** Tidak tersedia biner Playwright terpasang di cache lokal (`Executable doesn't exist`), selaras dengan CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).

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
- **Tanggal tinjau ulang ignore (`pnpm-workspace.yaml`):** **`2026-12-01`** untuk menghapus entri `ignoreGhsas: [GHSA-fc5q-39xc-vjpf]` di commit non-spike terdekat.

---

## 7. Risiko yang Belum Diuji pada Spike S2

1. **Komposisi IME (CJK / aksara non-ASCII).**
2. **Interaksi sentuh / mobile (pinch zoom, long-press drag, keyboard virtual).**
3. **Aksesibilitas lanjutan** (screen reader ARIA, fokus `Tab` ke toolbar, dan perbaikan kontras WCAG AA pada warna hex di tema light & highlight di tema dark sebelum M4).
4. **Menjaga node aktif edit agar tidak ter-unmount oleh `onlyRenderVisibleElements` saat pan menjauh** (`activeEditorMinDuringRun === 0` pada skenario pan `cullOn`).
5. **Uji Firefox & WebKit/Safari sungguhan serta FPS pada browser desktop ber-GPU.**
