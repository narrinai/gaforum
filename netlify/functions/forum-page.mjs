// Server-rendered HTML for every /forum page (Netlify Functions v2).
import { BOARDS, BOARD_BY_SLUG, LIMITS, threadUrl, SEED_BY_ID } from "./lib/forum/util.mjs";
import { blobsAvailable } from "./lib/forum/store.mjs";
import { getSession } from "./lib/forum/auth.mjs";
import { listBoardThreads, loadThread, visibleToViewer, getQueue, getReports } from "./lib/forum/data.mjs";
import { renderHome, renderBoard, renderThread, renderAdmin, renderAccount, renderLogin, renderError } from "./lib/forum/render.mjs";

export const config = { path: ["/forum", "/forum/*"] };

function html(body, status = 200, { personal = false } = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": personal ? "private, no-store" : "public, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

function redirect(location, status = 301) {
  return new Response(null, { status, headers: { location } });
}

function pageParam(url) {
  const n = parseInt(url.searchParams.get("page") || "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
}

async function safe(fn, fallback) {
  try { return await fn(); } catch (err) { console.error("forum-page", err && err.stack || err); return fallback; }
}

export default async function handler(req) {
  const url = new URL(req.url);
  let path = url.pathname.replace(/\/{2,}/g, "/");
  // netlify dev retries non-2xx responses with .html, .htm and /index.html variants; map them back.
  path = path.replace(/(\/index)?\.html?$/i, "") || "/forum";
  if (path.length > 6 && path.endsWith("/")) {
    return redirect(path.replace(/\/+$/, "") + url.search);
  }
  if (path === "/forum/") path = "/forum";

  const available = await blobsAvailable();
  const session = available ? await getSession(req) : null;
  const personal = !!session;
  const viewer = { viewerId: session ? session.user.id : null, isAdmin: !!(session && session.isAdmin) };
  const segs = path.split("/").filter(Boolean).slice(1).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });

  try {
    // /forum
    if (segs.length === 0) {
      const boards = [];
      const all = [];
      for (const board of BOARDS) {
        const threads = await safe(() => listBoardThreads(board.slug, { ...viewer, available }), []);
        const pub = threads.filter((t) => t.status === "visible");
        const latest = [...pub].sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)))[0] || null;
        boards.push({ board, count: pub.length, latest });
        all.push(...threads);
      }
      all.sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)));
      return html(renderHome({ session, available, boards, latest: all.slice(0, LIMITS.latestOnHome) }), 200, { personal });
    }

    // /forum/admin
    if (segs[0] === "admin" && segs.length === 1) {
      if (!session || !session.isAdmin) return html(renderError({ status: 403, session, available }), 403, { personal: true });
      const queue = await getQueue();
      for (const q of queue) q.reasons = await getReports(q.postId);
      return html(renderAdmin({ session, available, queue }), 200, { personal: true });
    }

    // /forum/account
    if (segs[0] === "account" && segs.length === 1) {
      return html(renderAccount({ session, available }), 200, { personal: true });
    }

    // /forum/login
    if (segs[0] === "login" && segs.length === 1) {
      return html(renderLogin({ session, available }), 200, { personal: true });
    }

    // /forum/t/<id>[/<slug>]
    if (segs[0] === "t" && (segs.length === 2 || segs.length === 3)) {
      const id = segs[1];
      if (!/^[a-z0-9][a-z0-9-]{0,120}$/i.test(id)) return html(renderError({ status: 404, session, available }), 404, { personal });
      const thread = (await safe(() => loadThread(id, { available }), null))
        ?? (SEED_BY_ID[id] ? await loadThread(id, { available: false }) : null);
      if (!thread) return html(renderError({ status: 404, session, available }), 404, { personal });
      const opener = thread.seed ? null : thread.posts[0];
      if (opener && !visibleToViewer(opener, viewer)) return html(renderError({ status: 404, session, available }), 404, { personal });

      const canonicalPath = threadUrl(thread);
      // Seed threads have no slug part; user threads redirect to the canonical slug.
      if (thread.seed && segs.length === 3) return redirect(canonicalPath + url.search);
      if (!thread.seed && segs[2] !== thread.slug) return redirect(canonicalPath + url.search);

      const all = (thread.seed ? thread.posts : thread.posts.slice(1)).filter((p) => visibleToViewer(p, viewer));
      const totalReplies = all.filter((p) => p.status === "visible").length;
      const pages = Math.max(1, Math.ceil(all.length / LIMITS.repliesPerPage));
      const page = pageParam(url);
      if (page > pages) return html(renderError({ status: 404, session, available }), 404, { personal });
      const replies = all.slice((page - 1) * LIMITS.repliesPerPage, page * LIMITS.repliesPerPage);
      return html(renderThread({ session, available, thread, opener, replies, page, pages, totalReplies, canonicalPath }), 200, { personal });
    }

    // /forum/<board>
    if (segs.length === 1 && BOARD_BY_SLUG[segs[0]]) {
      const board = BOARD_BY_SLUG[segs[0]];
      const threads = await safe(() => listBoardThreads(board.slug, { ...viewer, available }), []);
      const pages = Math.max(1, Math.ceil(threads.length / LIMITS.threadsPerPage));
      const page = pageParam(url);
      if (page > pages) return html(renderError({ status: 404, session, available }), 404, { personal });
      const slice = threads.slice((page - 1) * LIMITS.threadsPerPage, page * LIMITS.threadsPerPage);
      return html(renderBoard({ session, available, board, threads: slice, page, pages }), 200, { personal });
    }

    return html(renderError({ status: 404, session, available }), 404, { personal });
  } catch (err) {
    console.error("forum-page error", err && err.stack || err);
    // Last resort: render the seed thread or the 404 page without Blobs.
    try {
      if (segs[0] === "t" && SEED_BY_ID[segs[1]]) {
        const thread = await loadThread(segs[1], { available: false });
        return html(renderThread({ session: null, available: false, thread, opener: null, replies: [], page: 1, pages: 1, totalReplies: 0, canonicalPath: threadUrl(thread) }));
      }
      return html(renderError({ status: 404, session: null, available: false }), 404);
    } catch {
      return new Response("Something went wrong.", { status: 500, headers: { "content-type": "text/plain" } });
    }
  }
}
