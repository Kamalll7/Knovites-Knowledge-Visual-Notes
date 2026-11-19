# Laporan Spike S2 — TipTap di Dalam `@xyflow/react`

- **Verdict:** **LOLOS BERSYARAT (Conditional Pass) — `FR-CVS-08 belum terbukti`.** Isolasi input/wheel/drag, satu instance TipTap aktif (MIT), paritas visual (`diffPixels: 0`), dan sanitasi paste/skema lolos terukur, namun **`FR-CVS-08 belum terbukti`** karena: (1) uji masih berjalan di Chromium headless tanpa akselerasi GPU (bukan desktop ber-GPU sungguhan dengan 50 gambar asli), dan (2) dengan `onlyRenderVisibleElements={true}` pada skenario zoom 300 node muncul lonjakan commit React (`max 283.4–300.0 ms`, `p95 20.0 fps`, `mean 40.7–42.7 fps` di bawah target `50 fps`).
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s2-tiptap-reactflow/`](../../spikes/s2-tiptap-reactflow/)
- **Artifak screenshot di `spikes/s2-tiptap-reactflow/out/` (hanya 5 PNG berikut yang dipertahankan; berkas lain di `out/` di-gitignore via [`out/.gitignore`](../../spikes/s2-tiptap-reactflow/out/.gitignore)):**
  - [`canvas-static-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png)
  - [`canvas-edit-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)
  - [`canvas-static-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png)
  - [`canvas-edit-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)
  - [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)
- **Dokumen rujukan:** [`docs/spec-canvas.md`](../spec-canvas.md) (§6.4 `FR-CVS-04`, `FR-CVS-06`, `FR-CVS-08`; §6.5 `FR-TXT-01`, `FR-TXT-06`, `FR-TXT-08`), [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) (§7.1), [`docs/testing.md`](../testing.md) (§9.4–§9.5), [`docs/data-format.md`](../data-format.md) (§5.4), ADR [`0003-xyflow-and-tiptap-packages.md`](../decisions/0003-xyflow-and-tiptap-packages.md), dan [`docs/open-questions.md`](../open-questions.md).

---

## 1. Solusi yang Dipilih

1. **Renderer statis tanpa `dangerouslySetInnerHTML`:**
   Paket `@tiptap/static-renderer@3.34.0` berlisensi **MIT** dan sub-paket `@tiptap/static-renderer/pm/react` (`renderToReactElement`) memetakan JSON ProseMirror menjadi elemen React lewat `React.createElement` tanpa string HTML atau `dangerouslySetInnerHTML` (`StaticTextContent.tsx`). Anchor statis (`<a>`) mewarisi `HTMLAttributes: { rel: 'noopener noreferrer' }`.
2. **Satu instance TipTap aktif (MIT only):**
   Hanya node berstatus `isEditing === true` yang me-mount `ActiveTipTapEditor` (`useEditor`). Pelacakan berbasis `Set<string>` (`useId()`) menjaga maksimal **1** instance TipTap hidup pada satu waktu (`TipTap instances: 0 | 1`). Ekstensi MIT: `StarterKit` (`heading: { levels: [1, 2, 3] }`, `link: false`, `underline: false`, `trailingNode: false`), `Underline`, `Link` (allowlist `http`, `https`, `mailto`, `knovites:<ulid>`, menolak spasi depan & karakter kontrol via `isAllowedSpikeHref`), `TextStyle`, `Color`, `FontFamily`, `FontSize` (`@tiptap/extension-text-style/font-size`), `Highlight`, dan `TextAlign`.
3. **Isolasi input, gagang drag, & undo pra-drag:**
   `dragHandle: '.knovites-drag-handle'`, `draggable={!isEditing}`, kelas `nodrag nowheel nopan` hanya pada node aktif edit (`TextCanvasNode.tsx`), `onWheelCapture` untuk kontainer bertinggi terbatas (`box-scroll` statis maupun edit), `stopPropagation` pada `keydown` di `ActiveTipTapEditor.tsx` (`handleKeyDown` & `EditorContent`), `panActivationKeyCode={null}` & `deleteKeyCode={null}` saat edit, plus snapshot undo pra-drag pada `NodeChangeset` saat `PositionChange` `dragging: true`.
4. **Toolbar melayang:**
   Dirender di luar `.knovites-richtext` dengan `w-max whitespace-nowrap` dan `onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}` di setiap kontrol agar seleksi teks tidak pernah hilang.

---

## 2. Daftar Tes Playwright (10 Tes) & Paritas Visual

Seluruh suite dijalankan di Playwright Chromium (`pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts`) — **10 passed (1.1m)**.

**Alasan keberadaan tes ke-10:** Prompt Spike S2 meminta 9 tes interaksi/paritas bernama jelas **ditambah** pengukuran FPS pan dan zoom pada 100 dan 300 elemen statis + 1 editor aktif. Tes ke-10 dimasukkan ke [`s2.spec.ts`](../../spikes/s2-tiptap-reactflow/s2.spec.ts) agar pengukuran FPS pan-only vs zoom-only dan toggle `onlyRenderVisibleElements` deterministik serta dapat diulang langsung oleh Playwright.

| # | Nama Tes di `s2.spec.ts` | Status | Hasil / Mekanisme Terverifikasi |
| --- | --- | :---: | --- |
| 1 | `1. mengetik teks termasuk spasi tidak memicu pan (Space) maupun tool shortcut H, T, I, ], [` | **Lulus** | Mengetik spasi, `H/T/I`, `]/[`, serta menahan `Space` + drag tidak mengubah `tool`, `zIndex`, maupun viewport; `getLeakedCanvasKeydowns() === 0`. |
| 2 | `2. Backspace dan Delete saat mengedit TIDAK menghapus elemen` | **Lulus** | Saat edit node tidak terhapus; `Escape` meng-unmount editor (`TipTap instances: 0`) dan `Delete` di luar edit menghapus node. |
| 3 | `3. memilih teks dengan drag mouse tidak memindahkan kotak` | **Lulus** | Seleksi drag teks di `.ProseMirror` memilih karakter tanpa mengubah `(x, y)` kotak; bahkan ketika `dragHandle` dilepas via `setNodeDragConfigForTest`, `.nodrag` tetap menghentikan `d3-drag`. |
| 4 | `4. scroll/wheel/nopan di dalam kotak tidak mengubah zoom atau pan kanvas` | **Lulus** | (a) Wheel pada `box-scroll` **statis** terisolasi oleh `onWheelCapture`; (b) wheel saat `box-scroll` edit tetap scroll internal; (c) wheel & `Ctrl+wheel` pada `box-edit` tanpa scrollbar terisolasi oleh `.nowheel`; (d) drag di padding `card-surface-box-edit` saat tool `Hand` terisolasi oleh `.nopan`. |
| 5 | `5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format` | **Lulus** | Bold, Color (`#7c9cff`), Size (`24px`), Font (`JetBrains Mono`) diterapkan ke `'Alpha'` sambil menjaga seleksi non-collapsed. |
| 6 | `6. gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi` | **Lulus** | Drag pada `[data-testid="drag-handle-box-second"]` memindahkan kotak; `Space`+drag pan dan `Ctrl`+wheel zoom tetap jalan. |
| 7 | `7. Ctrl/Cmd+Z saat mengedit hanya membatalkan teks, bukan operasi kanvas` | **Lulus** | `Ctrl+Z` saat edit hanya membatalkan teks; setelah keluar edit (`Escape`), `Ctrl+Z` membatalkan perpindahan drag kanvas ke `x = 470`. |
| 8 | `8. paste teks berformat dibersihkan sesuai whitelist` | **Lulus** | Paste `<script>`, `<img onerror=...>`, `onclick/onload/onmouseover`, CSS `url(...)`/`expression(...)`/`position:fixed`, `<h5>`, serta 5 payload `href` berbahaya (`JaVaScRiPt:`, `"java\nscript:"`, spasi depan `" javascript:..."`, `data:text/html`, `vbscript:`) dibersihkan sementara `http`/`https`/`mailto` dipertahankan; validasi langsung JSON buatan ke `parseCanvasJson` (tanpa paste) juga membuang ke-5 mark link berbahaya (`disallowed_link_href`) serta mencatat emisi `{ textAlign: null }` pada paragraf polos. |
| 9 | `9. tampilan statis dan mode edit identik secara visual dan tangkap screenshot` | **Lulus** | Memverifikasi `<a href="https://example.com/heap" rel="noopener noreferrer">` pada render statis `box-rich`, serta paritas dark & light `diffPixels: 0` (`0%`). |
| 10 | `benchmark FPS pan-only, zoom-only, and culling toggle across 100 and 300 nodes` | **Lulus** | Mengukur 10 skenario terpisah (pan-only, zoom-only, `onlyRenderVisibleElements` ON vs OFF, zoom-out all visible; masing-masing `>= 3s`, `>= 150` frame). |

### Metode Perbandingan Paritas Visual (Tes #9)

- **Elemen yang di-screenshot:** `[data-testid="richtext-body-box-rich"]` di tema gelap dan terang (`heading` H2, `textAlign: center`, `bold`, `underline`, `color: #7c9cff`, `fontSize: 18px`, `code` inline, `bulletList`, `link`, `orderedList`, dan `codeBlock` C).
- **Alat & threshold:** `OffscreenCanvas` 2D `getImageData` membandingkan buffer PNG statis vs edit piksel per piksel (`|ΔR|>8 || |ΔG|>8 || |ΔB|>8`, batas `< 1.0%`, dimensi identik).
- **Caret / seleksi:** Tidak disembunyikan (`caret` dan `autofocus: 'end'` dibiarkan alami).
- **Hasil terukur:**
  - Dark mode ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)): `310×255`, **`diffPixels: 0` (`diffPercent: 0%`)**.
  - Light mode ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)): `310×255`, **`diffPixels: 0` (`diffPercent: 0%`)**.

