# Implementasi kompetensi dan diagnosis BinaHub

Keputusan pengguna pada 10 Oktober 2026: mulai dari kamus kompetensi berdasarkan katalog CEO. Target penyelesaian 21 Oktober 2026. Soal, indikator, metode penilaian, dan format dokumen adalah kewenangan CEO; tim pengembangan tidak mengisinya dengan asumsi atau keluaran AI.

## Acuan kerja terbaru — penelaahan 21 Oktober 2026

Paket `BinaInsights_DeveloperPack_v3_Aligned_2026-10-20`, tiga transkrip meeting
dan shared chat SPIN telah ditelaah. Rencana aktif berada di repo APP:
`docs/development-journey-work-plan.md`; inventaris sumber, konflik, hasil
pemeriksaan dan dampak source ada di `docs/ceo-update-2026-10-20-review.md`.
Bagian fondasi/tanggal lama di bawah merupakan riwayat implementasi.

Persiapan source V2 kini diimplementasikan dan diuji secara lokal; lihat
[persiapan paket v3](BINAINSIGHTS-V3-PREPARATION.md). Registry fingerprint,
validator/DTO/scorer preview dan diff tersedia, tetapi registrasi database,
attempt/RPC, laporan dan pengaktifan V2 belum dilakukan. Tidak perlu menjalankan
SQL baru untuk tahap persiapan ini. SPIN tetap menunggu review pertanyaan CEO.

- Acuan baru: Dictionary V5, 34 kompetensi/empat klaster; Catalog V6,
  SS-01–SS-32 dan 173 hubungan Core/Secondary; instrumen PE V2,
  `BINAINSIGHTS-PE-V2-PILOT`, 24 SR + 13 SJT = 37 soal.
- Tiga gratis tetap PE-02/04/06 (18 soal). Tiga tambahan V2 berjumlah 19 soal
  karena Integrity mempunyai tiga SJT. Fondasi pembayaran belum mengaktifkan
  pembelian. Kamus 34 kompetensi tidak menjadi 34 skor yang sudah terukur.
- Sisa 28 kompetensi bukan kelompok khusus tim; seluruh kamus dapat menjadi
  acuan pengembangan individu maupun program bagi anggota/pemimpin tim.
  Kebutuhan tim → perilaku → kompetensi sasaran → katalog ditambahkan ke
  rencana APP; tidak menyulap tujuh Area lama menjadi skor seluruh tim.
  Pemetaan temuan–kompetensi ditelaah CEO, berbeda dari crosswalk katalog.
- Draf SPIN untuk ditinjau CEO tersedia di repo APP:
  `docs/spin-questionnaire-ceo-review.md`. Fitur belum diterapkan; pertanyaan
  dan percabangan ditinjau sebelum implementasi, bukan persetujuan tiap kirim.
- Registry/importer, validator, policy/RPC/DTO dan report perlu mendukung
  V1/V2 berdampingan. `BINAINSIGHTS-PE-V1`, 36 total, 12 SJT dan dua SJT per
  Area masih dikunci pada source yang diperiksa. Jangan menimpa manifest lama
  atau memindahkan draft/respons ke teks/rubrik baru berdasarkan ID soal saja.
- Jalur skor dan identitas hasil tetap deterministik serta berversi. SR ≥3/4,
  SJT ≥2; coverage Integrity 2/3 atau 3/3 disimpan. NA/missing bukan nol.
  Tidak ada skor gabungan atau ranking presisi antar-SJT.
- Rekomendasi perlu seluruh kandidat Core/Secondary, objective refs,
  audience/level fit, kesiapan produk, sponsor tim/organisasi dan opt-in
  spiritual. Keluaran final 0–3; laporan merencanakan 0–2 fokus dan praktik
  30 hari. Selaraskan perbedaan jumlah fokus pada workbook/template.
- SS-10 adalah Coaching Skills for Leaders di BinaLab; BinaCoach berbeda.
  SS-32/IDP tersedia sebagai draf sumber, belum otomatis aktif atau berharga
  final. IDP 90 hari dapat menjadi lampiran opsional.
- Proposal SPIN mencakup flow mandiri klien dan flow dibantu konsultan dalam
  workspace terpisah. Template proposal dan paket tercantum pada shared chat;
  pengguna mengonfirmasi masalah ZIP sudah teratasi pada 21 Oktober. Kegagalan
  akses sesi agen tidak berarti CEO belum membuatnya. Penelaahan isi berkas
  asli dan integrasi aturan komersial masih perlu diselesaikan.
