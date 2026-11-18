// Netlify event-triggered function: runs on every verified Netlify Forms submission on
// ga-forum.com and schedules a short auto-reply to the sender about ten minutes later
// (SendGrid `send_at`). Same pattern as the sister sites, own wording.
//
// Forms (see scripts/build.py): "get-listed" (name, email, company, website, category, message)
// and "contact" (name, email, company, message). Unknown forms are logged, not mailed.
//
// Environment (Netlify > Site configuration > Environment variables):
//   SENDGRID_API_KEY         SendGrid key with Mail Send (GAF_SENDGRID_API_KEY also accepted)
//   GAF_FROM_EMAIL           verified sender; default hello@ga-forum.com
//   GAF_EMAIL_DELAY_SECONDS  optional; default 600, 0 sends at once
//   EP_INGEST_KEY            optional; when set the lead is also posted to the shared lead tracker (site "gaf")

const DELAY_SECONDS = Number(process.env.GAF_EMAIL_DELAY_SECONDS ?? 600);
const FROM_EMAIL = process.env.GAF_FROM_EMAIL || "hello@ga-forum.com";
const FROM_NAME = "Seb from GA Forum";
const SITE = "https://ga-forum.com";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const FLOWS = {
  "get-listed": {
    subject: "Your GA Forum listing request",
    blocks: (name, d) => [
      `Hi ${name},`,
      `Thanks for telling us about ${d.company || "your product"}. We check every product on its own website, pricing and documentation pages before it appears in a ranking, so we will look at ${d.website || "your site"} and come back to you with where it fits${d.category ? ` (you mentioned ${d.category})` : ""}.`,
      `If there is a page we should read first, such as pricing, license terms or docs for game engines or streaming platforms you support, just reply with the link. You can see how we work at ${SITE}/editorial-process.`,
      `Best,\nSeb\nGA Forum`,
    ],
  },
  contact: {
    subject: "We received your message",
    blocks: (name) => [
      `Hi ${name},`,
      `Thanks for writing to GA Forum. Your message reached us and we usually answer within two working days.`,
      `If it is about a correction, a link to the page that shows the right information helps us fix it faster.`,
      `Best,\nSeb\nGA Forum`,
    ],
  },
};

function mailBody({ flow, toEmail, toName, data, sendAt }) {
  const blocks = flow.blocks(toName, data);
  const text = blocks.join("\n\n");
  const html = blocks.map((b) => `<p>${esc(b).replace(/\n/g, "<br>")}</p>`).join("");
  return {
    personalizations: [{ to: [{ email: toEmail, name: toName }], ...(sendAt ? { send_at: sendAt } : {}) }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: flow.subject,
    content: [{ type: "text/plain", value: text }, { type: "text/html", value: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#231F3D">${html}</div>` }],
  };
}

async function recordLead(data, formName, submittedAt) {
  const key = process.env.EP_INGEST_KEY;
  if (!key) return;
  try {
    const res = await fetch("https://europeanpurpose.com/.netlify/functions/lead-ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ingest-Key": key },
      body: JSON.stringify({
        site: "gaf",
        email: String(data.email || "").trim(),
        name: String(data.name || "").trim(),
        subject: formName === "get-listed" ? "Get listed" : "Contact",
        message: [data.message, data.company && `Company: ${data.company}`, data.website && `Website: ${data.website}`, data.category && `Category: ${data.category}`].filter(Boolean).join("\n"),
        at: submittedAt || new Date().toISOString(),
      }),
    });
    if (!res.ok) console.error(`recordLead: tracker answered ${res.status}`);
  } catch (e) {
    console.error("recordLead failed:", e);
  }
}

export const handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body || "{}");
    const data = (payload && payload.data) || {};
    const formName = String((payload && payload.form_name) || data["form-name"] || "").trim();
    const toEmail = String(data.email || "").trim();
    const toName = String(data.name || "").trim().split(/\s+/)[0] || "there";
    await recordLead(data, formName, payload && payload.created_at);
    const flow = FLOWS[formName];
    if (!flow) {
      console.error(`submission-created: no flow for form "${formName}"`);
      return { statusCode: 200, body: "No flow" };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return { statusCode: 200, body: "No valid email" };
    const apiKey = process.env.GAF_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error("submission-created: SENDGRID_API_KEY not set, no auto-reply");
      return { statusCode: 200, body: "Email not configured" };
    }
    const sendAt = DELAY_SECONDS > 0 ? Math.floor(Date.now() / 1000) + DELAY_SECONDS : undefined;
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(mailBody({ flow, toEmail, toName, data, sendAt })),
    });
    if (res.status >= 400) {
      console.error(`submission-created: SendGrid ${res.status}: ${await res.text()}`);
      return { statusCode: 200, body: `SendGrid error ${res.status}` };
    }
    return { statusCode: 200, body: "Scheduled" };
  } catch (e) {
    console.error("submission-created failed:", e);
    return { statusCode: 200, body: "Handled error" };
  }
};
