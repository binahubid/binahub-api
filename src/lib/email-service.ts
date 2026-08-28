import { Resend } from 'resend';
import { AssessmentData } from './validations';
import { AssessmentResult } from './pdf-service';
import type { Locale } from '@/i18n/config';
import { createProposalToken } from '@/lib/secure-token';
import { createServerSupabase } from '@/lib/supabase';
import { createUnsubscribeToken, normalizeRecipientEmail } from '@/lib/unsubscribe-token';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM && process.env.EMAIL_FROM.includes('@') 
  ? process.env.EMAIL_FROM 
  : 'onboarding@resend.dev';
const COMPANY_COPY = process.env.EMAIL_COMPANY_COPY || 'admin@binahub.id';
const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'BinaHub';

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

function appendUnsubscribeFooter(html: string, unsubscribeUrl: string) {
  const footer = `
  <div style="max-width:640px;margin:14px auto 0;padding:0 20px;text-align:center;color:#64748B;font-family:Arial,sans-serif;font-size:12px;line-height:1.6;">
    Email ini merupakan follow-up dari BinaHub. Jika Anda tidak ingin menerima follow-up berikutnya,
    <a href="${escapeHtml(unsubscribeUrl)}" style="color:#0B2C6B;text-decoration:underline;">atur preferensi email</a>.
  </div>`;
  return html.includes('</body>') ? html.replace('</body>', `${footer}</body>`) : `${html}${footer}`;
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
  const copy = isEnglish
    ? {
        title: 'Executive Report',
        preheader: 'BinaHub Insight Diagnostic',
        heading: 'Confidential Executive Assessment',
        greeting: `Dear <strong>${safeName}</strong>,`,
        intro: `Thank you for completing the BinaHub Insight diagnostic process. Your initial report has been processed and attached as a PDF so it can be reviewed more fully by the internal team at ${safeCompany}.`,
        overallScore: 'Overall Score',
        stage: 'Stage',
        noteTitle: 'Introductory Note',
        noteBody: 'This email serves as the official introduction to the completed diagnostic result. The full analysis, development priorities, cross-dimensional reasoning, and initial recommendations are available in the attached PDF.',
        referenceTitle: 'Reference Document',
        pdfNote: '<strong>The full PDF report</strong> contains visualization details, diagnostic insights, strategic priorities, and an initial roadmap. This email is intentionally brief so the main document remains the official reference.',
        proposalIntro: 'If you would like to understand the program format, scope, and investment direction most relevant to this diagnostic result, you can request an initial proposal from our team.',
        proposalCta: 'Request Proposal',
        chatCta: 'Ask an initial question through the BinaHub assistant',
        footer: 'People Transformation & Future Capability Partner',
        auto: 'This email was sent automatically. If you need assistance, reply to',
        subject: safeHeader(`Confidential Executive Assessment · ${formData.company}`),
        fileName: `Diagnostic_Report_${safeFilenamePart(formData.company)}.pdf`,
      }
    : {
        title: 'Laporan Eksekutif',
        preheader: 'Diagnostik BinaHub Insight',
        heading: 'Asesmen Eksekutif Rahasia',
        greeting: `Yth. <strong>Bapak/Ibu ${safeName}</strong>,`,
        intro: `Terima kasih telah menyelesaikan proses diagnostik BinaHub Insight. Laporan awal Anda telah kami proses dan kami lampirkan dalam bentuk PDF agar dapat ditinjau secara lebih utuh oleh tim internal ${safeCompany}.`,
        overallScore: 'Skor Keseluruhan',
        stage: 'Tahap',
        noteTitle: 'Catatan Pendahuluan',
        noteBody: 'Email ini bersifat sebagai pengantar resmi atas hasil diagnostik yang telah diselesaikan. Seluruh detail analisis, prioritas pengembangan, penalaran lintas dimensi, dan rekomendasi awal tersedia dalam PDF terlampir.',
        referenceTitle: 'Dokumen Rujukan',
        pdfNote: '<strong>Laporan lengkap (PDF)</strong> berisi detail visualisasi, insight diagnostik, prioritas strategis, dan roadmap awal. Badan email ini kami buat ringkas agar dokumen utama tetap menjadi rujukan resmi.',
        proposalIntro: 'Jika Bapak/Ibu ingin mengetahui bentuk program, ruang lingkup, dan arah investasi yang paling relevan dengan hasil diagnostik ini, silakan minta penawaran awal dari tim kami.',
        proposalCta: 'Minta Penawaran',
        chatCta: 'Ajukan pertanyaan awal melalui asisten BinaHub',
        footer: 'Mitra Transformasi Manusia & Kapabilitas Masa Depan',
        auto: 'Email ini dikirim secara otomatis. Jika butuh bantuan, balas ke',
        subject: safeHeader(`Asesmen Eksekutif Rahasia · ${formData.company}`),
        fileName: `Laporan_Diagnostik_${safeFilenamePart(formData.company)}.pdf`,
      };
  // Brand Colors
  const navy = '#0B2C6B';
  const gold = '#D9A441';
  const offWhite = '#F5F7FA';
  const scoreInterpretation = escapeHtml(result.scoreInterpretation || `Skor ${result.scores.overall} menempatkan ${formData.company} pada kategori ${result.category}. Ini menunjukkan fondasi organisasi yang dapat diperkuat melalui prioritas strategis yang lebih tajam.`);
  const crossInsights: string[] = [];
  const appUrl = getAppUrl();
  const apiUrl = (process.env.NEXT_PUBLIC_BINAHUB_API_URL || '').replace(/\/$/, '');
  const localizedAppUrl = appUrl ? `${appUrl}${isEnglish ? '/en' : ''}` : '';
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
          <a href="${localizedAppUrl || appUrl || '#'}?chat=open&name=${encodeURIComponent(formData.name)}&company=${encodeURIComponent(formData.company)}&score=${result.scores.overall}" 
             style="color:${navy};font-size:13px;font-weight:600;text-decoration:underline;">
            ${copy.chatCta}
          </a>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:30px 40px;border-top:1px solid #E2E8F0;text-align:center;background-color:${offWhite};">
      <p style="color:${navy};font-size:12px;margin:0;font-weight:600;letter-spacing:1px;text-transform:uppercase;">${COMPANY_NAME}</p>
      <p style="color:#94A3B8;font-size:11px;margin:8px 0 0;">
        ${copy.footer}<br>
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
  const renderedHtml = renderGeneratedEmailSafely(htmlContent, {
    '{{name}}': name,
    '{{company}}': company || 'Perusahaan Anda',
  });
  const response = await resend.emails.send({
    from: `${COMPANY_NAME} <${FROM}>`,
    to: normalizedTo,
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
  assessmentId?: string
) {
  const navy = '#0B2C6B';
  const gold = '#D9A441';
  const subject = safeHeader(proposal.subject || `Proposal Penawaran BinaHub untuk ${company}`);
  const appUrl = getAppUrl();
  const safeName = escapeHtml(name);
  const safeCompany = escapeHtml(company);
  const safeProgram = escapeHtml(proposal.proposedProgram || 'Program Transformasi Organisasi');
  const safeOpening = escapeHtml(proposal.opening || 'Berdasarkan hasil diagnostik yang telah Anda selesaikan, kami menyusun penawaran awal yang dapat menjadi bahan diskusi internal dan tindak lanjut bersama tim BinaHub.');
  const safeNextStep = escapeHtml(proposal.nextStep || 'Langkah berikutnya adalah menyelaraskan prioritas program, ruang lingkup, peserta, dan paket yang paling sesuai.');

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#EAF0F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:36px auto;background:#FFFFFF;border-radius:10px;overflow:hidden;border:1px solid #DDE5F0;">
    <div style="background:${navy};padding:34px 38px;border-bottom:4px solid ${gold};">
      <p style="margin:0 0 10px;color:${gold};font-size:10px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;">Proposal Penawaran BinaHub</p>
      <h1 style="margin:0;color:#FFFFFF;font-size:25px;font-weight:600;line-height:1.25;">${safeProgram}</h1>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.72);font-size:14px;">${safeCompany}</p>
    </div>
    <div style="padding:36px 38px;color:#334155;">
      <p style="margin:0 0 18px;color:${navy};font-size:16px;">Yth. <strong>${safeName}</strong>,</p>
      <p style="margin:0 0 22px;line-height:1.7;font-size:15px;">${safeOpening}</p>
      <p style="margin:0 0 26px;line-height:1.7;font-size:15px;">Detail ruang lingkup, estimasi timeline, pilihan paket A/B/C, dan catatan investasi kami lampirkan dalam PDF proposal. Email ini kami buat sebagai pengantar agar dokumen utama tetap menjadi rujukan resmi.</p>

      <div style="border-top:1px solid #E2E8F0;padding-top:24px;text-align:center;">
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.6;">${safeNextStep}</p>
        <a href="https://calendly.com/binahub-diagnostic/consultation" style="display:inline-block;background:${navy};color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:700;font-size:14px;">Jadwalkan Diskusi Lanjutan</a>
        <div style="margin-top:22px;">
          <a href="${appUrl || '#'}?chat=open&name=${encodeURIComponent(name)}&company=${encodeURIComponent(company)}"
             style="color:${navy};font-size:13px;font-weight:600;text-decoration:underline;">
            Ajukan pertanyaan awal melalui asisten BinaHub
          </a>
        </div>
      </div>
    </div>
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
          filename: `Proposal_Penawaran_${safeFilenamePart(company)}.pdf`,
          content: pdfBuffer.toString('base64'),
        }]
      : [],
  });
  if (response.error) throw new Error(`Resend gagal mengirim proposal: ${response.error.message}`);
  return response;
}
