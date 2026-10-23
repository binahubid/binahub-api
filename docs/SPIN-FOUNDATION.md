# Fondasi SPIN: pencocokan dan investasi dasar

22 Oktober 2026. Fondasi telah diintegrasikan dengan intake, penyimpanan,
workspace admin, laporan web/PDF dan antrean pengiriman pada kode lokal.
**Belum terdeploy/diverifikasi produksi.** Helper pencocokan/harga sendiri tetap
tidak mengirim apa pun; worker intake yang mengelola side effect. Runbook rilis:
[SPIN-RELEASE-RUNBOOK.md](SPIN-RELEASE-RUNBOOK.md).

## Sumber dan keputusan

- Katalog aktual `BinaHub_Signature_Solutions_Catalog_V6_SS32.docx`, SHA256
  `10b439e277cc823cdb0b8dd10cc2892830e821607c75488df0e7a82eb1c1cc99`.
  Versi sumber `6.0-SS32`, scope SPIN terpisah `spin-ss01-31-v1`.
  Snapshot `src/data/spin-catalog-v6.json` berisi 31 solusi, objective refs,
  kutipan harga dan nomor paragraf sumber (bukan nomor halaman).
- Pengguna mengesahkan SS-01–SS-31 untuk SPIN tim/organisasi. SS-32 tidak
  dimasukkan, tetapi tidak dihapus dari registry atau katalog jalur lain.
- Persetujuan CEO via WhatsApp yang diteruskan pengguna: boleh memakai AI;
  harga sesuai ketentuan katalog; mencakup trainer/fasilitator dan modul;
  kebutuhan di luar itu dibahas saat konsultasi. Tidak meminta matriks manual
  besar sebagai prasyarat pembangunan. Keputusan ini memperluas batas
  paraphrase-only pada spesifikasi DOCX sebelumnya.
- Pajak belum dikonfirmasi secara eksplisit. Jangan mengasumsikan nol,
  termasuk atau di luar harga; tidak menghitung persentase/total akhir.
- Tanpa masa berlaku komersial proposal sesuai keputusan pengguna. Ini tidak
  menghapus expiry akses privat atau versi snapshot. Pengguna memilih data SPIN
  tanpa penghapusan otomatis berdasarkan waktu; kebijakan PE tidak berubah.

## Kontrak kode

| Bagian | Fungsi | Batas |
| --- | --- | --- |
| `catalog.ts` | Memvalidasi dan membekukan snapshot; menyiapkan kartu kandidat | 31 kode berurutan, tujuan belajar dari teks sumber, tarif sesuai evidence; SS-27 hanya dengan opt-in eksplisit |
| `recommendation.ts` | Memvalidasi konteks ringkas dan hubungan jawaban–objective | Maksimal tiga kandidat, boleh nol; setiap kandidat harus merujuk tantangan dan hasil yang diharapkan; tidak ada prosa/harga model bebas |
| `commercial.ts` | Menghitung investasi dasar tarif harian dari katalog | Satu program, satu batch, maksimal 30 peserta, durasi resmi; biaya tambahan/pajak/total akhir tidak ditebak |
| `service.ts` | Adapter server-only ke `callRoutedAI` existing | JSON ketat, validasi ulang, budget terbatas, kegagalan menghasilkan klarifikasi, bukan produk generik |

`prepareSpinRecommendation` tidak membuat email, tabel, proyek, aktivitas CRM
atau follow-up. Worker SPIN memanggilnya setelah submit disimpan. Fungsi ini
memakai provider/admin settings existing, bukan SDK,
API key atau konfigurasi baru.

### Pemisahan hasil

- `publicReportDraft.recommendations`: nama dari katalog dan bukti hubungan
  dari input/sumber. Ini bahan draf untuk adapter laporan, **bukan** payload
  akhir web/PDF/email; jangan mengirim seluruh hasil fungsi ke klien.
- `internalConsultant`: versi sumber/engine, alasan konsultasi, status validasi,
  status belum aktif dan `automaticDeliveryAllowed: false`.
- `publicInvestment`: nominal dasar atau null, komponen termasuk, catatan scope
  dan pajak; `finalTotalIdr` selalu null selama pajak/penawaran belum final.
- `internalCommercial`: versi/rincian gerbang harga, tidak masuk dokumen publik.

