# Knovites — Format Data (§5)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file.*

## 5. Model data dan format file

Spesifikasi ini adalah kontrak. Perubahan format wajib memperbarui file ini, menaikkan `schema`, menambah migrasi, dan menambah fixture.

### 5.1 Struktur repo knowledge

```
knowledge-repo/
├── knovites.json
├── canvas.json               # opsional, halaman home root virtual (__root__), dibuat malas saat pertama kali diedit
├── assets/                   # opsional, aset gambar halaman home root virtual (__root__)
│   └── 7ab1c2d3e4f50987.webp
├── README.md                 # opsional, file akar pengguna (rootExtraFiles), diabaikan aplikasi
└── pwn/
    ├── node.json
    ├── canvas.json
    ├── assets/
    │   └── 3fa9c1d2e4b5a671.webp
    └── ret2win/
        ├── node.json
        ├── canvas.json
        └── assets/
```

- Folder adalah node **jika dan hanya jika** berisi `node.json`. Folder `assets/` bukan node (baik di dalam folder node maupun di akar repo untuk halaman home).
- Root repo adalah **root virtual** dengan ID kanonik internal **`__root__`** (judul dari `knovites.json`), **tanpa `node.json` di akar repo**. Root virtual memiliki halaman home opsional (`canvas.json` dan `assets/` langsung di akar repo, memakai format `canvas.json` `schema: 2` yang sama, dengan migrasi otomatis dari `schema: 1`) yang **dibuat malas (*lazy*)** saat pertama kali diedit. Repo lama yang belum memiliki `canvas.json` di akar otomatis dianggap halaman home kosong. Node tingkat atas adalah child-nya.
- Root virtual `'__root__'` tidak dapat dihapus, dipindah, diubah nama foldernya (`rename`), atau di-reorder lewat operasi pohon.
- Parent dan children **tidak disimpan**: diturunkan dari struktur folder.
- File dan folder yang tidak dikenal aplikasi **tidak boleh diubah atau dihapus**. Pada akar repo, berkas tak dikenal milik pengguna (mis. `README.md`, `.gitignore`, `LICENSE`) dipisahkan sebagai `rootExtraFiles` dan aset gambar halaman home di `assets/` dipisahkan sebagai `rootAssets`, terpisah dari `extraFiles` node anak.
- **Kontrak path file repo (Git Data API):** seluruh path file relatif terhadap akar repo **tanpa leading slash (`'/'`)** — untuk `'__root__'` selalu `'canvas.json'` dan `'assets/<hash16>.<ext>'` (BUKAN `'/canvas.json'` atau `'/assets/...'`); untuk node biasa selalu `'<nodePath>/node.json'`, `'<nodePath>/canvas.json'`, dan `'<nodePath>/assets/<hash16>.<ext>'`.
- Slug folder yang dilarang: `assets`, `.git`, `.github`, `node_modules` (termasuk pada anak langsung root agar tidak bertabrakan dengan folder `assets/` milik `'__root__'`). Folder eksternal di akar repo yang bernama persis `knovites.json` atau `canvas.json` juga diabaikan aman.

### 5.2 knovites.json

```json
{ "schema": 1, "title": "Knovites", "createdAt": "2026-11-16T10:00:00Z" }
```

### 5.3 node.json

```json
{
  "schema": 1,
  "id": "01JC8ZQ4M7X2K9T5VB3N6D8RHW",
  "title": "ret2win",
  "type": "technique",
  "status": "practiced",
  "tags": ["pwn", "stack"],
  "order": "a1",
  "color": null,
  "links": [{ "to": "01JC8ZR1B2C3D4E5F6G7H8J9KM", "label": "mirip dengan" }],
  "createdAt": "2026-11-16T10:00:00Z",
  "updatedAt": "2026-11-16T10:00:00Z"
}
```

- `id`: ULID, **tidak pernah berubah**.
- `title`: 1-200 karakter.
- `type`: `category` | `concept` | `technique` | `challenge` | `lab`. Default `concept`. `lab` dicadangkan untuk fase berikutnya dan tidak muncul di UI Phase 1.
- `status`: `none` | `learning` | `practiced` | `mastered`. Default `none`.
- `tags`: maksimal 20, masing-masing cocok `[a-z0-9_-]{1,32}`.
- `order`: fractional index (string).
- `color`: `null` (mewarisi warna cabang) atau `#rrggbb`.
- `links`: maksimal 100 entri `{ to: ULID, label?: string (maks 80) }`. Disimpan satu arah, backlink dihitung.
- `createdAt`, `updatedAt`: ISO 8601 UTC.

Invariant:

