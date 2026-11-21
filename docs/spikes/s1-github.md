# Laporan Spike S1 — GitHub Git Data API dari Browser

- **Verdict:** **LOLOS BERSYARAT.** Seluruh alur inti Git Data API (`GET/POST/PATCH/DELETE` refs, `commits`, `trees` rekursif + `base_tree`, `blobs` base64 + `raw+json`, `If-None-Match` -> `304`, penolakan non-fast-forward `422`, dan penolakan `sha: null` pada path absen `422`) terbukti bekerja penuh **langsung dari browser Chromium melalui CORS tanpa backend** (`11/11` tes Playwright + `4/4` uji mutasi lulus). **Status bersyarat (`[Belum terbukti]`):** (1) perilaku `409 Conflict` pada repositori **kosong** + inisialisasi lewat Contents API tidak dapat diuji secara runtime pada `knovites-s1-test` karena branch `main` sudah ada dan tidak boleh dikosongkan/diubah; (2) perilaku repo organisasi SSO/SAML, pohon >100.000 entri (`truncated: true`), blob >10 MB hingga 100 MB, serta jaringan lambat/seluler belum diuji.
- **Kode prototipe (sekali pakai, terpisah dari `src/` dan build produksi):** [`spikes/s1-github-git-data/`](../../spikes/s1-github-git-data/)
- **Dokumen & ADR terkait:** [`docs/spec-storage-sync.md`](../spec-storage-sync.md) (§6.1, §6.11), [`docs/data-format.md`](../data-format.md) (§5.1, §5.9), [`docs/plan.md`](../plan.md) (Spike S1 & Prasyarat M6), [`docs/open-questions.md`](../open-questions.md), dan ADR [`0004-github-client.md`](../decisions/0004-github-client.md).

---

## 1. Referensi Dokumentasi Resmi yang Diverifikasi Sebelum Implementasi

Seluruh perilaku berikut diverifikasi terhadap dokumentasi GitHub REST API (`api.github.com`, `X-GitHub-Api-Version: 2022-11-28`) dan definisi OpenAPI/JSDoc paket terpasang `octokit@5.0.5` (`node_modules/octokit/README.md` & `@octokit/plugin-rest-endpoint-methods@17.0.0`):

1. **Git Blobs** (`https://docs.github.com/rest/git/blobs#create-a-blob`, `#get-a-blob`): mendukung blob hingga **100 MB** (`"This endpoint supports blobs up to 100 megabytes in size."`); default `application/vnd.github+json` mengembalikan `content` base64, sedangkan `Accept: application/vnd.github.raw+json` mengembalikan byte mentah.
2. **Git Trees** (`https://docs.github.com/rest/git/trees#create-a-tree`, `#get-a-tree`): `GET ?recursive=1` dibatasi maks **100.000 entri** atau **7 MB** (`truncated: true`); `POST /git/trees` menyatakan eksplisit: *"Returns an error if you try to delete a file that does not exist."*
3. **Git Commits** (`https://docs.github.com/rest/git/commits#create-a-commit`, `#get-a-commit`): membuat objek commit dari `tree` + `parents[]`.
4. **Git References** (`https://docs.github.com/rest/git/refs#update-a-reference`, `#create-a-reference`, `#get-a-reference`): parameter `{ref}` di URL memakai format `heads/<branch>`; `force` default `false` menolak non-fast-forward dengan **`422`** (`"Update is not a fast forward"`). Untuk repo kosong (*without branches*), `createRef` tidak diizinkan dan Git Database endpoint mengembalikan **`409 Conflict`** hingga diinisialisasi lewat Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`).
5. **Rate Limits, Conditional Requests, & CORS** (`https://docs.github.com/en/rest/using-the-rest-api`): authenticated PAT `5.000 req/jam`, secondary limit (konkurensi/poin per menit, tulis 5 poin vs baca 1 poin, batas konten 80/menit & 500/jam); `If-None-Match` yang mengembalikan `304 Not Modified` **tidak memotong kuota primer**; browser CORS mengekspos header via `Access-Control-Expose-Headers`.
6. **Octokit (`octokit@5.0.5`, lisensi `MIT`):** Secara default mengaktifkan `@octokit/plugin-throttling@11.0.3` dan `@octokit/plugin-retry@8.0.3` (yang melakukan retry otomatis pada rate limit/error). Untuk mencegah retry membabi buta pada `403`/`429`, wajib dimatikan (`throttle: { enabled: false }, retry: { enabled: false }`).

