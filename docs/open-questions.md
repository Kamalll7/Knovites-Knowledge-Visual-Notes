# Knovites — Pertanyaan Terbuka dan Catatan Temuan

Dua bagian: pertanyaan untuk pemilik (diisi pemilik), dan catatan temuan agent (diisi agent selama pengerjaan).

## Pertanyaan untuk pemilik (Lampiran D)

Nama produk sudah ditetapkan: **Knovites (Knowledge Visual Notes)**.

1. **Nama repo.** Nama repo aplikasi (usulan: `knovites`) dan repo knowledge pribadi (usulan: `knovites-knowledge`, privat). Jawaban: nama repo Knovites dan itu public
2. **Lisensi** repo aplikasi (usulan: MIT). Jawaban: nanti dipikirkan setelah jadi
3. **Hosting:** GitHub Pages atau Cloudflare Pages. Dibutuhkan sebelum M8. Jawaban: Github pages (i guess?)
4. **Root virtual:** perlu halaman catatan sendiri (home)? Default: tidak. Jawaban: Mungkin iya, idk. 
5. **Bahasa UI:** default English, setuju? Jawaban: Setuju
6. **Referensi gaya visual peta:** 2-3 contoh tampilan yang disukai (tautan atau screenshot), untuk menyetel palet dan gaya node. **Dibutuhkan sebelum spike S3.** Jawaban: di Image_reference_1 dan 2 
7. **Repo uji untuk spike S1:** repo privat sementara dan fine-grained token (hanya Contents read/write untuk repo itu). Token diberikan lewat `.env.local`, tidak pernah di-commit. Jawaban: idk

## Catatan temuan agent

Format entri:

```
### YYYY-MM-DD — judul singkat
- Task: T... / FR-...
- Masalah atau ambiguitas:
- Opsi yang dipertimbangkan:
- Keputusan sementara (opsi paling sederhana):
- Perlu keputusan pemilik: ya/tidak
```

### 2026-11-18 — Penyimpanan tema di `localStorage` (`knovites.theme`)
- Task: T0.4 / FR-LOC-02 (§6.10), FR-SET-01 (§6.14)
- Masalah atau ambiguitas: `spec-storage-sync.md` §6.10 (FR-LOC-02) menyebut reload memulihkan tema dengan IndexedDB sebagai penyimpanan lokal utama, sedangkan Dexie (M2) belum dibangun di T0.4 dan pembacaan IndexedDB bersifat asinkron.
- Opsi yang dipertimbangkan:
  1. Simpan tema di `localStorage` (`knovites.theme`) sekarang (sinkron, bebas FOUC saat reload), lalu bila perlu cerminkan ke tabel settings Dexie pada M2.
  2. Tunggu M2 / simpan di memori saja (hilang saat reload di T0.4).
- Keputusan sementara (opsi paling sederhana): Memakai `localStorage` (`knovites.theme`) di `ThemeProvider` agar reload langsung memulihkan tema tanpa kilatan warna salah (FOUC) dan tanpa menunggu IndexedDB asinkron. Tidak menyimpan token atau isi catatan di `localStorage` (§7.3 tetap terpenuhi).
- Perlu keputusan pemilik: tidak (kecuali ingin memindahkan ke Dexie di M2 dengan tetap menjaga sinkronisasi anti-FOUC).

### Perbedaan PRD dan dokumentasi resmi

Catat di sini setiap kali dokumentasi resmi berbeda dari PRD (nama API, parameter, batas, perilaku). Format: apa kata PRD, apa kata dokumentasi (dengan tautan dan versi), dan apa yang dilakukan.

- **2026-11-18 (T0.4) — `react-router@8.5.1` & `@fontsource-variable/inter@5.3.0`:** Pada React Router v7/v8, komponen router DOM (`HashRouter`, `Routes`, `Route`, `NavLink`, `Link`, `useParams`, `useLocation`) diekspor langsung dari paket `react-router` tanpa memerlukan `react-router-dom`. Untuk font UI `Inter` (`spec-ui-nfr.md` §8.1), dipakai `@fontsource-variable/inter` (self-hosted, menggantikan `@fontsource-variable/geist` bawaan inisialisasi `shadcn`).
- **2026-11-18 (T0.3) — Advisory `GHSA-fc5q-39xc-vjpf` (`picomatch <=4.0.7`, tanpa versi patched):** `pnpm audit` melaporkan 1 advisory `high` pada `picomatch@4.0.7` (dependensi transitif dev-only di `vite`, `vitest`, `typescript-eslint`, `eslint-plugin-boundaries`) dengan `Patched versions: None` (4.0.7 adalah versi terbaru). `pnpm audit --prod` bersih (0 kerentanan). **Tindakan:** CI menjalankan `pnpm audit --prod` (tanpa pengecualian) dan `pnpm audit --ignore GHSA-fc5q-39xc-vjpf` sampai `picomatch` merilis versi perbaikan.

- **2026-11-17 (T0.1) — Versi TypeScript vs `typescript-eslint`:** PRD §3 menyebut memakai versi stabil terbaru saat inisialisasi. Versi terbaru `typescript` di npm adalah `7.0.2`, namun `typescript-eslint@8.73.0` mensyaratkan `typescript: ">=4.8.4 <6.1.0"`, dan template resmi `create-vite@9.3.4` (`react-ts`) menggunakan `typescript: "~6.0.3"`. **Tindakan:** Mengunci `typescript: "~6.0.3"` agar selaras dengan template Vite dan `typescript-eslint`.
- **2026-11-17 (T0.1) — Tailwind CSS v4 & shadcn/ui (`radix`):** PRD §3 menyebut Tailwind CSS + shadcn/ui (Radix). Dokumentasi resmi Tailwind v4 (`@tailwindcss/vite@4.3.5`) memakai CSS-first config (`@import 'tailwindcss'` dan `@theme inline` di `src/index.css`) tanpa `tailwind.config.js`, dan `shadcn@4.23.0` (`init -t vite -b radix`) memasang paket terpadu `radix-ui@1.8.1`, `tw-animate-css@1.4.0`, `cn@0.5.2`, serta `@fontsource-variable/geist@5.3.0` (nanti di T0.4 akan disetel ke `@fontsource/inter` sesuai `spec-ui-nfr.md` §8.1). Komponen shadcn ditempatkan di `src/ui/` lewat alias di `components.json` agar sesuai struktur `prd.md` §4.1.
- **2026-11-17 (T0.1) — `eslint-plugin-boundaries@7.4.4`:** Pada v7, rule `boundaries/element-types` dan opsi `mode` di `boundaries/elements` telah digantikan oleh `boundaries/dependencies` (berbasis `policies`), `partialMatch: false`, dan `boundaries/files` (untuk file individual seperti `src/main.tsx` dan file tes). **Tindakan:** Menggunakan API v7 sesuai README resmi paket terpasang.
