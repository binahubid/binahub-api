# Changelog

Semua perubahan yang signifikan pada proyek ini akan didokumentasikan di file ini.
Format yang digunakan berdasarkan [Keep a Changelog](https://keepachangelog.com/id/1.0.0/), dan proyek ini mematuhi aturan [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.18.0] - 2026-09-02

### Added — Phase 15 Controlled Pilot Safety

- Menambahkan master circuit breaker server-side `AUTOMATION_PILOT_ENABLED` dan `AUTOMATION_LIVE_ENABLED`; keduanya default tertutup dan tidak diekspos ke browser.
- Menambahkan evaluasi change window pada setiap runtime control. Mode pilot/live hanya efektif untuk release non-mock berstatus `scheduled` dengan waktu mulai dan selesai valid serta waktu eksekusi berada di dalam window.
- Menambahkan blocker aktivasi, status change window, release ID, dan eligibility ke audit run serta respons worker untuk rekonsiliasi operator.
- Menambahkan smoke gate read-only `npm run test:phase15` yang memverifikasi empat runtime tetap dry-run/disabled, kedua master switch tertutup, dan seluruh endpoint worker menolak pemanggil tanpa secret.

### Safety

- Requested mode database tidak lagi cukup untuk membuat worker efektif pilot/live. Environment dry-run, master switch, release, dan change window dievaluasi ulang pada setiap invocation.
- Release yang masih draft/approved, mock, belum mulai, sudah selesai, atau tidak memiliki window valid otomatis menurunkan effective mode ke `dry_run`.
- Fase 15 tidak mengaktifkan n8n, tidak mengubah runtime database, tidak membuat release, dan tidak mengirim outbound.

## [0.17.0] - 2026-09-01

### Added — Configurable Commercial & Learning Operations

- Menambahkan migration `0039_configurable_business_and_program_assessments.sql` untuk katalog publik, kebijakan minimum transaksi, owner/backup, approver/delegasi, SLA risiko, template dokumen, dan questionnaire per program.
- Menambahkan endpoint admin `/api/admin/catalog` untuk membuat, mengubah, mempublikasikan, mengarsipkan, dan menghapus produk/modul dengan audit trail.
- Menambahkan endpoint admin `/api/admin/business-settings` untuk seluruh kebijakan bisnis yang dapat dikonfigurasi tanpa deployment.
- Menambahkan endpoint admin questionnaire dan impor plain-text aman dari DOCX/TXT/CSV/JSON dengan batas ukuran, validasi tipe, preview, serta larangan mengganti soal setelah ada respons.
- Menambahkan endpoint peserta questionnaire dengan authorization program, required-answer validation, retake policy, deterministik scoring, dan penyimpanan attempt.
- Menambahkan statistik questionnaire keseluruhan dan per soal beserta unit test skoring/distribusinya.
- Menambahkan smoke gate `npm run test:phase14` untuk katalog publik dan boundary akses seluruh endpoint baru.

### Changed

- Memperluas modul program dengan `pre_test` dan `post_test` serta status penyelesaian pada ringkasan program peserta.
- Memperketat katalog publik agar hanya membaca item `public_visible`, siap, aktif, dan non-mock; payload publik kini memuat slug, scope, deliverables, minimum quantity, durasi, dan featured state.
- Menambahkan readiness counter untuk konfigurasi komersial, governance, approval, SLA, template finance/legal, questionnaire, dan RLS tabel baru.

### Safety

- Seluruh tabel baru memakai RLS, menolak privilege `anon`/`authenticated`, dan hanya diakses server melalui `service_role`.
- Impor DOCX hanya mengekstrak plain text; HTML dan macro dokumen tidak dirender atau disimpan.
- Nilai awal yang membutuhkan keputusan manusia dibuat fail-closed: delegasi/SLA nonaktif dan template finance/legal berstatus `review`.

### Operations — Phase 13 Evidence Kit

- Menambahkan `scripts/phase13-evidence.mjs` untuk preflight runtime control, production dry-run, duplicate/idempotency check, audit run, dan monitoring snapshot tanpa mencetak secret.
- Menambahkan `scripts/phase13-access-evidence.mjs` untuk membuktikan akses anonim, token invalid, dan role non-admin ditolak sementara admin sah dapat membaca endpoint; probe mutasi memakai payload kosong sehingga tidak mengubah data.
- Menambahkan `scripts/phase13-resend-evidence.mjs` untuk event bounce bertanda tangan valid, idempotensi webhook, audit delivery, dan suppression menggunakan alamat `example.invalid` tanpa outbound.
- Menambahkan `scripts/phase13-suppression-evidence.mjs` untuk menguji pause outreach dan inquiry setelah bounce pada lead UAT beralamat `example.invalid`; runner mengulang pemeriksaan scheduler pada business window tanpa mengirim email.
- Menambahkan `scripts/phase13-calcom-evidence.mjs` untuk menguji booking, reschedule, cancellation, no-show, idempotensi, lineage, dan audit webhook Cal.com dengan payload bertanda tangan valid tanpa membuat booking vendor.
- Menambahkan `scripts/phase13-client-lifecycle-evidence.mjs` untuk menguji handoff lead won, stakeholder, project risk, human task ber-owner, health review, repeat opportunity qualified, idempotensi, dan audit lifecycle lewat API admin pada data `example.invalid`; runner mencatat tiga skenario UAT setelah seluruh pemeriksaan lulus.
- Menambahkan `scripts/phase13-end-to-end-evidence.mjs` untuk menelusuri satu fixture `example.invalid` dari acquisition source/campaign, prospect, lead, seluruh stage opportunity, client/project, sampai repeat opportunity; campaign ditutup dan source dipause setelah evidence selesai.
- Menambahkan `scripts/phase13-proposal-gate-evidence.mjs` untuk membuktikan hard blocker proposal tidak dapat di-approve atau dikirim, tetap berada pada antrean human approval, dan tidak menghasilkan outbound; runner mencatat skenario UAT hanya setelah seluruh pemeriksaan lulus.
- Menambahkan command `test:phase13:access`, `test:phase13:automation`, `test:phase13:calcom`, `test:phase13:client-lifecycle`, `test:phase13:end-to-end`, `test:phase13:proposal-gate`, `test:phase13:resend`, dan `test:phase13:suppression` agar evidence Fase 13 dapat diulang secara eksplisit.
- Memperketat runner automation dengan failed-run retry probe untuk Client Operations dan Acquisition, lalu mencatat UAT automation/suppression hanya setelah business-window evidence benar-benar lengkap.
- Menambahkan governance preparation yang menetapkan empat monitoring policy real ber-owner dan membuat 18 template ID/EN non-mock berstatus draft review, dengan satu CTA Cal.com dan tanpa instruksi membalas alamat no-reply.
- Script menolak memanggil worker jika salah satu runtime control database bukan `dry_run` dan memerlukan konfirmasi eksplisit untuk target production.
- Perubahan ini merupakan alat operator lokal dan tidak memerlukan deployment runtime baru.

## [0.16.2] - 2026-09-01

### Fixed — Client Handoff Source Compatibility

- Menambahkan migration `0038_client_handoff_source_id_compatibility.sql` setelah UAT production menemukan `projects.source_id` bertipe UUID pada schema legacy sementara RPC handoff lama selalu mengirim text.
- Menghidrasi `source_id` melalui row type `projects` sehingga `convert_won_lead_to_client` kompatibel dengan schema UUID production maupun schema text pada instalasi baru.
- Menambahkan readiness flag `client_handoff_source_id_compatibility_ready` agar perbaikan dapat diverifikasi tanpa mutasi.

## [0.16.1] - 2026-08-30

### Changed — BinaInsight Executive Report

- Mencegah pemenggalan kata di tengah baris dan menormalisasi jarak pada narasi hasil assessment.
- Menghapus pemangkasan narasi dengan elipsis agar insight, analisis, diagnosis, dan rekomendasi tetap utuh.
- Mengganti sistem visual lama berbasis rounded card dan border aksen satu sisi dengan grid editorial korporat, sudut tegas, garis pemisah netral, whitespace luas, dan aksen warna yang hanya dipakai pada data penting.
- Menata ulang KPI, visual radar, portofolio skor, rekomendasi bernomor, dan timeline 90 hari mengikuti hierarki laporan eksekutif perusahaan besar.
- Menyeimbangkan kepadatan empat halaman tanpa mengubah formula skor, konten AI, pengiriman email, atau format data assessment.

## [0.16.0] - 2026-08-30

### Added — Phase 12 Pilot Rehearsal & Acceptance

- Menambahkan migration `0037_phase12_pilot_rehearsal_certification.sql` untuk rehearsal, delapan langkah evidence, acceptance certification, dan audit event.
- Menambahkan endpoint admin `/api/admin/pilot-certification` beserta schema validasi dan boundary akses admin.
- Menambahkan gate acceptance pada keputusan go/no-go, scheduling release, dan perubahan runtime ke pilot/live.
- Menambahkan readiness flag/counter Phase 12 serta smoke gate `npm run test:phase12`.

### Safety

- Rehearsal dikunci `dry_run=true`; kelulusan membutuhkan production rehearsal non-mock dan snapshot real berusia kurang dari 24 jam.
- Acceptance tidak mengaktifkan workflow, mengubah environment, atau mengirim outbound; aktivasi tetap merupakan deployment manusia terpisah.

## [0.15.0] - 2026-08-30

### Added — Phase 11 Operational Assurance

- Menambahkan migration `0036_phase11_operational_assurance.sql` untuk policy monitoring, snapshot kesehatan, incident register, audit event, dan keputusan go/no-go.
- Menambahkan evaluator deterministik untuk minimum evidence, failure rate, consecutive failure, stale run, serta drift environment/runtime.
- Menambahkan endpoint admin `/api/admin/operational-assurance` dan watchdog `/api/automation/pilot-monitoring` dengan secret terpisah.
- Menambahkan smoke gate Fase 11 dan readiness counter untuk policy, snapshot, incident, review aktif, serta RLS seluruh tabel baru.

### Safety

- Policy awal tetap mock dan keputusan go ditolak sampai policy real memiliki owner, UAT lulus, snapshot real masih fresh, serta incident blocking selesai.
- `PILOT_MONITOR_DRY_RUN=true` hanya mencatat snapshot; finding tidak dibuat menjadi incident otomatis.
- Go/no-go tidak mengaktifkan n8n, tidak mengubah environment, dan tidak mengirim outbound. Mode pilot/live tetap memerlukan deployment terpisah.

## [0.14.0] - 2026-08-30

### Added — Phase 10 Controlled Pilot Operations

- Menambahkan migration `0035_phase10_pilot_operations_control_plane.sql` untuk release plan, requested runtime mode, limit per run, kill switch, dan audit event.
- Menambahkan RPC tervalidasi yang mengunci approval pilot sampai Human UAT, template outreach, dan Business Rules benar-benar siap.
- Menambahkan endpoint admin `/api/admin/pilot-operations` dengan readiness gate, mutasi release, dan runtime control yang tidak dapat mengubah environment atau mengaktifkan n8n.
- Menerapkan effective-mode fail-closed pada Follow-up, Event Worker, Client Operations, dan Acquisition; environment dry-run selalu menjadi otoritas terakhir.
- Menambahkan pemeriksaan readiness terhadap seed control, audit trail, orphan release aktif, serta approval mock.

### Safety

- Release tidak dapat dipause, di-rollback, atau diselesaikan sebelum runtime control pilot/live dikembalikan ke dry-run atau disabled.
- Kill switch memerlukan alasan dan worker yang disabled berhenti dengan HTTP 423 sebelum memproses data.

## [0.13.0] - 2026-08-30

### Added — Phase 9 Human UAT & Pilot Gate

- Menambahkan migration `0034_phase9_human_uat_pilot_gate.sql` untuk 12 skenario UAT wajib, owner, environment, bukti, hasil aktual, blocker, dan audit event immutable.
- Menambahkan RPC tervalidasi `update_uat_scenario` dengan RLS dan service-role boundary; skenario wajib tidak dapat dilewati dan hasil lulus/gagal wajib memiliki bukti.
- Menambahkan endpoint admin `/api/admin/pilot-readiness` untuk membaca readiness serta menyimpan hasil UAT tanpa kemampuan mengaktifkan workflow.
- Menambahkan evaluator dan unit test yang hanya menghasilkan `eligible_for_human_review` setelah seluruh skenario wajib lulus, sambil mempertahankan `activationLocked=true`.
- Menambahkan readiness gate `human_uat_pilot_gate_phase9_ready`, pemeriksaan definisi, dan counter progres eksekusi manusia.

## [0.12.0] - 2026-08-30

### Added — Phase 8 Launch Control & Observability

- Menambahkan endpoint admin read-only `/api/admin/launch-readiness` yang menggabungkan status environment tanpa mengekspos secret, Business Rules, katalog, template, acquisition governance, integration evidence, dan automation run terakhir.
- Menilai empat workflow secara terpisah: konfigurasi, bukti dry-run, blocker bisnis, dan kelayakan untuk human review. Endpoint tidak menyediakan mutasi atau aktivasi workflow.
- Menambahkan audit run database untuk Follow-up Scheduler dan Transformation Event Worker sehingga seluruh workflow inti mempunyai bukti eksekusi yang konsisten.
- Menambahkan evaluasi pure-function dan test untuk memastikan Business Rules/template yang belum final tetap mengunci outbound serta mode live tidak pernah dianggap aman secara otomatis.

## [0.11.2] - 2026-08-29

### Fixed — Phase 7 Integrated UAT

- Memperbaiki `sync_client_operations_tasks` yang gagal dengan `UNION types text and uuid cannot be matched` melalui explicit UUID typing pada kandidat nullable.
- Mengizinkan run Operations berstatus `failed` serta Acquisition berstatus `failed`/`partial` diklaim ulang secara race-safe tanpa membuat idempotency key atau audit run duplikat.
- Menyimpan lineage `iCalUID` Cal.com agar reschedule/cancellation tidak meninggalkan booking lama berstatus `confirmed`.
- Menambahkan readiness gate `client_operations_phase7_ready` dan `calendar_booking_lineage_phase7_ready`.
- Menambahkan smoke-test repeatable `npm run test:phase7` untuk kontrak katalog, auth boundary, webhook signature, CORS, dan security headers.

### Security & Verification

- Endpoint admin, automation, worker, Cal.com webhook, dan Resend webhook menolak request tanpa credential/signature yang valid.
- Lint, typecheck, 77 unit test, production build, audit dependency, serta migration dry-run/live pada PostgreSQL 16 disposable lulus.

## [Unreleased] - 2026-08-15

### Fixed — Audit revisi CEO dan production hardening

- Menjadikan role pada tabel `profiles` sebagai sumber otorisasi utama dan menerapkan scope program/participant pada seluruh route T-BOS, LEP, dan Transformation OS.
- Membuat submit observasi, roster tim, submit LEP, batch, dan assignment fasilitator atomik serta race-safe melalui RPC dan constraint database.
- Mengamankan endpoint publik dengan rate limit persisten, token kepemilikan sesi chat, expiry sesi, validasi payload, escaping HTML, dan proposal dua langkah GET-konfirmasi/POST-eksekusi.
- Mengikat akun client ke `auth_user_id`, memperbaiki autentikasi bearer dashboard client, serta mengganti kode akses predictable dengan nilai acak.
- Menambahkan export Transformation yang sebelumnya dipanggil UI tetapi belum tersedia, pagination eksplisit, proteksi formula CSV, dan validasi UUID/range/tanggal.
- Menambahkan migration hardening `0015`/`0016`, readiness SQL, serta runbook aman untuk dua riwayat migration lama yang memiliki prefix bertumpang tindih.
- Memperbarui Next.js ke patch aman; audit dependency frontend dan API bersih.

## [0.11.1] - 2026-08-29

### Fixed — Phase 6 Release Reconciliation

- Menambahkan migration `0031_phase6_release_reconciliation.sql` untuk menetapkan BinaInsight public assessment sebagai katalog resmi `v1.0-public` tanpa mengubah modul komersial mock.
- Membatasi katalog publik hanya pada produk `ready` dengan modul aktif, `ready`, dan non-mock.
- Menghapus klaim pajak statis dari respons katalog selama wording Finance/Legal belum final.
- Menambahkan readiness gate `public_catalog_phase6_ready`.

## [0.11.0] - 2026-08-29

### Added — Acquisition Governance & Growth Operations

- Menambahkan migration `0030_acquisition_governance_and_growth_ops.sql` untuk governed source, campaign, import batch, prospect staging, dan acquisition audit trail.
- Menambahkan validasi batch terhadap legal source, approved campaign, email suppression, duplicate existing lead, duplicate dalam batch, dan opt-out.
- Menambahkan human review batch serta processor dry-run/idempotent yang hanya mempromosikan record valid ke existing leads sebagai lifecycle `consumer`.
- Menambahkan endpoint admin acquisition, endpoint processor n8n, dan readiness gate `acquisition_governance_phase5_ready`.

### Safety

- Source outbound approved membutuhkan lawful basis, retention period, data owner, legal owner, privacy notice, dan human approval.
- Processor tidak melakukan scraping, enrichment, email blast, atau keputusan komersial.
- Data invalid, suppressed, opted-out, dan duplicate tidak pernah dipromosikan menjadi lead baru.

## [0.10.0] - 2026-08-29

### Added — Automation Control & Human Task Operations

- Menambahkan migration `0029_automation_control_and_human_tasks.sql` untuk operational task, append-only task event, serta audit automation run yang idempotent.
- Menambahkan scheduler deterministik untuk client review, renewal 90/60/30, account/delivery risk, milestone overdue, dan retention next action.
- Menambahkan endpoint cron Fase 4 yang aman secara default melalui `OPERATIONS_DRY_RUN=true` serta endpoint admin untuk membaca dan menyelesaikan human task.
- Menambahkan readiness gate `automation_control_phase4_ready`.

### Safety

- Scheduler tidak mengirim email, mengubah deal, menyetujui proposal, atau menyelesaikan task.
- Task aktif wajib memiliki owner; task selesai/dibatalkan wajib memiliki catatan resolusi dan actor.
- Task key dan automation run idempotency mencegah duplikasi saat n8n melakukan retry.

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
