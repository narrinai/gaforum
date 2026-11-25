// Netlify event-triggered function: runs on every verified Netlify Forms submission on ga-forum.com
// and schedules an auto-reply to the visitor about ten minutes later through SendGrid's `send_at`.
// Same approach as the other sites (Seb, 25 Nov 2026): ladder, bundle discount, related pages on the other sites,
// the free listing against a dofollow link to THIS site (never to 2 Steps Ahead), the 2 Steps Ahead audit paragraph.
// Difference: no screenshots; the portfolio figures are quoted and the site is said to be new, so the related pages get the focus.
//
// Forms: "get-listed" (name, email, company, website, category, message) -> positions pitch; "contact" -> short acknowledgement.
//
// Environment (Netlify > Site configuration > Environment variables):
//   GAF_SENDGRID_API_KEY  or SENDGRID_API_KEY   SendGrid key with Mail Send
//   GAF_FROM_EMAIL          verified sender; default hello@ga-forum.com
//   GAF_EMAIL_DELAY_SECONDS optional; default 600, 0 sends at once
//   EP_INGEST_KEY                   same value as on europeanpurpose.com; without it the lead is not sent to the tracker (site "gaf")

import { SITE_NAME, siteCount, siteNames, joinNames, proofParagraphs, endingParagraphs, auditTarget } from "./lib/ai-proof.mjs";
import { VENDOR_DOMAINS } from "./lib/vendor-domains.mjs";
import { signatureHtml } from "./lib/email-signature.mjs";
import { CROSS_SITE_INDEX, CROSS_SITE_ALT_INDEX } from "./lib/cross-site-index.mjs";
import { crossSiteBlock, alternativesBlock } from "./lib/cross-site-match.mjs";

const DELAY_SECONDS = Number(process.env.GAF_EMAIL_DELAY_SECONDS ?? 10 * 60);

const SITE = "https://ga-forum.com";
const CODE = "gaf";
const NAME = "GA Forum";
const EUROPEAN_ONLY = false;
const EP = "https://europeanpurpose.com";
// Sender, reply address and the Netlify form notification are all
// hello@ga-forum.com, the default below (GAF_FROM_EMAIL and GAF_REPLY_TO override it):
// one mailbox per site. A Reply-To equal to the From is left out; one on
// another domain than the From is a spam signal.
export const FROM_EMAIL = process.env.GAF_FROM_EMAIL || "hello@ga-forum.com";
const REPLY_TO = process.env.GAF_REPLY_TO || FROM_EMAIL;
const FROM_NAME = "Seb from GA Forum";

// One screenshot per mail, chosen by isEuropean(): European Purpose's for a European sender, The Knowledge Engineers' otherwise (lib/ai-proof.mjs, SHOTS).

// European country-code TLDs, in line with REGIONS['Europe'] in scripts/build.py,
// plus .eu and .li.
const EUROPEAN_TLDS = new Set([
  "al", "at", "be", "bg", "ch", "cy", "cz", "de", "dk", "ee", "es", "eu", "fi", "fr", "gr", "hr",
  "hu", "ie", "is", "it", "li", "lt", "lu", "lv", "mt", "nl", "no", "pl", "pt", "ro", "rs", "se",
  "si", "sk", "ua", "uk",
]);

// Whether the sender's company is European, from their email domain:
//   1. the domain, or a parent of it, belongs to a vendor in our own product
//      database or in EP's: then we know the country;
//   2. otherwise a European country-code TLD;
//   3. otherwise not European, which includes gmail and a .com we do not know.
//      Sending an American vendor the EP story is worse than missing it for a
//      European one on a .com.
export function isEuropean(email) {
  const host = (String(email).split("@")[1] || "").toLowerCase().trim();
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join(".");
    if (d in VENDOR_DOMAINS) return VENDOR_DOMAINS[d] === "europe";
  }
  return EUROPEAN_TLDS.has(parts[parts.length - 1]);
}

