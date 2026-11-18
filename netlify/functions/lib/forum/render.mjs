// Server-side HTML for every /forum page, wrapped in the site SHELL.
import { SHELL } from "../shell.mjs";
import {
  esc, SITE_URL, BOARDS, BOARD_BY_SLUG, LIMITS, threadUrl, fmtDate, stripTags, excerpt, maskEmail,
} from "./util.mjs";
import { renderMarkdown } from "./markdown.mjs";

const EDITORIAL_NAME = "GA Forum editorial team";

function jsonLdScript(obj) {
  if (!obj) return "";
  const list = Array.isArray(obj) ? obj : [obj];
  return list
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`)
    .join("");
}

function fill(template, values) {
  return template.replace(/\{\{(TITLE|DESC|CANONICAL|ROBOTS|JSONLD)\}\}/g, (_, k) => values[k] ?? "");
}

export function layout({ title, desc, canonical, noindex = false, jsonld = null, body, session = null, available = true }) {
  let head = fill(SHELL.head, {
    TITLE: esc(title),
    DESC: esc(desc),
    CANONICAL: esc(canonical),
    ROBOTS: noindex ? '<meta name="robots" content="noindex">' : "",
    JSONLD: jsonLdScript(jsonld),
  });
  const cssTag = '<link rel="stylesheet" href="/css/forum.css">';
  head = head.includes("</head>") ? head.replace("</head>", cssTag + "</head>") : head + cssTag;
  const hasMain = /<main[\s>]/i.test(SHELL.header);
  const user = session && session.user;
  const attrs = [
    `data-auth="${user ? "in" : "out"}"`,
    `data-needs-name="${user && !user.name ? "1" : "0"}"`,
    `data-admin="${session && session.isAdmin ? "1" : "0"}"`,
    `data-available="${available ? "1" : "0"}"`,
  ].join(" ");
  return (
    head +
    SHELL.header +
    // The real shell opens <main id="main"> in the header; only add one if it does not.
    (hasMain ? "" : `<main id="main">`) +
    `<div class="gaf" id="gaf" ${attrs}>` +
    (available ? "" : `<div class="wrap"><p class="gaf-notice" role="status">Posting is unavailable right now. You can still read every thread.</p></div>`) +
    body +
    loginDialog() +
    `</div>` +
    (hasMain ? "" : `</main>`) +
    `<script src="/js/forum.js" defer></script>` +
    SHELL.footer
  );
}

export function loginDialog() {
  return `
<dialog id="gaf-login" class="gaf-dialog" aria-labelledby="gaf-login-title">
  <div class="gaf-dialog__inner">
    <button type="button" class="gaf-dialog__close" data-gaf-close aria-label="Close">&times;</button>
    <form class="gaf-step" data-step="email" novalidate>
      <h2 id="gaf-login-title" class="gaf-dialog__title">Log in to GA Forum</h2>
      <p class="gaf-help">No password needed. We will email you a 6-digit code.</p>
      <label class="gaf-label" for="gaf-email">Email</label>
      <input class="gaf-input" id="gaf-email" name="email" type="email" autocomplete="email" required maxlength="254">
      <div class="gaf-hp" aria-hidden="true"><label>Leave this empty <input name="hp" type="text" tabindex="-1" autocomplete="off"></label></div>
      <button class="btn gaf-btn" type="submit">Send code</button>
      <p class="gaf-msg" role="status" aria-live="polite"></p>
    </form>
    <form class="gaf-step" data-step="code" hidden novalidate>
      <h2 class="gaf-dialog__title">Check your inbox</h2>
      <p class="gaf-help">We sent a code to <strong data-gaf-email></strong>. It works for 10 minutes.</p>
      <label class="gaf-label" for="gaf-code">6-digit code</label>
      <input class="gaf-input gaf-input--code" id="gaf-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      <button class="btn gaf-btn" type="submit">Log in</button>
      <button class="btn btn--ghost gaf-btn" type="button" data-gaf-back>Use a different email</button>
      <p class="gaf-msg" role="status" aria-live="polite"></p>
    </form>
    <form class="gaf-step" data-step="name" hidden novalidate>
      <h2 class="gaf-dialog__title">Pick a display name</h2>
      <p class="gaf-help">This is how others see you. 3 to 24 characters: letters, digits, spaces, _ - and dots. You can't change it later.</p>
      <label class="gaf-label" for="gaf-name">Display name</label>
      <input class="gaf-input" id="gaf-name" name="name" type="text" minlength="3" maxlength="24" autocomplete="nickname" required>
      <button class="btn gaf-btn" type="submit">Save name</button>
      <p class="gaf-msg" role="status" aria-live="polite"></p>
    </form>
  </div>
</dialog>`;
}

function crumbs(items) {
  const li = items
    .map((it, i) =>
      i === items.length - 1
        ? `<li aria-current="page">${esc(it.name)}</li>`
        : `<li><a href="${esc(it.url)}">${esc(it.name)}</a></li>`)
    .join("");
  return `<nav class="crumbs gaf-crumbs" aria-label="Breadcrumb"><ol>${li}</ol></nav>`;
}

function crumbsLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: SITE_URL + it.url })),
  };
}

function timeTag(iso) {
  return `<time datetime="${esc(iso)}">${esc(fmtDate(iso))}</time>`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function loginBox(session, available) {
  if (!available) return "";
  const user = session && session.user;
  if (!user) {
    return `<div class="gaf-auth"><p>Join the conversation. No password needed.</p><a class="btn" href="/forum/login" data-gaf-login>Log in to post</a></div>`;
  }
  if (!user.name) {
    return `<div class="gaf-auth"><p>You are logged in. Pick a display name to start posting.</p><button type="button" class="btn" data-gaf-name>Pick a display name</button></div>`;
  }
  return `<div class="gaf-auth"><p>Logged in as <strong>${esc(user.name)}</strong>${session.isAdmin ? ' <a href="/forum/admin">Moderation</a>' : ""}</p><a class="btn btn--ghost" href="/forum/account">Account</a></div>`;
}

function threadRow(e) {
  const badge = e.editorial ? ' <span class="gaf-badge">Editorial</span>' : "";
  const flags = [
    e.pinned ? '<span class="gaf-flag">Pinned</span>' : "",
    e.locked ? '<span class="gaf-flag">Locked</span>' : "",
    e.status === "held" ? '<span class="gaf-flag gaf-flag--warn">Waiting for review</span>' : "",
    e.status === "hidden" ? '<span class="gaf-flag gaf-flag--warn">Hidden</span>' : "",
  ].join("");
  return `<li class="gaf-thread">
  <a class="gaf-thread__title" href="${esc(threadUrl(e))}">${esc(e.title)}</a>${flags}
  <p class="gaf-thread__meta">by ${esc(e.authorName)}${badge} <span aria-hidden="true">&middot;</span> ${plural(e.replies || 0, "reply", "replies")} <span aria-hidden="true">&middot;</span> last activity ${timeTag(e.lastActivity)}</p>
</li>`;
}

function pagination(base, page, pages) {
  if (pages <= 1) return "";
  const href = (n) => (n === 1 ? base : `${base}?page=${n}`);
  const parts = [];
  if (page > 1) parts.push(`<a class="gaf-page" rel="prev" href="${esc(href(page - 1))}">Previous</a>`);
  for (let n = 1; n <= pages; n++) {
    if (pages > 7 && n !== 1 && n !== pages && Math.abs(n - page) > 1) {
      if (parts[parts.length - 1] !== "<span class=\"gaf-page gaf-page--gap\">...</span>") parts.push('<span class="gaf-page gaf-page--gap">...</span>');
      continue;
    }
    parts.push(n === page
      ? `<span class="gaf-page" aria-current="page">${n}</span>`
      : `<a class="gaf-page" href="${esc(href(n))}">${n}</a>`);
  }
  if (page < pages) parts.push(`<a class="gaf-page" rel="next" href="${esc(href(page + 1))}">Next</a>`);
  return `<nav class="gaf-pagination" aria-label="Pages">${parts.join("")}</nav>`;
}

// ---------- /forum ----------

export function renderHome({ session, available, boards, latest }) {
  const cards = boards
    .map(({ board, count, latest: l }) => `<li class="gaf-board">
  <a class="gaf-board__name" href="/forum/${esc(board.slug)}">${esc(board.name)}</a>
  <p class="gaf-board__desc">${esc(board.description || "")}</p>
  <p class="gaf-board__meta">${plural(count, "thread", "threads")}${l ? ` <span aria-hidden="true">&middot;</span> latest: <a href="${esc(threadUrl(l))}">${esc(l.title)}</a> ${timeTag(l.lastActivity)}` : ""}</p>
</li>`)
    .join("");
  const latestList = latest.length
    ? `<ol class="gaf-threads">${latest.map(threadRow).join("")}</ol>`
    : `<p class="gaf-empty">No threads yet. Be the first to start one.</p>`;
  const body = `<div class="wrap gaf-wrap">
  <header class="gaf-head">
    <p class="eyebrow">Community</p>
    <h1 class="gaf-title">GA Forum</h1>
    <p class="gaf-intro">Talk game development tools, livestreaming and esports with people who use them every day.</p>
  </header>
  ${loginBox(session, available)}
  <section aria-labelledby="gaf-boards-h"><h2 id="gaf-boards-h" class="gaf-h2">Boards</h2><ul class="gaf-boards">${cards}</ul></section>
  <section aria-labelledby="gaf-latest-h"><h2 id="gaf-latest-h" class="gaf-h2">Latest threads</h2>${latestList}</section>
</div>`;
  const crumbItems = [{ name: "Home", url: "/" }, { name: "Forum", url: "/forum" }];
  return layout({
    title: "GA Forum: game dev, streaming and esports community",
    desc: "Ask questions and compare notes on game development tools, livestreaming software and esports in the GA Forum community.",
    canonical: SITE_URL + "/forum",
    jsonld: [crumbsLd(crumbItems)],
    body, session, available,
  });
}

// ---------- /forum/<board> ----------

export function renderBoard({ session, available, board, threads, page, pages }) {
  const user = session && session.user;
  let newBtn = "";
  let form = "";
  if (available) {
    if (user && user.name) {
      newBtn = `<a class="btn" href="#new-thread" data-gaf-toggle="new-thread">New thread</a>`;
      form = `<form id="new-thread" class="gaf-form" data-gaf-form="thread" data-board="${esc(board.slug)}" novalidate>
  <h2 class="gaf-h2">Start a new thread</h2>
  <label class="gaf-label" for="nt-title">Title</label>
  <input class="gaf-input" id="nt-title" name="title" type="text" minlength="${LIMITS.titleMin}" maxlength="${LIMITS.titleMax}" required>
  <label class="gaf-label" for="nt-body">Your post</label>
  <textarea class="gaf-input gaf-textarea" id="nt-body" name="body" rows="8" minlength="${LIMITS.bodyMin}" maxlength="${LIMITS.bodyMax}" required></textarea>
  <p class="gaf-help">${formattingHelp()}</p>
  <div class="gaf-hp" aria-hidden="true"><label>Leave this empty <input name="hp" type="text" tabindex="-1" autocomplete="off"></label></div>
  <div class="gaf-actions"><button class="btn" type="submit">Post thread</button></div>
  <p class="gaf-msg" role="status" aria-live="polite"></p>
  <noscript><p class="gaf-help">Posting needs JavaScript.</p></noscript>
</form>`;
    } else if (user) {
      newBtn = `<button type="button" class="btn" data-gaf-name>New thread</button>`;
    } else {
      newBtn = `<a class="btn" href="/forum/login" data-gaf-login>New thread</a>`;
    }
  }
  const list = threads.length
    ? `<ol class="gaf-threads">${threads.map(threadRow).join("")}</ol>`
    : `<p class="gaf-empty">No threads here yet. Start the first one.</p>`;
  const crumbItems = [{ name: "Forum", url: "/forum" }, { name: board.name, url: "/forum/" + board.slug }];
  const hubLabel = board.hub === "/software" ? "See all software rankings" : `See the ${board.name.toLowerCase()} rankings`;
  const hub = board.hub && board.hub !== "/" ? `<p class="gaf-hub"><a href="${esc(board.hub)}">${esc(hubLabel)}</a></p>` : "";
  const body = `<div class="wrap gaf-wrap">
  ${crumbs(crumbItems)}
  <header class="gaf-head gaf-head--row">
    <div><p class="eyebrow">Board</p><h1 class="gaf-title">${esc(board.name)}</h1>
    <p class="gaf-intro">${esc(board.description || "")}</p>${hub}</div>
    <div class="gaf-head__cta">${newBtn}</div>
  </header>
  ${form}
  ${list}
  ${pagination("/forum/" + board.slug, page, pages)}
</div>`;
  const pageSuffix = page > 1 ? ` (page ${page})` : "";
  return layout({
    title: `${board.name} forum${pageSuffix} | GA Forum`,
    desc: excerpt(`${board.name} discussions on GA Forum. ${board.description || ""}`, 155),
    canonical: SITE_URL + "/forum/" + board.slug + (page > 1 ? `?page=${page}` : ""),
    jsonld: [crumbsLd(crumbItems)],
    body, session, available,
  });
}

function formattingHelp() {
  return "Formatting: **bold**, *italic*, `code`, ``` for code blocks, &gt; quote, - list, [text](https://link).";
}

// ---------- posts ----------

function postArticle(post, { thread, session, isOpener, available }) {
  const user = session && session.user;
  const viewerId = user && user.id;
  const isAdmin = !!(session && session.isAdmin);
  const own = !!(viewerId && post.authorId === viewerId);
  const domId = "p-" + post.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const notices = [];
  if (post.status === "held") notices.push(own && !isAdmin ? "Your post is waiting for review." : "Held for review. Only you and the author can see this.");
  if (post.status === "hidden") notices.push(own && !isAdmin ? "This post is hidden while we review it." : `Hidden${post.reports ? ` (${plural(post.reports, "report", "reports")})` : ""}. Only you and the author can see this.`);
  const editable = own && Date.now() - new Date(post.created).getTime() < LIMITS.editWindowMs && post.status !== "hidden";
  const editUntil = new Date(new Date(post.created).getTime() + LIMITS.editWindowMs).toISOString();
  const actions = [];
  if (available && !own) {
    actions.push(user && user.name
      ? `<button type="button" class="gaf-link" data-gaf-report="${esc(post.id)}">Report</button>`
      : user ? `<button type="button" class="gaf-link" data-gaf-name>Report</button>`
        : `<a class="gaf-link" href="/forum/login" data-gaf-login>Report</a>`);
  }
  if (available && editable) actions.push(`<button type="button" class="gaf-link" data-gaf-edit="${esc(post.id)}" data-edit-until="${esc(editUntil)}">Edit</button>`);
  if (available && isAdmin) {
    if (post.status !== "visible") actions.push(`<button type="button" class="gaf-link" data-gaf-admin="approve" data-post-id="${esc(post.id)}">Approve</button>`);
    if (post.status !== "hidden") actions.push(`<button type="button" class="gaf-link" data-gaf-admin="hide" data-post-id="${esc(post.id)}">Hide</button>`);
    actions.push(`<button type="button" class="gaf-link gaf-link--danger" data-gaf-admin="delete" data-post-id="${esc(post.id)}">Delete</button>`);
  }
  const src = editable ? `<textarea class="gaf-src" hidden aria-hidden="true">${esc(post.body)}</textarea>` : "";
  return `<article class="gaf-post${isOpener ? " gaf-post--op" : ""}${post.status !== "visible" ? " gaf-post--pending" : ""}" id="${domId}" data-post-id="${esc(post.id)}">
  <header class="gaf-post__head"><span class="gaf-post__author">${esc(post.authorName)}</span> <span class="gaf-post__date">${timeTag(post.created)}${post.edited ? " (edited)" : ""}</span>
  <a class="gaf-post__perma" href="#${domId}" aria-label="Link to this post">#</a></header>
  ${notices.map((n) => `<p class="gaf-notice gaf-notice--warn">${esc(n)}</p>`).join("")}
  <div class="gaf-post__body">${renderMarkdown(post.body)}</div>
  ${src}
  ${actions.length ? `<footer class="gaf-post__actions">${actions.join("")}</footer>` : ""}
</article>`;
}

function seedOpener(thread, available, session) {
  return `<article class="gaf-post gaf-post--op" id="p-op">
  <header class="gaf-post__head"><span class="gaf-post__author">${esc(thread.authorName)}</span> <span class="gaf-badge">Editorial</span> <span class="gaf-post__date">${timeTag(thread.created)}</span></header>
  <div class="gaf-post__body">${thread.bodyHtml}</div>
</article>`;
}

// ---------- /forum/t/<id> ----------

export function renderThread({ session, available, thread, opener, replies, page, pages, totalReplies, canonicalPath }) {
  const board = BOARD_BY_SLUG[thread.board];
  const user = session && session.user;
  const isAdmin = !!(session && session.isAdmin);
  const crumbItems = [
    { name: "Forum", url: "/forum" },
    { name: board.name, url: "/forum/" + board.slug },
    { name: thread.title, url: canonicalPath },
  ];
  const ctx = { thread, session, available };
  const openerHtml = page === 1 ? (thread.seed ? seedOpener(thread, available, session) : postArticle(opener, { ...ctx, isOpener: true })) : "";
  const repliesHtml = replies.map((p) => postArticle(p, { ...ctx, isOpener: false })).join("");

  let related = "";
  if (thread.seed && thread.related && thread.related.length) {
    related = `<aside class="gaf-related" aria-labelledby="gaf-related-h"><h2 id="gaf-related-h" class="gaf-h3">Related on GA Forum</h2><ul>${thread.related
      .map((r) => `<li><a href="${esc(r.url)}">${esc(r.title)}</a></li>`).join("")}</ul></aside>`;
  }

  let replyBox = "";
  if (!available) {
    replyBox = "";
  } else if (thread.locked && !isAdmin) {
    replyBox = `<p class="gaf-notice">This thread is locked. New replies are turned off.</p>`;
  } else if (user && user.name) {
    replyBox = `<form id="reply" class="gaf-form" data-gaf-form="reply" data-thread="${esc(thread.id)}" novalidate>
  <h2 class="gaf-h2">Reply</h2>
  ${thread.locked ? '<p class="gaf-notice">This thread is locked. You can still reply as a moderator.</p>' : ""}
  <label class="gaf-label" for="reply-body">Your reply</label>
  <textarea class="gaf-input gaf-textarea" id="reply-body" name="body" rows="6" minlength="${LIMITS.bodyMin}" maxlength="${LIMITS.bodyMax}" required></textarea>
  <p class="gaf-help">${formattingHelp()}</p>
  <div class="gaf-hp" aria-hidden="true"><label>Leave this empty <input name="hp" type="text" tabindex="-1" autocomplete="off"></label></div>
  <div class="gaf-actions"><button class="btn" type="submit">Post reply</button></div>
  <p class="gaf-msg" role="status" aria-live="polite"></p>
  <noscript><p class="gaf-help">Posting needs JavaScript.</p></noscript>
</form>`;
  } else if (user) {
    replyBox = `<div class="gaf-auth"><p>Pick a display name to reply.</p><button type="button" class="btn" data-gaf-name>Pick a display name</button></div>`;
  } else {
    replyBox = `<div class="gaf-auth"><p>Want to reply? Log in with your email, no password needed.</p><a class="btn" href="/forum/login" data-gaf-login>Log in to reply</a></div>`;
  }

  const adminBar = available && isAdmin
    ? `<div class="gaf-adminbar"><button type="button" class="btn btn--ghost" data-gaf-admin="lock" data-thread-id="${esc(thread.id)}" data-locked="${thread.locked ? "1" : "0"}">${thread.locked ? "Unlock thread" : "Lock thread"}</button></div>`
    : "";

  const body = `<div class="wrap gaf-wrap">
  ${crumbs(crumbItems)}
  <header class="gaf-head">
    <p class="eyebrow"><a href="/forum/${esc(board.slug)}">${esc(board.name)}</a></p>
    <h1 class="gaf-title">${esc(thread.title)}</h1>
    <p class="gaf-thread__meta">${plural(totalReplies, "reply", "replies")}${thread.locked ? ' <span class="gaf-flag">Locked</span>' : ""}</p>
  </header>
  ${adminBar}
  <div class="gaf-posts">${openerHtml}${repliesHtml}</div>
  ${pagination(canonicalPath, page, pages)}
  ${related}
  ${replyBox}
</div>`;

  // JSON-LD
  const openerText = thread.seed ? stripTags(thread.bodyHtml) : stripTags(renderMarkdown(opener.body));
  const author = thread.seed
    ? { "@type": "Organization", name: thread.authorName, url: SITE_URL + "/" }
    : { "@type": "Person", name: opener.authorName };
  const url = SITE_URL + canonicalPath;
  const ld = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    author,
    datePublished: thread.created,
    text: excerpt(openerText, 500),
    url,
    mainEntityOfPage: url,
    interactionStatistic: { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: totalReplies },
    comment: replies
      .filter((p) => p.status === "visible")
      .map((p) => ({
        "@type": "Comment",
        author: { "@type": "Person", name: p.authorName },
        datePublished: p.created,
        text: excerpt(stripTags(renderMarkdown(p.body)), 500),
        url: url + (page > 1 ? `?page=${page}` : "") + "#p-" + p.id.replace(/[^a-zA-Z0-9_-]/g, "-"),
      })),
  };
  if (!thread.seed && opener.edited) ld.dateModified = opener.edited;
  const pageSuffix = page > 1 ? ` (page ${page})` : "";
  return layout({
    title: `${thread.title}${pageSuffix} | GA Forum`,
    desc: excerpt(openerText, 155),
    canonical: url + (page > 1 ? `?page=${page}` : ""),
    jsonld: [ld, crumbsLd(crumbItems)],
    body, session, available,
  });
}

