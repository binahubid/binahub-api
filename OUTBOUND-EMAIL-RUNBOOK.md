# Outbound dari aplikasi — panduan admin dan deployment

Rilis pasangan: app **0.28.0** + API **0.28.0**. SQL **60** wajib sebelum deploy API.
Email pertama memakai template marketing yang telah disetujui, bukan hasil AI bebas.
Tidak ada email dikirim, izin penerima diasumsikan, atau kontrol produksi diaktifkan oleh migrasi ini.

## Cara uji dengan daftar email yang sudah Anda punya

Setelah pengaturan awal siap, buka **Akuisisi & penjualan → Outbound**.
Tidak perlu menjalankan AI Lead Agent, mencari prospek lewat Apollo, atau membuat tautan satu per satu.

1. Pilih kampanye Email dan bahasa yang diinginkan.
2. Klik **Tambah target**. Tempel satu email per baris atau unggah CSV.
3. Klik **Periksa daftar → Simpan & validasi target**. Ini hanya menyimpan, belum mengirim.
4. Klik **Tinjau & setujui** pada daftar baru. Periksa alamat dan asal data, isi catatan pemeriksaan, lalu setujui. Ini juga belum mengirim.
5. Pilih target yang berlabel **Siap dipilih**, lalu **Lanjut ke email**.
6. Periksa subjek dan preview. Klik **Kirim email uji → Kirim uji**. Hanya akun admin yang menerima email uji; akun itu harus termasuk penerima yang diizinkan.
7. Cek inbox/spam dan tautan pada email uji. Setelah provider menerima email uji, kembali ke **Email & pengiriman → Tinjau & kirim**.
8. Periksa daftar alamat pada dialog, lalu **Konfirmasi pengiriman**. Respons tampil setelah antrean tersimpan; Anda tidak perlu menunggu semua penerima dikirim dalam layar yang sama.
9. Buka **Aktivitas** untuk memantau hasil. Jika cron belum dipasang, gunakan **Proses antrean berikutnya** untuk chunk berikutnya. Jangan membuat permintaan baru untuk mengulang email yang sama.

Untuk daftar yang sudah disetujui dan email uji yang masih berlaku, alurnya lebih singkat: **pilih target → Lanjut ke email → Tinjau & kirim → konfirmasi**.
Uji berlaku 24 jam untuk kampanye, bahasa, admin, dan isi/versi template yang sama. Mengubah template mewajibkan uji baru.

### Format daftar

Email saja:

```text
email-internal-anda@domain-perusahaan.id
email-uji-kedua@domain-perusahaan.id
```

CSV, dengan pemisah koma:

```csv
name,email,company,consent_status
Nama Penerima,email-internal-anda@domain-perusahaan.id,Perusahaan Anda,unknown
```

- Ganti contoh dengan akun milik Anda/target yang benar-benar boleh dihubungi. Jangan mengirim ke alamat contoh.
- Email saja menggunakan sapaan netral **Bapak/Ibu**. Gunakan nama/perusahaan dalam CSV untuk personalisasi.
- `unknown` tidak berarti persetujuan. Pada sumber berbasis `consent`, penerima harus memiliki bukti yang benar dan status `opted_in`; jangan mengubah status hanya agar lolos.
- Maksimal 500 target per impor, 2 MB per file di alur utama, dan 50 penerima per konfirmasi. Daftar terlalu besar ditolak, bukan dipotong diam-diam.
- Layar memuat 500 target/pengiriman terbaru per kampanye; angka berlabel sampel, bukan total seluruh riwayat. Pilih kampanye khusus uji agar daftar mudah dipetakan.
- Jika hanya sebagian target suatu daftar tersedia di sampel, persetujuan dari layar ini ditahan. Perbarui data atau minta tim teknis membuka seluruh daftar; jangan menyetujui daftar yang belum dapat ditinjau utuh.
- Daftar jangan dihubungi, email tidak valid/ganda, data kedaluwarsa, dan izin yang dicabut tetap diblokir.

## Pengaturan awal — cukup sekali per kampanye

### 1. Deployment

1. Jalankan `supabase/migrations/0060_outbound_email_queue.sql` setelah seluruh migrasi terdahulu. Jangan deploy API baru lebih dahulu: tracking baru membaca kolom dari SQL 60.
2. Deploy API 0.28.0, lalu app 0.28.0.
3. Atur secret pada API, bukan pada browser/frontend:
   - `OUTBOUND_EMAIL_ENABLED=true` hanya saat pengiriman nyata memang akan diuji.
   - `RESEND_API_KEY`, `EMAIL_FROM` dari domain pengirim yang telah diverifikasi, dan `EMAIL_REPLY_TO`.
   - `NEXT_PUBLIC_BINAHUB_API_URL=https://api.binahub.id`.
   - `PUBLIC_WEBSITE_URL=https://binahub.id`.
   - `ACQUISITION_LINK_SECRET` dan `UNSUBSCRIBE_SECRET`, masing-masing minimal 32 karakter, berbeda dan tidak masuk Git.
