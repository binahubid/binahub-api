# Keanggotaan konsultan melalui AMS

Keanggotaan dikelola di AMS; App menerima mirror yang berversi. Terapkan SQL93 setelah SQL56/90/92. Di AMS, terapkan migration 014. Tidak ada env baru. Draf perjanjian dan kompensasi ditinjau admin sebelum mengirim undangan. Persetujuan akun lama tidak dibuat otomatis.

Sinkronisasi memakai HMAC yang sama dengan integrasi program. Aktivasi lama tidak boleh menimpa pencabutan yang lebih baru. Identitas email tidak dipindahkan ke akun lain secara diam-diam.

Portal memverifikasi keanggotaan di AMS pada setiap permintaan pengguna non-admin. Verifikasi ulang dilakukan saat membuat/menukar tiket dan sebelum mengirim email konsultan. Gangguan integrasi menolak akses sementara; antarmuka menyediakan percobaan ulang. Keanggotaan tidak dibatasi tanggal program. Pengakhiran mencabut hak konsultan, sementara hak T-BOS dan admin dikelola terpisah.

API admin di App menolak aktivasi anggota dan undangan akun konsultan manual. Penugasan klien dan pengaitan booking tetap tersedia. Tombol AMS tersedia pada header App. Status anggota dan waktu persetujuan ditampilkan sebagai informasi baca saja.

Rilis: SQL pada kedua database, API APP, API AMS, lalu UI AMS dan App. Periksa CI dan HTTP tanpa autentikasi; uji mutasi hanya dengan fixture sintetis. Uji manual produksi dilakukan dengan associate yang memang akan diundang oleh admin.
