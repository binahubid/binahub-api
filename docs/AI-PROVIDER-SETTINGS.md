# Pengaturan provider AI — 0.36.0

## Operasional admin

1. Buka **Pengaturan → Provider AI** di app BinaHub.
2. Pilih **Jadikan … utama** untuk LapakVIP, Codecraft, atau OpenRouter.
3. Aktifkan/nonaktifkan sakelar cadangan sesuai kebutuhan, lalu **Simpan pilihan**.

Hanya satu primary, selalu aktif. Pilih primary lain sebelum mematikannya. Provider tanpa API key server tidak dapat diaktifkan. Status “API key tersedia” hanya memeriksa konfigurasi, bukan saldo, limit atau kesehatan layanan. Provider dan model berbeda: memilih provider memakai model general/reasoning/vision yang sudah dikonfigurasi untuk provider itu; tidak mengganti ID model atau membeli saldo.

Urutan cadangan mengikuti LapakVIP → Codecraft → OpenRouter, setelah primary dikeluarkan dari daftar tersebut. Router mencoba fallback model yang sudah tersedia pada tiap provider, dalam anggaran waktu yang ada. Tidak ada AI call saat membuka atau menyimpan Settings. Pengaturan baru berlaku pada request berikutnya; request yang sudah berjalan memakai snapshot pilihannya sendiri. Jika semua provider aktif gagal, sistem mengembalikan kegagalan, bukan mengaktifkan provider lain diam-diam.

## Aktivasi teknis satu kali

1. Jalankan `supabase/migrations/0068_ai_provider_settings.sql` pada database API BinaHub. Aman dijalankan ulang; tidak me-reset pilihan admin. SQL ini tidak mengubah instrumen, hasil asesmen, atau API key.
2. Deploy API **0.36.0** terlebih dahulu, kemudian app **0.36.0** dan API AMS **0.11.0**.
3. API Vercel tetap menggunakan credential existing `LAPAKVIP_API_KEY`, `CODECRAFT_API_KEY`, `OPENROUTER_API_KEY` dan konfigurasi BASE_URL/MODEL masing-masing. Tidak perlu menyalin key provider ke app Hostinger. Provider yang belum punya key memerlukan konfigurasi awal server saja, bukan setiap berganti pilihan.
4. AMS memakai `APP_INTEGRATION_API_URL=https://api.binahub.id` dan `APP_INTEGRATION_SECRET` yang cocok dengan `AMS_INTEGRATION_SECRET` pada API BinaHub. Integrasi yang sudah dikonfigurasi tidak memerlukan secret baru. AMS meneruskan CV parsing/ranking lewat endpoint HMAC `/api/integrations/ams/ai/chat/completions`.

Tanpa `APP_INTEGRATION_SECRET`, AMS tetap memakai rute legacy sehingga belum dikendalikan oleh Settings terpusat. Jangan mengklaim pengaturan berlaku ke AMS sebelum API AMS baru terdeploy dan integrasi ini tersedia. API BinaHub harus dideploy lebih dulu: AMS terpusat tidak akan bypass ke provider langsung jika endpoint belum tersedia/gagal. Website memakai endpoint asesmen BinaHub sehingga tidak memerlukan perubahan frontend sendiri.

Sebelum SQL 68 atau sebelum admin pertama menyimpan, API mempertahankan routing legacy (LapakVIP jika tersedia; Codecraft hanya jika LapakVIP tidak tersedia; OpenRouter sebagai cadangan). Cadangan Codecraft tidak dinyalakan otomatis saat upgrade. Kegagalan database selain tabel belum tersedia tidak boleh menimpa pilihan tersimpan dengan default env.

## Keamanan dan batas

