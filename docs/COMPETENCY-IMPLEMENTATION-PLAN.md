# Implementasi kompetensi dan diagnosis BinaHub

Keputusan pengguna pada 10 Oktober 2026: mulai dari kamus kompetensi berdasarkan katalog CEO. Target penyelesaian 21 Oktober 2026. Soal, indikator, metode penilaian, dan format dokumen adalah kewenangan CEO; tim pengembangan tidak mengisinya dengan asumsi atau keluaran AI.

## Keputusan produk

- Diagnosis Tim/Organisasi dan Individu akan menjadi dua jalur terpisah setelah pengguna menekan tombol diagnosis di website.
- Tim/Organisasi mendapat diagnosis lengkap secara gratis.
- Individu mendapat tiga kompetensi tetap secara gratis. CEO belum menentukan ketiganya. Kompetensi lain berbayar; harga, paket, akses setelah pembayaran, dan aturan pengulangan masih perlu ditetapkan.
- Harga katalog tidak ditampilkan di website publik. Judul solusi tetap berbahasa Inggris. Copy isi mengikuti sumber CEO, dengan terjemahan Indonesia yang setara.
- Proposal untuk klien tidak memakai istilah internal seperti standar/custom atau katalog dasar dalam judul dan narasi publik.
- Skor minat penjualan tidak dicampur dengan skor kompetensi.

## Tahap yang dibangun sekarang

SQL 63 menambahkan framework versi `signature-2026-competency-v1`, 26 nama kompetensi, dan 189 hubungan pada 27 solusi (81 Core dan 108 Secondary). Nama, urutan pemetaan per solusi, dan judul diambil dari dokumen `BinaHub_Signature_Solutions_Catalog_DETAILED_2026_REVISED_COMPETENCY.docx`. SHA-256 sumber tersimpan bersama framework. Kode COMP merupakan ID internal, bukan kode resmi CEO.

Core dan Secondary adalah peran pengembangan kompetensi dalam modul, bukan bobot penilaian. Definisi serta indikator kosong dengan status menunggu CEO. Kamus hanya dapat dibaca melalui API admin; bukan sumber skor aktif. Versi kamus terpisah dari versi komersial katalog agar aturan proposal yang sudah berjalan tidak berubah.

Admin dapat membuka Katalog Produk → Kamus kompetensi, mencari berdasarkan nama kompetensi, judul solusi, atau kode SS, dan melihat hubungan Core/Secondary. Tidak ada tombol aktivasi, pembuatan soal, pembayaran, atau penyuntingan definisi pada tahap ini.

### Instalasi tahap fondasi

1. Pastikan SQL 59 telah memasang SS-01 sampai SS-27 dengan versi katalog `signature-2026-ceo-v1`. SQL 63 akan membatalkan seluruh transaksi jika prasyarat tidak terpenuhi.
2. Jalankan `supabase/migrations/0063_competency_dictionary.sql` melalui workflow migrasi yang digunakan tim. Ambil backup sesuai prosedur deployment sebelum perubahan skema produksi.
3. Deploy API 0.30.0, lalu app 0.30.0. Website dan AMS tidak membutuhkan deployment untuk tahap ini.
4. Masuk sebagai admin dan buka `/admin/catalog/competencies`. Harus terlihat 26 kompetensi, 27 solusi terhubung, dan penggunaan diagnosis “Belum diaktifkan”.
5. Pastikan diagnosis, katalog publik tanpa harga, dan proposal lama tetap berjalan. Tidak ada antrean assessment/email yang dibuat oleh migrasi ini.

SQL dapat dijalankan ulang tanpa menghapus atau menimpa definisi yang kelak diberikan CEO. Modul yang terhubung tidak boleh dihapus permanen; arsip tetap tersedia melalui alur katalog. Data sumber dengan hash berbeda harus menggunakan versi framework baru.

Kode COMP pada manifest ini dibekukan. Revisi berikutnya harus mempertahankan kode kompetensi yang sama dan memberikan kode baru untuk kompetensi tambahan, bukan menomori ulang berdasarkan urutan alfabet.

## Kontrak yang disiapkan untuk tahap berikutnya

Bank soal akan memakai identitas dan versi tersendiri, jenis diagnosis, kode kompetensi yang diukur, aturan penilaian CEO, serta status publikasi. Assessment menyimpan snapshot versi soal, framework, metode skor, dan format laporan. Assessment historis tidak otomatis dinilai ulang.

Hasil baru akan menyimpan skor/evidence per kompetensi dan coverage jawaban, terpisah dari skor minat lead. Jangan mengubah tujuh Area diagnosis saat ini menjadi 26 skor kompetensi dengan asumsi pemetaan satu-ke-satu. Modul observasi TBOS yang sudah ada juga tidak diganti diam-diam.

Rekomendasi katalog memadukan kesenjangan kompetensi yang benar-benar diukur, Core/Secondary, tujuan, audiens, dan konteks kebutuhan. Pemetaan yang sama dapat muncul pada solusi berbeda: Adaptive Leadership dan Change & Organizational Agility memiliki Core sama tetapi konteks pengguna berbeda. Adaptasi saja tidak cukup untuk menawarkan program AI. Kompetensi spiritual tidak boleh dipakai untuk menyimpulkan agama pengguna; program terkait hanya relevan jika konteksnya diminta secara eksplisit.