// A block is a paragraph (newlines become line breaks), the inline image, a
// two-column table or a bold lead with bullets. Text and HTML are rendered from
// the same list so the two parts of the mail cannot drift apart.
const table = (head, rows) => ({ table: { head, rows } });
// Bundle discount over the total, pages on all five sites count together (Seb, 17 Nov 2026).
const BUNDLE = [
  ["2 pages", "15%"],
  ["3 pages", "25%"],
  ["4 or more", "35%"],
];
const section = (heading, bullets = []) => ({ section: { heading, bullets } });

// Prices per category page per year; bundle discount in BUNDLE. Each row is [position, price].
const LADDER = [
  ["#1 on the page", "€499"],
  ["#2", "€449"],
  ["#3", "€399"],
  ["#4", "€349"],
  ["#5", "€299"],
  ["#6", "€259"],
  ["#7", "€219"],
  ["#8", "€189"],
  ["#9", "€159"],
  ["#10", "€129"],
  ["#11 and lower", "Free"],
];


// Full signature for first mails (Seb, 18 Oct 2026): name, role, 2 Steps Ahead and LinkedIn.
export const FULL_SIGNATURE = "Sebastiaan Smits ([LinkedIn](https://www.linkedin.com/in/sebastiaan-smits-59623626))\nFounder, [GA Forum](https://ga-forum.com)\nFounder, [2 Steps Ahead](https://2stepsahead.ai) - GEO Agency for B2B Tech";

// The 2 Steps Ahead part (K14): three short paragraphs, see endingParagraphs() in lib/ai-proof.mjs.

export function pitchBlocks(name, opening, european = true, data = undefined) {
  const first = String(name || "there").split(/\s+/)[0];
  const n = siteCount();
  const outside = EUROPEAN_ONLY && !european;
  const ask = data ? `${data.category || ""} ${data.message || ""}`.trim() : "";
  const cross = ask ? crossSiteBlock({ index: CROSS_SITE_INDEX, site: CODE, european, message: ask }) : null;
  const alts = ask ? alternativesBlock({ index: CROSS_SITE_INDEX, altIndex: CROSS_SITE_ALT_INDEX, site: CODE, european, message: ask }) : null;
  return [
    `Hey ${first},`,

    ...[].concat(opening || `Thanks for getting in touch with ${NAME}.`),

    ...(outside ? [`${NAME} lists European products only. If ${auditTarget(data && data.email)} is built outside Europe, the same positions are available on [Same Team Partners](https://sameteampartners.com) and our other global sites, and the ladder below applies there in the same way.`] : []),

    `${NAME} ranks game development, streaming and esports software in numbered lists, with alternatives pages, comparisons and guides built on sourced figures.`,

    ...proofParagraphs({ site: CODE }),

    `That is what the sites are built for: **AI search, not clicks from Google**. When someone asks an LLM which product to buy, it names the products on a handful of pages, and we want yours to be one of them.`,

    `Every page has sourced figures, structured data and an llms.txt, so LLMs can quote our rankings. Most positions are still open, and a price holds for its full year.`,

    section("How positions work:", [
      `Every category page ranks its products in a numbered order, for example ${SITE}/software/best-2d-game-engines ("Best 2D Game Engines")`,
      "LLMs mainly cite the top 7 tools of a list, so a tool at the bottom of a page is still mentioned there but is very unlikely to make it into the top 7 lists an assistant gives back",
      "A position is sold per category page, per year, with automatic renewal and 1-month notice",
      "Each position is exclusive: one product per place on a page",
    ]),

    section("Prices per category page per year:"),

    table(["Position", "Per year"], LADDER),

    `More pages, on this site or across our ${n} sites (${joinNames(siteNames())}), get a discount on the total:`,

    table(["Pages", "Off the total"], BUNDLE),

    section("A free listing works like this:", [
      "Your product in one category, at #11 or lower, with the same full entry every other product gets",
    ]),

    section("In return, three steps in this order:", [
      "Like my latest LinkedIn post: [this post](https://www.linkedin.com/feed/update/urn:li:activity:7531326108739235841/)",
      "Send me a connection request: [Sebastiaan Smits on LinkedIn](https://www.linkedin.com/in/sebastiaan-smits-59623626)",
      `A dofollow link from your site to your listing page on ${NAME}, with a sentence pointing to it. I send you the exact text once you choose`,
    ]),

    "That is one page against these three steps. Every further page, also on our other sites, is a paid position from the same ladder.",

    `Which category would you want to be in, and at which position?`,

    ...(cross ? [cross] : []),
    ...(alts ? [alts] : []),

    ...endingParagraphs(auditTarget(data && data.email), n),

    FULL_SIGNATURE,
  ];
}

