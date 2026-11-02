# R05 — batas data untuk AI

API0.47.4, 2 November2026. Ini bukti perubahan source dan tes sintetis,
bukan verifikasi deployment, pentest produksi atau jaminan anonimitas.

## Jalur yang ditinjau

| Jalur | Data yang diperlukan | Pembatasan |
| --- | --- | --- |
| Diagnosis tim, pemilihan katalog, proposal, follow-up dan inquiry | Tantangan, sasaran, konteks organisasi, skor dan katalog yang disahkan | Identitas terstruktur yang tersedia diganti referensi sementara; pola email/telepon, URL dan kredensial dibatasi sebelum router |
| Lead discovery | Bukti kecocokan bisnis dan skor deterministik | Allowlist evidence skalar/sinyal teks; tidak mengirim seluruh record/evidence nested; nama prospek dan perusahaan dipseudonimkan |
| Project plan, pencocokan associate dan undangan | Lingkup, peran, keahlian dan ketersediaan | Tidak mengirim objek project/candidate mentah, notes, rate, nama/email/ID kandidat; hasil candidate-N diverifikasi lalu identitas dipasang dari record server |
| SPIN | Ringkasan kebutuhan terkonfirmasi dan katalog | Tetap memakai proyeksi strict yang sudah ada; evidence berkontak ditolak sebelum provider; envelope kontak submission tidak menjadi prompt |
| Wording PE | Anchor perilaku/kode yang disahkan untuk parafrasa | Tidak mengirim identitas, konteks pribadi, jawaban atau skor peserta; anchor tidak menjadi penjelasan publik mentah |
| Chat | Percakapan yang diperlukan untuk menjawab | Pola kontak/kredensial dan URL dibatasi; query/hash currentPath dibuang; email untuk save_chat_lead dipulihkan lokal |
| Impor profil LinkedIn | Teks profesional yang diminta admin | URL profil eksplisit tidak dikirim; pola kontak/kredensial dibatasi. Nama dalam teks impor masih dapat diperlukan untuk ekstraksi profil |
| Gateway AMS bertanda tangan | Pesan dari layanan AMS yang berwenang | Gateway adalah transport terautentikasi, bukan mesin anonimisasi. Ranking harus memakai AMS0.11.2; parsing CV adalah pengecualian bertujuan khusus di bawah |

PETA tidak memakai AI pada jalur yang ditinjau. App/website meneruskan ke API,
bukan alasan menghapus kontak dari penyimpanan, persetujuan atau proses kirim.
Tidak ada perubahan instrumen, formula skor, harga katalog, penerima, izin atau
retensi. Algoritme cadangan pencocokan existing tetap lokal.

## Referensi privat dan kegagalan

`AIPrivacyBoundary` memiliki peta pengganti acak per panggilan, hanya di memori.
Peta tidak dimasukkan ke pesan, log atau database. Nama/perusahaan yang diketahui
dan pola kontak diganti sebelum `callRoutedAI`, sehingga percobaan provider utama
dan fallback memakai payload terbatasi yang sama. URL/kredensial yang dihapus
tidak dipulihkan. Nilai string JSON dipulihkan melalui parse/stringify; kunci JSON
tidak diubah, dan teks biasa tidak dipotong hanya karena memuat kurung JSON.

Referensi asing/rusak ditolak saat validasi respons. Router dapat mengikuti
kebijakan fallback existing, bukan meneruskan penanda rusak ke pengguna.
Identitas kandidat selalu berasal dari pemetaan server, bukan nama/email
rekaan model. Batas numerik dan referensi peran tetap diperiksa.

## Pengecualian dan keterbatasan

- Parsing CV AMS memang mengekstrak nama/kontak dari CV yang diunggah pengguna.
  Nama, email, riwayat profesional dan tautan portofolio tidak dianggap anonim.
  Pola kredensial di teks dibuang sebelum provider utama/fallback/managed.
- Ini pseudonimisasi dan minimisasi, **bukan anonymization atau DLP lengkap**.
  Nama/alamat/kondisi sensitif di teks bebas yang tidak diketahui secara
  terstruktur, format kontak tersamarkan, atau rahasia di luar pola yang diuji
  masih dapat lolos. Instruksi tidak memasukkan data pribadi tetap diperlukan.
- Helper vision `analyzeImageWithAI` tidak ditemukan dipanggil dalam pencarian
  source aktif yang ditinjau; image payload tidak dianonimkan oleh patch ini.
  Pengaktifan jalur gambar baru wajib memiliki aturan data tersendiri.
- Kebijakan retensi/pelatihan provider, data yang pernah terkirim sebelum patch,
  dan payload dari deployment AMS lama tidak dibuktikan aman oleh tes source ini.
  Tidak ada penghapusan retroaktif di provider.

## Verifikasi dan deployment

- Tes helper mencakup nama berpetik/JSON ter-escape, kontak, URL privat,
  kredensial, scope antar-request dan JSON yang dipulihkan dengan aman.
- Tes fungsi memakai sentinel sintetis untuk diagnosis, lead, proposal, email,
  project, kandidat, impor profesional dan chat. Input asal, skor deterministik,
  harga/jumlah katalog dan bentuk draft tetap terjaga.
- Tes SPIN/PE existing dipertahankan; suite API berjalan tanpa tes live/private,
  provider berbayar, database produksi atau email nyata. CI sudah mencakup tes
  baru melalui suite sintetis existing.
- Deploy API0.47.4 dan AMS0.11.2, lalu periksa versi/CI di masing-masing layanan.
  Uji operasional berikutnya harus memakai peserta/kandidat sintetis; jangan
  mencatat prompt atau peta identitas untuk membuktikan proteksi.
- Tidak ada SQL/env baru dan tidak mengaktifkan scheduler. Build/push bukan
  bukti versi produksi sudah terganti. Tidak ada pemindaian Strix baru di batch ini.
