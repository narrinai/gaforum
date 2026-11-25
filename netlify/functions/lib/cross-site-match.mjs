// GENERATED FILE — copy of europeanpurpose/scripts/cross-site/cross-site-match.mjs, do not edit by hand.
// Matcher for the "Comparable pages on our other sites" block in the form auto-replies.
// SOURCE OF TRUTH: europeanpurpose/scripts/cross-site/cross-site-match.mjs.
// scripts/build-cross-site-index.js copies it to netlify/functions/lib/cross-site-match.mjs
// in all four repos, next to cross-site-index.mjs. Pure functions, no I/O.
//
// How it matches (kept deliberately strict, so a weak match never reaches a vendor):
//  1. URL mode. If the message links one of our category pages (europeanpurpose.com/category/x,
//     theknowledgeengineers.com/software-advice/x, theinterregnum.net/software-advice/x,
//     aitoolcompare.ai/category/x), the slug of that page is the query. A candidate on another
//     site matches when the Dice overlap of the content tokens of both slugs is >= 0.70
//     and they share at least one specific (non-generic) token. "object-storage-providers" ->
//     "object-storage" scores 1.0; "ai-video-editing-tools" -> "video-editing-software" scores 0.8;
//     "ai-video-editing-tools" -> "ai-video-generators" scores 0.67 and is rejected.
//  2. Text mode, only when the message links no such page. A candidate matches when its whole slug
//     phrase (or its target keyword) appears as a contiguous phrase in the message, e.g. "we are a
//     CRM vendor" -> "crm". Single-word phrases must be specific (>= 3 letters, not generic).
//  3. At most one page per other site (the best), at most 3 in total, best first; ties go to the
//     page with more tools. European Purpose is only offered to European senders.
//  No match: returns [] and the caller keeps the existing global wording.

export const MIN_DICE = 0.7;

const GENERIC = new Set(["software", "tool", "tools", "best", "european", "provider", "providers", "platform", "platforms", "solution", "solutions", "service", "services", "app", "apps", "system", "systems", "for", "and", "the", "of", "in", "to", "a", "with", "vs", "alternative", "alternatives", "top", "free", "2026", "online", "program", "programs", "product", "products"]);
// Shared by many unrelated pages: never enough on their own.
const WEAK = new Set(["ai", "management", "data", "business", "digital", "cloud", "marketing", "analytics", "automation", "enterprise", "smart", "generator", "generators", "builder", "builders", "maker", "makers", "assistant", "assistants", "api", "apis", "web", "mobile"]);

