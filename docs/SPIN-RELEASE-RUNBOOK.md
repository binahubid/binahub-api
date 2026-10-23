# Rilis Discovery organisasi / SPIN

Update 23 Oktober 2026. Target API 0.39.0/app 0.41.0. Pengguna mengonfirmasi SQL
71 sudah dijalankan dan mengizinkan commit, push serta deployment. Keberhasilan
hosting dan kiriman tetap diverifikasi terpisah, bukan dianggap selesai dari push.
Frontend app-binahub di Hostinger; API binahub-api di Vercel. Tidak perlu n8n
atau provider/secret/toggle baru untuk SPIN.

## Urutan rilis satu kali

1. Cadangkan database sesuai prosedur operasional. Jalankan
   `supabase/migrations/0071_spin_discovery.sql` pada database API yang sama.
   SQL 70 merupakan prasyarat existing, bukan perintah mengulang cleanup.
   SQL 71 menambah tabel/fungsi/RLS SPIN; tidak menghapus data, mengubah soal PE,
   setting pengiriman global, atau program TBOS nyata.
2. Deploy repo API, lalu app. Deploy API lebih dulu agar formulir baru tidak
   mengarah ke endpoint yang belum ada. Tidak perlu menjalankan ulang SQL 64–70.
3. Buka `https://app.binahub.id/discovery`. Definisi tersedia hanya bila tabel
   SPIN dan konfigurasi sender existing dapat dibaca. Jangan menampilkan form
   seolah sudah aktif jika API belum siap. `GET /api/discovery/spin` mempunyai
   `available`; bukan pengujian domain pengirim, provider model atau scheduler.
4. Verifikasi pengirim existing, domain email, provider AI yang dipilih admin,
   URL app dan booking Cal.com bila digunakan. Jangan menyalin key ke chat,
   frontend, source atau log. Tidak menambahkan secret SPIN tersendiri.
5. Verifikasi scheduler existing benar-benar memanggil
   `GET /api/assessment/worker` dengan kredensial scheduler existing.
   Pemrosesan awal dijadwalkan server setelah submit; scheduler memulihkan
   pekerjaan yang terputus. Jangan mengaku scheduler hidup dari env saja.
   Jangan memanggil worker global sekadar smoke test jika ada antrean assessment
   lain yang tidak dimaksudkan untuk diproses. Jangan aktifkan follow-up global
   lama sebagai efek samping rilis ini.

## Satu uji pengiriman yang diizinkan

Pengguna telah mengizinkan **admin@binahub.id**, satu laporan dengan kebutuhan
sintetis setelah SQL/deploy siap. Belum dikirim pada saat runbook ditulis.

1. Isi form dengan organisasi bernama `Uji internal SPIN — data sintetis`,
   tanpa nama pekerja/data klien. Contoh: 20 peserta, workshop satu hari di
   Jakarta, masalah rapat tidak terarah, hasil keputusan/PIC/tindak lanjut jelas.
2. Konfirmasi ringkasan, pilih tindak lanjut relevan dan kirim ke alamat di atas.
   Izin pemasaran boleh tetap kosong. Setelah layar permintaan diterima, tutup
   browser untuk menguji proses server. Catat ID pengisian secara privat.
3. Admin → Akuisisi & Penjualan → Klien & proposal → Discovery: harus ada satu
   pengisian dan satu relasi lead/inquiry, bukan duplikat akibat klik ulang.
4. Periksa laporan cocok dengan kebutuhan, SS-32 tidak dipilih, klaim/komponen
   berasal dari katalog, harga/durasi/peserta masuk akal, dan kasus kompleks
   tidak dipaksakan menjadi pelatihan. Periksa pajak tidak menjadi total buatan.
   Validasi ID katalog otomatis bukan bukti bahwa pilihan AI sudah relevan.
5. Status email hanya `sent` setelah provider mengembalikan ID. Periksa inbox/
   spam internal, PDF dan enam bagian yang sama dengan laporan web.
   `sent` berarti provider menerima, bukan jaminan terkirim ke inbox.
6. Klik tombol buka laporan dari email, pastikan tidak meminta login. PDF
   diunduh lewat sesi privat; ulangi tautan sekali pakai harus ditolak.
   Gunakan pemulihan tautan hanya bila memang membutuhkan email kedua; itu
   bukan bagian uji satu kiriman otomatis awal.
7. Pastikan hasil/field internal, kontak lain dan secret tidak masuk HTML/PDF.
   Periksa inquiry follow-up memakai waktu kiriman nyata dan tidak menduplikasi
   percakapan aktif. Status peluang tidak boleh kembali ke tahap awal.

## Penanganan kegagalan tanpa kirim buta

- Report queued/failed: worker mengklaim dengan lease 3 menit, maksimal tiga
  percobaan, jeda lima menit. Tombol admin meminta pemrosesan antrean pending;
  bukan reset limit atau bypass konfigurasi. Setelah limit habis perlu diagnosis
  teknis, bukan menekan tombol berkali-kali.
- Email pending: maksimal lima percobaan, payload/recipient/sender/URL/PDF dan
  idempotency key sama. Penerimaan provider yang tidak tersimpan harus direkonsiliasi.
- Setelah 23 jam ketidakpastian: status uncertain, tidak mengirim ulang buta
  melewati jendela idempotensi. Periksa provider ID/log di dashboard email.
  Tidak ada tombol mark-sent atau pengiriman massal tanpa kepastian.
- API gagal: hanya kode aman dicatat, tidak menyalin jawaban/kontak/provider
  response ke log. Draft writer tidak dapat membuka report dengan capability
  draft; hasil menggunakan akses tersendiri.

## Data, batas dan bukti

- Bisnis SPIN disimpan tanpa penghapusan otomatis berdasarkan usia sesuai
  keputusan user. Akses draft 30 hari, tautan hasil 48 jam sekali pakai, sesi
  hasil 30 menit. Ini akses, bukan pemusnahan record. Hak data melalui admin.
- Capability draft berada pada sessionStorage tab, bukan sinkronisasi draft
  lintas perangkat. Hasil/PDF/email memakai snapshot yang tidak berubah.
- AI menerima bukti kebutuhan terbatas tanpa field kontak; penyaringan pola
  bukan jaminan anonimitas. Notice pemrosesan dan pemasaran terpisah. Belum
  ada tinjauan legal formal atau DPA baru yang dinyatakan selesai.
- 699 tes API lulus, tiga dilewati pada suite penuh. Cleanup diuji di database
  lokal dengan default script preview; tidak dieksekusi ulang di produksi.
  SQL 71 diuji PGlite dan pengguna mengonfirmasi eksekusi target. Pengujian
  ini bukan bukti model nyata atau email nyata.
- App 331 tes lulus; browser memakai mock API lokal. Pilot pengguna riil dan
  target 8–10 menit belum diukur. Aturan konservatif sumber tercatat di plan app.
- Strix/Docker tersedia tetapi konfigurasi model Strix belum tersedia; tidak
  menjalankan pentest, membuat akun cloud atau mengunggah kode.
- Harga paket SS-11, tambahan/scope nonstandar dan proposal custom meeting
  tetap konsultasi/tahap terpisah. Tidak mengaktifkan pembayaran individu.
