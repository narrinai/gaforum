# Content brief: alternatives, comparisons, guides, research, news, glossary, forum seeds (GA Forum)

GA Forum (ga-forum.com) is an independent software research site and discussion forum for game developers, streamers, esports organizers and corporate live-video teams. Global, American English.

All files are strict JSON (UTF-8, 2-space indent, ensure_ascii false). Text fields may use `[anchor](/internal/url)` links and `**bold**`; nothing else (no HTML).

## Voice and hard rules (all types)
- Plain, specific, practical, a little dry. First sentence of every page: a self-contained answer or definition an AI assistant could quote. Name entities explicitly.
- No em dashes (U+2014) or en dashes used as dashes. No exclamation marks. Never write "top 10". No hype words (robust, seamless, powerful, cutting-edge, game-changer, revolutionize, unleash, elevate, supercharge, best-in-class, "in today's", "dive in", "level up your").
- Facts only from pages actually opened: vendor facts from `data/facts/index.json` (records with `facts[].url`) or pages you open yourself with the fetch helper (`python3 <scratchpad>/gather/fetch.py URL 6000`; WebFetch is rate-limited, do not use it). Never a number from memory or a search snippet. No invented quotes, studies, people, case studies, or tests ("we tested" is forbidden).
- Originality: never open or paraphrase other review sites or our sister sites (theknowledgeengineers.com, theinterregnum.net, aitoolcompare.ai, europeanpurpose.com, sameteampartners.com).
- **Overlap gate:** pages of the same type may share at most 15% of their 6-word sequences. Use your own sentence frames per page; do not reuse stock openers or closing lines across pages in your batch ("When it comes to", "The bottom line", "Both tools", "It depends on your needs", "If you are looking for"). Vary FAQ questions.
- Internal links: only to pages that exist or are in the plan: `/software/<category-slug>` (60 planned slugs in plan.json), `/alternatives/<slug>`, `/compare/<a>-vs-<b>`, `/guides/<slug>`, `/research/<slug>`, `/glossary`, `/forum`, `/editorial-process`. The build drops links to pages that end up missing, so prefer the related_* lists for cross-links and keep in-text links to a few.

---

## Alternatives: data/alternatives/<subject-slug>.json
```json
{
  "slug": "godot",
  "subject": "Godot",
  "subject_site": "https://godotengine.org/",
  "title": "Godot Alternatives in 2026",
  "published": "2026-11-18",
  "description": "150-160 chars meta description.",
  "category": "best-open-source-game-engines",
  "intro": "80-130 words. What the subject is (from its fact record) and the angle from the plan.",
  "why_switch": ["4-6 specific, factual reasons teams look elsewhere (not insulting)"],
  "picks": [
    {"slug": "unity", "name": "Unity", "site": "https://unity.com/", "best_for": "3-8 words", "pricing": "one sentence from facts", "free_plan": "Free plan | Free trial | Open source | Free | None | Unknown",
     "note": "60-100 words: why it is an alternative to the subject specifically, what you gain and what you give up.",
     "sources": [{"fact": "...", "url": "https://..."}]}
  ],
  "how_to_pick": "80-120 words: how to decide between the picks.",
  "faqs": [{"q": "...", "a": "40-90 words"}]
}
```
6 to 12 picks, only `verified` tools (minimum 6, else hold the page). 4-6 FAQs. About 1,300-2,000 words.

## Comparison: data/comparisons/<a>-vs-<b>.json
```json
{
  "slug": "unity-vs-unreal-engine", "a": "unity", "b": "unreal-engine",
  "a_name": "Unity", "b_name": "Unreal Engine", "a_site": "https://...", "b_site": "https://...",
  "category": "best-3d-game-engines-for-small-studios",
  "title": "Unity vs Unreal Engine: Which Fits Your Team in 2026?",
  "description": "150-160 chars", "published": "2026-11-18",
  "intro": "70-110 words", "verdict": "50-90 words: who should pick which",
  "pick_a": "30-60 words, continues 'Pick Unity if ...'", "pick_b": "...",
  "rows": [{"label": "Pricing model", "a": "...", "b": "..."}],
  "sections": [{"h2": "...", "text": ["paragraph", "..."]}],
  "faqs": [{"q": "...", "a": "..."}],
  "sources": [{"fact": "...", "url": "https://..."}]
}
```
8-11 rows (company/HQ, pricing model, entry price or terms, free option, platforms, main strength, main limit, best for, plus angle-specific rows). 4-6 sections, 900-1,400 words in total. 4-6 FAQs. 4-8 sources. Both tools must be `verified`; otherwise hold.

