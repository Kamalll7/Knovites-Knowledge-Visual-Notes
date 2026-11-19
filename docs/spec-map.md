# Knovites — Spesifikasi Peta Pohon (§6.2)

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Penomoran § sama di semua file. Format: **ID (prioritas)** deskripsi.*

### 6.2 Peta pohon (FR-MAP)

Ini fitur yang membuat produk terasa istimewa. Semua logika posisi ada di `domain/layout` sebagai fungsi murni.

- **FR-MAP-01 (P0) Layar penuh.** Rute `#/` menampilkan peta SVG layar penuh. Root virtual (judul dari `knovites.json`) berada di pusat.
- **FR-MAP-02 (P0) Himpunan node terlihat.** Fungsi murni `computeVisible(tree, focusId, pinned, zoomTier)` dengan aturan:
  1. Root, semua ancestor fokus, dan fokus selalu terlihat.
  2. Semua child fokus terlihat, maksimal `MAX_CHILDREN_SHOWN = 24` pertama menurut `order`. Sisanya digabung jadi satu bubble `+N` yang bila diklik memperluas semuanya.
  3. Sibling fokus dan sibling tiap ancestor terlihat dalam keadaan tertutup (collapsed), dengan batas yang sama.
  4. Cucu fokus tampil sebagai node kecil hanya pada zoom tier 2 ke atas. Pada tier lebih rendah, jumlah cucu hanya menjadi badge di child.
  5. Node di himpunan `pinned` (diperluas manual lewat chevron) menampilkan child-nya dengan aturan nomor 2.
  6. Node lain tertutup. Node tertutup yang punya turunan menampilkan badge `Judul · N` (N = total turunan).
  - Properti uji: fokus dan jalur root ke fokus selalu terlihat; untuk tiap node terlihat, `hiddenCount` + jumlah turunan terlihat = ukuran subtree-nya; fungsi deterministik.
- **FR-MAP-03 (P0) Layout radial.** Dihitung atas himpunan terlihat. Root di pusat, node kedalaman d berada pada cincin radius `r(d)`. Tiap node mendapat **irisan sudut proporsional bobotnya** (bobot default: `1 + 0.5 * log2(1 + turunanTersembunyi + turunanTerlihat)`), supaya cabang gemuk mendapat ruang lebih dan cabang kecil tidak tampak kosong. Anak mengisi irisan induknya, berurut searah jarum jam menurut `order`. Radius dan jarak antar-cincin adaptif agar jarak minimum antar-kotak node (`MIN_GAP = 12px`) terpenuhi. Invarian yang diuji (termasuk dengan fast-check pada pohon acak): **tidak ada tumpang tindih**, hasil **deterministik**, urutan sibling terjaga, setiap anak berada dalam irisan induknya.
- **FR-MAP-04 (P0) Layout horizontal.** Mode kedua: mind-map kiri ke kanan dengan aturan visibilitas yang sama (`d3.tree`, spasi vertikal proporsional jumlah turunan terlihat). Toggle di toolbar, pilihan disimpan per perangkat. Mode force-directed adalah P2.
- **FR-MAP-05 (P0) Transisi fokus.** Klik node, node menjadi fokus, layout dihitung ulang, lalu posisi diinterpolasi berdasarkan **id node** selama 450-600 ms dengan easing keluar yang halus. Node baru muncul dari posisi induknya, node yang hilang menyusut ke induknya. Kamera ikut bergeser dan zoom agar fokus beserta child-nya pas di layar dengan padding. Transisi **dapat disela**: klik baru saat animasi berjalan mengarahkan ulang dari posisi saat itu tanpa loncat. Dengan `prefers-reduced-motion`, perpindahan instan.
- **FR-MAP-06 (P0) Interaksi dasar.** Klik = fokus. Klik dua kali, `Enter`, atau tombol Open di toolbar node = buka halaman node (`#/n/<id>`). Drag latar = pan. Roda mouse atau pinch = zoom (batas skala 0.2 sampai 3). Tombol: zoom in, zoom out, fit, recenter ke fokus.
- **FR-MAP-07 (P0) Navigasi keyboard.** Panah kiri/kanan = sibling sebelumnya/berikutnya, panah bawah = child pertama, panah atas = parent, `Enter` = buka halaman, `Esc` = fokus ke parent, `/` atau `Ctrl/Cmd+K` = cari. Ring fokus keyboard harus jelas terlihat.
- **FR-MAP-08 (P0) Semantic zoom.** Tier ditentukan skala efektif k: tier 0 (k kurang dari 0.5) hanya lingkaran dan label node kedalaman 1 ke atas; tier 1 (0.5 sampai kurang dari 1.2) judul dan ikon tipe; tier 2 (1.2 ke atas) ditambah chip status, tag, dan cucu fokus. Kutipan isi (80 karakter pertama teks) di tier 2 adalah P1.
- **FR-MAP-09 (P0) Bahasa visual.**
  - Warna cabang: tiap node tingkat atas mendapat hue dari palet terkurasi 8-12 warna (dipilih dari hash id, dengan penghindaran tabrakan antar-sibling). Turunannya makin terang menurut kedalaman. `node.color` menimpa.
  - Ukuran node sebanding log(ukuran subtree), di antara ukuran minimum dan maksimum.
  - Status: `learning` amber, `practiced` biru, `mastered` hijau, ditampilkan sebagai glow **dan** ikon kecil (jangan hanya warna).
  - Edge berupa kurva bezier (`d3.linkRadial` atau `linkHorizontal`). Jalur root ke fokus menyala, edge lain diredupkan.
  - Hover: node membesar sedikit dan menampilkan label penuh.