---

## 3. Hasil Benchmark FPS: Pan-Saja vs Zoom-Saja & `onlyRenderVisibleElements` ON vs OFF

Diukur lewat `window.__S2_API__.measurePanZoomFps()` pada Chromium headless `1280×800` tanpa akselerasi GPU (screenshot akhir 300 node: [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png)):

| Skenario (`S2_FPS_BENCHMARKS`) | Node | Editor | Gerak | `onlyRenderVisibleElements` | Durasi (ms) | Frame | Mean (ms / fps) | `p50` (ms / fps) | `p95` (ms / fps) | `max` (ms) | DOM Node | vs Target `50 fps` (`FR-CVS-08`) |
| --- | ---: | ---: | --- | :---: | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| `s100_pan_0editor_cullOn` | 100 | 0 | pan | **ON** | 3212.8 | 188 | 17.09 ms (58.5 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 33.4 | 14–37 | Memenuhi (`>= 50 fps`) |
| `s100_pan_1editor_cullOn` | 100 | 1 | pan | **ON** | 3212.3 | 187 | 17.18 ms (58.2 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 33.4 | 14–37 | Memenuhi (`>= 50 fps`) |
| `s100_zoom_1editor_cullOn` | 100 | 1 | zoom | **ON** | 3209.3 | 168 | 19.10 ms (52.3 fps) | 16.7 ms (59.9 fps) | 33.4 ms (29.9 fps) | 50.0 | 16–80 | Mean & `p50` >= 50 fps; `p95` 29.9 fps (**DI BAWAH TARGET**) |
| `s300_pan_0editor_cullOn` | 300 | 0 | pan | **ON** | 3214.8 | 186 | 17.28 ms (57.9 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 50.0 | 14–42 | Memenuhi (`>= 50 fps`) |
| `s300_pan_1editor_cullOn` | 300 | 1 | pan | **ON** | 3205.7 | 186 | 17.29 ms (57.8 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 33.4 | 14–42 | Memenuhi (`>= 50 fps`) |
| `s300_zoom_0editor_cullOn` | 300 | 0 | zoom | **ON** | 3509.5 | 150 | 23.40 ms (42.7 fps) | 16.7 ms (59.9 fps) | 49.9 ms (20.0 fps) | 283.4 | 16–167 | **DI BAWAH TARGET** (mean 42.7 & `p95` 20.0 fps; `max` 283.4 ms > 100 ms) |
| `s300_zoom_1editor_cullOn` | 300 | 1 | zoom | **ON** | 3682.6 | 150 | 24.55 ms (40.7 fps) | 16.7 ms (59.9 fps) | 50.1 ms (20.0 fps) | 300.0 | 16–182 | **DI BAWAH TARGET** (mean 40.7 & `p95` 20.0 fps; `max` 300.0 ms > 100 ms) |
| `s300_pan_1editor_cullOff` | 300 | 1 | pan | **OFF** | 3212.5 | 192 | 16.75 ms (59.7 fps) | 16.7 ms (59.9 fps) | 16.7 ms (59.9 fps) | 33.3 | 300–300 | Memenuhi (`>= 50 fps`; `max` 33.3 ms < 100 ms) |
| `s300_zoom_1editor_cullOff` | 300 | 1 | zoom | **OFF** | 3216.1 | 192 | 16.75 ms (59.7 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 33.4 | 300–300 | Memenuhi (`>= 50 fps`; `max` **33.4 ms** vs 300.0 ms saat ON!) |
| `s300_zoom_out_all_visible_1editor` | 300 | 1 | zoom-out-all | **ON** | 3215.0 | 193 | 16.66 ms (60.0 fps) | 16.7 ms (59.9 fps) | 16.8 ms (59.5 fps) | 16.8 | 300–300 | Memenuhi (`>= 50 fps`; seluruh 300 node tetap ter-mount) |

**Perbandingan dengan spesifikasi (`docs/spec-ui-nfr.md`, `docs/spec-canvas.md`, `docs/testing.md`):**
- `spec-canvas.md` §6.4 (`FR-CVS-08`): *"Kanvas dengan 300 elemen (50 gambar) menjaga **50 fps ke atas** saat pan dan zoom"*.
- `testing.md` §9.5: *"CI gagal jika di bawah **30 fps** (ambang kasar, target nyata ada di S1)"*.
- `spec-ui-nfr.md` §7.1: *"Operasi lokal terasa **di bawah 100 ms**"*; *"Bundle awal maksimal **600 KB gzip**. Chunk halaman node (React Flow dan TipTap) maksimal **500 KB gzip**"*.
- **Kesimpulan teknis:** Memisahkan pan vs zoom serta ON vs OFF `onlyRenderVisibleElements` membuktikan bahwa penyumbang spike frame 283.4–300.0 ms **bukan** zoom CSS transform atau TipTap aktif, melainkan **culling churn** `onlyRenderVisibleElements={true}` yang membongkar/memasang puluhan node `StaticTextContent` (`DOM 16 <-> 182`) secara berulang saat zooming. Ketika `onlyRenderVisibleElements={false}` pada 300 elemen teks + 1 editor aktif, zoom maupun pan berjalan rata di **59.7 fps** (`p95 59.5–59.9 fps`) dengan `max` **33.3–33.4 ms**. Meskipun demikian, **`FR-CVS-08 belum terbukti`** sampai diuji di M4 bersama **50 elemen gambar asli** pada browser desktop ber-GPU.

---

## 4. Uji Mutasi per Penahan & Cakupan Browser

### Mutasi Penahan (diterapkan satu per satu lalu di-revert; `git diff --exit-code` bersih setelah setiap revert)

| # | Mutasi Penahan | File | Tes yang Gagal & Fakta Kegagalan | Diff Bersih Setelah Revert |
| --- | --- | --- | --- | --- |
| 1 | Hapus `nodrag` | `TextCanvasNode.tsx` | **Tes #3 gagal** (`Expected: 80, Received: 203` saat drag pada node edit dengan `dragHandle` dilepas di tes); dalam eksekusi termutasi yang sama Tes #5 (`initialSelection: ""`) dan Tes #7 (`"Alpha Bravo Charlie DeltaTRA_WORD"`) juga terdampak. | `git diff --exit-code` -> exit `0` |
| 2 | Hapus `nowheel` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`s2.spec.ts:179`: `vpEditAfterWheel` berubah ke `{ x: -70.85..., y: -297.70..., zoom: 1.283... }` saat wheel & `Ctrl+wheel` di atas `box-edit` yang sedang diedit). | `git diff --exit-code` -> exit `0` |
| 3 | Hapus `nopan` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`s2.spec.ts:190`: drag pada padding `card-surface-box-edit` di mode `Hand` menggeser viewport ke `{ x: 120, y: 60, zoom: 1 }`); pada eksekusi termutasi itu Tes #5 (`initialSelection: ""`) juga gagal. | `git diff --exit-code` -> exit `0` |
| 4 | Hapus `onWheelCapture` | `TextCanvasNode.tsx` | **Tes #4 gagal** (`s2.spec.ts:139`: `scrollStaticAfter === 0`, `box-scroll` statis gagal scroll karena wheel ditelan kanvas React Flow). | `git diff --exit-code` -> exit `0` |
| 5 | Hapus `stopPropagation` pada `keydown` | `ActiveTipTapEditor.tsx` | **Tes #1 gagal** (`s2.spec.ts:29`: `getLeakedCanvasKeydowns()` mengembalikan **`22`**, seharusnya **`0`**, menunjukkan event `keydown` bocor melewati pembungkus editor ke `<main data-testid="canvas-stage">`). | `git diff --exit-code` -> exit `0` |

### Mutasi Tambahan dari Tinjauan Sebelumnya (S2-review)

| Mutasi | Tes yang Gagal & Pesan |
| --- | --- |
| **(a)** Tambah `1px` padding di `.knovites-richtext .ProseMirror` | **Tes #9 gagal:** `heightA: 255` vs `heightB: 265`, `diffPixels: 17240` (`20.986%`). |
| **(b)** Hapus aturan `javascript:` (`isAllowedSpikeHref` selalu `true`) | **Tes #8 gagal:** `hrefs` menyimpan link berbahaya (`javascript:`). |
| **(c)** Hapus logika snapshot pra-drag (`handleNodesChangeWrapped`) | **Tes #7 gagal:** `getCanvasUndoCount()` -> `Expected: 1, Received: 0`. |

### Pengujian Lintas Browser (`Playwright`)

- **Chromium:** **10/10 lulus.**
- **Firefox & WebKit:** Tidak tersedia biner Playwright terpasang di cache lokal (`firefox-1572` dan `webkit-2388` gagal diluncurkan dengan `Executable doesn't exist`), selaras dengan CI saat ini ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) yang hanya menginstal `chromium`.

---

## 5. Audit Whitelist Skema (`src/domain/schema` vs TipTap Output) & Sanitasi `href`

1. **Paragraf tanpa perataan (`{ textAlign: null }`):**
   Di Tes #8 (`S2_PLAIN_PARAGRAPH_CHECK`), mengetik teks biasa di `box-edit` tanpa menyentuh perataan menghasilkan paragraf dengan **`attrs: { "textAlign": null }`**. Ketika diteruskan ke **`parseCanvasJson`** asli dari `src/domain/schema`, validator melaporkan isu `disallowed_tiptap_attr` (`Removed disallowed attributes on "paragraph" node.`) lalu mengembalikan `status: "ok"` dengan `attrs` terbuang. Detail & proposal sebelum M4 tercatat di [`docs/open-questions.md`](../open-questions.md) (skema **tidak diubah** pada spike).
2. **Atribut ekstra `Link`:**
   `@tiptap/extension-link@3.34.0` juga menulis `target`, `rel`, `class`, `title` di `mark.attrs`, sehingga memunculkan `disallowed_tiptap_attr` di putaran pertama `parseCanvasJson` sebelum dibersihkan menjadi `href` saja (putaran kedua `recheckIssues: []`).
3. **Uji langsung JSON buatan ke `parseCanvasJson` (`S2_CRAFTED_HREF_SCHEMA`, tanpa paste):**
   Dokumen dengan mark link `JaVaScRiPt:alert(1)`, `"java\nscript:alert(2)"`, `" javascript:alert(3)"`, `data:text/html,<script>alert(4)</script>`, dan `vbscript:msgbox(5)` seluruhnya dibersihkan (`disallowed_link_href`) sambil menjaga teksnya; hanya `http://example.org/path`, `https://example.com/safe`, dan `mailto:user@example.com` yang dipertahankan.

---

## 6. Audit `GHSA-fc5q-39xc-vjpf` (`picomatch`)

- **URL Advisory GitHub:** https://github.com/advisories/GHSA-fc5q-39xc-vjpf
- **Status terbaru (`gh api /advisories/GHSA-fc5q-39xc-vjpf`, 2026-11-19):**
  `summary: "Withdrawn Advisory: picomatch vulnerable to ReDoS through single-branch repeated extglobs"`, `severity: "high"`, `vulnerable_version_range: "<= 4.0.7"`.
- **Output mentah `pnpm audit --json` (dan `--config.auditConfig.ignoreGhsas= --json`, 2026-11-19):**

```json
{
  "advisories": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0
    },
    "dependencies": 171,
    "devDependencies": 337,
    "optionalDependencies": 84,
    "totalDependencies": 525
  }
}
```

- **Catatan & tanggal tinjau ulang ignore (`pnpm-workspace.yaml`):** Entri `auditConfig.ignoreGhsas: [GHSA-fc5q-39xc-vjpf]` di `pnpm-workspace.yaml` ditambahkan pada commit `b9be2a4` untuk dependensi dev-only `picomatch@4.0.7`. Karena advisory kini berstatus **Withdrawn**, jadwalkan tinjau ulang pada **`2026-12-01`** untuk menghapus entri ignore tersebut di commit non-spike terdekat (`pnpm-workspace.yaml` tidak disentuh pada S2-fix sesuai batas direktori).

---

## 7. Risiko yang Belum Diuji pada Spike S2

1. **Komposisi IME (CJK / aksara non-ASCII):** perilaku `compositionstart`/`compositionend` dengan shortcut kanvas belum diuji.
2. **Interaksi sentuh / mobile (pinch zoom, long-press drag, keyboard virtual Android/iOS).**
3. **Aksesibilitas (screen reader ARIA pada kontrol toolbar, urutan fokus `Tab` dari node kanvas ke toolbar & dropdown custom, kontras WCAG AA detail di berbagai kombinasi warna teks + highlight).**
4. **Beban campuran 50 gambar asli (`FR-CVS-08` lengkap)** + memori object URL bersama 250 node teks statis.
5. **Uji lintas engine di Firefox & WebKit/Safari sungguhan** serta pengukuran FPS **non-headless dengan akselerasi GPU**.
