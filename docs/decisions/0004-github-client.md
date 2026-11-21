# 0004 — Klien GitHub REST untuk Browser: Thin `fetch` Client vs `octokit` (Spike S1)

- **Tanggal:** 2026-11-21
- **Status:** diusulkan (`[Rekomendasi]` untuk M6; `octokit@5.0.5` hanya di `devDependencies` saat S1)
- **Task terkait:** Spike S1, M6 / `T6.2`, `FR-SYNC-01..08` (`docs/spec-storage-sync.md`, `docs/plan.md`)

## Konteks

Milestone M6 membutuhkan klien browser-only untuk berkomunikasi langsung dengan `https://api.github.com` (Git Data API: `blobs`, `trees`, `commits`, `refs`; Contents API untuk inisialisasi repo kosong; `GET /rate_limit` & `GET /repos`). Kebutuhan utama Knovites di M6:
1. Berjalan di browser modern lewat CORS dengan kontrol eksplisit atas `cache: 'no-store'`, `If-None-Match` (`304`), dan custom media type `Accept: application/vnd.github.raw+json`.
2. Tidak melakukan retry otomatis secara diam-diam pada `403`/`429` di luar backoff eksplisit scheduler sync dan batas konkurensi (`<= 4` baca, throttle tulis).
3. Menjaga total ukuran initial bundle tetap hemat terhadap anggaran **600 KB gzip** (`docs/spec-ui-nfr.md` §7.1; baseline produksi saat ini ~190.82 KB gzip).

## Opsi yang dipertimbangkan

1. **Thin native `fetch` client (`fetch-client.ts`, ~230 baris termasuk tipe):**
   - Diuji di [`spikes/s1-github-git-data/fetch-client.ts`](../../spikes/s1-github-git-data/fetch-client.ts).
   - Ukuran bundle hasil `vite build` (`bundle-bench.mjs`): **`9.045 B` (`8.83 KB`) raw / `3.195 B` (`3.12 KB`) gzip**.
   - Kontrol penuh per request atas `cache: 'no-store'`, `If-None-Match` yang mengembalikan status `304` tanpa exception, `Accept: application/vnd.github.raw+json` ke `Uint8Array`, dan penanganan status `403`/`422`/`429` secara seragam tanpa plugin tambahan.
   - Konsekuensi: tipe request/response untuk ~12 endpoint Git Data + Contents API dirawat sendiri (mudah diuji karena `T6.1` memakai mock `msw`).

2. **`octokit@5.0.5` (paket all-batteries-included, lisensi MIT):**
   - Terverifikasi lewat `pnpm view octokit` berlisensi **MIT** (0 kerentanan pada `pnpm audit` / `pnpm audit --prod`).
   - Diuji di [`spikes/s1-github-git-data/octokit-client.ts`](../../spikes/s1-github-git-data/octokit-client.ts).
   - Ukuran bundle hasil `vite build` (`bundle-bench.mjs`):
     - `export { Octokit } from 'octokit'`: **`214.293 B` (`209.27 KB`) raw / `46.621 B` (`45.53 KB`) gzip**.
     - `OctokitSpikeClient` + `octokit`: **`220.947 B` (`215.77 KB`) raw / `48.522 B` (`47.38 KB`) gzip**.
   - Kelebihan: tipe OpenAPI lengkap bawaan (`octokit.rest.git.*`, `octokit.rest.repos.*`).
   - Kekurangan: selisih **+44.26 KB gzip** (+207 KB raw JS untuk di-parse/compile), dan constructor default mengaktifkan `@octokit/plugin-throttling` + `@octokit/plugin-retry` sehingga wajib dimatikan eksplisit (`throttle: { enabled: false }, retry: { enabled: false }`) agar tidak bentrok dengan kebijakan rate-limit/backoff Knovites sendiri.

3. **`@octokit/core@7.0.8` (MIT, minimal core tanpa `rest-endpoint-methods`):**
   - Ukuran bundle pastinya tidak diukur terpisah karena di Spike S1 hanya `octokit` yang dipasang langsung sebagai `devDependency` (`[Belum terbukti]`), dan tetap tidak memberi method bertipe `octokit.rest.git.*` tanpa `@octokit/plugin-rest-endpoint-methods` yang justru membawa sebagian besar bobot OpenAPI `octokit`.

## Keputusan

Untuk **Spike S1**:
- Memasang `octokit@5.0.5` hanya sebagai `devDependency` agar perbandingan nyata di browser dapat diukur dan dipastikan lisensinya (`MIT`).

**Rekomendasi untuk M6 (`[Rekomendasi]` — menunggu konfirmasi pemilik):**
- Memakai **Thin native `fetch` client** di `src/sync/` (berdasarkan prototipe [`fetch-client.ts`](../../spikes/s1-github-git-data/fetch-client.ts)) daripada memaketkan `octokit` penuh ke produksi, dengan opsi memakai paket `@octokit/types` atau fixture lokal sebagai acuan tipe bila diperlukan.

## Dampak

- **Ukuran bundle produksi:** Menghemat **44.26 KB gzip** (~207 KB raw JS) dibanding `octokit@5.0.5`. Bahkan bila diletakkan di initial chunk (~190.82 KB + 3.12 KB ≈ 194 KB vs 600 KB budget), margin anggaran performa tetap sangat longgar.
- **Keamanan & aturan `AGENTS.md`:** Tidak ada ketergantungan runtime baru ke produksi saat S1 (`src/` tidak berubah). Jika pemilik memilih Thin `fetch` di M6, `octokit` dari `devDependencies` dapat dihapus saat memasuki M6 (atau tetap dev-only untuk referensi/skrip).
- **Kepatuhan retry & redaction:** Klien tipis memastikan zero retry liar pada `403`/`429` dan memusatkan redaksi token + pembatas konkurensi di satu lapisan fetch.

