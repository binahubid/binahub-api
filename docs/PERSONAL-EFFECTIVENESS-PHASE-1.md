# Personal Effectiveness: fondasi tahap 1

Status 13 Oktober 2026: implementasi teknis draft untuk pengujian internal. Bukan aktivasi diagnosis individu, bukan izin melakukan pilot pada peserta, dan bukan instrumen tervalidasi.

Pembaruan tahap 2: pengguna mengonfirmasi persetujuan semua rekomendasi dan bahwa CEO menjadi ahli/penelaah substansi. Tiga kompetensi gratis dan retensi enam bulan disiapkan pada SQL 65 tanpa mengubah snapshot tahap 1. Lihat [panduan tahap 2](PERSONAL-EFFECTIVENESS-PHASE-2.md). Pernyataan “menunggu CEO” di bawah merekam keadaan saat fondasi tahap 1 dibuat.

## Sumber dan batas produk

Paket CEO `BinaInsights_Online_Assessment_Developer_Pack_v1` berisi spesifikasi DOCX, konfigurasi JSON, dan bank soal XLSX. Snapshot menyimpan SHA-256 ketiga sumber. Teks soal, opsi, definisi, key action, kunci dan partial credit dipertahankan. Dokumen asli tidak diubah.

- Instrumen `BINAINSIGHTS-PE-V1`, versi teknis `1.0.0-draft.1`.
- Enam kompetensi, 24 behavioral self-report, 12 situational judgment, 25 key actions.
- Versi item seluruh paket `1.0.0-draft.1`, scoring `pe-dual-method-v1`, report rules `pe-report-draft-v1`.
- Aturan prioritas `awaiting_ceo`; tidak ada perhitungan prioritas aktif.
- Status sumber tetap `DRAFT_FOR_EXPERT_REVIEW_AND_PILOT`; semua kunci SJT tetap provisional.
- Tidak ada perubahan pada assessment organisasi 49 soal, tujuh Area, skor minat penjualan, email, proposal, harga katalog, atau AMS.

Versi teknis ditambahkan untuk reproducibility, bukan klaim bahwa CEO telah mengesahkan versi tersebut. Perubahan instrumen harus memakai versi baru, bukan mengedit snapshot lama. Hasil final menyimpan jawaban mentah, versi, waktu, kelengkapan dan output scoring; hasil lama tidak dihitung ulang secara otomatis.

## Isi implementasi

| Komponen | Fungsi |
| --- | --- |
| Paket privat di luar repository | Sumber CEO dan SQL pemasangan lengkap, termasuk kunci dan provenance |
| `instrument-contract.ts` | Validasi struktur, metode, versi, opsi dan coverage key actions |
| `definition.ts` | Pembatas `server-only`, pembacaan snapshot DB, verifikasi hash, DTO soal dengan allowlist |
| `scoring.ts` | Validasi ketat dan scorer TypeScript deterministik |
| `contracts.ts` | Kontrak respons/hasil tanpa kunci, skor gabungan, level atau norma |
| `store.ts` | Adapter RPC server untuk start, resume, autosave, submit dan erasure uji internal |
| SQL 64 | Skema snapshot immutable, registrasi sumber privat, crosswalk proposed, respons/hasil persisten, audit dan fungsi transaksi |

Repository API saat diperiksa bersifat **publik**. Bank soal, opsi/rationale dan kunci CEO tidak disimpan dalam source code, migration publik, fixture pengujian, atau commit Git. Fixture CI seluruhnya buatan untuk pengujian, dengan kunci berbeda dari sumber CEO. Data nyata dibaca server dari database setelah instalasi privat. Hash/provenance bukan pengganti kontrol akses data sumber.

Tidak ada endpoint HTTP peserta atau tombol aktivasi baru pada tahap 1. Adapter hanya untuk backend tepercaya; jangan dihubungkan langsung ke browser. Autentikasi peserta, UI, entitlement gratis/berbayar, dan peluncuran pilot adalah tahap berikutnya.

