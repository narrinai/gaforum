#!/usr/bin/env python3
"""GA Forum static site build.

Every HTML page is generated from data/ by this script. Edit data/*.json or this file, never the HTML.

    python3 scripts/build.py

Writes: all pages (pretty URLs, Netlify serves /x for x.html), sitemap.xml, robots.txt, llms.txt,
llms-full.txt, data/search-index.json, _redirects, netlify/functions/lib/shell.mjs and
netlify/functions/lib/forum-seed.json (the forum function renders /forum/* with these).
"""
import datetime, html, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
TODAY = datetime.date.today().isoformat()
LEGAL_DATE = '2026-11-18'
YEAR = datetime.date.today().year


def load(p, default=None):
    f = os.path.join(D, p)
    if not os.path.exists(f):
        return default
    return json.load(open(f, encoding='utf-8'))


def load_dir(sub):
    d = os.path.join(D, sub)
    if not os.path.isdir(d):
        return []
    return [json.load(open(os.path.join(d, f), encoding='utf-8')) for f in sorted(os.listdir(d)) if f.endswith('.json')]


SITE = load('site.json')
AUTHORS = load('authors.json')['authors']
TEAM, EDITOR = AUTHORS[0], AUTHORS[1]
HUBS = SITE['hubs']
CATS_ALL = load_dir('categories')
GUIDES = sorted(load_dir('guides'), key=lambda g: (g.get('published', ''), g['slug']), reverse=True)
RESEARCH = load_dir('research')
NEWS = sorted(load_dir('news'), key=lambda n: n.get('date', ''), reverse=True)
COMPARES = load_dir('comparisons')
ALTS = load_dir('alternatives')
GLOSSARY = load('glossary.json', {'terms': []})['terms']
FEATURED = load('featured.json', [])
SEEDS = load_dir('forum/threads')
DOMAIN = SITE['domain']
e = lambda s: html.escape(str(s if s is not None else ''), quote=True)
PAGES = []
WRITTEN = set()
WARN = []
DISCLOSURE_LINE = ('Vendors can pay for more visibility; how that works is explained in our <a href="/disclosure">disclosure</a>, '
                   'linked above every ranking. No commission is earned on clicks or purchases, and we do not work as an affiliate.')


# ---------------------------------------------------------------- logos and tool filtering

def logo_path(slug):
    for ext in ('png', 'svg', 'webp', 'jpg'):
        p = f'/images/tools/{slug}.{ext}'
        if os.path.exists(os.path.join(ROOT, p.lstrip('/'))):
            return p
    return None


def tool_logo(t, size=44, cls='logo'):
    p = logo_path(t['slug'])
    if not p:
        return ''
    return f'<img class="{cls}" src="{p}" alt="{e(t["name"])} logo" width="{size}" height="{size}" loading="lazy">'


MIN_TOOLS = 10
CATS = []
HELD = []
for c in CATS_ALL:
    keep = [t for t in c['tools'] if logo_path(t['slug'])]
    dropped = [t['name'] for t in c['tools'] if not logo_path(t['slug'])]
    if dropped:
        WARN.append(f'{c["slug"]}: no logo, left out: {", ".join(dropped)}')
    if len(keep) < MIN_TOOLS:
        HELD.append((c['slug'], len(keep)))
        continue
    c['tools'] = keep
    CATS.append(c)
ALTS_ALL, ALTS = ALTS, []
for a in ALTS_ALL:
    keep = [p for p in a['picks'] if logo_path(p['slug'])]
    if len(keep) < 6:
        HELD.append(('alternatives/' + a['slug'], len(keep)))
        continue
    a['picks'] = keep
    ALTS.append(a)
CAT_BY = {c['slug']: c for c in CATS}
for c in CATS:
    c['hub'] = c.get('hub') or next((h for h, v in HUBS.items() if c.get('group') in v['groups']), 'games')


def cap1(x):
    x = str(x)
    return x[:1].upper() + x[1:]


# ---------------------------------------------------------------- text helpers

def md(s):
    s = e(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)

    def link(m):
        text, url = m.group(1), html.unescape(m.group(2))
        if url.startswith('http'):
            return f'<a href="{e(url)}" rel="noopener" target="_blank">{text}</a>'
        if not internal_ok(url):
            return text
        return f'<a href="{e(url)}">{text}</a>'
    return re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, s)


def strip_md(s):
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', str(s))
    return s.replace('**', '')


_ABBR = ('e.g.', 'i.e.', 'vs.', 'U.S.', 'Inc.', 'Ltd.', 'approx.', 'etc.', 'No.', 'St.', 'Dr.', 'B.V.', 'Co.', 'v.', 'Corp.')


def split_sentences(text):
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9"\'(\[*])', ' '.join(str(text).split()))
    out = []
    for x in parts:
        if out and out[-1].endswith(_ABBR):
            out[-1] += ' ' + x
        else:
            out.append(x)
    return out


def chunk(text, per=2):
    s = split_sentences(text)
    return ''.join(f'<p>{md(" ".join(s[i:i + per]))}</p>' for i in range(0, len(s), per))


def paras(items, per=3):
    if isinstance(items, str):
        items = [items]
    return ''.join(chunk(p, per) for p in items if p)


def lead(text):
    s = split_sentences(text)
    if len(s) < 2:
        return f'<p>{md(text)}</p>'
    out = f'<p><strong>{md(s[0])}</strong> {md(" ".join(s[1:3]))}</p>'
    rest = s[3:]
    return out + ''.join(f'<p>{md(" ".join(rest[i:i + 2]))}</p>' for i in range(0, len(rest), 2))


def first_sentence(text):
    s = split_sentences(text)
    return s[0] if s else ''


def fmt_date(iso):
    try:
        d = datetime.date.fromisoformat(str(iso)[:10])
        return d.strftime('%B %-d, %Y')
    except Exception:
        return str(iso)


# ---------------------------------------------------------------- internal link registry

def planned_urls():
    urls = {'/', '/software', '/compare', '/alternatives', '/guides', '/research', '/news', '/glossary', '/forum', '/about', '/history',
            '/editorial-process', '/disclosure', '/partners', '/get-listed', '/contact', '/authors', '/privacy', '/terms', '/search'}
    urls |= {f'/software/{h}' for h in HUBS}
    urls |= {f'/software/{c["slug"]}' for c in CATS}
    urls |= {f'/alternatives/{a["slug"]}' for a in ALTS}
    urls |= {f'/compare/{c["slug"]}' for c in COMPARES}
    urls |= {f'/guides/{g["slug"]}' for g in GUIDES}
    urls |= {f'/research/{r["slug"]}' for r in RESEARCH}
    urls |= {f'/news/{n["slug"]}' for n in NEWS}
    urls |= {f'/authors/{a["slug"]}' for a in AUTHORS}
    urls |= {f'/forum/t/{t["id"]}' for t in SEEDS}
    urls |= {f'/forum/t/{c["slug"]}' for c in CATS}
    urls |= {f'/forum/{b}' for b in ('games', 'livestreaming', 'esports', 'general')}
    return urls


URLS = set()


def internal_ok(url):
    u = url.split('#')[0].split('?')[0].rstrip('/') or '/'
    return u in URLS


# ---------------------------------------------------------------- chrome

MARK = ('<svg class="mark" width="{s}" height="{s}" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 6H44A14 14 0 0 1 58 20V34A14 14 0 0 1 44 48H31L15 59L18 47A14 14 0 0 1 6 34V20A14 14 0 0 1 20 6Z" fill="#F2542D"/>'
        '<rect x="16" y="17" width="30" height="6" rx="3" fill="#FFF8EC"/><rect x="24" y="28" width="24" height="6" rx="3" fill="#FFC53D"/></svg>')
ICON_SEARCH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
ICON_MENU = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'


def brand(size=36):
    return (f'<a class="brand" href="/" aria-label="GA Forum home">{MARK.format(s=size)}'
            '<span class="brand__name">ga<span>forum</span></span></a>')


def jsonld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace('</', '<\\/') + '</script>'


ORG = {'@type': 'Organization', '@id': DOMAIN + '/#org', 'name': SITE['brand'], 'url': DOMAIN + '/', 'logo': DOMAIN + '/apple-touch-icon.png',
       'email': SITE['email'], 'parentOrganization': {'@type': 'Organization', 'name': SITE['company'], 'address': SITE['address']}}
TEAM_LD = {'@type': 'Organization', '@id': DOMAIN + '/authors/editorial-team#team', 'name': TEAM['name'], 'url': DOMAIN + '/authors/editorial-team'}
EDITOR_LD = {'@type': 'Person', '@id': DOMAIN + '/authors/' + EDITOR['slug'] + '#person', 'name': EDITOR['name'], 'url': DOMAIN + '/authors/' + EDITOR['slug'],
             'jobTitle': EDITOR['role'], 'sameAs': [EDITOR['linkedin']]}


def head_html(url, title, desc, noindex=False, ld='', og=None):
    full_title = title if 'GA Forum' in title else f'{title} | GA Forum'
    robots = '<meta name="robots" content="noindex, follow">' if noindex else ''
    og = og or '/images/og-default.png'
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(desc)}">
{robots}
<link rel="canonical" href="{DOMAIN}{url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="GA Forum">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{DOMAIN}{url}"><meta property="og:image" content="{DOMAIN}{og}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{DOMAIN}{og}">
<meta name="theme-color" content="#F2542D">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/css/fonts.css"><link rel="stylesheet" href="/css/style.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-YTXJ3ZS8RK"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-YTXJ3ZS8RK');</script>

{ld}
</head>'''


def header_html(active=None):
    nav = ''.join(f'<a href="{n["href"]}"{" aria-current=\"page\"" if active == n["href"] else ""}>{e(n["label"])}</a>' for n in SITE['nav'])
    mnav = ''.join(f'<a href="{n["href"]}">{e(n["label"])}</a>' for n in SITE['nav'])
    return f'''<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
