# Phase 18 — Apollo Manual menuju Apollo API

## Keputusan operasional

Baseline Fase 18 yang dipakai sekarang adalah:

1. prospek dicari melalui antarmuka Apollo Free;
2. hasilnya diekspor atau dipindahkan ke template CSV BinaHub;
3. CSV/JSON diunggah ke Batch Prospek;
4. BinaHub memvalidasi data, memeriksa duplikasi dan suppression, lalu menempatkannya pada human review;
5. hanya prospek valid yang disetujui manusia dapat diteruskan oleh Acquisition Batch Processor.

Apollo API tetap tersedia di dalam arsitektur untuk aktivasi setelah paket Apollo mendukung People Search dan enrichment. Hunter hanya adapter alternatif dan tidak digunakan sekarang.

Tidak ada pengiriman email, outbound, approval batch, atau promosi menjadi lead yang dijalankan oleh modul discovery.

## Database

Migration berikut memang harus tetap terpasang:

- `0041_phase18_ai_lead_discovery.sql` menyediakan audit run dan kandidat;
- `0042_phase18_multi_provider_hunter.sql` memperluas kontrak menjadi multi-provider dan menambah status tinjauan perusahaan.

Migration `0042` tidak mengaktifkan Hunter dan tidak membuat panggilan eksternal. Tidak diperlukan rollback setelah strategi beralih ke Apollo manual.

## Environment API saat Apollo masih manual

Pasang pada deployment `binahub-api`:

```dotenv
LEAD_AGENT_PROVIDER=apollo
LEAD_AGENT_SOURCE_KEY=ai_lead_discovery_apollo
LEAD_AGENT_CAMPAIGN_CODE=AI_LEAD_DISCOVERY_APOLLO

LEAD_AGENT_MAX_CANDIDATES_PER_RUN=10
LEAD_AGENT_MAX_CANDIDATES_PER_DAY=25
LEAD_AGENT_MIN_SCORE=50
LEAD_AGENT_REQUEST_TIMEOUT_MS=20000

# Seluruh otomasi dikunci selama memakai Apollo Free/manual.
LEAD_AGENT_ENABLED=false
LEAD_AGENT_PROVIDER_CALLS_ENABLED=false
LEAD_AGENT_DRY_RUN=true
LEAD_AGENT_STAGING_ENABLED=false
LEAD_AGENT_APOLLO_ENRICH_WORK_EMAILS=false
LEAD_AGENT_AI_SCORING_ENABLED=false

# Belum diperlukan sampai Apollo API Pro diaktifkan.
LEAD_AGENT_SECRET=
APOLLO_API_KEY=

# Provider alternatif tidak digunakan.
HUNTER_API_KEY=
LEAD_AGENT_HUNTER_ENRICH_WORK_EMAILS=false
LEAD_AGENT_HUNTER_AI_QUERY_ENABLED=false
LEAD_AGENT_HUNTER_MAX_DOMAIN_SEARCHES_PER_RUN=0
```

Status panel otomatis akan menunjukkan bahwa Apollo manual tersedia dan Apollo API menunggu upgrade. Status otomatis `belum lengkap` bukan kegagalan selama seluruh provider call memang dikunci.

## A. Menyiapkan sumber Apollo

Buka **Admin → Akuisisi & Penjualan → Kontrol Akuisisi → Sumber Data → Siapkan Apollo Manual**.

Preset akan mengisi:

| Field | Nilai preset |
|---|---|
| Kunci sumber | `ai_lead_discovery_apollo` |
| Nama | `AI Lead Discovery — Apollo` |
| Penyedia | `apollo` |
| Kanal | `outbound` |
| Pemilik data | `admin@binahub.id` |
| Penanggung jawab legal | `admin@binahub.id` |
| Mode | ekspor manual, API nonaktif |

Admin masih harus menentukan dasar pemrosesan, masa simpan, dan URL kebijakan privasi yang benar. Jangan memasukkan data prospek nyata sebelum ketiga hal tersebut sesuai kebijakan perusahaan.

Urutan penyimpanan:

1. simpan sebagai **Draf** untuk memeriksa semua field;
2. ubah menjadi **Disetujui**;
3. centang **Sumber aktif**;
4. centang **Disetujui penanggung jawab**;
5. isi catatan persetujuan yang menjelaskan bahwa sumber berasal dari ekspor manual Apollo dan tetap melalui human review;
6. simpan kembali.

## B. Menyiapkan campaign Apollo

Setelah source aktif, klik **Siapkan kampanye Apollo**. Preset menggunakan:

| Field | Nilai preset |
|---|---|
| Sumber | `AI Lead Discovery — Apollo` |
| Kode | `AI_LEAD_DISCOVERY_APOLLO` |
| Nama | `AI Lead Discovery — Apollo Manual` |
| Tujuan | `Perolehan lead` |
| Kanal | `other` |
| Owner | `admin@binahub.id` |

Lengkapi tanggal dan batas operasional bila diperlukan, simpan sebagai draf, lalu setujui dengan catatan. Campaign boleh aktif hanya ketika benar-benar digunakan.

