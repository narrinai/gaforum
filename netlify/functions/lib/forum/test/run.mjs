// Offline test harness: node netlify/functions/lib/forum/test/run.mjs
// Uses an in-memory store and a fake SendGrid fetch. No network, no servers.
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "test-secret-123";
process.env.ADMIN_EMAILS = "Boss@Example.com, hello@ga-forum.com";
delete process.env.SENDGRID_API_KEY;

const store = await import("../store.mjs");
const auth = await import("../auth.mjs");
const md = await import("../markdown.mjs");
const mail = await import("../mail.mjs");
const util = await import("../util.mjs");
const data = await import("../data.mjs");

// The build may ship a seed with zero threads; tests use fixed fixture threads instead.
util.SEED_THREADS.length = 0;
for (const k of Object.keys(util.SEED_BY_ID)) delete util.SEED_BY_ID[k];
for (const th of [
  { id: "best-2d-game-engines", board: "games", title: "Which 2D game engine are you using in 2026?", created: "2026-11-18T09:00:00Z",
    author: "GA Forum editorial team", pinned: true, body_html: "<p>Which one do you use?</p>",
    related: [{ title: "Best 2D Game Engines in 2026", url: "/software/best-2d-game-engines" }] },
  { id: "streaming-software-setup", board: "livestreaming", title: "Share your streaming software setup", created: "2026-11-17T09:00:00Z",
    author: "GA Forum editorial team", body_html: "<p>What does your stack look like?</p>", related: [] },
]) { util.SEED_THREADS.push(th); util.SEED_BY_ID[th.id] = th; }
const page = (await import("../../../forum-page.mjs")).default;
const api = (await import("../../../forum-api.mjs")).default;

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("ok  ", name); }
  catch (e) { console.error("FAIL", name, "\n", e); process.exitCode = 1; }
}

