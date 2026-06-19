# BinaHub API

Backend API service for BinaHub.

## Target Domain

Deploy this project to Vercel and attach:

```txt
api.binahub.id
```

## Frontend Consumers

Allowed origins are configured in `src/lib/cors.ts`:

```txt
https://binahub.id
https://www.binahub.id
https://app.binahub.id
https://api.binahub.id
https://app-binahub.vercel.app
http://localhost:3000
http://localhost:3001
```

## Required Environment Variables

Set these in the Vercel project for Production, Preview, and Development as needed:

```txt
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_PASSWORD
OPENROUTER_API_KEY
OPENROUTER_MODEL
RESEND_API_KEY
EMAIL_FROM
EMAIL_COMPANY_COPY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_COMPANY_NAME
NEXT_PUBLIC_COMPANY_EMAIL
NEXT_PUBLIC_BINAHUB_API_URL
ADMIN_EMAILS
FACILITATOR_EMAILS
```

## Validate

```bash
npm run lint
npm run typecheck
npm run build
```
