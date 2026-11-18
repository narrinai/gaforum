// Thread, post, report and moderation logic on top of Blobs.
//
// forum-threads layout:
//   thread/<id>   one JSON per thread: meta + posts array (user threads: posts[0] is the opener;
//                 seed threads: only replies, the opener lives in forum-seed.json)
//   index/<board> per-board list of thread summaries (user threads and seed threads with activity)
//   modqueue      { items: { <postId>: { threadId, kind: "held"|"reported", at } } }
import {
  BOARD_BY_SLUG, SEED_THREADS, SEED_BY_ID, LIMITS, newThreadId, slugify, containsLink,
} from "./util.mjs";
import { getJSON, setJSON, blobKey } from "./store.mjs";
import { isNewUser, saveUser, getUserById } from "./auth.mjs";

const tKey = (id) => "thread/" + blobKey(id);
const iKey = (board) => "index/" + board;

export function splitPostId(postId) {
  const s = String(postId || "");
  const i = s.lastIndexOf(".");
  if (i <= 0) return null;
  const n = Number(s.slice(i + 1));
  if (!Number.isInteger(n) || n < 0) return null;
  return { threadId: s.slice(0, i), n };
}

// ---------- reading ----------

export async function getBoardIndex(board) {
  return (await getJSON("forum-threads", iKey(board))) || { threads: [] };
}

function seedSummary(s) {
  return {
    id: s.id, board: s.board, title: s.title, seed: true, pinned: !!s.pinned,
    authorName: s.author || "GA Forum editorial team", editorial: true,
    created: s.created, lastActivity: s.created, lastAuthor: s.author || "GA Forum editorial team",
    replies: 0, status: "visible",
  };
}

// Returns merged, sorted summaries for a board, visible to everyone (plus own held threads).
export async function listBoardThreads(board, { viewerId = null, isAdmin = false, available = true } = {}) {
  const idx = available ? await getBoardIndex(board) : { threads: [] };
  const byId = new Map();
  for (const s of SEED_THREADS.filter((t) => t.board === board)) byId.set(s.id, seedSummary(s));
  for (const e of idx.threads || []) {
    if (e.seed) {
      if (!byId.has(e.id)) continue; // seed thread removed from the build
      const base = byId.get(e.id);
      byId.set(e.id, { ...base, replies: e.replies, lastActivity: e.lastActivity || base.lastActivity, lastAuthor: e.lastAuthor || base.lastAuthor, locked: e.locked });
    } else {
      byId.set(e.id, e);
    }
  }
  const list = [...byId.values()].filter((e) =>
    e.status === "visible" || isAdmin || (viewerId && e.authorId === viewerId && e.status !== "deleted"));
  list.sort((a, b) => {
    if (!!b.pinned - !!a.pinned) return !!b.pinned - !!a.pinned;
    return String(b.lastActivity).localeCompare(String(a.lastActivity));
  });
  return list;
}

export async function loadThread(id, { available = true } = {}) {
  const seed = SEED_BY_ID[id];
  const blob = available ? await getJSON("forum-threads", tKey(id)) : null;
  if (seed) {
    return {
      id: seed.id, board: seed.board, title: seed.title, created: seed.created, seed: true,
      pinned: !!seed.pinned, authorName: seed.author || "GA Forum editorial team",
      bodyHtml: seed.body_html || "", related: seed.related || [],
      locked: !!(blob && blob.locked), posts: (blob && blob.posts) || [], seq: (blob && blob.seq) || 0,
    };
  }
  if (!blob || !BOARD_BY_SLUG[blob.board]) return null;
  return blob;
}

function storedThread(t) {
  if (!t.seed) return t;
  return { id: t.id, board: t.board, seed: true, locked: !!t.locked, posts: t.posts, seq: t.seq };
}

export function summarize(t) {
  const replies = t.seed ? t.posts : t.posts.slice(1);
  const visible = replies.filter((p) => p.status === "visible");
  const last = visible[visible.length - 1];
  const opener = t.seed ? null : t.posts[0];
  return {
    id: t.id, board: t.board, title: t.title, slug: t.slug, seed: !!t.seed,
    authorName: t.seed ? t.authorName : opener.authorName,
    authorId: t.seed ? null : opener.authorId,
    created: t.created,
    lastActivity: last ? last.created : t.created,
    lastAuthor: last ? last.authorName : (t.seed ? t.authorName : opener.authorName),
    replies: visible.length,
    status: t.seed ? "visible" : opener.status,
    locked: !!t.locked,
  };
}

