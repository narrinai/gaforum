# GA Forum backend

Netlify Functions (v2) plus Netlify Blobs. No external database.

- `netlify/functions/forum-page.mjs` renders every `/forum` page as HTML (crawlable, no client-only content).
- `netlify/functions/forum-api.mjs` serves the JSON API under `/api/forum/*`.
- `netlify/functions/lib/forum/*.mjs` holds the shared code (auth, store, markdown, render, mail, data).
- `netlify/functions/lib/forum-seed.json` and `netlify/functions/lib/shell.mjs` are written by `scripts/build.py`.
- `/js/forum.js` and `/css/forum.css` add the interactive parts (login dialog, forms, edit, report, admin buttons).

## Environment variables

| Name | Needed | What it does |
| --- | --- | --- |
| `SENDGRID_API_KEY` | yes, for login | SendGrid v3 key that can send from `hello@ga-forum.com`. Without it `auth/start` returns 503 `login_unavailable` and the dialog says "Login is temporarily unavailable. Please try again later." |
| `SESSION_SECRET` | recommended | Signs the `gaf_session` cookie and hashes login codes. If unset, a random 32-byte secret is created once and stored in Blobs (`forum-config` / `session-secret`). Changing it logs everyone out. |
| `ADMIN_EMAILS` | optional | Comma list of moderator emails, case-insensitive. Default `hello@ga-forum.com`. |
| `FORUM_SITE_URL` | optional | Base for canonical URLs and JSON-LD. Default `https://ga-forum.com`. |

## Storage layout (Netlify Blobs, strong consistency)

| Store | Key | Value |
| --- | --- | --- |
| `forum-users` | `<sha256 of email>` | `{id, emailHash, email, name, created, approvedPosts}` |
| `forum-users` | `byid/<userId>` | `{emailHash}` |
| `forum-names` | lowercased name (URL-encoded) | `{userId, name, at}` (unique name index) |
| `forum-codes` | `<email hash>` | `{hash (HMAC-SHA256), expires, attempts}` |
| `forum-threads` | `thread/<id>` | thread meta plus `posts` array. User threads: `posts[0]` is the opener. Seed threads: replies only, the opener lives in the seed JSON. |
| `forum-threads` | `index/<board>` | `{threads: [summary]}` used for board lists and the forum home |
| `forum-threads` | `modqueue` | `{items: {<postId>: {threadId, kind, at}}}` |
| `forum-reports` | `<postId>` | `{postId, threadId, users: {<userId>: {name, reason, at}}}` |
| `forum-ratelimits` | `<bucket>:<id>` | `{hits: [timestamps]}` (sliding window) |
| `forum-config` | `session-secret` | fallback cookie secret |

Post ids are `<threadId>.<n>`. User thread ids are `u<base36 time><4 random chars>`; URLs are `/forum/t/<id>/<slug>` (the slug is ignored for lookup and redirected to the canonical one). Seed thread URLs are `/forum/t/<id>`.

A page view costs about 2 to 6 blob reads (session user, board index or thread blob). There are no conditional writes, so two posts landing in the same thread in the same instant can race; at forum scale that is acceptable.

## Login

Email, then a 6-digit code (10 minutes, max 5 tries, single use), stored only as an HMAC. Rate limits: 3 codes per email per 15 minutes, 10 codes per IP per hour, 30 code checks per IP per hour. The API answers the same way for known and unknown emails. Session cookie `gaf_session`: HttpOnly, Secure, SameSite=Lax, Path=/, 30 days, `base64url(payload).HMAC`.

Display names: 3 to 24 chars, letters, digits, space, `_`, `-`, `.`; unique case-insensitive; reserved names (admin, moderator, ga forum, gaforum, editorial, GA Forum editorial team, staff, support) are blocked, also with spacing or punctuation variations. Names cannot be changed later.

## Moderation rules

- New user = account younger than 3 days OR fewer than 3 approved posts. A new user's post (opener or reply) that contains a link is held (`status: "held"`), hidden from others, and the author sees "Your post is waiting for review". An edit that adds a link puts the post back on hold.
- Any logged-in user can report a post once (reason optional, max 300 chars). At 3 reports the post is hidden pending review. A hidden or held opener hides the whole thread from others.
- `/forum/admin` (moderators from `ADMIN_EMAILS`) lists held and reported posts with Approve, Hide, Delete and Lock thread. Moderators also see these buttons on thread pages. Approving resets the report count used for auto-hide.
- Authors can edit their own posts for 15 minutes. Seed threads are never editable but take replies.
- Anti-abuse: 1 post per 20 seconds and 30 per day per user, 50 reports per day per user, honeypot field `hp` on every form, same-origin check (Origin or Referer must match the host) on every POST and PATCH, JSON bodies capped at 64 KB.

## Without Blobs

If Blobs is not available (for example a plain local run), pages still render the seed threads with zero replies and a notice that posting is unavailable. The API answers 503.

## Tests

`npm run test:forum` runs an offline harness with an in-memory store and a fake SendGrid.
