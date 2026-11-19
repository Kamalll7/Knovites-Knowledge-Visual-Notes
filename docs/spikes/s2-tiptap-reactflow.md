# Laporan Spike S2 — TipTap di Dalam `@xyflow/react`

- **Verdict:** **LOLOS BERSYARAT (Conditional Pass)**
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s2-tiptap-reactflow/`](../../spikes/s2-tiptap-reactflow/)
- **Dokumen rujukan:** [`docs/spec-canvas.md`](../spec-canvas.md) (§6.4 `FR-CVS-04`, `FR-CVS-06`, `FR-CVS-08`; §6.5 `FR-TXT-01`, `FR-TXT-06`, `FR-TXT-08`), [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) (§7.1), [`docs/testing.md`](../testing.md) (§9.4–§9.5), [`docs/data-format.md`](../data-format.md) (§5.4), ADR [`0003-xyflow-and-tiptap-packages.md`](../decisions/0003-xyflow-and-tiptap-packages.md), dan [`docs/open-questions.md`](../open-questions.md).

---

## 1. Solusi yang Dipilih

1. **Renderer statis tanpa `dangerouslySetInnerHTML`:**
   Paket `@tiptap/static-renderer@3.34.0` berlisensi **MIT** dan sub-paket `@tiptap/static-renderer/pm/react` (`renderToReactElement`) memetakan JSON ProseMirror menjadi elemen React lewat `React.createElement` tanpa string HTML atau `dangerouslySetInnerHTML` (`StaticTextContent.tsx`).
2. **Satu instance TipTap aktif (MIT only):**
   Hanya node berstatus `isEditing === true` yang me-mount `ActiveTipTapEditor` (`useEditor`). Pelacakan berbasis `Set<string>` (`useId()`) menjaga maksimal **1** instance TipTap hidup pada satu waktu (`TipTap instances: 0 | 1`). Ekstensi MIT: `StarterKit` (`heading: { levels: [1, 2, 3] }`, `link: false`, `underline: false`, `trailingNode: false`), `Underline`, `Link` (URI `http`, `https`, `mailto`, `knovites:<ulid>`), `TextStyle`, `Color`, `FontFamily`, `FontSize` (`@tiptap/extension-text-style/font-size`), `Highlight`, dan `TextAlign`.
3. **Isolasi input, gagang drag, & undo pra-drag:**
   `dragHandle: '.knovites-drag-handle'`, `draggable={!isEditing}`, kelas `nodrag nowheel nopan`, `onWheelCapture`, `panActivationKeyCode={null}` & `deleteKeyCode={null}` saat edit, plus penangkapan snapshot undo kanvas pada `NodeChangeset` saat `PositionChange` `dragging: true` pertama muncul sebelum posisi dimutasi.
4. **Toolbar melayang:**
   Dirender di luar `.knovites-richtext` dengan `w-max whitespace-nowrap` dan `onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}` di setiap kontrol agar seleksi teks tidak pernah hilang.

---

## 2. Daftar Tes Playwright (10 Tes) & Paritas Visual

Seluruh suite dijalankan di Playwright Chromium `159.0.8154.6` (`pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts`) — **10 passed (38.2s)**.

**Alasan keberadaan tes ke-10:** Prompt Spike S2 meminta 9 tes interaksi/paritas bernama jelas **ditambah** pengukuran FPS pan dan zoom pada 100 dan 300 elemen statis + 1 editor aktif. Tes ke-10 bernama **`benchmark FPS pan dan zoom dengan 100 dan 300 elemen statis + 1 editor aktif`** dimasukkan ke [`s2.spec.ts`](../../spikes/s2-tiptap-reactflow/s2.spec.ts) agar pengukuran FPS deterministik dapat diulang langsung oleh Playwright.

| # | Nama Tes di `s2.spec.ts` | Status | Hasil / Mekanisme Terverifikasi |
| --- | --- | :---: | --- |
| 1 | `1. mengetik teks termasuk spasi tidak memicu pan (Space) maupun tool shortcut H, T, I, ], [` | **Lulus** | Mengetik spasi, `H/T/I`, `]/[`, serta menahan `Space` + drag tidak mengubah `tool`, `zIndex`, maupun viewport. |
| 2 | `2. Backspace dan Delete saat mengedit TIDAK menghapus elemen` | **Lulus** | Saat edit node tidak terhapus; `Escape` meng-unmount editor (`TipTap instances: 0`) dan `Delete` di luar edit menghapus node. |
| 3 | `3. memilih teks dengan drag mouse tidak memindahkan kotak` | **Lulus** | Seleksi drag teks di `.ProseMirror` memilih karakter tanpa mengubah `(x, y)` kotak. |
| 4 | `4. scroll di dalam kotak tidak mengubah zoom atau pan kanvas` | **Lulus** | Reset `scrollTop = 0` setelah focus lalu `wheel(0, 240)` menaikkan `scrollTop` di `box-scroll` dengan viewport tetap identik. |
| 5 | `5. toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format` | **Lulus** | Bold, Color (`#7c9cff`), Size (`24px`), Font (`JetBrains Mono`) diterapkan ke `'Alpha'` sambil menjaga seleksi non-collapsed. |
| 6 | `6. gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi` | **Lulus** | Drag pada `[data-testid="drag-handle-box-second"]` memindahkan kotak; `Space`+drag pan dan `Ctrl`+wheel zoom tetap jalan. |
| 7 | `7. Ctrl/Cmd+Z saat mengedit hanya membatalkan teks, bukan operasi kanvas` | **Lulus** | `Ctrl+Z` saat edit hanya membatalkan teks; setelah keluar edit (`Escape`), `Ctrl+Z` membatalkan perpindahan drag kanvas ke `x = 470`. |
| 8 | `8. paste teks berformat dibersihkan sesuai whitelist` | **Lulus** | Paste `<script>`, `<img src="http://evil.test/..." onerror=...>`, `onclick/onload/onmouseover`, CSS `background:url(...)`, `width:expression(...)`, `position:fixed`, `<h5>`, `<a href="javascript:...">` dibersihkan seluruhnya; validasi Zod asli (`parseCanvasJson`) lulus. |
| 9 | `9. tampilan statis dan mode edit identik secara visual dan tangkap screenshot` | **Lulus** | Paritas dark & light terukur `diffPixels: 0` (`0%`) pada konten lengkap (heading, bold, underline, color, fontSize, inline code, bulletList, orderedList, codeBlock, link, textAlign). |
| 10 | `benchmark FPS pan dan zoom dengan 100 dan 300 elemen statis + 1 editor aktif` | **Lulus** | Mengukur 5 skenario pan/zoom (`>= 3s`, `>= 150` frame) beserta jumlah node DOM ter-render. |

### Metode Perbandingan Paritas Visual (Tes #9)

- **Elemen yang di-screenshot:** `[data-testid="richtext-body-box-rich"]` di tema gelap dan terang (menguji `heading` H2, `textAlign: center`, `bold`, `underline`, `color: #7c9cff`, `fontSize: 18px`, `code` inline, `bulletList`, `link`, `orderedList`, dan `codeBlock` C).
- **Alat & threshold:** `OffscreenCanvas` 2D `getImageData` membandingkan buffer PNG statis vs edit piksel per piksel; piksel dihitung berbeda bila selisih kanal RGB `|ΔR|>8 || |ΔG|>8 || |ΔB|>8`, dengan batas lulus `< 1.0%` dan dimensi `width`/`height` harus identik.
- **Caret / seleksi:** Tidak disembunyikan (`caret` dan `autofocus: 'end'` dibiarkan alami; toleransi `< 1.0%` disediakan bila 1 px kedipan kursor tertangkap).
- **Hasil terukur:**
  - Dark mode ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png)): `310×255`, **`diffPixels: 0` (`diffPercent: 0%`)**.
  - Light mode ([static](../../spikes/s2-tiptap-reactflow/out/canvas-static-light.png) vs [edit](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png)): `310×255`, **`diffPixels: 0` (`diffPercent: 0%`)**.

