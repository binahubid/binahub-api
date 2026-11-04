# Scheduler laporan — Supabase Cron

API0.47.16 / SQL89 (pemasang tidak berubah) · 4 November 2026. Mengikuti pola SLJ: Supabase Cron →
`pg_net` HTTP → worker BinaHub. Tidak memerlukan n8n laptop atau Vercel Cron.
Hosting API dan ketentuan paket hosting tetap urusan terpisah.

Status operator 4 November: pengguna melaporkan SQL89 berhasil dijalankan.
Ini bukan inspeksi langsung database. Vault/status/aktivasi masih perlu diperiksa;
SQL89 tidak perlu diulang hanya karena GitHub quality check gagal.

## Setup singkat — satu kali

1. Pastikan deployment API0.47.15 atau lebih baru berhasil dan `https://api.binahub.id` adalah
   API produksi milik BinaHub. SQL89 hanya mengirim ke domain/path tetap tersebut;
   jangan mengaktifkannya jika domain belum menuju deployment yang benar.
2. Jalankan **file penuh** `supabase/migrations/0089_supabase_report_scheduler.sql`
   di SQL Editor project Supabase API BinaHub sebagai `postgres`. Script mengaktifkan
   extension `pg_cron`/`pg_net` dan memasang **satu job nonaktif**. Vault harus
   tersedia; jika belum, aktifkan Vault di dashboard lalu ulangi file penuh.
   Ini tidak membuat HTTP request, mengirim email, memanggil AI atau menghapus
   data peserta. SQL81/88 dan migration lama tidak perlu diulang.
3. Di **Supabase Vault**, buat secret bernama `binahub_report_worker_secret`.
   Isinya harus **persis nilai `FOLLOW_UP_CRON_SECRET` pada environment produksi
   API**, bukan `CRON_SECRET` PETA, bukan service-role key, bukan key SLJ/AI.
   Gunakan panel aman; jangan kirim nilainya ke chat, Git atau screenshot.
   Tidak ada nama environment API baru. Jika credential existing belum terisi
   atau kurang dari32 karakter, operator perlu menetapkan secret acak32–512
   karakter tanpa spasi pada API dan Vault yang sama, lalu redeploy API.

   **Panduan klik:**

   - Vercel → project **binahub-api** → **Settings → Environment Variables**.
     Cari `FOLLOW_UP_CRON_SECRET` untuk **Production**, lalu salin **Value** jika
     bisa dilihat. Jangan salin nama variabel, menambahkan `Bearer`, tanda kutip
     atau spasi. Jika tipenya Secret/Sensitive, nilainya memang tidak dapat
     dilihat setelah disimpan; gunakan catatan credential aman milik operator
     atau koordinasikan rotasi, bukan menghapus/mengganti key lain sembarangan.
   - Supabase → **project yang sama dengan SQL89** → **Integrations → Vault →
     Secrets**, pilih **Add new secret** (label dapat berupa Create secret).
   - **Name:** `binahub_report_worker_secret`.
   - **Secret/Value:** tempel **nilai** yang disalin dari Vercel.
   - **Description:** opsional; klik **Save**. Jika nama ini sudah ada, perbarui
     entri itu, bukan membuat nama lain. Jangan tempel token di SQL/chat/repo.
   - Tidak perlu mengubah environment/redeploy jika hanya menyalin nilai existing
     ke Vault. Jangan ubah RLS atau menambah policy publik untuk konfigurasi ini.

4. Jalankan pemeriksaan tanpa efek samping:

   ```sql
   select binahub_scheduler.report_cron_status();
   ```

   `installed`, `configurationMatches`, `credentialConfigured` harus `true`,
   dan `active` masih `false`. Pemeriksaan ini tidak membuktikan kecocokan nilai
   dengan environment API, domain, atau keberhasilan provider; cocokkan melalui
   panel aman dan deployment. Jangan menggunakan HEAD/GET worker sebagai probe.
5. Sebelum aktivasi, periksa Kesiapan layanan dan antrean global. Worker dapat
   memproses **semua pekerjaan due**, bukan hanya record demo; mengaktifkannya
   dapat memakai kuota AI, mengirim email hasil dan menjalankan retensi PE yang
   sudah berlaku. Pastikan tidak ada scheduler lain yang memanggil endpoint
   yang sama. Uji awal di lingkungan/data/penerima internal yang terisolasi;
   jika produksi memiliki antrean nyata, jangan menganggapnya uji tanpa efek.
   Setelah cakupan dan pengiriman yang tertunda disetujui, aktifkan:

   ```sql
   select binahub_scheduler.set_report_cron_enabled(true);
   ```

Aktivasi hanya mengubah status job. Tick berikutnya memanggil worker per menit,
bukan langsung pada saat SQL aktivasi dijalankan. `cron.job` harus menampilkan
tepat satu job `binahub-report-recovery` milik `postgres`, schedule `* * * * *`.
Jangan menyalin secret ke kolom command atau membuat job duplikat lewat dashboard.

## Apa yang diproses dan tidak diproses

- GET `/api/assessment/worker` dengan Authorization Bearer existing: pemulihan
  diagnosis tim/organisasi, email hasil individu, serta analisis/email rekomendasi
  program. Submission tetap memulai pekerjaan langsung, tidak menunggu Cron.
