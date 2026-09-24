import { Resend } from 'resend';
import { AssessmentData } from './validations';
import { AssessmentResult } from './pdf-service';
import type { Locale } from '@/i18n/config';
import { createProposalToken } from '@/lib/secure-token';
import { createServerSupabase } from '@/lib/supabase';
import { createUnsubscribeToken, normalizeRecipientEmail } from '@/lib/unsubscribe-token';
import { renderApprovedOutreachHtml } from '@/lib/email-template-renderer';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM && process.env.EMAIL_FROM.includes('@') 
  ? process.env.EMAIL_FROM 
  : 'onboarding@resend.dev';
const COMPANY_COPY = process.env.EMAIL_COMPANY_COPY || 'admin@binahub.id';
const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'BinaHub';
const REPLY_TO = process.env.EMAIL_REPLY_TO && process.env.EMAIL_REPLY_TO.includes('@')
  ? process.env.EMAIL_REPLY_TO
  : undefined;

export class OutreachSuppressedError extends Error {
  readonly code = 'OUTREACH_SUPPRESSED';

  constructor() {
    super('Penerima telah berhenti menerima email follow-up.');
    this.name = 'OutreachSuppressedError';
  }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
}

function safeFilenamePart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'Dokumen';
}

function generatedHtmlToPlainText(value: string) {
  return value
    .replace(/<(script|style|template|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20_000);
}

function renderGeneratedEmailSafely(htmlContent: string, replacements: Record<string, string>) {
  let substituted = htmlContent;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    substituted = substituted.replaceAll(placeholder, replacement);
  }

  const safeBody = escapeHtml(generatedHtmlToPlainText(substituted)).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#F1F5F9;font-family:Arial,sans-serif;color:#334155;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:32px;line-height:1.7;">
    ${safeBody}
  </div>
</body></html>`;
}

function resendTagValue(value?: string) {
  return (value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 256);
}

function normalizeUrl(value?: string) {
  if (!value) return '';
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function getAppUrl() {
  const configuredUrl = normalizeUrl(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL);
  const vercelUrl = normalizeUrl(process.env.VERCEL_URL);

  // Avoid stale links from previous Vercel projects when staging/prod is deployed elsewhere.
  if (configuredUrl && !configuredUrl.includes('buhanib.vercel.app')) {
    return configuredUrl;
  }

  return vercelUrl || configuredUrl;
}

function getApiUrl() {
  return normalizeUrl(process.env.NEXT_PUBLIC_BINAHUB_API_URL) || getAppUrl();
}

function getConsultationUrl() {
  return normalizeUrl(process.env.CALCOM_BOOKING_URL || process.env.NEXT_PUBLIC_CALCOM_BOOKING_URL)
    || "https://cal.com/binahub/konsultasi";
}

function appendUnsubscribeFooter(html: string, unsubscribeUrl: string) {
  const footer = `
  <div style="max-width:640px;margin:14px auto 0;padding:0 20px;text-align:center;color:#64748B;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">
    PT Binahub Solusi Transformasi · <a href="https://www.binahub.id" style="color:#0B2C6B;">www.binahub.id</a><br>
    Email ini merupakan follow-up dari BinaHub. Jika Anda tidak ingin menerima follow-up berikutnya,
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0B2C6B;text-decoration:underline;">atur preferensi email</a>.
  </div>`;
  return html.includes('</body>') ? html.replace('</body>', `${footer}</body>`) : `${html}${footer}`;
}

export async function sendReviewedInquiryReply(input: {
  to: string;
  name: string;
  subject: string;
  body: string;
}) {
  const normalizedTo = normalizeRecipientEmail(input.to);
  const consultationUrl = escapeHtml(getConsultationUrl());
  const safeBody = escapeHtml(input.body)
    .replace(/^•\s+(.+)$/gm, '<span style="display:block;padding-left:16px;">• $1</span>')
    .replace(/\n/g, '<br>');
  const html = renderApprovedOutreachHtml(`
    <p style="margin-top:0;">Yth. Bapak/Ibu ${escapeHtml(input.name)},</p>
    <div>${safeBody}</div>
    <p style="margin:26px 0 0;color:#475569;">Jika Bapak/Ibu lebih nyaman berdiskusi langsung, silakan <a href="${consultationUrl}" style="color:#0B2C6B;font-weight:700;">pilih waktu konsultasi melalui Cal.com</a>.</p>
    <p style="margin:26px 0 0;">Salam hangat,</p>
    <p style="margin:8px 0 0;"><strong>BinaHub</strong><br>Consultant | BinaHub<br><em>People. Learning. Elevated.</em></p>
  `);
  const response = await resend.emails.send({
    from: `${COMPANY_NAME} <${FROM}>`,
    to: normalizedTo,
    replyTo: REPLY_TO,
    subject: safeHeader(input.subject),
    html,
    tags: [{ name: 'category', value: 'inquiry_human_reviewed_reply' }],
  });
  if (response.error) throw new Error(`Resend gagal mengirim balasan inquiry: ${response.error.message}`);
  return response;
}

export async function sendAssessmentEmail(
  formData: AssessmentData,
  result: AssessmentResult,
  pdfBuffer?: Buffer,
  assessmentId?: string,
  locale: Locale = 'id'
) {
  const isEnglish = locale === 'en';
  const safeName = escapeHtml(formData.name);
  const safeCompany = escapeHtml(formData.company);
  const safeEmail = escapeHtml(formData.email);
  const safeWhatsapp = escapeHtml(formData.whatsapp || '-');
  const safeCategory = escapeHtml(String(result.category));
  const safeArchetype = result.archetype ? escapeHtml(result.archetype) : '';
  const dimensionLabels: Record<string, { id: string; en: string }> = {
    strategy: { id: 'Strategi', en: 'Strategy' },
    people: { id: 'People', en: 'People' },
    process: { id: 'Proses', en: 'Process' },
    technology: { id: 'Teknologi', en: 'Technology' },
    culture: { id: 'Budaya', en: 'Culture' },
    leadership: { id: 'Kepemimpinan', en: 'Leadership' },
    customer: { id: 'Pelanggan', en: 'Customer' },
  };
  const rankedDimensions = Object.entries(result.scores)
    .filter(([key, score]) => key !== 'overall' && Number.isFinite(Number(score)))
    .map(([key, score]) => ({
      label: dimensionLabels[key]?.[isEnglish ? 'en' : 'id'] || key.replace(/_/g, ' '),
      score: Number(score),
    }))
    .sort((a, b) => b.score - a.score);
  const strengthItems = rankedDimensions.slice(0, 2);
  const developmentItems = [...rankedDimensions].reverse().slice(0, 2);
  const copy = isEnglish
    ? {
        title: 'Team/Organization Effectiveness Diagnostic Result',
        preheader: 'BinaHub Diagnostic Result',
        heading: 'Your Initial Diagnostic Result',
        greeting: `Dear <strong>${safeName}</strong>,`,
        intro: `Thank you for completing BinaHub's <strong>Team/Organization Effectiveness Diagnostic</strong>. The summary below provides an initial view of your team, while the complete analysis is included in the attached PDF report.`,
        overallScore: 'Overall Score',
        stage: 'Result Level',
        strengthTitle: 'Visible strengths',
        developmentTitle: 'Areas that can be strengthened',
        noteTitle: 'How to read this result',
        noteBody: 'This result is an initial view designed to help identify areas that may require attention as your organization responds to change and evolving work demands.',
        referenceTitle: 'Complete report attached',
        pdfNote: '<strong>The attached PDF report</strong> contains the detailed scores, analysis, insights, and initial priorities. Please use the PDF as the primary reference for this diagnostic result.',
        proposalIntro: 'If you would like to explore relevant development approaches and an initial budget estimate, we can prepare a <strong>Preliminary Recommendation</strong> based on this diagnostic result.',
        proposalCta: 'Request a Preliminary Recommendation',
        chatCta: 'Learn more about BinaHub',
        closing: 'Warm regards,',
        footer: 'CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://www.binahub.id" style="color:#0B2C6B;">www.binahub.id</a>',
        auto: 'This email was sent automatically. For assistance, reply to',
        subject: safeHeader(`Your BinaHub Diagnostic Result · ${formData.company}`),
        fileName: `BinaHub_Diagnostic_Result_${safeFilenamePart(formData.company)}.pdf`,
      }
    : {
        title: 'Hasil Diagnosa Efektivitas Tim/Organisasi',
        preheader: 'Hasil Diagnosa BinaHub',
        heading: 'Gambaran Awal Kondisi Tim Anda',
        greeting: `Yth. <strong>Bapak/Ibu ${safeName}</strong>,`,
        intro: `Terima kasih telah mengikuti <strong>Diagnosa Efektivitas Tim/Organisasi dari BinaHub</strong>. Ringkasan berikut memberikan gambaran awal kondisi tim Anda, sedangkan analisis lengkap tersedia dalam laporan PDF terlampir.`,
        overallScore: 'Skor Keseluruhan',
        stage: 'Level Hasil',
        strengthTitle: 'Kekuatan yang terlihat',
        developmentTitle: 'Area yang masih dapat diperkuat',
        noteTitle: 'Cara membaca hasil',
        noteBody: 'Hasil ini merupakan gambaran awal untuk membantu melihat area yang perlu mendapat perhatian dalam menghadapi perubahan dan tuntutan pekerjaan.',
        referenceTitle: 'Laporan lengkap terlampir',
        pdfNote: '<strong>Laporan PDF terlampir</strong> memuat rincian skor, analisis, insight, dan prioritas awal. Gunakan PDF tersebut sebagai rujukan utama hasil diagnosa ini.',
        proposalIntro: 'Jika Bapak/Ibu ingin mengetahui <strong>pendekatan pengembangan yang mungkin relevan beserta estimasi budget awal</strong>, kami dapat menyiapkan <strong>Preliminary Recommendation</strong> berdasarkan hasil diagnosa ini.',
        proposalCta: 'Minta Preliminary Recommendation',
        chatCta: 'Kenali BinaHub lebih jauh',
        closing: 'Salam hangat,',
        footer: 'CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://www.binahub.id" style="color:#0B2C6B;">www.binahub.id</a>',
        auto: 'Email ini dikirim secara otomatis. Jika membutuhkan bantuan, balas ke',
        subject: safeHeader(`Hasil Diagnosa BinaHub · ${formData.company}`),
        fileName: `Hasil_Diagnosa_BinaHub_${safeFilenamePart(formData.company)}.pdf`,
      };
  // Brand Colors
  const navy = '#0B2C6B';
  const gold = '#D9A441';
  const offWhite = '#F5F7FA';
  const scoreInterpretation = escapeHtml(result.scoreInterpretation || `Skor ${result.scores.overall} menempatkan ${formData.company} pada kategori ${result.category}. Ini menunjukkan fondasi organisasi yang dapat diperkuat melalui prioritas strategis yang lebih tajam.`);
  const crossInsights: string[] = [];
  const appUrl = getAppUrl();
  const apiUrl = (process.env.NEXT_PUBLIC_BINAHUB_API_URL || '').replace(/\/$/, '');
  const proposalUrl = assessmentId && apiUrl
    ? `${apiUrl}/api/proposal/request?assessmentId=${encodeURIComponent(assessmentId)}&token=${encodeURIComponent(createProposalToken(assessmentId))}`
    : `${appUrl || '#'}?proposal=request`;

  // Premium Corporate HTML Email
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${copy.title} - ${COMPANY_NAME}</title>
</head>
<body style="margin:0;padding:0;background-color:#E2E8F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,'Helvetica Neue',sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:8px;overflow:hidden;margin-top:40px;margin-bottom:40px;box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
    
    <!-- Header -->
    <div style="padding:40px;background-color:${navy};text-align:center;border-bottom:4px solid ${gold};background-image:radial-gradient(circle at 85% 20%, rgba(217,164,65,0.18), transparent 26%), linear-gradient(135deg, rgba(255,255,255,0.05), transparent 45%);">
      <div style="color:${gold};font-size:10px;text-transform:uppercase;letter-spacing:3px;margin-bottom:15px;font-weight:700;">${copy.preheader}</div>
      <h1 style="color:#FFFFFF;font-size:26px;font-weight:600;margin:0 0 10px;letter-spacing:0px;">
        ${copy.heading}
      </h1>
      <p style="color:rgba(255,255,255,0.8);margin:0;font-size:16px;font-weight:300;">${safeCompany}</p>
    </div>

    <!-- Body -->
    <div style="padding:40px;">
      <p style="color:${navy};font-size:16px;margin:0 0 20px;font-weight:400;">
        ${copy.greeting}
      </p>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 35px;font-weight:400;">
        ${copy.intro}
      </p>

      <!-- Score Card -->
      <div style="background:${offWhite};border-radius:12px;padding:35px;text-align:center;margin:0 0 35px;border:1px solid #E2E8F0;">
        <p style="color:#64748B;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 15px;font-weight:600;">${copy.overallScore}</p>
        <div style="font-size:64px;font-weight:700;color:${navy};margin:0 0 15px;line-height:1;">${result.scores.overall}</div>
        <div style="display:inline-block;background:${gold};color:${navy};padding:6px 20px;border-radius:4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
          ${copy.stage}: ${safeCategory}
        </div>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:22px 0 0;font-weight:400;">
          ${scoreInterpretation}
        </p>
        ${result.archetype ? `
          <div style="margin-top:18px;display:inline-block;border:1px solid #E2E8F0;background:#FFFFFF;color:${navy};padding:8px 18px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;">
            ${safeArchetype}
          </div>
        ` : ''}
      </div>

      <div style="display:flex;gap:14px;margin:0 0 34px;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:20px;">
          <h2 style="color:${navy};font-size:15px;margin:0 0 12px;">${copy.strengthTitle}</h2>
          <ul style="margin:0;padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
            ${strengthItems.map((item) => `<li>${escapeHtml(item.label)} — ${item.score}</li>`).join('') || `<li>${safeCategory}</li>`}
          </ul>
        </div>
        <div style="flex:1;min-width:220px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:20px;">
          <h2 style="color:${navy};font-size:15px;margin:0 0 12px;">${copy.developmentTitle}</h2>
          <ul style="margin:0;padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
            ${developmentItems.map((item) => `<li>${escapeHtml(item.label)} — ${item.score}</li>`).join('') || `<li>${isEnglish ? 'See the attached PDF for details.' : 'Lihat rincian pada PDF terlampir.'}</li>`}
          </ul>
        </div>
      </div>

      <!-- Analysis -->
      <h2 style="color:${navy};font-size:18px;font-weight:600;margin:0 0 15px;border-left:3px solid ${gold};padding-left:12px;">${copy.noteTitle}</h2>
      <div style="background:#FFFFFF;padding:0 0 35px 0;">
        <p style="color:#475569;font-size:15px;line-height:1.7;margin:0;font-weight:400;">${copy.noteBody}</p>
      </div>

      ${crossInsights.length ? `
        <h2 style="color:${navy};font-size:18px;font-weight:600;margin:0 0 15px;border-left:3px solid ${gold};padding-left:12px;">Penalaran Diagnostik</h2>
        ${crossInsights.slice(0, 2).map((insight) => `
          <div style="padding:18px;background:#FFFFFF;border-radius:8px;margin-bottom:12px;border:1px solid #E2E8F0;">
            <div style="width:34px;height:1px;background:${gold};margin-bottom:12px;"></div>
            <p style="color:#475569;font-size:14px;margin:0;line-height:1.55;">${insight}</p>
          </div>
        `).join('')}
      ` : ''}

      <!-- Recommendation Highlights -->
      <h2 style="color:${navy};font-size:18px;font-weight:600;margin:0 0 15px;border-left:3px solid ${gold};padding-left:12px;">${copy.referenceTitle}</h2>
      ${result.recommendations.slice(0, 0).map((rec) => `
        <div style="padding:20px;background:${offWhite};border-radius:8px;margin-bottom:12px;border:1px solid #E2E8F0;border-left:4px solid ${navy};">
          <div style="color:${gold};font-size:10px;font-weight:700;margin-bottom:5px;text-transform:uppercase;">Prioritas Strategis — ${rec.service}</div>
          <p style="color:${navy};font-size:15px;font-weight:600;margin:0 0 8px;">${rec.title}</p>
          ${rec.diagnosis ? `<p style="color:${navy};font-size:13px;margin:0 0 8px;line-height:1.5;font-weight:500;">${rec.diagnosis}</p>` : ''}
          <p style="color:#64748B;font-size:14px;margin:0;line-height:1.5;">${rec.description}</p>
        </div>
      `).join('')}

      ${false && result.riskProjection ? `
        <div style="background:#FFF8E8;border-radius:8px;padding:22px;margin:30px 0;border:1px solid #F4E5B2;">
          <div style="color:${navy};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px;">Proyeksi Risiko 12-18 Bulan</div>
          <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">${result.riskProjection}</p>
        </div>
      ` : ''}

      <!-- PDF Note -->
      <div style="background:${offWhite};border-radius:8px;padding:25px;text-align:center;margin:35px 0;">
        <p style="color:#475569;font-size:14px;margin:0;line-height:1.6;">
          ${copy.pdfNote}
        </p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin:45px 0 10px;">
        <p style="color:#475569;font-size:14px;margin-bottom:20px;">${copy.proposalIntro}</p>
        <a href="${proposalUrl}" 
           style="display:inline-block;background-color:${navy};color:#FFFFFF;text-decoration:none;padding:16px 40px;border-radius:6px;font-weight:600;font-size:15px;letter-spacing:0.5px;box-shadow: 0 4px 6px rgba(10,26,58,0.2);">
          ${copy.proposalCta}
        </a>
        <div style="margin-top:25px;">
          <a href="https://binahub.id"
             style="color:${navy};font-size:13px;font-weight:600;text-decoration:underline;">
            ${copy.chatCta}
          </a>
        </div>
      </div>

      <div style="margin-top:42px;color:#334155;font-size:14px;line-height:1.65;">
        <p style="margin:0 0 16px;">${copy.closing}</p>
        <p style="margin:0;"><strong>Bilal Dwi Nugraha</strong><br>${copy.footer}</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:30px 40px;border-top:1px solid #E2E8F0;text-align:center;background-color:${offWhite};">
      <p style="color:#64748B;font-size:11px;margin:0;">PT Binahub Solusi Transformasi · www.binahub.id</p>
      <p style="color:#94A3B8;font-size:11px;margin:8px 0 0;">
        ${copy.auto} ${process.env.NEXT_PUBLIC_COMPANY_EMAIL || 'hello@binahub.id'}
      </p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    console.log(`[Email] Sending to ${formData.email}. PDF Attached: ${!!pdfBuffer} (${pdfBuffer?.length || 0} bytes)`);

    // Send to client
    const clientRes = await resend.emails.send({
      from: `${COMPANY_NAME} <${FROM}>`,
      to: formData.email,
      subject: copy.subject,
      html: htmlBody,
      tags: [
        { name: 'category', value: 'assessment_result' },
        { name: 'assessment_id', value: resendTagValue(assessmentId) },
      ],
      attachments: pdfBuffer
        ? [{ 
            filename: copy.fileName, 
            content: pdfBuffer.toString('base64') 
          }]
        : [],
    });
    if (clientRes.error) throw new Error(`Resend gagal mengirim hasil assessment: ${clientRes.error.message}`);

    console.log('[Email] Client email response:', clientRes);

    // Send copy to company
    const adminRes = await resend.emails.send({
      from: `${COMPANY_NAME} <${FROM}>`,
      to: COMPANY_COPY,
      subject: safeHeader(`[LEAD BARU] Assessment: ${formData.company} (${result.category})`),
      html: `<p>Data diagnostik baru telah diterima dari <strong>${safeName}</strong> (${safeCompany}).<br>
      Email: ${safeEmail}<br>WhatsApp: ${safeWhatsapp}<br>
      Skor: ${result.scores.overall}/100 — Kategori: ${safeCategory}</p>`,
    });

    if (adminRes.error) {
      console.warn('[Email Warning] Client result sent, but admin copy failed:', adminRes.error.message);
    }

    console.log('[Email] Admin notification response:', adminRes);

    return {
      clientEmailId: clientRes.data?.id || null,
      adminEmailId: adminRes.data?.id || null,
    };
  } catch (error) {
    console.error('[Email Error] Failed to send assessment emails:', error);
    throw error;
  }
}