// ---------- /forum/admin ----------

export function renderAdmin({ session, available, queue }) {
  const items = queue.length
    ? queue.map((q) => `<li class="gaf-queue__item" data-post-id="${esc(q.postId)}">
  <p class="gaf-queue__meta"><span class="gaf-flag ${q.kind === "held" ? "gaf-flag--warn" : ""}">${q.kind === "held" ? "Held (link from new user)" : `Reported (${plural(q.reports, "report", "reports")})`}</span>
  ${q.status === "hidden" ? '<span class="gaf-flag gaf-flag--warn">Hidden</span>' : ""}
  in <a href="/forum/t/${esc(q.threadId)}">${esc(q.threadTitle)}</a> by <strong>${esc(q.authorName)}</strong> ${timeTag(q.created)}${q.isOpener ? " (thread opener)" : ""}</p>
  <div class="gaf-post__body">${renderMarkdown(q.body)}</div>
  ${q.reasons && q.reasons.length ? `<ul class="gaf-reasons">${q.reasons.map((r) => `<li>${esc(r.name || "Someone")}: ${r.reason ? esc(r.reason) : "<em>no reason given</em>"}</li>`).join("")}</ul>` : ""}
  <div class="gaf-actions">
    <button type="button" class="btn" data-gaf-admin="approve" data-post-id="${esc(q.postId)}">Approve</button>
    <button type="button" class="btn btn--ghost" data-gaf-admin="hide" data-post-id="${esc(q.postId)}">Hide</button>
    <button type="button" class="btn btn--ghost gaf-btn--danger" data-gaf-admin="delete" data-post-id="${esc(q.postId)}">Delete</button>
    <button type="button" class="btn btn--ghost" data-gaf-admin="lock" data-thread-id="${esc(q.threadId)}" data-locked="${q.locked ? "1" : "0"}">${q.locked ? "Unlock thread" : "Lock thread"}</button>
  </div>
</li>`).join("")
    : "";
  const body = `<div class="wrap gaf-wrap">
  ${crumbs([{ name: "Forum", url: "/forum" }, { name: "Moderation", url: "/forum/admin" }])}
  <header class="gaf-head"><h1 class="gaf-title">Moderation</h1>
  <p class="gaf-intro">Held posts and reported posts. Approve to publish, hide to keep it out of view, delete to remove it for good.</p></header>
  ${queue.length ? `<ol class="gaf-queue">${items}</ol>` : `<p class="gaf-empty">All clear. Nothing waiting for review.</p>`}
</div>`;
  return layout({ title: "Moderation | GA Forum", desc: "Forum moderation queue.", canonical: SITE_URL + "/forum/admin", noindex: true, body, session, available });
}

