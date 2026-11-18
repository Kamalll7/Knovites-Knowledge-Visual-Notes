# AGENTS.md — Knovites

Knovites (Knowledge Visual Notes) adalah aplikasi web catatan berbentuk pohon visual. Setiap node punya kanvas bebas (teks berformat dan gambar). Seluruh data disimpan di repo GitHub milik pengguna. Phase 1 adalah situs statis tanpa backend.

## Sumber kebenaran

Semua spesifikasi ada di `docs/`. Mulai dari `docs/README.md` (peta dokumen, urutan baca, dan file mana untuk milestone mana).

Jangan membaca seluruh PRD sekaligus. Baca hanya file yang dirujuk task yang sedang dikerjakan, ditambah `docs/data-format.md` bila menyentuh format file.

## Perintah

```
pnpm dev | build | typecheck | lint | test | test:e2e | audit
```

## Aturan keras

1. Jangan menambah fitur di luar PRD. Jika ambigu: pilih opsi paling sederhana yang konsisten dengan prinsip di `docs/prd.md` §1.3, catat di `docs/open-questions.md`, lanjutkan.
2. Tidak ada backend. Tidak ada request jaringan selain ke `api.github.com`.
3. Layer: `domain/` murni (tanpa React, DOM, IO). Dexie hanya di `storage/`. Octokit hanya di `sync/`. `features/*` tidak saling import.
4. File repo knowledge hanya ditulis lewat `domain/serialize`. Mengubah format = update `docs/data-format.md` + naikkan `schema` + migrasi + fixture + tes.
5. Dependency baru butuh ADR di `docs/decisions/`. Dilarang ekstensi TipTap Pro. Dilarang `dangerouslySetInnerHTML` dan `innerHTML`.
6. Jangan pernah log token atau isi catatan. Jangan force push. Jangan menimpa file remote yang tidak valid.
7. TypeScript strict. Dilarang `any` kecuali dengan komentar alasan.
8. Token, kredensial, dan `.env.local` tidak pernah di-commit (pastikan masuk `.gitignore` sebelum menulis file apa pun yang memakainya).
9. Keputusan bertanda **[LOCKED]** di PRD tidak boleh diganti tanpa persetujuan eksplisit pemilik.

## Aturan verifikasi dokumentasi (penting)

Nama library, versi, dan detail API di PRD ditulis dari pengetahuan yang **belum diverifikasi** terhadap dokumentasi terbaru. Karena itu:

1. Sebelum memakai sebuah API atau library untuk pertama kali, baca dokumentasi resmi untuk **versi yang terpasang** (bukan dari ingatan).
2. Jika dokumentasi berbeda dari PRD, **ikuti dokumentasi**. Catat perbedaannya di `docs/open-questions.md` (atau ADR bila mengubah keputusan) dan sebutkan di deskripsi PR.
3. Jika perbedaannya mengubah perilaku yang dijanjikan PRD (misalnya API tidak mendukung sesuatu), berhenti dan laporkan ke pemilik sebelum mengubah desain.
4. Jangan menebak nama method, parameter, atau endpoint. Kalau tidak bisa memverifikasi, tulis sebagai pertanyaan terbuka.

## Alur per task

1. Baca bagian PRD yang dirujuk task (ID `FR-...`) di `docs/plan.md`.
2. Tulis tes dulu (harus gagal), lalu implementasi.
3. Jalankan `typecheck`, `lint`, `test`, dan e2e yang relevan. Semua harus hijau.
4. Task UI: ambil screenshot Playwright, **lihat hasilnya**, perbaiki sebelum selesai.
5. Perbarui dokumen yang terdampak.
6. Commit kecil dengan Conventional Commits dan rujukan ID. Contoh: `feat(map): radial layout [T3.2, FR-MAP-03]`.
7. Jika terblokir lebih dari dua percobaan pada masalah yang sama: berhenti, tulis masalah dan hipotesis di `docs/open-questions.md`, kerjakan task lain yang tidak bergantung.

## Milestone dan checkpoint

Kerjakan milestone berurutan (lihat `docs/plan.md`). Jangan mulai milestone berikutnya sebelum semua P0 milestone sebelumnya selesai dan CI hijau. Pada checkpoint pemilik (akhir spike S3, M3, M4, M6), berhenti dan minta persetujuan.

## Definition of Done

Lihat `docs/appendix.md` (Lampiran B). Ringkasnya: tes baru untuk perilaku baru, semua cek CI hijau, acceptance criteria terpenuhi dan dirujuk di PR, screenshot diperiksa untuk task UI, tidak ada regresi performa atau bundle, dokumen terbarui.
