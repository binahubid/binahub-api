-- CEO Signature Solutions 2026. Staged, unpublished and inactive until content and commercial review.
-- Never expose base_price or metadata.commercial through a public endpoint.
begin;

insert into public.catalog_products (
  product_key, slug, name, status, objective, short_description,
  public_description, public_visible, featured, display_order, notes
)
values
  ('signature-self', 'signature-self', 'Transformasi Diri', 'design', 'Mengembangkan kesadaran diri, kinerja, dan kepemimpinan individu.', 'Solusi pengembangan individu dan pemimpin.', 'Pengalaman belajar yang menghubungkan kesadaran diri dengan tindakan nyata di tempat kerja.', false, false, 100, 'CEO Signature Solutions 2026; editorial review required.'),
  ('signature-team', 'signature-team', 'Transformasi Tim', 'design', 'Memperkuat kerja sama, kepercayaan, dan ketangkasan tim.', 'Solusi pengembangan tim.', 'Pengalaman terstruktur untuk membantu tim bekerja dan bertumbuh bersama.', false, false, 110, 'CEO Signature Solutions 2026; editorial review required.'),
  ('signature-organization', 'signature-organization', 'Transformasi Organisasi', 'design', 'Menghubungkan kapabilitas manusia dengan perubahan organisasi.', 'Solusi transformasi organisasi.', 'Pendekatan sesuai konteks organisasi, prioritas bisnis, dan skala perubahan.', false, false, 120, 'CEO Signature Solutions 2026; editorial review required.'),
  ('signature-specialized', 'signature-specialized', 'Solusi Khusus', 'design', 'Mendukung kebutuhan transformasi yang spesifik.', 'Perjalanan pengembangan khusus.', 'Solusi yang dirancang untuk konteks dan tujuan pengembangan khusus.', false, false, 130, 'CEO Signature Solutions 2026; editorial review required.')
on conflict (product_key) do nothing;