<input type="checkbox" id="menu" class="menu-toggle" aria-hidden="true">
<div class="wrap">
{brand()}
<nav class="nav" aria-label="Main">{nav}</nav>
<a class="icon-btn" href="/search" aria-label="Search">{ICON_SEARCH}</a>
<label for="menu" class="icon-btn menu-btn" aria-label="Open menu">{ICON_MENU}</label>
</div>
<nav class="mobile-nav" aria-label="Mobile">{mnav}<a href="/search">Search</a></nav>
</header>
<main id="main">'''


NETWORK_LINE = '<p><a href="https://freevector.co/">FreeVector - Independent rankings of vector, design and AI image tools</a></p>\n'


def footer_html(url=None):
    hubs = ''.join(f'<li><a href="/software/{h}">{e(v["short"])}</a></li>' for h, v in HUBS.items())
    return f'''</main>
<footer class="site-foot">
<div class="wrap">
<div class="foot-grid">
<div>{brand(32)}
<p class="foot-tag">{e(SITE['tagline'])}. Rankings, head-to-head comparisons, data pages and a forum, with the sources listed.</p></div>
<div><h2>Software Reviews</h2><ul>{hubs}<li><a href="/software">All software reviews</a></li><li><a href="/alternatives">Alternatives</a></li><li><a href="/compare">Comparisons</a></li></ul></div>
<div><h2>Learn</h2><ul><li><a href="/guides">Guides</a></li><li><a href="/research">Research</a></li><li><a href="/news">News and analysis</a></li><li><a href="/glossary">Glossary</a></li><li><a href="/forum">Forum</a></li></ul></div>
<div><h2>GA Forum</h2><ul><li><a href="/about">About</a></li><li><a href="/history">History of the domain</a></li><li><a href="/editorial-process">Methodology</a></li><li><a href="/authors">Authors</a></li><li><a href="/get-listed">Get listed</a></li><li><a href="/contact">Contact</a></li></ul></div>
</div>
<div class="foot-legal">
<p>{DISCLOSURE_LINE}</p>
{NETWORK_LINE if url == '/' else ''}<p>&copy; {YEAR} GA Forum · {e(SITE['company'])} · {e(SITE['address'])} · KvK {e(SITE['kvk'])} · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/disclosure">Disclosure</a> · <a href="/llms.txt">llms.txt</a></p>
</div>
</div>
</footer>
</body>
</html>
'''


def crumbs(items):
    lis = ''.join(f'<li><a href="{u}">{e(t)}</a></li>' if u else f'<li aria-current="page">{e(t)}</li>' for t, u in items)
    ld = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': t, 'item': DOMAIN + (u or '')} for i, (t, u) in enumerate(items) if u or i == len(items) - 1]}
    return f'<nav class="crumbs wrap" aria-label="Breadcrumb"><ol>{lis}</ol></nav>', ld


def byline(reviewed=None, published=None):
    rev = f'<span>Last reviewed <time datetime="{e(reviewed)}">{fmt_date(reviewed)}</time></span>' if reviewed else ''
    pub = f'<span>Published <time datetime="{e(published)}">{fmt_date(published)}</time></span>' if published and published != reviewed else ''
    return (f'<div class="byline">{MARK.format(s=30)}<span>By <a href="/authors/editorial-team">GA Forum editorial team</a>, edited by '
            f'<a href="/authors/{EDITOR["slug"]}">{e(EDITOR["name"])}</a></span>{rev}{pub}<span><a href="/editorial-process">Methodology</a></span></div>')


def faq_block(faqs, heading='Frequently asked questions'):
    if not faqs:
        return '', None
    body = ''.join(f'<details><summary>{e(f["q"])}</summary>{chunk(f["a"], 3)}</details>' for f in faqs)
    ld = {'@context': 'https://schema.org', '@type': 'FAQPage', 'mainEntity': [
        {'@type': 'Question', 'name': f['q'], 'acceptedAnswer': {'@type': 'Answer', 'text': strip_md(f['a'])}} for f in faqs]}
    return f'<section class="faq"><h2 id="faq">{e(heading)}</h2>{body}</section>', ld


def write(url, content, title, desc, ptype, index=True):
    path = 'index.html' if url == '/' else url.strip('/') + '.html'
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(content)
    WRITTEN.add(path)
    if index:
        PAGES.append({'url': url, 'title': title, 'description': desc, 'type': ptype})


def page(url, title, desc, body, active=None, ld=None, ptype='Page', index=True, og=None):
    lds = ''.join(jsonld(x) for x in (ld or []) if x)
    write(url, head_html(url, title, desc, not index, lds, og) + header_html(active) + body + footer_html(url), title, desc, ptype, index)


def simple(url, title, desc, inner, active=None, index=True, ld=None, eyebrow='', crumb=True):
    bc, bld = crumbs([('Home', '/'), (title, None)])
    eb = f'<p class="eyebrow">{e(eyebrow)}</p>' if eyebrow else ''
    body = f'''{bc if crumb else ''}<section class="hero hero--plain"><div class="wrap narrow">{eb}<h1>{e(title)}</h1></div></section>
<div class="wrap narrow prose">{inner}</div>'''
    page(url, title, desc, body, active, [bld] + (ld or []), 'Page', index)


def tool_site(t):
    return t.get('site') or ''


def visit(t, label=None):
    s = tool_site(t)
    if not s:
        return ''
    return f'<a class="visit" href="{e(s)}" rel="nofollow noopener" target="_blank">{e(label or "Visit " + t["name"])}</a>'


def sources_list(srcs, cls='srcs'):
    items = [s for s in (srcs or []) if s.get('url')]
    if not items:
        return ''
    seen, lis = set(), ''
    for x in items:
        u = x['url']
        if u in seen:
            continue
        seen.add(u)
        lis += f'<li><a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(re.sub(r"^https?://(www\\.)?", "", u).rstrip("/")[:70])}</a></li>'
    return f'<ul class="{cls}">{lis}</ul>'


def sources_hosts(srcs):
    hosts = []
    for x in srcs or []:
        if x.get('url'):
            h = re.sub(r'^https?://(www\.)?', '', x['url']).split('/')[0]
            link = f'<a href="{e(x["url"])}" rel="nofollow noopener" target="_blank">{e(h)}</a>'
            if h not in [y[0] for y in hosts]:
                hosts.append((h, link))
    return ', '.join(l for _, l in hosts) or 'the vendor site'


def card(href, kicker, title, text, logos=''):
    return (f'<a class="card" href="{href}"><span class="card__kicker">{e(kicker)}</span><span class="card__title">{e(title)}</span>'
            f'{f"<span class=card__logos>{logos}</span>" if logos else ""}<span class="card__text">{e(text)}</span></a>')


# ---------------------------------------------------------------- lookups

TOOLS = {}
for c in CATS:
    for i, t in enumerate(c['tools']):
        TOOLS.setdefault(t['slug'], []).append((t, c, i + 1))
GUIDE_BY = {g['slug']: g for g in GUIDES}
ALT_BY = {a['slug']: a for a in ALTS}
CMP_BY = {c['slug']: c for c in COMPARES}


def cat_link(slug, label=None):
    c = CAT_BY.get(slug)
    return f'<a href="/software/{slug}">{e(label or c["title"].replace(" in 2026", ""))}</a>' if c else ''


def board_for(c):
    return HUBS[c['hub']]['board']


# ---------------------------------------------------------------- category pages

def software_ld(t, c):
    org = {'@type': 'Organization', 'name': t.get('company') or t['name']}
    if t.get('country'):
        org['address'] = {'@type': 'PostalAddress', 'addressCountry': t['country']}
    d = {'@type': 'SoftwareApplication', 'name': t['name'], 'applicationCategory': cap1(c['name']), 'description': t['summary'],
         'url': tool_site(t), 'publisher': org}
    if t.get('features'):
        d['featureList'] = ', '.join(t['features'])
    if t.get('platforms'):
        d['operatingSystem'] = t['platforms']
    return d


NOTICE_LEADS = [
    '<strong>How this list is ordered:</strong> by our editorial judgment of fit for the reader named above, based on vendor documentation, pricing and license pages opened on the review date.',
    '<strong>About the order:</strong> it reflects our own reading of each vendor\'s documentation, prices and license terms, weighed for the reader this page is written for.',
    '<strong>Why this order:</strong> we opened every vendor\'s own pages on the review date and placed the products by fit, not by popularity or payment.',
    '<strong>Ordering:</strong> editorial, based on what each vendor publishes about pricing, licensing and features as of the date above.',
]


def pick_variant(key, options):
    return options[sum(ord(c) for c in key) % len(options)]


def notice(key=''):
    return f'<p class="notice">{pick_variant(key, NOTICE_LEADS)} {DISCLOSURE_LINE}</p>'


def build_category(c):
    url = f'/software/{c["slug"]}'
    hub = HUBS[c['hub']]
    ranked = c['tools']
    bc, bld = crumbs([('Home', '/'), ('Software Reviews', '/software'), (hub['short'], f'/software/{c["hub"]}'), (c['title'], None)])
    top3 = ''.join(f'<a href="#{t["slug"]}" class="top3__item"><span class="top3__n">{i + 1}</span>{tool_logo(t, 40)}<strong>{e(t["name"])}</strong><span>{e(t["summary"])}</span></a>'
                   for i, t in enumerate(ranked[:3]))
    items = []
    for i, t in enumerate(ranked):
        feats = ', '.join(t.get('features', [])[:6])
        alt = f'<a href="/alternatives/{t["slug"]}">{e(t["name"])} alternatives</a>' if t['slug'] in ALT_BY else ''
        cmps = [cp for cp in COMPARES if t['slug'] in (cp['a'], cp['b'])]
        cmp_links = ''.join(f'<a href="/compare/{cp["slug"]}">{e(cp["a_name"])} vs {e(cp["b_name"])}</a>' for cp in cmps[:2])
        more = ' '.join(x for x in [alt, cmp_links] if x)
        plat = f'<div><dt>Platforms</dt><dd>{e(t["platforms"])}</dd></div>' if t.get('platforms') else ''
        hq = f'<div><dt>Company</dt><dd>{e(t.get("company") or t["name"])}{", " + e(t["country"]) if t.get("country") else ""}</dd></div>'
        items.append(f'''<li class="rank__item" id="{t['slug']}">
