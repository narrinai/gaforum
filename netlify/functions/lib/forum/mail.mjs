// Login code mail via the SendGrid v3 HTTP API (plain fetch, no SDK).
import { envGet } from "./util.mjs";

export const FROM_EMAIL = "hello@ga-forum.com";
export const FROM_NAME = "GA Forum";
export const SUBJECT = "Your GA Forum login code";

export function mailConfigured() {
  return !!envGet("SENDGRID_API_KEY");
}

export function buildCodeMail(to, code) {
  const text =
    `Your GA Forum login code is ${code}\n\n` +
    `Enter it on the site to log in. The code works for 10 minutes.\n\n` +
    `If you did not ask for this code, you can ignore this email.\n\nGA Forum\nhttps://ga-forum.com/forum\n`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#231F3D;max-width:480px">` +
    `<p>Your GA Forum login code is:</p>` +
    `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>` +
    `<p>Enter it on the site to log in. The code works for 10 minutes.</p>` +
    `<p style="color:#6F6A85">If you did not ask for this code, you can ignore this email.</p>` +
    `<p>GA Forum<br><a href="https://ga-forum.com/forum">ga-forum.com/forum</a></p></div>`;
  return {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    subject: SUBJECT,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
    tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
  };
}

// Test hook: replace fetch used for SendGrid.
let fetchImpl = (...args) => fetch(...args);
export function setMailFetch(fn) { fetchImpl = fn; }

export async function sendCodeMail(to, code) {
  const key = envGet("SENDGRID_API_KEY");
  if (!key) return { ok: false, error: "login_unavailable" };
  try {
    const res = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildCodeMail(to, code)),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch {}
    console.error("SendGrid error", res.status, detail);
    return { ok: false, error: "mail_failed" };
  } catch (err) {
    console.error("SendGrid request failed", err && err.message);
    return { ok: false, error: "mail_failed" };
  }
}