## Aturan skor

Self-report menerima bilangan bulat 1–5 atau kode eksplisit `NA`. Tidak ada coercion dari string angka. Item yang tidak dijawab tidak memiliki key pada snapshot. `null` ditolak karena ambigu antara NA dan jawaban hilang.

- NA dikeluarkan dari pembilang dan penyebut; tidak dinilai nol.
- Minimal 3 jawaban valid dari 4 item per kompetensi.
- Mean = jumlah nilai valid / jumlah jawaban valid.
- Skala tampilan = `(mean - 1) / 4 * 100`.
- Kurang dari 3 jawaban valid menghasilkan `insufficient_evidence`, skor dan mean `null`.

SJT menerima ID opsi A/B/C/D, bukan skor yang dikirim klien. Server menggunakan partial credit 0–3 dari snapshot.

- Kedua skenario per kompetensi harus dijawab untuk mendapat skor tampilan.
- Skala tampilan = `jumlah kredit / (3 * jumlah skenario valid) * 100`.
- Satu skenario hilang menghasilkan `incomplete` dan skor `null`, bukan normalisasi satu jawaban.
- Kredit nol tetap dihitung sebagai skenario yang dijawab.

Jumlah mentah dan denominator disimpan. Mean serta skor tampilan dibulatkan dua desimal; rumus skor tidak menggunakan mean yang telah dibulatkan. Contoh SR 4,4,5,NA menghasilkan 83,33. Kredit SJT 3+1 menghasilkan 66,67. Keduanya terpisah, bukan persentase penguasaan.

Tidak ada overall, composite, label Pemula/Profesional, level 1–4, percentile, diagnosis klinis, atau rekomendasi otomatis dari nilai terendah. AI tidak terlibat dalam scoring. Scorer database menjadi otoritas penyimpanan dan tidak menerima skor dari caller; scorer TypeScript diuji parity terhadap database.

## Crosswalk katalog

Kode COMP katalog lama tetap utuh. Enam hubungan berikut tersimpan sebagai **proposed**, bukan approved:

| PE | Kompetensi | Katalog |
| --- | --- | --- |
| PE-01 | Integrity | COMP-007 Integritas |
| PE-02 | Self-Development | COMP-024 Pengembangan Diri |
| PE-03 | Initiative | COMP-006 Inisiatif |
| PE-04 | Adaptability | COMP-001 Adaptasi |
| PE-05 | Resilience & Perseverance | COMP-008 Kegigihan & Tahan Banting |
| PE-06 | Pressure Management | COMP-020 Mengelola Tekanan |

Pengesahan membutuhkan reviewer, waktu dan referensi keputusan. Persetujuan tidak otomatis mengaktifkan rekomendasi katalog. Definisi keenam PE disimpan dalam snapshot PE; tidak menimpa definisi seluruh 26 COMP atau menganggap bank soal organisasi telah tersedia.

## Persistensi dan keamanan

`pe_instrument_versions`, `pe_catalog_crosswalks`, `pe_attempts`, dan `pe_audit_events` memakai RLS. Anon/authenticated tidak memiliki akses tabel atau fungsi, termasuk kunci jawaban. Service role dapat membaca, tetapi perubahan attempt wajib melalui RPC terjaga. Registrasi instrumen hanya untuk akun database administratif, bukan service role. Pembaruan/penghapusan snapshot instrumen ditolak trigger.

Setiap attempt hanya boleh bermode `internal_test`. Identitas disimpan sebagai UUID referensi, tanpa nama, email, perusahaan atau salinan otomatis kepada CEO. UUID ini pseudonim, **bukan jaminan anonimitas** jika dapat dihubungkan dengan identitas di tempat lain.

RPC memeriksa pasangan participant dan actor; keduanya harus ditentukan backend setelah otorisasi, bukan dipercayai dari body browser. Referensi UUID bukan pengganti autentikasi. Akses admin terhadap data individu dan sharing perusahaan harus ditetapkan sebelum endpoint peserta dibuat.

