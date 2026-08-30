# Supabase Deployment Runbook

Dokumen ini adalah urutan resmi untuk database bersama `app-binahub` dan `binahub-api`.

## Mengapa Tidak Boleh Menjalankan Dua `db push`

Kedua repositori memiliki migration historis bernomor `0005`–`0017`. Supabase mencatat versi dari prefix filename, sehingga menjalankan `supabase db push` dari kedua direktori dapat menganggap migration berbeda sebagai versi yang sama. Untuk database yang sudah berjalan, jangan rename, repair, atau replay migration lama tanpa membandingkan `supabase_migrations.schema_migrations` dan schema aktual.

## Existing / Production Database

1. Pastikan URL pada environment API menunjuk project yang benar. Ambil backup database terlebih dahulu.
2. Jalankan `npx supabase migration list` dari direktori yang sebelumnya menjadi sumber migration production. Jangan melakukan `migration repair` otomatis.
3. Jalankan `production_readiness.sql` secara read-only melalui SQL Editor.
4. Jika object dari migration API `0005`–`0014` sudah ada, jangan replay file tersebut.
5. Terapkan `0015_ceo_revision_hardening.sql` sampai `0035_phase10_pilot_operations_control_plane.sql`, masing-masing sebagai satu file penuh dan sesuai urutan. File `0021` mengunci idempotensi assessment, `0022` menambahkan BinaInsight sebagai modul program dan claim follow-up, `0023` menambahkan lifecycle lead, atribusi kampanye, suppression email, dan atomic claim untuk worker event, `0024` menambahkan katalog modul, Business Rules berversi, snapshot proposal, serta human gate, `0025` menambahkan request modul serta sinkronisasi booking Cal.com, `0026` menyimpan keputusan Business Rules v1 serta guardrail qualification/follow-up tanpa mengaktifkan proposal otomatis, `0027` menambahkan pipeline Sales Operations, audit activity, template outreach terkontrol, serta event deliverability email, `0028` menambahkan won-to-client handoff, delivery governance, account health, stakeholder, serta retention opportunity, `0029` menambahkan operational task, automation run audit, scheduler deterministik, SLA, serta human ownership, `0030` menambahkan source/campaign governance, prospect staging, dedupe, suppression, batch approval, dan promotion aman ke existing leads, `0031` merekonsiliasi status dan versi katalog BinaInsight publik, `0032` memperbaiki tipe kandidat scheduler operations, `0033` menyimpan lineage reschedule/cancellation Cal.com, `0034` menambahkan Human UAT & Pilot Gate, serta `0035` menambahkan controlled pilot release, runtime ceiling, dan kill switch.
6. Jalankan kembali `production_readiness.sql`. Semua kolom `*_ready`, termasuk `human_uat_pilot_gate_phase9_ready` dan `pilot_operations_phase10_ready`, harus `true`; seluruh counter `*_issues`, termasuk `pilot_operations_definition_issues`, `active_runtime_release_issues`, dan `pilot_release_mock_approval_issues`, harus `0`.
7. Deploy API lebih dahulu, lalu frontend. Lakukan smoke test role admin, fasilitator, dan peserta.

Jangan menandai migration sebagai applied hanya untuk melewati error. Error duplicate batch/speaker atau observasi tanpa program berarti data harus diperbaiki dengan keputusan bisnis sebelum migration dilanjutkan.

## Fresh Database

1. Terapkan migration `app-binahub/supabase/migrations/0001` sampai migration terakhir secara leksikografis.
2. Terapkan migration `binahub-api/supabase/migrations/0005` sampai `0034` sebagai raw SQL secara leksikografis, bukan sebagai riwayat kedua `db push`.
3. Jalankan seed T-BOS yang disediakan frontend bila data mission/dimensi belum terbentuk.
4. Jalankan `production_readiness.sql` dan health check T-BOS frontend.

Untuk jangka panjang, buat satu baseline schema bertimestamp setelah release production stabil dan jadikan satu direktori sebagai pemilik migration baru. Sampai baseline itu diuji pada restore production, runbook dua fase di atas tetap menjadi sumber kebenaran.

## Smoke Test Wajib