const ORIGIN = "https://ga-forum.com";
function req(method, path, { body, cookie, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(ORIGIN + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
}
const ctx = (ip = "1.2.3.4") => ({ ip });
async function J(res) { return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie") }; }

// ---------- markdown ----------
await t("markdown escapes script tags", () => {
  const h = md.renderMarkdown("<script>alert(1)</script> **b** *i* `<b>`");
  assert.ok(!h.includes("<script>"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(h.includes("<strong>b</strong>") && h.includes("<em>i</em>") && h.includes("<code>&lt;b&gt;</code>"));
});
await t("markdown blocks javascript: and data: links", () => {
  const h = md.renderMarkdown("[x](javascript:alert(1)) [y](data:text/html,hi) javascript:alert(1)");
  assert.ok(!/href="javascript/i.test(h) && !/href="data/i.test(h));
  assert.ok(!h.includes("<a "));
});
await t("markdown links get nofollow ugc", () => {
  const h = md.renderMarkdown("See [docs](https://example.com/a?b=1&c=2) and https://godotengine.org/download.");
  assert.ok(h.includes('<a href="https://example.com/a?b=1&amp;c=2" rel="nofollow ugc noopener" target="_blank">docs</a>'), h);
  assert.ok(h.includes('href="https://godotengine.org/download"') && h.includes("</a>."), h);
});
await t("markdown attribute breakout is escaped", () => {
  const h = md.renderMarkdown('https://x.com/"onmouseover="alert(1) [a](https://x.com/"><img src=x>)');
  assert.ok(!h.includes('"onmouseover'), h);
  assert.ok(!h.includes("<img"), h);
});
await t("markdown blocks: code, quote, list, breaks", () => {
  const h = md.renderMarkdown("line1\nline2\n\n```\n<b>x</b> **no**\n```\n\n> quoted *it*\n\n- one\n- two");
  assert.ok(h.includes("<p>line1<br>line2</p>"));
  assert.ok(h.includes("<pre><code>&lt;b&gt;x&lt;/b&gt; **no**</code></pre>"));
  assert.ok(h.includes("<blockquote><p>quoted <em>it</em></p></blockquote>"));
  assert.ok(h.includes("<ul><li>one</li><li>two</li></ul>"));
});

// ---------- cookies and codes ----------
await t("cookie sign/verify and tamper", () => {
  const tok = auth.signToken({ u: "a", e: "b", exp: Math.floor(Date.now() / 1000) + 60 }, "s1");
  assert.equal(auth.verifyToken(tok, "s1").u, "a");
  assert.equal(auth.verifyToken(tok, "s2"), null);
  const [b, s] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "admin", e: "b", exp: 9e9 })).toString("base64url") + "." + s;
  assert.equal(auth.verifyToken(forged, "s1"), null);
  const expired = auth.signToken({ u: "a", exp: Math.floor(Date.now() / 1000) - 1 }, "s1");
  assert.equal(auth.verifyToken(expired, "s1"), null);
  const c = auth.sessionCookie(tok);
  assert.ok(c.startsWith("gaf_session=") && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Path=\//.test(c) && /Max-Age=2592000/.test(c));
});

store.setStoreFactory(store.memoryStoreFactory());
auth.resetSecretCache();

await t("code hashing, wrong attempts, expiry", async () => {
  const now = Date.now();
  await auth.storeCode("a@b.co", "123456", now);
  const raw = await store.getJSON("forum-codes", util.emailHash("a@b.co"));
  assert.ok(raw.hash && !JSON.stringify(raw).includes("123456"));
  assert.equal((await auth.checkCode("a@b.co", "000000", now)).error, "invalid_code");
  assert.deepEqual(await auth.checkCode("a@b.co", "123456", now), { ok: true });
  assert.equal((await auth.checkCode("a@b.co", "123456", now)).error, "invalid_code"); // single use
  await auth.storeCode("a@b.co", "222222", now);
  assert.equal((await auth.checkCode("a@b.co", "222222", now + 11 * 60 * 1000)).error, "code_expired");
  await auth.storeCode("a@b.co", "333333", now);
  for (let i = 0; i < 4; i++) assert.equal((await auth.checkCode("a@b.co", "999999", now)).error, "invalid_code");
  assert.equal((await auth.checkCode("a@b.co", "999999", now)).error, "too_many_attempts");
  assert.equal((await auth.checkCode("a@b.co", "333333", now)).error, "invalid_code"); // code gone
});

await t("session secret falls back to Blobs when env unset", async () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  auth.resetSecretCache();
  const s1 = await auth.getSecret();
  auth.resetSecretCache();
  const s2 = await auth.getSecret();
  assert.equal(s1, s2);
  assert.ok(Buffer.from(s1, "base64url").length === 32);
  assert.equal((await store.getJSON("forum-config", "session-secret")).secret, s1);
  process.env.SESSION_SECRET = saved;
  auth.resetSecretCache();
});

await t("rate limiter sliding window", async () => {
  const lim = { limit: 3, windowMs: 1000 };
  for (let i = 0; i < 3; i++) assert.ok((await store.rateHit("x", "k", lim, 1000 + i)).ok);
  const r = await store.rateHit("x", "k", lim, 1500);
  assert.equal(r.ok, false); assert.ok(r.retryAfter >= 1);
  assert.ok((await store.rateHit("x", "k", lim, 2001)).ok);
});

await t("names: validation, reserved, unique", async () => {
  assert.equal(util.validateName("ab").error, "name_length");
  assert.equal(util.validateName("bad<name>").error, "name_chars");
  assert.equal(util.validateName("Admin").error, "name_reserved");
  assert.equal(util.validateName("GA-Forum").error, "name_reserved");
  assert.equal(util.validateName("ga forum editorial team").error, "name_reserved");
  assert.equal(util.validateName(" Pixel_Pete.2 ").name, "Pixel_Pete.2");
  const u1 = await auth.findOrCreateUser("n1@x.co");
  const u2 = await auth.findOrCreateUser("n2@x.co");
  assert.equal((await auth.claimName(u1, "Pixel Pete")).name, "Pixel Pete");
  assert.equal((await auth.claimName(u2, "pixel   PETE")).error, "name_taken");
});

// ---------- API ----------
await t("auth/start without SENDGRID_API_KEY -> 503 login_unavailable", async () => {
  const r = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "z@x.co" } }), ctx()));
  assert.equal(r.status, 503); assert.equal(r.data.error, "login_unavailable");
});

