# Personal Effectiveness — tahap 3 dan 4

Update 0.35.0: ketentuan alur tanpa akun, email privat, laporan frozen dan ekspor evaluasi berizin ada di [runbook terbaru](PERSONAL-EFFECTIVENESS-GUEST-REPORTS.md). Ketentuan login/ekspor agregat saja di bawah merupakan implementasi historis 0.34.0.

Implementasi 13 Oktober 2026, pasangan API/app **0.34.0**. Sumber CEO tetap `BINAINSIGHTS-PE-V1 / 1.0.0-draft.1`; teks, kunci, metode skor dan hasil historis tidak diubah. Penelaahan substansi CEO sudah dikonfirmasi pengguna. Tahap 4 menyediakan alat operasional pilot, bukan klaim pilot empiris atau validasi statistik telah selesai.

## Tahap 3: integrasi dan peninjauan konkret

- Website 0.2.28 sudah meneruskan query sumber ke pilihan diagnosis di app. Organisasi tetap memakai alur lama. Individu meneruskan hanya klasifikasi kanal (`instagram`, `tiktok`, `linkedin`, `google`, `email`, `website`, `direct`, `other`) melalui login dan mulai pengisian. Nilai UTM mentah, kampanye/term, referrer, email dan opaque acquisition journey tidak disalin ke diagnosis individu atau lead penjualan. Ini bukan atribusi first/last-touch kampanye yang lengkap.
- `/admin/assessments` memiliki pilihan Tim/Organisasi dan Individu. `/admin/assessments/individual` menampilkan brief, sumber, profil akun bila tersedia, konteks peran/tujuan/relevansi, jawaban yang dipilih, dan hasil konkret dari pengisian dengan izin peserta. Daftar maksimal 20 per permintaan, pagination keyset; pencarian berlaku pada kasus yang dimuat.
- Admin dan peserta menggunakan **model laporan yang sama**, termasuk pola dua metode, kandidat fokus latihan dan solusi katalog terkait. Penyajian jawaban admin tidak memuat kunci/rationale, opsi kredit, manifest privat, soal Area terkunci atau seluruh enam skor. Solusi tetap hanya dari crosswalk approved, pemetaan Core dan modul Self Transformation publik/ready/aktif/non-mock, tanpa harga.
- Skor dan narasi pengembangan individu saat ini **deterministik**, bukan narasi LLM baru. Tidak menambahkan AI agent, panggilan provider berbayar, atau mengubah LapakVIP/AI organisasi. Ini menghindari dua analisis berbeda di admin dan peserta. Format final/narasi AI berikutnya perlu tetap memakai kontrak bukti yang sama.
- Kamus kompetensi menampilkan ketersediaan tiga Area individu tanpa menyatakan seluruh 26 kompetensi atau soal organisasi telah tersedia.
- Riwayat milik sendiri `/insight/individual/history` menampilkan maksimal sepuluh pengisian nonkedaluwarsa untuk membuka draft/hasil dari perangkat lain. URL berisi UUID saja; ID bukan izin akses. Nama, konteks, jawaban dan hasil tidak disimpan di localStorage.

## Izin akses hasil

Arahan pengguna: admin perlu konteks, jawaban dan hasil konkret untuk rekomendasi akurat, bukan hanya statistik. Akses ini tetap dibatasi tujuan dan izin peserta:

1. Pengisian baru menjelaskan bahwa profil akun, konteks, jawaban dan hasil dapat ditinjau **tim BinaHub** untuk rekomendasi; persetujuan dicatat sebagai `pe-consultant-review-v1`, terpisah dari scoring/policy lama.
2. Hasil lama tidak mendapat izin secara retroaktif. Pemilik dapat memberi izin melalui **Kendali hasil Anda**.
3. Pemilik dapat mencabut izin; request admin berikutnya ditolak. Pencabutan tidak dapat menarik kembali data yang sudah pernah dibaca/disalin oleh penerima berizin. Admin harus menggunakan data hanya untuk tujuan konsultasi yang diinformasikan.
4. Tidak ada akses organisasi/perusahaan/AMS, salinan email internal otomatis atau endpoint publik untuk membaca hasil individu. Browser memverifikasi sesi; API memakai role admin otoritatif serta token pemilik. Profil akun baru diambil setelah RPC memastikan izin.
5. Penghapusan/retensi attempt juga menghapus permission dan feedback terkait melalui FK cascade. Statistik minimal tidak berisi jawaban/nama; audit perubahan status tidak menyimpan isi asesmen.

## Tahap 4: operasi dan evaluasi pilot

Di tab **Evaluasi pilot**, admin melihat jumlah pengisian aktif/selesai/draft/berizin, status pengumpulan, statistik evaluasi opsional, dan ekspor JSON agregat. Tombol **Jeda pengisian baru / Lanjutkan pengisian baru** menggantikan perubahan env untuk fungsi ini. Tidak terhubung ke toggle outbound/follow-up.

