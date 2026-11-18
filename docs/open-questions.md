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

### Perbedaan PRD dan dokumentasi resmi

Catat di sini setiap kali dokumentasi resmi berbeda dari PRD (nama API, parameter, batas, perilaku). Format: apa kata PRD, apa kata dokumentasi (dengan tautan dan versi), dan apa yang dilakukan.

_(kosong)_
