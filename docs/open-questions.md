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

### 2026-11-18 — Detail aturan skema & sanitizer TipTap (`T1.1`)
- Task: T1.1 / `data-format.md` §5.3–§5.4
- Masalah atau ambiguitas:
  1. Ketika mark `highlight` atau `textStyle` memiliki atribut tidak valid (mis. `color: "red"` atau atribut ekstra), apakah mark-nya dipertahankan tanpa atribut tersebut atau ikut dibuang?
  2. Apakah node `doc` boleh bersarang di dalam `doc.content`, dan apakah elemen `text` dengan properti `h` harus ditolak?
  3. Bagaimana batas string `order` / `z` (fractional index) divalidasi pada tahap skema?
- Opsi yang dipertimbangkan: Menolak seluruh elemen atau mempertahankan mark yang whitelisted sambil membuang atribut tak validnya.
- Keputusan sementara (opsi paling sederhana):
  1. Atribut tidak valid pada `bold`/`italic`/`underline`/`strike`/`code`/`textStyle`/`highlight` dibuang & dicatat sebagai `issue` sementara mark whitelisted-nya tetap dipertahankan (khusus `link`, mark dibuang jika `href` hilang/tidak valid karena `href` wajib).
  2. Node `doc` hanya boleh di root (`doc.content` tidak boleh berisi `doc` bersarang); elemen `text` yang menyertakan `h` dipulihkan dengan membuang `h` dan mencatat `issue` (`ignored_text_height`, konsisten dengan prinsip §5.4/pemulihan non-fatal), sedangkan key tak dikenal lain pada elemen tetap membuat file `corrupt`.
  3. `order`/`z` divalidasi sebagai string non-kosong tanpa spasi (`/^\S+$/`), validasi urutan fractional-indexing lebih lanjut ditangani di `domain/tree` (T1.3).
- Perlu keputusan pemilik: tidak

### 2026-11-18 — Detail `buildTree`, `changeset`, dan fallback `order` (`T1.3`)
- Task: T1.3 / `data-format.md` §5.1 & §5.3, `spec-nodes-search.md` §6.7 (FR-NODE-01..05)
- Masalah atau ambiguitas:
  1. Bagaimana `buildTree` menangani folder tanpa parent `node.json` (orphan), folder berslug terlarang, serta ID untuk node `corrupt` yang mungkin tidak punya ULID valid?
  2. Bagaimana `moveNode` memodelkan `node.json` milik akar subtree yang dipindah (karena `order` dan `updatedAt` berubah) bersama file lain yang isinya tetap?
  3. Bagaimana `reorderNode` menangani dua sibling yang `order`-nya seri (`prevOrder === nextOrder`) atau mengandung key tak valid untuk `fractional-indexing`?
- Opsi yang dipertimbangkan:
  1. Membuang/mengabaikan orphan & node terlarang dengan `TreeIssue` tanpa menyentuh file, atau membuat node virtual.
  2. Memasukkan `node.json` akar subtree ke `deletes` + `upserts`, atau memodelkan seluruh file subtree di `moves` (`{from, to}`) + `upserts` untuk `${newPath}/node.json` yang berubah.
