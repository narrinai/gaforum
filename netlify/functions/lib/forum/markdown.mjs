// Markdown-lite: paragraphs, line breaks, **bold**, *italic*, `code`, ``` blocks,
// > quotes, - lists, [text](https://url) and bare https URLs.
// Everything is HTML-escaped first; only http(s) URLs become links.
import { esc } from "./util.mjs";

const LINK_ATTRS = 'rel="nofollow ugc noopener" target="_blank"';
const PH = "\u0000";

function safeHref(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function link(hrefRaw, textHtml) {
  const href = safeHref(hrefRaw);
  if (!href) return null;
  return `<a href="${esc(href)}" ${LINK_ATTRS}>${textHtml}</a>`;
}

// Inline formatting on raw (unescaped) text. Returns HTML.
export function inline(raw) {
  const tokens = [];
  const hold = (html) => PH + (tokens.push(html) - 1) + PH;
  let s = esc(raw);

  // Inline code first, so nothing inside it is formatted.
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));

  // [text](url)
  s = s.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)\u0000]{1,2000})\)/gi, (m, text, url) => {
    const html = link(unescapeHtml(url), text);
    return html ? hold(html) : m;
  });

  // Bare URLs.
  s = s.replace(/\bhttps?:\/\/[^\s<\u0000]{1,2000}/gi, (m) => {
    let url = m;
    let trail = "";
    // Trim trailing punctuation and escaped entities that are likely not part of the URL.
    for (;;) {
      const t = url.match(/(&quot;|&#39;|&gt;|[.,!?;:'"])$/);
      if (t) { trail = t[0] + trail; url = url.slice(0, -t[0].length); continue; }
      if (url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
        trail = ")" + trail; url = url.slice(0, -1); continue;
      }
      break;
    }
    const html = link(unescapeHtml(url), url);
    return html ? hold(html) + trail : m;
  });

  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, "$1<em>$2</em>");

  // Restore placeholders (tokens never contain other tokens unresolved).
  return s.replace(new RegExp(PH + "(\\d+)" + PH, "g"), (_, i) => tokens[Number(i)] ?? "");
}

export function renderMarkdown(src) {
  const text = String(src ?? "")
    .replace(/\r\n?/g, "\n")
    // Strip control characters (also removes any placeholder chars from input).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  const lines = text.split("\n");
  const out = [];
  let para = [];
  let list = null;
  let quote = null;

  const flushPara = () => {
    if (para.length) out.push("<p>" + para.map(inline).join("<br>") + "</p>");
    para = [];
  };
  const flushList = () => {
    if (list) out.push("<ul>" + list.map((li) => "<li>" + inline(li) + "</li>").join("") + "</ul>");
    list = null;
  };
  const flushQuote = () => {
    if (quote) {
      const inner = renderMarkdown(quote.join("\n"));
      out.push("<blockquote>" + inner + "</blockquote>");
    }
    quote = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushAll();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
      continue;
    }
    const q = line.match(/^\s*(?:>|&gt;)\s?(.*)$/);
    if (q) {
      flushPara(); flushList();
      (quote ||= []).push(q[1]);
      continue;
    }
    if (quote) flushQuote();
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li && !/^\s*\*\*/.test(line)) {
      flushPara();
      (list ||= []).push(li[1]);
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return out.join("\n");
}