---

## 3. Hasil Benchmark FPS (5 Skenario, ≥ 3 Detik, ≥ 150 Frame)

Diukur lewat `window.__S2_API__.measurePanZoomFps()` pada Chromium headless `1280×800` tanpa akselerasi GPU (`onlyRenderVisibleElements` aktif):

| Skenario | Durasi (ms) | Frame | Mean (ms / fps) | `p50` (ms / fps) | `p95` (ms / fps) | `max` (ms) | DOM Node Ter-render | vs Target `50 fps` (`FR-CVS-08`) |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| `100` elemen, `0` editor (baseline) | 3241.4 | 150 | 21.61 ms (46.3 fps) | 16.7 ms (59.9 fps) | 49.9 ms (20.0 fps) | 133.3 | 14–59 | **DI BAWAH TARGET** pada mean (46.3) & p95 (20.0 fps); p50 di atas 50 fps |
| `100` elemen, `1` editor aktif | 3255.6 | 150 | 21.70 ms (46.1 fps) | 16.7 ms (59.9 fps) | 50.0 ms (20.0 fps) | 133.3 | 14–59 | **DI BAWAH TARGET** pada mean (46.1) & p95 (20.0 fps); p50 di atas 50 fps |
| `300` elemen, `0` editor (baseline) | 3834.6 | 150 | 25.56 ms (39.1 fps) | 16.7 ms (59.9 fps) | 50.1 ms (20.0 fps) | 333.3 | 14–168 | **DI BAWAH TARGET** pada mean (39.1) & p95 (20.0 fps); `max` > 100 ms |
| `300` elemen, `1` editor aktif | 3986.5 | 150 | 26.58 ms (37.6 fps) | 16.7 ms (59.9 fps) | 66.6 ms (15.0 fps) | 266.7 | 14–169 | **DI BAWAH TARGET** pada mean (37.6) & p95 (15.0 fps); `max` > 100 ms |
| `300` zoom-out semua terlihat, `1` editor | 3221.9 | 188 | 17.14 ms (58.4 fps) | 16.7 ms (59.9 fps) | 16.7 ms (59.9 fps) | 66.7 | 300–300 | **Memenuhi (>= 50 fps)** pada mean, p50, & p95 (`max` 66.7 ms < 100 ms) |

