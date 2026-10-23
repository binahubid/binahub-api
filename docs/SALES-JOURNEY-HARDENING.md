# Sales journey hardening dan cleanup UAT

18 Oktober 2026 · API 0.38.0 · app 0.39.0 · website 0.2.30

## SQL 70 — tidak menghapus data

Jalankan seluruh `supabase/migrations/0070_sales_journey_hardening.sql` setelah
SQL 69, pada database yang dipakai API. Deploy API sebelum app. Tidak ada secret
baru, cron baru, perubahan skor/soal CEO atau pengiriman email oleh migrasi.

- Transisi assessment/proposal/booking memakai RPC row-lock dan forward-only.
  Lifecycle client/retained dan tahap won/lost tidak dibuka kembali otomatis.
- `sales_due_followups` menyaring kondisi berhenti sebelum LIMIT. Pemeriksaan
  terakhir, claim atomik, suppression, jam kerja dan izin app tetap berlaku.
- Default run key berganti per lima menit. Kunci eksplisit caller tetap berlaku;
  scheduler lama yang memaksa kunci harian harus disesuaikan oleh operator.
- `flag_stalled_standard_proposals` dipanggil worker recovery yang sudah ada,
  hanya saat gate recovery existing diizinkan. Pekerjaan processing lebih dari
  sepuluh menit tanpa status terkirim masuk rekonsiliasi. Admin harus memeriksa
  arsip/provider sebelum melanjutkan; tidak ada resend massal otomatis.
- Attribution hanya field kampanye/journey yang diperbolehkan. Jangan memakai
  nama/email/nomor telepon pada nilai UTM; filter pola jelas bukan anonimisasi.
- Konsultasi individu dibuat setelah permintaan eksplisit dalam sesi hasil.
  SQL memeriksa pemilik, status submitted, retensi dan izin tinjau aktif setiap
  kali dipanggil; attempt unik mencegah inquiry duplikat saat retry. Lead lama
  tidak diubah identitas/tahapnya berdasarkan kecocokan email. Tidak menautkan
  akun auth atau memberi akses assessment lain berdasarkan email.
- Inquiry berisi konteks peran/tujuan dan ID hasil, tidak seluruh jawaban/skor.
  Revokasi/retensi menghalangi akses ulang hasil; inquiry permintaan kontak
  tetap mengikuti penyimpanan CRM existing. Tidak menambah consent marketing.
- Rekomendasi program pada snapshot baru mengarah ke detail kode solusi.
  Snapshot hasil historis tidak diubah.

## Cleanup operasional uji — v2 selektif

**SQL 70 sudah dijalankan pengguna; tidak perlu diulang.** Cleanup bukan migrasi
70. Pengguna mengonfirmasi hanya program
`d1ea232f-2038-4cfd-8c26-59caf4eaf760` yang nyata. Versi wipe lama ditarik.
File yang dipakai sekarang: `supabase/operations/cleanup_operational_test_data.sql`,
berawalan **SELECTIVE UAT CLEANUP v2**.

**Belum ada data produksi dihapus oleh agen.** SQL langsung belum terhubung;
jangan mengganti operasi satu transaksi dengan DELETE REST bertahap.

### 1. Jalankan pratinjau dahulu

Salin **seluruh file terbaru** ke SQL Editor database API sebagai pemilik,
tanpa mengubah `binahub.cleanup_execute='false'`. Hasil awal:

- `mode = PREVIEW_ONLY_NO_DATA_CHANGED`
- `protected_program` adalah ID program nyata di atas.
- Per tabel: `total_before`, `protected_rows`, `planned_delete` dan
  `deleted_rows`. Semua `deleted_rows` harus 0 di mode ini.
- Tidak ada archive persisten, UPDATE atau DELETE pada data bisnis.
  Snapshot transaksi konsisten tidak mengambil lock eksklusif saat preview.
- Bila program nyata tidak ditemukan, script berhenti. Jangan menghapus guard
  atau mengganti program ID agar script lolos pada database lain.

Kirim output jumlahnya untuk ditinjau sebelum penghapusan. Jangan mengirim dump
baris peserta, jawaban, kode akses, secret, atau salinan arsip privat.

### 2. Batas perlindungan

Script membaca FK aktual database dan memperluas perlindungan dua arah di dalam
scope operasional. Program/organisasi, batch, peserta, tim, misi yang digunakan,
observasi, skor, live score, akses, questionnaire, proyek, akun klien dan CRM
terkait dilindungi. Referensi UUID di JSON/polymorphic serta email kontak ikut
dipakai secara konservatif untuk menemukan hubungan tanpa FK.

Identitas staf tidak dipakai untuk menyatakan semua program yang pernah
ditanganinya sebagai nyata. Sebaliknya organisasi atau record operasional yang
berbagi relasi dengan program nyata tetap dipertahankan bila tidak bisa
dipisahkan secara aman. Jadi sebagian data uji yang beririsan bisa tersisa.