const stem = (w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (t) => String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
export const contentTokens = (t) => [...new Set(words(t).map(stem).filter((w) => !GENERIC.has(w) && !GENERIC.has(w + "s")))];

const dice = (a, b) => {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const shared = a.filter((x) => sb.has(x));
  return { score: (2 * shared.length) / (a.length + b.length), shared };
};

const SITES = {
  ep: { host: "europeanpurpose.com", path: "category", label: "European Purpose" },
  tke: { host: "theknowledgeengineers.com", path: "software-advice", label: "The Knowledge Engineers" },
  ti: { host: "theinterregnum.net", path: "software-advice", label: "The Interregnum" },
  atc: { host: "aitoolcompare.ai", path: "category", label: "AI Tool Compare" },
};
export const SITE_LABEL = Object.fromEntries(Object.entries(SITES).map(([k, v]) => [k, v.label]));

// Category pages of our four sites linked in the message: [{site, slug}].
export function seedPages(message) {
  const out = [];
  const re = /(?:https?:\/\/)?(?:www\.)?(europeanpurpose\.com|theknowledgeengineers\.com|theinterregnum\.net|aitoolcompare\.ai)\/(category|software-advice)\/([a-z0-9-]+)/gi;
  for (const m of String(message || "").matchAll(re)) {
    const site = Object.keys(SITES).find((k) => SITES[k].host === m[1].toLowerCase());
    if (site && SITES[site].path === m[2].toLowerCase()) out.push({ site, slug: m[3].toLowerCase() });
  }
  return out;
}

/**
 * @param {object} o
 * @param {Array}  o.index    CROSS_SITE_INDEX entries
 * @param {string} o.site     the site sending the reply: ep | tke | ti | atc
 * @param {string} o.message  what the vendor wrote
 * @param {boolean} o.european  whether European Purpose may be offered
 * @param {Array}  [o.extraSlugs] [{site, slug}] pages already recognised by the caller
 * @returns {Array} up to 3 index entries, best first, each with .score and .mode
 */
export function findComparable({ index, site, message, european = false, extraSlugs = [], limit = 3 }) {
  const seeds = [...seedPages(message), ...extraSlugs];
  const pool = index.filter((e) => e.site !== site && (e.site !== "ep" || european));
  const best = new Map();
  const consider = (e, score, mode) => {
    const cur = best.get(e.site);
    if (!cur || score > cur.score || (score === cur.score && e.tool_count > cur.tool_count)) best.set(e.site, { ...e, score: Math.round(score * 100) / 100, mode });
  };

  if (seeds.length) {
    for (const seed of seeds) {
      const q = contentTokens(seed.slug);
      if (!q.length) continue;
      for (const e of pool) {
        if (e.site === seed.site && e.slug === seed.slug) continue; // the page they already named
        const c = contentTokens(e.slug);
        const d = dice(q, c);
        if (d && d.score >= MIN_DICE && d.shared.some((t) => !WEAK.has(t))) consider(e, d.score, "url");
      }
    }
  } else {
    const hay = ` ${words(message).map(stem).join(" ")} `;
    for (const e of pool) {
      for (const phrase of [contentTokens(e.slug), contentTokens(e.keywords)]) {
        if (!phrase.length) continue;
        if (phrase.length === 1 && (WEAK.has(phrase[0]) || phrase[0].length < 3)) continue;
        if (phrase.every((t) => WEAK.has(t))) continue;
        if (hay.includes(` ${phrase.join(" ")} `)) consider(e, phrase.length, "text");
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.tool_count - a.tool_count).slice(0, limit);
}

/**
 * The block for the mail: a section {section:{heading,bullets}} in the format of the
 * submission-created.mjs renderers, or null when nothing matches well.
 */
export function crossSiteBlock(opts) {
  const hits = findComparable(opts);
  if (!hits.length) return null;
  return {
    section: {
      heading: "Comparable pages on our other sites:",
      bullets: hits.map((h) => `${SITE_LABEL[h.site]}: ${h.url} ("${h.title}", ${h.tool_count} tools)`),
    },
  };
}

/**
 * Second block: "alternatives" pages of the competitors in the category the vendor asked about.
 * Category per site: the matcher hit for the other sites, and for the reply's own site the page the
 * vendor named (or the best text match). At most 2 pages per site (the index already keeps the two
 * best-known incumbents per category); sites without an alternatives page in that category are
 * skipped. Returns {section} or null.
 */
export function alternativesBlock({ index, altIndex, site, message, european = false }) {
  const hits = findComparable({ index, site: "_", message, european: european || site === "ep", limit: 4 });
  const cats = new Map(); // site -> category slug
  for (const h of hits) if (h.site !== site && (h.site !== "ep" || european)) cats.set(h.site, h.slug);
  const own = seedPages(message).find((s) => s.site === site);
  if (own) cats.set(site, own.slug);
  else { const h = hits.find((x) => x.site === site); if (h) cats.set(site, h.slug); }
  const bullets = [];
  for (const s of [site, ...Object.keys(SITES).filter((k) => k !== site)]) {
    const cat = cats.get(s);
    if (!cat) continue;
    for (const a of (altIndex || []).filter((e) => e.site === s && e.category === cat).slice(0, 2)) bullets.push(`${SITE_LABEL[s]}: ${a.url} ("${a.title}")`);
  }
  return bullets.length ? { section: { heading: "Alternatives pages of competitors:", bullets } } : null;
}