## C. Mencari prospek di Apollo Free

Gunakan filter ICP yang sudah diputuskan:

- lokasi perusahaan: Indonesia;
- ukuran: minimal 20 karyawan;
- industri target;
- jabatan decision maker/champion;
- kata kunci atau sinyal kebutuhan relevan;
- keluarkan kompetitor, personal email, data tanpa perusahaan, dan kategori terlarang;
- batasi maksimal 25 prospek per hari.

Apollo pada tahap ini hanya alat riset. Jangan menjalankan sequence, mengirim email, meminta nomor telepon, atau mengaktifkan automation Apollo.

Jika Apollo menyediakan ekspor CSV, unduh file tersebut. Jika ekspor tidak tersedia pada paket akun, unduh **template-prospek-binahub.csv** dari modal Batch Prospek lalu salin data yang telah diperiksa secara manual.

Kolom minimum:

```csv
name,email,company,role_title,industry,location,employee_range,website_url,linkedin_url,source_url,consent_status
```

Importer juga mengenali nama kolom umum seperti `first_name`, `last_name`, `work_email`, `organization`, `company_name`, `title`, `position`, `job_title`, `headcount`, `website`, dan `linkedin`.

## D. Mengimpor ke BinaHub

1. Buka **Batch Prospek → Tambah batch**.
2. Pilih source `AI Lead Discovery — Apollo`.
3. Pilih campaign `AI Lead Discovery — Apollo Manual`.
4. Isi kunci impor unik, misalnya `apollo-manual-20260906-01`.
5. Unggah CSV/JSON.
6. Periksa hasil konversi pada field **Data prospek**.
7. Klik **Tambah batch**.
8. Buka **Tinjau** pada batch berstatus Menunggu tinjauan.
9. Periksa jumlah valid, invalid, duplikat, dan suppressed.
10. Setujui hanya bila hasil valid sesuai file sumber; keputusan ini belum mengirim email.

Gunakan kunci impor yang sama jika request sebelumnya tidak jelas berhasil atau gagal. Jangan memakai kunci baru untuk file identik karena itu menghilangkan perlindungan idempotensi.

## E. Smoke gate setelah deployment

```powershell
Set-Location "C:\Users\USER\OneDrive\Documents\Dokumen Binahub\binahub-api"
$adminSecret = Read-Host "Masukkan password admin" -AsSecureString
$env:PHASE18_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $adminSecret).Password
$env:PHASE18_ADMIN_EMAIL = "admin@binahub.id"
$env:PHASE18_API_URL = "https://api.binahub.id"
npm run test:phase18
Remove-Item Env:PHASE18_ADMIN_PASSWORD,Env:PHASE18_ADMIN_EMAIL,Env:PHASE18_API_URL
$adminSecret = $null
```

Smoke gate hanya membaca kontrol dan menguji batas akses. Ia tidak memanggil Apollo/Hunter, tidak membuat batch, dan tidak mengirim outbound.

## F. Upgrade ke Apollo API Pro nanti

Tidak diperlukan migration atau perubahan source/campaign. Isi environment berikut:

```dotenv
LEAD_AGENT_SECRET=<secret-baru-minimal-32-karakter>
APOLLO_API_KEY=<apollo-api-key-pro>
LEAD_AGENT_PROVIDER=apollo
LEAD_AGENT_SOURCE_KEY=ai_lead_discovery_apollo
LEAD_AGENT_CAMPAIGN_CODE=AI_LEAD_DISCOVERY_APOLLO

LEAD_AGENT_ENABLED=true
LEAD_AGENT_PROVIDER_CALLS_ENABLED=true
LEAD_AGENT_DRY_RUN=true
LEAD_AGENT_STAGING_ENABLED=false
LEAD_AGENT_APOLLO_ENRICH_WORK_EMAILS=false
LEAD_AGENT_AI_SCORING_ENABLED=false
```

Jalankan pratinjau pertama dalam kondisi `dry-run=true` dan `staging=false`. Setelah People Search terverifikasi sesuai akses paket, aktifkan enrichment secara terpisah. Staging baru dibuka setelah hasil pratinjau diterima manusia.

## Kill switch

```dotenv
LEAD_AGENT_PROVIDER_CALLS_ENABLED=false
LEAD_AGENT_ENABLED=false
LEAD_AGENT_STAGING_ENABLED=false
LEAD_AGENT_DRY_RUN=true
```

Workflow n8n AI Lead Discovery harus tetap inactive selama Apollo masih manual.

## Kriteria lulus baseline manual

- migration `0041` dan `0042` tersedia;
- smoke gate lulus;
- source dan campaign Apollo memiliki approval dan owner;
- CSV/JSON dapat dipreview sebelum disimpan;
- data invalid, duplikat, dan suppressed tidak dipromosikan;
- batch tetap memerlukan keputusan manusia;
- tidak ada provider call, email, outbound, atau auto-promotion;
- lineage source, campaign, batch, dan prospect tersimpan.
