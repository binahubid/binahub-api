# Personal Effectiveness: tahap 2

Keputusan produk dikonfirmasi pengguna pada 13 Oktober 2026: CEO menyetujui rekomendasi tahap 1 dan juga merupakan ahli bidang yang menyusun/menelaah soal. Tidak menunggu reviewer eksternal sebagai prasyarat implementasi. Catatan review disimpan sebagai `ceo_reviewed`, bukan klaim review independen atau validasi statistik.

## Yang disiapkan

- Website mengarahkan tombol mulai ke `/diagnose` di app. Pengguna memilih Tim/Organisasi atau Individu. Jalur organisasi 49 soal tidak berubah; query kampanye dipertahankan pada jalur organisasi.
- Individu memakai akun Supabase yang sudah ada. Login, signup dan OAuth kembali ke `/insight/individual` melalui path internal yang divalidasi. API memverifikasi token dan email, bukan mempercayai ID/role dari browser.
- Tiga Area gratis: PE-02 Self-Development, PE-04 Adaptability, PE-06 Pressure Management. Seluruh 12 SR dan 6 SJT ditampilkan, tanpa meminta atau membuka soal Area berbayar.
- Konteks peran/tujuan, relevansi pekerjaan per Area dan persetujuan pemakaian data. Hasil tidak otomatis dikirim ke perusahaan atau CEO.
- Draft disimpan setiap pilihan, dengan status simpan, submit terkunci, peninjauan kelengkapan, resume dan pemulihan konflik versi. Browser hanya menyimpan UUID attempt per akun, bukan jawaban/hasil. Saat akun berganti atau logout, data tampilan dibersihkan.
- Hasil web langsung dari scoring database, tanpa menunggu AI. Metode terpisah; tidak ada overall, level/norma, label ahli/pemula atau persentase penguasaan.
- Kandidat fokus latihan memakai relevansi yang dipilih peserta terlebih dahulu, kedua metode harus cukup bukti, dan tidak memilih Area kurang relevan. Bila relevansi setara, pola SJT lalu SR menentukan urutan tanpa cutoff baru. Urutan merupakan hipotesis latihan, bukan diagnosis kesenjangan. Rubrik operasional ini berversi dan masih perlu dievaluasi dalam pilot.
- Praktik konkret mengacu pada key action pengalaman kerja yang paling jarang dilaporkan. Tidak memakai rationale kunci SJT sebagai umpan balik peserta.
- Solusi katalog terkait hanya berasal dari crosswalk approved dan Core yang cocok. Hanya produk Self Transformation/modul publik ready, aktif dan non-mock. Nama/isi katalog CEO tidak diganti AI; harga tidak dikirim. Solusi berupa opsi untuk dibahas, bukan klaim program pasti tepat hanya dari skor.
- Hapus jawaban/hasil tersedia bagi pemilik akun. Retensi enam bulan, akses kedaluwarsa ditutup. Worker `/api/assessment/worker` yang sudah ada juga menghapus record kedaluwarsa per batch; tidak ada credential atau scheduler baru.

## Instalasi

1. SQL 64 lengkap/privat harus sudah memasang `BINAINSIGHTS-PE-V1` versi `1.0.0-draft.1`. SQL 65 menolak pemasangan bila sumber privat belum ada.
2. Jalankan `supabase/migrations/0065_personal_effectiveness_delivery.sql`. Ini migration tanpa bank soal/kunci, aman masuk Git. Registrasi source lama tetap immutable, tidak perlu menjalankan ulang SQL 64. SQL 65 merekam persetujuan CEO, enam crosswalk dan kebijakan tiga gratis; tidak membuat attempt peserta atau mengirim email.
3. Deploy API 0.33.0, app 0.33.0 dan website 0.2.28. Tidak ada env/secret baru.
4. Pastikan scheduler worker asesmen yang sudah ada tetap memanggil endpointnya. Kredensial `FOLLOW_UP_CRON_SECRET` tetap berlaku. Bila worker belum dijadwalkan, akses tetap berakhir setelah enam bulan tetapi pembersihan fisik otomatis belum berjalan; sambungkan scheduler yang ada, tidak memerlukan n8n.
5. Buka website → diagnosis → pilih Individu → masuk dengan akun sendiri. Cek bahwa ada tiga Area/18 soal, simpan satu jawaban, reload, lanjutkan, tinjau, submit, reload hasil. Jangan mengirim email atau membuat transaksi nyata untuk pengujian ini.