- `id` unik di seluruh repo. Jika ada dua folder dengan ID sama (misalnya folder disalin manual), folder yang path-nya terurut belakangan diberi ULID baru dan kejadian itu dicatat di sync log.
- `links.to` boleh menunjuk node yang sudah tidak ada (**broken link**). Ini bukan error.
- **Slug** dibuat sekali saat node dibuat, dari judul (`slugify`: huruf kecil, ASCII, karakter non-alfanumerik jadi `-`, rapikan tanda hubung berulang, maksimal 48 karakter, kosong jadi `node`). Jika bentrok dengan sibling: tambahkan `-2`, `-3`, dst. Slug **tidak berubah saat judul diganti**. Slug hanya berubah saat node dipindah dan terjadi bentrok di parent baru.
- Urutan sibling: `order` menaik, seri dipecah oleh `id`. Menyisipkan atau memindah node hanya mengubah `node.json` node itu.

### 5.4 canvas.json (`schema: 2`)

```json
{
  "schema": 2,
  "elements": {
    "e_8f2a1c0d": {
      "type": "text",
      "x": 120, "y": 80, "w": 320,
      "z": "a0",
      "textScale": 1.25,
      "style": { "bg": "auto", "border": "auto" },
      "content": { "type": "doc", "content": [
        {
          "type": "paragraph",
          "attrs": { "textAlign": "center" },
          "content": [
            {
              "type": "text",
              "text": "Return to win",
              "marks": [
                { "type": "textStyle", "attrs": { "color": "accent" } },
                { "type": "highlight", "attrs": { "color": "warning" } }
              ]
            }
          ]
        }
      ] },
      "updatedAt": "2026-11-16T10:05:00Z"
    },
    "e_91bc40aa": {
      "type": "image",
      "x": 480, "y": 60, "w": 400, "h": 260,
      "z": "a1",
      "asset": "assets/3fa9c1d2e4b5a671.webp",
      "nw": 1600, "nh": 1040,
      "alt": "stack layout sebelum overflow",
      "updatedAt": "2026-11-16T10:07:00Z"
    }
  }
}
```

- Versioning berlaku **per berkas** (§5.7): `canvas.json` memakai **`schema: 2`** (`CANVAS_SCHEMA_VERSION = 2`), sementara `knovites.json` dan `node.json` tetap **`schema: 1`**. Berkas `canvas.json` `schema: 1` lama dimigrasikan secara murni ke v2 saat dimuat (lihat §5.7).
- `elements` adalah **map** `id → elemen`, bukan array. ID elemen: `e_` + 8 karakter `[a-z0-9]`. Map ini yang memungkinkan merge per elemen.
- Tipe elemen P0: `text` dan `image`. Field umum: `type`, `x`, `y`, `w`, `z` (fractional index), `updatedAt`, dan `rotation` (opsional, default 0, UI belum memakainya).
- `text`:
  - `content` (dokumen ProseMirror JSON dari TipTap yang telah disanitasi).
  - `style`: `{ bg, border }` tanpa properti `frame` terpisah. Pada `schema: 2`, nilai sah `style.bg` dan `style.border` dibatasi ketat ke enum token tema semantik + `"auto"` + `"none"`: `'auto' | 'none' | 'accent' | 'warning' | 'success' | 'danger' | 'violet'` (tanpa hex bebas `#rrggbb` dan tanpa `null`). `'auto'` berarti default tema (`--card` / `--border`); `'none'` berarti transparan tanpa latar & tanpa border.
  - `textScale` (opsional): pengali skala visual non-destruktif berupa angka berhingga pada rentang `[0.5, 3.0]`. Nilai default `1` tidak ditulis oleh serializer kanonik dan dihapus saat normalisasi.
  - Tinggi (`h`) **tidak disimpan**, otomatis mengikuti isi (bila `h` muncul di berkas eksternal, `h` diabaikan dengan catatan isu `ignored_text_height`).