- Keputusan sementara (opsi paling sederhana):
  1. Folder berslug terlarang atau tanpa parent `node.json` diabaikan dengan `TreeIssue` (menjaga konsistensi `path === parent.path + '/' + slug` tanpa mengubah folder tak dikenal). Node `corrupt` / `newer-schema` mendapat ID read-only deterministik `__corrupt__:<path>`, tetap mengklaim `slug` foldernya agar tidak tertimpa sibling baru, dan diblokir dari semua operasi tulis (termasuk operasi `moveNode` dan `deleteNode` pada induknya).
  2. `moveNode` mencatat seluruh file subtree (termasuk aset yatim di `assets/` maupun file tak dikenal via `extraFiles`) di `changeset.moves` (`{ from, to }`), `deletes: []`, dan hanya `${newPath}/node.json` di `changeset.upserts` (semantik urutan applier: `deletes` -> `moves` -> `upserts`, sehingga isi `upserts` menang atas hasil `moves`). Karena `domain/` murni tanpa IO repositori atau filesystem, daftar file per node (`assets` dan `extraFiles`) dipasok oleh pemanggil (`storage/` atau `sync/` saat memindai pohon file) melalui `TreeBuildEntry` ke `buildTree`.
  3. `generateOrderBetween` membungkus `fractional-indexing` dalam `try/catch`, memvalidasi batas ketat `a < key < b`, dan memakai fallback leksikografis deterministik bila key input tidak valid. Jika target posisi di `reorderNode` diapit dua sibling ber-`order` identik (`prevOrder >= nextOrder`, mis. akibat node `corrupt` ber-order fallback `'a0'`), `reorderNode` menolak dengan `reason: 'order_collision'` alih-alih memberi `order` yang sama atau mengubah `node.json` tetangga.
- Perlu keputusan pemilik: tidak

### Perbedaan PRD dan dokumentasi resmi

Catat di sini setiap kali dokumentasi resmi berbeda dari PRD (nama API, parameter, batas, perilaku). Format: apa kata PRD, apa kata dokumentasi (dengan tautan dan versi), dan apa yang dilakukan.