<div class="rank__top"><span class="rank__n">{i + 1}</span>{tool_logo(t, 52)}<div><h3 class="rank__name">{e(t['name'])}</h3><p class="rank__tag">{e(t['tagline'])}</p></div></div>
<p class="rank__why"><strong>Why #{i + 1}:</strong> {md(t['summary'])}</p>
<dl class="facts"><div><dt>Best for</dt><dd>{e(t['best_for'])}</dd></div><div><dt>Pricing</dt><dd>{e(t['pricing'])}</dd></div>
<div><dt>Free option</dt><dd>{e(t['free_plan'])}</dd></div>{hq}{plat}<div><dt>Key features</dt><dd>{e(feats)}</dd></div></dl>
{chunk(t['verdict'], 2)}
<div class="pc"><div><h4>Where it falls short</h4>{chunk(t['weaknesses'], 2)}</div><div><h4>Skip it if</h4>{chunk(t['wrong_for'], 2)}</div></div>
<details class="rank__src"><summary>Sources checked for {e(t['name'])}</summary>{sources_list(t.get('sources'))}</details>
<p class="rank__links">{visit(t)}{more}</p>
</li>''')
    table_rows = ''.join(f'<tr><td>{i + 1}</td><td><a href="#{t["slug"]}">{e(t["name"])}</a></td><td>{e(t["best_for"])}</td><td>{e(t["pricing_model"])}</td><td>{e(t["free_plan"])}</td><td>{e(t.get("country", ""))}</td></tr>' for i, t in enumerate(ranked))
    crit = ''.join(f'<h3>{e(x["heading"])}</h3>{lead(x["text"])}' for x in c['criteria'])
    steps = ''.join(f'<h3>{i + 1}. {e(s["title"])}</h3>{lead(s["text"])}' for i, s in enumerate(c['how_to_choose']))
    faq, fld = faq_block(c['faqs'])
    related = ''.join(f'<li>{cat_link(r)}</li>' for r in c.get('related', []) if r in CAT_BY)
    guides = [g for g in GUIDES if c['slug'] in g.get('related_categories', [])]
    research = [r for r in RESEARCH if r.get('category') == c['slug']]
    cmps = [cp for cp in COMPARES if cp.get('category') == c['slug']]
    alts = [a for a in ALTS if a.get('category') == c['slug']]
    box = lambda h, lis: f'<div class="aside-box"><h2>{h}</h2><ul>{lis}</ul></div>' if lis else ''
    aside = ''.join([
        f'<div class="aside-box aside-box--forum"><h2>Discuss this ranking</h2><p>Disagree with the order, or using one of these in production? Say so in the forum.</p><a class="btn btn--sm" href="/forum/t/{c["slug"]}">Open the thread</a></div>',
        box('Head-to-head', ''.join(f'<li><a href="/compare/{cp["slug"]}">{e(cp["a_name"])} vs {e(cp["b_name"])}</a></li>' for cp in cmps)),
        box('Alternatives', ''.join(f'<li><a href="/alternatives/{a["slug"]}">{e(a["subject"])} alternatives</a></li>' for a in alts)),
        box('Data', ''.join(f'<li><a href="/research/{r["slug"]}">{e(r["title"])}</a></li>' for r in research)),
        box('Guides', ''.join(f'<li><a href="/guides/{g["slug"]}">{e(g["title"])}</a></li>' for g in guides[:4])),
        box('Related rankings', related)])
    answer = md(f'**{ranked[0]["name"]}** comes first in our ranking of {c["name"]}, ahead of **{ranked[1]["name"]}** and **{ranked[2]["name"]}**. ' + c['summary_line'])
    body = f'''{bc}
<section class="hero hero--page"><div class="wrap">
<p class="eyebrow">{e(hub['short'])} · {len(ranked)} tools ranked</p>
<h1>{e(c['title'])}</h1>
{byline(c.get('reviewed', c['published']), c['published'])}
<p class="lede">{answer}</p>
<p class="discuss"><a href="/forum/t/{c['slug']}">Discuss this ranking in the forum</a></p>
</div></section>
<div class="wrap layout"><div class="prose">
<h2 id="top">The top three</h2>
{notice(c['slug'])}
<div class="top3">{top3}</div>
<h2 id="what">{'What is' if c['name'].lower().endswith(('software', 'middleware')) else 'What are'} {e(c['name'])}?</h2>
<p>{md(c['definition'])}</p>
<h2 id="method">How we ranked these</h2>{chunk(c['intro'], 2)}{crit}
<h2 id="table">Compared at a glance</h2>
<div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th>Best for</th><th>Pricing</th><th>Free option</th><th>Based in</th></tr></thead><tbody>{table_rows}</tbody></table></div>
<h2 id="ranking">The {len(ranked)} tools, reviewed</h2>
{notice(c['slug'] + 'xy')}
<ol class="rank">{''.join(items)}</ol>
<h2 id="market">What this list shows</h2>{paras(c['market_notes'])}
<h2 id="choose">How to choose</h2>{steps}
{faq}
<div class="discuss-box"><h2>Talk it through</h2><p>Rankings are a starting point. The <a href="/forum/t/{c['slug']}">discussion thread for this ranking</a> is open to anyone with a GA Forum account.</p></div>
</div><aside><div class="sticky">{aside}</div></aside></div>'''
    ld_list = {'@context': 'https://schema.org', '@type': 'ItemList', 'name': c['title'], 'numberOfItems': len(ranked),
               'itemListOrder': 'https://schema.org/ItemListOrderAscending', 'itemListElement': [
                   {'@type': 'ListItem', 'position': i + 1, 'url': f'{DOMAIN}{url}#{t["slug"]}', 'name': t['name'], 'item': software_ld(t, c)} for i, t in enumerate(ranked)]}
    ld_art = {'@context': 'https://schema.org', '@type': 'Article', 'headline': c['title'], 'about': cap1(c['name']), 'author': TEAM_LD, 'editor': EDITOR_LD,
              'publisher': ORG, 'datePublished': c['published'], 'dateModified': c.get('reviewed', c['published']), 'lastReviewed': c.get('reviewed', c['published']),
              'mainEntityOfPage': DOMAIN + url, 'image': DOMAIN + '/images/og-default.png'}
    page(url, c['title'], c['summary_line'], body, '/software', [bld, ld_list, ld_art, fld], 'Ranking')


def cat_card(c):
    logos = ''.join(tool_logo(t, 26, 'logo logo--xs') for t in c['tools'][:4])
    return card(f'/software/{c["slug"]}', f'{len(c["tools"])} tools', c['title'].replace(' in 2026', ''), c['summary_line'], logos)


def build_hubs():
    secs = ''
    for h, v in HUBS.items():
        cs = [c for c in CATS if c['hub'] == h]
        top = sorted(cs, key=lambda c: -len(c.get('tools') or c.get('ranked') or []))[:8]
        more = f'<p class="hub-sec__more"><a href="/software/{h}">All {e(v["short"].lower())} rankings ({len(cs)})</a></p>' if len(cs) > len(top) else ''
        secs += f'<section class="hub-sec"><div class="hub-sec__head"><h2 id="{h}"><a href="/software/{h}">{e(v["name"])}</a></h2><p>{e(v["intro"])}</p></div><div class="cards">{"".join(cat_card(c) for c in top)}</div>{more}</section>'
    bc, bld = crumbs([('Home', '/'), ('Software Reviews', None)])
    body = f'''{bc}<section class="hero hero--plain"><div class="wrap"><p class="eyebrow">{len(CATS)} rankings</p><h1>Software reviews</h1>
<p class="lede">GA Forum rankings grouped by area. Each area shows a selection here; open the area for every ranking in it. Each ranking lists 10 to 14 products, ordered by fit, with the vendor pages we checked under every entry.</p></div></section>
<div class="wrap">{secs}</div>'''
    ld = {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': 'Software rankings', 'url': DOMAIN + '/software',
          'hasPart': [{'@type': 'Article', 'headline': c['title'], 'url': f'{DOMAIN}/software/{c["slug"]}'} for c in CATS]}
    page('/software', 'Software reviews and rankings', 'All GA Forum software reviews and rankings, grouped by category and ordered by fit, with sources listed.', body, '/software', [bld, ld], 'Hub')
    for h, v in HUBS.items():
        cs = [c for c in CATS if c['hub'] == h]
        groups = {}
        for c in cs:
            groups.setdefault(c['group'], []).append(c)
        gsecs = ''.join(f'<h2>{e(g)}</h2><div class="cards">{"".join(cat_card(c) for c in lst)}</div>' for g, lst in groups.items())
        hub_cats = {c['slug'] for c in cs}
        gl = [g for g in GUIDES if set(g.get('related_categories', [])) & hub_cats]
        cm = [cp for cp in COMPARES if cp.get('category') in hub_cats]
        al = [a for a in ALTS if a.get('category') in hub_cats]
        extra = ''
        if cm:
            extra += '<h2>Head-to-head comparisons</h2><ul class="linklist">' + ''.join(f'<li><a href="/compare/{x["slug"]}">{e(x["title"])}</a></li>' for x in cm) + '</ul>'
        if al:
            extra += '<h2>Alternatives</h2><ul class="linklist">' + ''.join(f'<li><a href="/alternatives/{x["slug"]}">{e(x["subject"])} alternatives</a></li>' for x in al) + '</ul>'
        if gl:
            extra += '<h2>Guides</h2><ul class="linklist">' + ''.join(f'<li><a href="/guides/{x["slug"]}">{e(x["title"])}</a></li>' for x in gl) + '</ul>'
        bc, bld = crumbs([('Home', '/'), ('Software Reviews', '/software'), (v['short'], None)])
        legacy = ''
        if h == 'games':
            legacy = '<p class="note">Arrived from an old ga-forum.com forum link? The discussion board that once lived on this domain is gone; its story is on our <a href="/history">history page</a>.</p>'
        body = f'''{bc}<section class="hero hero--plain"><div class="wrap"><p class="eyebrow">{len(cs)} rankings</p><h1>{e(v['name'])}</h1>
