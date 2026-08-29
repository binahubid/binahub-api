# Changelog

Semua perubahan yang signifikan pada proyek ini akan didokumentasikan di file ini.
Format yang digunakan berdasarkan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/), dan proyek ini mematuhi aturan [Semantic Versioning](https://semver.org/).

## [Unreleased] - 2026-08-15

### Fixed — Audit revisi CEO dan production hardening

- Menjadikan role pada tabel `profiles` sebagai sumber otorisasi utama dan menerapkan scope program/participant pada seluruh route T-BOS, LEP, dan Transformation OS.
- Membuat submit observasi, roster tim, submit LEP, batch, dan assignment fasilitator atomik serta race-safe melalui RPC dan constraint database.
- Mengamankan endpoint publik dengan rate limit persisten, token kepemilikan sesi chat, expiry sesi, validasi payload, escaping HTML, dan proposal dua langkah GET-konfirmasi/POST-eksekusi.
- Mengikat akun client ke `auth_user_id`, memperbaiki autentikasi bearer dashboard client, serta mengganti kode akses predictable dengan nilai acak.
- Menambahkan export Transformation yang sebelumnya dipanggil UI tetapi belum tersedia, pagination eksplisit, proteksi formula CSV, dan validasi UUID/range/tanggal.
- Menambahkan migration hardening `0015`/`0016`, readiness SQL, serta runbook aman untuk dua riwayat migration lama yang memiliki prefix bertumpang tindih.
- Memperbarui Next.js ke patch aman; audit dependency frontend dan API bersih.

## [0.9.0] - 2026-08-29

### Added — Client Delivery dan Retention Operations

- Menambahkan migration `0028_client_delivery_and_retention.sql` untuk client account, stakeholder, delivery project, milestone, account health, retention opportunity, dan activity trail.
- Menambahkan konversi atomik serta idempotent dari opportunity `won` menjadi organisasi, client account, primary stakeholder, dan initial delivery project.
- Menambahkan endpoint admin untuk handoff, perubahan account/project, stakeholder, milestone, health review, serta retention opportunity.
- Menambahkan readiness gate `client_delivery_phase3_ready` untuk memastikan tabel, kolom, dan seluruh RPC Fase 3 tersedia.

### Safety

- Handoff ditolak jika lead belum `won`, perusahaan belum tersedia, atau commercial/delivery owner belum ditetapkan.
- Account berisiko membutuhkan alasan; milestone blocked membutuhkan blocker reason; health berisiko membutuhkan next action dan tenggat.
- Retention pada tahap proposal atau won membutuhkan human approval dan catatan approval.
- Activity client disimpan sebagai append-only audit trail dan retry handoff tidak membuat account/project ganda.

## [0.8.0] - 2026-08-29

### Added — Sales Operations dan Deliverability

- Menambahkan migration `0027_sales_pipeline_and_deliverability.sql` untuk owner peluang, next action, due date, nilai peluang, won/lost reason, human pause, dan audit trail atomik.
- Menambahkan endpoint admin pipeline serta pengelolaan template follow-up draft/approved/archived dengan approval note dan versi yang dapat diaudit.
- Menambahkan webhook Resend tervalidasi signature dan idempotent untuk delivered, reply, bounce, complaint, failed, dan suppression.
- Menambahkan ringkasan pipeline, aktivitas peluang, serta kesehatan email pada payload dashboard admin.
- Menambahkan qualification profile terstruktur pada lead dan memakainya untuk score, confidence, buying signals, serta ICP exclusion tanpa inferensi data kosong.

### Changed

- Follow-up production kini terkunci bila Business Rules outbound belum aktif atau template approved belum tersedia.
- Booking, reschedule, cancel, dan no-show Cal.com masuk activity trail; no-show menjeda outreach untuk keputusan manusia.
- Tautan konsultasi proposal memakai `CALCOM_BOOKING_URL`, bukan URL Calendly statis.

### Safety

- Bounce, complaint, suppression, failure, dan reply menjeda sequence terkait. Bounce/complaint/suppression juga menambahkan alamat ke suppression list.

## [0.7.0] - 2026-08-28

### Added — Business Rules v1 dan Qualification Guardrails

- Menambahkan migration `0026_business_rules_v1_confirmed.sql` yang menyimpan keputusan Business Rules terkonfirmasi sebagai draft non-mock, lengkap dengan activation blockers untuk data katalog, ownership, approver, SLA risiko, template, dan wording pajak yang masih terbuka.
- Menambahkan lead qualification deterministik dengan threshold Cold/Warm/Hot, syarat wajib Hot, minimum tiga buying signals, ICP minimum 20 orang, exclusion list industri, confidence, evidence, serta versi rule yang dapat diaudit.
- Menambahkan 12 field wajib proposal, daftar data yang belum lengkap, dan SLA review berbasis hari kerja.
- Menambahkan atomic claim follow-up per opportunity untuk mencegah lebih dari tiga pesan walaupun worker berjalan bersamaan.

### Changed

- Mengubah jam follow-up default menjadi Senin–Jumat pukul 08.00–17.00 WIB.
- Menghentikan follow-up ketika booking Cal.com aktif atau opportunity masuk tahap konsultasi, negosiasi, won, atau lost; booking baru juga otomatis menjeda antrean terkait.
- Menjadikan data proposal yang belum lengkap sebagai hard block yang tidak dapat dilewati melalui approval biasa.
- Mencatat snapshot sebelum/sesudah dan alasan pada audit approval proposal.

### Safety

- Proposal otomatis dan outbound tetap nonaktif karena katalog modul serta ownership belum lengkap; rule set v1 tidak diaktifkan oleh migration.

## [0.6.0] - 2026-08-28

### Added — BinaHub AI Business Process, Catalog, Proposal & Scheduling

- Menambahkan migration `0023_business_process_p0.sql`, `0024_business_rules_catalog_and_proposal_gate.sql`, dan `0025_catalog_requests_and_calcom.sql` untuk lifecycle lead, attribution, katalog modul, Business Rules berversi, proposal snapshot, human gate, request modul, serta booking kalender.
- Menambahkan endpoint katalog publik, Business Rules admin, draft/preview/approval proposal, unsubscribe, dan webhook Cal.com tervalidasi HMAC.
- Menambahkan lifecycle consumer → prospect → lead → client → retained, lead temperature, opportunity stage, source metadata, serta event worker dengan atomic claim, lease, retry, dan idempotensi.
- Menambahkan follow-up H+2/H+7/H+14 dengan suppression, unsubscribe one-click, pause, stop condition, audit event, dan window jam kerja.
- Menambahkan `FOLLOW_UP_DRY_RUN` serta `TRANSFORMATION_WORKER_DRY_RUN` untuk UAT tanpa pengiriman email, claim event, atau perubahan status data.
- Mendesain ulang PDF BinaInsight dan proposal indikatif dengan label simulasi/human gate untuk data katalog mock.

### Changed

- Menguatkan validasi assessment, contact, CORS, email, dan mutation schema untuk alur prospecting publik.
- Proposal tidak dapat dikirim sebelum human gate terpenuhi atau approval yang diwajibkan tersedia.

### Verification

- `npm test` lulus: 63 tes, 2 skipped.
- `npm run build` lulus pada Next.js 16.3.1.

## [0.5.0] - 2026-08-13

### Added — Modul LEP, Batch Fleksibel, Penugasan Fasilitator & RLS Hardening (Prompt 0–8)

#### Modul Program & Module Selector (Prompt 0)
- Menambahkan `GET/PUT /api/program-modules`: read/upsert modul per program (`program_modules`, module_key `tbos`/`lep`). PUT diblokir untuk role client.
- Migration `0009_program_modules.sql`: tabel `program_modules` + backfill modul `tbos` untuk program T-BOS yang sudah ada.

#### Batch Fleksibel (Prompt 1)
- Menambahkan `GET/POST /api/tbos/batches` (`POST` admin-only, validasi zod, error 409 bila nama batch duplikat per program) dan `DELETE /api/tbos/batches/[id]` (diblokir bila masih ada team yang terikat).
- Migration `0010_flexible_batches.sql`: tabel `batches` + kolom `tbos_teams.batch_id` + backfill batch dari string lama (`Batch 1`/`Batch 2`). Kolom `tbos_teams.batch` dipertahankan sebagai snapshot untuk kompatibilitas RPC DB.

#### Penugasan Fasilitator Sederhana (Prompt 2)
- Menambahkan `GET/POST/DELETE /api/tbos/facilitator-missions` (admin-only): assign fasilitator ke mission per program, dukungan bulk assign via `missionIds`, validasi role facilitator.
- Migration `0011_facilitator_missions.sql`: tabel `facilitator_missions`, migrasi data dari `tbos_facilitator_teams` (cross join semua mission per program), lalu drop tabel lama `tbos_facilitator_teams`.

#### Roster & Unik Nama Tim (Prompt 3)
- Migration `0012_unique_team_name.sql`: de-duplikasi tim ganda, index unik parsial `tbos_teams (engagement_id, batch_id, lower(name))` untuk menangani race condition input nama tim.

#### Modul LEP (Prompt 8)
- Menambahkan `GET/POST /api/lep/speakers` dan `DELETE /api/lep/speakers/[id]`: CRUD pemateri per program (POST admin-only, `sort_order` otomatis).
- Menambahkan `GET/POST /api/lep/responses`: cek status submit (GET), submit evaluasi (POST, `requirePeserta`/admin/facilitator), proteksi double-submit via unique constraint (409).
- Menambahkan `GET /api/lep/results` (admin-only): rata-rata 4 pertanyaan umum, rata-rata skor + komentar per pemateri, daftar jawaban open text, response rate (responden vs jumlah anggota tim peserta).
- Menambahkan `src/lib/peserta-auth.ts`: helper `requirePeserta` untuk role peserta/admin/facilitator.
- Migration `0013_lep.sql`: tabel `lep_speakers`, `lep_responses` (constraint `(program_id, profile_id)` unique), `lep_speaker_ratings`.

#### Keamanan / Infrastruktur
- Migration `0014_harden_rls_public.sql`: enable RLS untuk seluruh tabel `public`, revoke akses `anon`/`authenticated`, grant penuh ke `service_role` (bypass RLS), policy `profiles_select_self` (authenticated hanya baca profil sendiri), default privileges dirapikan. Menutup alert "rls_disabled_in_public".

## [0.4.0] - 2026-08-10

### Added — Program Scope & Organisasi
- Menambahkan `GET /api/organizations`: daftar organisasi (bagian dari program management).
- Menambahkan `GET /api/engagements/[id]`: detail program/engagement per id.
- Migration `0007_tbos_program_scope.sql`: kolom `engagements.code` (uniqua index lower), kolom `tbos_teams.engagement_id` → engagements.
- Migration `0008_tbos_legacy_program_mapping.sql`: backfill program T-BOS legacy (`TBOS-LEGACY-...`) untuk tim yang belum punya engagement.
- Memperbarui `GET /api/tbos/dashboard`, `GET /api/tbos/export` (kini route.tsx), `GET/PATCH /api/tbos/observations`, `GET/PATCH /api/tbos/teams/[id]` mendukung scope program.

## [0.3.1] - 2026-08-07

### Added
- Menambahkan `GET /api/auth/role`: mengembalikan role dari `profiles` table + URL redirect yang sesuai (peserta → `/peserta/dashboard`, facilitator → `/fasilitator/tbos`, admin → `/admin/dashboard`).
- Menambahkan `POST /api/admin/users/role`: admin mengubah role user di `profiles` table + force-logout via `supabase.auth.admin.signOut(userId, "global")` yang menginvalidate semua session user tsb.

## [0.3.0] - 2026-08-07

### Added — T-BOS API Routes
- Menambahkan `GET /api/tbos/missions`: mengembalikan missions ditugaskan ke fasilitator beserta dimensions dan levels.
- Menambahkan `POST /api/tbos/observations`: submit observasi baru dengan validasi facilitator↔mission mapping dan mission↔dimension mapping. Admin diblokir dari submit (hanya fasilitator).
- Menambahkan `GET /api/tbos/observations`: list observasi dengan filter teamId/missionId. Fasilitator hanya lihat observasi sendiri, admin lihat semua. Response include `lockedAt`, `revisionDeadline`, `canEdit` flag.
- Menambahkan `GET /api/tbos/observations/[id]`: detail observasi + audit log timeline (actor, action, previous_status, new_status, changes, timestamp).
- Menambahkan `PATCH /api/tbos/observations/[id]`: tiga aksi — `lock` (admin only, set status=locked), `unlock` (admin only, kembalikan ke submitted), `edit` (fasilitator/admin, dalam revision window, update scores + notes).
- Menambahkan `GET /api/tbos/dashboard`: data dashboard untuk admin — semua teams, observations (submitted/locked), dimensions, missions, mission-dimension mapping.
- Menambahkan `GET /api/tbos/teams` + `POST`: manajemen tim (admin only).
- Menambahkan `GET /api/tbos/export?format=csv`: export CSV raw observation data (team, mission, batch, facilitator, dimension, level, notes) dengan UTF-8 BOM untuk Excel compatibility.
- Menambahkan audit log: setiap aksi (create, edit, lock, unlock) tercatat di `tbos_observation_audit_log` dengan actor, role, action, previous/new status, dan changes (JSONB).

### Changed
- Mengubah `requireFacilitator` usage di POST observations: admin sekarang diblokir dari submit observasi (sesuai ROLES-PERMISSIONS.md §3 permission matrix).

### Fixed
- Memperbaiki typo "Exemplatory" → "Exemplary" pada CSV export level label.
- Memperbaiki audit log: entri "submit" yang misleading (mencatat previous_status="draft" padahal observasi langsung insert sebagai "submitted") dihapus.
- Memperbaiki revision window trigger: sekarang fire pada INSERT (bukan hanya UPDATE draft→submitted).

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