**Perbandingan dengan spesifikasi (`docs/spec-ui-nfr.md`, `docs/spec-canvas.md`, `docs/testing.md`):**
- `spec-canvas.md` §6.4 (`FR-CVS-08`): *"Kanvas dengan 300 elemen (50 gambar) menjaga **50 fps ke atas** saat pan dan zoom"*.
- `testing.md` §9.5: *"CI gagal jika di bawah **30 fps** (ambang kasar, target nyata ada di S1)"*.
- `spec-ui-nfr.md` §7.1: *"Operasi lokal terasa **di bawah 100 ms**"*; *"Bundle awal maksimal **600 KB gzip**. Chunk halaman node (React Flow dan TipTap) maksimal **500 KB gzip**"*.
- **Temuan kunci:** Saat seluruh 300 node sudah terpasang di DOM (`s300_zoom_out_all_visible_1editor`), pan berjalan di **58.4 fps mean / 59.9 fps p95 (`max 66.7 ms < 100 ms`)**. Penurunan tajam (`max 266.7–333.3 ms`, `p95 15–20 fps`, dan `mean 37.6–46.3 fps`) pada osilasi zoom-in/out terjadi di baseline `0` editor maupun `1` editor karena `onlyRenderVisibleElements` membongkar/memasang puluhan subtree DOM saat melewati ambang viewport. Untuk M4 perlu diuji di browser non-headless ber-GPU (dan dievaluasi `onlyRenderVisibleElements` vs menjaga margin virtualisasi di ~300 elemen).

---

## 4. Uji Mutasi Manual & Cakupan Browser

### Mutasi Manual (diterapkan satu per satu lalu di-revert)

