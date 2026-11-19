# Laporan Spike S2 — TipTap di Dalam `@xyflow/react`

- **Status:** Selesai — siap ditinjau pada **checkpoint pemilik** sebelum M4 dimulai.
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s2-tiptap-reactflow/`](../../spikes/s2-tiptap-reactflow/)
- **Dokumen rujukan:** [`docs/spec-canvas.md`](../spec-canvas.md) (§6.4 `FR-CVS-04`, `FR-CVS-06`, `FR-CVS-08`; §6.5 `FR-TXT-01`, `FR-TXT-06`, `FR-TXT-08`), [`docs/data-format.md`](../data-format.md) (§5.4), [`docs/plan.md`](../plan.md) (Spike S2), ADR [`0003-xyflow-and-tiptap-packages.md`](../decisions/0003-xyflow-and-tiptap-packages.md).
- **Catatan API versi terpasang:** [`docs/open-questions.md`](../open-questions.md).

---

## 1. Solusi yang Dipilih

1. **Renderer statis tanpa `dangerouslySetInnerHTML`:**
   Pemeriksaan sumber [`node_modules/@tiptap/static-renderer`](../../node_modules/@tiptap/static-renderer/package.json) (`3.34.0`) memastikan paket ini berlisensi **MIT**, dan entry `@tiptap/static-renderer/pm/react` (`renderToReactElement`) memetakan dokumen JSON ProseMirror langsung menjadi elemen React memakai `React.createElement` **tanpa** merangkai string HTML maupun `dangerouslySetInnerHTML` (`StaticTextContent.tsx`).
2. **Satu instance TipTap aktif dengan ekstensi MIT saja:**
   Hanya node yang sedang memiliki `isEditing === true` (diaktifkan lewat double-click, keluar via `Escape`, klik area kosong kanvas, atau klik node lain) yang me-mount `ActiveTipTapEditor` (`useEditor`). Pelacakan ID mount memakai `Set<string>` memastikan maksimal **1** instance TipTap hidup pada satu waktu (`TipTap instances: 0 | 1`). Ekstensi yang dipakai seluruhnya **MIT**:
   - `StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false, trailingNode: false })`
   - `Underline`, `Link` (validasi URI ketat `http:`, `https:`, `mailto:`, `knovites:<ulid>`), `TextStyle`, `Color`, `FontFamily`, `FontSize` (`@tiptap/extension-text-style/font-size`), `Highlight.configure({ multicolor: true })`, `TextAlign.configure({ types: ['heading', 'paragraph'] })`.
3. **Isolasi input, gagang drag, dan scroll kanvas:**
   - Setiap node memakai `dragHandle: '.knovites-drag-handle'` (gagang di tepi atas di luar tinggi kartu sehingga tidak menggeser teks) dan `draggable={!isEditing}`.
   - Area teks saat edit memiliki kelas `nodrag nowheel nopan` serta `onWheelCapture` saat isi meluap (`scrollHeight > clientHeight`), plus `stopPropagation` pada pointer/mouse/keyboard di editor.
   - Saat mode edit aktif, prop `ReactFlow` `panActivationKeyCode` dan `deleteKeyCode` bernilai `null`, dan listener shortcut global (`H`, `T`, `I`, `[`, `]`, `Ctrl/Cmd+Z`) melewatkan event jika sedang edit atau fokus berada di dalam elemen editable/toolbar.
4. **Toolbar melayang anti-hilang-seleksi:**
   `FloatingToolbar` dirender di luar `.knovites-richtext` (dengan `w-max whitespace-nowrap` agar kontrol seperti `16px` tidak membungkus teks) dan memanggil `event.preventDefault(); event.stopPropagation()` pada `onMouseDown` di setiap tombol, swatch warna, dan dropdown ukuran/font custom sehingga seleksi teks ProseMirror tetap terjaga utuh saat diklik.
5. **Sanitasi paste AST & paritas visual 1:1:**
   `sanitizePastedSlice` memfilter ProseMirror `Slice` hasil paste tanpa menyentuh `innerHTML` (membuang URI non-whitelist seperti `javascript:`, menormalisasi `rgb(...)` ke `#rrggbb`, membuang mark/atribut asing, menurunkan heading level > 3). Mematikan `trailingNode` pada `StarterKit` serta berbagi stylesheet `.knovites-richtext` membuat tampilan statis dan mode edit identik secara geometris dan piksel.