- `image`: `asset` (path relatif `assets/<hash16>.<ext>`), `h`, `nw` dan `nh` (ukuran asli dalam piksel setelah kompresi), `alt` (opsional).
- Semua koordinat dan ukuran (`x`, `y`, `w`, `h`, `rotation`, `nw`, `nh`) dibulatkan ke integer; `textScale` tetap berupa angka desimal berhingga dalam `[0.5, 3.0]`.
- **Whitelist isi `content` (sanitasi TipTap):** Apa pun di luar daftar ini dibuang saat load (`parseCanvasJson`) maupun saat sanitasi editor dan dicatat ke `issues`.
  - **Node:** `doc` (hanya di root), `paragraph` (atribut opsional `textAlign`: `'left' | 'center' | 'right'`; default `'left'` dihilangkan dari JSON; `null` dan `'justify'` ditolak/dibuang), `heading` (atribut wajib `level`: `1 | 2 | 3`, opsional `textAlign`: `'left' | 'center' | 'right'`; default `'left'` dihilangkan), `bulletList`, `orderedList`, `listItem`, `codeBlock` (atribut `language`: `string | null`), `blockquote`, `hardBreak`, `horizontalRule`, `text`. Node lain (termasuk `image` / `<img src="http://...">`, `script`, `iframe`, `doc` bersarang) ditolak dan dibuang.
  - **Mark:**
    - Sederhana (tanpa atribut): `bold`, `italic`, `underline`, `strike`, `code`.
    - `link`: atribut tunggal `href` dengan allowlist ketat protokol `http`, `https`, `mailto`, atau `knovites:<ULID>`. String dengan spasi awal/akhir, karakter kontrol (mis. `"java\nscript:"`), variasi huruf besar/kecil protokol berbahaya (`JaVaScRiPt:`), `data:`, `vbscript:`, atau URL tak valid ditolak dan mark `link` dihapus (teks di dalamnya tetap aman). Atribut ekstra (`target`, `rel`, `class`, `title`, `on*`) di-strip.
    - `textStyle`: atribut `color` dibatasi ketat ke **5 token tema semantik** (`'accent' | 'warning' | 'success' | 'danger' | 'violet'`; hex mentah `#rrggbb` dan nilai tak sah dibuang ke `Auto` / tidak ditulis); `fontFamily` dan `fontSize` (string aman tanpa `url(...)`, `expression(...)`, `javascript:`, atau karakter injeksi CSS `;`/`{`/`}`).
    - `highlight`: atribut `color` dibatasi ketat ke **4 token tema semantik** (`'warning' | 'success' | 'accent' | 'danger'`; hex mentah `#rrggbb` dan nilai tak sah dibuang).
  - **Penolakan atribut & nilai berbahaya:** seluruh atribut event handler (`on*`), nilai gaya inline berbahaya (`background:url(...)`, `url(...)`, `expression(...)`), serta node gambar eksternal (`image` / `<img src="http://...">`) di dalam konten TipTap ditolak dan dibuang.
- Viewport (zoom dan posisi kamera) **tidak** disimpan di repo, hanya lokal per perangkat.

### 5.5 Serialisasi kanonik

Harus deterministik supaya diff Git bersih:

- UTF-8, LF, indentasi 2 spasi, newline di akhir file.
- Semua key objek diurutkan alfabetis secara rekursif (urutan array dipertahankan). Contoh di dokumen ini ditulis dalam urutan logis agar mudah dibaca. File hasil serialisasi memakai urutan alfabetis.
- Normalisasi default `canvas.json` v2: serializer menghilangkan `textAlign: 'left'` / `null` (serta `attrs` kosong pada `paragraph`), dan menghilangkan `textScale: 1` agar diff Git minimal.
- Satu fungsi `serialize*` per tipe file di `domain/serialize`. Tidak ada kode lain yang boleh menulis JSON file repo.
- Properti yang diuji: `serialize(parse(serialize(x))) === serialize(x)`.

### 5.6 Aset gambar

- Disimpan di `assets/` milik node pemakainya. Nama file = 16 hex pertama SHA-256 isi file + ekstensi. Gambar yang sama di node yang sama menjadi satu file.
- Format diterima: PNG, JPEG, WebP, GIF. SVG **ditolak** (risiko XSS). Ukuran input maksimal 25 MB.
- Pipeline kompresi dijelaskan di `spec-canvas.md` §6.6 (FR-IMG-03).
- Aset yang tidak lagi direferensikan dibiarkan di P0. Pembersihan manual adalah P1.

### 5.7 Versioning skema & migrasi

- Setiap file punya `schema` sendiri (versioning per berkas): saat ini `knovites.json` = `1`, `node.json` = `1`, dan `canvas.json` = `2`. Aplikasi mendukung versi saat ini dan satu versi sebelumnya lewat fungsi migrasi murni (`migrate_vN_to_vN+1`) yang punya fixture.
- **Migrasi `canvas.json` v1 → v2 (`migrateCanvasV1ToV2`):** dijalankan otomatis saat `parseCanvasJson` memuat berkas ber-`schema: 1`:
  1. Memvalidasi struktur v1 (menerima `style.bg`/`style.border`: `null | #rrggbb`, dan format mark v1).
  2. Menaikkan `schema` menjadi `2`.
  3. Memetakan `style.bg` dan `style.border` dari `null` maupun `#rrggbb` lama ke `'auto'` secara aman (ketika `#rrggbb` diganti ke `'auto'`, dicatat sebagai `issue` non-fatal).
  4. Membersihkan warna hex `#rrggbb` lama pada mark `textStyle.color` dan `highlight.color` ke `Auto` (atribut `color` dihapus; mark `textStyle`/`highlight` yang menjadi kosong tanpa atribut sah ikut dihapus secara aman), sementara seluruh teks, struktur blok, `link`, koordinat, dan elemen `image` beserta referensi `assets/` dipertahankan utuh.
