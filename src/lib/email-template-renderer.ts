export function renderApprovedOutreachHtml(htmlContent: string) {
  const sanitized = htmlContent
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math|video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|meta|link|base|svg|math|video|audio)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*(?:javascript|vbscript|data):[\s\S]*?\2/gi, '');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:24px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#334155;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;">
    <div style="height:5px;background:#D9A441;"></div>
    <div style="padding:24px 34px 0;color:#0B2C6B;font-size:20px;font-weight:750;letter-spacing:-.3px;">Bina<span style="color:#D9A441;">Hub</span></div>
    <div style="padding:28px 34px 34px;line-height:1.7;font-size:15px;">${sanitized}</div>
    <div style="padding:20px 34px;background:#F8FAFC;border-top:1px solid #E2E8F0;color:#64748B;font-size:11px;line-height:1.6;text-align:center;">
      PT Binahub Solusi Transformasi · <a href="https://www.binahub.id" style="color:#0B2C6B;">www.binahub.id</a>
    </div>
  </div>
</body>
</html>`;
}
