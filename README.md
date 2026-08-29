# BinaHub API

Backend API untuk BinaHub, ditargetkan ke `api.binahub.id` dan dikonsumsi frontend `app.binahub.id`.

## Environment Wajib

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_PASSWORD
PROPOSAL_LINK_SECRET
TRANSFORMATION_WORKER_SECRET
FOLLOW_UP_CRON_SECRET
UNSUBSCRIBE_SECRET
CALCOM_WEBHOOK_SECRET
CALCOM_BOOKING_URL
OPENROUTER_API_KEY
OPENROUTER_MODEL
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
EMAIL_FROM
EMAIL_COMPANY_COPY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_BINAHUB_API_URL
NEXT_PUBLIC_COMPANY_NAME
NEXT_PUBLIC_COMPANY_EMAIL
ADMIN_EMAILS
FACILITATOR_EMAILS
```

`PROPOSAL_LINK_SECRET`, `TRANSFORMATION_WORKER_SECRET`, `FOLLOW_UP_CRON_SECRET`, `UNSUBSCRIBE_SECRET`, `CALCOM_WEBHOOK_SECRET`, dan `RESEND_WEBHOOK_SECRET` wajib berupa secret acak yang berbeda khusus production. `UNSUBSCRIBE_SECRET` minimal 32 karakter. Jangan memakai nilai yang diekspos ke browser atau menyimpan service-role key dalam variable berprefix `NEXT_PUBLIC_`.

Follow-up otomatis tersedia melalui `GET /api/admin/follow-up` dengan header `Authorization: Bearer <FOLLOW_UP_CRON_SECRET>`. Endpoint ini tetap memerlukan scheduler eksternal (misalnya n8n) dan tidak akan berjalan periodik hanya karena API sudah di-deploy. Worker event tersedia melalui `POST /api/events/process` dengan `TRANSFORMATION_WORKER_SECRET`.

Worker memakai header `x-worker-secret: <TRANSFORMATION_WORKER_SECRET>`. Gunakan `TRANSFORMATION_WORKER_DRY_RUN=true` pada lokal/UAT agar endpoint hanya menghitung `pendingDue` tanpa mengklaim atau memproses event.

Cron follow-up secara default hanya mengirim pada Senin-Jumat pukul 08.00-17.00 `Asia/Jakarta`. Atur `FOLLOW_UP_TIME_ZONE`, `FOLLOW_UP_WINDOW_START`, `FOLLOW_UP_WINDOW_END`, `FOLLOW_UP_WEEKDAYS`, dan `FOLLOW_UP_HOLIDAYS` untuk kalender operasional. Di luar jendela tersebut endpoint mengembalikan HTTP 202 dengan `deferred: true`.

Gunakan `FOLLOW_UP_DRY_RUN=true` pada lokal/UAT. Scheduler tetap membaca jadwal dan mengembalikan `candidates`, tetapi tidak membuat claim, memanggil AI, mengirim email, atau mengubah status lead. Production baru boleh memakai `false` setelah sender domain, suppression, isi pesan, dan policy follow-up disetujui.

Production follow-up juga mewajibkan Business Rules aktif dengan `activation.outboundAutomationEnabled=true` dan template outreach berstatus `approved`. Pertahankan `FOLLOW_UP_REQUIRE_APPROVED_TEMPLATE=true`; template draft/mock tidak pernah dipakai untuk pengiriman.

Proposal komersial memakai katalog harga per modul dan human gate dari migration `0024`. Selama rules atau modul masih mock, PDF diberi label simulasi dan pengiriman eksternal ditolak kecuali override environment khusus pengujian `ALLOW_MOCK_PROPOSAL_SEND=true` sengaja diaktifkan.

Katalog publik tersedia melalui `GET /api/catalog/modules`; endpoint hanya mengembalikan modul aktif, non-mock, dan berstatus `ready`. Webhook Cal.com tersedia pada `POST /api/integrations/cal-com/webhook` dan wajib memakai secret yang sama dengan konfigurasi webhook Cal.com. API memverifikasi header `X-Cal-Signature-256` sebelum menyimpan booking.

Webhook Resend tersedia pada `POST /api/integrations/resend/webhook`. Signature Svix diverifikasi dari raw body; event id disimpan secara idempotent. Bounce, complaint, dan provider suppression menambah alamat ke `email_suppressions`, sedangkan reply/failure/deliverability risk menjeda outreach untuk review manusia.

`EMAIL_REPLY_TO` bersifat opsional. Strategi awal BinaHub memakai no-reply dan mengarahkan penerima ke tombol Cal.com, assessment/result, pemilihan modul, atau unsubscribe; karena itu variable ini boleh dikosongkan. Jika inbound reply otomatis diputuskan pada fase berikutnya, siapkan receiving subdomain Resend terlebih dahulu, isi `EMAIL_REPLY_TO`, lalu aktifkan event `email.received`.

Daftar origin yang diizinkan berada di `src/lib/cors.ts` dan harus ditinjau setiap kali domain production/preview berubah.

## Database Deployment

Frontend dan API berbagi satu Supabase project, tetapi memiliki riwayat migration lama dengan prefix yang bertumpang tindih. Ikuti `supabase/DEPLOYMENT.md`; jangan langsung menjalankan `supabase db push` dari kedua folder pada database yang sama.

## Validasi

```bash
npm install
npm run lint
npm run typecheck
npm run test:run
npm run build
npm audit
```

Jalankan juga `supabase/production_readiness.sql` sebelum release production.
