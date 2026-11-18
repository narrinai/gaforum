// Shared constants and small helpers for the GA Forum functions.
import crypto from "node:crypto";
import seed from "../forum-seed.json" with { type: "json" };

export const SITE_URL = (envGet("FORUM_SITE_URL") || "https://ga-forum.com").replace(/\/+$/, "");
export const SEED = seed;
export const BOARDS = (seed.boards || []).map((b) => ({ ...b }));
export const BOARD_BY_SLUG = Object.fromEntries(BOARDS.map((b) => [b.slug, b]));
export const SEED_THREADS = (seed.threads || []).filter((t) => t && t.id && BOARD_BY_SLUG[t.board]);
export const SEED_BY_ID = Object.fromEntries(SEED_THREADS.map((t) => [t.id, t]));

export const LIMITS = {
  titleMin: 8,
  titleMax: 120,
  bodyMin: 2,
  bodyMax: 10000,
  reasonMax: 300,
  editWindowMs: 15 * 60 * 1000,
  codeTtlMs: 10 * 60 * 1000,
  codeMaxAttempts: 5,
  sessionDays: 30,
  threadsPerPage: 30,
  repliesPerPage: 50,
  latestOnHome: 15,
  autoHideReports: 3,
  newUserDays: 3,
  newUserPosts: 3,
  jsonBodyMax: 64 * 1024,
};

export const RATE = {
  codePerEmail: { limit: 3, windowMs: 15 * 60 * 1000 },
  codePerIp: { limit: 10, windowMs: 60 * 60 * 1000 },
  verifyPerIp: { limit: 30, windowMs: 60 * 60 * 1000 },
  postBurst: { limit: 1, windowMs: 20 * 1000 },
  postDaily: { limit: 30, windowMs: 24 * 60 * 60 * 1000 },
  reportDaily: { limit: 50, windowMs: 24 * 60 * 60 * 1000 },
};

export const RESERVED_NAMES = [
  "admin", "moderator", "ga forum", "gaforum", "editorial",
  "GA Forum editorial team", "staff", "support",
];

export function envGet(name) {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
      const v = Netlify.env.get(name);
      if (v !== undefined && v !== null && v !== "") return v;
    }
  } catch {}
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return v === "" ? undefined : v;
}

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sha256hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

export function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function emailHash(email) {
  return sha256hex("gaf-email:" + normEmail(email));
}

export function validEmail(email) {
  const e = normEmail(email);
  return e.length >= 6 && e.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(e);
}

export function maskEmail(email) {
  const e = normEmail(email);
  const [user, domain] = e.split("@");
  if (!domain) return "***";
  const u = user.length <= 2 ? user[0] + "*" : user[0] + "*".repeat(Math.min(user.length - 2, 6)) + user[user.length - 1];
  return u + "@" + domain;
}

export function slugify(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "thread";
}

export function newThreadId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < 4; i++) r += alphabet[crypto.randomInt(0, alphabet.length)];
  return "u" + Date.now().toString(36) + r;
}

export function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function threadUrl(t) {
  if (!t) return "/forum";
  if (t.seed || SEED_BY_ID[t.id]) return "/forum/t/" + t.id;
  return "/forum/t/" + t.id + "/" + (t.slug || slugify(t.title));
}

// Squashed form used for reserved-name comparison: letters and digits only.
export function squashName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Key used for uniqueness: case-insensitive, whitespace collapsed.
export function nameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateName(raw) {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 24) return { error: "name_length" };
  if (!/^[A-Za-z0-9 _.\-]+$/.test(name)) return { error: "name_chars" };
  if (!/[A-Za-z0-9]/.test(name)) return { error: "name_chars" };
  const sq = squashName(name);
  if (RESERVED_NAMES.some((r) => squashName(r) === sq)) return { error: "name_reserved" };
  return { name };
}

export function containsLink(md) {
  return /(https?:\/\/|www\.)\S/i.test(String(md || "")) || /\[[^\]]*\]\([^)]+\)/.test(String(md || ""));
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text, n = 300) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "..." : t;
}

export function adminEmails() {
  return (envGet("ADMIN_EMAILS") || "hello@ga-forum.com")
    .split(",")
    .map((s) => normEmail(s))
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return !!email && adminEmails().includes(normEmail(email));
}
