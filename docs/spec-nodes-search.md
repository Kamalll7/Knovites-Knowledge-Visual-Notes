# Knovites — Spesifikasi Manajemen Node, Link, Pencarian (§6.7-§6.9)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file. Format: **ID (prioritas)** deskripsi.*

### 6.7 Manajemen node (FR-NODE)

Setiap operasi adalah fungsi domain murni yang mengembalikan state baru plus changeset, dengan tes unit. Tidak ada operasi yang boleh menghasilkan siklus pohon atau slug ganda di bawah satu parent.

- **FR-NODE-01 (P0) Create.** Add child (dari peta atau halaman) atau Add top-level node. Input: judul (wajib), tipe (default `concept`). Membuat folder (slug sesuai `data-format.md` §5.3), `node.json` berisi default, `canvas.json` kosong (`elements` kosong), dan `order` setelah sibling terakhir. Node baru langsung difokuskan di peta.
- **FR-NODE-02 (P0) Rename.** Hanya mengubah `title` dan `updatedAt`.
- **FR-NODE-03 (P0) Move to.** Picker pohon dengan pencarian. Tidak boleh memilih dirinya sendiri atau turunannya. Tampilkan pratinjau jumlah node yang ikut pindah. Seluruh subtree pindah, ID tidak berubah, slug dicek bentrok di parent baru, `order` = paling akhir. Di Git: path lama dihapus dan path baru merujuk ke blob SHA yang sama, jadi tidak ada upload ulang.
- **FR-NODE-04 (P0) Reorder.** Move earlier atau Move later: hitung `order` baru dengan fractional index di antara sibling terdekat. Hanya `node.json` node yang dipindah yang berubah.
- **FR-NODE-05 (P0) Delete.** Dialog konfirmasi yang menyebut jumlah turunan. Subtree dihapus lokal dengan toast **Undo** selama 10 detik. File dihapus pada commit berikutnya (riwayat Git tetap menyimpannya). Link yang menunjuk ke node itu menjadi broken.
- **FR-NODE-06 (P0)** Ubah tipe, status, warna (null atau palet), dan tag.
- **FR-NODE-07 (P1) Duplicate** subtree (ID baru, aset disalin).

### 6.8 Link silang dan backlink (FR-LNK)

- **FR-LNK-01 (P0)** Tambah dan hapus link silang dari tab Links (picker dengan pencarian, label opsional). Disimpan di `node.json` node sumber.
- **FR-LNK-02 (P0)** Backlink dihitung dari index dan ditampilkan di tab Links.
- **FR-LNK-03 (P0)** Link ke node yang sudah dihapus ditampilkan sebagai broken (abu-abu, bisa dihapus), bukan error.
- **FR-LNK-04 (P1) Mention inline.** Mengetik `[[` memunculkan picker node dan menyisipkan mark link `knovites:<id>`. Klik membuka node, teks menampilkan judul terkini, dan dihitung sebagai backlink.

### 6.9 Pencarian dan command palette (FR-SRC)

- **FR-SRC-01 (P0)** `Ctrl/Cmd+K` membuka palette. Mencari node berdasarkan judul, tag, tipe, dan isi teks (diratakan dari canvas). MiniSearch dengan fuzzy dan prefix. Boost: judul 5, tag 3, isi 1. Hasil menampilkan judul, breadcrumb path, chip tipe, dan cuplikan kecocokan. Maksimal 20 hasil, respons di bawah 50 ms untuk 2.000 node.
- **FR-SRC-02 (P0)** Perintah: New node, Go to map, Toggle layout, Sync now, Open settings, Toggle theme, Export zip.
- **FR-SRC-03 (P0)** Index dibangun di Web Worker atau saat idle, diperbarui inkremental saat node tersimpan, dibangun ulang setelah pull, dan **tidak disimpan di repo**. Canvas yang baru diunduh dari GitHub diindeks bertahap.
- **FR-SRC-04 (P0)** `Enter` di peta = fokuskan node itu dengan transisi (jalur root ke node menyala). `Enter` di halaman node = buka node itu. `Alt+Enter` melakukan kebalikannya.
- **FR-SRC-05 (P1)** Filter: `type:technique status:mastered tag:rop`.
