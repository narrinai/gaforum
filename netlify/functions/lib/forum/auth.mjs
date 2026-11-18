// Sessions, login codes and user records.
import crypto from "node:crypto";
import { envGet, emailHash, normEmail, isAdminEmail, LIMITS, randomId, nameKey, validateName } from "./util.mjs";
import { getJSON, setJSON, del, blobsAvailable, blobKey } from "./store.mjs";

export const COOKIE = "gaf_session";

let secretCache = null;
let ephemeralSecret = null;

export function resetSecretCache() {
  secretCache = null;
  ephemeralSecret = null;
}

// SESSION_SECRET env, else a random 32-byte secret stored once in Blobs.
export async function getSecret() {
  if (secretCache) return secretCache;
  const env = envGet("SESSION_SECRET");
  if (env) return (secretCache = env);
  if (await blobsAvailable()) {
    try {
      let rec = await getJSON("forum-config", "session-secret");
      if (!rec || !rec.secret) {
        rec = { secret: crypto.randomBytes(32).toString("base64url"), created: new Date().toISOString() };
        await setJSON("forum-config", "session-secret", rec);
        // Re-read so concurrent first writers converge on the stored value.
        rec = (await getJSON("forum-config", "session-secret")) || rec;
      }
      return (secretCache = rec.secret);
    } catch {}
  }
  // No env and no Blobs: per-instance secret (login cannot work anyway).
  if (!ephemeralSecret) ephemeralSecret = crypto.randomBytes(32).toString("base64url");
  return ephemeralSecret;
}

export function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(String(data)).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + hmac(secret, body);
}

export function verifyToken(token, secret, now = Date.now()) {
  if (!token || typeof token !== "string" || token.length > 2048) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!safeEqual(sig, hmac(secret, body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || typeof p !== "object") return null;
    if (typeof p.exp !== "number" || p.exp * 1000 < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  const maxAge = LIMITS.sessionDays * 24 * 60 * 60;
  return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(req, name = COOKIE) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export async function createSessionToken(user, now = Date.now()) {
  const secret = await getSecret();
  const iat = Math.floor(now / 1000);
  return signToken({ u: user.id, e: user.emailHash, iat, exp: iat + LIMITS.sessionDays * 86400 }, secret);
}

// Returns { user, isAdmin } or null. Never throws.
export async function getSession(req) {
  try {
    const token = readCookie(req);
    if (!token) return null;
    const secret = await getSecret();
    const p = verifyToken(token, secret);
    if (!p) return null;
    if (!(await blobsAvailable())) return null;
    const user = await getJSON("forum-users", p.e);
    if (!user || user.id !== p.u || user.banned) return null;
    return { user, isAdmin: isAdminEmail(user.email) };
  } catch {
    return null;
  }
}

// ---------- login codes ----------

export function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

export function hashCode(secret, eh, code) {
  return hmac(secret, "code:" + eh + ":" + code);
}

export async function storeCode(email, code, now = Date.now()) {
  const secret = await getSecret();
  const eh = emailHash(email);
  await setJSON("forum-codes", eh, {
    hash: hashCode(secret, eh, code),
    expires: now + LIMITS.codeTtlMs,
    attempts: 0,
  });
}

// Returns { ok: true } or { error, remaining? }.
export async function checkCode(email, code, now = Date.now()) {
  const eh = emailHash(email);
  const rec = await getJSON("forum-codes", eh);
  if (!rec) return { error: "invalid_code" };
  if (rec.expires < now) {
    await del("forum-codes", eh);
    return { error: "code_expired" };
  }
  if (rec.attempts >= LIMITS.codeMaxAttempts) {
    await del("forum-codes", eh);
    return { error: "too_many_attempts" };
  }
  const secret = await getSecret();
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length === 6 && safeEqual(hashCode(secret, eh, clean), rec.hash)) {
    await del("forum-codes", eh);
    return { ok: true };
  }
  rec.attempts += 1;
  if (rec.attempts >= LIMITS.codeMaxAttempts) {
    await del("forum-codes", eh);
    return { error: "too_many_attempts" };
  }
  await setJSON("forum-codes", eh, rec);
  return { error: "invalid_code", remaining: LIMITS.codeMaxAttempts - rec.attempts };
}

// ---------- users ----------

export async function findOrCreateUser(email, now = Date.now()) {
  const eh = emailHash(email);
  let user = await getJSON("forum-users", eh);
  if (user) return user;
  user = {
    id: randomId(9),
    emailHash: eh,
    email: normEmail(email),
    name: null,
    created: new Date(now).toISOString(),
    approvedPosts: 0,
  };
  await setJSON("forum-users", eh, user);
  await setJSON("forum-users", "byid/" + user.id, { emailHash: eh });
  return user;
}

export async function getUserById(id) {
  const ref = await getJSON("forum-users", "byid/" + id);
  if (!ref) return null;
  return getJSON("forum-users", ref.emailHash);
}

export async function saveUser(user) {
  await setJSON("forum-users", user.emailHash, user);
}

export async function claimName(user, raw) {
  if (user.name) return { error: "name_already_set" };
  const v = validateName(raw);
  if (v.error) return v;
  const key = blobKey(nameKey(v.name));
  const existing = await getJSON("forum-names", key);
  if (existing && existing.userId !== user.id) return { error: "name_taken" };
  await setJSON("forum-names", key, { userId: user.id, name: v.name, at: new Date().toISOString() });
  // Read back to reduce the chance of a lost race.
  const check = await getJSON("forum-names", key);
  if (!check || check.userId !== user.id) return { error: "name_taken" };
  user.name = v.name;
  await saveUser(user);
  return { name: v.name };
}

export function isNewUser(user, now = Date.now()) {
  const age = now - new Date(user.created).getTime();
  return age < LIMITS.newUserDays * 86400000 || (user.approvedPosts || 0) < LIMITS.newUserPosts;
}