Start memerlukan ID attempt stabil, versi notice, versi kebijakan privasi, waktu persetujuan, dan batas retensi eksplisit. Pengujian internal membatasi retensi paling lama 30 hari dan menolak akses setelah kedaluwarsa. Ini pembatas teknis uji internal, **bukan kebijakan retensi peserta yang disahkan CEO**. Kedaluwarsa menutup akses; belum ada job penghapusan otomatis. Fungsi erasure menghapus respons dan hasil; audit minimal tetap ada tanpa isi jawaban.

Autosave mengirim **snapshot lengkap** beserta `expectedRevision`. Snapshot menggantikan draft; menghapus item dari snapshot berarti mengosongkan jawaban, bukan NA. Waktu item yang tidak berubah dipertahankan. Dua save dengan revision sama tidak boleh saling menimpa: satu berhasil, satu mendapat `PE_REVISION_CONFLICT`.

Submit mengambil row lock, memvalidasi semua jawaban, menghitung dan menyimpan hasil, memfinalkan attempt, serta membuat audit dalam satu transaksi. Key 16–128 karakter disimpan caller hingga respons pasti. Retry dengan key dan snapshot sama mengembalikan hasil identik tanpa audit/hasil kedua. Perubahan jawaban atau key setelah final ditolak. Respons gagal validasi tidak mengubah draft atau audit.

Fondasi mendukung hasil parsial dengan penanda kelengkapan untuk uji aturan. Ini **bukan keputusan bahwa peserta produksi boleh melewati soal**. Kebijakan UX sebelum final submit menunggu persetujuan.

## Instalasi aman

1. Pastikan SQL 63 telah selesai dan backup tersedia sesuai prosedur tim.
2. Untuk pemasangan lengkap, jalankan **file `0064_personal_effectiveness_COMPLETE.private.sql` yang diserahkan secara lokal di luar repository**. File ini memasang skema SQL 64 dan snapshot CEO dalam satu transaksi. Jangan upload file ini ke GitHub, halaman publik atau log. Migration SQL 64 di Git hanya memasang skema kosong; itu disengaja, bukan hilangnya data seed.
3. Deploy API versi 0.32.0. Tidak ada env, secret, cron, n8n, app, website atau AMS baru yang diperlukan untuk fondasi ini.
4. Verifikasi secara read-only menggunakan akun database administratif:

```sql
select instrument_id,version,release_status,public_enabled
from public.pe_instrument_versions;
select pe_code,catalog_code,status
from public.pe_catalog_crosswalks order by pe_code;
select count(*) from public.pe_attempts;
```

Hasil setelah SQL lengkap: satu snapshot draft, `public_enabled=false`, enam crosswalk proposed, dan tidak ada attempt baru dari migrasi. Jika hanya migration publik yang dijalankan, registry tetap kosong dan start attempt mengembalikan setup required. Jangan melakukan `select manifest` melalui browser: manifest memuat kunci privat.

Migrasi aman diulang, tidak menimpa pemetaan yang kemudian direview, dan menolak sumber berbeda dengan versi sama. Jika gagal, rollback seluruh transaksi sebelum memperbaiki prasyarat. Migrasi tidak menyimpan jawaban peserta dan tidak mengirim email. SQL produksi tidak dijalankan oleh implementasi ini.

Untuk developer yang perlu membuat ulang file lengkap dari bundle privat, gunakan:

```text
node scripts/prepare-pe-deployment.mjs <lokasi-bundle-privat.json> <lokasi-di-luar-repo.private.sql>
```

Generator menolak output di dalam repository, memeriksa junction/symlink parent, tidak menimpa file yang sudah ada, dan tidak mencetak soal/kunci. Simpan bundle/seed melalui saluran internal; jangan mengubah repository publik menjadi tempat backup bank soal. Ini pekerjaan instalasi teknis sekali, bukan pengaturan harian admin.

## Pengujian yang harus lulus