const sent = [];
mail.setMailFetch(async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization }); return new Response("", { status: 202 }); });
process.env.SENDGRID_API_KEY = "SG.test";

await t("POST without matching Origin is rejected", async () => {
  const r = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "z@x.co" }, origin: "https://evil.example" }), ctx()));
  assert.equal(r.status, 403); assert.equal(r.data.error, "forbidden_origin");
  const r2 = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "z@x.co" }, origin: null }), ctx()));
  assert.equal(r2.status, 403);
});

await t("JSON body size limit", async () => {
  const r = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "z@x.co", pad: "x".repeat(70000) } }), ctx()));
  assert.equal(r.status, 413);
});

async function login(email, ip = "9.9.9.9") {
  const before = sent.length;
  const s = await J(await api(req("POST", "/api/forum/auth/start", { body: { email, hp: "" } }), ctx(ip)));
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const mailBody = sent[before].body;
  const code = mailBody.content[0].value.match(/\b(\d{6})\b/)[1];
  const v = await J(await api(req("POST", "/api/forum/auth/verify", { body: { email, code } }), ctx(ip)));
  assert.equal(v.status, 200, JSON.stringify(v.data));
  const cookie = v.cookie.split(";")[0];
  return { cookie, needsName: v.data.needsName };
}

let alice, bob, carol, dave, boss;
await t("login flow sends SendGrid mail and sets cookie", async () => {
  alice = await login("alice@example.com");
  assert.equal(alice.needsName, true);
  const m = sent[sent.length - 1];
  assert.equal(m.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(m.auth, "Bearer SG.test");
  assert.equal(m.body.from.email, "hello@ga-forum.com"); assert.equal(m.body.from.name, "GA Forum");
  assert.equal(m.body.subject, "Your GA Forum login code");
  assert.deepEqual(m.body.content.map((c) => c.type), ["text/plain", "text/html"]);
  const me = await J(await api(req("GET", "/api/forum/me", { cookie: alice.cookie }), ctx()));
  assert.equal(me.data.loggedIn, true); assert.equal(me.data.needsName, true);
  const nm = await J(await api(req("POST", "/api/forum/auth/name", { body: { name: "Alice" }, cookie: alice.cookie }), ctx()));
  assert.equal(nm.status, 200);
});

await t("honeypot on auth/start pretends success without mailing", async () => {
  const before = sent.length;
  const r = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "bot@x.co", hp: "spam" } }), ctx("5.5.5.5")));
  assert.equal(r.status, 200); assert.equal(sent.length, before);
});

await t("rate limit per email (3 / 15 min) and per IP (10 / hour)", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await api(req("POST", "/api/forum/auth/start", { body: { email: "rl@x.co" } }), ctx("7.7.7." + i))).status, 200);
  const r = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "rl@x.co" } }), ctx("7.7.8.1")));
  assert.equal(r.status, 429); assert.equal(r.data.error, "rate_limited");
  for (let i = 0; i < 10; i++) assert.equal((await api(req("POST", "/api/forum/auth/start", { body: { email: `ip${i}@x.co` } }), ctx("6.6.6.6"))).status, 200);
  assert.equal((await api(req("POST", "/api/forum/auth/start", { body: { email: "ip99@x.co" } }), ctx("6.6.6.6"))).status, 429);
});

await t("same response for any email (no existence leak)", async () => {
  const a = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "alice@example.com" } }), ctx("8.8.1.1")));
  const b = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "nobody-new@example.com" } }), ctx("8.8.1.2")));
  assert.deepEqual(a, b);
});

