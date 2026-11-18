// JSON API for GA Forum under /api/forum/* (Netlify Functions v2).
import { LIMITS, RATE, validEmail, normEmail, emailHash, threadUrl, sha256hex } from "./lib/forum/util.mjs";
import { blobsAvailable, rateHit, rateCheck } from "./lib/forum/store.mjs";
import {
  getSession, generateCode, storeCode, checkCode, findOrCreateUser, createSessionToken,
  sessionCookie, clearCookie, claimName,
} from "./lib/forum/auth.mjs";
import { mailConfigured, sendCodeMail } from "./lib/forum/mail.mjs";
import { createThread, addReply, editPost, reportPost, getQueue, getReports, adminAction, validateTitle, validateBody } from "./lib/forum/data.mjs";
import { BOARD_BY_SLUG } from "./lib/forum/util.mjs";

export const config = { path: "/api/forum/*" };

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

const err = (error, status, extra = {}) => json({ error, ...extra }, status);

function clientIp(req, context) {
  return (
    (context && context.ip) ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function sameOrigin(req) {
  const url = new URL(req.url);
  const hosts = new Set([url.host]);
  const fwd = req.headers.get("x-forwarded-host");
  if (fwd) hosts.add(fwd.split(",")[0].trim());
  const host = req.headers.get("host");
  if (host) hosts.add(host);
  const src = req.headers.get("origin") || req.headers.get("referer");
  if (!src || src === "null") return false;
  try {
    return hosts.has(new URL(src).host);
  } catch {
    return false;
  }
}

async function readJson(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.jsonBodyMax) return { error: "body_too_large" };
  const ct = req.headers.get("content-type") || "";
  if (!/application\/json/i.test(ct)) return { error: "json_required" };
  let text;
  try { text = await req.text(); } catch { return { error: "bad_request" }; }
  if (Buffer.byteLength(text, "utf8") > LIMITS.jsonBodyMax) return { error: "body_too_large" };
  if (!text) return { data: {} };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "bad_request" };
    return { data };
  } catch {
    return { error: "bad_request" };
  }
}

function rateErr(r) {
  return json({ error: "rate_limited", retryAfter: r.retryAfter }, 429, { "retry-after": String(r.retryAfter) });
}

async function postRate(user) {
  const a = await rateCheck("post-burst", user.id, RATE.postBurst);
  if (!a.ok) return a;
  const b = await rateCheck("post-day", user.id, RATE.postDaily);
  if (!b.ok) return b;
  await rateHit("post-burst", user.id, RATE.postBurst);
  await rateHit("post-day", user.id, RATE.postDaily);
  return { ok: true };
}

const STATUS_FOR = {
  not_found: 404, forbidden: 403, thread_locked: 423, edit_window_closed: 403, post_hidden: 403,
  already_reported: 409, own_post: 400, name_taken: 409, name_already_set: 409,
};