4. Untuk scheduler, sediakan `OUTBOUND_EMAIL_CRON_SECRET` terpisah dan jadwalkan GET `/api/automation/outbound-email`, misalnya setiap menit, dengan header `Authorization: Bearer <secret>`. Jangan letakkan secret di URL.

SQL ini membuat antrean dan kontrol akses, bukan mengaktifkan sumber, kampanye, template, release, atau mengirim email. Konfigurasi cron dan environment tidak dilakukan otomatis dari workspace.

### 2. Sumber dan kampanye

Klik **Pengaturan kampanye** pada layar outbound:

- **Sumber daftar manual** membuat form sumber dengan kanal Outbound, provider Manual Upload, dan kode teknis otomatis. Isi nama yang mudah dikenali, asal/metode data sebenarnya, dasar penggunaan data, privacy notice, masa retensi, penanggung jawab data/legal, dan persetujuan manusia. Simpan sebagai **Disetujui** dan aktif.
- **Kampanye email** membuat form dengan kanal Email. Pilih sumber tadi, nama kampanye, penanggung jawab, dan UTM. Simpan sebagai **Disetujui** dengan persetujuan manusia. Jika menggunakan **Aktif**, tanggal mulai/akhir wajib berada dalam jadwal berjalan.
- Contoh UTM: source `internal_demo`, medium `email`, campaign `diagnosa_oktober_2026`. Tracking unik ditambahkan otomatis pada tombol diagnosa tiap email.
- Jika sumber manual/Apollo Anda sebelumnya sudah disetujui, gunakan sumber tersebut; tidak harus membuat duplikat. Kampanye untuk kirim awal harus menggunakan kanal **Email**, bukan **Other**.

### 3. Template dan kontrol pengiriman

- Template **marketing_blast_initial** untuk bahasa yang dipilih harus non-mock, disetujui, memiliki owner, serta CTA ke halaman diagnosis BinaHub (`/insight`, `/en/insight`, atau URL lama `/diagnosa` pada template CEO). URL lama tersebut dipetakan melalui tracking ke halaman `/insight` yang benar-benar tersedia; copy CEO tidak ditulis ulang. Variabel yang didukung: `{{name}}`, `{{company}}`, dan CTA `{{assessment_url}}` bila disediakan oleh template. URL website/footer biasa tidak diganti.
- Aktivasi outbound memakai aturan bisnis dan kesiapan template tindak lanjut yang sudah ada. Fitur ini tidak melewati gate tersebut. Template bisa diperiksa melalui pengaturan template outreach admin.
- Pengiriman memakai **kontrol operasional Follow-up Scheduler** yang sudah ada, bukan kontrol terpisah. Pilih release non-mock yang disetujui/diterima dan terjadwal pada jendela aktif, mode **Pilot**, owner, approval, rollback plan, serta batas item yang sesuai.
- Isi daftar penerima release dengan email admin dan target internal yang benar-benar akan diuji. Target di luar daftar ini diblokir, termasuk pada mode Live.
- API perlu `AUTOMATION_PILOT_ENABLED=true` dan `FOLLOW_UP_DRY_RUN=false` untuk Pilot. Live juga memerlukan `AUTOMATION_LIVE_ENABLED=true`.
- **Penting:** perubahan Follow-up Scheduler juga berlaku untuk otomatisasi follow-up yang memakai kontrol yang sama. Periksa scheduler/antrean follow-up yang sudah ada dan batasi audience release sebelum mengaktifkannya. Jangan mengaktifkan Live hanya untuk menghilangkan blocker.
- Persetujuan operasional, monitoring, UAT, Go/No-Go, dan acceptance yang sudah diwajibkan sistem tetap berlaku. Jika aktivasi ditolak, selesaikan persyaratan tersebut; jangan menonaktifkan gate.
- Jam kirim mengikuti `FOLLOW_UP_*`: default Senin–Jumat, 08.00–17.00 Asia/Jakarta, di luar hari libur yang dikonfigurasi. Antrean yang dibuat di luar jam ini menunggu worker pada jam berikutnya. Respons aplikasi cepat tidak menjanjikan email masuk inbox saat itu juga.

Layar outbound menampilkan **Pengiriman belum aktif · lihat yang perlu disiapkan** jika ada prasyarat yang belum lengkap. Impor dan tinjauan masih dapat dilakukan jika sumber/kampanye sudah disetujui.

## Arti status dan penanganan masalah