let threadUrl, threadId;
await t("create thread, reply, posting rate limit, honeypot", async () => {
  const hp = await J(await api(req("POST", "/api/forum/threads", { body: { board: "games", title: "Spam spam spam", body: "x", hp: "y" }, cookie: alice.cookie }), ctx()));
  assert.equal(hp.status, 400);
  const short = await J(await api(req("POST", "/api/forum/threads", { body: { board: "games", title: "Short", body: "Hello there" }, cookie: alice.cookie }), ctx()));
  assert.equal(short.data.error, "title_length");
  const r = await J(await api(req("POST", "/api/forum/threads", { body: { board: "games", title: "Godot vs Unity for a tiny 2D game?", body: "Which one would you pick and **why**?" }, cookie: alice.cookie }), ctx()));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, "visible");
  assert.ok(/^\/forum\/t\/u[a-z0-9]+\/godot-vs-unity-for-a-tiny-2d-game$/.test(r.data.url), r.data.url);
  threadUrl = r.data.url; threadId = r.data.id;
  const r2 = await J(await api(req("POST", `/api/forum/threads/${threadId}/replies`, { body: { body: "Second post too fast" }, cookie: alice.cookie }), ctx()));
  assert.equal(r2.status, 429);
});

await t("new user with a link is held; author sees notice, others do not", async () => {
  bob = await login("bob@example.com", "4.4.4.4");
  await api(req("POST", "/api/forum/auth/name", { body: { name: "Bob" }, cookie: bob.cookie }), ctx());
  const r = await J(await api(req("POST", `/api/forum/threads/${threadId}/replies`, { body: { body: "Try https://spam.example now" }, cookie: bob.cookie }), ctx()));
  assert.equal(r.data.status, "held");
  const asBob = await (await page(req("GET", threadUrl, { cookie: bob.cookie }))).text();
  assert.ok(asBob.includes("Your post is waiting for review."));
  const anon = await (await page(req("GET", threadUrl))).text();
  assert.ok(!anon.includes("spam.example"));
});

await t("edit own post within 15 minutes; not others", async () => {
  const thread = await data.loadThread(threadId);
  const opId = thread.posts[0].id;
  const e1 = await J(await api(req("PATCH", `/api/forum/posts/${opId}`, { body: { body: "Edited body text" }, cookie: alice.cookie }), ctx()));
  assert.equal(e1.status, 200);
  const e2 = await J(await api(req("PATCH", `/api/forum/posts/${opId}`, { body: { body: "Hijack" }, cookie: bob.cookie }), ctx()));
  assert.equal(e2.status, 403);
  const user = (await auth.getSession(req("GET", "/", { cookie: alice.cookie }))).user;
  const late = await data.editPost(user, opId, { body: "Too late" }, Date.now() + 16 * 60 * 1000);
  assert.equal(late.error, "edit_window_closed");
});

await t("reports: one per user, 3 reports auto-hide", async () => {
  const thread = await data.loadThread(threadId);
  const opId = thread.posts[0].id;
  carol = await login("carol@example.com", "3.3.3.3");
  await api(req("POST", "/api/forum/auth/name", { body: { name: "Carol" }, cookie: carol.cookie }), ctx());
  dave = await login("dave@example.com", "2.2.2.2");
  await api(req("POST", "/api/forum/auth/name", { body: { name: "Dave" }, cookie: dave.cookie }), ctx());
  const own = await J(await api(req("POST", `/api/forum/posts/${opId}/report`, { body: {}, cookie: alice.cookie }), ctx()));
  assert.equal(own.data.error, "own_post");
  assert.equal((await api(req("POST", `/api/forum/posts/${opId}/report`, { body: { reason: "rude" }, cookie: bob.cookie }), ctx())).status, 200);
  assert.equal((await J(await api(req("POST", `/api/forum/posts/${opId}/report`, { body: {}, cookie: bob.cookie }), ctx()))).data.error, "already_reported");
  const long = await J(await api(req("POST", `/api/forum/posts/${opId}/report`, { body: { reason: "x".repeat(301) }, cookie: carol.cookie }), ctx()));
  assert.equal(long.data.error, "reason_length");
  await api(req("POST", `/api/forum/posts/${opId}/report`, { body: {}, cookie: carol.cookie }), ctx());
  await api(req("POST", `/api/forum/posts/${opId}/report`, { body: {}, cookie: dave.cookie }), ctx());
  const t2 = await data.loadThread(threadId);
  assert.equal(t2.posts[0].status, "hidden");
  const anon = await page(req("GET", threadUrl));
  assert.equal(anon.status, 404); // hidden opener hides the thread
});