- Admin dapat membuat program berkode unik, memilih modul, membuat batch/tim, dan menugaskan orang tanpa memilih misi.
- Fasilitator memilih tepat satu pos yang terkunci, melihat seluruh tim, dan tidak dapat menilai ulang tim yang sudah selesai pada pos tersebut.
- Tim tanpa roster dapat diisi oleh fasilitator pertama; setelah observasi pertama roster master terkunci dan tersedia di semua pos.
- Dashboard fasilitator hanya menampilkan hasil seluruh tim pada misi pilihannya; dashboard admin tidak mencampur program.
- Peserta baru dapat mendaftar memakai kode program dan nama, menyimpan kode peserta yang ditampilkan satu kali, lalu login ulang hanya dengan kode peserta.
- Regenerasi kode peserta oleh admin menolak kode lama dan sesi dengan versi kredensial lama.
- Peserta/client hanya dapat mengirim satu LEP lengkap per program.
- Speaker LEP yang dihapus tidak menghilangkan hasil historis.
- Endpoint chat mewajibkan token sesi untuk melanjutkan session lama; link proposal kedaluwarsa ditolak.
- Parameter UTM dari landing page tersimpan pada assessment/lead dan tampil melalui data dashboard admin.
- Unsubscribe follow-up menambah email ke `email_suppressions`, menjeda follow-up target, dan pengiriman berikutnya ditolak.
- Dua worker event yang berjalan bersamaan tidak dapat mengklaim event yang sama; event gagal dijadwalkan ulang sampai maksimal lima percobaan.
- Admin dapat memilih modul katalog, membuat draft proposal, melihat alasan human gate, dan tidak dapat mengirim proposal sebelum status clear/approved.
- Proposal mock menampilkan watermark simulasi; modul belum siap dan diskon di atas batas absolut tidak dapat di-approve.
- Katalog publik tidak pernah mengembalikan modul mock atau modul yang belum berstatus `ready`.
- Webhook Cal.com dengan signature salah ditolak; event yang sama idempotent; create/reschedule/cancel/no-show tersimpan tanpa menggandakan booking.
- Business Rules `v1.0-approved-partial` tersedia sebagai `draft`, tidak menggantikan rules aktif, dan daftar activation blockers tetap terisi.
- Lead qualification menyimpan score, temperature, confidence, evidence, dan rule version; data yang belum tersedia tidak ditebak.
- Maksimum tiga follow-up dihitung per lead/opportunity lintas inquiry, assessment result, dan proposal.
- Admin dapat menetapkan owner, next action, due date, nilai peluang, stage won/lost, alasan lost, serta pause outreach; setiap perubahan memiliki audit trail.
- Template follow-up production wajib berstatus approved dan non-mock; activation outbound tetap menjadi pengunci kedua.
- Webhook Resend dengan signature salah ditolak; event duplikat tidak diproses ulang; bounce/complaint/suppression menjeda outreach dan masuk suppression list.
- Opportunity `won` hanya dapat di-handoff oleh admin dengan commercial owner, delivery owner, dan nama project; retry tidak membuat account atau initial project ganda.
- Client account memiliki stakeholder utama tunggal, delivery stage, milestone, risk summary, health review, dan activity trail.
- Account health berisiko membutuhkan next action serta due date; milestone blocked membutuhkan alasan.
- Retention opportunity pada tahap proposal/won ditolak tanpa human approval dan catatan approval.
- Operations scheduler dalam dry-run menampilkan kandidat tanpa membuat task; mode live memakai task key unik agar retry tidak menggandakan pekerjaan.
- Operational task aktif/menunggu memiliki owner; completed/cancelled memiliki catatan penyelesaian dan event audit.
- Source outbound tidak dapat approved tanpa lawful basis, retention period, data/legal owner, privacy notice, dan human approval.
- Batch prospect memisahkan valid, invalid, duplicate, suppressed, dan excluded; hanya batch approved yang dapat diproses.
- Acquisition processor dry-run tidak membuat lead dan live retry tidak menduplikasi email pada existing leads.
- Katalog BinaInsight publik memakai versi `v1.0-public`; tidak ada modul aktif, ready, non-mock yang masih membawa label versi mock.