---

## 2. Hasil 9 Tes Interaksi Playwright & Verifikasi

Seluruh 9 tes fungsional + 1 tes benchmark FPS dijalankan via `pnpm exec playwright test -c spikes/s2-tiptap-reactflow/playwright.config.ts` (`10 passed` dalam `16.1s`):

| # | Skenario Tes Playwright (`s2.spec.ts`) | Status | Alasan & Mekanisme Terverifikasi |
| --- | --- | :---: | --- |
| 1 | Mengetik teks termasuk spasi tidak memicu pan (`Space`) maupun shortcut tunggal (`H`, `T`, `I`, `]`, `[`) | **Lulus** | `panActivationKeyCode={null}` saat edit + `handleKeyDown` `stopPropagation` + guard listener global menahan seluruh karakter dan `Space` + drag di dalam `.ProseMirror`. |
| 2 | `Backspace` dan `Delete` saat mengedit **tidak** menghapus elemen | **Lulus** | `deleteKeyCode={null}` saat edit memblokir penghapusan node React Flow; setelah keluar (`Escape`), `ActiveTipTapEditor` unmount (`TipTap instances: 0`) dan `Delete` kembali menghapus node terseleksi. |
| 3 | Memilih teks dengan drag mouse tidak memindahkan kotak | **Lulus** | `dragHandle: '.knovites-drag-handle'`, `draggable: false`, `nodrag`, dan `stopPropagation` pada `mousedown` memungkinkan drag memilih teks tanpa menggeser `(x, y)` kotak. |
| 4 | Scroll di dalam kotak tidak mengubah zoom atau pan kanvas | **Lulus** | Kelas `.nowheel` dan `onWheelCapture` pada kontainer kartu scrollable (`box-scroll`) meningkatkan `scrollTop` isi tanpa mengubah `{ x, y, zoom }` viewport. |
| 5 | Toolbar: klik tombol tidak menghilangkan seleksi teks dan menerapkan format | **Lulus** | `onMouseDown` `preventDefault` pada tombol Bold, swatch Color (`#7c9cff`), dropdown Size (`24px`), dan Font (`JetBrains Mono`) mempertahankan seleksi `'Alpha'` serta menyimpan seluruh mark ke JSON. |
| 6 | Gagang drag memindahkan kotak; pan dan zoom kanvas tetap berfungsi | **Lulus** | Drag pada `[data-testid="drag-handle-box-second"]` menggeser node; `Space` + drag pan di kanvas kosong dan `Control` + wheel zoom tetap berfungsi normal. |
| 7 | `Ctrl/Cmd+Z` saat mengedit hanya membatalkan teks, bukan operasi kanvas | **Lulus** | Snapshot pra-drag kanvas ditangkap di `onNodesChange` saat `dragging: true` pertama; `Ctrl+Z` saat edit hanya meng-undo teks di ProseMirror, sedangkan status net-change sesi edit mencegah push langkah kanvas kosong saat keluar lalu `Ctrl+Z` mengembalikan posisi drag kanvas. |
| 8 | Paste teks berformat dibersihkan sesuai whitelist | **Lulus** | Paste HTML berisi `<script>`, `<img onerror>`, `<h5>`, `<a href="javascript:...">`, `position:fixed`, `onclick`, `rgb(255,0,0)`, `24px`, dan `<strong>` dibersihkan: XSS/script/img terblokir, `BadLink` kehilangan mark tautan, `rgb(255,0,0)` ternormalisasi ke `#ff0000`, `h5` tidak tersimpan sebagai heading > 3. |
| 9 | Tampilan statis dan mode edit identik secara visual | **Lulus** | Perbandingan screenshot `richtext-body-box-rich` statis vs edit aktif menghasilkan dimensi identik **`310×166`** dengan **`diffPixels: 0` (`diffPercent: 0%`)**. |

### Screenshot yang Diperiksa

- [`canvas-static-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-static-dark.png) — Tampilan statis mode gelap (`TipTap instances: 0`)
- [`canvas-edit-dark.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-dark.png) — Mode edit aktif pada `box-rich` + toolbar melayang (`TipTap instances: 1`)
- [`canvas-edit-light.png`](../../spikes/s2-tiptap-reactflow/out/canvas-edit-light.png) — Mode edit aktif pada tema terang
- [`stress-300-dark.png`](../../spikes/s2-tiptap-reactflow/out/stress-300-dark.png) — Uji pan/zoom 300 node statis + 1 editor aktif