---

## 2. Solusi Prototipe & Guardrail Keamanan

1. **Keamanan & Isolasi Repo (`AGENTS.md` #6, #8):**
   - Token `KNOVITES_S1_TOKEN` dan target `KNOVITES_S1_REPO` dimuat hanya di proses Node Playwright lewat `process.loadEnvFile('.env.local')`, diteruskan langsung ke memori sesi uji browser tanpa `VITE_*` / `define` / `localStorage`, dan seluruh keluaran log/header/error disaring lewat [`redact.ts`](../../spikes/s1-github-git-data/redact.ts) (`/github_pat_[A-Za-z0-9_]+/g`, header `authorization`). Config [`playwright.config.ts`](../../spikes/s1-github-git-data/playwright.config.ts) mematikan `trace`, `video`, dan `screenshot` (`'off'`).
   - Guard pra-tulis wajib lolos sebelum mutasi apa pun: nama repo mengandung `"s1-test"` **dan** `GET /repos/{owner}/{repo}` mengembalikan `private: true`.
   - Seluruh penulisan hanya menyentuh branch sementara `s1-run-<timestamp>-*` dan dihapus dalam blok `finally`. Commit `HEAD main` (`00f337a1d8bfac45ae3f3cb161f62a713eedf38a`) identik sebelum dan sesudah pengujian, dengan `0` branch `s1-run-*` tersisa.
2. **Pembatas Rate Limit ([`rate-guard.ts`](../../spikes/s1-github-git-data/rate-guard.ts)):**
   - Maks `4` GET konkuren, jeda minimal `1.050 ms` antar permintaan tulis (`POST`/`PATCH`/`DELETE`), batas anggaran `<= 350` tulis per run (run penuh terpakai: **`174` tulis**), dan langsung `abort` (tanpa retry) pada HTTP `403`/`429` atau `x-ratelimit-remaining < 500`.
3. **Planner `Changeset` Murni ([`planner.ts`](../../spikes/s1-github-git-data/planner.ts)) & SHA-1 Lokal ([`sha1.ts`](../../spikes/s1-github-git-data/sha1.ts)):**
   - Meniru bentuk `{ deletes, moves, upserts }` (`src/domain/tree/types.ts`) tanpa mengimpor `src/`.
   - Menyortir eksekusi `deletes -> moves -> upserts`, men-snapshot seluruh `from` sebelum mutasi (mendukung tukar nama `swap-a <-> swap-b`, rename *case-only*, move menimpa target, dan aturan `upserts` menang di path sama), memelihara `extraFiles`, dan menyaring `deletes` terhadap tree remote agar path yang absen tidak pernah dikirim sebagai `sha: null`.

---

## 3. Ringkasan Hasil Uji (`11/11 Lulus`) & Uji Mutasi (`4/4 Terdeteksi`)

Dijalankan penuh di Chromium headless lewat `pnpm exec playwright test -c spikes/s1-github-git-data/playwright.config.ts` (`11 passed (7.6m)`, `174` tulis).

| ID | Pengujian | Status | Fakta Terukur |
| --- | --- | :---: | --- |
| `U1` | Planner murni (`deletes->moves->upserts`, *case-only*, swap, overwrite, `extraFiles`, skip missing delete) | **Lulus** | `catatan/does-not-exist.json` dilewati; `swap-a`/`swap-b` bertukar SHA tepat; `CaseOnly.json -> caseonly.json`; `upserts` menang atas `moves.to`. |
| `U2` | Perhitungan SHA-1 blob Git lokal (`SHA-1("blob " + len + "\0" + bytes)`) | **Lulus** | Blob kosong `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, `"hello\n"` `ce013625030ba8dba906f756967f9e9ca394464a`, plus UTF-8 non-ASCII. |
| `U3` | Redaksi rahasia (`redactSecrets`) | **Lulus** | Token `github_pat_*` dan header `Bearer` diganti `[REDACTED]`. |
| `B1` | Guard repo privat `s1-test`, rate limit, CORS headers, paritas read `Octokit` vs `Fetch` | **Lulus** | `GET /repos`, `/rate_limit`, `/git/trees?recursive=1`: keduanya `200`, SHA tree identik (`fetch 651.6 ms`, `octokit 705.6 ms`). |
| `B2` | Fixture 30 node (77 path baru incl. 15 PNG, path Unicode/spasi `"ide baru — café 3"`, `extraFiles`) + tulis via `Octokit` | **Lulus** | Seluruh 15 SHA-1 PNG lokal cocok `100%` dengan `createBlob`; path Unicode & `README-extra.txt` utuh saat `getTree(recursive=1)` (`truncated: false`); `octokitRoundtripOneBlob` lulus (`refStatus: 200`, `blobMatch: true`); pull 5 PNG (`concurrency<=4`) `1.66 s` (`verifiedCount: 5`). |
| `B3` | Changeset live + probe `sha: null` untuk path tidak ada | **Lulus** | Probe langsung `{ path: "s1-plan/nonexistent-ghost-file.json", sha: null }` ditolak **`HTTP 422`**. Changeset terencana sukses `200`, `swapOk: true`, `keep-extra.txt` bertahan, `winnerDecoded: "{\"winner\":\"upsert-wins\"}"`. |
| `B4` | Non-fast-forward `PATCH /git/refs` dengan `force: false` | **Lulus** | Fast-forward `200`, commit bercabang ditolak **`HTTP 422`** dengan pesan `"Update is not a fast forward"`. |
| `B5` | Conditional `GET` (`If-None-Match` -> `304`) `no-store` vs `default` | **Lulus** | Request 1 `200` (`remaining 4896`); dengan `If-None-Match` (`no-store`) -> **`304`** (`718.2 ms`, **`remaining` tetap `4896`**); `cache: 'default'` -> `304`; tanpa `If-None-Match` -> `200` (`remaining 4895`). |
| `B6` | Blob besar (`1 MB` PNG & `10 MB` biner), SHA-1 lokal, `base64` vs `raw+json` | **Lulus** | Keduanya `createStatus: 201` dan SHA-1 lokal identik (`3f861d37...`, `c5fae007...`). Baca `json` & `raw+json` sama-sama `200` + kecocokan byte 100%; `raw+json` lebih cepat (1 MB: `748.3 ms` vs `767.7 ms`; 10 MB: `1.177,4 ms` vs `1.340,5 ms`). |
| `B7` | Benchmark latensi push & pull (`N = 5, 30, 80` blob + `inline N=30`) | **Lulus** | Semua `verifiedCount === N` (lihat tabel §5). |
| `B8` | Verifikator akhir kebersihan repo | **Lulus** | `leftoverBranches: 0`, `mainHeadSha` tetap `00f337a1d8bfac45ae3f3cb161f62a713eedf38a`, `totalWritesAcrossSuite: 174 <= 350`. |

### Uji Mutasi Terkendali (Satu per Satu, Di-revert Penuh Setelahnya)

1. **(a) Hapus `If-None-Match` di `pollBranchHeadIfChanged` (`sync-flow.ts`):** **`B5` GAGAL** (`Expected: 304, Received: 200` pada `s1.spec.ts:675`). Di-revert.
2. **(b) Kirim `sha: null` untuk path tidak ada (`allowMissingDeletes ?? true` di `planner.ts`):** **`U1` GAGAL** (`skippedMissingDeletes` menerima `[]`, alih-alih `["catatan/does-not-exist.json"]` pada `s1.spec.ts:148`). *(Catatan: `B3` tetap melewati path absen selama mutasi ini karena `sync-flow.ts` meneruskan argumen default eksplisit `allowMissingDeletes = false` — probe `B3` membuktikan secara independen bahwa GitHub mengembalikan `422` bila `sha: null` dikirim ke path absen).* Di-revert.
3. **(c) Ubah `force: false` menjadi `true` di `updateBranchHeadSafe` (`sync-flow.ts`):** **`B4` GAGAL** (`expect(outcome.conflictOk).toBe(false)` menerima `true` pada `s1.spec.ts:611` karena update non-fast-forward diterima). Di-revert.
4. **(d) Lewati `deleteRef` di `cleanupTempBranch` (`sync-flow.ts`):** `B4` lulus, lalu **`B8` GAGAL** (`expect(leftover.data).toEqual([])` menemukan `refs/heads/s1-run-...` pada `s1.spec.ts:937`). Branch sisa dibersihkan dan kode di-revert.

---

## 4. Detail Terukur API: HTTP Status, CORS Headers, & Body Redacted

### 4.1 Header CORS yang Terekspos ke JavaScript Browser (`api.github.com`)

Pada respons normal `200 OK` (`GET /git/trees`, `B1`), daftar header yang dapat dibaca langsung lewat `response.headers` di Chromium (`Access-Control-Expose-Headers`):
```json
[
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
  "x-github-media-type",
  "x-github-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "x-ratelimit-used"
]
```
Pada `GET /git/blobs/{sha}` dengan header `Accept: application/vnd.github.raw+json` (`B6`), Chromium menyelesaikan preflight CORS dan mengembalikan `200 OK` dengan:
- `content-type`: `"application/octet-stream"`
- `x-github-media-type`: `"github.v3; param=raw; format=json"`
- `content-length`: `"1048576"` (`1 MB`) dan `"10485760"` (`10 MB`)
- `cache-control`: `"private, max-age=86400, s-maxage=86400"`

### 4.2 Respons Error Eksak (`B3` & `B4`)

- **Hapus path tidak ada via `POST /repos/{owner}/{repo}/git/trees` (`sha: null`, `B3`):**
  - Status: **`422`**
  - Body:
    ```json
    {
      "message": "GitRPC::BadObjectState",
      "documentation_url": "https://docs.github.com/rest/git/trees#create-a-tree",
      "status": "422"
    }
    ```
- **Update ref non-fast-forward via `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}` (`force: false`, `B4`):**
  - Status: **`422`**
  - Body:
    ```json
    {
      "message": "Update is not a fast forward",
      "documentation_url": "https://docs.github.com/rest/git/refs#update-a-reference",
      "status": "422"
    }
    ```
- **Repo kosong (`409 Conflict`) `[Belum terbukti]` secara runtime:** Repo uji `knovites-s1-test` sudah memiliki branch `main` (`00f337a1d8...`). Berdasarkan dokumentasi resmi GitHub REST API, memanggil Git Database endpoints pada repositori tanpa branch/commit awal mengembalikan **`409 Conflict`** dan mengharuskan inisialisasi satu file via Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`) sebelum memakai `git/refs`, `git/trees`, dan `git/commits`. Harus diuji saat **T6.3** dengan repo baru yang benar-benar kosong.