async function saveThread(t) {
  await setJSON("forum-threads", tKey(t.id), storedThread(t));
  const idx = await getBoardIndex(t.board);
  const entry = summarize(t);
  const rest = (idx.threads || []).filter((e) => e.id !== t.id);
  if (entry.status !== "deleted") rest.push(entry);
  await setJSON("forum-threads", iKey(t.board), { threads: rest });
}

export function visibleToViewer(post, { viewerId, isAdmin }) {
  if (post.status === "deleted") return false;
  if (post.status === "visible") return true;
  return isAdmin || (viewerId && post.authorId === viewerId);
}

// ---------- moderation queue ----------

async function queueSet(postId, threadId, kind) {
  const q = (await getJSON("forum-threads", "modqueue")) || { items: {} };
  q.items[postId] = { threadId, kind, at: new Date().toISOString() };
  await setJSON("forum-threads", "modqueue", q);
}

async function queueRemove(postId) {
  const q = (await getJSON("forum-threads", "modqueue")) || { items: {} };
  if (q.items[postId]) {
    delete q.items[postId];
    await setJSON("forum-threads", "modqueue", q);
  }
}

export async function getQueue() {
  const q = (await getJSON("forum-threads", "modqueue")) || { items: {} };
  const out = [];
  const cache = new Map();
  for (const [postId, item] of Object.entries(q.items)) {
    if (!cache.has(item.threadId)) cache.set(item.threadId, await loadThread(item.threadId));
    const t = cache.get(item.threadId);
    const post = t && t.posts.find((p) => p.id === postId);
    if (!t || !post || post.status === "deleted") continue;
    out.push({
      postId, kind: item.kind, at: item.at, threadId: t.id, threadTitle: t.title, board: t.board,
      seedThread: !!t.seed, isOpener: !t.seed && t.posts[0].id === postId,
      authorName: post.authorName, created: post.created, body: post.body,
      status: post.status, reports: post.reports || 0, locked: !!t.locked,
    });
  }
  out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return out;
}

// ---------- writing ----------

export function validateTitle(raw) {
  const title = String(raw || "").replace(/\s+/g, " ").trim();
  if (title.length < LIMITS.titleMin || title.length > LIMITS.titleMax) return { error: "title_length" };
  return { title };
}