await t("admin: 403 for non-admin, queue, approve, lock", async () => {
  assert.equal((await page(req("GET", "/forum/admin", { cookie: alice.cookie }))).status, 403);
  assert.equal((await api(req("GET", "/api/forum/admin/queue", { cookie: alice.cookie }), ctx())).status, 403);
  boss = await login("boss@example.com", "1.1.1.1");
  await api(req("POST", "/api/forum/auth/name", { body: { name: "Boss" }, cookie: boss.cookie }), ctx());
  const q = await J(await api(req("GET", "/api/forum/admin/queue", { cookie: boss.cookie }), ctx()));
  assert.equal(q.data.queue.length, 2);
  const adminHtml = await page(req("GET", "/forum/admin", { cookie: boss.cookie }));
  assert.equal(adminHtml.status, 200);
  const ah = await adminHtml.text();
  assert.ok(ah.includes('content="noindex"') && ah.includes("Approve") && ah.includes("rude"));
  for (const item of q.data.queue) {
    const r = await J(await api(req("POST", "/api/forum/admin/approve", { body: { postId: item.postId }, cookie: boss.cookie }), ctx()));
    assert.equal(r.data.status, "visible");
  }
  const anon = await (await page(req("GET", threadUrl))).text();
  assert.ok(anon.includes("spam.example") && anon.includes('rel="nofollow ugc noopener"'));
  const lk = await J(await api(req("POST", "/api/forum/admin/lock", { body: { threadId, locked: true }, cookie: boss.cookie }), ctx()));
  assert.equal(lk.data.locked, true);
  await new Promise((r) => setTimeout(r, 5));
  const user = (await auth.getSession(req("GET", "/", { cookie: carol.cookie }))).user;
  assert.equal((await data.addReply(user, threadId, { body: "locked?" })).error, "thread_locked");
  const del = await J(await api(req("POST", "/api/forum/admin/delete", { body: { postId: (await data.loadThread(threadId)).posts[1].id }, cookie: boss.cookie }), ctx()));
  assert.equal(del.data.status, "deleted");
});

await t("seed thread: reply works, seed opener not editable", async () => {
  const user = (await auth.getSession(req("GET", "/", { cookie: dave.cookie }))).user;
  const r = await data.addReply(user, "best-2d-game-engines", { body: "I use Godot." });
  assert.equal(r.post.status, "visible"); assert.equal(r.post.id, "best-2d-game-engines.1");
  const e = await J(await api(req("PATCH", "/api/forum/posts/best-2d-game-engines.0", { body: { body: "hack" }, cookie: dave.cookie }), ctx()));
  assert.equal(e.status, 404);
});

// ---------- pages ----------
await t("render /forum", async () => {
  const res = await page(req("GET", "/forum"));
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.ok(h.startsWith("<!doctype html>"));
  assert.ok(h.includes("<title>GA Forum: game dev, streaming and esports community</title>"));
  assert.ok(h.includes('href="/css/forum.css"') && h.includes('src="/js/forum.js"'));
  assert.ok(h.includes("Game development tools") && h.includes("Latest threads"));
  assert.ok(!h.includes('name="robots"'));
  assert.ok(!h.includes("{{"));
  assert.equal((h.match(/<main[\s>]/g) || []).length, 1, "exactly one <main>");
  assert.equal((h.match(/<\/main>/g) || []).length, 1);
  assert.ok(!h.includes("\u2014"), "em dash found");
});