---

## 5. Benchmark Latensi (`N = 5, 30, 80`) & Ukuran Bundle

### 5.1 Perbandingan Ukuran Bundle (`bundle-bench.mjs` via Vite + Rollup)

| Kandidat Klien | Raw Bytes | Raw KB | Gzip (level 9) Bytes | Gzip KB | Selisih vs Thin Fetch |
| --- | ---: | ---: | ---: | ---: | ---: |
| `thin-fetch` ([`fetch-client.ts`](../../spikes/s1-github-git-data/fetch-client.ts) + guard/planner/sha1) | `9.045 B` | `8.83 KB` | `3.195 B` | **`3.12 KB`** | `0` |
| `octokit` (`export { Octokit } from 'octokit'`) | `214.293 B` | `209.27 KB` | `46.621 B` | `45.53 KB` | `+42.41 KB` gzip |
| `octokit-client` ([`octokit-client.ts`](../../spikes/s1-github-git-data/octokit-client.ts)) | `220.947 B` | `215.77 KB` | `48.522 B` | **`47.38 KB`** | `+44.26 KB` gzip |
| `@octokit/core` standalone | `[Belum terbukti]` | — | `[Belum terbukti]` | — | Tidak diekspor top-level oleh pnpm |

### 5.2 Latensi Push & Pull (`[S1:B7]`, Chromium -> `api.github.com`)