- Akses GET/POST hanya admin terverifikasi, audit actor berasal dari sesi server; perubahan menggunakan versi/CAS. Browser tidak punya akses langsung tabel/RPC.
- Respons admin hanya status ketersediaan dan nama model, tidak berisi API key/base URL/prompt. Audit hanya perubahan pilihan, bukan isi asesmen/CV.
- Integrasi AMS adalah server-to-server yang sudah dipercaya; HMAC memiliki batas waktu, payload dan token dibatasi. SDK tidak mengulang otomatis request router. Penyimpanan hasil dan idempotensi pekerjaan CV tetap memakai alur AMS existing.
- Kontrol provider bukan sertifikasi privasi, DPA, jaminan uptime atau jaminan mutu model. Provider aktif dapat meneruskan data kepada upstream sesuai ketentuannya. Tidak mengubah consent atau membuka akses data baru kepada browser.
- Tes unit/SQL/UI memakai data sintetis dan server lokal. Pernyataan verifikasi
  rilis 0.36.0 tidak mencakup panggilan model nyata. Pengecualian pemeriksaan
  koneksi sintetis 0.40.1 dijelaskan di bawah; kualitas laporan dan delivery
  produksi tetap belum dibuktikan oleh smoke test koneksi.

## Verifikasi

### Perbaikan fallback 0.40.1 (27 Oktober 2026)

- Setiap provider mendapat bagian tetap dari waktu yang tersisa. Retry model
  LapakVIP/Codecraft tidak lagi menghabiskan seluruh deadline sebelum OpenRouter.
  Retry model tetap dilakukan jika waktu provider masih tersedia. Model OpenRouter
  berbagi anggaran waktunya agar timeout model pertama tidak menutup model kedua.
- Model general/reasoning/vision yang diatur di env tetap diprioritaskan.
  Default dan cadangan bawaan OpenRouter kini `nvidia/nemotron-3.5-super-vl:free`.
  `OPENROUTER_FALLBACK_MODELS` dapat mengganti daftar cadangan (dipisah koma);
  nilai kosong eksplisit meniadakan cadangan model. Untuk vision, pilih model
  yang mendukung gambar. Provider yang OFF tidak pernah diaktifkan oleh fallback.
- Pemeriksaan database saat pengerjaan menunjukkan OpenRouter sebagai **utama**,
  bukan cadangan, dengan ketiga provider ON. Tidak ada pengaturan admin yang
  diubah. Jika ingin LapakVIP utama dan OpenRouter cadangan, gunakan Settings
  yang sudah ada; tidak perlu mengubah env Vercel setiap berpindah provider.
- Uji koneksi sintetis memakai key lokal yang tersedia: model terkonfigurasi
  `nvidia/nemotron-3-super-120b-a12b:free` mengembalikan HTTP 404 dari upstream,
  sedangkan `nvidia/nemotron-3.5-super-vl:free` mengembalikan penanda `BINAHUB_OK`.
  Uji ini tidak membaca/mengirim assessment atau CV. Ini bukti konektivitas saat
  diuji, bukan jaminan kualitas laporan, saldo/limit berikutnya, atau deployment
  Vercel. Kredensial Vercel dapat berbeda dari env lokal.
- Jalankan `npm run test:ai:fallback` untuk pengujian nyata eksplisit. Runner
  mensimulasikan LapakVIP/Codecraft gagal pada server loopback dengan key dummy,
  lalu mencoba OpenRouter nyata menggunakan pesan sintetis. Bisa memakai kuota;
  tidak dijalankan oleh test suite normal. Tidak ada pengiriman email atau SQL.

- API: `npm run typecheck`, `npm run test:run`, `npm run build`.
- App: `npm run typecheck`, `npm run test:run`, `npm run build`.
- AMS: `pnpm --filter @ams/ai build`, `npm run test:ai-router`, `npm run test:ai-managed`, `pnpm --filter @ams/api typecheck`.
- Sesudah deployment, login admin, pilih primary yang key-nya tersedia, simpan dan refresh. Pastikan hanya satu primary, versi bertambah, cadangan OFF tidak muncul sebagai provider yang digunakan pada request baru. Uji model berbayar hanya dengan akun/data internal dan persetujuan operasional.