| Mutasi | Deskripsi | Tes yang Gagal & Pesan / Fakta Kegagalan |
| --- | --- | --- |
| **(a)** Tambah `1px` padding di editor aktif | `padding: 1px` pada `.knovites-richtext .ProseMirror` di `spike.css` | **Tes #9 gagal:** `heightA: 255` vs `heightB: 265`, `diffPixels: 17240` (`20.986%`). |
| **(b)** Hapus penahan event ke kanvas | Hapus `nodrag`/`nowheel`/`nopan`, `onWheelCapture`, dan `onPointerDown/onMouseDown/onKeyDown stopPropagation` di `TextCanvasNode` & `ActiveTipTapEditor` | **Tes #4 & #5 gagal:** Tes #4 gagal `scrollTop` (`Expected: > 1025`, mengungkap perlunya reset `scrollTop = 0` di awal Tes #4 agar tidak terikat kebetulan posisi `autofocus`); Tes #5 gagal (`Expected: "Alpha", Received: ""`). |
| **(c)** Hapus aturan `javascript:` di sanitasi | `isAllowedSpikeHref` dibuat selalu `return true` | **Tes #8 gagal:** `expect(editorHtmlAudit.hrefs.every((h) => !h.startsWith('javascript:'))).toBe(true)` -> `Received: false`. |
| **(d)** Hapus logika snapshot pra-drag | Hapus penangkapan `PositionChange` (`dragging: true/false`) di `handleNodesChangeWrapped` (`SpikeApp.tsx`) | **Tes #7 gagal:** `getCanvasUndoCount()` -> `Expected: 1, Received: 0`. |

### Pengujian Lintas Browser (`Playwright`)

- **Chromium (`159.0.8154.6`):** **10/10 lulus.**
- **Firefox & WebKit:** Tidak tersedia biner Playwright terpasang di cache lokal (`firefox-1572` dan `webkit-2388` gagal diluncurkan dengan `Executable doesn't exist`), selaras dengan CI saat ini ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) yang hanya menginstal `chromium`.

---

## 5. Audit Whitelist Skema (`src/domain/schema` vs TipTap Output)

Validasi live `editor.getJSON()` di Tes #8 memakai **`parseCanvasJson`** asli dari `src/domain/schema`:
- `firstStatus: "ok"`, lalu setelah disanitasi oleh `sanitizeTipTapDoc` menghasilkan `recheckStatus: "ok"` dengan `recheckIssues: []`.
- **Daftar atribut dari output TipTap yang TIDAK ada di whitelist `data-format.md` §5.4 (dilaporkan sebagai `firstIssues` oleh `parseCanvasJson`):**
  1. `paragraph.attrs` (`textAlign: null` dari `@tiptap/extension-text-align`)
  2. `heading.attrs.textAlign` (dari `@tiptap/extension-text-align`)
  3. `link` mark attrs: `target`, `rel`, `class`, `title` (tetap dikeluarkan di `mark.attrs` oleh `@tiptap/extension-link@3.34.0`)
- Proposal perubahan untuk `textAlign` & normalisasi `Link` sebelum M4 telah ditulis lengkap di [`docs/open-questions.md`](../open-questions.md).

---

## 6. Risiko yang Belum Diuji pada Spike S2

1. **Komposisi IME (CJK / aksara non-ASCII):** perilaku `compositionstart`/`compositionend` dengan shortcut kanvas belum diuji.
2. **Interaksi sentuh / mobile (pinch zoom, long-press drag, keyboard virtual Android/iOS).**
3. **Aksesibilitas (screen reader ARIA pada kontrol toolbar, urutan fokus `Tab` dari node kanvas ke toolbar & dropdown custom, kontras WCAG AA detail di berbagai kombinasi warna teks + highlight).**
4. **Beban campuran 50 gambar asli (`FR-CVS-08` lengkap)** + memori object URL bersama 250 node teks statis.
5. **Uji lintas engine di Firefox & WebKit/Safari sungguhan** serta pengukuran FPS **non-headless dengan akselerasi GPU**.