SQL 66 memulai status operasional `collecting` hanya untuk versi/kebijakan yang sudah disetujui. Readiness memeriksa keberadaan sumber, ukuran instrumen, tiga gratis, retensi dan enam crosswalk approved. API memverifikasi hash sumber sebelum mulai/kontrol versi. Ini pemeriksaan kesiapan teknis/substansi yang tercatat, bukan pengesahan validitas empiris.

- Jeda hanya menghentikan **attempt baru**, tidak mematikan save, resume, submit atau pembacaan hasil existing. Row lock dan trigger menjaga pause bahkan jika grant RPC lama berubah setelah replay administratif.
- Perubahan status memakai revision guard dan audit aktor. Pengulangan migrasi tidak me-reset status, permission atau jawaban. Replay SQL 64 lengkap dapat mengubah grant lama; jalankan kembali SQL 66 bila mengulangi migrasi lama untuk mengembalikan least privilege (trigger pause tetap melindungi).
- Peserta boleh memberi umpan balik kejelasan/kegunaan 1–5 dan izin evaluasi agregat secara **opsional**, terpisah dari akses konsultan. Tanpa izin evaluasi, hasil tidak masuk statistik skor/feedback. Izin bisa dicabut; feedback dihapus dan pengisian dikeluarkan dari agregasi.
- Satu hasil selesai terbaru per peserta berizin evaluasi; retake tidak menambah jumlah peserta. Rata-rata kedua metode dipisahkan, nilai null tidak diubah menjadi nol, dan NA dihitung terpisah.
- Minimal lima peserta adalah pembatas privasi teknis untuk rata-rata, **bukan target sampel atau bukti validasi**. Statistik deskriptif tidak membuat norma, level kemampuan, reliabilitas, skor gabungan atau keputusan seleksi/promosi. Jangan menyebutnya anonim mutlak; akses tetap hanya admin dan kohort kecil dibatasi.
- Ekspor berisi statistik saja, bukan identitas, jawaban per peserta, bank soal atau kunci. Tidak ada mass export jawaban personal.

## Instalasi dan uji

1. SQL 64 lengkap/64B dan SQL 65 harus berhasil terlebih dahulu (pengguna sudah mengonfirmasi).
2. Rilis API/app **0.34.0** dan jalankan **SQL 66** `supabase/migrations/0066_personal_effectiveness_review_pilot.sql` pada proyek database API yang sama. Lakukan dalam satu jendela deployment: API baru membutuhkan SQL 66, sementara SQL 66 mencabut start RPC legacy. Tidak perlu mengulang SQL 64/65 atau mengubah env. Website 0.2.28 dan AMS tidak memerlukan perubahan untuk tahap ini.
3. Mulai dengan satu akun internal: website → Individu → baca izin → isi 18 soal → submit. Hasil tetap terpisah dari lead organisasi. Buka admin → Assessment → Individu, pastikan konteks/jawaban/laporan sama. Admin hanya melihat pengisian berizin.
4. Dari pemilik, cabut akses; refresh detail admin harus ditolak. Beri izin kembali bila ingin melanjutkan konsultasi. Hasil lama tetap tertutup sampai diizinkan.
5. Aktifkan jeda dari admin. Attempt baru ditolak, draft lama tetap bisa diselesaikan, hasil/riwayat tetap terbuka. Lanjutkan pengumpulan dari tombol yang sama, tanpa Vercel/env.
6. Feedback evaluasi tidak wajib. Uji pencabutan izin evaluasi dan penghapusan data. Scheduler retensi yang sudah ada tetap diperlukan untuk purge fisik; tidak memasang n8n/cron/secret baru.

Endpoint baru: `GET /api/admin/assessments/individual` (daftar/agregat), `GET ?id=...` (detail berizin), `PATCH` (kontrol pilot), `GET /api/assessment/individual/history` (owner), `PATCH /api/assessment/individual/:id/access` (owner). Semua data pribadi no-store/noindex; RLS dan privilege RPC ditutup untuk anon/authenticated.

Tes SQL PGlite, route dan React memakai instrumen sintetis. Browser memakai akun/auth/API **loopback sintetis** melalui `e2e/fixtures/pe-auth-stub.mjs`; server itu test-only, tidak diimpor aplikasi dan hanya mendengarkan 127.0.0.1. Override env hanya pada proses tes; file env asli tidak diubah. Tes ini bukan bukti akun, email, pembayaran atau deployment produksi telah diuji. Sumber CEO juga diperiksa di database lokal tanpa mengunggah bank/kunci. Developer tidak menjalankan SQL produksi atau mengirim email.

## Yang belum diaktifkan

Format final email/PDF/proposal individu, paket/harga/pembayaran, tiga kompetensi tambahan untuk akses lengkap enam Area, instrumen organisasi baru, seluruh 26 kompetensi, narasi AI individu baru, sharing perusahaan/AMS, serta validasi empiris/pilot dengan peserta nyata. Jangan menganggap jumlah feedback sebagai pengganti review pengukuran. CEO tetap menentukan revisi instrumen/template/komersial.
