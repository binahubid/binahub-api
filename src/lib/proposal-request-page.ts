type RequestPage = {
  locale?: "id" | "en";
  state: "confirm" | "received" | "sent" | "error";
  action?: string;
  title?: string;
  message?: string;
};

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function proposalRequestPage(input: RequestPage) {
  const en = input.locale === "en";
  const confirm = input.state === "confirm";
  const copy = en ? {
    confirm: "Request your proposal", received: "Proposal request received", sent: "Your proposal has been sent",
    confirmMessage: "Receive a proposal tailored to your diagnostic results by email.",
    receivedMessage: "Thank you. Your proposal will be sent to your email. You can close this page.",
    sentMessage: "Please check your inbox, including your spam folder. You can close this page.",
    button: "Send proposal request", loading: "Sending your request…", waiting: "Please wait a moment.", back: "Visit BinaHub", error: "Unable to complete your request",
  } : {
    confirm: "Minta proposal Anda", received: "Permintaan proposal diterima", sent: "Proposal telah dikirim",
    confirmMessage: "Terima proposal berdasarkan hasil diagnosa Anda melalui email.",
    receivedMessage: "Terima kasih. Proposal akan dikirim ke email Anda. Anda dapat menutup halaman ini.",
    sentMessage: "Silakan periksa kotak masuk, termasuk folder spam. Anda dapat menutup halaman ini.",
    button: "Kirim permintaan proposal", loading: "Mengirim permintaan…", waiting: "Mohon tunggu sebentar.", back: "Kembali ke BinaHub", error: "Permintaan belum berhasil",
  };
  const title = input.title || copy[input.state === "confirm" ? "confirm" : input.state === "received" ? "received" : input.state === "sent" ? "sent" : "error"];
  const message = input.message || (confirm ? copy.confirmMessage : input.state === "sent" ? copy.sentMessage : copy.receivedMessage);
  return `<!doctype html>
<html lang="${en ? "en" : "id"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(title)} — BinaHub</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px 16px;background:#f5f7fa;color:#123366;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:100%;max-width:460px;border:1px solid #e3e9f1;border-radius:20px;background:#fff;box-shadow:0 12px 40px #0b2c6b08;overflow:hidden}.brand{padding:26px 28px;border-bottom:1px solid #edf0f5;font-size:23px;font-weight:750;letter-spacing:-.8px}.brand span{color:#bf8d35}.body{padding:34px 28px 30px}h1{margin:20px 0 12px;font-size:25px;line-height:1.3;letter-spacing:-.6px}p{margin:0;color:#64748b;font-size:15px;line-height:1.75}.icon{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:${confirm ? "#eef3fc" : input.state === "error" ? "#fff3e6" : "#edf8ef"};color:${confirm ? "#0b2c6b" : input.state === "error" ? "#a65b17" : "#287342"}}.icon svg{width:26px;height:26px}.button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;padding:14px 18px;margin-top:26px;border:0;border-radius:12px;background:#0b2c6b;color:white;font:inherit;font-size:14px;font-weight:650;cursor:pointer}.button:focus-visible{outline:3px solid #d9a441;outline-offset:3px}.button:disabled{cursor:wait;background:#365383}.spinner{display:none;width:19px;height:19px;border:2px solid #ffffff50;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}.button[aria-busy=true] .spinner{display:inline-block}.status{min-height:22px;margin-top:12px;text-align:center;font-size:13px}.footer{padding:20px 28px;border-top:1px solid #edf0f5;font-size:12px;color:#94a3b8}.footer a{color:#64748b;text-decoration:none}.footer a:focus-visible{outline:2px solid #d9a441} @keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinner{animation:none}}@media(max-width:360px){.body{padding:28px 22px}h1{font-size:23px}}
</style></head><body><main class="card"><div class="brand">Bina<span>Hub</span></div><div class="body"><div class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${confirm ? '<path d="M4 4h16v16H4zM8 9h8M8 13h5"/>' : input.state === "error" ? '<path d="M12 8v5M12 17h.01M3 20h18L12 3z"/>' : '<path d="m5 12 4 4L19 6"/>'}</svg></div><h1>${escape(title)}</h1><p>${escape(message)}</p>${confirm ? `<form id="proposal-request" method="post" action="${escape(input.action || "")}"><button class="button" type="submit" id="submit-request"><span class="spinner" aria-hidden="true"></span><span id="button-label">${copy.button}</span></button><p class="status" id="request-status" role="status" aria-live="polite"></p></form>` : ""}</div><footer class="footer"><a href="https://binahub.id">${copy.back} ↗</a></footer></main>${confirm ? `<script>
(()=>{const form=document.getElementById('proposal-request');const button=document.getElementById('submit-request');const label=document.getElementById('button-label');const status=document.getElementById('request-status');let submitting=false;form.addEventListener('submit',event=>{if(submitting){event.preventDefault();return;}submitting=true;button.disabled=true;button.setAttribute('aria-busy','true');label.textContent=${JSON.stringify(copy.loading)};status.textContent=${JSON.stringify(copy.waiting)};});window.addEventListener('pageshow',()=>{submitting=false;button.disabled=false;button.removeAttribute('aria-busy');label.textContent=${JSON.stringify(copy.button)};status.textContent='';});})();
</script>` : ""}</body></html>`;
}