Catatan pengukuran: `RateGuard` menyisipkan jeda aman `1.050 ms` **antar permintaan tulis** (`createBlob` / `createTree` / `createCommit` / `updateRef`) dan membatasi **maks 4 GET konkuren** saat pull. Angka `pushBlobHttp` sudah menyertakan jeda `~1.050 ms` per blob, dan angka `pullBlobHttp` mencakup waktu antre di antrean `concurrency=4`.

| Skenario (`N` file JSON) | Mode Tulis | Push Wall Time | Push Blob mean / p95 / max | Finalisasi Tree+Commit+Ref | Pull Wall Time | Pull Metadata (`ref+commit+tree`) | Pull Blob mean / p95 / max | Delta Kuota (`push+pull`) |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- | ---: |
| `N = 5` | `POST /git/blobs` × 5 + finalize | **`15.09 s`** | `1.798 / 1.957 / 1.957 ms` | `5.986 ms` | **`3.45 s`** | `2.062 ms` | `806 / 1.374 / 1.374 ms` | `8` req |
| `N = 30` | `POST /git/blobs` × 30 + finalize | **`65.61 s`** | `1.963 / 2.354 / 2.956 ms` | `6.686 ms` | **`8.43 s`** | `2.155 ms` | `3.145 / 5.496 / 6.265 ms` | `33` req |
| `N = 80` | `POST /git/blobs` × 80 + finalize | **`171.22 s`** | `2.053 / 2.490 / 2.576 ms` | `6.948 ms` | **`18.10 s`** | `2.142 ms` | `8.433 / 15.564 / 15.946 ms` | `83` req |
| `N = 30` *(pembanding)* | **Inline `content` di `POST /git/trees`** + commit + ref | **`5.97 s`** | *(0 `createBlob`)* | `5.975 ms` *(3 writes)* | — | — | — | **`3` writes** |

