# Diagnosis individu — alur email dan laporan

Rilis API/app **0.35.0**, 14 Oktober 2026. Dokumen ini menggantikan ketentuan login wajib/ekspor agregat saja pada runbook tahap 2–4. CEO tetap pemilik teks soal, kredit jawaban dan revisi instrumen. Rilis ini menutup gap teknis dari audit developer pack; bukan pelaksanaan atau pengesahan validasi empiris.

## Alur peserta

1. Website → pilihan **Individu** → nama/email, peran/tujuan/relevansi dan persetujuan yang menjelaskan peninjauan tim BinaHub.
2. Isi 12 pengalaman kerja + 6 studi kasus dari PE-02/04/06. Tidak perlu akun/password. Tidak ada soal/kunci Area terkunci di DTO publik.
3. Setiap pilihan disimpan lebih dahulu dalam draft terenkripsi IndexedDB, lalu disinkronkan ke database. Draft lokal berlaku tujuh hari, hanya di browser/perangkat tersebut. Tidak membuat akun atau riwayat lintas perangkat dengan mencocokkan email.
4. Setelah submit, skor final tetap immutable. Konfirmasi hanya muncul setelah snapshot laporan dan job email tersimpan. Jika proses putus di antaranya, worker menemukan pengisian submitted tanpa job dan memulihkannya.
5. Email berisi tautan privat, bukan jawaban/skor terbuka atau CC internal. Tautan 48 jam/sekali pakai, baru dikonsumsi saat peserta menekan **Buka hasil diagnosis**. Sesi HttpOnly berlangsung 30 menit. Email/ID saja tidak memberi akses. Tautan ulang memakai respons generik dan hanya dikirim ke email tersimpan.
6. Di hasil, peserta dapat mencabut akses konsultasi, memberikan izin evaluasi opsional atau menghapus data. Hasil tidak otomatis disalin ke perusahaan/AMS. Pencabutan tidak dapat menarik salinan yang sudah dilihat/diekspor penerima berizin.

Browser baru tidak dapat membuka hasil hanya lewat email. Jika email belum diterima, **Buka hasil individu → Kirim tautan baru** dapat meminta tautan ke email pengisian tanpa nomor/akun; responsnya tidak mengungkap apakah alamat itu terdaftar. Pembacaan tetap membutuhkan tautan yang diterima pada email tersebut. Draft guest yang belum submitted belum memiliki mekanisme pemulihan lintas perangkat. Riwayat akun lama tetap owner-authenticated, tidak dibuka retroaktif.

## Laporan dan rekomendasi

- Snapshot v2: ringkasan peran/tujuan, tanggal diagnosis/tanggal pembuatan, versi instrumen/skor/laporan/prioritas, jumlah jawaban/NA dan Area dengan bukti kedua metode.
- Skor SR dan SJT terpisah. NA bukan nol; metode yang belum memenuhi syarat tetap null. Perbedaan angka perlu dieksplorasi melalui contoh kerja, bukan disimpulkan sebagai ketidakjujuran, kelemahan atau persentase penguasaan.
- Kandidat fokus mendahulukan relevansi dan kecukupan bukti. Tidak memaksakan 2–3 fokus jika bukti tidak mendukung. Praktik mengikuti key action CEO dari pola jawaban SR, konteks tujuan/peran, bukti perilaku yang dapat diamati, dan saran tinjau 14 hari setelah submit. Bukan meeting yang otomatis dipesan.
- Solusi terkait hanya dari crosswalk approved/Core dan produk individu publik ready/aktif/non-mock, tanpa harga. Snapshot mencatat rekomendasi saat pengisian; penawaran/ketersediaan aktual tetap perlu dikonfirmasi kemudian. Laporan lama tidak ditulis ulang.
- Ini laporan web/email akses, bukan template PDF/proposal komersial final CEO. Tidak menambah narasi LLM individu, overall, norma, ranking populasi atau level kelulusan.

## Evaluasi pilot

- Akses konsultasi konkret dan izin evaluasi merupakan dua tujuan berbeda.
- Izin lama `evaluation_consent` hanya untuk agregat. Ekspor baris memerlukan persetujuan baru `pe-evaluation-v2`. Jangan migrasikan izin lama menjadi izin ekspor.
- Tab Evaluasi pilot menyediakan ekspor statistik dan ekspor data berkode untuk tim evaluasi berizin. Minimum lima dan maksimum 1000 hasil per ekspor. Log mencatat aktor/jumlah, bukan jawaban atau alamat email.
- JSON evaluasi memuat respons, skor dua metode, kelengkapan, versi, durasi dan feedback. Tidak memuat nama/email/peran/tujuan, UUID pemilik/pengisian, token atau kunci/rationale. Kode pengganti hanya berlaku dalam file itu. Data berkode **bukan anonim**; jangan unggah ke repositori, publikasi atau mencoba mengidentifikasi peserta.
- Distribusi pilihan/NA/missing dan median durasi bersifat deskriptif. Sel nonnol di bawah lima disembunyikan pada ringkasan; raw export tetap rahasia. Durasi mencakup jeda/offline, bukan active time atau latensi per item.
- Dedup hasil terbaru per owner akun tidak memastikan orang unik pada guest (owner per attempt). Sampel pilot nyata perlu kurasi/tinjauan ahli, termasuk retake, keterwakilan, kejelasan item, reliabilitas dan fairness. Jumlah feedback maupun batas lima bukan bukti validasi. Target CEO 8–12 cognitive interviews dan 100–200 quantitative pilot belum otomatis terpenuhi.

