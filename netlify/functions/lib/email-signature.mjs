// HTML e-mail signature for Sebastiaan Smits in 2 Steps Ahead branding (Seb, 19 Oct 2026).
//
// The same file lives in Europeanpurpose, TheKnowledgeEngineers, TheInterregnum and
// AIToolCompare (netlify/functions/lib/email-signature.mjs); change all four together.
// It renders the HTML counterpart of the plain FULL_SIGNATURE / SIGNATURES[site]; the
// plain-text part of every mail keeps the plain signature.
//
// Built for Gmail, Apple Mail and Outlook: tables, inline styles, no classes, no SVG,
// no web fonts. Images are hosted on europeanpurpose.com (images/email/), so they show
// once that repo is deployed. Colours are from 2stepsahead.ai: accent #ffd400 (too
// light for text on white, so it is only the divider line) and accent-dark #7a5e00
// for the "2 Steps Ahead" text.

const IMG = "https://europeanpurpose.com/images/email";
const LINKEDIN = "https://www.linkedin.com/in/sebastiaan-smits-59623626";
const TWOSA = "https://2stepsahead.ai";

export const SIGNATURE_SITES = {
  ep: { role: "Founder", name: "Europeanpurpose.com", url: "https://europeanpurpose.com" },
  tke: { role: "Founder", name: "The Knowledge Engineers", url: "https://theknowledgeengineers.com" },
  ti: { role: "Founder and Editor", name: "The Interregnum", url: "https://theinterregnum.net" },
  atc: { role: "Founder", name: "AI Tool Compare", url: "https://aitoolcompare.ai" },
  stp: { role: "Founder", name: "Same Team Partners", url: "https://sameteampartners.com" },
  fv: { role: "Founder", name: "FreeVector", url: "https://freevector.co" },
  mic: { role: "Founder", name: "MiCandidate", url: "https://micandidate.eu" },
  gaf: { role: "Founder", name: "GA Forum", url: "https://ga-forum.com" },
};

// `imgBase` only exists for local previews; mails always use the hosted images.
export function signatureHtml(site = "ep", imgBase = IMG) {
  const s = SIGNATURE_SITES[site] || SIGNATURE_SITES.ep;
  const font = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;";
  const line = `${font}font-size:13px;line-height:19px;color:#555555;`;
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin:4px 0 20px;">
<tr>
<td valign="top" width="72" style="padding:2px 14px 0 0;width:72px;">
<a href="${LINKEDIN}" style="text-decoration:none;"><img src="${imgBase}/sebastiaan-smits.jpg" width="72" height="72" alt="Sebastiaan Smits" style="display:block;width:72px;height:72px;border:0;border-radius:36px;"></a>
</td>
<td valign="top" style="padding:0 0 0 14px;border-left:2px solid #ffd400;">
<div style="${font}font-size:15px;line-height:21px;font-weight:bold;color:#111111;">Sebastiaan Smits</div>
<div style="${line}">${s.role}, <a href="${s.url}" style="color:#1a56db;text-decoration:none;">${s.name}</a></div>
<div style="${line}">Founder, <a href="${TWOSA}" style="color:#7a5e00;text-decoration:none;font-weight:bold;">2 Steps Ahead</a> - GEO Agency for B2B Tech</div>
<div style="${font}font-size:12px;line-height:18px;color:#888888;padding-top:5px;"><a href="${LINKEDIN}" style="color:#555555;text-decoration:none;">LinkedIn</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="${TWOSA}" style="color:#555555;text-decoration:none;"><img src="${imgBase}/2stepsahead-mark.png" width="12" height="12" alt="" style="display:inline-block;width:12px;height:12px;border:0;vertical-align:-1px;">&nbsp;2stepsahead.ai</a></div>
</td>
</tr>
</table>`;
}