## Guide: data/guides/<slug>.json
```json
{
  "slug": "how-to-choose-a-game-engine",
  "title": "How to Choose a Game Engine: A Decision Guide",
  "description": "150-160 chars",
  "kind": "Playbook",
  "topic": "Game development | Livestreaming | Esports | Live video for business",
  "published": "2026-11-18",
  "intro": "70-110 words. First sentence = quotable answer.",
  "key_takeaways": ["4-6 one-sentence takeaways"],
  "sections": [{"h2": "...", "paras": ["..."], "list": ["optional bullets"], "ordered": false, "after": ["optional paragraph after list"]}],
  "faqs": [{"q": "...", "a": "50-90 words"}],
  "related_categories": ["category slugs from the plan"],
  "related_guides": ["other guide slugs from the plan"],
  "sources": [{"title": "...", "url": "https://...", "publisher": "..."}]
}
```
7-10 sections, at least one practical checklist or step list. 1,600-2,400 words. 3+ sources that you opened (vendor docs, official documentation, standards pages such as RFCs, platform help centers). Tool names mentioned should be ones with verified facts; no prices unless from the facts file.

## Research: data/research/<slug>.json
```json
{
  "slug": "steam-platform-statistics",
  "title": "Steam Platform Statistics 2026",
  "description": "150-160 chars",
  "category": "best-game-launchers-and-library-managers",
  "published": "2026-11-18",
  "intro": "60-100 words; first sentence = the single most important finding with its source.",
  "sections": [{"h2": "...", "intro": "optional 1-2 sentences", "facts": [
    {"text": "One self-contained sentence with the number, the period and who it applies to.", "source_name": "Valve, Steam Hardware & Software Survey (October 2026)", "source_url": "https://...", "year": "2026", "kind": "official | survey | study | vendor-claim | directory"}
  ]}],
  "methodology": ["1-2 paragraphs: which pages were opened on 18 Nov 2026, how figures were selected, limits"],
  "faqs": [{"q": "...", "a": "..."}],
  "related_guides": ["guide slugs"]
}
```
4-7 sections, 18-40 facts. Every `source_url` must be a page you opened today that contains the figure (use the fetch helper; if a source blocks it, drop that source; do not use figures you only saw in search results). If fewer than 15 sourced facts can be found, do not write the file; report the page as held.

## News / analysis: data/news/<slug>.json
```json
{
  "slug": "short-slug",
  "title": "Factual headline, no clickbait",
  "date": "2026-02-23",
  "description": "150-160 chars",
  "source": {"name": "Publisher of the PRIMARY source", "url": "https://primary source opened today"},
  "extra_sources": [{"name": "...", "url": "..."}],
  "summary": ["2-3 paragraphs in your own words, facts only from the opened source(s)"],
  "why_it_matters": ["1-2 paragraphs for game developers, streamers or esports organizers"],
  "related_categories": ["category slugs"]
}
```
Only with a primary source (the company's own blog, help center, press release, or policy page) opened today. Quote at most one short sentence. If no primary source can be opened, do not write the file; report it as held.

## Glossary: data/glossary.json
`{"terms": [{"slug": "netcode", "term": "Netcode", "definition": "45-90 words, first sentence a crisp definition.", "related": "/software/best-multiplayer-networking-sdks"}]}` (60-80 terms across game dev, streaming, esports, live video).

## Forum seed threads: data/forum/threads/<id>.json
```json
{
  "id": "short-kebab-id",
  "board": "games | livestreaming | esports | general",
  "title": "An opening question people would actually ask",
  "created": "2026-11-18T09:00:00Z",
  "pinned": false,
  "body": ["2-4 short paragraphs: the question, a short sourced intro (facts from data/facts or pages you opened, with the source named and linked as [publisher page](https://...)), and an invitation to share experience"],
  "related": [{"title": "Best 2D Game Engines in 2026", "url": "/software/best-2d-game-engines"}]
}
```
Author is always "GA Forum editorial team" (set by the build). No fake user replies, no invented personal anecdotes.