<p class="lede">{e(v['intro'])}</p>{legacy}<p class="discuss"><a href="/forum/{v['board']}">Join the {e(v['short'].lower())} board in the forum</a></p></div></section>
<div class="wrap">{gsecs}{extra}</div>'''
        ld = {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': v['name'], 'url': f'{DOMAIN}/software/{h}',
              'hasPart': [{'@type': 'Article', 'headline': c['title'], 'url': f'{DOMAIN}/software/{c["slug"]}'} for c in cs]}
        page(f'/software/{h}', f'{v["name"]}: software rankings', f'{v["intro"][:150]}', body, '/software', [bld, ld], 'Hub')


# ---------------------------------------------------------------- alternatives

def build_alt(a):
    url = f'/alternatives/{a["slug"]}'
    bc, bld = crumbs([('Home', '/'), ('Alternatives', '/alternatives'), (a['title'], None)])
    picks = ''
    for i, p in enumerate(a['picks']):
        t = {'slug': p['slug'], 'name': p['name'], 'site': p.get('site')}
        rank_in = TOOLS.get(p['slug'])
        ranked = ''
        name_html = f'<a href="/software/{rank_in[0][1]["slug"]}#{p["slug"]}" class="namelink">{e(p["name"])}</a>' if rank_in else e(p['name'])
        picks += f'''<li class="rank__item" id="{p['slug']}"><div class="rank__top"><span class="rank__n">{i + 1}</span>{tool_logo(t, 48)}<div><h3 class="rank__name">{name_html}</h3><p class="rank__tag">{e(p['best_for'])}</p></div></div>
<dl class="facts"><div><dt>Free option</dt><dd>{e(p['free_plan'])}</dd></div></dl>
{chunk(p['note'], 2)}<p class="srcline">Checked on {sources_hosts(p.get('sources'))}</p><p class="rank__links">{visit(t)}</p></li>'''
    why = ''.join(f'<li>{md(x)}</li>' for x in a['why_switch'])
    faq, fld = faq_block(a.get('faqs'))
    cat = cat_link(a.get('category'))
    body = f'''{bc}<section class="hero hero--page"><div class="wrap lim"><p class="eyebrow">Alternatives · {len(a['picks'])} options</p><h1>{e(a['title'])}</h1>
{byline(a['published'])}<div class="lede">{chunk(a['intro'], 2)}</div></div></section>
<div class="wrap narrow prose">{notice(a['slug'])}
<h2>{pick_variant(a['slug'], ['Why teams look beyond', 'Reasons to leave', 'When to replace', 'What pushes teams away from'])} {e(a['subject'])}</h2><ul>{why}</ul>
<h2>{pick_variant(a['slug'] + 'p', ['The alternatives', 'The options, in order', 'Our picks', 'What to use instead'])}</h2><ol class="rank">{picks}</ol>
<h2>{pick_variant(a['slug'] + 'h', ['How to pick between them', 'Choosing among these', 'Making the call', 'Which one fits'])}</h2>{chunk(a['how_to_pick'], 2)}
{f'<p><strong>Full ranking:</strong> {cat}</p>' if cat else ''}
{faq}</div>'''
    ld_list = {'@context': 'https://schema.org', '@type': 'ItemList', 'name': a['title'], 'numberOfItems': len(a['picks']),
               'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': p['name'], 'url': p.get('site') or f'{DOMAIN}{url}#{p["slug"]}'} for i, p in enumerate(a['picks'])]}
    ld_art = {'@context': 'https://schema.org', '@type': 'Article', 'headline': a['title'], 'author': TEAM_LD, 'editor': EDITOR_LD, 'publisher': ORG,
              'datePublished': a['published'], 'dateModified': a.get('reviewed', a['published'])}
    page(url, a['title'], a['description'], body, '/software', [bld, ld_list, ld_art, fld], 'Alternatives')


def build_compare(cp):
    url = f'/compare/{cp["slug"]}'
    bc, bld = crumbs([('Home', '/'), ('Compare', '/compare'), (f'{cp["a_name"]} vs {cp["b_name"]}', None)])
    ta = {'slug': cp['a'], 'name': cp['a_name'], 'site': cp.get('a_site')}
    tb = {'slug': cp['b'], 'name': cp['b_name'], 'site': cp.get('b_site')}
    rows = ''.join(f'<tr><th scope="row">{e(r["label"])}</th><td>{md(r["a"])}</td><td>{md(r["b"])}</td></tr>' for r in cp['rows'])
    secs = ''.join(f'<h2>{e(s["h2"])}</h2>{paras(s["text"], 2)}' for s in cp['sections'])
    faq, fld = faq_block(cp.get('faqs'))
    cat = cat_link(cp.get('category'))
    body = f'''{bc}<section class="hero hero--page"><div class="wrap lim"><p class="eyebrow">Head-to-head</p><h1>{e(cp['title'])}</h1>
{byline(cp['published'])}<div class="vs">{tool_logo(ta, 56)}<span>vs</span>{tool_logo(tb, 56)}</div><div class="lede">{chunk(cp['intro'], 2)}</div></div></section>
<div class="wrap narrow prose">
<div class="verdict"><h2>The short answer</h2>{chunk(cp['verdict'], 2)}<div class="picks"><div><h3>Pick {e(cp['a_name'])} if</h3><p>{md(cp['pick_a'])}</p>{visit(ta)}</div><div><h3>Pick {e(cp['b_name'])} if</h3><p>{md(cp['pick_b'])}</p>{visit(tb)}</div></div></div>
<h2>Side by side</h2><div class="table-wrap"><table class="cmp"><thead><tr><th></th><th>{e(cp['a_name'])}</th><th>{e(cp['b_name'])}</th></tr></thead><tbody>{rows}</tbody></table></div>
{secs}
{f'<p><strong>See both in context:</strong> {cat}</p>' if cat else ''}
{faq}
<h2>Sources</h2>{sources_list(cp.get('sources'))}
<p class="note">{DISCLOSURE_LINE}</p></div>'''
    ld_art = {'@context': 'https://schema.org', '@type': 'Article', 'headline': cp['title'], 'author': TEAM_LD, 'editor': EDITOR_LD, 'publisher': ORG,
              'datePublished': cp['published'], 'dateModified': cp.get('reviewed', cp['published']),
              'about': [{'@type': 'SoftwareApplication', 'name': cp['a_name'], 'url': cp.get('a_site', '')}, {'@type': 'SoftwareApplication', 'name': cp['b_name'], 'url': cp.get('b_site', '')}]}
    page(url, cp['title'], cp['description'], body, '/compare', [bld, ld_art, fld], 'Comparison')


def list_hub(url, title, desc, intro, items, active, ptype):
    bc, bld = crumbs([('Home', '/'), (title, None)])
    body = f'''{bc}<section class="hero hero--plain"><div class="wrap"><p class="eyebrow">{len(items)} pages</p><h1>{e(title)}</h1><p class="lede">{e(intro)}</p></div></section>