function fromResult(r) {
  return err(r.error, STATUS_FOR[r.error] || 400, r.remaining !== undefined ? { remaining: r.remaining } : {});
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  // netlify dev retries non-2xx responses with .html and /index.htm variants; map them back.
  const route = url.pathname.replace(/(\/index)?\.html?$/i, "").replace(/^\/api\/forum\/?/, "").replace(/\/+$/, "");
  const parts = route.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const method = req.method.toUpperCase();

  try {
    let body = {};
    if (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE") {
      if (!sameOrigin(req)) return err("forbidden_origin", 403);
      const r = await readJson(req);
      if (r.error) return err(r.error, r.error === "body_too_large" ? 413 : r.error === "json_required" ? 415 : 400);
      body = r.data;
    } else if (method !== "GET" && method !== "HEAD") {
      return err("method_not_allowed", 405);
    }

    // auth/start checks the mail config before anything else.
    if (method === "POST" && route === "auth/start") {
      if (!mailConfigured()) return err("login_unavailable", 503);
      if (!(await blobsAvailable())) return err("login_unavailable", 503);
      if (body.hp) return json({ ok: true }); // honeypot: pretend it worked
      const email = normEmail(body.email);
      if (!validEmail(email)) return err("invalid_email", 400);
      const ip = clientIp(req, context);
      const r1 = await rateCheck("code-ip", sha256hex(ip), RATE.codePerIp);
      if (!r1.ok) return rateErr(r1);
      const r2 = await rateCheck("code-email", emailHash(email), RATE.codePerEmail);
      if (!r2.ok) return rateErr(r2);
      await rateHit("code-ip", sha256hex(ip), RATE.codePerIp);
      await rateHit("code-email", emailHash(email), RATE.codePerEmail);
      const code = generateCode();
      await storeCode(email, code);
      const sent = await sendCodeMail(email, code);
      if (!sent.ok) return err(sent.error === "login_unavailable" ? "login_unavailable" : "mail_failed", sent.error === "login_unavailable" ? 503 : 502);
      return json({ ok: true });
    }

    if (!(await blobsAvailable())) return err("storage_unavailable", 503);

    if (method === "POST" && route === "auth/verify") {
      const email = normEmail(body.email);
      if (!validEmail(email)) return err("invalid_email", 400);
      const ip = clientIp(req, context);
      const r = await rateHit("verify-ip", sha256hex(ip), RATE.verifyPerIp);
      if (!r.ok) return rateErr(r);
      const res = await checkCode(email, body.code);
      if (res.error) return fromResult(res);
      const user = await findOrCreateUser(email);
      const token = await createSessionToken(user);
      return json({ ok: true, needsName: !user.name }, 200, { "set-cookie": sessionCookie(token) });
    }

    if (method === "POST" && route === "auth/logout") {
      return json({ ok: true }, 200, { "set-cookie": clearCookie() });
    }

    const session = await getSession(req);

    if (method === "GET" && route === "me") {
      if (!session) return json({ loggedIn: false });
      return json({ loggedIn: true, name: session.user.name, needsName: !session.user.name, isAdmin: session.isAdmin });
    }

    if (!session) return err("login_required", 401);
    const user = session.user;

    if (method === "POST" && route === "auth/name") {
      const r = await claimName(user, body.name);
      if (r.error) return fromResult(r);
      return json({ ok: true, name: r.name });
    }

    // Admin routes.
    if (parts[0] === "admin") {
      if (!session.isAdmin) return err("forbidden", 403);
      if (method === "GET" && parts[1] === "queue") {
        const queue = await getQueue();
        for (const q of queue) q.reasons = await getReports(q.postId);
        return json({ queue });
      }
      if (method === "POST" && ["approve", "hide", "delete", "lock"].includes(parts[1])) {
        const r = await adminAction(parts[1], { postId: body.postId, threadId: body.threadId, locked: body.locked });
        if (r.error) return fromResult(r);
        return json(r);
      }
      return err("not_found", 404);
    }

    if (!user.name) return err("name_required", 403);

    if (method === "POST" && route === "threads") {
      if (body.hp) return err("spam_detected", 400);
      if (!BOARD_BY_SLUG[String(body.board || "")]) return err("unknown_board", 400);
      const pre = validateTitle(body.title).error || validateBody(body.body).error;
      if (pre) return err(pre, 400);
      const rl = await postRate(user);
      if (!rl.ok) return rateErr(rl);
      const r = await createThread(user, { board: String(body.board || ""), title: body.title, body: body.body });
      if (r.error) return fromResult(r);
      return json({ ok: true, id: r.thread.id, postId: r.post.id, status: r.post.status, url: threadUrl(r.thread) }, 201);
    }

    if (method === "POST" && parts[0] === "threads" && parts[2] === "replies" && parts.length === 3) {
      if (body.hp) return err("spam_detected", 400);
      const pre = validateBody(body.body).error;
      if (pre) return err(pre, 400);
      const rl = await postRate(user);
      if (!rl.ok) return rateErr(rl);
      const r = await addReply(user, parts[1], { body: body.body }, { isAdmin: session.isAdmin });
      if (r.error) return fromResult(r);
      const replies = r.thread.seed ? r.thread.posts : r.thread.posts.slice(1);
      const visibleCount = replies.filter((p) => p.status === "visible" || p.authorId === user.id).length;
      const page = Math.max(1, Math.ceil(visibleCount / LIMITS.repliesPerPage));
      const anchor = "#p-" + r.post.id.replace(/[^a-zA-Z0-9_-]/g, "-");
      return json({ ok: true, postId: r.post.id, status: r.post.status, url: threadUrl(r.thread) + (page > 1 ? `?page=${page}` : "") + anchor }, 201);
    }

    if (method === "PATCH" && parts[0] === "posts" && parts.length === 2) {
      const r = await editPost(user, parts[1], { body: body.body });
      if (r.error) return fromResult(r);
      return json({ ok: true, status: r.post.status });
    }

    if (method === "POST" && parts[0] === "posts" && parts[2] === "report" && parts.length === 3) {
      const rl = await rateHit("report-day", user.id, RATE.reportDaily);
      if (!rl.ok) return rateErr(rl);
      const r = await reportPost(user, parts[1], { reason: body.reason });
      if (r.error) return fromResult(r);
      return json({ ok: true });
    }

    return err("not_found", 404);
  } catch (e) {
    console.error("forum-api error", e && e.stack || e);
    return err("server_error", 500);
  }
}
