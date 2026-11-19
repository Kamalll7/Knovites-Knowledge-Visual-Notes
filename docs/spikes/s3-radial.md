# Laporan Spike S3 — Prototipe Peta Pohon Radial

- **Status:** Selesai — siap ditinjau pada **checkpoint pemilik** sebelum M3 dimulai.
- **Kode prototipe (sekali pakai, di luar `src/` dan build produksi):** [`spikes/s3-radial/`](../../spikes/s3-radial/)
- **Dokumen rujukan:** [`docs/spec-map.md`](../spec-map.md) (§6.2 `FR-MAP-02`, `FR-MAP-03`, `FR-MAP-05`, `FR-MAP-08`, `FR-MAP-09`, `FR-MAP-17`), [`docs/spec-ui-nfr.md`](../spec-ui-nfr.md) (§8), [`docs/plan.md`](../plan.md) (Spike S3), ADR [`0002-d3-map-packages-and-selection.md`](../decisions/0002-d3-map-packages-and-selection.md).
- **Catatan API D3:** [`docs/open-questions.md`](../open-questions.md) (konvensi sudut 12 o'clock pada `d3-shape` `linkRadial()`).

---

## 1. Tujuan dan Cakupan Spike

Menguji asumsi berisiko pada desain peta radial (`FR-MAP-02`, `FR-MAP-03`, `FR-MAP-05`, `FR-MAP-08`, `FR-MAP-17`) dengan prototipe terpisah di `spikes/s3-radial/` (Vite config sendiri, mengimpor hanya `@/domain/tree`, `@/domain/datasets`, `src/index.css` / `src/ui/tokens.css`, dan `@/ui/components/button`), tanpa editor TipTap/React Flow dan tanpa IndexedDB/Dexie:

1. Seleksi node terlihat (`computeVisible`) dengan batas `MAX_CHILDREN_SHOWN = 24`, bubble `+N`, sibling ancestor collapsed bertanda `Judul · N`, dan cucu fokus muncul di Tier 2.
2. Layout radial proporsional berbasis `d3-hierarchy` + resolusi tabrakan `MIN_GAP_PX = 12px` across seluruh 5 dataset uji wajib (`unbalanced150`, `wide60Children`, `chainDepth12`, `root20Children`, `large2000`).
3. Animasi transisi fokus `520 ms` (`easeCubicOut`, dapat disela, menghormati `prefers-reduced-motion`) dan pan/zoom (`d3-zoom`) yang memperbarui SVG lewat DOM ref tanpa re-render React per frame.
4. Semantic zoom 3 tier (`Tier 0 < 0.5`, `Tier 1 0.5–<1.2`, `Tier 2 >= 1.2`) + tema gelap & terang + jalur Root→Focus menyala.

---

## 2. Pengukuran Tumpang Tindih (Playwright Headless Chromium)

Seluruh pengukuran dijalankan lewat `pnpm exec playwright test -c spikes/s3-radial/playwright.config.ts` pada viewport `1280×800` memakai `boxesOverlap(a, b, 12)` (`MIN_GAP_PX = 12px`) untuk memverifikasi pasangan node yang beririsan atau lebih dekat dari 12 px:

| Dataset | State Fokus | Visible / Total | Pair Overlap (`gap = 12px`) | Layout ms (`computeVisible + computeRadialLayout`) |
| --- | --- | ---: | ---: | ---: |
| `unbalanced150` | Root | 4 / 150 | **0** | 0.50 ms |
| `unbalanced150` | Deep focus (depth 4) | 20 / 150 | **0** | 2.70 ms |
| `wide60Children` | Root | 2 / 61 | **0** | 0.30 ms |
| `wide60Children` | Hub fokus (top-24 + bubble `+36`) | 27 / 61 | **0** | 0.40 ms |
| `wide60Children` | Hub fokus setelah klik `+36` (semua 60 anak) | 62 / 61 | **0** | 0.90 ms |
| `chainDepth12` | Root | 2 / 12 | **0** | 0.20 ms |
| `chainDepth12` | Deep focus (depth 8) | 11 / 12 | **0** | 0.20 ms |
| `root20Children` | Root (20 sibling langsung) | 21 / 20 | **0** | 0.40 ms |
| `root20Children` | Fokus child depth 1 | 21 / 20 | **0** | 0.30 ms |
| `large2000` | Root | 4 / 2000 | **0** | 1.80 ms |
| `large2000` | Deep focus (depth 4) | 51 / 2000 | **0** | 2.30 ms |

Semua 11 skenario di atas seluruh 5 dataset menghasilkan **0 tumpang tindih**, dan waktu komputasi layout untuk `large2000` berada di **1.80–2.30 ms** (jauh di bawah batas 30 ms pada `FR-MAP-17`).

---

## 3. Pengukuran Performa Transisi Fokus (150 & 2.000 Node)

Diukur di browser Chromium headless (`spikes/s3-radial/capture.spec.ts`, transisi `520 ms` terinterpolasi per `id` via `requestAnimationFrame` + DOM refs, di luar sesi perekaman video agar tidak terpengaruh overhead screencast):

| Dataset | Transisi | Layout ms | Durasi (ms) | Frame Count | Frame time `p50` (ms) | Frame time `p95` (ms) | `max` (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `unbalanced150` | Root → Deep focus | 0.60 | 520.6 | 30 | **16.7** (~60 fps) | **16.7** (~60 fps) | 50.0 |
| `large2000` | Root → Deep focus | 3.50 | 536.2 | 27 | **16.7** (~60 fps) | **33.4** | 50.1 |

Uji interupsi di tengah transisi (`Root` diklik 160 ms setelah memicu transisi ke deep focus) menyelesaikan perpindahan bersih ke `__virtual_root__` tanpa lonjakan posisi.

---

## 4. Evaluasi Visual per Dataset, Screenshot, dan Rekaman

Semua screenshot tersimpan di `spikes/s3-radial/out/*.png` (23 gambar PNG + 1 video `.webm` yang di-gitignore agar tidak membebani repo git).

### Ringkasan observasi screenshot:
- **`unbalanced150`** ([root dark](../../spikes/s3-radial/out/unbalanced150-root-dark.png), [root light](../../spikes/s3-radial/out/unbalanced150-root-light.png), [focus dark](../../spikes/s3-radial/out/unbalanced150-focus-dark.png), [focus light](../../spikes/s3-radial/out/unbalanced150-focus-light.png), [tier 0](../../spikes/s3-radial/out/unbalanced150-tier0-dark.png), [tier 2](../../spikes/s3-radial/out/unbalanced150-tier2-dark.png)):
  Cabang berdistribusi proporsional tanpa bertumpuk; badge `· 122` memberi isyarat berat subtree; pada Tier 2 cucu dan tag tampil rapi; jalur Root→Focus bercahaya jelas baik di tema gelap maupun terang.
- **`wide60Children`** ([root dark](../../spikes/s3-radial/out/wide60Children-root-dark.png), [focus dark](../../spikes/s3-radial/out/wide60Children-focus-dark.png), [expanded-60 dark](../../spikes/s3-radial/out/wide60Children-expanded-dark.png)):
  Saat fokus pada node hub 60 child, default menampilkan 24 anak teratas + bubble `+36`. Mengklik `+36` memperluas seluruh 60 anak dengan stagger 3 sub-cincin radial di busur terarah (~255° berpusat pada arah induk) sehingga 0 tumpang tindih tercapai tanpa radius membesar berlebihan.
- **`chainDepth12`** ([root dark](../../spikes/s3-radial/out/chainDepth12-root-dark.png), [focus dark](../../spikes/s3-radial/out/chainDepth12-focus-dark.png), [focus light](../../spikes/s3-radial/out/chainDepth12-focus-light.png)):
  Seluruh 11 ancestor/fokus/child pada rantai vertikal 12 tingkat tampil lengkap, terhubung garis menyala kontinu tanpa putus di sumbu vertikal (`θ = π`).
- **`root20Children`** ([root dark](../../spikes/s3-radial/out/root20Children-root-dark.png), [root light](../../spikes/s3-radial/out/root20Children-root-light.png), [focus dark](../../spikes/s3-radial/out/root20Children-focus-dark.png)):
  20 sibling di sekitar Root tersebar melingkar 360° menggunakan stagger 2 sub-cincin sehingga tidak ada kapsul yang menyentuh tetangganya dan tetap muat nyaman dalam satu layar pada zoom `65%`.
- **`large2000`** ([root dark](../../spikes/s3-radial/out/large2000-root-dark.png), [focus dark](../../spikes/s3-radial/out/large2000-focus-dark.png), [focus light](../../spikes/s3-radial/out/large2000-focus-light.png)):
  Dari 2.000 node, `computeVisible` membatasi node tergambar menjadi 51 node saat fokus dalam (waktu layout 2.30 ms), menjaga kejelasan visual tanpa kekacauan *hairball*.
- **Rekaman video transisi:** `spikes/s3-radial/out/focus-transition.webm` (tersedia lokal setelah menjalankan `capture.spec.ts`, tidak di-commit karena aturan ukuran `.webm`).

---

## 5. Asumsi di `docs/spec-map.md` yang Perlu Direvisi / Diklarifikasi Sebelum M3

Sesuai aturan spike (`docs/plan.md`), perbedaan berikut dicatat untuk ditinjau pemilik sebelum PRD diubah atau M3 dimulai:

1. **Formula bobot sudut di `FR-MAP-03` (`1 + 0.5 * log2(1 + hidden + visible)`):**
   Bila dipakai apa adanya tanpa memperhitungkan **jumlah anak yang sedang terlihat pada cabang aktif**, dua sepupu tertutup berbobot berat di depth 1 (mis. 500 dan 120 turunan tersembunyi) menyedot porsi sudut terbesar, sementara cabang aktif yang sedang diekspansi ke depth 4–5 mendapat irisan sempit sehingga radius anak-anaknya terdorong ke luar. *Rekomendasi untuk M3:* turunkan koefisien turunan tersembunyi (mis. `0.35 * log2(1 + hidden)`) dan akumulasikan bobot child yang **sedang terlihat** (`bottom-up`) ditambah boost kecil untuk node pada jalur fokus.
2. **Satu cincin radius `r(d)` ketat vs sub-cincin stagger untuk fan lebar (`FR-MAP-03`):**
   Pada `wide60Children` (60 saudara dalam satu kedalaman) dan `root20Children` (20 saudara), meletakkan semua kapsul berlabel (`120–250 px` lebar) pada satu lingkaran tunggal `r(d)` memaksa radius cincin membengkak `> 1.500 px` agar tidak tumpang tindih. Membagi saudara padat (`>= 12` → 2 sub-cincin, `>= 34` → 3 sub-cincin dengan offset `52–56 px`) menjaga radius kompak dan muat di layar dengan 0 overlap. Perlu persetujuan pemilik bahwa `r(d)` boleh memakai sub-cincin deterministik saat jumlah sibling terlihat padat.
3. **Keterkaitan animasi kamera `FR-MAP-05` dan `zoomTier` `FR-MAP-08`:**
   Bila skala kamera animasi langsung memperbarui state React `zoomTier` di setiap tick/end animasi, melintasi ambang batas `0.5` saat klik fokus memicu recompute dimensi node dan tier cucu di tengah animasi (loop umpan balik), atau saat anak-anak tersebar lebar auto-fit bisa turun di bawah `0.5` lalu menyembunyikan teks ke Tier 0. *Rekomendasi:* bekukan umpan balik `zoomTier` selama transisi terprogram dan tetapkan `minK = 0.54` saat memfokuskan node bukan-root agar tetap di Tier 1 yang terbaca.
4. **Efek cahaya jalur fokus & filter SVG Chromium:**
   Pemakaian `<filter id="focus-glow">` dengan default `filterUnits="objectBoundingBox"` membuat elemen `<path>` yang persis vertikal (`width = 0`, terlihat pada `chainDepth12`) terpotong/hilang seluruhnya di Chromium; sedangkan `filterUnits="userSpaceOnUse"` berarea besar menurunkan frame rate akibat rasterisasi blur offscreen yang besar. Mengganti filter blur pada edge & node fokus dengan **underlay stroke halo semi-transparan** bekerja identik di semua sudut dan menaikkan kinerja headless ke ~60 fps (`16.7 ms` p50).
5. **Transisi tema saat toggle dark↔light (`src/index.css`):**
   Komponen `Button` memakai `transition-all`, sehingga pergantian kelas `.dark` tanpa kelas `.theme-switching` menyebabkan tombol/SVG tertangkap setengah pudar saat switch cepat. M3 perlu memastikan `.theme-switching` diaktifkan sesaat saat switch tema.

---

## 6. Tiga Keputusan Desain Visual Utama dan Alternatifnya

1. **Kapsul berlabel lebar dengan titik status & badge terpisah kanan (`Judul · N`) vs lingkaran kecil referensi D3 standar:**
   - *Pilihan:* Kapsul membulat (`rx = 12`, root `rx = 22`) lebar adaptif `118–268 px` (Tier 1/2) dan lingkaran besar (`r = 14–24 px`) dengan label eksternal di Tier 0.
   - *Alasan:* Pemilik menilai Referensi 1 terlalu kecil untuk dibaca dan diklik langsung; kapsul memuat judul utuh/jelas, titik status berwarna di kiri, dan jumlah turunan rata kanan.
   - *Alternatif:* Lingkaran kecil seragam dengan teks melayang di luar lingkaran (lebih hemat tempat, tetapi lebih sulit diklik cepat dan rawan tabrakan label saat teks menembus garis cabang).
2. **Stagger 2–3 sub-cincin radial & busur terarah (`max 255°`) untuk hub lebar (`>= 12` anak):**
   - *Pilihan:* Menggeser posisi radius sibling padat secara bergantian (`idx % 2` / `idx % 3`) dan membatasi fan anak non-root agar mengarah ke luar menjauhi `(0, 0)`.
   - *Alasan:* Menghindari garis balik melewati pusat dan mencegah radius `r(d)` membengkak tak terbaca pada `wide60Children` atau `root20Children`.
   - *Alternatif:* Satu cincin besar atau dua kolom daftar grid di sekitar hub (satu cincin terlalu jauh/kecil saat zoom-to-fit; grid kehilangan karakter radial pohon).
3. **Underlay halo stroke ganda untuk fokus & jalur Root→Focus (tanpa SVG `feGaussianBlur`):**
   - *Pilihan:* Menggambar path halo lebar (`strokeWidth + 7`, `opacity 0.22`) di bawah path utama jalur aktif (`opacity 0.96`), dan outline stroke halo di sekeliling kapsul fokus.
   - *Alasan:* Tetap tampak jelas di tema gelap maupun terang tanpa bug clipping `objectBoundingBox` pada garis vertikal dan tanpa penalti FPS blur di animasi RAF.
   - *Alternatif:* CSS `drop-shadow` atau SVG `feGaussianBlur` (rawan *culling* sumbu lurus dan lambat saat 20+ node dianimasikan bersamaan).
