// Proof, bundle and 2 Steps Ahead paragraphs of the form auto-replies for the newer sites (FreeVector, MiCandidate, GA Forum).
// No screenshots (Seb, 25 Nov 2026): the portfolio figures are quoted as text and the site itself is said to be new.
// Source of the figures: scripts/lead-check/data/metrics.json in the European Purpose repo (Ahrefs, AI responses, All platforms); keep in sync.
export const METRICS_DATE = "28 Nov 2026";
export const SITE_NAME = { ep: "European Purpose", tke: "The Knowledge Engineers", ti: "The Interregnum", atc: "AI Tool Compare", stp: "Same Team Partners", fv: "FreeVector", mic: "MiCandidate", gaf: "GA Forum" };
export const METRICS = {
  ep: { answers: 2300, approx: true },
  tke: { answers: 476 },
  ti: { answers: 234 },
  atc: { answers: 464 },
  stp: { answers: 97, focus: "mainly for HR topics" },
  fv: { answers: 28 },
};
export const PORTFOLIO = ["ep", "tke", "ti", "atc", "stp", "fv"];
export const ALL_SITES = ["ep", "tke", "ti", "atc", "stp", "fv", "mic", "gaf"];
export const siteCount = () => "eight";
export const siteNames = () => ALL_SITES.map((s) => SITE_NAME[s]);
export const joinNames = (names) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
export const TOP7 = "LLMs mainly cite the top 7 tools of a list, so a tool at the bottom of a page is still mentioned there but is very unlikely to make it into the top 7 lists an assistant gives back.";

// The portfolio paragraph plus the honest line that this site has only just started, so the weight is on the related pages.
export function proofParagraphs({ site }) {
  const line = (s) => { const m = METRICS[s];
    return `${SITE_NAME[s]}: cited in ${m.approx ? "about " : ""}${Number(m.answers).toLocaleString("en-US")} AI answers${m.focus ? ", " + m.focus : ""}${m.date && m.date !== METRICS_DATE ? ` (${m.date})` : ""}`; };
  return [
    `Our sites are built to be cited by LLMs rather than to collect clicks. Across our portfolio they are cited in a lot of AI answers, ChatGPT included (Ahrefs, ${METRICS_DATE}):\n${PORTFOLIO.map(line).join("\n")}`,
    `${SITE_NAME[site]} has only just started, so its own pages are not cited much yet. That is why I also look at the related pages on our other sites, which are already cited, and put your product there as well.`,
  ];
}

export const endingParagraphs = (prod, n = "five") => [
  `Clients of [2 Steps Ahead](https://2stepsahead.ai), my GEO agency, get a free #1 listing on our sites.\nI can also do a free audit of ${prod} with a walkthrough in a call, if you are interested.`,
];

const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|proton|protonmail|pm|aol|gmx|web|yandex|mail|zoho)\./i;
export function auditTarget(email, product = "") {
  if (product) return product;
  const host = (String(email || "").split("@")[1] || "").toLowerCase().trim().replace(/^www\./, "");
  return !host || FREE_MAIL.test(host) ? "your product" : host;
}
