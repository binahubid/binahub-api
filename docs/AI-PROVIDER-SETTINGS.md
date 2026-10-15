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
- Tes unit/SQL/UI memakai data sintetis dan server lokal. Uji saldo, kualitas bahasa dan delivery produksi belum dilakukan karena akan memakai data/kredit sungguhan. Tidak ada SQL, env, email atau panggilan model produksi dijalankan oleh developer.

## Verifikasi

- API: `npm run typecheck`, `npm run test:run`, `npm run build`.
- App: `npm run typecheck`, `npm run test:run`, `npm run build`.
- AMS: `pnpm --filter @ams/ai build`, `npm run test:ai-router`, `npm run test:ai-managed`, `pnpm --filter @ams/api typecheck`.
- Sesudah deployment, login admin, pilih primary yang key-nya tersedia, simpan dan refresh. Pastikan hanya satu primary, versi bertambah, cadangan OFF tidak muncul sebagai provider yang digunakan pada request baru. Uji model berbayar hanya dengan akun/data internal dan persetujuan operasional.