export function validateBody(raw) {
  const body = String(raw || "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (body.length < LIMITS.bodyMin || body.length > LIMITS.bodyMax) return { error: "body_length" };
  return { body };
}

function initialStatus(user, body, now) {
  return isNewUser(user, now) && containsLink(body) ? "held" : "visible";
}

export async function createThread(user, { board, title, body }, now = Date.now()) {
  if (!BOARD_BY_SLUG[board]) return { error: "unknown_board" };
  const vt = validateTitle(title);
  if (vt.error) return vt;
  const vb = validateBody(body);
  if (vb.error) return vb;
  const id = newThreadId();
  const created = new Date(now).toISOString();
  const status = initialStatus(user, vb.body, now);
  const post = {
    id: id + ".0", authorId: user.id, authorName: user.name, created, edited: null,
    body: vb.body, status, reports: 0, reportsCleared: 0, everApproved: status === "visible",
  };
  const t = { id, board, title: vt.title, slug: slugify(vt.title), created, locked: false, seq: 0, posts: [post] };
  await saveThread(t);
  if (status === "held") await queueSet(post.id, id, "held");
  else { user.approvedPosts = (user.approvedPosts || 0) + 1; await saveUser(user); }
  return { thread: t, post };
}

export async function addReply(user, threadId, { body }, { isAdmin = false } = {}, now = Date.now()) {
  const t = await loadThread(threadId);
  if (!t) return { error: "not_found" };
  if (!t.seed && t.posts[0].status !== "visible" && t.posts[0].authorId !== user.id && !isAdmin) return { error: "not_found" };
  if (t.locked && !isAdmin) return { error: "thread_locked" };
  const vb = validateBody(body);
  if (vb.error) return vb;
  t.seq = (t.seq || 0) + 1;
  // Make sure ids never collide with existing posts.
  while (t.posts.some((p) => p.id === t.id + "." + t.seq)) t.seq++;
  const status = initialStatus(user, vb.body, now);
  const post = {
    id: t.id + "." + t.seq, authorId: user.id, authorName: user.name, created: new Date(now).toISOString(),
    edited: null, body: vb.body, status, reports: 0, reportsCleared: 0, everApproved: status === "visible",
  };
  t.posts.push(post);
  await saveThread(t);
  if (status === "held") await queueSet(post.id, t.id, "held");
  else { user.approvedPosts = (user.approvedPosts || 0) + 1; await saveUser(user); }
  return { thread: t, post };
}

async function findPost(postId) {
  const sp = splitPostId(postId);
  if (!sp) return null;
  const t = await loadThread(sp.threadId);
  if (!t) return null;
  const post = t.posts.find((p) => p.id === postId);
  if (!post || post.status === "deleted") return null;
  return { t, post };
}

export async function editPost(user, postId, { body }, now = Date.now()) {
  const found = await findPost(postId);
  if (!found) return { error: "not_found" };
  const { t, post } = found;
  if (post.authorId !== user.id) return { error: "forbidden" };
  if (now - new Date(post.created).getTime() > LIMITS.editWindowMs) return { error: "edit_window_closed" };
  if (post.status === "hidden") return { error: "post_hidden" };
  const vb = validateBody(body);
  if (vb.error) return vb;
  post.body = vb.body;
  post.edited = new Date(now).toISOString();
  if (post.status === "visible" && initialStatus(user, vb.body, now) === "held") {
    post.status = "held";
    await queueSet(post.id, t.id, "held");
  }
  await saveThread(t);
  return { thread: t, post };
}

export async function reportPost(user, postId, { reason }, now = Date.now()) {
  const r = String(reason || "").trim();
  if (r.length > LIMITS.reasonMax) return { error: "reason_length" };
  const found = await findPost(postId);
  if (!found) return { error: "not_found" };
  const { t, post } = found;
  if (post.status !== "visible") return { error: "not_found" };
  if (post.authorId === user.id) return { error: "own_post" };
  const rKey = blobKey(postId);
  const rec = (await getJSON("forum-reports", rKey)) || { postId, threadId: t.id, users: {} };
  if (rec.users[user.id]) return { error: "already_reported" };
  rec.users[user.id] = { name: user.name, reason: r, at: new Date(now).toISOString() };
  await setJSON("forum-reports", rKey, rec);
  post.reports = Object.keys(rec.users).length;
  let hidden = false;
  if (post.reports - (post.reportsCleared || 0) >= LIMITS.autoHideReports) {
    post.status = "hidden";
    post.autoHidden = true;
    hidden = true;
  }
  await saveThread(t);
  await queueSet(post.id, t.id, "reported");
  return { ok: true, hidden };
}

export async function getReports(postId) {
  const rec = await getJSON("forum-reports", blobKey(postId));
  if (!rec) return [];
  return Object.values(rec.users).map((u) => ({ name: u.name, reason: u.reason, at: u.at }));
}

// ---------- admin ----------

export async function adminAction(action, { postId, threadId, locked } = {}) {
  if (action === "lock") {
    const t = await loadThread(threadId);
    if (!t) return { error: "not_found" };
    t.locked = locked === undefined ? !t.locked : !!locked;
    await saveThread(t);
    return { ok: true, locked: t.locked };
  }
  const found = await findPost(postId);
  if (!found) return { error: "not_found" };
  const { t, post } = found;
  if (action === "approve") {
    const firstApproval = !post.everApproved;
    post.status = "visible";
    post.everApproved = true;
    post.autoHidden = false;
    post.reportsCleared = post.reports || 0;
    if (firstApproval && post.authorId) {
      const author = await getUserById(post.authorId);
      if (author) { author.approvedPosts = (author.approvedPosts || 0) + 1; await saveUser(author); }
    }
  } else if (action === "hide") {
    post.status = "hidden";
  } else if (action === "delete") {
    post.status = "deleted";
    post.body = "";
  } else {
    return { error: "unknown_action" };
  }
  await saveThread(t);
  await queueRemove(post.id);
  return { ok: true, status: post.status };
}