export async function sendOutreachEmail(
  to: string,
  name: string,
  subject: string,
  htmlContent: string,
  company?: string
) {
  const normalizedTo = normalizeRecipientEmail(to);
  const db = createServerSupabase();
  const { data: suppression, error: suppressionError } = await db
    .from('email_suppressions')
    .select('email')
    .eq('email', normalizedTo)
    .maybeSingle();
  if (suppressionError) {
    throw new Error(`Gagal memeriksa suppression email: ${suppressionError.message}`);
  }
  if (suppression) {
    throw new OutreachSuppressedError();
  }

  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error('NEXT_PUBLIC_BINAHUB_API_URL belum dikonfigurasi.');
  const unsubscribeToken = createUnsubscribeToken(normalizedTo);
  const unsubscribeUrl = `${apiUrl}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const renderedHtml = renderApprovedOutreachHtml(
    htmlContent
      .replaceAll('{{name}}', escapeHtml(name))
      .replaceAll('{{company}}', escapeHtml(company || 'Perusahaan Anda')),
  );
  const response = await resend.emails.send({
    from: `${COMPANY_NAME} <${FROM}>`,
    to: normalizedTo,
    replyTo: REPLY_TO,
    subject: safeHeader(subject),
    html: appendUnsubscribeFooter(renderedHtml, unsubscribeUrl),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [{ name: 'category', value: 'commercial_follow_up' }],
  });
  if (response.error) throw new Error(`Resend gagal mengirim follow up: ${response.error.message}`);
  return response;
}

export async function sendAssociateInvitationEmail(
  to: string,
  name: string,
  subject: string,
  htmlContent: string,
  projectName?: string
) {
  const response = await resend.emails.send({
    from: `${COMPANY_NAME} <${FROM}>`,
    to,
    subject: safeHeader(subject),
    html: renderGeneratedEmailSafely(htmlContent, {
      '{{name}}': name,
      '{{project}}': projectName || 'Project BinaHub',
    }),
    tags: [
      { name: 'category', value: 'associate_invitation' },
      { name: 'project', value: resendTagValue(projectName) },
    ],
  });
  if (response.error) throw new Error(`Resend gagal mengirim undangan associate: ${response.error.message}`);
  return response;
}

export async function sendProposalEmail(
  to: string,
  name: string,
  company: string,
  proposal: {
    subject?: string;
    opening?: string;
    proposedProgram?: string;
    scope?: string[];
    timeline?: string;
    investmentNote?: string;
    nextStep?: string;
  },
  pdfBuffer?: Buffer,
  assessmentId?: string,
  locale: Locale = 'id',
) {
  const isEnglish = locale === 'en';
  const navy = '#0B2C6B';
  const gold = '#D9A441';
  const subject = safeHeader(isEnglish
    ? `Preliminary Recommendation for ${company}`
    : `Preliminary Recommendation untuk ${company}`);
  const safeName = escapeHtml(name);
  const safeCompany = escapeHtml(company);
  const safeProgram = escapeHtml(proposal.proposedProgram || (isEnglish ? 'Organization Development Program' : 'Program Pengembangan Organisasi'));
  const safeApproach = escapeHtml(proposal.opening || proposal.nextStep || (isEnglish
    ? 'A focused development approach aligned with the priorities identified in your diagnostic result.'
    : 'Pendekatan pengembangan terarah yang diselaraskan dengan prioritas pada hasil diagnosa Anda.'));
  const safeInvestment = escapeHtml(proposal.investmentNote || (isEnglish
    ? 'Please refer to the attached PDF for the initial investment estimate.'
    : 'Lihat laporan PDF terlampir untuk estimasi investasi awal.'));
  const areas = (proposal.scope || []).slice(0, 3).map((item) => escapeHtml(item));
  const consultationUrl = escapeHtml(getConsultationUrl());
  const copy = isEnglish
    ? {
        eyebrow: 'BinaHub Preliminary Recommendation',
        greeting: `Dear <strong>${safeName}</strong>,`,
        intro: `Thank you for requesting a <strong>Preliminary Recommendation</strong> based on your Team/Organization Effectiveness Diagnostic result. The complete recommendation is included in the attached PDF.`,
        areaTitle: 'Areas that can be strengthened',
        approachTitle: 'A potentially relevant approach',
        formatTitle: 'Indicative format',
        investmentTitle: 'Initial investment estimate',
        attachment: 'The attached PDF contains the recommended approach, indicative scope, assumptions, and initial investment range. The final scope and investment can be adjusted after we understand the organization context, number of participants, duration, and delivery format in greater detail.',
        question: 'Have a quick question? Simply reply to this email and we will be happy to help.',
        schedule: 'Prefer a deeper discussion?',
        cta: 'Choose a convenient discussion time',
        closing: 'Warm regards,',
        fileName: `BinaHub_Preliminary_Recommendation_${safeFilenamePart(company)}.pdf`,
      }
    : {
        eyebrow: 'Preliminary Recommendation BinaHub',
        greeting: `Yth. Bapak/Ibu <strong>${safeName}</strong>,`,
        intro: `Terima kasih telah meminta <strong>Preliminary Recommendation</strong> berdasarkan hasil Diagnosa Efektivitas Tim/Organisasi Anda. Rekomendasi lengkap kami lampirkan dalam bentuk PDF.`,
        areaTitle: 'Area yang dapat diperkuat',
        approachTitle: 'Gambaran pendekatan yang mungkin relevan',
        formatTitle: 'Format indikatif',
        investmentTitle: 'Estimasi investasi awal',
        attachment: 'PDF terlampir memuat pendekatan, cakupan indikatif, asumsi, dan estimasi investasi awal. Pendekatan dan investasi dapat disesuaikan setelah konteks organisasi, jumlah peserta, durasi, dan format program dipahami lebih lanjut.',
        question: 'Ada pertanyaan singkat? Cukup balas email ini dan kami akan dengan senang hati membantu.',
        schedule: 'Ingin berdiskusi lebih mendalam?',
        cta: 'Pilih waktu diskusi yang nyaman',
        closing: 'Salam hangat,',
        fileName: `Preliminary_Recommendation_${safeFilenamePart(company)}.pdf`,
      };

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#EAF0F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:36px auto;background:#FFFFFF;border-radius:10px;overflow:hidden;border:1px solid #DDE5F0;">
    <div style="background:${navy};padding:34px 38px;border-bottom:4px solid ${gold};">
      <p style="margin:0 0 10px;color:${gold};font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;">${copy.eyebrow}</p>
      <h1 style="margin:0;color:#FFFFFF;font-size:25px;font-weight:600;line-height:1.25;">${safeProgram}</h1>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.72);font-size:14px;">${safeCompany}</p>
    </div>
    <div style="padding:36px 38px;color:#334155;">
      <p style="margin:0 0 18px;color:${navy};font-size:16px;">${copy.greeting}</p>
      <p style="margin:0 0 24px;line-height:1.7;font-size:15px;">${copy.intro}</p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:22px;margin-bottom:22px;">
        <p style="margin:0 0 8px;color:${navy};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${copy.areaTitle}</p>
        <ul style="margin:0;padding-left:20px;line-height:1.7;font-size:14px;">
          ${(areas.length ? areas : [safeProgram]).map((area) => `<li>${area}</li>`).join('')}
        </ul>
      </div>

      <p style="margin:0 0 6px;color:${navy};font-size:13px;font-weight:700;">${copy.approachTitle}</p>
      <p style="margin:0 0 20px;line-height:1.7;font-size:15px;">${safeApproach}</p>
      <p style="margin:0 0 6px;color:${navy};font-size:13px;font-weight:700;">${copy.formatTitle}</p>
      <p style="margin:0 0 20px;line-height:1.7;font-size:15px;">${safeProgram}</p>
      <p style="margin:0 0 6px;color:${navy};font-size:13px;font-weight:700;">${copy.investmentTitle}</p>
      <p style="margin:0 0 22px;line-height:1.7;font-size:15px;font-weight:600;">${safeInvestment}</p>
      <p style="margin:0 0 28px;line-height:1.7;font-size:14px;color:#64748B;">${copy.attachment}</p>

      <div style="border-top:1px solid #E2E8F0;padding-top:24px;text-align:center;">
        <p style="margin:0 0 10px;color:#475569;font-size:14px;line-height:1.6;">${copy.question}</p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">${copy.schedule}</p>
        <a href="${consultationUrl}" style="display:inline-block;background:${navy};color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:14px;">${copy.cta}</a>
      </div>

      <div style="margin-top:36px;font-size:14px;line-height:1.65;">
        <p style="margin:0 0 14px;">${copy.closing}</p>
        <p style="margin:0;"><strong>Bilal Dwi Nugraha</strong><br>CEO | BinaHub<br><em>People. Learning. Elevated.</em><br><a href="https://www.binahub.id" style="color:${navy};">www.binahub.id</a></p>
      </div>
    </div>
    <div style="padding:20px 38px;background:#F8FAFC;border-top:1px solid #E2E8F0;color:#64748B;font-size:11px;text-align:center;">PT Binahub Solusi Transformasi · www.binahub.id</div>
  </div>
</body>
</html>
`;

  const response = await resend.emails.send({
    from: `${COMPANY_NAME} <${FROM}>`,
    to,
    subject,
    html,
    tags: [
      { name: 'category', value: 'assessment_proposal' },
      { name: 'assessment_id', value: resendTagValue(assessmentId) },
    ],
    attachments: pdfBuffer
      ? [{
          filename: copy.fileName,
          content: pdfBuffer.toString('base64'),
        }]
      : [],
  });
  if (response.error) throw new Error(`Resend gagal mengirim proposal: ${response.error.message}`);
  return response;
}