---

## 3. Angka FPS Pan dan Zoom (100 & 300 Elemen Statis + 1 Editor Aktif)

Diukur lewat `window.__S2_API__.measurePanZoomFps()` dengan `onlyRenderVisibleElements` aktif pada React Flow di Chromium headless (viewport `1280×800`, 1 editor aktif terbuka bersamaan):

| Beban Kanvas | Durasi (ms) | Frame Count | `p50` Frame Time (FPS) | `p95` Frame Time (FPS) |
| --- | ---: | ---: | ---: | ---: |
| **100** elemen statis + **1** editor aktif | 1107.0 | 38 | **16.7 ms (59.9 fps)** | **50.0 ms (20.0 fps)** |
| **300** elemen statis + **1** editor aktif | 1115.9 | 39 | **16.7 ms (59.9 fps)** | **66.7 ms (15.0 fps)** |

**Catatan pengukuran:** Nilai median (`p50`) tetap di batas 60 fps (`16.7 ms`) bahkan pada 300 node, sedangkan `p95` di Chromium headless tanpa akselerasi GPU mencerminkan lonjakan frame saat `onlyRenderVisibleElements` mem-mount node baru yang masuk ke viewport selama pan/zoom cepat (serta beban CPU container). Verifikasi FPS browser sungguhan dengan GPU tetap perlu dicek ulang pada M4 (`FR-CVS-08`, target `>= 50 fps`).

---

## 4. Perbedaan dari `docs/spec-canvas.md` dan `docs/data-format.md` §5.4

1. **Atribut `textAlign` belum ada di whitelist `data-format.md` §5.4 / `src/domain/schema/tiptap.ts`:**
   `spec-canvas.md` §6.5 (`FR-TXT-01`) mencantumkan rata kiri/tengah/kanan dan prompt S2 memakai `TextAlign`, tetapi parser skema M1 (`src/domain/schema/tiptap.ts`, sesuai `data-format.md` §5.4) saat ini membuang semua `attrs` pada `paragraph` serta atribut selain `level` pada `heading`. Perlu keputusan pemilik sebelum M4 apakah `data-format.md` §5.4 diperluas untuk mengizinkan `textAlign` (`left | center | right | null`) dan schema dinaikkan/diperbarui.
2. **Ekstensi `FontSize` sudah tersedia resmi (MIT) di `@tiptap/extension-text-style/font-size`:**
   Pada `@tiptap/extension-text-style@3.34.0`, `FontSize` tidak lagi perlu ditulis sebagai ekstensi custom terpisah; demikian pula `StarterKit` v3 sudah menyertakan `Link`, `Underline`, dan `UndoRedo`, sehingga keduanya perlu dinonaktifkan di `StarterKit.configure` saat memakai konfigurasi eksplisit agar tidak terjadi duplikasi ekstensi.
3. **`TrailingNode` di `StarterKit` mematahkan paritas tinggi statis vs edit:**
   Secara default TipTap v3 menyisipkan paragraf kosong di akhir blok daftar/kutipan/kode saat masuk mode edit (`+32 px`). `trailingNode: false` (atau kompensasi eksplisit bila dibutuhkan untuk cursor setelah blok kode) wajib ditetapkan agar syarat `FR-TXT-08` (paritas visual statis vs edit) terpenuhi; untuk M4 bila blok terakhir adalah `codeBlock` dan pengguna butuh baris baru di bawahnya, perlu disediakan tombol keluar blok atau `Enter` di akhir blok.
4. **React Flow v13 (`@xyflow/react@13.0.2`) & posisi snapshot pra-drag:**
   `onNodesChange` mengirim objek `NodeChangeset` (`changes.getByType(...)`, `changes.applyTo(nodes)`). Selain itu `onNodeDragStart` bisa terpanggil setelah langkah gerak pertama melewati ambang drag, sehingga snapshot untuk Undo kanvas (`FR-CVS-06`) lebih akurat ditangkap di `onNodesChange` tepat sebelum `PositionChange` dengan `dragging: true` pertama diterapkan.
5. **Verifikasi `pnpm check:bundle`:**
   Kode spike terisolasi di `spikes/s2-tiptap-reactflow/`; ukuran bundle awal produksi (`pnpm check:bundle`) tidak terpengaruh sama sekali.