- **2026-11-19 (T2.1) — `dexie@4.4.7` & `fake-indexeddb@6.2.8` indeks IndexedDB dan skema §5.9:** Di `data-format.md` §5.9, `nodes` awalnya hanya mencantumkan `id, path, parentId, meta, baseBlobSha, dirty, corrupt`. Spesifikasi W3C IndexedDB (serta `fake-indexeddb@6.2.8`) tidak mengizinkan tipe `boolean` atau `null` sebagai key indeks, sehingga kolom `dirty`, `corrupt`, dan `deletedAt` (nullable) di `nodes`/`canvases`/`assets` tidak dijadikan indeks Dexie (difilter aman di layer repository). Selain itu, §5.9 diperbarui untuk menyimpan `extraFiles`, `hasCanvas`, `rawNodeJson`/`rawJson`, `corruptErrors`, `newerSchemaVersion`, dan `deletedAt` agar file tak dikenal/corrupt tidak pernah ditimpa dan soft-delete Undo 10 detik tahan reload/crash. **Tindakan:** Memperbarui `docs/data-format.md` §5.9 dan mencatat ADR [0001-fake-indexeddb.md](file:///home/k/project/Knovites/docs/decisions/0001-fake-indexeddb.md).
- **2026-11-19 (T2.2) — `zustand@5.1.0`, `immer@11.2.10`, & `ulid@3.0.2`:** Di Zustand v5 + TypeScript strict, middleware `immer` mensyaratkan bentuk curried `createStore<T>()(immer(...))`, `castDraft(...)` dari `immer@11` dipakai untuk mengassign `TreeState`, dan hook React memakai `useStore(store, selector)` dari `zustand`. Pada `ulid@3.0.2`, `monotonicFactory()` menjamin ULID terurut monoton walau dipanggil berkali-kali dalam milidetik yang sama. **Tindakan:** Mengenkapsulasi clock & `monotonicFactory` di `src/app/clock-id.ts` dan store di `src/app/store.ts`.
- **2026-11-19 (T2.3) — Web Locks (`{ steal: true }`) & notifikasi `BroadcastChannel` (`spec-storage-sync.md` §6.10 FR-LOC-05):** Spesifikasi W3C Web Locks `navigator.locks.request(name, { steal: true })` memutus lock lama di `LockManager`, namun tidak otomatis memicu event atau error pada callback Promise pemegang lock lama yang masih menunggu (atau di beberapa implementasi dapat me-reject promise `locks.request(...)` pemegang lama dengan `AbortError`). Selain itu, pada browser/lingkungan yang tidak menyediakan `navigator.locks`, aplikasi berjalan dalam mode sesi tunggal (`writer`) tanpa proteksi multi-tab dan menampilkan penanda status di UI (`locks-unsupported-banner`). **Tindakan:** Menggabungkan Web Locks (`ifAvailable: true` / `{ steal: true }`) dengan `BroadcastChannel`, menangkap penolakan `AbortError` saat lock di-steal agar bebas unhandled rejection serta langsung menurunkan tab lama ke `readonly`, dan menandai mode tanpa lock (`!isLockSupported`) di UI.
- **2026-11-19 (T2.2 / M2 Review) — Kebijakan kegagalan tulis IndexedDB (`storageError`), bentrok path Undo, induk dipindah/dihapus saat Undo, dan `getEffectiveDeletes`:**
  1. Saat penulisan ke IndexedDB gagal, perubahan yang memicu kegagalan tetap dipertahankan di memori (`hasUnsavedChanges: true`, `storageError` aktif) dan seluruh mutasi berikutnya diblokir (`reason: 'storage_error'`) hingga pengguna menekan tombol Retry dan penyimpanan berhasil — sehingga `Changeset` baru tidak pernah dihitung dari state memori yang menyimpang dari IndexedDB.
  2. Selama jendela Undo 10 detik, mutasi non-hapus (seperti membuat node baru) diizinkan tanpa mematikan jendela Undo. Bila node baru dibuat pada `path` yang sama lalu pengguna menekan Undo, `restoreSoftDeletedSubtree` memberi slug unik baru (`resolveUniqueSlug`, mis. `pwn-2`) dan memperbarui path subtree yang dipulihkan (`dirty: 1`) agar tidak pernah ada dua node aktif di satu `path` dan tidak ada data yang hilang.
  3. Bila induk node yang di-soft-delete dihapus atau dipindahkan selama jendela Undo 10 detik lalu pengguna menekan Undo, `restoreSoftDeletedSubtree` memulihkan node beserta keturunannya ke **root (`parentId: null`)** dengan slug root yang unik (`resolveUniqueSlug`), sehingga seluruh catatan/kanvas/aset tetap selamat tanpa melanggar struktur pohon.
  4. `finalizeSoftDeletes` mencatat **semua** path lama subtree (termasuk bila node baru menempati path yang sama sebelum jendela 10 detik berakhir) ke `pendingDeletes`; `getEffectiveDeletes` di layer `storage/` menghitung `pendingDeletes` dikurangi path aktif pada state akhir untuk dipakai saat sync nanti.

- **2026-11-18 (T1.3) — `fractional-indexing@4.0.0`:** PRD §3 menyebut `fractional-indexing`. Pada `4.0.0`, `generateKeyBetween(a, b)` diam-diam menukar `a` dan `b` jika `a > b` (alih-alih melempar error), dan melempar error jika key memiliki trailing `'0'` pada pecahan (`"a00"`), head di luar `A-Za-z`, atau `a === b`. **Tindakan:** `src/domain/tree/order.ts` memvalidasi batas ketat setelah memanggil `generateKeyBetween` dan menyediakan fallback leksikografis aman tanpa pernah melempar.

- **2026-11-18 (T1.1) — `zod@4.6.7` (Zod v4 API):** PRD §3 menyebut `Zod`. Pada Zod v4 (`4.6.7`), `z.iso.datetime()` menggantikan `z.string().datetime()` (dan otomatis mensyaratkan UTC `Z`), `z.strictObject()` menggantikan `.strict()`, `z.record(key, value)` mewajibkan 2 argumen, dan `ZodError` memakai `.issues` (bukan `.errors`). **Tindakan:** Memakai API Zod v4 sesuai paket terpasang.
- **2026-11-18 (T1.2) — `fast-check@4.10.2` (v4 null-prototype & `fc.string`) & Prettier vs fixture JSON kanonik:** Pada `fast-check` v4, `fc.record()` mengembalikan objek ber-prototipe `null` (`Object.create(null)`) dan `fc.string({ unit })` dipakai untuk generator karakter. Selain itu, Prettier merapatkan array pendek ke satu baris (`["pwn", "stack"]`), berbeda dari format kanonik `JSON.stringify(obj, null, 2)` (§5.5). **Tindakan:** `isPlainObject` dan `canonicalize` menangani objek ber-prototipe `null`, dan `src/testing/fixtures` ditambahkan ke `.prettierignore` agar fixture tetap identik byte demi byte dengan serializer kanonik.

- **2026-11-18 (T0.4) — `react-router@8.5.1` & `@fontsource-variable/inter@5.3.0`:** Pada React Router v7/v8, komponen router DOM (`HashRouter`, `Routes`, `Route`, `NavLink`, `Link`, `useParams`, `useLocation`) diekspor langsung dari paket `react-router` tanpa memerlukan `react-router-dom`. Untuk font UI `Inter` (`spec-ui-nfr.md` §8.1), dipakai `@fontsource-variable/inter` (self-hosted, menggantikan `@fontsource-variable/geist` bawaan inisialisasi `shadcn`).
- **2026-11-18 (T0.3) — Advisory `GHSA-fc5q-39xc-vjpf` (`picomatch <=4.0.7`, tanpa versi patched):** `pnpm audit` melaporkan 1 advisory `high` pada `picomatch@4.0.7` (dependensi transitif dev-only di `vite`, `vitest`, `typescript-eslint`, `eslint-plugin-boundaries`) dengan `Patched versions: None` (4.0.7 adalah versi terbaru). `pnpm audit --prod` bersih (0 kerentanan). **Tindakan:** CI menjalankan `pnpm audit --prod` (tanpa pengecualian) dan `pnpm audit --ignore GHSA-fc5q-39xc-vjpf` sampai `picomatch` merilis versi perbaikan.

- **2026-11-17 (T0.1) — Versi TypeScript vs `typescript-eslint`:** PRD §3 menyebut memakai versi stabil terbaru saat inisialisasi. Versi terbaru `typescript` di npm adalah `7.0.2`, namun `typescript-eslint@8.73.0` mensyaratkan `typescript: ">=4.8.4 <6.1.0"`, dan template resmi `create-vite@9.3.4` (`react-ts`) menggunakan `typescript: "~6.0.3"`. **Tindakan:** Mengunci `typescript: "~6.0.3"` agar selaras dengan template Vite dan `typescript-eslint`.
- **2026-11-17 (T0.1) — Tailwind CSS v4 & shadcn/ui (`radix`):** PRD §3 menyebut Tailwind CSS + shadcn/ui (Radix). Dokumentasi resmi Tailwind v4 (`@tailwindcss/vite@4.3.5`) memakai CSS-first config (`@import 'tailwindcss'` dan `@theme inline` di `src/index.css`) tanpa `tailwind.config.js`, dan `shadcn@4.23.0` (`init -t vite -b radix`) memasang paket terpadu `radix-ui@1.8.1`, `tw-animate-css@1.4.0`, `cn@0.5.2`, serta `@fontsource-variable/geist@5.3.0` (nanti di T0.4 akan disetel ke `@fontsource/inter` sesuai `spec-ui-nfr.md` §8.1). Komponen shadcn ditempatkan di `src/ui/` lewat alias di `components.json` agar sesuai struktur `prd.md` §4.1.
- **2026-11-17 (T0.1) — `eslint-plugin-boundaries@7.4.4`:** Pada v7, rule `boundaries/element-types` dan opsi `mode` di `boundaries/elements` telah digantikan oleh `boundaries/dependencies` (berbasis `policies`), `partialMatch: false`, dan `boundaries/files` (untuk file individual seperti `src/main.tsx` dan file tes). **Tindakan:** Menggunakan API v7 sesuai README resmi paket terpasang.