- Isi sumber masih menyebut pilot/review, beberapa versi heading/metadata
  tertinggal. Catat keputusan penggunaan revisi 20 Oktober tersendiri dari
  persetujuan CEO atas V1. CEO tetap ahli/pemilik isi; bukti pilot empiris
  belum disertakan. Tidak menambah persetujuan harian pada operasi admin.

Verifikasi sumber lokal: 15/15 checksum cocok, workbook cocok dengan JSON
private, 34 baris crosswalk katalog cocok JSON, 15 tes referensi lulus.
Probe kode referensi menemukan sponsor tim belum diperiksa, false/unknown
belum dibedakan, dan ID respons asing diabaikan. Lengkapi implementasi produksi
serta UAT; jangan menyalin contoh referensi tanpa validator.

Giliran penelaahan ini tidak mengubah runtime, database, harga, secret atau
pengiriman. SQL 64–69 tetap sejarah; penambahan versi memakai migrasi maju
setelah implementasi siap. SQL 70 cleanup tidak dijalankan ulang; program TBOS
nyata dan relasinya dipertahankan. Target 21 Oktober adalah checkpoint bagian
yang lulus, bukan konfirmasi seluruh scope terbaru sudah rilis.

## Pembaruan rencana — 19 Oktober 2026

Pengguna menyetujui perluasan perjalanan: diagnosis → rekomendasi beralasan →
proposal/konsultasi → pelaksanaan → penerapan di pekerjaan → tinjauan hasil →
kebutuhan lanjutan. Rencana rinci, dependensi CEO, dan kriteria penerimaan berada
di repo APP: `docs/development-journey-work-plan.md`.

Implementasi awal app 0.40 menampilkan brief sumber, timeline lintas-modul dari
data dashboard yang dimuat, dan indikator proyek existing. Ini proyeksi baca-saja,
bukan snapshot scope komersial, mesin evaluasi baru, atau endpoint riwayat lengkap.
Tidak ada migrasi/API runtime baru dari perluasan awal ini. Keandalan scheduler
produksi tetap perlu dibuktikan; instrumen organisasi, proposal meeting, laporan
final, pembayaran, dan AI agent tidak otomatis dianggap selesai/aktif.

Pemetaan rekomendasi harus dapat ditelusuri ke bukti dan versi yang sah. Masalah
proses/alat tidak otomatis disebut kekurangan kompetensi. Evaluasi program tidak
mengubah refleksi individu menjadi peringkat atau dasar otomatis seleksi/promosi,
dan tidak memperluas izin akses ke perusahaan/AMS. Referensi Polar Bear digunakan
sebagai inspirasi konsep, bukan paket prompt/template yang disalin ke produk.

## Keputusan produk

- Diagnosis Tim/Organisasi dan Individu akan menjadi dua jalur terpisah setelah pengguna menekan tombol diagnosis di website.
- Tim/Organisasi mendapat diagnosis lengkap secara gratis.
- Individu mendapat Self-Development, Adaptability dan Pressure Management secara gratis. Tiga kompetensi PE lainnya direncanakan berbayar; harga, akses setelah pembayaran dan aturan pengulangan masih perlu ditetapkan.
- Pembaruan 13 Oktober: tiga gratis telah disahkan (Self-Development, Adaptability, Pressure Management). Pernyataan menunggu tiga gratis pada catatan awal di bawah adalah historis; keputusan harga/format final tetap belum tersedia.
- Harga katalog tidak ditampilkan di website publik. Judul solusi tetap berbahasa Inggris. Copy isi mengikuti sumber CEO, dengan terjemahan Indonesia yang setara.
- Proposal untuk klien tidak memakai istilah internal seperti standar/custom atau katalog dasar dalam judul dan narasi publik.
- Skor minat penjualan tidak dicampur dengan skor kompetensi.

Persetujuan 13 Oktober: tiga gratis adalah Self-Development, Adaptability, Pressure Management; enam crosswalk PE/katalog dan usulan retensi pilot enam bulan disetujui. CEO adalah ahli/penelaah isi, bukan reviewer eksternal yang masih ditunggu. Tahap 2 memasang delivery gratis 18 soal/hasil web; harga dan format final email/PDF/proposal tetap belum ditetapkan. Lihat `PERSONAL-EFFECTIVENESS-PHASE-2.md`.

