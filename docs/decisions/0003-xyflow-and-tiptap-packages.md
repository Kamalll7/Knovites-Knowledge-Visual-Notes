# 0003 — Penambahan `@xyflow/react` dan paket TipTap berlisensi MIT (Spike S2)

- **Tanggal:** 2026-11-19
- **Status:** diterima (untuk Spike S2; validasi akhir sebelum M4)
- **Task terkait:** Spike S2 / FR-CVS-01, FR-CVS-04, FR-TXT-01, FR-TXT-08 (`docs/spec-canvas.md`)

## Konteks

Kanvas bebas Knovites membutuhkan `@xyflow/react` untuk pan/zoom/node bebas serta editor teks kaya berbasis TipTap yang hanya hidup satu instance pada satu waktu (`FR-TXT-08`). Elemen teks yang tidak sedang diedit harus dirender secara statis dari JSON ProseMirror menjadi elemen React **tanpa `dangerouslySetInnerHTML`** (`AGENTS.md` aturan #5) dan **tanpa ekstensi TipTap Pro**.

## Opsi yang dipertimbangkan

1. **Memakai `@tiptap/static-renderer@3.34.0` (`pm/react`) + paket TipTap MIT resmi** (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-font-family`, `@tiptap/extension-highlight`, `@tiptap/extension-text-align`, `@tiptap/extension-underline`, `@tiptap/extension-link`) bersama `@xyflow/react@13.0.2`:
   - Seluruh paket terverifikasi berlisensi **MIT** dan kompatibel dengan React 19 (`^19.0.0` / `>=18`).
   - `@tiptap/static-renderer/pm/react` (`renderToReactElement`) membangun elemen langsung lewat `React.createElement` (bukan string HTML / `dangerouslySetInnerHTML`) dengan konfigurasi ekstensi yang sama persis dengan editor aktif, menjaga kesamaan visual statis vs edit.
2. **Menulis renderer statis custom penuh + ekstensi custom `FontSize`:**
   - Lebih banyak duplikasi aturan `renderHTML` antar ekstensi sehingga rawan melenceng secara visual dari editor aktif (`FR-TXT-08`).

## Keputusan

Memasang `@xyflow/react@13.0.2` dan paket-paket TipTap MIT v3.34.0 di atas (seluruhnya berlisensi **MIT**, tanpa TipTap Pro). Paket baru tidak mengubah `src/` maupun bundle produksi pada tahap Spike S2 karena hanya diimpor di `spikes/s2-tiptap-reactflow/` (terverifikasi oleh `pnpm check:bundle`).

Detail versi dan lisensi yang dipasang (`package.json`):
- `@xyflow/react`: `13.0.2` (MIT)
- `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/static-renderer`: `3.34.0` (MIT)
- `@tiptap/extension-text-style` (sudah mencakup `FontSize`, `Color`, `FontFamily`), `@tiptap/extension-color`, `@tiptap/extension-font-family`, `@tiptap/extension-highlight`, `@tiptap/extension-text-align`, `@tiptap/extension-underline`, `@tiptap/extension-link`: `3.34.0` (MIT)

## Dampak

- Tidak ada keputusan **[LOCKED]** di PRD yang dilanggar (`AGENTS.md` aturan #5 & #9 tetap terpenuhi: semua MIT, tanpa TipTap Pro, tanpa `dangerouslySetInnerHTML`).
- Penilaian paritas visual dan performa menjadi bahan laporan Spike S2 (`docs/spikes/s2-tiptap-reactflow.md`) sebelum M4.