Jawaban self-report individu tidak dinyatakan sebagai kemampuan terverifikasi atau diagnosis klinis. Jawaban satu orang tentang organisasi harus tetap ditampilkan sebagai perspektif responden, bukan hasil seluruh karyawan. Coverage jawaban tidak boleh diberi label keyakinan psikometrik 100% tanpa dasar validasi.

Web hasil, email, dan PDF memakai satu model hasil serta template CEO yang berversi. Pembatasan paket individu diterapkan di backend untuk hasil web, PDF, email, dan API, bukan sekadar menyembunyikan kartu UI. Pembukaan kompetensi berbayar memerlukan verifikasi pembayaran server-side dan pemrosesan webhook idempotent; desainnya menunggu keputusan paket/provider, bukan diaktifkan oleh SQL 63.

AMS nantinya menerima kontrak hasil berversi yang sama dengan API/app. Hak akses hasil individu dan organisasi harus dipisahkan, termasuk izin organisasi membaca hasil personal. Jangan memperluas akses hanya karena kontak berasal dari perusahaan yang sama.

## Proposal konsultasi sebagai workspace terpisah

Arahan terbaru menggantikan rencana lama “proposal custom dibuat CEO di luar sistem”. Workspace Proposal akan terpisah dari halaman Assessment. Proposal dapat terhubung ke klien, peluang, dan meeting; assessment menjadi referensi opsional, sehingga konsultasi tidak wajib dimulai dari assessment.

Alur yang dituju: buka klien/meeting → isi brief terstruktur selama konsultasi → lihat preview proposal yang terus diperbarui → konfirmasi kesepakatan → kirim/unduh proposal. Semua langkah tetap berada dalam satu workspace. Checklist hanya menampilkan pertanyaan relevan, dan jawaban disimpan otomatis agar tidak hilang saat koneksi terputus.

Contoh field dari pengguna adalah durasi hari dan indoor/outdoor. Field lain seperti peserta, lokasi, scope, deliverables, fasilitas, jadwal, pengecualian, pajak/diskon, dan syarat pembayaran masih usulan struktur; harus disesuaikan dengan template dan aturan CEO. Tidak ada nilai komersial yang dikarang AI. Kalkulasi mengambil katalog serta aturan biaya yang disepakati. Kebutuhan yang belum berharga ditandai untuk dilengkapi, bukan dianggap nol.

Draft dapat siap sebelum meeting ditutup jika isian wajib dan aturan harga lengkap. Pengiriman hanya setelah konsultan mengonfirmasi isi, penerima, harga, serta syarat. Setiap revisi memiliki versi/snapshot; proposal yang sudah dikirim tidak ditimpa. Draf baru tidak otomatis menghasilkan order, invoice, atau email. AI agent belum termasuk tahap ini.

## Dokumen dan keputusan yang masih ditunggu

- KPI kompetensi: definisi, indikator perilaku, level, dan nomenklatur final.
- Bank soal tim/organisasi dan individu, cara penilaian, threshold, penanganan jawaban tidak lengkap, dan interpretasi hasil.
- Tiga kompetensi tetap yang gratis untuk individu.
- Format hasil diagnosis Tim/Organisasi dan Individu, termasuk copy web/email/PDF.
- Format proposal Individu, Tim/Organisasi, serta proposal konsultasi/custom.
- Aturan scope dan biaya proposal konsultasi, field wajib, diskon/pajak, serta siapa yang boleh mengirim.
- Harga/paket diagnosis individu, aturan upgrade, masa akses, serta provider pembayaran.

## Rencana menuju 21 Oktober

Ini target kerja bersyarat, bukan konfirmasi semua fitur sudah siap rilis.

| Tanggal | Pekerjaan | Ketergantungan |
| --- | --- | --- |
| 10–13 Oktober | Kamus, pemetaan katalog, akses admin, pengujian fondasi, kontrak versi | Katalog terbaru tersedia |
| 14–17 Oktober | Bank soal, dua jalur diagnosis, skor dan rekomendasi, hasil web/email/PDF, template proposal | Dokumen dan aturan CEO diterima; prioritas scope disepakati |
| 18–20 Oktober | UAT lintas API/app/website/AMS, akses berbayar jika siap, uji proposal konsultasi dan regresi | Integrasi serta template sudah stabil |
| 21 Oktober | Rilis bagian yang lulus UAT dan verifikasi pascadeploy | Tidak ada bug kritis; fitur yang dokumennya belum siap tetap tidak aktif |

Disarankan dokumen inti tersedia paling lambat 14 Oktober untuk mempertahankan waktu integrasi dan UAT. Jika datang lebih lambat, prioritaskan diagnosis tim/organisasi dan jalur individu gratis yang telah disahkan; pembayaran dan proposal konsultasi tidak dipaksakan rilis dengan template/harga sementara.

## Kriteria penerimaan akhir

- Setiap skor dapat ditelusuri ke jawaban, soal, kompetensi, dan versi metode CEO.
- Rekomendasi hanya memakai evidence yang diukur dan konteks yang relevan.
- Diagnosis lama tidak rusak atau berubah makna; hasil historis menyimpan versinya.
- Individu hanya melihat kompetensi yang menjadi hak aksesnya di semua kanal.
- Hasil dan proposal web/PDF/email sesuai template CEO, tanpa jargon teknis internal atau harga publik.
- Job analisis/pengiriman tetap berjalan setelah browser ditutup, tanpa pengiriman ganda.
- Proposal konsultasi tersimpan selama meeting, dapat dipreview, dan perlu konfirmasi konsultan sebelum dikirim.