await t("render board with pagination and list", async () => {
  const res = await page(req("GET", "/forum/games"));
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.ok(h.includes("Which 2D game engine are you using in 2026?"));
  assert.ok(h.includes("Pinned") && h.includes("Editorial"));
  assert.ok(h.includes('<link rel="canonical" href="https://ga-forum.com/forum/games">'));
  assert.equal((await page(req("GET", "/forum/games?page=9"))).status, 404);
  assert.equal((await page(req("GET", "/forum/nope"))).status, 404);
});

await t("render seed thread with JSON-LD and related links", async () => {
  const res = await page(req("GET", "/forum/t/best-2d-game-engines"));
  assert.equal(res.status, 200);
  const h = await res.text();
  assert.ok(h.includes('"@type":"DiscussionForumPosting"'));
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld.headline, "Which 2D game engine are you using in 2026?");
  assert.equal(ld.interactionStatistic.userInteractionCount, 1);
  assert.equal(ld.comment.length, 1);
  assert.equal(ld.url, "https://ga-forum.com/forum/t/best-2d-game-engines");
  assert.ok(h.includes("Best 2D Game Engines in 2026") && h.includes("I use Godot."));
  assert.ok(h.includes("Log in to reply"));
  assert.ok(h.includes('class="crumbs gaf-crumbs"'));
});

await t("user thread slug redirect and canonical", async () => {
  const wrong = await page(req("GET", `/forum/t/${threadId}/wrong-slug`));
  assert.equal(wrong.status, 301);
  assert.equal(wrong.headers.get("location"), threadUrl);
  const bare = await page(req("GET", `/forum/t/${threadId}`));
  assert.equal(bare.status, 301);
});

await t("404 thread renders inside shell", async () => {
  const res = await page(req("GET", "/forum/t/does-not-exist"));
  assert.equal(res.status, 404);
  const h = await res.text();
  assert.ok(h.includes("Thread not found") && h.includes("</footer>") && h.includes('content="noindex"'));
});

await t("account and login pages are noindex; logout clears cookie", async () => {
  const a = await (await page(req("GET", "/forum/account", { cookie: alice.cookie }))).text();
  assert.ok(a.includes('content="noindex"') && a.includes("a***e@example.com") && a.includes("Alice"));
  const l = await (await page(req("GET", "/forum/login"))).text();
  assert.ok(l.includes('content="noindex"'));
  const out = await api(req("POST", "/api/forum/auth/logout", { body: {}, cookie: alice.cookie }), ctx());
  assert.ok(/Max-Age=0/.test(out.headers.get("set-cookie")));
});

await t("Blobs unavailable: seed pages render, posting off, no crash", async () => {
  store.setStoreFactory(store.brokenStoreFactory());
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  auth.resetSecretCache();
  const home = await page(req("GET", "/forum", { cookie: alice.cookie }));
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes("Posting is unavailable right now"));
  const th = await page(req("GET", "/forum/t/best-2d-game-engines"));
  assert.equal(th.status, 200);
  const h = await th.text();
  assert.ok(h.includes("0 replies") && !h.includes("I use Godot."));
  assert.equal((await page(req("GET", "/forum/livestreaming"))).status, 200);
  assert.equal((await page(req("GET", "/forum/t/" + threadId + "/x"))).status, 404);
  const r = await J(await api(req("POST", "/api/forum/threads", { body: { board: "games", title: "Hello world here", body: "hi" } }), ctx()));
  assert.equal(r.status, 503);
  const s = await J(await api(req("POST", "/api/forum/auth/start", { body: { email: "q@x.co" } }), ctx()));
  assert.equal(s.data.error, "login_unavailable");
  process.env.SESSION_SECRET = saved;
});

console.log(`\n${passed} tests passed${process.exitCode ? ", some FAILED" : ""}`);
