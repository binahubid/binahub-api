# Workspace penjualan - panduan admin dan deployment

Rilis pasangan: app **0.29.0**, API **0.29.0**, website **0.2.27**.
SQL **60, 61, 62** wajib sebelum deploy API. Tidak ada email nyata dikirim saat migrasi.

## Operasi dari satu halaman

Buka **Akuisisi & penjualan**. Prioritas menunjukkan tindakan berikutnya berdasarkan status yang tercatat, bukan keputusan AI. Pilih kartu untuk membuka konteks inquiry, assessment atau proposal tanpa berpindah workspace. Inbound, outbound, klien/proposal, tindak lanjut, peluang dan konsultasi berada pada navigasi yang sama.

### Outbound dengan daftar sendiri

1. Pilih kampanye yang ada, atau **Buat kampanye**: isi nama dan pilih sumber data.
2. **Tambah target**: tempel email atau unggah CSV, periksa preview, lalu konfirmasi daftar yang boleh dipakai dan simpan. Persetujuan ini menjadi catatan audit; validasi tetap berjalan di server. Sumber berbasis consent meminta konfirmasi izin nyata untuk email berstatus belum diketahui; opt-out tidak pernah ditimpa.
3. Pilih penerima **Siap dipilih**, periksa preview di samping daftar, lalu **Tinjau & kirim**.
4. Dialog menampilkan penerima yang benar-benar dipilih. **Konfirmasi pengiriman** mengaktifkan kampanye bila diperlukan dan menyimpan antrean sekaligus. Antrean versi lama tidak dilepas.
5. Pantau Aktivitas. Boleh berpindah halaman sesudah antrean tersimpan.

**Kirim email uji** tersedia tetapi opsional; hanya akun admin peminta yang menerima uji.
Untuk uji pertama gunakan satu akun internal yang diizinkan, bukan seluruh daftar.
Batch lama yang belum ditinjau masih perlu diperiksa; batch baru tidak meminta persetujuan kedua.
Data/sumber/template yang belum siap tidak dianggap siap secara otomatis.

### Jeda atau batas penerima

Buka **Pengaturan lanjutan** hanya bila perlu: jeda kampanye, batasi daftar penerima, atau pilih jam kerja.
Mode normal memakai daftar yang disetujui dengan validasi individual dan suppression.
Simpan pengaturan membatalkan pekerjaan lama yang masih mengantre; resume tidak mengirim ulang backlog.
Tidak perlu mengubah OUTBOUND_EMAIL_ENABLED, FOLLOW_UP_DRY_RUN atau release Pilot di Vercel untuk operasi rutin.

### Follow-up

Di **Tindak lanjut**, tombol **Aktifkan** / **Jeda** adalah kontrol operasional.
Aktivasi berlaku bagi inquiry/assessment baru setelah waktu aktivasi. Resume membuat batas waktu baru; backlog sebelumnya tidak dilepas.
Sistem tetap memeriksa jadwal, template individual, pengiriman awal, pause, booking konsultasi, peluang aktif, unsubscribe/suppression, dan batas tiga follow-up lintas kanal.
Ini masih aturan deterministik; AI agent belum dibuat. Membuka dashboard tidak memicu pengiriman.

## Setup teknis sekali, bukan tiap kampanye

1. Terapkan SQL 61 lalu 62 setelah SQL 60. SQL 61 membuat kontrol paused; job antrean versi lama tidak dapat diklaim. SQL 62 hanya mengantrekan assessment baru, tidak mengirim assessment historis.
2. Deploy API terlebih dahulu, kemudian app dan website. Jangan mengaktifkan UI versi baru terhadap API lama.
3. Koneksi database, sender Resend, template approved/non-mock, URL HTTPS, secret tracking dan unsubscribe harus valid. Tidak ada secret baru untuk tombol pengaturan aplikasi.
4. Cron outbound yang ada tetap memakai GET /api/automation/outbound-email dengan Bearer OUTBOUND_EMAIL_CRON_SECRET. Cron follow-up tetap memakai /api/admin/follow-up dengan FOLLOW_UP_CRON_SECRET. Credential backend tidak pernah memakai NEXT_PUBLIC_*.
5. Hubungkan GET **/api/assessment/worker** ke scheduler backend (misalnya n8n) setiap menit memakai Bearer **FOLLOW_UP_CRON_SECRET** yang sudah ada. Satu invocation memproses satu assessment; naikkan frekuensi/concurrency sesuai trafik, claim database mencegah penggandaan. Tidak perlu toggle mode simulasi/live untuk job hasil yang diminta klien.
6. Optional emergency stop OUTBOUND_EMAIL_FORCE_DISABLED=true tersedia bagi tim teknis. Kondisi normal false/unset; admin memakai kontrol aplikasi.

Sumber outbound masih harus memiliki dasar pemrosesan yang benar, pemilik data, retensi dan pemberitahuan privasi. Ini setup legal/data sekali per sumber, tidak boleh difabrikasi untuk mengejar jumlah klik.
Kontrol workflow lain (operations, discovery, transformation) tidak diubah oleh flag baru ini.

## Diagnosis cepat dan pemulihan

API memvalidasi dan menyimpan assessment beserta job dalam transaksi, lalu membalas 202. Browser menampilkan animasi sekitar lima detik dari submit, kemudian konfirmasi penerimaan. Jika penyimpanan/koneksi belum selesai pada lima detik, halaman tetap menunggu konfirmasi yang benar, bukan mengklaim data diterima.
Setelah API menerima, browser dapat ditutup; after() memulai analisis, PDF dan email. Scheduler mengambil job tertunda bila worker terputus.
Analisis/PDF gagal dijadwalkan ulang maksimal tiga percobaan. AI hasil yang sudah tersimpan tidak dihitung ulang saat recovery.
Status emailing yang terputus menjadi uncertain, bukan otomatis dikirim ulang. Periksa Resend/arsip sebelum pengiriman ulang manual.
Terima job berbeda dari menerima email: hasil baru dinyatakan terkirim setelah penyedia email menerimanya dan bukti disimpan.

## Verifikasi sebelum pengiriman nyata

- Jalankan typecheck/test/build semua repo; preview lokal memakai data contoh dan tidak menghubungi provider.
- Pastikan consent dan status opt-out benar pada satu target internal.
- Uji konfirmasi kirim, pause sesaat sebelum provider, retry permintaan, dan suppression.
- Diterima penyedia bukan bukti masuk inbox, dibaca atau diklik.
- Migrasi/deploy ini tidak otomatis mengirim ke daftar pengguna yang sudah ada.