<div class="wrap"><div class="cards">{''.join(items)}</div></div>'''
    page(url, title, desc, body, active, [bld], ptype)


# ---------------------------------------------------------------- guides, research, news

def build_guide(g):
    url = f'/guides/{g["slug"]}'
    bc, bld = crumbs([('Home', '/'), ('Guides', '/guides'), (g['title'], None)])
    toc = ''.join(f'<li><a href="#s{i}">{e(s["h2"])}</a></li>' for i, s in enumerate(g['sections']))
    secs = ''
    for i, s in enumerate(g['sections']):
        lst = ''
        if s.get('list'):
            tag = 'ol' if s.get('ordered') else 'ul'
            lst = f'<{tag}>' + ''.join(f'<li>{md(x)}</li>' for x in s['list']) + f'</{tag}>'
        secs += f'<h2 id="s{i}">{e(s["h2"])}</h2>{paras(s.get("paras", []), 2)}{lst}{paras(s.get("after", []), 2)}'
    kt = ''.join(f'<li>{md(x)}</li>' for x in g.get('key_takeaways', []))
    faq, fld = faq_block(g.get('faqs'))
    rel = ''.join(f'<li>{cat_link(r)}</li>' for r in g.get('related_categories', []) if r in CAT_BY)
    relg = ''.join(f'<li><a href="/guides/{x}">{e(GUIDE_BY[x]["title"])}</a></li>' for x in g.get('related_guides', []) if x in GUIDE_BY)
    srcs = ''.join(f'<li><a href="{e(s["url"])}" rel="noopener" target="_blank">{e(s["title"])}</a>, {e(s.get("publisher", ""))}</li>' for s in g.get('sources', []))
    body = f'''{bc}<section class="hero hero--page"><div class="wrap"><p class="eyebrow">{e(g.get('kind', 'Guide'))} · {e(g.get('topic', ''))}</p><h1>{e(g['title'])}</h1>
{byline(g.get('reviewed', g['published']), g['published'])}<div class="lede">{chunk(g['intro'], 2)}</div></div></section>
<div class="wrap layout"><div class="prose">
{f'<div class="takeaways"><h2>Key takeaways</h2><ul>{kt}</ul></div>' if kt else ''}
{secs}{faq}
{f'<h2>Sources</h2><ul class="srcs">{srcs}</ul>' if srcs else ''}
</div><aside><div class="sticky"><div class="aside-box"><h2>In this guide</h2><ol>{toc}</ol></div>
{f'<div class="aside-box"><h2>Related rankings</h2><ul>{rel}</ul></div>' if rel else ''}
{f'<div class="aside-box"><h2>More guides</h2><ul>{relg}</ul></div>' if relg else ''}
<div class="aside-box aside-box--forum"><h2>Questions?</h2><p>Ask the community in the <a href="/forum">GA Forum boards</a>.</p></div></div></aside></div>'''
    ld = {'@context': 'https://schema.org', '@type': 'Article', 'headline': g['title'], 'description': g['description'], 'author': TEAM_LD, 'editor': EDITOR_LD,
          'publisher': ORG, 'datePublished': g['published'], 'dateModified': g.get('reviewed', g['published']), 'mainEntityOfPage': DOMAIN + url,
          'citation': [s['url'] for s in g.get('sources', [])]}
    page(url, g['title'], g['description'], body, '/guides', [bld, ld, fld], 'Guide')


def build_research(r):
    url = f'/research/{r["slug"]}'
    bc, bld = crumbs([('Home', '/'), ('Research', '/research'), (r['title'], None)])
    secs = ''
    n = 0
    srcset = {}
    for s in r['sections']:
        facts = ''
        for f in s['facts']:
            n += 1
            srcset[f['source_url']] = f['source_name']
            facts += f'<li><span class="fact__text">{md(f["text"])}</span> <span class="fact__src">Source: <a href="{e(f["source_url"])}" rel="noopener" target="_blank">{e(f["source_name"])}</a> ({e(f.get("year", ""))}, {e(f.get("kind", ""))})</span></li>'
        secs += f'<h2>{e(s["h2"])}</h2>{paras(s.get("intro", ""), 2)}<ul class="factlist">{facts}</ul>'
    faq, fld = faq_block(r.get('faqs'))
    cat = cat_link(r.get('category'))
    srcs = ''.join(f'<li><a href="{e(u)}" rel="noopener" target="_blank">{e(nm)}</a></li>' for u, nm in srcset.items())
    body = f'''{bc}<section class="hero hero--page"><div class="wrap lim"><p class="eyebrow">Research · {n} sourced figures</p><h1>{e(r['title'])}</h1>
{byline(r.get('reviewed', r['published']), r['published'])}<div class="lede">{chunk(r['intro'], 2)}</div></div></section>
<div class="wrap narrow prose">{secs}
<h2>Methodology</h2>{paras(r.get('methodology', []), 2)}
{f'<p><strong>Related ranking:</strong> {cat}</p>' if cat else ''}
{faq}<h2>Sources</h2><ul class="srcs">{srcs}</ul></div>'''
    ld = {'@context': 'https://schema.org', '@type': 'Article', 'headline': r['title'], 'description': r['description'], 'author': TEAM_LD, 'editor': EDITOR_LD,
          'publisher': ORG, 'datePublished': r['published'], 'dateModified': r.get('reviewed', r['published']), 'citation': list(srcset.keys())}
    page(url, r['title'], r['description'], body, '/research', [bld, ld, fld], 'Research')


def build_news(nw):
    url = f'/news/{nw["slug"]}'
    bc, bld = crumbs([('Home', '/'), ('News', '/news'), (nw['title'], None)])
    rel = ''.join(f'<li>{cat_link(r)}</li>' for r in nw.get('related_categories', []) if r in CAT_BY)
    extra = ''.join(f'<li><a href="{e(s["url"])}" rel="noopener" target="_blank">{e(s["name"])}</a></li>' for s in nw.get('extra_sources', []))
    body = f'''{bc}<section class="hero hero--page"><div class="wrap lim"><p class="eyebrow">News and analysis · <time datetime="{e(nw['date'])}">{fmt_date(nw['date'])}</time></p><h1>{e(nw['title'])}</h1>
{byline(nw.get('reviewed', TODAY))}</div></section>
<div class="wrap narrow prose">{paras(nw['summary'], 2)}<h2>Why it matters</h2>{paras(nw['why_it_matters'], 2)}
<h2>Source</h2><ul class="srcs"><li><a href="{e(nw['source']['url'])}" rel="noopener" target="_blank">{e(nw['source']['name'])}</a> (primary source)</li>{extra}</ul>
{f'<h2>Related rankings</h2><ul>{rel}</ul>' if rel else ''}</div>'''
    ld = {'@context': 'https://schema.org', '@type': 'NewsArticle', 'headline': nw['title'], 'description': nw['description'], 'datePublished': nw.get('published', TODAY),
          'author': TEAM_LD, 'publisher': ORG, 'citation': nw['source']['url'], 'mainEntityOfPage': DOMAIN + url}
    page(url, nw['title'], nw['description'], body, '/news', [bld, ld], 'News')


def build_glossary():
    terms = sorted(GLOSSARY, key=lambda t: t['term'].lower())
    items = ''
    for t in terms:
        rel = f' <a href="{e(t["related"])}">Related ranking</a>' if t.get('related') and internal_ok(t['related']) else ''
        items += f'<div class="gl" id="{e(t["slug"])}"><dt>{e(t["term"])}</dt><dd>{md(t["definition"])}{rel}</dd></div>'
    ld = {'@context': 'https://schema.org', '@type': 'DefinedTermSet', 'name': 'GA Forum glossary', 'url': DOMAIN + '/glossary',
          'hasDefinedTerm': [{'@type': 'DefinedTerm', 'name': t['term'], 'description': strip_md(t['definition']), 'url': f'{DOMAIN}/glossary#{t["slug"]}'} for t in terms]}
    simple('/glossary', 'Glossary of game development, streaming and esports terms', f'{len(terms)} plain-English definitions of terms used across game development, livestreaming and esports software.',
           f'<p class="lede">{len(terms)} terms you will meet in our rankings and guides, defined in a sentence or two.</p><dl class="glossary">{items}</dl>', ld=[ld])


# ---------------------------------------------------------------- home

def featured_strip():
    if not FEATURED:
        return ''
    logos = ''.join(f'<li><img src="{e(f["file"])}" alt="{e(f["name"])}" loading="lazy" height="30"></li>' for f in FEATURED)
    return f'''<section class="featured-in" aria-label="Publications that have linked to GA Forum"><div class="wrap">
<a class="featured-in__label" href="/history">GA-Forum featured in (since 2004)</a>
<ul class="featured-in__logos">{logos}</ul></div></section>'''


def build_home():
    hub_cards = ''
    for h, v in HUBS.items():
        cs = [c for c in CATS if c['hub'] == h]
        logos = ''.join(tool_logo(t, 28, 'logo logo--xs') for c in cs[:4] for t in c['tools'][:1])
        hub_cards += f'<a class="hub-card hub-card--{h}" href="/software/{h}"><span class="hub-card__n">{len(cs)} rankings</span><span class="hub-card__t">{e(v["name"])}</span><span class="hub-card__x">{e(v["intro"])}</span><span class="card__logos">{logos}</span></a>'
    latest = sorted(CATS, key=lambda c: (c.get('reviewed', c['published']), c['slug']), reverse=True)
    pick = []
    for h in HUBS:
        pick += [c for c in latest if c['hub'] == h][:2]
    rankings = ''.join(cat_card(c) for c in pick[:6])
    guides = ''.join(card(f'/guides/{g["slug"]}', g.get('kind', 'Guide'), g['title'], g['description']) for g in GUIDES[:3])
    cmps = ''.join(f'<li><a href="/compare/{c["slug"]}">{e(c["a_name"])} vs {e(c["b_name"])}</a></li>' for c in COMPARES[:8])
    threads = ''.join(f'<li><a href="/forum/t/{t["id"]}">{e(t["title"])}</a></li>' for t in SEEDS[:6])
    ld = [{'@context': 'https://schema.org', '@type': 'WebSite', 'name': 'GA Forum', 'url': DOMAIN + '/', 'publisher': ORG,
           'potentialAction': {'@type': 'SearchAction', 'target': DOMAIN + '/search?q={query}', 'query-input': 'required name=query'}},
          {'@context': 'https://schema.org', **ORG}]
    body = f'''<section class="hero hero--home"><div class="wrap hero__grid"><div>
<p class="eyebrow">Independent software research, plus a forum</p>
<h1>Pick the right tools for your game, stream or tournament.</h1>
<p class="lede">GA Forum ranks the software behind games, livestreams and esports: {len(CATS)} rankings, {len(COMPARES)} head-to-heads and {len(GUIDES)} guides, every claim tied to the vendor page we checked. Then argue about it with people who use the tools.</p>
<div class="btn-row"><a class="btn" href="/software">Browse the rankings</a><a class="btn btn--ghost" href="/forum">Visit the forum</a></div>
</div><div class="hero__art" aria-hidden="true">{MARK.format(s=220)}</div></div></section>
{featured_strip()}
<section class="sec"><div class="wrap"><h2>Three areas, one standard</h2><div class="hub-cards">{hub_cards}</div></div></section>
<section class="sec sec--tint"><div class="wrap"><div class="sec__head"><h2>Recently reviewed rankings</h2><a href="/software">All rankings</a></div><div class="cards">{rankings}</div></div></section>
<section class="sec"><div class="wrap split"><div><div class="sec__head"><h2>Guides</h2><a href="/guides">All guides</a></div><div class="cards cards--1">{guides}</div></div>
<div><div class="sec__head"><h2>Head-to-head</h2><a href="/compare">All comparisons</a></div><ul class="linklist">{cmps}</ul>
<div class="sec__head"><h2>In the forum</h2><a href="/forum">Forum</a></div><ul class="linklist">{threads}</ul></div></div></section>
<section class="sec sec--ink"><div class="wrap narrow"><h2>How we work</h2><p>Every product on a ranking was checked on its own website, documentation or pricing page on the date shown, and those pages are listed under the entry. The order is our verdict, each product gets a written weakness, and there are no scores out of ten. {DISCLOSURE_LINE}</p><p><a href="/editorial-process">Read the methodology</a></p></div></section>'''
    page('/', 'GA Forum: independent software reviews, comparisons and forum', SITE['description'], body, None, ld, 'Home')


# ---------------------------------------------------------------- core pages

def build_core():
    simple('/about', 'About GA Forum', 'GA Forum is an independent software review site and forum. It started with software for game development, livestreaming and esports.', f'''
<p class="lede">GA Forum is an independent research site and discussion forum about the software used to make games, run livestreams and organize esports.</p>
<p>We publish rankings of 10 to 14 products per niche, head-to-head comparisons, alternatives pages, practical guides and data pages built from published sources. Each ranking names the reader it is written for, puts the products in order, and says what every product does badly. Next to the research sits a <a href="/forum">forum</a> with boards for game development tools, livestreaming and esports, where readers can push back on our order.</p>
<h2>Who it is for</h2><p>Indie and mid-size studio leads, technical directors and producers; streamers, editors and the people who build their setups; tournament organizers, team managers and broadcast crews; and company event teams who need live video that holds up.</p>
<h2>Who runs it</h2><p>GA Forum is published by {e(SITE['company'])} in Utrecht, the Netherlands. The <a href="/authors/editorial-team">editorial team</a> researches and writes the pages, with AI assistance; <a href="/authors/{EDITOR['slug']}">{e(EDITOR['name'])}</a> is the editor responsible for what appears.</p>
<h2>The domain</h2><p>ga-forum.com has a long past. From 2004 it hosted the Gaming-Age Forums, the board that grew into NeoGAF before moving to neogaf.com. GA Forum continues on the domain as a software research site and is not connected to those communities or their operators. The details, with archive links, are on the <a href="/history">history page</a>.</p>
<h2>Money</h2><p>{DISCLOSURE_LINE} Details are on the <a href="/disclosure">disclosure page</a>.</p>
<h2>Contact</h2><p>Corrections, tips and questions: <a href="/contact">contact form</a> or {e(SITE['email'])}. Vendors who want to be considered: <a href="/get-listed">get listed</a>. Sister sites from the same publisher: <a href="/partners">partners</a>.</p>''', '/about', ld=[{'@context': 'https://schema.org', '@type': 'AboutPage', 'url': DOMAIN + '/about', 'publisher': ORG}])

    A = 'https://web.archive.org/web/'
    simple('/history', 'History of ga-forum.com', 'The story of ga-forum.com: the Gaming-Age Forums from 2004, NeoGAF, the redirect years, and GA Forum today.', f'''
