# 0001 — Memakai `fake-indexeddb` sebagai implementasi IndexedDB untuk tes unit

- **Tanggal:** 2026-11-19
- **Status:** diterima
- **Task terkait:** T2.1 / FR-LOC-01, FR-LOC-03

## Konteks

Task T2.1 mengimplementasikan layer `src/storage/` memakai Dexie untuk menyimpan pohon node, kanvas, aset, `pendingDeletes`, `syncState`, `settings`, dan `errorLog` di IndexedDB. Aturan M2 mensyaratkan pengujian atomisitas transaksi Dexie (termasuk rollback kegagalan di tengah transaksi) serta harness migrasi skema berjalan cepat dan deterministik pada `vitest` (lingkungan Node/jsdom tanpa browser nyata).

## Opsi yang dipertimbangkan

1. **`fake-indexeddb` (devDependency)** — implementasi penuh spesifikasi IndexedDB W3C di memori dengan dukungan transaksi atomik, abort/rollback, indeks unik, dan upgrade versi skema.
2. **Mock tipis atas method Dexie** — cepat ditulis, tetapi tidak mengeksekusi transaksi IndexedDB maupun skrip `.upgrade()` Dexie secara nyata sehingga bug transaksi non-atomik atau indeks unik bisa lolos.
3. **Menjalankan seluruh tes storage di Playwright Chromium saja** — akurat di browser, namun jauh lebih lambat untuk TDD ketat serta menyulitkan injeksi kegagalan di tengah transaksi.

## Keputusan

Menambahkan **`fake-indexeddb@6.2.8`** sebagai `devDependency`:

- **Nama & versi:** `fake-indexeddb@6.2.8`
- **Lisensi:** Apache-2.0
- **Dampak bundle produksi:** 0 byte (hanya `devDependency`, diimpor hanya dalam file tes)
- **Alasan:** Mendukung penuh skema berversi Dexie, transaksi `rw` beserta rollback saat error dilempar di tengah transaksi, indeks komposit `[nodeId+path]`, serta isolasi instance DB per tes melalui konstruktor `DexieOptions` (`{ indexedDB, IDBKeyRange }`).

## Dampak

- `package.json` dan `pnpm-lock.yaml` menambah `fake-indexeddb` di `devDependencies`.
- `src/storage/storage.test.ts` memakai instance `IDBFactory` dari `fake-indexeddb` untuk menguji atomisitas, rollback, batas `errorLog`, node `corrupt`, dan migrasi skema.
- Tidak ada keputusan **[LOCKED]** di PRD yang berubah (`prd.md` §3 tetap memakai Dexie untuk IndexedDB).