- Retensi PE gratis existing ikut worker tersebut; SQL89 tidak mengubah durasi
  atau aturan retensi, tidak menyentuh jawaban/skor/izin saat pemasangan.
- **Tidak** memanggil follow-up/outreach, kampanye, event AMS, webhook Mayar atau
  retensi PETA. Job retensi PETA existing tetap bulanan di `vercel.json`; tidak
  dimigrasikan atau diduplikasi oleh SQL89.
- Tidak mengisi pekerjaan historis baru, tidak membuka pembayaran, dan tidak
  mengubah program PFA2026 secara langsung. Namun worker global dapat mengambil
  pekerjaan due yang memang sudah ada; periksa cakupannya sebelum aktivasi.

## Pantau dan hentikan

```sql
-- Aman dibagikan tanpa credential/body jawaban; tetap simpan sebagai data operasi.
select binahub_scheduler.report_cron_status();

-- Jeda. Request yang sudah dikirim/proses provider yang berjalan tidak dibatalkan.
select binahub_scheduler.set_report_cron_enabled(false);
```

Di dashboard Supabase → Cron, pilih job → History. **Sukses Cron hanya berarti
SQL/pengantrean HTTP berhasil**, bukan laporan selesai atau email diterima.
Periksa `httpStatus`/`httpState` dan Admin → Operations → Kesiapan layanan:
heartbeat harus baru, antrean due bergerak, hasil tersimpan dan penerima internal
benar-benar menerima email. `accepted_by_worker` bukan klaim seluruh tahap sukses;
worker dapat mengembalikan200 dengan heartbeat `degraded`.

- `never_queued`: job belum aktif/dipanggil; wajar setelah pemasangan.
- `pending_or_unknown`: request antre/in-flight atau respons sudah kedaluwarsa;
  bukan sukses. Jika lama, periksa pg_net dan heartbeat.
- `http_error`401/403: cocokkan secret dan deployment/domain; jangan menampilkan
  secret atau header untuk troubleshooting.
- `timeout`/`transport_error`/5xx: periksa DNS/SSL, runtime/limit hosting dan
  log aman. Jangan meningkatkan batch sebelum mengetahui penyebabnya.
- Antrean `uncertain`/`failed` tetap memerlukan rekonsiliasi/review, bukan replay
  email otomatis. Lease dan backoff per pekerjaan yang sudah ada tetap berlaku.

SQL89 membatasi enqueue berulang minimum55 detik, menunggu respons in-flight
hingga3 menit dan tidak menumpuk request jika pg_net belum menguras request
sebelumnya. Setelah restart/hasil HTTP hilang, pemanggilan bisa diulang;
ini **bukan jaminan exactly-once**. Idempotensi/lease pekerjaan tetap diperlukan.
HTTP timeout125 detik mengakomodasi batas worker120 detik; platform dapat memiliki
batas lebih rendah. Ukur durasi dan backlog setelah aktivasi.

Status hanya menyimpan request ID terakhir dan waktu, tanpa riwayat payload.
pg_net menyimpan Authorization plaintext sementara dalam antrean: akses SELECT
PUBLIC/anon/authenticated ke tabel antrean dicabut oleh SQL89. Jangan memberi
akses ulang atau membuat fungsi/view publik untuk membaca antrean/Vault.
Credential masih dapat dibaca oleh operator database berhak tinggi; Vault bukan
perlindungan terhadap admin database. Jangan ekspor headers/body response.

Log native `cron.job_run_details` tidak dibersihkan otomatis oleh extension.
Tinjau ukurannya secara berkala; jika perlu pembersihan, batasi ke **job ini** dan
umur log yang disepakati. SQL89 tidak menambah pekerjaan penghapusan apa pun.

## Reapply, rollback dan batas bukti

- Reapply SQL89 mempertahankan job ID, status aktif/jeda dan request terakhir;
  tidak menyalakan ulang job yang sudah dijeda. Jadwal/command yang berubah atau
  nama job pada owner/database lain ditolak agar tidak menimpa pengaturan lain.
- Rollback operasional cukup `set_report_cron_enabled(false)`. Jangan menghapus
  extension, Vault, job lain atau tabel antrean laporan untuk menjeda scheduler.
- Regresi lokal memakai PostgreSQL PGlite untuk PL/pgSQL, role, transaksi,
  konfigurasi dan pengantrean; `pg_cron`/`pg_net`/Vault ditiru dengan fixture.
  Ini bukan bukti extension native, scheduler produksi atau pengiriman berjalan.
- Source SLJ hanya referensi pola; tidak ada secret/configuration project SLJ
  disalin. Tidak ada login database produksi atau provider berbayar dalam tes.

Verifikasi lokal 4 November:46 regresi terarah lulus; seluruh unit test API
1165 lulus/6 dilewati (152 file lulus/4 dilewati), TypeScript/lint dan build
produksi lulus. Tes extension memakai fixture, bukan extension native Supabase.
Aktivasi, domain/deployment dan pengiriman nyata belum diverifikasi.

Acuan: [Supabase Cron](https://supabase.com/docs/guides/cron),
[pg_net GET](https://supabase.com/docs/guides/database/extensions/pg_net),
[Vault](https://supabase.com/docs/guides/database/vault).
