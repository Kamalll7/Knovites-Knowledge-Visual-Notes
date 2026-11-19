# Knovites — Format Data (§5)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file.*

## 5. Model data dan format file

Spesifikasi ini adalah kontrak. Perubahan format wajib memperbarui file ini, menaikkan `schema`, menambah migrasi, dan menambah fixture.

### 5.1 Struktur repo knowledge

```
knowledge-repo/
├── knovites.json
├── README.md                 # opsional, diabaikan aplikasi
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

- Folder adalah node **jika dan hanya jika** berisi `node.json`. Folder `assets/` bukan node.
- Root repo adalah **root virtual** (judul dari `knovites.json`), tanpa halaman atau kanvas. Node tingkat atas adalah child-nya.
- Parent dan children **tidak disimpan**: diturunkan dari struktur folder.
- File dan folder yang tidak dikenal aplikasi **tidak boleh diubah atau dihapus**.
- Slug folder yang dilarang: `assets`, `.git`, `.github`, `node_modules`.

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

### 5.4 canvas.json

```json
{
  "schema": 1,
  "elements": {
    "e_8f2a1c0d": {
      "type": "text",
      "x": 120, "y": 80, "w": 320,
      "z": "a0",
      "style": { "bg": null, "border": null },
      "content": { "type": "doc", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Return to win" }] }
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

- `elements` adalah **map** `id → elemen`, bukan array. ID elemen: `e_` + 8 karakter `[a-z0-9]`. Map ini yang memungkinkan merge per elemen.
- Tipe elemen P0: `text` dan `image`. Field umum: `type`, `x`, `y`, `w`, `z` (fractional index), `updatedAt`, dan `rotation` (opsional, default 0, UI belum memakainya).
- `text`: `content` (dokumen ProseMirror JSON dari TipTap) dan `style` (`bg`, `border`: `null` atau `#rrggbb`). Tinggi **tidak disimpan**, otomatis mengikuti isi.
- `image`: `asset` (path relatif `assets/<hash16>.<ext>`), `h`, `nw` dan `nh` (ukuran asli dalam piksel setelah kompresi), `alt` (opsional).
- Semua koordinat dan ukuran dibulatkan ke integer.
- Whitelist isi `content`. Apa pun di luar ini dibuang saat load dan dicatat ke log. Node: `doc`, `paragraph`, `heading` (level 1-3), `bulletList`, `orderedList`, `listItem`, `codeBlock` (atribut `language`), `blockquote`, `hardBreak`, `horizontalRule`, `text`. Mark: `bold`, `italic`, `underline`, `strike`, `code`, `link`, `textStyle` (`color`, `fontFamily`, `fontSize`), `highlight` (`color`). Href link hanya boleh `http`, `https`, `mailto`, atau `knovites:<nodeId>`.
- Viewport (zoom dan posisi kamera) **tidak** disimpan di repo, hanya lokal per perangkat.

### 5.5 Serialisasi kanonik

Harus deterministik supaya diff Git bersih:

- UTF-8, LF, indentasi 2 spasi, newline di akhir file.
- Semua key objek diurutkan alfabetis secara rekursif (urutan array dipertahankan). Contoh di dokumen ini ditulis dalam urutan logis agar mudah dibaca. File hasil serialisasi memakai urutan alfabetis.
- Satu fungsi `serialize*` per tipe file di `domain/serialize`. Tidak ada kode lain yang boleh menulis JSON file repo.
- Properti yang diuji: `serialize(parse(serialize(x))) === serialize(x)`.

### 5.6 Aset gambar

- Disimpan di `assets/` milik node pemakainya. Nama file = 16 hex pertama SHA-256 isi file + ekstensi. Gambar yang sama di node yang sama menjadi satu file.
- Format diterima: PNG, JPEG, WebP, GIF. SVG **ditolak** (risiko XSS). Ukuran input maksimal 25 MB.
- Pipeline kompresi dijelaskan di `spec-canvas.md` §6.6 (FR-IMG-03).
- Aset yang tidak lagi direferensikan dibiarkan di P0. Pembersihan manual adalah P1.

### 5.7 Versioning skema

- Setiap file punya `schema`. Aplikasi mendukung versi saat ini dan satu versi sebelumnya lewat fungsi migrasi murni (`migrate_vN_to_vN+1`) yang punya fixture.
- File dengan skema **lebih baru** dari yang dikenal aplikasi: node ditandai read-only dan tidak pernah ditimpa.
- File yang gagal validasi: node ditandai `corrupt` (read-only, tampilkan detail error) dan **tidak pernah ditimpa diam-diam**.

### 5.8 Yang tidak disimpan di repo

Index pencarian, backlink, daftar children, posisi node di peta, viewport, token, dan setting perangkat. Semuanya dihitung ulang atau disimpan lokal.

### 5.9 Skema database lokal (Dexie)

- `nodes`: `id` (PK), `path` (indeks unik), `parentId` (indeks), `meta` (isi `node.json` hasil parse atau fallback read-only), `rawNodeJson` (teks mentah file agar node `corrupt` / `newer-schema` tidak pernah ditimpa), `baseBlobSha`, `dirty`, `corrupt`, `corruptErrors` (opsional), `newerSchemaVersion` (opsional), `extraFiles` (daftar file tak dikenal di folder node), `hasCanvas`, `deletedAt` (null bila aktif, ISO UTC saat menunggu jendela Undo 10 detik).
- `canvases`: `nodeId` (PK), `path` (indeks unik), `doc`, `rawJson` (teks mentah bila `corrupt` / `newer-schema`), `baseBlobSha`, `dirty`, `loaded`, `corrupt`, `corruptErrors` (opsional), `newerSchemaVersion` (opsional), `deletedAt`.
- `assets`: `[nodeId+path]` (PK), `nodeId`, `path` (relatif terhadap folder node, mis. `assets/<hash16>.<ext>`), `blob`, `sha`, `dirty`, `deletedAt`.
- `pendingDeletes`: `path` (PK), `baseBlobSha`, `deletedAt` — path file yang harus dihapus pada commit berikutnya.
- `syncState`: `id` (`'singleton'`, PK), `repo`, `branch`, `baseCommitSha`, `lastSyncedAt`, `pendingMerge`.
- `settings`: `key` (PK), `value`, `updatedAt`.
- `errorLog`: `++id` (PK), `timestamp`, `level`, `code`, `message`, `context` — dipangkas otomatis maksimal 100 entri terbaru.

Isi versi dasar (base) untuk three-way merge tidak disimpan lokal. Ia diambil ulang dari GitHub lewat `baseBlobSha` saat merge dibutuhkan (blob Git tidak pernah berubah).
