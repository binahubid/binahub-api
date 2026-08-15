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
OPENROUTER_API_KEY
OPENROUTER_MODEL
RESEND_API_KEY
EMAIL_FROM
EMAIL_COMPANY_COPY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_BINAHUB_API_URL
NEXT_PUBLIC_COMPANY_NAME
NEXT_PUBLIC_COMPANY_EMAIL
ADMIN_EMAILS
FACILITATOR_EMAILS
```

`PROPOSAL_LINK_SECRET` dan `TRANSFORMATION_WORKER_SECRET` wajib berupa dua secret acak yang berbeda khusus production. Jangan memakai nilai yang diekspos ke browser atau menyimpan service-role key dalam variable berprefix `NEXT_PUBLIC_`.

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