| Status layar | Artinya | Tindakan |
| --- | --- | --- |
| Dalam antrean | Tersimpan, belum diklaim worker | Tunggu jam/cron; bila belum ada cron gunakan Proses antrean berikutnya. |
| Sedang dikirim | Worker mengklaim penerima | Tunggu; jangan buat permintaan ulang. |
| Diterima penyedia email | Resend mengembalikan ID penerimaan | Cek inbox/spam atau arsip provider; bukan jaminan delivered/dibaca. |
| Tidak dikirim | Ditahan sebelum send, atau penerima disuppression | Baca alasan dan perbaiki sumber/izin melalui penanggung jawab. Tidak otomatis dikirim ulang. |
| Perlu diperiksa | Respons tidak pasti atau pencatatan sesudah send gagal | Cocokkan provider ID/idempotency key dengan arsip provider. Jangan klik ulang atau menghapus bukti antrean. |

- Dua klik, retry setelah koneksi putus, atau impor ulang alamat yang sama tidak mengirim ulang email pertama dalam kampanye yang sama. Database menyimpan kunci unik `(campaign, email)` untuk pengiriman awal.
- Worker mengklaim paling banyak 10 penerima sekali jalan, dengan batas kontrol runtime bila lebih rendah. Beberapa worker tidak boleh mengklaim baris yang sama.
- Proses `processing` yang terhenti lebih dari 10 menit ditandai **Perlu diperiksa** pada pemrosesan berikutnya, bukan dikirim ulang. Rekonsiliasi dilakukan dengan bukti dari provider oleh tim teknis.
- Perubahan template, sumber, campaign, audience, batch, retensi, atau opt-out diperiksa ulang sebelum send. Persetujuan pada layar sebelumnya bukan izin permanen.
- Email menyertakan unsubscribe melalui layanan email yang sama dengan follow-up.
- Klik CTA membawa UTM dan `bh_journey` ke halaman diagnosa. Lihat perjalanan di **Inbound** dan rincian tautan pada **Panel lanjutan outbound**. Klik dapat berasal dari pemindai keamanan email; jangan menyamakan klik dengan seseorang membaca atau membeli.
- Pengiriman awal sendiri tidak membuat lead/opportunity palsu. Konversi baru mengikuti interaksi/form klien dan proses acquisition yang sudah ada.

## Penilaian assessment setelah dua kolom dihapus

Aturan sekarang **v1.2-public-diagnostic**. Anggaran dan dukungan pengambil keputusan tidak menambah skor, sinyal minat, kelengkapan data, atau syarat Hot, termasuk jika tersimpan pada assessment lama.

| Komponen | Poin maksimal |
| --- | ---: |
| Assessment selesai | 15 |
| Tantangan minimal 20 karakter | 20 |
| Tujuan minimal 20 karakter | 10 |
| Perusahaan terkonfirmasi minimal 20 orang | 10 |
| Jabatan pengambil keputusan / manager-champion | 15 / 8 |
| Waktu mulai diketahui | 15 |
| Memilih konsultasi atau proposal | 10 |
| Dampak bisnis minimal 20 karakter | 5 |

Total maksimal 100. Empat sinyal minat: tantangan terisi, waktu diketahui, memilih konsultasi/proposal, dan dampak bisnis terisi. Hot memerlukan skor minimal 75, minimal 3 sinyal, assessment selesai, tantangan, waktu, serta pilihan konsultasi/proposal; exclusion industri/ukuran perusahaan tetap berlaku. Warm minimal 50 jika eligible; selain itu Cold.

**Kelengkapan data inti** menghitung 8 jawaban tersedia: ukuran perusahaan, jabatan, tantangan, tujuan, industri, lokasi, pilihan waktu, dan pilihan langkah berikutnya. Pilihan “belum ditentukan” adalah jawaban yang tersedia, bukan sinyal minat. Dampak bisnis opsional tidak mengurangi kelengkapan ini. Angka ini bukan confidence AI atau probabilitas closing.

Admin Assessment menghitung ulang tampilan assessment lama secara read-only. Riwayat skor lead/pipeline tidak ditimpa oleh membuka halaman; versi riwayat ditampilkan jika berbeda. Submission berikutnya menyimpan aturan v1.2. Tidak ada SQL reclassification massal atau email yang terpicu oleh perhitungan ulang ini.

## Verifikasi sebelum uji produksi

- Unit/integration test hanya memakai fixture dan provider yang dimock. Uji SQL memakai PostgreSQL dalam memori, bukan Supabase produksi ([panduan PGlite](https://pglite.dev/docs/)).
- Preview UI lokal (`scripts/assessment-preview`, parameter `?outbound`) hanya memakai data contoh dan tidak mempunyai akses API/database/email.
- Uji produksi pertama harus ke satu akun internal yang diizinkan. Verifikasi penerimaan email, unsubscribe, tracking/form, dan status admin sebelum menambah target nyata.
- Build/test lokal tidak membuktikan kredensial provider, domain pengirim, SQL produksi, scheduler, atau penerimaan inbox sudah benar. Tahap tersebut harus diverifikasi setelah deployment.
- Audit dependency API setelah patch: produksi 0 critical/high dan 3 moderate (Mammoth/argparse/sprintf-js); seluruh dependency juga masih mencatat 6 high pada dev toolchain. Tidak diklaim bebas kerentanan dan tidak dilakukan downgrade paksa.