- File dengan skema **lebih baru** dari yang dikenal aplikasi (`schema > 1` untuk `knovites.json`/`node.json`, `schema > 2` untuk `canvas.json`): node/kanvas ditandai `newer-schema` (read-only) dan tidak pernah ditimpa.
- File yang gagal validasi: node/kanvas ditandai `corrupt` (read-only, tampilkan detail error) dan **tidak pernah ditimpa diam-diam**.

### 5.8 Yang tidak disimpan di repo

Index pencarian, backlink, daftar children, posisi node di peta, viewport, token, dan setting perangkat. Semuanya dihitung ulang atau disimpan lokal.

### 5.9 Skema database lokal (Dexie v3)

- `nodes`: `id` (PK), `path` (indeks), `basePath` (path folder saat sync terakhir atau `null`), `parentId` (indeks), `dirty` (`0 | 1`, indeks), `deletedAt` (`0` bila aktif atau epoch ms saat menunggu jendela Undo 10 detik, indeks), `meta` (isi `node.json` hasil parse atau fallback read-only), `rawNodeJson` (teks mentah file agar node `corrupt` / `newer-schema` tidak pernah ditimpa), `baseBlobSha`, `corrupt`, `corruptErrors` (opsional), `newerSchemaVersion` (opsional), `extraFiles` (daftar file tak dikenal di folder node), `hasCanvas`. **Root virtual `'__root__'` tidak memiliki baris di tabel `nodes`.**
- `canvases`: `nodeId` (PK), `path` (indeks), `basePath` (path folder node saat sync terakhir atau `null`), `dirty` (`0 | 1`, indeks), `deletedAt` (`0` atau epoch ms, indeks), `doc`, `rawJson` (teks mentah bila `corrupt` / `newer-schema`), `baseBlobSha`, `loaded`, `corrupt`, `corruptErrors` (opsional), `newerSchemaVersion` (opsional). Mendukung halaman home root virtual dengan `nodeId = '__root__'`, `path = ''`, dan `basePath = '' | null` (tanpa baris di `nodes`; path file repo selalu `'canvas.json'` tanpa leading slash; dibuat malas saat pertama kali diedit).
- `assets`: `[nodeId+path]` (PK), `nodeId`, `path` (relatif terhadap folder pemilik, mis. `assets/<hash16>.<ext>`), `basePath` (path lengkap relatif repo saat sync terakhir atau `null`), `dirty` (`0 | 1`, indeks), `deletedAt` (`0` atau epoch ms, indeks), `blob`, `sha`. Mendukung aset halaman home root virtual dengan `nodeId = '__root__'`, `path = 'assets/<hash16>.<ext>'`, dan `basePath = 'assets/<hash16>.<ext>' | null` (tanpa baris di `nodes`; path file repo tanpa leading slash).
- `pendingDeletes`: `path` (PK, selalu relatif repo tanpa leading slash), `baseBlobSha`, `deletedAt` — path file yang harus dihapus pada commit berikutnya.
- `syncState`: `id` (`'singleton'`, PK), `repo`, `branch`, `baseCommitSha`, `lastSyncedAt`, `pendingMerge`.
- `settings`: `key` (PK), `value`, `updatedAt` — termasuk metadata lokal ringan seperti daftar `rootExtraFiles` (`key = 'workspace.rootExtraFiles'`) agar file akar pengguna tetap terlindungi lintas reload.
- `errorLog`: `++id` (PK), `timestamp`, `level`, `code`, `message`, `context` — dipangkas otomatis maksimal 100 entri terbaru.

Migrasi Dexie `v2 -> v3` bersifat non-destruktif: seluruh tabel, indeks, dan data M2 yang sudah ada dipertahankan utuh, sambil menormalkan kontrak record `nodeId = '__root__'` agar bebas leading slash.

Isi versi dasar (base) untuk three-way merge tidak disimpan lokal. Ia diambil ulang dari GitHub lewat `baseBlobSha` saat merge dibutuhkan (blob Git tidak pernah berubah).
