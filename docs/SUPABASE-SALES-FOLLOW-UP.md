# Menjalankan pengingat penjualan otomatis

Supabase Cron memeriksa antrean pengingat tiap 15 menit. Worker penjualan memakai aturan, jeda, batas, dan jam kirim yang sudah diatur di Workspace Penjualan. Ini berbeda dari Cron laporan yang sudah memproses laporan diagnosis dan antrean email Portal Konsultan.

1. Di Supabase **BinaHub → SQL Editor**, jalankan `supabase/migrations/0091_supabase_sales_follow_up_cron.sql`. Job `binahub-sales-follow-up` terpasang dalam keadaan nonaktif. Pastikan API yang mendukung sumber `supabase-cron` sudah dirilis.
2. Jalankan perintah berikut untuk mengaktifkan job. Vault memakai secret `binahub_report_worker_secret` yang sudah disiapkan untuk SQL89; nilai secret tidak perlu disalin.

```sql
select binahub_scheduler.set_sales_follow_up_cron_enabled(true);
```

3. Setelah giliran Cron berikutnya, periksa status dan ringkasan pengiriman. `processed` berarti worker memproses antrean; jumlah bisa nol jika tidak ada yang layak dikirim. `outside_sending_window` berarti belum masuk jam kirim. Jika `paused_or_setup_required`, periksa pengaturan pengiriman di Workspace Penjualan.

```sql
select binahub_scheduler.sales_follow_up_cron_status();

select started_at, status, processed_count, failure_count
from public.automation_runs
where workflow_key = 'follow_up_scheduler' and trigger_source = 'supabase-cron'
order by started_at desc
limit 5;
```

Jumlah terkirim berarti penyedia email menerima permintaan. Untuk memastikan email sampai, periksa riwayat penyedia atau inbox penerima uji. Jeda otomatisasi dari Workspace Penjualan, atau hentikan job dengan `select binahub_scheduler.set_sales_follow_up_cron_enabled(false);`. Kedua tindakan tidak mengubah Cron laporan.
