import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';

const NAVY = '#0B2C6B';
const GOLD = '#D9A441';

function successHtml(name: string, company: string) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Permintaan Proposal - BinaHub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F5F7FA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #1A1A2E;
    }
    .card {
      background: #FFFFFF;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(11,44,107,0.08);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: ${NAVY};
      padding: 32px 40px 28px;
      text-align: center;
    }
    .logo {
      font-size: 22px;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 4px;
    }
    .logo span { color: ${GOLD}; }
    .tagline {
      font-size: 11px;
      font-weight: 500;
      color: rgba(255,255,255,0.55);
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .body { padding: 36px 40px 40px; text-align: center; }
    .checkmark {
      width: 64px; height: 64px;
      background: #E8F5E9;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .checkmark svg { width: 32px; height: 32px; }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: ${NAVY};
      margin-bottom: 12px;
    }
    p {
      font-size: 15px;
      line-height: 1.7;
      color: #4A4C54;
      margin-bottom: 8px;
    }
    .highlight {
      font-weight: 600;
      color: ${NAVY};
    }
    .divider {
      width: 48px;
      height: 3px;
      background: ${GOLD};
      border-radius: 2px;
      margin: 24px auto;
    }
    .info-box {
      background: #F0F4FF;
      border-left: 3px solid ${NAVY};
      border-radius: 0 8px 8px 0;
      padding: 16px 20px;
      text-align: left;
      margin: 24px 0;
    }
    .info-box p {
      font-size: 13px;
      color: #4A4C54;
      margin: 0;
    }
    .footer {
      padding: 20px 40px;
      border-top: 1px solid #E8ECF1;
      text-align: center;
    }
    .footer p {
      font-size: 11px;
      color: #94A3B8;
      margin: 0;
    }
    .footer a {
      color: ${NAVY};
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">Bina<span>Hub</span></div>
      <div class="tagline">Human-Centered Transformation Partner</div>
    </div>
    <div class="body">
      <div class="checkmark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2E7D32" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h1>Permintaan Proposal Diterima</h1>
      <p>Terima kasih, <span class="highlight">${name}</span> dari <span class="highlight">${company}</span>.</p>
      <p>Tim kami akan menyusun proposal penawaran dan mengirimkannya ke email Anda dalam waktu dekat.</p>

      <div class="divider"></div>

      <div class="info-box">
        <p><strong>Yang terjadi selanjutnya:</strong></p>
        <p>1. Tim BinaHub menyusun proposal sesuai hasil diagnostik</p>
        <p>2. Proposal dikirim ke email Anda</p>
        <p>3. Kami akan menghubungi untuk diskusi lebih lanjut</p>
      </div>
    </div>
    <div class="footer">
      <p><a href="https://binahub.id">binahub.id</a> &middot; People Transformation &amp; Future Capability Partner</p>
    </div>
  </div>
</body>
</html>`;
}

function errorHtml(title: string, message: string) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - BinaHub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F5F7FA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #1A1A2E;
    }
    .card {
      background: #FFFFFF;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(11,44,107,0.08);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: ${NAVY};
      padding: 32px 40px 28px;
      text-align: center;
    }
    .logo { font-size: 22px; font-weight: 700; color: #FFFFFF; }
    .logo span { color: ${GOLD}; }
    .body { padding: 36px 40px 40px; text-align: center; }
    h1 { font-size: 18px; font-weight: 700; color: ${NAVY}; margin-bottom: 12px; }
    p { font-size: 15px; line-height: 1.7; color: #4A4C54; }
    .footer {
      padding: 20px 40px;
      border-top: 1px solid #E8ECF1;
      text-align: center;
    }
    .footer p { font-size: 11px; color: #94A3B8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">Bina<span>Hub</span></div>
    </div>
    <div class="body">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
    <div class="footer">
      <p><a href="https://binahub.id" style="color:${NAVY};text-decoration:none;font-weight:600;">binahub.id</a></p>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(req: NextRequest) {
  const assessmentId = req.nextUrl.searchParams.get('assessmentId');

  if (!assessmentId) {
    return new NextResponse(errorHtml(
      'Link Tidak Valid',
      'Parameter assessmentId tidak ditemukan. Silakan gunakan link dari email yang kami kirimkan.'
    ), { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const supabase = createServerSupabase();

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select('id, assessment_status, proposal_status, form_data')
    .eq('id', assessmentId)
    .single();

  if (error || !assessment) {
    return new NextResponse(errorHtml(
      'Assessment Tidak Ditemukan',
      'Data assessment tidak ditemukan. Silakan hubungi tim BinaHub untuk bantuan.'
    ), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const terminalStatuses = ['Diminta', 'Sedang Disusun', 'Terkirim', 'Revisi', 'Lanjut Diskusi', 'Deal', 'Lost', 'Closed'];
  if (terminalStatuses.includes(assessment.proposal_status || '')) {
    const formData = assessment.form_data as Record<string, string> | null;
    const name = formData?.name || 'Bapak/Ibu';
    const company = formData?.company || 'Perusahaan Anda';
    return new NextResponse(successHtml(name, company), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const { error: updateError } = await supabase
    .from('assessments')
    .update({
      assessment_status: 'Minta Proposal',
      proposal_status: 'Diminta',
      proposal_requested_at: new Date().toISOString(),
    })
    .eq('id', assessmentId);

  if (updateError) {
    console.error('[API] Failed to update proposal status:', updateError);
    return new NextResponse(errorHtml(
      'Gagal Memproses',
      'Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi atau hubungi tim BinaHub.'
    ), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const formData = assessment.form_data as Record<string, string> | null;
  const name = formData?.name || 'Bapak/Ibu';
  const company = formData?.company || 'Perusahaan Anda';

  return new NextResponse(successHtml(name, company), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