// ---------- /forum/account ----------

export function renderAccount({ session, available }) {
  const user = session && session.user;
  let inner;
  if (!user) {
    inner = `<div class="gaf-auth"><p>You are not logged in.</p><a class="btn" href="/forum/login" data-gaf-login>Log in</a></div>`;
  } else {
    inner = `<dl class="gaf-dl">
  <dt>Email</dt><dd>${esc(maskEmail(user.email))}</dd>
  <dt>Display name</dt><dd>${user.name ? esc(user.name) : `<button type="button" class="btn" data-gaf-name>Pick a display name</button>`}</dd>
  <dt>Member since</dt><dd>${timeTag(user.created)}</dd>
</dl>
<div class="gaf-actions"><button type="button" class="btn btn--ghost" data-gaf-logout>Log out</button>${session.isAdmin ? ' <a class="btn btn--ghost" href="/forum/admin">Moderation</a>' : ""}</div>
<p class="gaf-msg" role="status" aria-live="polite"></p>`;
  }
  const body = `<div class="wrap gaf-wrap">
  ${crumbs([{ name: "Forum", url: "/forum" }, { name: "Account", url: "/forum/account" }])}
  <header class="gaf-head"><h1 class="gaf-title">Your account</h1></header>
  ${inner}
</div>`;
  return layout({ title: "Account | GA Forum", desc: "Your GA Forum account.", canonical: SITE_URL + "/forum/account", noindex: true, body, session, available });
}