<p class="lede">ga-forum.com was the original home of the Gaming-Age Forums, the vBulletin board that grew into NeoGAF. Today GA Forum continues on the domain as an independent software research site with its own forum.</p>
<p class="note">GA Forum is not the former forum and has no connection to Gaming-Age, NeoGAF or their operators. No posts, threads or member data from the old board were copied. Everything below comes from public captures in the Internet Archive, linked per fact.</p>
<h2>2004: Gaming-Age Forums</h2>
<p>The oldest archived capture of ga-forum.com, from June 10, 2004, shows a vBulletin board titled "Gaming-Age Forums" under the menu of the Gaming-Age news site (news, previews, reviews, specials, cheats). It listed two forums: Gaming Discussion and Off-Topic Discussion. That day the board counted 616 threads, 13,314 posts and 1,573 members, with a record of 382 users online at once. (<a href="{A}20040610190619/http://www.ga-forum.com/" rel="noopener" target="_blank">Archive capture, June 10, 2004</a>)</p>
<h2>2005 to 2006: rapid growth as "GAF"</h2>
<p>By January 1, 2006 the page title read "GAF - powered by vBulletin" and the counters showed 77,869 threads, 2,494,938 posts and 9,152 members; the record for users online was 2,514, set on May 27, 2005. (<a href="{A}20060101044245/http://www.ga-forum.com/" rel="noopener" target="_blank">Archive capture, January 1, 2006</a>)</p>
<p>Between May and September 2005 a copy of the board also ran on new.ga-forum.com; from October 2005 that host redirected to www.ga-forum.com. (<a href="{A}20051001002842id_/http://new.ga-forum.com/" rel="noopener" target="_blank">Archive capture of the redirect</a>)</p>
<h2>2006 to 2008: the move to neogaf.com</h2>
<p>The earliest archived redirect from ga-forum.com to neogaf.com/forum is dated April 5, 2006, and later captures through 2010 show the same redirect. (<a href="{A}20060405112908id_/http://www.ga-forum.com/" rel="noopener" target="_blank">Archive capture, April 5, 2006</a>)</p>
<p>Between June and October 2008 the old domain again showed the board itself, now titled "NeoGAF - Powered by vBulletin", with forums for FAQ, Gaming Discussion and Off-Topic Discussion. On June 1, 2008 it counted 301,579 threads, 11,234,191 posts and 35,216 members, with a record of 13,071 users online on March 1, 2008. (<a href="{A}20080601224843/http://www.ga-forum.com/" rel="noopener" target="_blank">June 1, 2008</a>, <a href="{A}20081023130819/http://www.ga-forum.com/" rel="noopener" target="_blank">October 23, 2008</a>)</p>
<p>From December 17, 2008 the domain root answered with a permanent redirect to neogaf.com/forum. (<a href="{A}20081217075733/http://www.ga-forum.com/" rel="noopener" target="_blank">Archive capture, December 17, 2008</a>)</p>
<p>The page titles in these captures trace the name: "Gaming-Age Forums" in 2004, "GAF" in 2005 and 2006, "NeoGAF" in 2008.</p>
<h2>2011 to 2026: expiry, a stray blog and parking</h2>
<p>A capture from June 6, 2011 shows a registrar notice that the domain had expired on June 5, 2011. (<a href="{A}20110606162320/http://www.ga-forum.com/" rel="noopener" target="_blank">Archive capture</a>)</p>
<p>From 2013 to 2017 the domain carried an unrelated WordPress blog, first the default "Just another WordPress site" and later general lifestyle posts with no link to games. (<a href="{A}20130920042907/http://www.ga-forum.com/" rel="noopener" target="_blank">2013</a>, <a href="{A}20160512191536/http://ga-forum.com/" rel="noopener" target="_blank">2016</a>, <a href="{A}20170424150441/http://ga-forum.com/" rel="noopener" target="_blank">2017</a>) After that it was parked until 2026. (<a href="{A}20180516010455/http://ww1.ga-forum.com/" rel="noopener" target="_blank">2018 capture</a>)</p>
<h2>2026: GA Forum</h2>
<p>In November 2026 the domain came back as GA Forum: software rankings, comparisons, guides and data for game developers, streamers and esports organizers, plus a <a href="/forum">forum</a> where readers can discuss them. Old forum links (threads, member pages, archive pages) no longer exist; thread and forum links now point here, and links to member and posting pages return "not found".</p>
<p>Looking for the community that grew up here? It continued on neogaf.com, which is a separate site we are not affiliated with.</p>''', ld=[{'@context': 'https://schema.org', '@type': 'Article', 'headline': 'History of ga-forum.com', 'author': TEAM_LD, 'publisher': ORG, 'datePublished': '2026-11-18',
                                                                                     'citation': [A + '20040610190619/http://www.ga-forum.com/', A + '20060101044245/http://www.ga-forum.com/', A + '20080601224843/http://www.ga-forum.com/']}])

    simple('/editorial-process', 'Methodology and editorial process', 'How GA Forum researches, orders and updates its software rankings, comparisons and data pages.', f'''
<p class="lede">Every GA Forum ranking is built from the vendors' own pages, opened on the review date shown at the top, and the order is our verdict.</p>
<h2>1. Pick the niche and the reader</h2><p>Each ranking covers one job (for example anti-cheat for PC multiplayer games, or multistreaming for creators) and names the reader it is written for. A ranking that tries to serve everyone serves no one.</p>
<h2>2. Build the long list</h2><p>We list the products that are currently sold or maintained for that job, including open-source projects and large platforms. Products that are discontinued, parked or cannot be confirmed on a vendor page are dropped.</p>
<h2>3. Check every product at the source</h2><p>For each product we open the vendor's website, pricing page, license terms and documentation, and record what they state: who makes it, where the company is based (only when a legal or about page says so), pricing, free options, platforms and features. Those pages are listed under every entry as "Sources checked". We do not use review sites, scraped data or figures we only saw in search results.</p>
<h2>4. Order by fit</h2><p>We weigh the facts against the reader's situation: license and pricing terms at their scale, platform and engine support, setup effort, lock-in and data export, and how well the product covers the job. We do not run lab benchmarks and do not claim to; when a vendor makes a performance claim we label it as the vendor's.</p>
<h2>5. Write the weaknesses</h2><p>Every entry says where the product falls short and who should skip it. A ranking with only praise is an advertisement.</p>
<h2>6. Data pages</h2><p>Research pages only use figures from pages we opened, each with its publisher, year and a link. When a figure cannot be traced to an opened page, it is left out.</p>
<h2>7. Updates and corrections</h2><p>Rankings show a "last reviewed" date. When a vendor changes pricing or a product is discontinued, we update the page and the date. Report errors through the <a href="/contact">contact form</a>; vendors can send corrections with a link to the page that proves them.</p>
<h2>8. AI assistance</h2><p>Research and drafting are AI-assisted. The rules above apply to every page, and the editor is responsible for what is published.</p>
<h2>9. Money and independence</h2><p>{DISCLOSURE_LINE} See the <a href="/disclosure">disclosure</a>.</p>''', '/about')

    simple('/disclosure', 'Disclosure: how GA Forum makes money', 'How GA Forum is funded, what vendors can and cannot pay for, and how that relates to our rankings.', f'''
<p class="lede">{DISCLOSURE_LINE}</p>
<h2>What vendors can pay for</h2><p>Vendors can pay for more visibility on GA Forum, such as a place in a ranking where their product fits the niche, or an extra listing. Paid visibility never changes the facts we publish about a product, its listed weaknesses, or the sources under the entry, and we do not accept products that do not fit the niche.</p>
<h2>What we do not do</h2><ul><li>We do not earn commission on clicks or purchases and do not use affiliate links. Links to vendors carry rel="nofollow".</li><li>We do not sell the number one position in exchange for removing criticism.</li><li>We do not publish vendor-written text as our own.</li></ul>
<h2>The forum</h2><p>Forum posts are written by their authors, not by GA Forum. Vendors who post must say who they work for. Undisclosed promotion is removed.</p>
<h2>Questions</h2><p>Ask through the <a href="/contact">contact form</a>.</p>''', '/about')

    PARTNER_SITES = [
        ('The Knowledge Engineers', 'https://theknowledgeengineers.com/', 'An independent research institute that publishes market data and research on business technology.'),
        ('The Interregnum', 'https://theinterregnum.net/', 'Independent software rankings plus public data on the shift from conventional to AI software.'),
        ('Same Team Partners', 'https://sameteampartners.com/', 'Independent rankings, comparisons and guides on the software that runs teams: HR, communication, learning and engagement.'),
        ('MiCandidate', 'https://micandidate.eu/', 'Independent research on HR, recruiting, talent, engagement, learning and performance software.'),
        ('European Purpose', 'https://europeanpurpose.com/', 'European alternatives to US software, checked by where each vendor is established.'),
        ('FreeVector', 'https://freevector.co/', 'Independent rankings of vector, design and AI image tools.'),
        ('AI Tool Compare', 'https://aitoolcompare.ai/', 'Independent AI tool rankings, alternatives and research.'),
        ('2 Steps Ahead', 'https://2stepsahead.ai/', 'AI search visibility for B2B software vendors.'),
    ]
    partner_li = ''.join(f'<li><a href="{u}" rel="noopener" target="_blank"><strong>{e(n)}</strong></a><br><span class="muted">{e(d)}</span></li>' for n, u, d in PARTNER_SITES)
    simple('/partners', 'Partners', 'Sites published by G-Cas B.V. alongside GA Forum.', f'''
<p class="lede">The publishers and projects we work with. Links here are editorial. They are not part of any ranking and do not move a product up or down a list.</p>
<h2>Same publisher</h2><p>Sites published by {e(SITE['company'])}.</p><ul>{partner_li}</ul>
<p class="muted">Placement on this page is not for sale. How GA Forum is funded is explained in the <a href="/disclosure">disclosure</a>.</p>''', '/about')

    form_css = ''
    simple('/get-listed', 'Get your product listed', 'Vendors: ask GA Forum to consider your product for a ranking, an alternatives page or a comparison.', f'''
