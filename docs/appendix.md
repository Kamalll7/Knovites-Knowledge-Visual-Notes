# Knovites — Lampiran

*Bagian dari PRD Knovites v0.1. Lihat `README.md`. Lampiran A (AGENTS.md) ada di root repo, Lampiran D (pertanyaan terbuka) ada di `open-questions.md`.*

## Lampiran B — Definition of Done (berlaku untuk setiap task)

- Perilaku baru punya tes, dan semua cek CI hijau.
- Acceptance criteria task terpenuhi dan dirujuk di deskripsi PR.
- Task UI menyertakan screenshot yang sudah diperiksa.
- Tidak ada regresi pada dataset performa dan budget bundle.
- Tidak ada TODO tanpa ID task atau entri di `open-questions.md`.
- Dokumen yang terdampak sudah diperbarui.
- Detail API atau library yang dipakai sudah diverifikasi ke dokumentasi resmi (lihat aturan di `AGENTS.md`).

## Lampiran C — Risiko dan mitigasi

1. **TipTap di dalam React Flow** bentrok soal fokus, drag, dan scroll. Mitigasi: spike S2, FR-CVS-04, satu instance editor, tes e2e E4.
2. **Banyak elemen teks membuat kanvas lambat.** Mitigasi: renderer statis (FR-TXT-08), `onlyRenderVisibleElements`, tes performa.
3. **Animasi peta patah-patah** karena re-render React. Mitigasi: transformasi lewat ref dan d3 atau rAF, spike S3, benchmark T3.8.
4. **Estetika peta bersifat subjektif.** Mitigasi: checkpoint pemilik di S3, T3.5, dan T3.6 dengan screenshot atau video, iterasi sebelum lanjut.
5. **Encode WebP tidak tersedia di beberapa browser.** Mitigasi: fallback ke format asal dengan resize saja.
6. **Detail GitHub API tidak seperti yang diasumsikan** (batas, CORS, perilaku error). Mitigasi: spike S1 sebelum desain sync dikunci, fake GitHub mengikuti hasil spike.
7. **Tree GitHub terpotong pada repo besar.** Mitigasi: fallback per direktori (FR-SYNC-02).
8. **Rate limit saat initial pull repo besar.** Mitigasi: cache blob SHA, konkurensi terbatas, canvas dan aset lazy, batch GraphQL bila terbukti perlu.
9. **Token ada di browser.** Mitigasi: fine-grained token satu repo, CSP, larangan innerHTML, peringatan di UI dan README. OAuth atau GitHub App lewat backend tipis dipertimbangkan di fase berikutnya.
10. **IndexedDB bisa digusur browser.** Mitigasi: `storage.persist()`, sync rutin, export zip.
11. **Agent melenceng dari scope atau mengubah format data diam-diam.** Mitigasi: aturan keras di AGENTS.md, checkpoint pemilik, tes round-trip dan fixture yang membuat perubahan format gagal di CI.
12. **Model agent kurang kuat pada logika rumit (merge, layout).** Mitigasi: logika dipisah di domain murni dengan tes properti, sehingga benar atau salah bisa diverifikasi mesin dan tidak bergantung pada penilaian model.
13. **Nama library, versi, atau API di PRD keliru** karena ditulis dari pengetahuan yang belum diverifikasi. Mitigasi: aturan verifikasi dokumentasi di AGENTS.md, dan perbedaan dicatat di `open-questions.md`.

## Lampiran E — Backlog setelah Phase 1

Lab (tipe node `lab`, terminal browser, sandbox), graph view, mastery checklist, export Markdown dan PDF, shape, konektor, dan gambar bebas di kanvas, merge teks tingkat karakter, OAuth atau GitHub App dengan backend tipis, dukungan remote Git lain (Forgejo, Gitea), kolaborasi real-time.

## Lampiran F — Glosarium

- **Node:** satu unit pengetahuan, satu folder di repo.
- **Kanvas:** isi halaman sebuah node (`canvas.json`).
- **Elemen:** kotak teks atau gambar di kanvas.
- **Root virtual:** akar pohon yang tidak punya folder atau halaman sendiri.
- **Fokus:** node yang sedang menjadi pusat perhatian peta.
- **Changeset:** daftar file yang berubah akibat satu operasi.
- **Base:** SHA commit terakhir yang berhasil disinkronkan.
- **Dirty:** file lokal yang belum dikirim ke GitHub.
- **Fractional index:** string pengurut yang memungkinkan menyisipkan item tanpa mengubah item lain.
- **Blob SHA:** hash isi sebuah file menurut Git.
- **Spike:** percobaan kode sekali pakai untuk menguji asumsi sebelum desain dikunci.
