# Supabase Deployment Runbook

Dokumen ini adalah urutan resmi untuk database bersama `app-binahub` dan `binahub-api`.

## Mengapa Tidak Boleh Menjalankan Dua `db push`

Kedua repositori memiliki migration historis bernomor `0005`–`0016`. Supabase mencatat versi dari prefix filename, sehingga menjalankan `supabase db push` dari kedua direktori dapat menganggap migration berbeda sebagai versi yang sama. Untuk database yang sudah berjalan, jangan rename, repair, atau replay migration lama tanpa membandingkan `supabase_migrations.schema_migrations` dan schema aktual.

## Existing / Production Database

1. Pastikan URL pada environment API menunjuk project yang benar. Ambil backup database terlebih dahulu.
2. Jalankan `npx supabase migration list` dari direktori yang sebelumnya menjadi sumber migration production. Jangan melakukan `migration repair` otomatis.
3. Jalankan `production_readiness.sql` secara read-only melalui SQL Editor.
4. Jika object dari migration API `0005`–`0014` sudah ada, jangan replay file tersebut.
5. Terapkan `0015_ceo_revision_hardening.sql`, lalu `0016_public_endpoint_security.sql`, masing-masing sebagai satu file penuh. Keduanya dibungkus transaksi dan dirancang untuk berhenti jika menemukan data ambigu/duplikat yang harus direkonsiliasi manual.
6. Jalankan kembali `production_readiness.sql`. Semua kolom `*_ready` harus `true` dan seluruh counter `*_issues` harus `0`.
7. Deploy API lebih dahulu, lalu frontend. Lakukan smoke test role admin, fasilitator, dan peserta.

Jangan menandai migration sebagai applied hanya untuk melewati error. Error duplicate batch/speaker atau observasi tanpa program berarti data harus diperbaiki dengan keputusan bisnis sebelum migration dilanjutkan.

## Fresh Database

1. Terapkan migration `app-binahub/supabase/migrations/0001` sampai `0016` secara leksikografis.
2. Terapkan migration `binahub-api/supabase/migrations/0005` sampai `0016` sebagai raw SQL secara leksikografis, bukan sebagai riwayat kedua `db push`.
3. Jalankan seed T-BOS yang disediakan frontend bila data mission/dimensi belum terbentuk.
4. Jalankan `production_readiness.sql` dan health check T-BOS frontend.

Untuk jangka panjang, buat satu baseline schema bertimestamp setelah release production stabil dan jadikan satu direktori sebagai pemilik migration baru. Sampai baseline itu diuji pada restore production, runbook dua fase di atas tetap menjadi sumber kebenaran.

## Smoke Test Wajib

- Admin dapat membuat program, mengaktifkan modul, membuat batch, dan mengganti assignment.
- Fasilitator hanya melihat program/mission miliknya, dapat membuat tim baru+roster, dan retry offline tidak menduplikasi observasi.
- Dashboard fasilitator tidak menampilkan mission di luar assignment; dashboard admin tidak mencampur program.
- Peserta hanya melihat program yang diikuti dan hanya dapat mengirim satu LEP lengkap.
- Speaker LEP yang dihapus tidak menghilangkan hasil historis.
- Endpoint chat mewajibkan token sesi untuk melanjutkan session lama; link proposal kedaluwarsa ditolak.