## Deployment sekali

1. SQL 64B dan 65 sudah dikonfirmasi berhasil. **Pastikan SQL 66 sudah dijalankan**. Jika belum, jalankan `0066_personal_effectiveness_review_pilot.sql` terlebih dahulu. SQL 67 sengaja berhenti dengan `PE_SQL66_REQUIRED` jika prasyarat belum ada.
2. Jalankan seluruh `0067_personal_effectiveness_guest_reports.sql` di proyek Supabase API yang sama. Tidak mengubah source/soal/scoring, menghapus attempt, atau membuka hasil historis. Jika mengulangi migrasi lama kemudian, jalankan lagi 66→67 untuk mengembalikan fungsi/privilege terbaru.
3. Deploy API **0.35.0**, kemudian app **0.35.0**. Website 0.2.28 dan AMS tidak perlu deployment untuk perubahan ini.
4. Konfigurasi existing: `PROPOSAL_LINK_SECRET` minimal 32 karakter, `RESEND_API_KEY`, `EMAIL_FROM` sender terverifikasi, `APP_PUBLIC_URL` ke app produksi. Tidak menambah secret/toggle. Nilai secret tidak pernah masuk browser/Git. Jangan rotasi secret penandatangan sembarangan saat job/tautan aktif; tautan lama menjadi tidak cocok.
5. Scheduler yang sudah digunakan perlu benar-benar memanggil `GET /api/assessment/worker` dengan `Authorization: Bearer <FOLLOW_UP_CRON_SECRET>`, misalnya setiap menit. Rilis ini **tidak memasang atau mengaktifkan scheduler baru** dan tidak memerlukan n8n khusus. Tanpa scheduler, `after` mencoba pengiriman awal, tetapi recovery/retry/purge tidak terjamin berjalan.
6. Uji nyata dengan satu email internal milik penguji: isi → submit → lihat job → terima email → buka hasil → bandingkan admin → cabut izin → coba akses admin → hapus data. Jangan mulai pemasaran massal untuk membuktikan alur ini.

Tidak ada env yang perlu bolak-balik diubah saat operasi. Jeda/resume pengisian baru tetap satu tombol di admin. Admin detail menjelaskan `sent` sebagai diterima provider, bukan bukti delivery/inbox. `failed`/`uncertain` perlu pengecekan Resend sebelum resend; jangan membuat duplikat transaksi/email secara otomatis setelah jendela dedup 24 jam. Worker memakai batas konservatif 20 jam.

## Batas keamanan dan verifikasi

- Capability draft acak 256-bit, hanya hash tersimpan di server; tidak boleh dipakai membaca hasil. Token email diturunkan HMAC dengan domain terpisah dan link UUID acak; server menyimpan hash dan konsumsi sekali. Result session acak/hash dengan scope attempt dan TTL.
- Halaman/token tidak dicache/diindeks; fragment token dibersihkan sebelum tindakan, referrer tidak dikirim. Transport guest sengaja same-origin melalui rewrite Next agar cookie tidak bergantung pada third-party browser behavior. Browser/server roles tidak bisa membaca tabel atau mengeksekusi RPC privat.
- Enkripsi draft melindungi isi dari penyimpanan plaintext, **bukan** dari XSS atau orang yang menguasai browser. CryptoKey disimpan nonextractable dalam IndexedDB; script same-origin tetap bisa menggunakannya. Draft lokal kedaluwarsa dihapus saat dibuka kembali, bukan lewat job OS ketika browser tertutup. Server ditutup saat retensi berakhir; purge fisik membutuhkan scheduler.
- Unit/HTTP/SQL memakai sumber sintetis, worker Resend di-mock, browser lokal desktop/ponsel memakai fixture API. Ini pengujian batas lapisan secara terpisah, bukan bukti delivery email/deployment/database produksi atau pilot manusia telah diuji.
- Panduan token mengikuti [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); batas dedup mengikuti [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Tetap ditunda

Pembayaran dan entitlement tiga Area tambahan, paket lengkap enam Area/36 soal di participant UI, seluruh 26 kompetensi, soal/hasil organisasi terbaru, PDF/proposal final CEO, custom-proposal workspace, narasi AI individu, serta pilot dan analisis empiris. Developer pack memuat **enam kompetensi total: tiga free + tiga tambahan**, bukan enam tambahan berbayar. Dokumen komersial/organisasi di luar tiga file developer pack tetap memerlukan sumber CEO tersendiri.

## Bukti pemeriksaan rilis

- API: 497 tes lulus, 3 tes existing dilewati; app: 273 tes lulus. Tes SQL/HTTP/worker memakai instrumen dan pengiriman sintetis.
- Browser lokal: 18 tes desktop/ponsel lulus, termasuk entry baru, pending choice setelah reload, penguncian submit, email recovery tanpa ID, pemulihan pembacaan hasil, dan kompatibilitas riwayat akun. Enkripsi IndexedDB/kunci nonextractable serta tidak adanya overflow diperiksa di browser.
- Build produksi app/API dan typecheck lulus. Lint app bersih; lint API tanpa error, dengan satu warning existing pada `pdf-service.tsx` yang tidak diubah dalam rilis ini.
- Tidak menjalankan SQL, mengirim email atau mengecek delivery produksi. Scheduler produksi belum dibuktikan aktif. Uji internal nyata pada langkah deployment tetap diperlukan sebelum menyebut alur produksi siap.