Endpoint:

```text
GET    /api/assessment/individual/availability  readiness publik, tanpa soal/data peserta
GET    /api/assessment/individual               definisi gratis, token terverifikasi
POST   /api/assessment/individual               mulai dengan consent/context
GET    /api/assessment/individual/:id           draft/hasil milik sendiri
PATCH  /api/assessment/individual/:id           snapshot save/submit
DELETE /api/assessment/individual/:id           hapus milik sendiri
```

Semua respons pribadi `no-store`/noindex. Tabel RLS ditutup dari anon/authenticated; service-role row writes juga ditutup, wajib RPC. Backend menetapkan owner dari token. Data yang ditampilkan SQL/DTO hanya tiga Area entitled; mengirim jawaban Area lain ditolak server. ID hasil bukan izin akses.

## Batas tahap ini

- Public pilot pengembangan, bukan klaim bahwa instrumen telah tervalidasi untuk seleksi/promosi. Kompetensi gratis dan crosswalk disahkan, tetapi hanya enam kompetensi PE yang tersedia, bukan seluruh 26.
- Belum membuka paket enam Area berbayar, checkout/webhook atau proposal individu. Harga masih belum ditetapkan. Tidak menambahkan harga perkiraan sebagai pengganti keputusan CEO.
- Belum ada laporan email/PDF individu baru atau penjadwalan follow-up hasil individu. Laporan web menggunakan template pengembangan sementara yang berversi, bukan mengklaim format final CEO sudah tersedia.
- Hasil individu tidak masuk lead/pipeline, tidak mengubah skor minat, dan tidak otomatis disalin ke AMS/perusahaan. Integrasi tersebut perlu izin serta tujuan yang sesuai.
- Review statistik, format final laporan/email/proposal dan keputusan komersial tetap merupakan pekerjaan berikutnya.

## Kebersihan Git

App, API dan website mengabaikan secret/env (kecuali `.env.example`), data privat, sumber bank soal CEO, seed privat, ekspor/backup lokal, output, screenshot, laporan pengujian dan file sementara. Source code, migration publik, lockfile dan tes sintetis tetap dilacak.

Satu paket review DOCX hasil generasi pada app dan dua PDF contoh hasil generasi pada API dikeluarkan dari Git index, tanpa menghapus salinan lokal. Tidak mengubah atau menghapus sejarah Git. `.gitignore` tidak dapat menghapus file rahasia yang telanjur dipublikasikan dalam commit lama; penanganan kasus itu memerlukan audit/rotasi tersendiri.

## Bukti verifikasi

Tes PostgreSQL PGlite memakai instrumen sintetis, memeriksa persetujuan/kebijakan, privasi, RLS/RPC, ownership, draft, NA/nol/missing, pembatasan gratis, submit/replay serta retensi/penghapusan. Tes route memakai auth/database mocks untuk boundary HTTP. Tes React memeriksa consent, save/review/submit, konflik dan hasil nol versus bukti tidak cukup.

Playwright memeriksa desktop dan ponsel: choice, privacy signed-out, serta alur 18 soal/resume/hasil dengan sesi dan API sintetis. Ini bukan bukti akun/pembayaran/email produksi telah diuji. Produksi belum diubah melalui SQL oleh developer; pemasangan dan verifikasi pascadeploy tetap diperlukan.