<p class="lede">Make a tool for game developers, streamers or esports teams? Tell us about it and we will check whether it fits one of our rankings.</p>
<p>We check every product on its own website and pricing page before it appears, so a clear product page and published pricing help. {DISCLOSURE_LINE}</p>
<form name="get-listed" method="POST" action="/thanks" data-netlify="true" netlify-honeypot="bot-field" class="form">
<input type="hidden" name="form-name" value="get-listed">
<p class="hp"><label>Leave this empty <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
<label>Your name<input name="name" required autocomplete="name"></label>
<label>Work email<input name="email" type="email" required autocomplete="email"></label>
<label>Company<input name="company" required autocomplete="organization"></label>
<label>Product website<input name="website" type="url" required placeholder="https://"></label>
<label>Which ranking or niche?<input name="category" placeholder="For example: game anti-cheat, multistreaming, tournament software"></label>
<label>Anything we should know<textarea name="message" rows="5"></textarea></label>
<button class="btn" type="submit">Send</button>
</form>''', '/about')
    simple('/contact', 'Contact GA Forum', 'Send GA Forum a correction, a tip or a question.', f'''
<p class="lede">Corrections, tips and questions are welcome. For a correction, include the page and a link to the source that shows the right information.</p>
<form name="contact" method="POST" action="/thanks" data-netlify="true" netlify-honeypot="bot-field" class="form">
<input type="hidden" name="form-name" value="contact">
<p class="hp"><label>Leave this empty <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
<label>Your name<input name="name" required autocomplete="name"></label>
<label>Email<input name="email" type="email" required autocomplete="email"></label>
<label>Company (optional)<input name="company" autocomplete="organization"></label>
<label>Message<textarea name="message" rows="6" required></textarea></label>
<button class="btn" type="submit">Send</button>
</form>
<p>Or email {e(SITE['email'])}. Postal address: {e(SITE['company'])}, {e(SITE['address'])}.</p>''', '/about')
    simple('/thanks', 'Thanks, we received your message', 'Your message reached GA Forum.', '<p class="lede">Thanks. Your message is in, and a confirmation is on its way to your inbox. We usually reply within two working days.</p><p><a href="/">Back to the homepage</a></p>', index=False)

    cards = ''
    for a in AUTHORS:
        img = f'<img src="{a["avatar"]}" alt="" width="72" height="72" class="avatar">'
        cards += f'<a class="author-card" href="/authors/{a["slug"]}">{img}<span><strong>{e(a["name"])}</strong><br>{e(a["role"])}<br><span class="muted">{e(a["short"])}</span></span></a>'
    simple('/authors', 'Authors', 'Who researches, writes and edits GA Forum.', f'<div class="authors">{cards}</div>', '/about')
    for a in AUTHORS:
        focus = ''.join(f'<li>{e(x)}</li>' for x in a.get('focus', []))
        ld = EDITOR_LD if a is EDITOR else TEAM_LD
        li = f'<p><a href="{e(a["linkedin"])}" rel="noopener me" target="_blank">LinkedIn</a></p>' if a.get('linkedin') else ''
        simple(f'/authors/{a["slug"]}', a['name'], a['short'], f'<img src="{a["avatar"]}" alt="" width="96" height="96" class="avatar"><p class="lede">{e(a["role"])}</p><p>{e(a["bio"])}</p><h2>Focus</h2><ul>{focus}</ul>{li}',
               '/about', ld=[{'@context': 'https://schema.org', **ld, 'description': a['bio']}])

    simple('/privacy', 'Privacy policy', 'How GA Forum handles personal data from the contact forms and the forum.', f'''
<p class="muted">Last updated {fmt_date(LEGAL_DATE)}</p>
<p>This policy explains what personal data GA Forum ({e(SITE['company'])}, {e(SITE['address'])}, KvK {e(SITE['kvk'])}) processes, why, and your rights under the GDPR. Contact: {e(SITE['email'])}.</p>
<h2>Reading the site</h2><p>The site sets no analytics or advertising cookies. Our host (Netlify) processes standard server logs (IP address, browser, requested page) to deliver the site and keep it secure.</p>
<h2>Contact and get-listed forms</h2><p>When you send a form we receive your name, email address, company and message. We use them to answer you and, for get-listed requests, to discuss a listing. Form messages are stored by Netlify and in our mailbox, and an automatic confirmation is sent through SendGrid (Twilio). Legal basis: your request (pre-contractual steps) and our legitimate interest in answering. We keep this correspondence for up to two years after the last contact.</p>
<h2>Forum accounts</h2><p>To post in the <a href="/forum">forum</a> you sign in with your email address. We send a one-time six-digit code to that address through SendGrid. We store:</p>
<ul><li>your email address (to sign you in and to contact you about your account or moderation; never shown publicly);</li><li>the display name you choose (public, shown with your posts);</li><li>your posts, edits and the time they were made (public unless held or removed by moderation);</li><li>reports you file on posts (visible only to moderators);</li><li>a hashed copy of each login code (deleted after it expires or is used), a session cookie, and short-lived rate-limit counters keyed to your email address and IP address to stop abuse.</li></ul>
<p>Forum data is stored in Netlify Blobs on Netlify's infrastructure. Legal basis: providing the forum you signed up for (contract) and our legitimate interest in preventing spam and abuse.</p>
<p><strong>Cookie:</strong> signing in sets one strictly necessary cookie, gaf_session (HttpOnly, Secure, 30 days), that keeps you logged in. It is not used for tracking.</p>
<p><strong>Retention:</strong> your account and posts stay until you ask us to delete them. On request we delete your account and email address; your posts are then removed or shown as written by a deleted user, at your choice.</p>
<h2>Processors</h2><p>Netlify, Inc. (hosting, forms, functions, storage) and Twilio SendGrid (email delivery). Both may process data outside the EU under the EU Standard Contractual Clauses or the EU-US Data Privacy Framework.</p>
<h2>Your rights</h2><p>You can ask for access, correction, deletion, restriction, portability, or object to processing, by emailing {e(SITE['email'])}. You may also complain to the Dutch Data Protection Authority (Autoriteit Persoonsgegevens).</p>''', index=True)
    simple('/terms', 'Terms of use', 'The terms for using GA Forum and its forum.', f'''
<p class="muted">Last updated {fmt_date(LEGAL_DATE)}</p>
<h2>The research pages</h2><p>Rankings, comparisons, guides and data pages are editorial opinion based on sources listed on each page. Vendors change products and prices; check the vendor's own page before you buy. GA Forum is not liable for decisions made based on the site.</p>
<h2>The forum</h2><ul><li>Be civil. No harassment, hate speech, doxxing or threats.</li><li>No spam, undisclosed promotion or affiliate links. Vendors must say who they work for.</li><li>Only post content you have the right to share.</li><li>Posts by new accounts that contain links are held for review. Moderators may edit, hide or remove posts and suspend accounts that break these rules.</li><li>You keep the rights to your posts and give GA Forum a non-exclusive license to show them on the site.</li></ul>
<h2>Contact</h2><p>{e(SITE['company'])}, {e(SITE['address'])}, {e(SITE['email'])}. Dutch law applies.</p>''')
    simple('/search', 'Search GA Forum', 'Search all GA Forum rankings, comparisons, guides and data pages.', '''
<form id="search-form" class="search-form" role="search"><label class="sr" for="q">Search</label><input id="q" type="search" placeholder="Try: anti-cheat, OBS, tournament" autocomplete="off"><button class="btn" type="submit">Search</button></form>
<ul id="results" class="results"></ul><script src="/js/search.js" defer></script>''', index=False)
    body = f'''<section class="hero hero--plain"><div class="wrap narrow"><p class="eyebrow">404</p><h1>That page is not here</h1>
