# Persiapan integrasi paket BinaInsights 20 Oktober 2026

Implementasi 21 Oktober menyiapkan sumber dan adapter PE V2 secara lokal.
Statusnya **prepared_not_active**, bukan rilis peserta atau perubahan instrumen
aktif. Tidak ada SQL, worker, email, pembayaran, konfigurasi provider atau
pengiriman produksi yang dijalankan. SPIN tetap menunggu review pertanyaan CEO.

## Yang sudah tersedia

- Registry `src/data/binainsights-release-2026-10-20.json`: identitas versi,
  checksum manifest, serta nama/ukuran/checksum 15 berkas sumber. Tidak berisi
  teks soal, pilihan, kunci jawaban, rubrik atau transkrip.
- `scripts/prepare-binainsights-release.mjs`: pemeriksaan byte sumber sebelum
  parsing, inventaris lengkap, kesetaraan private/public JSON, versi, struktur
  37 soal, key actions dan 173 hubungan pada 32 solusi/34 nama kompetensi.
- Adapter persiapan `scripts/lib/binainsights-v2.mjs`: proyeksi peserta berbasis
  allowlist dan hak akses eksplisit, preview perhitungan dua metode, serta diff
  V1/V2 berupa ID yang ditambah/diubah/dihapus tanpa teks atau kunci jawaban.
- Paket privat tervalidasi berhasil dibuat di folder lokal di luar seluruh
  checkout Git. Payload SHA-256:
  `970d6d7b69057c8fc3fdae4e69602b696210ba07a6c3044961fb9accb1edaef5`.
  Checksum menunjukkan integritas isi, bukan bukti validitas psikometrik.

Status sumber tetap dipertahankan: `BINAINSIGHTS-PE-V2-PILOT` / `2.0-pilot`,
Dictionary `5.0-pilot`, Catalog `6.0-SS32`, rules `4.1-SS32`, report `3.1-pilot`.
Nama berkas rules v4.2 tidak dipakai untuk menebak versi metadata. Kunci tetap
provisional sesuai sumber; persetujuan ahli isi tidak dikarang menjadi hasil
validasi empiris. SS-32 tetap pending, bukan produk aktif.

## Batas dan perlindungan

- V1 beserta SQL 64–69, manifest, DTO, kebijakan gratis dan hasil tersimpannya
  tidak diganti. Kesamaan ID item bukan izin memindahkan jawaban ke versi baru.
- V2 gratis PE-02/04/06 berjumlah 18 soal; tiga tambahan 19; penuh 37.
  Integrity punya tiga SJT. Dengan dua terjawab, coverage tetap 2/3 dan
  denominator enam; dengan tiga, coverage 3/3 dan denominator sembilan.
- NA tidak dihitung sebagai nol. SR memerlukan tiga jawaban angka dari empat;
  SJT memerlukan dua skenario. Nilai nol yang sah dibedakan dari bukti yang
  kurang. Tidak ada skor gabungan, level, ranking atau rekomendasi otomatis.
- Jawaban asing, tipe yang salah dan jawaban di luar hak akses ditolak.
  DTO tidak menyebarkan sumber; soal/kompetensi di luar hak tidak ditampilkan
  sebagai nol. `review_status`, `interpretation`, catatan desain dan rubrik
  sumber tidak menjadi field DTO peserta.
- CLI tidak mengeksekusi Python dari paket, tidak mengakses `.env`, database,
  jaringan, AI atau email. Error native/JSON tidak dicetak; hanya kode aman.
- Manifest dan berkas dipasangkan ke fingerprint yang direview. Path absolut,
  traversal, duplikat case-insensitive dan junction keluar folder ditolak.
- Ekspor hanya ke `.private.json` di luar semua ancestor `.git`, termasuk
  sibling checkout, worktree dan junction. Tidak ada flag force, aktivasi atau
  overwrite. Folder tujuan harus sudah ada. Output privat bukan berkas publik.
- Pemeriksaan DOCX/XLSX pada alat ini adalah kecocokan fingerprint dengan
  berkas yang ditelaah sebelumnya, bukan ekstraksi atau audit ulang setiap sel
  dan sasaran pembelajaran. Definisi 34 kompetensi dan katalog komersial penuh
  belum diimpor ke tabel runtime oleh tahap ini.

## Menjalankan pemeriksaan tanpa perubahan data

```powershell
npm run prepare:binainsights -- "<folder paket CEO 20 Oktober 2026>"
```

Untuk menghasilkan artefak privat baru secara eksplisit:

```powershell
npm run prepare:binainsights -- "<folder paket CEO>" --output "<folder privat di luar Git>/release.private.json"
```

Receipt hanya memuat versi, jumlah, hash dan status persiapan. Jangan menyalin
isi artefak privat ke GitHub, log, tiket publik atau pesan. Bila sumber direvisi,
buat identitas/fingerprint rilis baru; jangan mengubah isi versi yang sudah
digunakan peserta.

## Verifikasi lokal

- Paket CEO asli: 15/15 hash cocok; kesetaraan proyeksi peserta dan struktur
  V2/crosswalk lulus; ekspor privat di luar Git berhasil.
- 76 tes V1/V2 dan paket sumber lulus, termasuk data sintetis, input asing,
  hak gratis/tambahan, coverage 2/3–3/3, privasi DTO, perubahan sumber, path dan
  larangan overwrite. Tidak memakai jawaban peserta nyata.
- Regresi selain suite cleanup: 578 lulus, tiga dilewati. TypeScript, lint
  seluruh berkas baru dan build produksi Next.js (121 halaman) lulus.
- Suite penuh belum hijau: satu tes cleanup existing mengharapkan preview,
  sedangkan `supabase/operations/cleanup_operational_test_data.sql` tersimpan
  dengan `cleanup_execute='true'`. Pengaturan tersebut tidak diubah dan SQL
  tidak dijalankan. Ini terpisah dari jalur persiapan PE V2.

## Langkah integrasi berikutnya

1. Registrasi database berversi melalui migrasi maju, tanpa mengganti V1.
2. Bind attempt, hak, respons, hasil dan snapshot laporan pada versi sumber;
   perbarui persistence/RPC, bukan hanya mengganti validasi frontend.
3. Integrasikan definisi/perhitungan V2 ke alur guest, API admin, web, email,
   laporan dan retensi; resume V1 tetap di V1.
4. Impor definisi/key actions kamus dan sasaran belajar/readiness katalog
   sebagai versi baru, lalu bangun eligibility serta laporan aligned.
5. Uji end-to-end sebelum mengaktifkan versi peserta. Adapter persiapan ini
   bukan bukti bahwa seluruh alur V2, SPIN atau pembayaran sudah berjalan.
