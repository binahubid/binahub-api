# Proposal standar: deployment dan pemulihan

## Deployment

Deploy API **0.27.9** dan app **0.26.9** bersama. Tidak ada SQL/migrasi baru. Website-prod dan AMS tidak berubah dalam perbaikan ini karena tautan permintaan dari email dan pengiriman proposal ditangani API.

Pastikan secret API `LAPAKVIP_API_KEY`, `RESEND_API_KEY`, dan `PROPOSAL_LINK_SECRET` tetap tersedia, serta URL API/app dan katalog resmi migrasi 0059 sudah benar. Secret tidak perlu dibagikan atau dimasukkan ke Git.

## Perjalanan klien

1. Klien membuka tombol Preliminary Recommendation dari email hasil assessment.
2. Halaman menampilkan konfirmasi singkat. GET tidak mengirim email, sehingga pemindai tautan email tidak memicu proposal.
3. Setelah klien menekan **Kirim permintaan proposal**, tombol terkunci dan spinner langsung tampil.
4. API menyimpan permintaan lalu segera menampilkan **Permintaan proposal diterima**. Pemilihan solusi, penyusunan, dan pengiriman berjalan setelah respons; halaman tidak menunggu AI.
5. Proposal memakai kebutuhan assessment, rincian katalog CEO, harga dasar tetap, dan kuantitas/durasi yang jelas. AI tidak boleh mengarang kode modul atau harga. Jika AI pemilihan gagal, pencocokan kebutuhan ke modul resmi hanya dipakai bila bukti relevansinya cukup kuat.
6. Email proposal dan status Terkirim tercatat. Kebutuhan custom tetap dibahas dengan klien dan proposal custom dibuat manual oleh CEO di luar aplikasi.

Permintaan dengan kebutuhan yang tidak didukung modul standar, rincian/harga tidak lengkap, atau nilai di luar batas komersial yang diizinkan tetap ditahan untuk tindak lanjut internal. Kondisi ini tidak dijelaskan dengan jargon teknis kepada klien.

## Memulihkan permintaan lama

Setelah deployment, buka **Assessment Admin**, cari assessment klien yang tertahan, lalu tekan **Buat & Kirim Standar** dan baca konfirmasinya. Tindakan ini benar-benar menyusun serta mengirim email ke klien; tidak hanya mengganti label menjadi Diminta. Panel memperbarui status berkala saat proses aktif.

- **Gagal Otomatis**: periksa log, lalu gunakan tindakan standar untuk mencoba lagi. Snapshot yang sudah dibuat dipakai kembali, bukan membuat penawaran baru.
- **Menunggu Approval** tanpa draf manual: periksa alasan pemilihan/katalog. Tindakan standar dapat mencoba ulang. Tombol persetujuan manual hanya muncul jika ada draf manual.
- **Perlu Rekonsiliasi**: jangan kirim ulang. Cocokkan arsip email/Resend dengan snapshot dan waktu pembuatan. Status ini juga dipakai jika jendela retry aman sudah lewat.
- **Sedang Disusun** yang tidak bergerak setelah beberapa menit: periksa log dan arsip pengiriman sebelum koreksi status. Tidak ada reset otomatis yang dapat berisiko mengirim duplikat.
- Draf manual dan proposal yang sudah terkirim tidak ditimpa oleh jalur otomatis.

## Retry terjadwal opsional

Pemrosesan awal sudah berjalan otomatis melalui `after()`. Sebagai pemulihan untuk permintaan tercatat yang gagal sementara atau belum mulai diproses, tersedia endpoint internal:

```text
POST https://api.binahub.id/api/automation/standard-proposals
x-worker-secret: <TRANSFORMATION_WORKER_SECRET dari secret store>
```

Endpoint mati secara default (`STANDARD_PROPOSAL_RETRY_ENABLED=false`). Jika ingin mengaktifkannya, atur switch menjadi `true` pada environment API dan jadwalkan POST setiap 2–5 menit melalui scheduler yang dipilih. Endpoint memproses maksimal satu permintaan per run, hanya Diminta/Gagal Otomatis yang lebih dari dua menit, dengan maksimal tiga kegagalan tercatat. Jangan menaruh secret pada URL, browser, atau tautan publik. Jangan aktifkan scheduler lain yang juga mengirim proposal assessment yang sama.

Retry dapat mengirim email nyata. Scheduler ini **belum dibuat atau diaktifkan** oleh perubahan kode.

## Verifikasi

Tes otomatis menggunakan database dan email simulasi. Audit assessment nyata hanya membaca DB dan memeriksa pemilihan modul melalui LapakVIP; tidak mengirim email. Preview seluler memakai server lokal tanpa kredensial atau akses DB. Sesudah deployment, uji satu assessment akun internal sampai email proposal diterima sebelum demo klien.