- **FR-MAP-10 (P0) Toolbar dan aksi node.** Node terfokus menampilkan toolbar kecil: Open, Add child, Rename, Status, More (Move to, Move earlier/later, Delete, ubah tipe dan warna). Add child membuat child dengan input judul inline di posisinya. Aturan operasinya ada di `spec-nodes-search.md` §6.7.
- **FR-MAP-11 (P0) Breadcrumb** di bar atas: `Root / PWN / Stack / ret2win`. Klik segmen = fokus pada node itu di peta.
- **FR-MAP-12 (P0) State kosong.** Jika hanya ada root: ilustrasi sederhana dan tombol Create first node.
- **FR-MAP-13 (P1) Minimap** di pojok kanan bawah: posisi node terlihat dan kotak viewport, klik untuk melompat.
- **FR-MAP-14 (P1) Outline view.** Toggle ke daftar pohon yang bisa dilipat sebagai alternatif navigasi dan aksesibilitas, memakai data dan aksi yang sama.
- **FR-MAP-15 (P1) Drag-and-drop** node ke node lain untuk memindah (target disorot, ditolak bila target adalah turunannya sendiri).
- **FR-MAP-16 (P1) Cross-link** (`node.links`) digambar sebagai busur putus-putus tipis hanya untuk node fokus atau hover.
- **FR-MAP-17 (P0) Performa.** SVG dengan transformasi lewat ref (jangan re-render React per frame). Maksimal sekitar 300 node tergambar bersamaan. Komputasi `computeVisible` + layout untuk pohon 2.000 node di bawah 30 ms (benchmark Vitest, informatif). Dataset 150 node tidak seimbang menjaga 55 fps ke atas (S1).
- **Dataset uji wajib** (generator deterministik dengan seed): 150 node acak tidak seimbang; satu node dengan 60 child; rantai kedalaman 12; root dengan 20 child; pohon 2.000 node. Agent wajib menjalankan screenshot Playwright pada tiap dataset dan memeriksa hasilnya sebelum menutup task peta.

#### Hasil spike S3 (catatan implementasi M3)

Lihat laporan lengkap di [`docs/spikes/s3-radial.md`](spikes/s3-radial.md). Penyesuaian desain dari spike S3 untuk M3:

- **FR-MAP-03 (bobot sudut):** Formula bobot sudut memperhitungkan bobot subtree yang **sedang terlihat** secara *bottom-up* ditambah boost kecil pada jalur fokus, serta memakai koefisien turunan tersembunyi yang lebih kecil (`0.35 * log2(1 + turunanTersembunyi)` dibanding `0.5`) agar sepupu tertutup berukuran besar tidak menyempitkan cabang aktif yang sedang diekspansi.
- **FR-MAP-03 (sub-cincin stagger):** Untuk `>= 12` sibling terlihat dalam satu induk (mis. `root20Children`, `wide60Children`), node didistribusikan ke sub-cincin stagger radial deterministik (2 sub-cincin untuk `>= 12`, 3 sub-cincin untuk `>= 34`) dan busur terarah untuk fan non-root besar agar bebas tumpang tindih dengan radius yang tetap kompak.
- **FR-MAP-05 & FR-MAP-08 (transisi & semantic zoom):** Umpan balik perubahan `zoomTier` ke state UI **dibekukan** selama animasi transisi terprogram berlangsung agar perubahan tier tidak memicu recompute layout/dimensi di tengah jalan; fokus pada node non-root memakai batas bawah `minK = 0.54` sehingga tetap terbaca pada Tier 1.
- **FR-MAP-09 (efek sorot fokus):** Efek cahaya jalur Root→Focus dan node terfokus memakai **halo stroke** (lapisan path/outline semi-transparan di bawah elemen utama), bukan filter blur SVG (`<filter>` / `feGaussianBlur`), guna menghindari *clipping* bounding-box pada edge vertikal/horizontal maupun degradasi FPS.