Seluruh akun auth/profiles, katalog, kamus kompetensi, bank instrumen CEO,
template, pengaturan, sumber/kampanye, suppression dan definisi misi/area T-BOS
bersama tidak dihapus. Tabel log/dokumen tanpa hubungan yang cukup jelas juga
dipertahankan seluruhnya, termasuk communications/generated_documents,
calendar_webhook_events, email_delivery_events, ai_generation_logs,
ams_integration_events/login tickets dan histori automation/pilot/runtime.
Riwayat pengiriman yang jelas berada dalam scope antrean outbound,
follow-up dan PE tetap dapat dibersihkan untuk record uji.

FK dari tabel baru/di luar scope melindungi parent terkait, bukan di-CASCADE.
Satu pengecualian eksplisit: tautan `profiles.organization_id` ke organisasi
yang benar-benar akan dihapus dilepas; akun/role tidak dihapus. Profil program
nyata tidak dilepas. Original profil yang berubah diarsipkan sebelum perubahan.

### 3. Eksekusi setelah preview disetujui

1. Buat backup/snapshot penyedia database. Jeda scheduler/worker dan submission/
   pengiriman; tunggu pekerjaan yang sedang berjalan selesai. Jangan menjalankan
   penghapusan saat program nyata sedang dioperasikan.
2. Pada file **yang sama**, ubah hanya
   `set local binahub.cleanup_execute='false';` menjadi
   `set local binahub.cleanup_execute='true';`, lalu jalankan seluruh file.
   Ini satu kali maintenance, bukan environment flag Vercel baru.
3. Plan dihitung ulang dari data terkini. Eksekusi mengunci tabel selama transaksi,
   mengarsipkan hanya row yang akan dihapus ke schema
   `binahub_uat_selective_archive_20261018`, dan menutup akses
   public/anon/authenticated/service_role ke arsip.
4. DELETE hanya terhadap kandidat beridentitas yang tercatat, dari anak ke induk.
   Tidak ada TRUNCATE, CASCADE, disable FK/trigger atau perubahan global flag.
   Siklus impor nullable yang dikenal dilepas hanya pada lead uji.
5. Akhir transaksi membandingkan isi lengkap/multiset data terlindungi, global,
   dan akun auth dengan snapshot awal. Perubahan trigger yang tak diharapkan,
   jumlah delete yang berbeda atau siklus yang belum terselesaikan membatalkan
   **seluruh** transaksi, termasuk arsip dan perubahan profil.
6. Hasil sukses: `mode = EXECUTED`; periksa planned_delete = deleted_rows,
   login dan akses program nyata, peserta/tim/skor/live score serta katalog.
   Jangan hanya mengandalkan dashboard kosong: record terkait/ambigu sengaja
   tetap ada. Buka kembali maintenance setelah verifikasi.
7. Jika error, berhenti dan kirim kode error. Jangan melepas guard. Arsip yang
   sudah ada menyebabkan eksekusi ulang ditolak, bukan ditimpa.

Arsip dapat dipulihkan pemilik melalui transaksi berurutan FK yang ditinjau;
tidak ada restore otomatis. Arsip memuat data pribadi: simpan privat hanya
selama masa pemulihan yang disepakati, jangan expose via REST/commit/ekspor
publik, lalu hapus melalui operasi owner terpisah setelah verifikasi.

Tidak menghapus mailbox/provider, event eksternal Cal.com, file Storage, data
AMS di database terpisah atau draft lokal perangkat peserta. Jangan menyebut
cleanup database ini sebagai penghapusan semua salinan di semua platform.

### Verifikasi cleanup v2

Fixture sintetis PGlite: preview berulang tanpa perubahan, eksekusi selective,
perlindungan program/tim/skor/akses/CRM dan FK komposit, akun auth/global tetap
utuh, pelepasan hanya tautan organisasi uji, siklus impor, JSON UUID/email,
FK baru konservatif, role service ditolak, rollback efek trigger/siklus serta
arsip tidak ditimpa. Ini bukan klaim preview/eksekusi sudah dilakukan di produksi.

## Tetap perlu verifikasi produksi

Rilis ini tidak memasang atau mengaktifkan scheduler. Jalankan uji internal dan
periksa activity/heartbeat/provider pada deployment yang benar. Heartbeat adalah
bukti pemanggilan, bukan bukti inbox. Workflow nurturing email blast, timeline
klien terpadu/pagination, pembayaran, proposal custom dan dokumen CEO yang belum
lengkap tidak boleh dianggap selesai dari rilis ini.

PGlite menguji forward stage, antrean di belakang record lama, consent/owner/
idempotency, hak RPC, flag proses terputus, cleanup/arsip, preserve akun/katalog,
cycle impor dan rollback dependensi terlindungi. Fixture bukan source CEO atau
bukti bahwa migrasi sudah dijalankan di produksi.

Hasil verifikasi rilis: API 537 tes lulus/3 dilewati, app 313 tes lulus,
14 skenario browser Chromium desktop/ponsel lulus; typecheck, lint file berubah
dan build produksi ketiga repo lulus. Tampilan konsultasi diperiksa dari
screenshot desktop/ponsel emulasi; belum diuji pada perangkat fisik/Safari.
Website audit produksi nol temuan, tetapi lima temuan dev-only pada rantai
braces/ESLint masih memiliki batas perbaikan upstream. Tidak dilakukan force
downgrade yang dapat merusak lint/build Next.