<p class="lede">The link may be old. If it pointed to a thread or member page of the forum that used to live on this domain, that content no longer exists; see the <a href="/history">history of ga-forum.com</a>.</p>
<div class="btn-row"><a class="btn" href="/software">Browse rankings</a><a class="btn btn--ghost" href="/search">Search</a></div></div></section>'''
    write('/404', head_html('/404', 'Page not found', 'This page does not exist.', True) + header_html() + body + footer_html(), '404', '', '404', False)


# ---------------------------------------------------------------- forum export

BOARDS = [
    {'slug': 'games', 'name': 'Game development tools', 'description': 'Engines, backends, netcode, anti-cheat, QA, LiveOps and the business side of shipping games.', 'hub': '/software/games'},
    {'slug': 'livestreaming', 'name': 'Livestreaming', 'description': 'Broadcast software, overlays, bots, VTuber setups, multistreaming and live video for events.', 'hub': '/software/livestreaming'},
    {'slug': 'esports', 'name': 'Esports', 'description': 'Tournament platforms, data feeds, coaching tools, team management and broadcast production.', 'hub': '/software/esports'},
    {'slug': 'general', 'name': 'General', 'description': 'Everything else: hardware, launchers, mods, community tools and questions about this site.', 'hub': '/software'},
]

RANK_OPENERS = [
    'Our ranking of {name} puts {a} first, {b} second and {c} third, out of {n} products we checked on their own pages.',
    'Which of these do you actually run? We ranked {n} {name} and landed on {a}, then {b}, then {c}.',
    '{a} tops our list of {name}, with {b} and {c} close behind. {n} products made the cut.',
    'We went through {n} {name} and ordered them for fit: {a} at number one, {b} at two, {c} at three.',
]
RANK_ASKS = [
    'If you have shipped with one of them, what broke first, and what would you rank higher?',
    'Tell us where we got the order wrong, and what the vendor pages do not mention.',
    'What did setup really take, and did the pricing hold up once you scaled?',
    'Using something that is not on the list? Name it and say why.',
]


def seed_threads():
    out = []
    for t in SEEDS:
        body = ''.join(f'<p>{md(p)}</p>' for p in t['body'])
        out.append({'id': t['id'], 'board': t['board'], 'title': t['title'], 'created': t.get('created', TODAY + 'T09:00:00Z'), 'pinned': bool(t.get('pinned')),
                    'author': TEAM['name'], 'body_html': body, 'related': [r for r in t.get('related', []) if internal_ok(r['url'])]})
    for i, c in enumerate(CATS):
        r = c['tools']
        o = RANK_OPENERS[i % len(RANK_OPENERS)].format(name=c['name'], a=r[0]['name'], b=r[1]['name'], c=r[2]['name'], n=len(r))
        ask = RANK_ASKS[(i // len(RANK_OPENERS)) % len(RANK_ASKS)]
        body = f'<p>{e(o)}</p><p>{e(c["summary_line"])}</p><p>{e(ask)}</p>'
        out.append({'id': c['slug'], 'board': board_for(c), 'title': f'Discuss: {c["title"].replace(" in 2026", "")}', 'created': c.get('reviewed', c['published']) + 'T08:00:00Z',
                    'pinned': False, 'author': TEAM['name'], 'kind': 'ranking', 'body_html': body,
                    'related': [{'title': c['title'], 'url': f'/software/{c["slug"]}'}]})
    return out


def build_forum_export():
    lib = os.path.join(ROOT, 'netlify', 'functions', 'lib')
    os.makedirs(lib, exist_ok=True)
    seed = {'generated': TODAY, 'boards': BOARDS, 'threads': seed_threads()}
    json.dump(seed, open(os.path.join(lib, 'forum-seed.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    head = head_html('{{PATH}}', '{{TITLE}}', '{{DESC}}').replace(f'{DOMAIN}{{{{PATH}}}}', '{{CANONICAL}}')
    head = head.replace('<title>{{TITLE}} | GA Forum</title>', '<title>{{TITLE}}</title>')
    head = head.replace('\n\n<link rel="canonical"', '\n{{ROBOTS}}\n<link rel="canonical"').replace('</head>', '{{JSONLD}}\n</head>')
    shell = {'head': head + header_html('/forum').split('<main id="main">')[0].replace('<body>', '', 0)[:0] + '\n<body>',
             'header': header_html('/forum')[len('<body>'):], 'footer': footer_html()}
    # head must contain everything up to and including <body>; header starts after it
    shell['head'] = head + '\n<body>'
    open(os.path.join(lib, 'shell.mjs'), 'w', encoding='utf-8').write(
        '// Generated by scripts/build.py: the site chrome for server-rendered forum pages. Do not edit.\n'
        'export const SHELL = ' + json.dumps(shell, ensure_ascii=False, indent=1) + ';\n')
    for t in seed['threads']:
        PAGES.append({'url': f'/forum/t/{t["id"]}', 'title': t['title'], 'description': 'Forum thread', 'type': 'Forum', 'nosearch': True})
    PAGES.append({'url': '/forum', 'title': 'GA Forum community', 'description': 'Forum boards for game development tools, livestreaming and esports.', 'type': 'Forum'})
    for b in BOARDS:
        PAGES.append({'url': f'/forum/{b["slug"]}', 'title': b['name'], 'description': b['description'], 'type': 'Forum', 'nosearch': True})


# ---------------------------------------------------------------- site files

LEGACY_REDIRECTS = open(os.path.join(D, 'legacy-redirects.txt'), encoding='utf-8').read() if os.path.exists(os.path.join(D, 'legacy-redirects.txt')) else ''


def build_site_files():
    idx = [{'url': p['url'], 'title': p['title'], 'description': p['description'], 'type': p['type']} for p in PAGES if not p.get('nosearch') and p['type'] not in ('404',)]
    json.dump(idx, open(os.path.join(D, 'search-index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    urls = ''.join(f'<url><loc>{DOMAIN}{p["url"]}</loc><lastmod>{TODAY}</lastmod></url>\n' for p in PAGES if p['url'] not in ('/search',))
    open(os.path.join(ROOT, 'sitemap.xml'), 'w').write(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
    bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot']
    robots = ('User-agent: *\nAllow: /\nDisallow: /search\nDisallow: /api/\nDisallow: /forum/admin\nDisallow: /forum/account\n\n'
              + ''.join(f'User-agent: {b}\nAllow: /\nDisallow: /api/\n\n' for b in bots) + f'Sitemap: {DOMAIN}/sitemap.xml\n')
    open(os.path.join(ROOT, 'robots.txt'), 'w').write(robots)

    L = ['# GA Forum', '', f'> {SITE["description"]}', '',
         f'GA Forum ({DOMAIN}) is an independent software research site with a discussion forum. Every ranking lists the vendor pages checked under each product and shows a last-reviewed date. {strip_md(re.sub("<[^>]+>", "", DISCLOSURE_LINE))}', '']
    for h, v in HUBS.items():
        L += [f'## {v["name"]}', '']
        for c in [c for c in CATS if c['hub'] == h]:
            r = c['tools']
            L.append(f'- [{c["title"]}]({DOMAIN}/software/{c["slug"]}): {c["summary_line"]} Top three: {r[0]["name"]}, {r[1]["name"]}, {r[2]["name"]}.')
        L.append('')
    if COMPARES:
        L += ['## Comparisons', ''] + [f'- [{c["title"]}]({DOMAIN}/compare/{c["slug"]})' for c in COMPARES] + ['']
    if ALTS:
        L += ['## Alternatives', ''] + [f'- [{a["title"]}]({DOMAIN}/alternatives/{a["slug"]})' for a in ALTS] + ['']
    if GUIDES:
        L += ['## Guides', ''] + [f'- [{g["title"]}]({DOMAIN}/guides/{g["slug"]}): {g["description"]}' for g in GUIDES] + ['']
    if RESEARCH:
        L += ['## Research and statistics', ''] + [f'- [{r["title"]}]({DOMAIN}/research/{r["slug"]}): {r["description"]}' for r in RESEARCH] + ['']
    if NEWS:
        L += ['## News and analysis', ''] + [f'- [{n["title"]}]({DOMAIN}/news/{n["slug"]})' for n in NEWS] + ['']
    L += ['## About', '', f'- [Methodology]({DOMAIN}/editorial-process)', f'- [Disclosure]({DOMAIN}/disclosure)', f'- [History of the domain]({DOMAIN}/history)',
          f'- [Forum]({DOMAIN}/forum)', f'- [llms-full.txt]({DOMAIN}/llms-full.txt): every ranking as plain text', '']
    open(os.path.join(ROOT, 'llms.txt'), 'w').write('\n'.join(L))
    F = ['# GA Forum: full rankings', '', f'Source: {DOMAIN}. Generated {TODAY}. {strip_md(re.sub("<[^>]+>", "", DISCLOSURE_LINE))}', '']
    for c in CATS:
        F += [f'## {c["title"]}', f'URL: {DOMAIN}/software/{c["slug"]}', f'Last reviewed: {c.get("reviewed", c["published"])}', '', strip_md(c['definition']), '']
        for i, t in enumerate(c['tools']):
            F.append(f'{i + 1}. {t["name"]} ({t.get("site", "")}): {strip_md(t["summary"])} Pricing: {t["pricing"]} Free option: {t["free_plan"]}. Falls short: {strip_md(first_sentence(t["weaknesses"]))}')
        F.append('')
    for cp in COMPARES:
        F += [f'## {cp["title"]}', f'URL: {DOMAIN}/compare/{cp["slug"]}', strip_md(cp['verdict']), '']
    open(os.path.join(ROOT, 'llms-full.txt'), 'w').write('\n'.join(F))

    red = ['# Generated by scripts/build.py from data/legacy-redirects.txt. Netlify: first match wins.', LEGACY_REDIRECTS.strip(), '',
           '# trailing-slash and index variants of our own hubs', '/software/  /software  301', '']
    open(os.path.join(ROOT, '_redirects'), 'w').write('\n'.join(red) + '\n')


def clean_stale():
    for sub in ('software', 'alternatives', 'compare', 'guides', 'research', 'news', 'authors'):
        d = os.path.join(ROOT, sub)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            p = f'{sub}/{f}'
            if f.endswith('.html') and p not in WRITTEN:
                os.remove(os.path.join(d, f))


def main():
    global URLS
    URLS = planned_urls()
    build_home()
    build_hubs()
    for c in CATS:
        build_category(c)
    for a in ALTS:
        build_alt(a)
    list_hub('/alternatives', 'Alternatives', 'Alternatives to popular game development, streaming and esports tools.', 'Looking to replace a tool? Each page lists 6 to 12 options with what you gain and what you give up.',
             [card(f'/alternatives/{a["slug"]}', f'{len(a["picks"])} options', a['title'], a['description']) for a in sorted(ALTS, key=lambda a: a['subject'].lower())], '/software', 'Hub')
    for cp in COMPARES:
        build_compare(cp)
    list_hub('/compare', 'Comparisons', 'Head-to-head comparisons of game development, streaming and esports software.', 'Two tools, one table, a short answer and the sources behind it.',
             [card(f'/compare/{c["slug"]}', 'Head-to-head', c['title'], c['description']) for c in COMPARES], '/compare', 'Hub')
    for g in GUIDES:
        build_guide(g)
    list_hub('/guides', 'Guides', 'Practical guides for choosing and running software, with sources listed.', 'Playbooks, checklists and field guides for the decisions behind the software.',
             [card(f'/guides/{g["slug"]}', g.get('kind', 'Guide'), g['title'], g['description']) for g in GUIDES], '/guides', 'Hub')
    for r in RESEARCH:
        build_research(r)
    list_hub('/research', 'Research and statistics', 'Sourced statistics on games, livestreaming and esports.', 'Data pages built only from figures we could trace to an opened source, each linked.',
             [card(f'/research/{r["slug"]}', 'Research', r['title'], r['description']) for r in RESEARCH], '/research', 'Hub')
    for n in NEWS:
        build_news(n)
    list_hub('/news', 'News and analysis', 'News and analysis on tools for games, livestreaming and esports.', 'Short analysis of platform and vendor changes, always from the primary source.',
             [card(f'/news/{n["slug"]}', fmt_date(n['date']), n['title'], n['description']) for n in NEWS], '/news', 'Hub')
    build_glossary()
    build_core()
    build_forum_export()
    build_site_files()
    clean_stale()
    for w in WARN:
        print('WARN', w)
    for s, n in HELD:
        print(f'HELD {s}: only {n} tools with logo')
    print(f'Built {len(PAGES)} indexable URLs ({len(CATS)} rankings, {len(ALTS)} alternatives, {len(COMPARES)} comparisons, {len(GUIDES)} guides, {len(RESEARCH)} research, {len(NEWS)} news).')


if __name__ == '__main__':
    main()