with source (code, product_key, name_en, name_id, summary_en, summary_id, pricing_unit, base_price, display_order) as (
  values
    ('SS-01','signature-self','Emotional Intelligence','Kecerdasan Emosional','Understand yourself and connect better.','Kenali pola diri, kelola respons emosi, dan bangun hubungan kerja yang lebih baik.','day',25000000,1),
    ('SS-02','signature-self','Professional Excellence','Keunggulan Profesional','The mindset and behaviors behind professional impact.','Perkuat kepemilikan, akuntabilitas, dan perilaku kerja yang berdampak.','day',25000000,2),
    ('SS-03','signature-self','Personal Productivity & Effectiveness','Produktivitas dan Efektivitas Personal','Work better, focus better, achieve more.','Atur prioritas, fokus, dan kebiasaan kerja agar hasil lebih konsisten.','day',25000000,3),
    ('SS-04','signature-self','Communication & Presentation','Komunikasi dan Presentasi','Communicate clearly and influence effectively.','Sampaikan gagasan dengan jelas dan bangun pengaruh melalui komunikasi yang tepat.','day',25000000,4),
    ('SS-05','signature-self','Service Excellence','Keunggulan Layanan','Create service that customers remember.','Bangun perilaku layanan dan respons yang memperkuat pengalaman pelanggan.','day',25000000,5),
    ('SS-06','signature-self','Problem Solving, Decision Making, & Innovation','Pemecahan Masalah, Pengambilan Keputusan, dan Inovasi','Think clearly, solve effectively, create what is next.','Rumuskan masalah, ambil keputusan terstruktur, dan uji gagasan perbaikan.','day',25000000,6),
    ('SS-07','signature-self','First-Time Leader','Pemimpin Baru','From individual contributor to people leader.','Bantu pemimpin baru menjalankan delegasi, umpan balik, dan coaching.','day',25000000,7),
    ('SS-08','signature-self','Adaptive Leadership','Kepemimpinan Adaptif','Lead through change and uncertainty.','Pimpin tim menghadapi ketidakpastian dengan tindakan yang adaptif.','day',25000000,8),
    ('SS-09','signature-self','AI-Powered Professional','Profesional Berdaya AI','Work smarter, think critically, stay human.','Gunakan AI secara praktis, kritis, bertanggung jawab, dan berpusat pada manusia.','day',25000000,9),
    ('SS-10','signature-self','BinaCoach: Growth, Performance & Wellbeing Coaching','BinaCoach: Coaching Pertumbuhan, Kinerja, dan Kesejahteraan','From insight to sustainable change.','Ubah refleksi menjadi tindakan dan perubahan perilaku yang berkelanjutan.','package',0,10),
    ('SS-11','signature-team','Team Building','Penguatan Tim','Build connection, strengthen collaboration, create team energy.','Bangun koneksi, kepercayaan, dan komitmen tim melalui pengalaman bersama.','package',0,11),
    ('SS-12','signature-team','Trust & Psychological Safety','Kepercayaan dan Keamanan Psikologis','Create a team where people can speak, listen, and contribute.','Bangun lingkungan tim yang aman untuk berbicara, mendengar, dan berkontribusi.','day',25000000,12),
    ('SS-13','signature-team','Team Synergy','Sinergi Tim','From individual contribution to collective performance.','Selaraskan peran dan kerja lintas fungsi untuk meningkatkan kinerja bersama.','day',25000000,13),
    ('SS-14','signature-team','Empathy Experience','Pengalaman Empati','Experience, understand, choose, act.','Latih kemampuan melihat sudut pandang lain dan menerjemahkan empati menjadi tindakan.','day',25000000,14),
    ('SS-15','signature-team','High Performing Team','Tim Berkinerja Tinggi','Build the habits of high-performing teams.','Bangun kebiasaan, norma, dan tindakan yang mendukung kinerja tim.','day',25000000,15),
    ('SS-16','signature-team','Team Agility','Ketangkasan Tim','Build teams that adapt.','Tingkatkan kemampuan tim belajar cepat dan menyesuaikan cara kerja.','day',25000000,16),
    ('SS-17','signature-team','Leading the Team','Memimpin Tim','Align, develop, mobilize.','Perkuat arah, delegasi, pengembangan, dan komunikasi pemimpin tim.','day',25000000,17),
    ('SS-18','signature-organization','Culture Activation','Aktivasi Budaya','Turn values into everyday behaviors.','Terjemahkan nilai organisasi menjadi perilaku yang terlihat dan diperkuat setiap hari.','custom',0,18),
    ('SS-19','signature-organization','Change & Organizational Agility','Perubahan dan Ketangkasan Organisasi','Build an organization that can adapt.','Petakan kesiapan perubahan dan susun langkah adopsi yang relevan.','custom',0,19),
    ('SS-20','signature-organization','Leadership Academy','Akademi Kepemimpinan','Build leaders at every level.','Bangun kapabilitas kepemimpinan secara bertahap di berbagai jenjang.','custom',0,20),
    ('SS-21','signature-organization','Future Leaders','Pemimpin Masa Depan','Prepare today’s talent for tomorrow’s leadership.','Siapkan talenta berpotensi melalui pengalaman dan bukti pengembangan kepemimpinan.','custom',0,21),
    ('SS-22','signature-organization','Internal Trainer & Facilitator Academy','Akademi Pelatih dan Fasilitator Internal','Build internal learning capability.','Kembangkan kemampuan merancang dan memfasilitasi pembelajaran internal.','day',30000000,22),
    ('SS-23','signature-organization','Performance Acceleration','Akselerasi Kinerja','Connect people capability with business performance.','Hubungkan kesenjangan kapabilitas dengan tindakan peningkatan kinerja bisnis.','custom',0,23),
    ('SS-24','signature-organization','AI-Ready Organization','Organisasi Siap AI','Prepare people for an AI-enabled workplace.','Siapkan orang, kebiasaan kerja, dan peta adopsi AI organisasi.','custom',0,24),
    ('SS-25','signature-organization','Future-Ready Organization','Organisasi Siap Masa Depan','Build capability for what comes next.','Peta kapabilitas masa depan menjadi dasar prioritas pengembangan organisasi.','custom',0,25),
    ('SS-26','signature-organization','Impact Measurement & Transformation Review','Pengukuran Dampak dan Tinjauan Transformasi','Measure, learn, improve, demonstrate impact.','Tinjau bukti perubahan dan tetapkan langkah perbaikan berikutnya.','custom',0,26),
    ('SS-27','signature-specialized','Spiritual Leadership Journey','Perjalanan Kepemimpinan Spiritual','Elevating leadership beyond the limit.','Perjalanan refleksi dan praktik kepemimpinan spiritual yang berkelanjutan.','custom',0,27)
)
insert into public.catalog_modules (
  product_id, module_code, slug, name, description, standard_scope,
  pricing_unit, base_price, minimum_quantity, currency, readiness_status,
  is_mock, active, public_visible, featured, display_order, catalog_version, metadata
)
select product.id, source.code, lower(source.code), source.name_id, source.summary_id,
       source.summary_id, source.pricing_unit, source.base_price, 1, 'IDR',
       'design', false, false, false, false, source.display_order, 'signature-2026-ceo-v1',
       jsonb_build_object(
         'source', 'CEO Signature Solutions Detailed Catalog 2026',
         'commercialModel', case when source.pricing_unit = 'custom' then 'custom_scope' when source.code in ('SS-10','SS-11') then 'tiered_package' else 'fixed_daily' end,
         'requiresHumanCommercialReview', source.pricing_unit <> 'day',
         'localized', jsonb_build_object(
           'en', jsonb_build_object('name', source.name_en, 'summary', source.summary_en),
           'id', jsonb_build_object('name', source.name_id, 'summary', source.summary_id)
         ),
         'commercial', case
           when source.code = 'SS-10' then jsonb_build_object('silver',5000000,'gold',10000000,'platinum',16500000)
           when source.code = 'SS-11' then jsonb_build_object('essential',25000000,'signature',50000000,'enterprise',75000000,'additionalParticipantAbove150',450000)
           else '{}'::jsonb end
       )
from source
join public.catalog_products product on product.product_key = source.product_key
on conflict (module_code) do nothing;

commit;