Validasi rujukan hanya membuktikan ID ada dan berasal dari sumber yang benar.
Ia **tidak membuktikan kecocokan semantik**. Belum ada pengujian model nyata,
hasil akurasi, validasi psikometrik atau klaim rekomendasi pasti benar.

### Harga dan cakupan yang belum otomatis

Tarif harian standar memakai Rp25 juta/hari; SS-22 memakai Rp30 juta/hari
untuk durasi 2–5 hari sesuai sumber. Tarif bukan harga per peserta. Durasi
yang di luar daftar, format public class/coaching, peserta tidak diketahui atau
di atas 30, multi-batch/program, hambatan sistem/penerapan, konflik atau scope
organisasi luas menghasilkan konsultasi tanpa nominal otomatis.

SS-11 mempunyai harga paket dalam sumber, tetapi adapter paket belum dibuat;
jangan menyebut harganya tidak ada atau menggunakan tarif harian sebagai
pengganti. Layanan berlingkup khusus dan tambahan kebutuhan juga dikonsultasikan.
Helper harga belum membuktikan program cocok: integrasi wajib memakai kode
hasil validasi rekomendasi/scope yang berasal dari draft server, bukan harga,
kode pilihan atau status konfirmasi yang dipercaya langsung dari browser.

## Privasi dan integrasi berikutnya

Prompt memakai konteks terbatas dan tujuan belajar; tidak menerima field kontak,
harga atau raw objek assessment. Pola umum email/telepon/URL/kunci ditolak dari
evidence. Ini minimisasi, **bukan anonimisasi**: nama/rahasia yang ditulis bebas
masih mungkin lolos. Intake memisahkan kontak, menampilkan
notice, menyimpan consent pemrosesan/versi/timestamp dan memeriksa izin akses.
Persetujuan penggunaan AI dari CEO bukan consent peserta atau DPA provider.

Status summary, counts, barriers, conflicts dan refs harus diturunkan server dari
draft tervalidasi/terkonfirmasi; schema ini bukan pengganti kontrak Q01–Q28.
Jangan meneruskan kontak atau seluruh jawaban mentah ke helper.

Sudah dibuat: kontrak 51 field/21 kelompok layar, percabangan, ringkasan Q16,
consent, endpoint/draft ownership, autosave, workspace admin, aturan konservatif
fit/confidence/lead, enam bagian laporan, renderer PDF/email dan antrean/retry.
Follow-up memakai inquiry existing setelah penyedia menerima kiriman, dengan
pemeriksaan percakapan aktif lain. Tidak mengaktifkan setting/antrean lama,
scheduler baru atau pembayaran. Konflik dan baseline ada di rencana app.
Rilis masih membutuhkan SQL 71/deployment serta uji relevansi dan alur nyata.

## Verifikasi lokal

`npx vitest run src/lib/spin`: **87 tes lulus**, provider dimock, tanpa email
atau data klien nyata. Meliputi batas katalog, rujukan/opt-in, nol kandidat,
keluaran AI tidak valid, tarif/kapasitas/durasi, model paket/custom, scope,
kesalahan provider dan pemisahan data internal. TypeScript dan lint target
lulus. Regresi terkait provider/proposal bersama SPIN: 148 tes lulus.

Suite lebih luas dengan dua worker dan timeout 15 detik: 665 tes lulus,
tiga dilewati (103 file lulus, dua dilewati). Perintah:

```sh
npx vitest run --exclude src/lib/uat-cleanup.sql.test.ts --maxWorkers=2 --testTimeout=15000
```

Tes cleanup existing dikecualikan karena file operasi milik pengguna tersimpan
dengan eksekusi true, sementara tes mengharapkan preview false. Tidak mengubah
setelan atau menjalankan SQL cleanup. Percobaan suite paralel default sebelumnya
mengalami tiga timeout pada tes existing; pengulangan terbatas di atas lulus.
Ini bukan hasil pentest, evaluasi akurasi model atau UAT produksi.

Angka di atas adalah bukti tahap fondasi sebelumnya. Integrasi terbaru: 690 tes
lulus/tiga dilewati pada suite luas dengan pengecualian cleanup yang sama;
build API lulus. SQL 71 baru diuji di PGlite lokal, belum database produksi.
Tidak ada env baru, tetapi existing sender/secret/provider/scheduler harus benar.
Uji nyata ke admin@binahub.id telah diizinkan pengguna setelah migrasi/deploy;
belum dikirim. Tes referensi bukan evaluasi akurasi model/pentest/UAT produksi.
