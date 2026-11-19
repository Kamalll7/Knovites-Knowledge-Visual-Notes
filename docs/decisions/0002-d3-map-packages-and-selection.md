# 0002 — Memasang paket D3 (`d3-hierarchy`, `d3-zoom`, `d3-shape`, `d3-interpolate`, `d3-ease`, dan `d3-selection`)

- **Tanggal:** 2026-11-19
- **Status:** diterima
- **Task terkait:** Spike S3, T3.1–T3.6 / FR-MAP-01..FR-MAP-17

## Konteks

Keputusan `[LOCKED]` di `docs/prd.md` §3 menetapkan lima paket D3 modular untuk peta pohon SVG: `d3-hierarchy`, `d3-zoom`, `d3-shape`, `d3-interpolate`, dan `d3-ease`. Saat mengikat `d3-zoom` ke elemen `<svg>` dan memanggil `zoomBehavior.transform(selection, ...)`, API resmi `d3-zoom@3.0.1` mewajibkan argumen bertipe `Selection` dari `d3-selection`. Karena pnpm menggunakan `node_modules` terisolasi (strict hoisting), `d3-selection` perlu dipasang langsung agar dapat diimpor oleh TypeScript strict tanpa bergantung pada resolusi transitif.

## Opsi yang dipertimbangkan

1. **Memasang 5 paket PRD + `d3-selection` (+ `@types/d3-*`)** — sesuai API resmi `d3-zoom`, ukuran sangat kecil (~5 KB gzip), zero `any`.
2. **Memakai bungkus tipe custom untuk `select(svgRef.current)` tanpa `d3-selection`** — rapuh dan berisiko tidak sinkron dengan perilaku event `d3-zoom`.

## Keputusan

Memasang paket-paket berikut ke `package.json`:

- `d3-hierarchy@3.1.3` (lisensi: ISC)
- `d3-zoom@3.0.1` (lisensi: ISC)
- `d3-shape@3.2.1` (lisensi: ISC)
- `d3-interpolate@3.0.2` (lisensi: ISC)
- `d3-ease@3.0.2` (lisensi: BSD-3-Clause)
- `d3-selection@3.0.1` (lisensi: ISC)
- Beserta `@types/d3-*` di `devDependencies` (0 byte di bundle produksi).
- Dampak bundle produksi saat ini: **0 byte** (selama M2–Spike S3, baru diimpor oleh `spikes/s3-radial/` di luar `src/`). Ketika M3 memakainya, keenam paket menyumbang total sekitar ~12–16 KB gzip (jauh di bawah batas 600 KB).

## Dampak

- `package.json` dan `pnpm-lock.yaml` mencatat keenam modul D3 dan definisi tipenya.
- Tidak ada keputusan **[LOCKED]** di `prd.md` yang diganti (kelima paket di `prd.md` §3 tetap dipakai, ditambah `d3-selection` yang menjadi pasangan resmi `d3-zoom`).