// ---------- /forum/login ----------

export function renderLogin({ session, available }) {
  const user = session && session.user;
  const inner = !available
    ? `<p class="gaf-notice">Login is temporarily unavailable. Please try again later.</p>`
    : user && user.name
      ? `<p>You are already logged in as <strong>${esc(user.name)}</strong>.</p><a class="btn" href="/forum">Go to the forum</a>`
      : `<p>No password needed. Enter your email and we will send you a 6-digit code.</p>
<button type="button" class="btn" data-gaf-login data-gaf-autoopen>${user ? "Pick a display name" : "Log in with email"}</button>
<noscript><p class="gaf-help">Logging in needs JavaScript.</p></noscript>`;
  const body = `<div class="wrap gaf-wrap gaf-narrow">
  ${crumbs([{ name: "Forum", url: "/forum" }, { name: "Log in", url: "/forum/login" }])}
  <header class="gaf-head"><h1 class="gaf-title">Log in</h1></header>
  ${inner}
</div>`;
  return layout({ title: "Log in | GA Forum", desc: "Log in to GA Forum with your email.", canonical: SITE_URL + "/forum/login", noindex: true, body, session, available });
}

// ---------- errors ----------

export function renderError({ status, session, available = true }) {
  const msg = status === 403
    ? { h: "This page is for moderators", p: "You need a moderator account to see this page." }
    : { h: "Thread not found", p: "This page does not exist, or it was removed." };
  const body = `<div class="wrap gaf-wrap gaf-narrow">
  <header class="gaf-head"><p class="eyebrow">Error ${status}</p><h1 class="gaf-title">${msg.h}</h1><p class="gaf-intro">${msg.p}</p></header>
  <p><a class="btn" href="/forum">Back to the forum</a></p>
</div>`;
  return layout({ title: `${msg.h} | GA Forum`, desc: msg.p, canonical: SITE_URL + "/forum", noindex: true, body, session, available });
}

export { BOARDS, EDITORIAL_NAME };