Tahap 3–4 (API/app 0.34.0 + SQL 66): admin dapat meninjau hasil konkret dengan izin peserta, riwayat owner lintas perangkat, sumber kanal, dan dashboard/kontrol/evaluasi pilot. Hasil admin/peserta memakai model yang sama. Hasil historis tidak dibuka retroaktif; tidak ada AI individu baru, template/harga asumsi, atau klaim validasi empiris. Lihat `PERSONAL-EFFECTIVENESS-PHASE-3-4.md`.

## Riwayat fondasi 10–13 Oktober 2026

Pembaruan 13 Oktober: paket CEO Personal Effectiveness menyediakan enam kompetensi individu, 36 soal, definisi dan key actions, serta aturan scoring draft. Fondasi tahap 1 ditambahkan pada SQL 64/API 0.32.0; lihat [PERSONAL-EFFECTIVENESS-PHASE-1.md](PERSONAL-EFFECTIVENESS-PHASE-1.md). Paket ini tidak melengkapi seluruh 26 kompetensi, tidak memperbarui soal organisasi, dan belum menetapkan tiga kompetensi gratis. Instrumen individu tetap terpisah dan belum aktif untuk peserta.

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

## Kelengkapan berikutnya setelah paket 20 Oktober

- Selaraskan identitas versi, jumlah fokus laporan, keputusan penggunaan PE V2,
  status SS-32, dan penelaahan objective/readiness katalog per produk.
- ItemBank sudah lengkap untuk enam PE (37 soal). Soal 28 kompetensi lainnya
  dan instrumen tim/organisasi terbaru belum tercakup; alur organisasi existing
  tetap memakai instrumen lamanya. Tidak perlu menambah soal PE untuk tahap ini.
- Template laporan individu/IDP serta email individu dari chat 21 Oktober
  sudah diterima. Sumber email disimpan di repo APP
  `docs/individual-assessment-email-template.md`; integrasi teaser mengikuti
  snapshot hasil dan penyebutan metode SR/SJT. Email blast/tim diperiksa terpisah.
- Template proposal indikatif/paket SPIN tersedia pada chat. Selesaikan akses
  isi lampiran dan pemetaan jalur individu/tim, pertanyaan, scope, tambahan
  biaya, pajak/diskon dan kebijakan kirim; tidak meminta CEO membuat ulang.
- Harga/paket asesmen individu, upgrade/retake, masa akses, refund,
  merchant/gateway, serta event/jadwal/tiket Public Workshop yang nyata.

Lihat daftar keputusan dan urutan A–G pada rencana aktif di repo APP.

## Riwayat target menuju 21 Oktober

Ini target kerja bersyarat, bukan konfirmasi semua fitur sudah siap rilis.

| Tanggal | Pekerjaan | Ketergantungan |
| --- | --- | --- |
| 10–13 Oktober | Kamus, pemetaan katalog, akses admin, pengujian fondasi, kontrak versi | Katalog terbaru tersedia |
| 14–17 Oktober | Bank soal, dua jalur diagnosis, skor dan rekomendasi, hasil web/email/PDF, template proposal | Dokumen dan aturan CEO diterima; prioritas scope disepakati |
| 18–20 Oktober | UAT lintas API/app/website/AMS, akses berbayar jika siap, uji proposal konsultasi dan regresi | Integrasi serta template sudah stabil |
| 21 Oktober | Rilis bagian yang lulus UAT dan verifikasi pascadeploy | Tidak ada bug kritis; fitur yang dokumennya belum siap tetap tidak aktif |

Jadwal tersebut adalah baseline sebelum paket 20 Oktober diterima. Urutan dan
dependensi terbaru ada pada pembaruan 21 Oktober di atas. Pembayaran dan proposal
SPIN tidak dipaksakan rilis dengan template/harga sementara.

## Kriteria penerimaan akhir

- Setiap skor dapat ditelusuri ke jawaban, soal, kompetensi, dan versi metode CEO.
- Rekomendasi hanya memakai evidence yang diukur dan konteks yang relevan.
- Diagnosis lama tidak rusak atau berubah makna; hasil historis menyimpan versinya.
- Individu hanya melihat kompetensi yang menjadi hak aksesnya di semua kanal.
- Hasil dan proposal web/PDF/email sesuai template CEO, tanpa jargon teknis internal atau harga publik.
- Job analisis/pengiriman tetap berjalan setelah browser ditutup, tanpa pengiriman ganda.
- Proposal konsultasi tersimpan selama meeting, dapat dipreview, dan perlu konfirmasi konsultan sebelum dikirim.
