# R06 — kesiapan database, antrean dan aktivitas pemroses laporan

API0.47.5 / app0.51.2. SQL81 menambah observabilitas, bukan aktivasi layanan.
Pemilik melaporkan SQL81 berhasil diterapkan pada 2 November2026; laporan ini
bukan hasil inspeksi langsung terhadap database/deployment produksi.

## Tiga pemeriksaan berbeda

| Pemeriksaan | Arti | Bukan bukti |
| --- | --- | --- |
| GET `/api/health` publik | Proses HTTP dapat menjawab; versi/revisi tersedia | Database, AI, email, scheduler atau antrean sehat |
| GET `/api/admin/service-health` | Overview admin: database/schema dapat dibaca atau bukti belum tersedia; status operasional terpisah | HTTP200 overview sendiri bukan tanda siap; periksa field `health.readiness` |
| HEAD `/api/admin/service-health` | Probe database/schema:200 jika snapshot valid,503 jika tidak; tetap memerlukan admin | Aktivitas worker, analisis AI berhasil atau email sudah diterima |

Detail antrean/heartbeat tidak tersedia untuk anon atau peserta. Respons tidak
dicache; tidak mengandung kontak, jawaban, PDF, token akses, ID peserta, key
provider atau error mentah. Tidak ada panggilan provider untuk pemeriksaan ini.

## Yang terlihat di Admin → Operations

- Antrean diagnosis tim/organisasi (`assessment_jobs`).
- Antrean email hasil individu (`pe_report_email_jobs`).
- Analisis rekomendasi program (`spin_submissions`, bukan draft).
- Email rekomendasi program (`spin_mail_jobs`).
- Aktivitas endpoint pemulihan `/api/assessment/worker` dan log error existing.

Hitungan SQL mencakup seluruh antrean relevan, bukan50/100 entri terbaru atau
halaman daftar admin yang sedang dibuka. Hanya agregat dan timestamp yang keluar.
Pekerjaan selesai, email terkirim dan draft SPIN tidak menjadi backlog aktif.
Retry yang belum jatuh jadwal tidak dihitung terlambat.

Status yang harus dibedakan:

- `never_seen`: belum ada catatan pemanggilan endpoint recovery. Bukan klaim
  worker mati; pengiriman awal formulir dapat bekerja lewat jalur after-response.
- `running` / `recent`: ada pemanggilan baru. Bukan bukti Cron terpasang atau
  semua pekerjaan/email berhasil. `degraded` menandai tahap gagal, setup belum
  tersedia, atau pekerjaan dikembalikan untuk retry/review; `failed` untuk
  kegagalan utama endpoint recovery.
- `stale`: pemanggilan terakhir lebih dari10 menit; jangan menganggap scheduler
  aktif hanya karena credential tersedia atau tabel ada.
- `overdue`: pekerjaan menunggu yang sudah melewati jadwal lebih dari10 menit.
- `stalled`: lease email/SPIN berakhir (atau kosong pada status processing),
  atau timestamp proses tim melewati20 menit sesuai aturan recovery SQL62.
- `review`: failed/uncertain. Hasil pengiriman mungkin tidak pasti; rekonsiliasi
  dulu, bukan langsung kirim ulang. Monitoring tidak melakukan retry tersebut.

Ambang10 menit adalah deteksi awal operasional, bukan SLA yang dijanjikan ke
klien. Snapshot di atas2 menit atau metadata tidak valid ditolak sebagai unknown.
UI memperbarui setiap60 detik saat terbuka/aktif, saat kembali ke tab, dan secara
manual; request dibatasi8 detik. Kesalahan refresh tidak mempertahankan label
sehat dari bukti lama. Mobile menggunakan ringkasan per antrean, bukan tabel lebar.

## Heartbeat yang aman saat deployment

SQL81 hanya membuat satu baris heartbeat terbaru, bukan log tanpa batas. UUID
run mengikat akhir proses ke awal yang sesuai. Selesainya run lama tidak dapat
menimpa run yang lebih baru. `succeeded_at` tetap menyimpan sukses terakhir.
Fungsi RPC hanya service_role; tabel tidak mendapat hak browser atau direct
write service_role. Ringkasan tidak mengembalikan run token.

Pencatatan heartbeat bersifat best effort (timeout2 detik). Sebelum SQL81 atau
saat pencatatan gagal, recovery existing tetap berjalan. Kegagalan telemetry
tidak mengklaim pekerjaan sudah gagal/selesai, dan tidak memicu email tambahan.
Pembacaan snapshot dibatasi5 detik dan kegagalan dilabeli unknown, bukan nol.
GET overview tidak menulis heartbeat, mengambil lease, mengubah izin/retensi,
mengirim email atau menerapkan purge.

## Aktivasi dan cakupan yang belum selesai

- Tidak ada env baru. Credential recovery existing `FOLLOW_UP_CRON_SECRET`
  tidak diubah. Worker retensi PETA bulanan tetap terpisah, bukan heartbeat ini.
- Scheduler tetap menunggu migrasi Vercel BinaHub + Pro. SQL81 dan push tidak
  memasang Cron, memanggil endpoint recovery atau membuka outreach.
- Peringatan hanya tampil saat dashboard admin dibuka. Tidak ada pengiriman
  email/WhatsApp alarm; kanal/penerima harus disetujui sebelum aktivasi eksternal.
- Probe ini tidak menguji quota/provider AI, penerimaan email, resource Hostinger,
  backup, DB/Storage AMS, antrean event AMS, atau antrean outreach/event lainnya.
  Operational Assurance existing untuk workflow lama tidak digantikan.
- Halaman status publik AMS diperbaiki terpisah di web0.10.3: versi patch tidak
  lagi dinilai gagal karena pembanding0.10.1; sukses hanya klaim pemeriksaan dasar,
  bukan kesiapan database/antrean. API AMS tetap0.11.2.

## Verifikasi dan tindak lanjut operator

Tes PGlite memakai tabel/pekerjaan sintetis:125 item di satu antrean, future retry,
lease aktif/kedaluwarsa, item selesai/draft, izin RPC, reapply dan run overlap.
Tes route/helper menguji401/403/500, metadata stale, setup hilang, timeout/transport,
heartbeat gagal dan partial worker failure. Tidak mengakses data program nyata.
UI menggunakan fixture lokal dan Chromium desktop/mobile; bukan login produksi.

Setelah CI/deployment diverifikasi, buka halaman admin dan periksa timestamp
overview. Wajar melihat heartbeat belum tercatat selama scheduler ditunda.
Jangan memanggil worker produksi hanya untuk membuat indikator hijau: endpoint
tersebut memang dapat memproses antrean nyata. Uji aktivasi kelak harus memakai
data/penerima sintetis yang disetujui dan membuktikan tidak ada pengiriman ganda.

Tidak ada pentest Strix baru atau klaim seluruh sistem produksi siap di batch ini.