```text
npx vitest run src/lib/individual-assessment --maxWorkers=1
npm run typecheck
npm run lint
npm run test:run -- --maxWorkers=1
npm run build
```

Pengujian repository menggunakan PostgreSQL lokal PGlite dan data sintetis. Cakupan: snapshot/coverage, seluruh opsi SJT, transformasi SR, NA/missing/nol, input invalid, source conflict, SQL 63 compatibility, izin RLS/RPC, start/replay, resume, revision conflict, submit ganda, immutability, consent/retention, expiry/erasure, generator privat dan parity dua scorer. Paket CEO dan SQL privat juga diverifikasi secara lokal terhadap file asli, tanpa memasukkan sumber/kunci ke repository. Tidak membutuhkan koneksi produksi atau pengiriman email.

PGlite memverifikasi SQL serta transaksi; belum menggantikan uji otorisasi HTTP, sesi peserta, beban, backup/restore, kebocoran bundle browser, dan race lintas koneksi pada Supabase staging yang perlu dilakukan saat delivery layer dibangun.

## Keputusan CEO dan saran

Semua berikut merupakan usulan, bukan aturan aktif:

1. Tiga gratis: Self-Development, Adaptability, Pressure Management. Ketiganya luas relevansinya dan dapat ditindaklanjuti. Pertahankan seluruh 4 SR + 2 SJT per kompetensi; jangan menjanjikan durasi baru sebelum diuji. Paket gratis menjadi 18 item jika disahkan; tidak otomatis memberi hak atas seluruh 26 kompetensi.
2. Crosswalk: sahkan makna dan key action keenam PE terhadap COMP yang diusulkan, tanpa mengganti identitas katalog. Pertimbangkan konteks, tujuan dan audiens solusi sebelum rekomendasi produk.
3. Prioritas: pilih 2–3 kandidat berdasarkan relevansi pekerjaan, kecukupan bukti, serta pola SR/SJT. Perbedaan dua metode menjadi bahan eksplorasi, bukan tuduhan atau diagnosis. Tetapkan rubrik yang dapat dijelaskan; jangan menetapkan cutoff arbitrer sebelum review/pilot.
4. Jawaban dan akses: NA hanya pada SR; tampilkan review kelengkapan sebelum submit. Hasil milik peserta, konsultan memperoleh akses sesuai penugasan/izin; jangan CC hasil individual otomatis ke perusahaan. Usulan retensi pilot peserta enam bulan, lalu evaluasi, tetapi jangka waktu final dan mekanisme penghapusan perlu disahkan sebelum pilot peserta.
5. Laporan/email/proposal: laporan memakai dua skor terpisah dan saran perilaku yang konkret. Email singkat dengan akses hasil yang aman. Paket berbayar dapat melengkapi enam kompetensi dan menawarkan sesi pembahasan terpisah; harga individu menunggu persetujuan, tidak mengambil minimum harga proposal organisasi.

Ahli menelaah substansi pengukuran, bukan sekadar bug software. Libatkan penelaah metode/psikometri atau psikolog industri-organisasi dan praktisi HR/pekerjaan yang relevan. Review ini dilakukan terhadap versi instrumen, bukan meminta admin menyetujui setiap hasil.

Pilot adalah uji terbatas: paket CEO menyarankan cognitive testing 8–12 orang, kemudian pilot kuantitatif 100–200 bila memungkinkan. Periksa pemahaman, durasi nyata, NA/missing, distribusi opsi, kegunaan laporan dan kualitas pengukuran sesuai kecukupan data. Angka peserta bukan bukti otomatis bahwa instrumen valid. Distribusi best key SJT saat ini hanya B/C perlu ditelaah, bukan diubah sepihak oleh developer.

Target 21 Oktober dapat dipakai untuk fondasi dan kesiapan uji, bukan janji validasi psikometrik selesai. Aktivasi peserta memerlukan notice/access/retention yang disahkan, review ahli, UI & autentikasi, pengujian staging serta keputusan cakupan pilot.