// For a plain contact message where a price list would be tone-deaf: a correction,
// a data question, a journalist. A short human note, no screenshot.
export function acknowledgementBlocks(name) {
  const first = String(name || "there").split(/\s+/)[0];
  return [
    `Hey ${first},`,

    `Thanks for writing to ${NAME}. Your message came through and has been passed on to me.`,

    `If you flagged a figure or a fact that is wrong, we will check it against the source and correct the page. If your message needs an answer from me, I will reply to this address, usually within a few days.`,

    FULL_SIGNATURE,
  ];
}

// The original submission under the reply, so it travels along when they answer.
export function quotedBlocks(data) {
  const line = (label, v) => `${label}: ${String(v || "").trim() || "(not given)"}`;
  return [
    "-------------------------------------------",
    `Your original message, submitted via the form on ga-forum.com:

${line("Name", data.name)}
${line("Email", data.email)}
${line("Company", data.company)}${data.website !== undefined ? `\n${line("Website", data.website)}` : ""}${data.category !== undefined ? `\n${line("Category", data.category)}` : ""}`,
    String(data.message || "").trim() || "(no message provided)",
  ];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain text keeps the words of [text](url) and drops the markup, in paragraphs and in bullets alike.
const plain = (x) => x.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1");
export function renderText(blocks) {
  return blocks
    .map((b) => {
      if (b.table) {
        const rows = [b.table.head, ...b.table.rows];
        const w = Math.max(...rows.map((r) => r[0].length));
        // Plain text cannot strike through, so the normal price is spelled out.
        const price = (r) => (r.length > 2 ? (r[1] ? `${r[2]} (normally ${r[1]})` : r[2]) : r[1]);
        return rows.map((r) => `${r[0].padEnd(w + 4)}${price(r)}`).join("\n");
      }
      if (b.section) return plain([b.section.heading, ...b.section.bullets.map((x) => `- ${x}`)].join("\n"));
      return b.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1");
    })
    .join("\n\n");
}

// Deliberately spartan HTML: it should read like a typed personal email. The
// HTML part only exists so the screenshot can sit inline in the body.
// Our site names become links in the HTML part, so "The Interregnum" in a bullet
// can be clicked. Case-sensitive on purpose: "Europeanpurpose.com" matches, the
// lowercase domain inside an href does not.
const SITE_LINKS = [
  ["Same Team Partners", "https://sameteampartners.com"],
  ["The Knowledge Engineers", "https://theknowledgeengineers.com"],
  ["The Interregnum", "https://theinterregnum.net"],
  ["European Purpose", "https://europeanpurpose.com"],
];

// Only the first mention of each site in the mail becomes a link (Seb, 26 Oct 2026):
// `linked` is shared by all blocks of one mail.
function linkSites(html, linked) {
  return SITE_LINKS.reduce((h, [name, url]) => {
    if (linked.has(name) || !h.includes(name)) return h;
    linked.add(name);
    return h.replace(name, `<a href="${url}" style="color:#1a56db;">${name}</a>`);
  }, html);
}

// Mail clients turn every other bare domain ("Europeanpurpose.com", "follow.it") into
// a link too; a zero-width non-joiner before the dot stops that. URLs and e-mail
// addresses are left alone.
const BARE_DOMAIN = /(^|[\s(“"'>])([A-Za-z0-9][A-Za-z0-9-]*)\.(com|it|io|ai|net|org|eu|nl|de|fr|co|app|dev|cloud|tech)(?=$|[\s.,;:!?)”"'<])/g;
const noAutolink = (html) => html.replace(BARE_DOMAIN, "$1$2&zwnj;.$3");

export function renderHtml(blocks) {
  const linked = new Set();
  const body = blocks
    .map((b) => {
      // The plain signature block becomes the branded HTML signature (lib/email-signature.mjs).
      if (b === FULL_SIGNATURE) return signatureHtml("gaf");
      if (b.section) {
        const lead = `<p style="margin:0 0 ${b.section.bullets.length ? 8 : 16}px;"><strong>${escapeHtml(b.section.heading)}</strong></p>`;
        if (!b.section.bullets.length) return lead;
        const items = b.section.bullets.map((x) => `<li style="margin:0 0 6px;">${noAutolink(linkSites(escapeHtml(x), linked))}</li>`).join("");
        return `${lead}<ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>`;
      }
      if (b.table) {
        const cell = "padding:6px 24px 6px 0;border-bottom:1px solid #eeeeee;";
        const head = b.table.head
          .map((h, i) => `<th style="${cell}text-align:left;font-weight:600;color:#666666;font-size:13px;${i ? "text-align:right;" : ""}">${escapeHtml(h)}</th>`)
          .join("");
        const rows = b.table.rows
          .map((r) => {
            // Two columns (slot, price) or three (slot, normal price, price): the ladder has had two since 12 Oct 2026.
            const slot = r[0];
            const normal = r.length > 2 ? r[1] : "";
            const price = r.length > 2 ? r[2] : r[1];
            const was = normal ? `<span style="text-decoration:line-through;color:#999999;font-weight:400;">${escapeHtml(normal)}</span>&nbsp;&nbsp;` : "";
            return `<tr><td style="${cell}">${escapeHtml(slot)}</td><td style="${cell}text-align:right;font-weight:600;white-space:nowrap;">${was}${escapeHtml(price)}</td></tr>`;
          })
          .join("");
        return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;font-size:15px;"><tr>${head}</tr>${rows}</table>`;
      }
      return `<p style="margin:0 0 16px;">${noAutolink(escapeHtml(b)).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#1a56db;">$1</a>').replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;">
<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.5;color:#222222;max-width:600px;">
${body}
</div>
</body>
</html>`;
}

const pitchFlow = {
  subject: `Your product on ${NAME}`,
  pitch: true,
  blocks: (n, european, data) => pitchBlocks(n, undefined, european, data),
};
const acknowledgementFlow = { subject: "Thanks for your message", pitch: false, blocks: (n) => acknowledgementBlocks(n) };

// Keyed by Netlify form name (the STP forms have no subject field). Every form must appear here.
export const FLOWS = {
  "get-listed": pitchFlow,
  contact: acknowledgementFlow,
};

// What the tracker (and the log) call a submission: the form plus the category asked for.
const subjectOf = (formName, data) =>
  formName === "get-listed" ? `Get listed: ${String(data.category || "").trim() || "no category"}` : "Contact";

// One SendGrid request body, shared by the live handler and the test script.
// `european` defaults to what isEuropean() says about the recipient.
export function mailBody({ flow, toEmail, toName, data, sendAt, subjectSuffix = "", european = isEuropean(toEmail) }) {
  const blocks = [...flow.blocks(toName, european, data), ...(data ? quotedBlocks(data) : [])];
  const body = {
    personalizations: [{ to: [{ email: toEmail, name: toName }], ...(sendAt ? { send_at: sendAt } : {}) }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    ...(REPLY_TO === FROM_EMAIL ? {} : { reply_to: { email: REPLY_TO, name: FROM_NAME } }),
    subject: flow.subject + subjectSuffix,
    content: [
      { type: "text/plain", value: renderText(blocks) },
      { type: "text/html", value: renderHtml(blocks) },
    ],
    // No click or open tracking: links stay the real URLs.
    tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } },
  };
  return body;
}

export async function send(body, apiKey) {
  return fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Every submission also goes into the lead tracker on Europeanpurpose.com, so the
// three sites are handled from one card of the admin dashboard. The tracker keeps
// the message, our scheduled auto-reply and the follow-up clock. Needs EP_INGEST_KEY
// (the same value on this site and on europeanpurpose.com); without it, or when the
// call fails, only a log line is written and the auto-reply is unaffected.
const LEAD_INGEST_URL = "https://europeanpurpose.com/.netlify/functions/lead-ingest";
async function recordLead({ data, flow, toName, european, submittedAt, formName }) {
  const key = process.env.EP_INGEST_KEY;
  if (!key) { console.warn("recordLead: EP_INGEST_KEY not set, lead not sent to the tracker"); return; }
  try {
    const replyAt = flow && DELAY_SECONDS >= 0 ? new Date(Date.now() + DELAY_SECONDS * 1000).toISOString() : null;
    const res = await fetch(LEAD_INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ingest-Key": key },
      body: JSON.stringify({
        site: CODE,
        email: String(data.email || "").trim(),
        name: String(data.name || "").trim(),
        subject: subjectOf(formName, data),
        message: [String(data.message || "").trim(), data.company ? `Company: ${String(data.company).trim()}` : "", data.website ? `Website: ${String(data.website).trim()}` : "", data.category ? `Category: ${String(data.category).trim()}` : ""].filter(Boolean).join("\n"),
        at: submittedAt || new Date().toISOString(),
        ...(flow ? { reply: { subject: flow.subject, text: renderText(flow.blocks(toName, european, data)), at: replyAt } } : {}),
      }),
    });
    if (!res.ok) console.error(`recordLead: tracker answered ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("recordLead: could not reach the tracker:", e);
  }
}

export const handler = async (event) => {
  try {
    const { payload } = JSON.parse(event.body || "{}");
    const data = (payload && payload.data) || {};
    const formName = String((payload && payload.form_name) || data["form-name"] || "").trim();
    const subject = subjectOf(formName, data);
    const toEmail = String(data.email || "").trim();
    const toName = String(data.name || "").trim() || "there";

    const flow = FLOWS[formName];
    // The tracker gets the lead first: it must see every submission, also the ones
    // that get no reply or whose SendGrid call fails below.
    await recordLead({ data, flow, toName, european: isEuropean(toEmail), submittedAt: payload && payload.created_at, formName });
    if (!flow) {
      console.error(`submission-created: NO FLOW for form "${formName}" (from ${toEmail}); nobody was emailed. Add it to FLOWS or fix the form.`);
      return { statusCode: 200, body: "Ignored: no flow for this subject" };
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) {
      console.warn(`submission-created: no valid email on a "${formName}" submission; no auto-reply sent.`);
      return { statusCode: 200, body: "Ignored: no valid email" };
    }
    const apiKey = process.env.GAF_SENDGRID_API_KEY || process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error("submission-created: GAF_SENDGRID_API_KEY not set");
      return { statusCode: 200, body: "Email not configured" };
    }

    // SendGrid send_at: Unix seconds, within 72 hours.
    const sendAt = DELAY_SECONDS > 0 ? Math.floor(Date.now() / 1000) + DELAY_SECONDS : undefined;
    const european = isEuropean(toEmail);
    const res = await send(mailBody({ flow, toEmail, toName, data, sendAt, european }), apiKey);
    if (res.status >= 400) {
      console.error(`submission-created: SEND FAILED for ${toEmail} ("${formName}"): SendGrid ${res.status}: ${await res.text()}`);
      return { statusCode: 200, body: `SendGrid error ${res.status}` };
    }
    const variant = flow.pitch ? (european ? " (European version)" : " (non-European version)") : "";
    console.log(`submission-created: scheduled "${formName}" email${variant} to ${toEmail}`);
    return { statusCode: 200, body: "Scheduled" };
  } catch (e) {
    console.error("submission-created: SEND FAILED (exception), no auto-reply sent:", e);
    return { statusCode: 200, body: "Handled error" };
  }
};
