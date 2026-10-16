# Fondasi internal asesmen berbayar

Rilis API **0.37.0**, app **0.38.0**, 16 Oktober 2026.

## Yang sudah dapat dipakai

- Admin → Assessment → Individu → **Transaksi & paket**.
- Draft satu paket area tambahan, dengan data yang belum diputuskan tetap null:
  nama, deskripsi, harga total, kesempatan, batas mulai, waktu penyelesaian,
  masa simpan, ketentuan pembelian/refund dan referensi format laporan.
- Revisi append-only dan audit aktor. Penyimpanan memakai optimistic concurrency;
  pengulangan save yang sama setelah respons hilang tidak membuat revisi ganda.
- Daftar transaksi server-side, pencarian nomor/email dan filter status, maksimum
  50 terbaru dengan jumlah hasil. Ringkasan seluruh status bukan omzet/payout.
- Struktur terpisah untuk pelanggan, order snapshot, payment attempts, event
  terdeduplikasi, hak unik dan outbox. Tidak ada baris transaksi sintetis/seed.

## Batas tegas rilis ini

Ini implementasi **persiapan internal**, bukan checkout berbayar end-to-end.
`accepting_orders=false` dikunci constraint database. Tidak ada API membuat
charge/order publik, menandai lunas, grant manual, aktivasi jual, atau worker
pengiriman akses berbayar. Seluruh tabel menolak akses langsung anon,
authenticated dan service_role; service_role hanya dapat memanggil dua RPC
persiapan yang dibuka eksplisit. Endpoint admin memakai requireAdmin dan rate limit.

Pilihan gateway/merchant belum ada. Identitas pelanggan passwordless ber-scope,
checkout nyata, webhook, rekonsiliasi, refund, pengisian/laporan tiga area tambahan
dan pengiriman akses masih perlu implementasi berikutnya. Jangan memasang adapter
dummy atau menganggap tabel fondasi membuktikan integrasi tersebut sudah berjalan.

Asesmen gratis, soal, scoring CEO, laporan immutable, consent dan retensi existing
tidak berubah. Tidak ada penggabungan identitas atau jawaban berdasarkan email.
Harga/ketentuan/report yang diketik admin tetap draft, bukan persetujuan peluncuran.

## Deployment

1. Pastikan SQL 64B–67 sudah lengkap; konfigurasi AI SQL 68 tidak diubah.
2. Jalankan **seluruh** `supabase/migrations/0069_individual_commerce_foundation.sql`
   pada database API yang sama. Script bisa diulang tanpa mereset draft yang ada.
   Source privat instrumen harus sudah terdaftar; tidak ada bank soal di SQL 69.
3. Deploy API 0.37.0, lalu app 0.38.0. Buka **Transaksi & paket**, isi sebagian
   keputusan dan simpan; refresh untuk memastikan data benar-benar tersimpan.
4. Tidak perlu secret/env baru, gateway, scheduler atau n8n untuk persiapan draft.
   Membuka penjualan kelak memerlukan integrasi resmi dan verifikasi terpisah,
   bukan mengganti constraint/flag melalui SQL manual.

SQL produksi tidak dijalankan oleh agen. Screenshot/unit tests memakai data
sintetis; bukan bukti deployment, akun merchant, pembayaran atau email nyata.

## Pemeriksaan

- SQL melalui PGlite: harga null, default tertutup, validasi tipe/batas,
  histori revisi, retry response hilang, konflik admin, reapply, privilege,
  unique order/hak dan daftar hasil. Fixture SQL bukan source privat CEO.
- Route: auth/rate limit, data aman, harga nol/aktivasi palsu ditolak,
  query terikat, error prerequisite tanpa membocorkan error storage.
- App: draft null, payload/revisi, kegagalan/retry, isian tetap ada saat konflik,
  dan tidak ada tombol tandai lunas/aktifkan.
- UI desktop/ponsel melalui preview komponen sintetis, bukan bypass admin
  produksi. Auth gate/proxy existing tetap utuh.

Rancangan lintas repo: app `docs/individual-paid-assessment-plan.md` dan
`docs/individual-paid-assessment-ux.md`. Pemilihan gateway tetap milik CEO.
