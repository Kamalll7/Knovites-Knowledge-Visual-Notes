# Knovites — Peta Dokumen

PRD Phase 1 (v0.1, 16 November 2026) dipecah menjadi beberapa file supaya agent hanya perlu membaca bagian yang relevan. **Penomoran bagian (§) sama di semua file**, jadi rujukan seperti `§6.12` tetap valid.

## Isi file

- `prd.md` — §0-§4: cara memakai dokumen, ringkasan produk, tujuan dan non-tujuan, keputusan teknis [LOCKED], arsitektur.
- `data-format.md` — §5: format file di repo knowledge, serialisasi kanonik, aset, versioning skema, skema database lokal.
- `spec-map.md` — §6.2: peta pohon (FR-MAP).
- `spec-canvas.md` — §6.3-§6.6: halaman node, kanvas, penyuntingan teks, gambar (FR-PAGE, FR-CVS, FR-TXT, FR-IMG).
- `spec-nodes-search.md` — §6.7-§6.9: manajemen node, link, pencarian (FR-NODE, FR-LNK, FR-SRC).
- `spec-storage-sync.md` — §6.1, §6.10-§6.13: onboarding, persistensi lokal, sinkronisasi GitHub, konflik, export (FR-ONB, FR-LOC, FR-SYNC, FR-CNF, FR-EXP).
- `spec-ui-nfr.md` — §6.14, §7, §8: settings, persyaratan non-fungsional, spesifikasi UI dan UX.
- `testing.md` — §9: strategi pengujian, fake GitHub, alur e2e, CI, QA manual.
- `plan.md` — §10: milestone, spike, dan daftar task untuk agent.
- `appendix.md` — Definition of Done, risiko, backlog setelah Phase 1, glosarium.
- `open-questions.md` — pertanyaan terbuka untuk pemilik dan catatan temuan agent.
- `decisions/` — catatan keputusan (ADR). Salin `0000-template.md` untuk membuat yang baru.
- `spikes/` — laporan hasil spike (diisi agent).

`AGENTS.md` ada di root repo, bukan di folder ini.

## Konvensi

- **[LOCKED]** keputusan final, tidak boleh diganti tanpa persetujuan pemilik. **[OPEN]** boleh diputuskan implementer selama acceptance criteria terpenuhi.
- **P0** wajib untuk Phase 1, **P1** sebaiknya ada, **P2** hanya jika waktu sisa.
- Setiap requirement punya ID (contoh `FR-MAP-03`) untuk dirujuk di commit, tes, dan task.

## Urutan baca per milestone

- **M0 Fondasi:** `prd.md`, `spec-ui-nfr.md` (§7, §8.1), `testing.md` (§9.6), `plan.md`.
- **M1 Domain:** `data-format.md`, `spec-nodes-search.md` (§6.7), `plan.md`.
- **M2 Storage dan state:** `data-format.md` (§5.9), `spec-storage-sync.md` (§6.10), `plan.md`.
- **Spike S1-S3:** `plan.md` (bagian spike), lalu `spec-storage-sync.md` (§6.11) untuk S1, `spec-canvas.md` (§6.4-§6.5) untuk S2, `spec-map.md` untuk S3.
- **M3 Peta:** `spec-map.md`, `spec-ui-nfr.md` (§8), `spec-nodes-search.md` (§6.7), `testing.md`.
- **M4 Halaman dan kanvas:** `spec-canvas.md`, `data-format.md` (§5.4, §5.6), `testing.md`.
- **M5 Pencarian dan link:** `spec-nodes-search.md` (§6.8, §6.9).
- **M6 GitHub:** `spec-storage-sync.md`, `testing.md` (§9.3, §9.7), `data-format.md`.
- **M7-M8 Polish dan rilis:** `spec-ui-nfr.md`, `spec-storage-sync.md` (§6.13), `plan.md`.

## Status

Dokumen ini adalah draf v0.1. Detail API dan versi library belum diverifikasi terhadap dokumentasi terbaru (lihat aturan verifikasi di `AGENTS.md`). Spike S1-S3 di `plan.md` ada untuk menguji asumsi yang paling berisiko sebelum desain dikunci.
