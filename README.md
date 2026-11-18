# Knovites

**Knovites (Knowledge Visual Notes)** adalah aplikasi web catatan pengetahuan berbentuk pohon visual dengan kanvas bebas per node dan penyimpanan di repo GitHub pribadi pengguna (static web app tanpa backend).

## Dokumentasi & Panduan Engineering

- [AGENTS.md](./AGENTS.md) — aturan kerja, arsitektur layer, perintah CLI, dan Definition of Done untuk coding agent
- [docs/README.md](./docs/README.md) — peta dokumen PRD Phase 1 dan urutan baca per milestone
- [docs/plan.md](./docs/plan.md) — milestone, spike S1–S3, dan daftar task
- [docs/decisions/0000-template.md](./docs/decisions/0000-template.md) — template Architecture Decision Record (ADR)
- [docs/open-questions.md](./docs/open-questions.md) — pertanyaan terbuka untuk pemilik dan catatan temuan/perbedaan dokumentasi
- [docs/spikes/README.md](./docs/spikes/README.md) — lokasi laporan hasil spike

## Perintah Pengembangan

```bash
pnpm install --frozen-lockfile
pnpm dev          # jalankan dev server Vite
pnpm typecheck    # cek tipe TypeScript strict
pnpm lint         # ESLint + aturan batas layer
pnpm format:check # cek format Prettier
pnpm test         # tes unit & batas layer (Vitest)
pnpm build        # build produksi
pnpm check:bundle # verifikasi budget ukuran bundle gzip
pnpm test:e2e     # tes end-to-end (Playwright Chromium)
pnpm audit        # audit kerentanan dependensi
```
