-- CEO-approved bilingual email copy for acquisition, assessment and inquiry journeys.
-- Initial assessment-result and preliminary-recommendation emails are rendered by
-- src/lib/email-service.ts because they include dynamic result data and PDF attachments.

begin;

update public.outreach_templates
set status = 'archived', updated_at = now()
where status = 'approved'
  and template_key in (
    'marketing_blast_initial',
    'marketing_blast_follow_up_1',
    'inquiry_follow_up_1',
    'inquiry_follow_up_2',
    'inquiry_follow_up_3',
    'assessment_result_follow_up_1',
    'assessment_result_follow_up_2',
    'assessment_result_follow_up_3',
    'assessment_proposal_follow_up_1',
    'consultation_confirmation'
  );

with template_data(template_key, locale, subject_template, html_template) as (
  values
  (
    'marketing_blast_initial', 'id',
    'Seberapa siap tim {{company}} menghadapi perubahan?',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p><strong>Strategi bisa berubah dalam hitungan bulan. Teknologi dalam hitungan minggu. Bagaimana dengan kesiapan tim Anda?</strong></p>
<p>Saya <strong>Bilal Dwi Nugraha</strong>, CEO BinaHub. Selama lebih dari <strong>16 tahun</strong>, saya berkecimpung dalam pengembangan people dan organisasi melalui Bina Daya Nugraha. Kini pengalaman tersebut saya bawa ke BinaHub untuk membantu organisasi menghadapi tuntutan kerja yang terus berkembang.</p>
<p>Sebagai langkah awal, kami menyediakan <strong>Diagnosa Efektivitas Tim/Organisasi secara gratis</strong> untuk melihat <strong>kesiapan tim menghadapi perubahan, kekuatan yang sudah dimiliki, dan area yang masih dapat diperkuat.</strong></p>
<p><a href="https://binahub.id/diagnosa" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Lihat BinaHub &amp; Coba Diagnosa Gratis</a></p>
<p><strong>Tanpa kewajiban membeli program apa pun.</strong></p>
<p>Semoga bermanfaat.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://binahub.id">binahub.id</a></p>$$
  ),
  (
    'marketing_blast_initial', 'en',
    'How ready is the {{company}} team for change?',
    $$<p>Dear {{name}},</p>
<p><strong>Strategy can change within months. Technology within weeks. How ready is your team?</strong></p>
<p>I am <strong>Bilal Dwi Nugraha</strong>, CEO of BinaHub. For more than <strong>16 years</strong>, I have worked in people and organization development through Bina Daya Nugraha. I now bring that experience to BinaHub to help organizations respond to rapidly evolving work demands.</p>
<p>As a first step, we offer a <strong>free Team/Organization Effectiveness Diagnostic</strong> to provide an initial view of <strong>your team's readiness for change, existing strengths, and areas that can be strengthened.</strong></p>
<p><a href="https://binahub.id/en/diagnosa" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Explore BinaHub &amp; Take the Free Diagnostic</a></p>
<p><strong>There is no obligation to purchase any program.</strong></p>
<p>I hope you find it useful.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://binahub.id/en">binahub.id</a></p>$$
  ),
  (
    'marketing_blast_follow_up_1', 'id',
    'Diagnosa gratis untuk melihat kesiapan tim {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Beberapa hari lalu saya memperkenalkan <strong>BinaHub</strong> dan membagikan akses <strong>Diagnosa Efektivitas Tim/Organisasi secara gratis</strong>.</p>
<p>Kami membuatnya sederhana: dalam beberapa menit, Bapak/Ibu dapat memperoleh gambaran awal tentang <strong>seberapa siap tim menghadapi perubahan, apa yang sudah kuat, dan area mana yang masih dapat diperkuat.</strong></p>
<p>Jika Bapak/Ibu belum sempat mencobanya, diagnosanya masih dapat diakses di:</p>
<p><a href="https://binahub.id/diagnosa" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Coba Diagnosa Gratis</a></p>
<p>Semoga bermanfaat untuk Bapak/Ibu dan organisasi.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://binahub.id">binahub.id</a></p>$$
  ),
  (
    'marketing_blast_follow_up_1', 'en',
    'A free diagnostic to understand {{company}} team readiness',
    $$<p>Dear {{name}},</p>
<p>A few days ago, I introduced <strong>BinaHub</strong> and shared access to our <strong>free Team/Organization Effectiveness Diagnostic</strong>.</p>
<p>We designed it to be simple: within a few minutes, you can gain an initial view of <strong>how ready your team is for change, what is already working well, and which areas can be strengthened.</strong></p>
<p>If you have not had a chance to try it, the diagnostic is still available here:</p>
<p><a href="https://binahub.id/en/diagnosa" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Take the Free Diagnostic</a></p>
<p>I hope it will be useful to you and your organization.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://binahub.id/en">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_1', 'id',
    'Tindak lanjut hasil Diagnosa Efektivitas {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Kami ingin menindaklanjuti hasil <strong>Diagnosa Efektivitas Tim/Organisasi</strong> yang telah Bapak/Ibu ikuti beberapa hari lalu.</p>
<p>Jika hasil tersebut menimbulkan pertanyaan tentang <strong>apa yang sebaiknya diperkuat atau pendekatan apa yang mungkin sesuai</strong>, BinaHub dapat membantu memberikan gambaran awal.</p>
<p>Bapak/Ibu cukup meminta <strong>Preliminary Recommendation</strong> berdasarkan hasil diagnosa. Kami akan memberikan gambaran mengenai:</p>
<ul><li>Pendekatan yang mungkin relevan</li><li>Format dan cakupan awal</li><li><strong>Estimasi budget range</strong></li></ul>
<p>Tanpa perlu meeting terlebih dahulu.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Minta Preliminary Recommendation</a></p>
<p>Jika Bapak/Ibu masih ingin mengenal BinaHub terlebih dahulu, silakan <a href="{{website_url}}"><strong>pelajari BinaHub</strong></a>.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_1', 'en',
    'Following up on {{company}} diagnostic result',
    $$<p>Dear {{name}},</p>
<p>We are following up on the <strong>Team/Organization Effectiveness Diagnostic</strong> you completed a few days ago.</p>
<p>If the result raised questions about <strong>what should be strengthened or which approach may be suitable</strong>, BinaHub can provide an initial view.</p>
<p>You can request a <strong>Preliminary Recommendation</strong> based on the diagnostic result. It will outline:</p>
<ul><li>Potentially relevant approaches</li><li>An initial format and scope</li><li><strong>An estimated budget range</strong></li></ul>
<p>No meeting is required beforehand.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Request a Preliminary Recommendation</a></p>
<p>If you would prefer to learn more about BinaHub first, <a href="{{website_url}}"><strong>explore BinaHub</strong></a>.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_2', 'id',
    'Kesiapan people menentukan keberhasilan perubahan {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Ketika organisasi menghadapi perubahan, tantangannya sering kali bukan hanya <strong>“apa yang harus berubah”</strong>, tetapi <strong>“seberapa siap orang-orang di dalamnya untuk berubah.”</strong></p>
<p>Strategi, sistem, dan teknologi dapat dirancang. Namun, keberhasilannya sangat dipengaruhi oleh kemampuan people untuk <strong>memahami perubahan, beradaptasi, dan menerapkannya dalam pekerjaan sehari-hari.</strong></p>
<p>Karena itu, hasil diagnosa tim sebaiknya tidak berhenti sebagai angka. Yang lebih penting adalah memahami <strong>apa yang perlu diperkuat dan langkah apa yang paling relevan.</strong></p>
<p>Jika Bapak/Ibu ingin mengeksplorasi lebih jauh, BinaHub dapat memberikan <strong>Preliminary Recommendation + estimasi budget range</strong> berdasarkan hasil diagnosa Anda.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Minta Preliminary Recommendation</a></p>
<p>Atau, bila ingin mengenal BinaHub lebih jauh terlebih dahulu: <a href="{{website_url}}"><strong>Pelajari BinaHub</strong></a>.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_2', 'en',
    'People readiness shapes the success of change at {{company}}',
    $$<p>Dear {{name}},</p>
<p>When an organization faces change, the challenge is often not only <strong>“what needs to change”</strong>, but also <strong>“how ready its people are to change.”</strong></p>
<p>Strategies, systems, and technology can be designed. Their success, however, depends greatly on people's ability to <strong>understand change, adapt, and apply it in their day-to-day work.</strong></p>
<p>That is why a team diagnostic should not end with a score. What matters more is understanding <strong>what needs to be strengthened and which next step is most relevant.</strong></p>
<p>If you would like to explore this further, BinaHub can provide a <strong>Preliminary Recommendation and estimated budget range</strong> based on your diagnostic result.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Request a Preliminary Recommendation</a></p>
<p>Or, if you would like to learn more first: <a href="{{website_url}}"><strong>Explore BinaHub</strong></a>.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_3', 'id',
    'Apakah kesiapan tim masih menjadi prioritas {{company}}?',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Kami telah membagikan hasil <strong>Diagnosa Efektivitas Tim/Organisasi</strong> dan menawarkan gambaran awal pendekatan yang mungkin dapat dikembangkan berdasarkan hasil tersebut.</p>
<p>Kami memahami bahwa <strong>setiap organisasi memiliki prioritas dan timing yang berbeda.</strong></p>
<p>Karena itu, kami hanya ingin mengetahui satu hal:</p>
<p><strong>Apakah pengembangan kesiapan tim dalam menghadapi perubahan menjadi salah satu prioritas organisasi Bapak/Ibu saat ini?</strong></p>
<p>Jika <strong>ya</strong>, kami dengan senang hati menyiapkan <strong>Preliminary Recommendation + estimasi budget range</strong> sebagai langkah awal.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Minta Preliminary Recommendation</a></p>
<p>Jika <strong>belum menjadi prioritas</strong>, tidak apa-apa. Bapak/Ibu dapat menyimpan hasil diagnosa ini dan kembali menghubungi kami kapan pun dibutuhkan.</p>
<p>Untuk mengenal BinaHub lebih jauh: <a href="{{website_url}}"><strong>Pelajari BinaHub</strong></a>.</p>
<p>Terima kasih atas waktunya.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_result_follow_up_3', 'en',
    'Is team readiness still a priority for {{company}}?',
    $$<p>Dear {{name}},</p>
<p>We have shared the <strong>Team/Organization Effectiveness Diagnostic</strong> result and offered an initial view of approaches that may be developed from it.</p>
<p>We understand that <strong>every organization has different priorities and timing.</strong></p>
<p>We therefore only want to ask one question:</p>
<p><strong>Is strengthening your team's readiness for change one of your organization's current priorities?</strong></p>
<p>If <strong>yes</strong>, we would be pleased to prepare a <strong>Preliminary Recommendation and estimated budget range</strong> as a first step.</p>
<p><a href="{{proposal_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Request a Preliminary Recommendation</a></p>
<p>If it is <strong>not currently a priority</strong>, that is completely fine. You can keep the result and contact us whenever the timing is right.</p>
<p>To learn more about BinaHub: <a href="{{website_url}}"><strong>Explore BinaHub</strong></a>.</p>
<p>Thank you for your time.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_proposal_follow_up_1', 'id',
    'Memastikan Preliminary Recommendation {{company}} sudah diterima',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Saya ingin memastikan <strong>Preliminary Recommendation BinaHub</strong> yang kami kirimkan sebelumnya sudah diterima dengan baik.</p>
<p>Tidak perlu terburu-buru untuk merespons. Kami memahami bahwa setiap organisasi memiliki prioritas dan timing yang berbeda.</p>
<p>Jika ada bagian dari rekomendasi tersebut yang ingin Bapak/Ibu tanyakan atau klarifikasi, <strong>cukup balas email ini</strong>. Kami dengan senang hati akan membantu menjawabnya.</p>
<p>Jika lebih nyaman untuk berdiskusi langsung, Bapak/Ibu juga dapat memilih waktu yang sesuai untuk berbicara dengan konsultan BinaHub.</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Pilih waktu diskusi</a></p>
<p>Jika saat ini belum menjadi prioritas, tidak masalah. Kami tetap senang dapat berbagi insight dan akan dengan senang hati terhubung kembali ketika waktunya lebih tepat.</p>
<p>Salam hangat,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'assessment_proposal_follow_up_1', 'en',
    'Confirming receipt of {{company}} Preliminary Recommendation',
    $$<p>Dear {{name}},</p>
<p>I wanted to make sure the <strong>BinaHub Preliminary Recommendation</strong> we sent earlier reached you safely.</p>
<p>There is no need to respond immediately. We understand that every organization has different priorities and timing.</p>
<p>If there is any part of the recommendation you would like to ask about or clarify, <strong>simply reply to this email</strong>. We will be happy to help.</p>
<p>If a direct conversation would be more convenient, you can also choose a suitable time to speak with a BinaHub consultant.</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Choose a discussion time</a></p>
<p>If this is not yet a priority, that is completely fine. We are glad to have shared these insights and will be happy to reconnect when the timing is better.</p>
<p>Warm regards,</p>
<p><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_1', 'id',
    'Kami telah menerima kebutuhan {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Terima kasih telah menghubungi BinaHub dan menyampaikan kebutuhan {{company}} melalui website kami.</p>
<p>Pesan Bapak/Ibu telah kami terima. Kami akan mempelajari informasi yang disampaikan agar dapat memahami konteks dan kebutuhan awalnya dengan lebih tepat.</p>
<p>Jika berkenan, kami dapat melanjutkan dengan konsultasi singkat bersama konsultan BinaHub untuk memetakan kebutuhan, tujuan, dan ruang lingkup yang mungkin relevan.</p>
<p>Bapak/Ibu dapat memilih cara yang paling nyaman:</p>
<p><strong>Ada pertanyaan atau informasi tambahan?</strong><br>Silakan balas email ini, dan tim kami akan meresponsnya.</p>
<p><strong>Ingin langsung berdiskusi?</strong></p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Pilih waktu konsultasi yang nyaman</a></p>
<p>Jika Bapak/Ibu sudah memiliki TOR, brief, presentasi, atau dokumen kebutuhan lainnya dan merasa nyaman untuk membagikannya lebih awal melalui email, kami dengan senang hati akan mempelajarinya sebelum sesi konsultasi. Tidak ada format khusus yang perlu disiapkan.</p>
<p>Kami menantikan kesempatan untuk memahami kebutuhan {{company}} lebih jauh.</p>
<p>Salam hangat,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_1', 'en',
    'We have received {{company}} inquiry',
    $$<p>Dear {{name}},</p>
<p>Thank you for contacting BinaHub and sharing {{company}}'s needs through our website.</p>
<p>We have received your message and will review the information provided so we can understand the initial context and requirements more accurately.</p>
<p>If helpful, we can continue with a short consultation with a BinaHub consultant to clarify the need, objective, and potentially relevant scope.</p>
<p>You can choose whichever option is most convenient:</p>
<p><strong>Have a question or additional information?</strong><br>Simply reply to this email and our team will respond.</p>
<p><strong>Prefer to discuss it directly?</strong></p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Choose a convenient consultation time</a></p>
<p>If you already have a TOR, brief, presentation, or other requirement document and are comfortable sharing it by email, we will gladly review it before the consultation. No special format is required.</p>
<p>We look forward to learning more about {{company}}'s needs.</p>
<p>Warm regards,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_2', 'id',
    'Apakah kebutuhan {{company}} masih menjadi prioritas?',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Saya ingin menindaklanjuti kebutuhan yang sebelumnya Bapak/Ibu sampaikan kepada BinaHub.</p>
<p>Kami memahami bahwa prioritas dapat berubah dan kesibukan pekerjaan bisa membuat tindak lanjut belum sempat dilakukan. Karena itu, kami hanya ingin memastikan:</p>
<p><strong>Apakah kebutuhan tersebut masih menjadi salah satu prioritas {{company}} saat ini?</strong></p>
<p>Jika ya, kami dengan senang hati melanjutkan percakapan dan membantu memetakan kebutuhan serta ruang lingkupnya.</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Pilih waktu konsultasi yang nyaman</a></p>
<p>Jika Bapak/Ibu lebih nyaman menyampaikan pertanyaan atau perkembangan melalui email terlebih dahulu, cukup balas email ini dan kami akan menyesuaikan.</p>
<p>Jika kebutuhan tersebut belum menjadi prioritas saat ini, tidak masalah. Bapak/Ibu dapat menghubungi kami kembali ketika waktunya lebih tepat.</p>
<p>Salam hangat,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_2', 'en',
    'Is this still a priority for {{company}}?',
    $$<p>Dear {{name}},</p>
<p>I wanted to follow up on the needs you previously shared with BinaHub.</p>
<p>We understand that priorities can change and busy schedules can delay follow-up. We therefore only want to confirm:</p>
<p><strong>Is this need still one of {{company}}'s current priorities?</strong></p>
<p>If so, we would be happy to continue the conversation and help clarify the need and its scope.</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Choose a convenient consultation time</a></p>
<p>If you prefer to share a question or update by email first, simply reply and we will adapt.</p>
<p>If this is not currently a priority, that is completely fine. You can contact us again whenever the timing is right.</p>
<p>Warm regards,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_3', 'id',
    'Tindak lanjut terakhir untuk kebutuhan {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Kami ingin menyampaikan tindak lanjut terakhir terkait kebutuhan yang sebelumnya Bapak/Ibu sampaikan kepada BinaHub.</p>
<p>Karena kami belum menerima kabar lebih lanjut, untuk sementara kami akan menutup antrean follow-up agar tidak mengganggu kesibukan dan prioritas Bapak/Ibu.</p>
<p>Tentu, ini bukan berarti percakapannya harus berakhir.</p>
<p>Jika kebutuhan tersebut kembali menjadi prioritas di kemudian hari, Bapak/Ibu dapat membalas email ini atau menghubungi kami kapan saja. Kami akan dengan senang hati melanjutkan dari informasi yang sudah pernah disampaikan.</p>
<p>Jika Bapak/Ibu masih ingin berdiskusi sekarang, tentu kami juga tetap terbuka:</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Pilih waktu konsultasi dengan BinaHub</a></p>
<p>Terima kasih atas kesempatan yang telah diberikan kepada BinaHub. Semoga kebutuhan {{company}} dapat berjalan dengan baik.</p>
<p>Salam hangat,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'inquiry_follow_up_3', 'en',
    'Final follow-up on {{company}} inquiry',
    $$<p>Dear {{name}},</p>
<p>This is our final follow-up regarding the needs you previously shared with BinaHub.</p>
<p>As we have not heard back, we will close the follow-up queue for now so we do not interrupt your other priorities.</p>
<p>This does not mean the conversation has to end.</p>
<p>If the need becomes a priority again, you can reply to this email or contact us at any time. We will be happy to continue from the information already shared.</p>
<p>If you would still like to discuss it now, we remain available:</p>
<p><a href="{{consultation_url}}" style="display:inline-block;background:#0B2C6B;color:#FFFFFF;text-decoration:none;padding:13px 22px;border-radius:6px;font-weight:700;">Choose a consultation time with BinaHub</a></p>
<p>Thank you for the opportunity to connect with BinaHub. We hope {{company}}'s needs progress well.</p>
<p>Warm regards,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'consultation_confirmation', 'id',
    'Konfirmasi konsultasi BinaHub — {{company}}',
    $$<p>Yth. Bapak/Ibu {{name}},</p>
<p>Terima kasih telah memilih waktu untuk berdiskusi bersama <strong>konsultan BinaHub</strong>.</p>
<p>Kami telah menerima jadwal konsultasi Bapak/Ibu melalui <strong>Cal.com</strong>. Detail hari, waktu, dan tautan meeting tercantum pada undangan kalender Cal.com.</p>
<p>Dalam sesi ini, kita dapat membahas hasil diagnosa dan <strong>Preliminary Recommendation</strong>, termasuk pertanyaan, kebutuhan, atau konteks organisasi yang perlu kami pahami lebih lanjut.</p>
<p>Tidak perlu menyiapkan presentasi khusus. <strong>Percakapan ini bersifat eksploratif</strong> dan akan difokuskan pada hal yang paling relevan bagi Bapak/Ibu.</p>
<p>Sampai bertemu. Semoga percakapannya memberikan perspektif dan langkah yang bermanfaat bagi {{company}}.</p>
<p>Salam hangat,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  ),
  (
    'consultation_confirmation', 'en',
    'BinaHub consultation confirmation — {{company}}',
    $$<p>Dear {{name}},</p>
<p>Thank you for choosing a time to speak with a <strong>BinaHub consultant</strong>.</p>
<p>We have received your consultation booking through <strong>Cal.com</strong>. The date, time, and meeting link are included in the Cal.com calendar invitation.</p>
<p>During the session, we can discuss your diagnostic result and <strong>Preliminary Recommendation</strong>, including any questions, needs, or organizational context we should understand.</p>
<p>There is no need to prepare a special presentation. <strong>This is an exploratory conversation</strong> and we will use the time to focus on what is most relevant to you.</p>
<p>We look forward to meeting you and hope the conversation provides useful perspective and next steps for {{company}}.</p>
<p>Warm regards,</p>
<p><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="{{website_url}}">www.binahub.id</a></p>$$
  )
)
insert into public.outreach_templates (
  template_key, locale, version, status, subject_template, html_template,
  owner, is_mock, approved_by, approved_at, approval_note, created_by
)
select
  template_key,
  locale,
  'v2.0-ceo-20260924',
  'approved',
  subject_template,
  html_template,
  'admin@binahub.id',
  false,
  'admin@binahub.id',
  now(),
  'Redaksi diberikan CEO BinaHub dan diterapkan dalam Bahasa Indonesia serta terjemahan Bahasa Inggris.',
  'system-migration'
from template_data
on conflict (template_key, locale, version) do update
set
  status = excluded.status,
  subject_template = excluded.subject_template,
  html_template = excluded.html_template,
  owner = excluded.owner,
  is_mock = excluded.is_mock,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  approval_note = excluded.approval_note,
  updated_at = now();

commit;