**Temuan penting performa & secondary rate limit:**
- Memakai `POST /git/blobs` satu per satu untuk `80` file teks kecil memakan ~2,9 menit dan **83 panggilan tulis** (membakar kuota secondary limit content-creation 80/menit & 500/jam).
- Untuk berkas **teks UTF-8** (`node.json`, `canvas.json`), mengirimkan isi langsung lewat field `content` di dalam satu `POST /git/trees` memangkas `N = 30` dari **`65.61 s` (`33` writes)** menjadi **`5.97 s` (`3` writes)** (~11x lebih cepat & 11x lebih hemat kuota tulis), sedangkan **`POST /git/blobs` (`base64`)** hanya dipakai untuk aset biner (PNG/JPEG/WebP).

---

## 6. Perbedaan dari PRD (`docs/spec-storage-sync.md` §6.1 & §6.11)

1. **`FR-SYNC-03` langkah 7 (`422` vs `409`):** Spec menyebut *"Server menolak `422` atau `409`"* pada update ref non-fast-forward. Hasil uji nyata memastikan non-fast-forward mengembalikan **`422`** (`"Update is not a fast forward"`), sedangkan **`409`** merujuk pada kondisi repo kosong / konflik Contents API.
2. **Penghapusan file di `POST /git/trees` (`sha: null`):** Spec §6.11 langkah 5 hanya menyebut `sha: null` untuk file dihapus; fakta terukur membuktikan mengirim `sha: null` pada path yang belum ada di `base_tree` memicu **`422 GitRPC::BadObjectState`** sehingga seluruh commit tree ditolak. Planner wajib memfilter terhadap snapshot tree remote.
3. **`FR-SYNC-03` langkah 4 (`createBlob` vs inline `content` pada `createTree`):** Spec mengasumsikan semua file berubah melewati `POST /git/blobs`. Uji S1 membuktikan teks UTF-8 (`node.json`, `canvas.json`) jauh lebih aman terhadap secondary rate limit bila dikirim inline lewat `createTree` (kecuali file besar/biner base64). `[Rekomendasi]`
4. **Polling `If-None-Match` di browser (`FR-SYNC-08`):** Header `cache-control: private, max-age=60` dari GitHub dapat dilayani dari cache browser jika memakai mode `fetch` default dalam jendela 60 detik; menyertakan `{ cache: 'no-store' }` menjamin `If-None-Match` selalu memvalidasi ke GitHub dan menerima `304` tanpa memakan kuota (`remaining` tidak berkurang).
5. **Pengambilan aset biner (`GET /git/blobs/{sha}`):** Memakai `Accept: application/vnd.github.raw+json` berjalan mulus lewat CORS, menghilangkan overhead ~33% payload base64 serta dekode JS. `[Rekomendasi]`

