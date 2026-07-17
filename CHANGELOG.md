# Changelog

Semua perubahan yang signifikan pada proyek ini akan didokumentasikan di file ini.
Format yang digunakan berdasarkan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/), dan proyek ini mematuhi aturan [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-06-24

### Added
- Menambahkan autentikasi klien berbasis Supabase Auth. Endpoint `POST /api/client/access` membuat user Supabase per kode akses, menyimpan `access_code_id`, `organization_id`, dan `participant_id` di `user_metadata`, lalu mengembalikan `access_token` dan `refresh_token`.
- Menambahkan `getClientAccessBySupabaseUser()` untuk resolve access code dari metadata user Supabase.
- Menambahkan auto-generate kode akses saat program dibuat. `generateAccessCodesForEngagement()` membuat kode seperti `MASMINDO-A`, `MASMINDO-B` berdasarkan nama organisasi + suffix huruf, lengkap dengan hash SHA-256 dan expiry 90 hari.
- Menambahkan endpoint `GET /api/engagements/access-codes?engagement_id=...` untuk mengambil daftar kode akses per program.
- Menambahkan isolasi data server-side untuk pengguna klien: GET `/api/engagements` memfilter berdasarkan `organization_id`, GET `/api/evidence` dan `/api/actions` memfilter berdasarkan `participant_id`, GET `/api/capabilities/participant/:id` memverifikasi kepemilikan.
- Menambahkan `TransformationActor` yang diperkaya dengan `organizationId`, `participantId`, dan `accessCodeId` untuk filtering data di seluruh route handler.
- Menambahkan SQL migration `0006_access_code_links.sql` untuk menambahkan kolom `organization_id` dan `participant_id` ke tabel `app_client_access_codes` beserta indeks dan backfill data.

### Changed
- Mengubah `POST /api/engagements` untuk menerima array `participants` di body request, otomatis membuat participant, dan mengembalikan `accessCodes` dalam response.
- Mengubah `requireTransformationActor()` di `transformation/auth.ts` untuk mengembalikan actor yang diperkaya dengan `organizationId`, `participantId`, dan `accessCodeId` untuk pengguna klien.
- Mengubah `POST /api/client/access` dari cookie-based menjadi Supabase Auth session-based. User Supabase dibuat sebagai `client-{access_code_id}@binahub.local` dengan role `client` di `app_metadata`.
- Memperbarui semua route handler (engagements, evidence, actions, capabilities) untuk menggunakan data filtering berdasarkan peran pengguna.

### Notes
- Kode akses yang sudah ada (MASMINDO-A/B/C/D) sudah terhubung ke organization `PT Masmindo Dwi Area` dan participant masing-masing melalui migration `0006_access_code_links.sql`.
- Total: 36 API route files, 22 lib files, 2 migration files.

## [0.1.0] - 2026-06-18

### Added
- Menambahkan endpoint autentikasi admin (`/api/admin/session`), fasilitator (`/api/facilitator/session`), dan klien (`/api/client/access`, `/api/client/session`, `/api/client/logout`).
- Menambahkan endpoint diagnostik assessment (`/api/assessment`) dengan analisis AI 7 dimensi, generate PDF, dan kirim email hasil via Resend.
- Menambahkan endpoint chatbot AI (`/api/chat`) dengan tool-call pattern untuk save lead.
- Menambahkan endpoint kontak/inquiry (`/api/contact`) dengan email notifikasi ke admin.
- Menambahkan endpoint admin dashboard (`/api/admin/dashboard`) dengan agregasi data assessment, leads, inquiries, coaches, projects, dan smart actions.
- Menambahkan endpoint manajemen assessment admin (`/api/admin/assessments`) untuk resend email, request proposal, dan kirim proposal via AI.
- Menambahkan endpoint dokumen assessment (`/api/admin/assessments/documents`) untuk mengambil email dan PDF dari Resend.
- Menambahkan endpoint manajemen kontak (`/api/admin/contacts`) dan inquiry (`/api/admin/inquiries`) dengan update status dan catatan.
- Menambahkan endpoint follow-up email otomatis (`/api/admin/follow-up`) 3 tingkat dengan AI content generation dan cron processor.
- Menambahkan endpoint CRUD coach/associate (`/api/admin/coaches`) dengan audit logging.
- Menambahkan endpoint operasional coach (`/api/admin/coach-ops`) untuk assignment, availability, sesi, dan dokumen.
- Menambahkan endpoint manajemen project (`/api/admin/projects`) dengan auto-generate smart action.
- Menambahkan endpoint AI Project Autopilot (`/api/admin/project-autopilot`) untuk generate roles, matching associates, dan kirim invitation.
- Menambahkan endpoint smart actions (`/api/admin/smart-actions`) dengan status management.
- Menambahkan endpoint upload dokumen associate (`/api/admin/associate-documents`) ke Supabase Storage.
- Menambahkan endpoint ekstraksi LinkedIn (`/api/admin/linkedin-extract`) dengan AI.
- Menambahkan modul Transformation OS: engagements, participants, evidence, actions, reflections, capabilities, insights, dan event queue.
- Menambahkan endpoint team building scores (`/api/facilitator/team-scores`) untuk BinaPlay.
- Menambahkan endpoint evaluasi BinaImpact Level 1 (`/api/binaimpact/level1`).
- Menambahkan CORS proxy (`src/proxy.ts`) untuk semua origin yang diizinkan.
- Menambahkan layanan AI (`src/lib/ai-service.ts`) dengan OpenRouter untuk analisis assessment, scoring lead, generate proposal, follow-up, ekstraksi LinkedIn, dan autopilot project.
- Menambahkan layanan email (`src/lib/email-service.ts`) via Resend dengan branding BinaHub.
- Menambahkan layanan PDF (`src/lib/pdf-service.tsx`) untuk assessment result dan proposal.
- Menambahkan SQL migration `0005_transformation_os.sql` untuk seluruh schema Transformation OS.

### Changed
- Mengubah base URL API menjadi `https://api.binahub.id` untuk deployment terpisah dari frontend.
- Mengaktifkan CORS untuk `binahub.id`, `www.binahub.id`, `app.binahub.id`, dan local development.