---

## 7. Dampak ke `Prasyarat M6` (`docs/plan.md`) & Risiko Belum Teruji

| Butir Prasyarat M6 (`docs/plan.md`) | Status Setelah S1 | Catatan / Tindak Lanjut ke M6 |
| --- | --- | --- |
| 1. Setelah push sukses: set `baseBlobSha` & `basePath`, hapus `pendingDeletes`, bersihkan `dirty` bersyarat | `[Fakta terukur]` (mekanisme SHA-1 lokal cocok 100%) | Gunakan SHA-1 lokal (`sha1.ts`) atau hasil tree baru sebagai `baseBlobSha` agar file teks inline `createTree` juga mendapat SHA akurat tanpa extra `createBlob`. |
| 2. Planner push hanya menghapus path yang ada di tree remote | **`[Fakta terukur]` (Wajib)** | Dikonfirmasi langsung di `B3`: `sha: null` untuk path absen ditolak **`422 GitRPC::BadObjectState`**. |
| 3. `normalizeSiblingOrders` di `domain/tree` | `[Rekomendasi]` (di luar scope jaringan S1) | Tidak berubah dari rancangan D1; tetap wajib sebelum M6. |
| 4. Kebijakan takeover tab dengan `hasUnsavedChanges` | `[Keputusan menunggu pemilik]` | Di luar scope S1; tentukan sebelum `T6.6`. |
| 5. Dataset besar lazy `import()` & cek bundle | `[Fakta terukur]` (`bundle-bench.mjs`) | Pilih **thin `fetch`** (`3.12 KB` gzip) vs `octokit` (`47.38 KB` gzip) agar anggaran 600 KB longgar (ADR `0004`). |
| 6. Ukur `hydrate` browser sungguhan di M3 | `[Belum terbukti]` | Tetap dilakukan pada M3. |

### Risiko Belum Teruji (`[Belum terbukti]`) & Keamanan Token Browser

- **Belum teruji di S1:** (1) `409 Conflict` & bootstrap repo benar-benar kosong via Contents API secara runtime; (2) repo milik Organisasi dengan aturan Fine-Grained PAT org / SSO SAML; (3) repositori >100.000 entri atau tree >7 MB (`truncated: true`, fallback navigasi sub-tree non-rekursif); (4) blob >10 MB hingga batas 100 MB dan payload inline `createTree` sangat besar (>5–7 MB); (5) kegagalan jaringan seluler / putus tengah jalan saat rangkaian blob sudah sebagian terunggah (orphan blobs tidak mencemari `main`, cukup aman di-retry idempoten).
- **Catatan keamanan token browser (`FR-ONB-01`, `AGENTS.md` #6, #8):** Karena seluruh proses berjalan di browser tanpa backend, **XSS apa pun pada origin aplikasi dapat membaca token** dari memori/IndexedDB. Oleh karena itu M6/M8 wajib mempertahankan larangan mutlak `dangerouslySetInnerHTML`/`innerHTML`, CSP ketat tanpa inline script, zero logging token di error/console/telemetry, dan merekomendasikan pengguna membuat Fine-Grained PAT **khusus 1 repo knowledge** dengan izin minimal `Contents: Read and write` saja.

