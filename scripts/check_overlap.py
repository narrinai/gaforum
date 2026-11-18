#!/usr/bin/env python3
"""
Measures how much text two category pages share, so no page reads like a
template of another. For each pair of pages it counts the share of one page's
6-word sequences (shingles) that also occur on the other page, and reports the
worst pair per page.

    python3 scripts/check_overlap.py           # the prose in data/categories/*.json
    python3 scripts/check_overlap.py --html    # the rendered <main> of each category page
    python3 scripts/check_overlap.py --max 8   # exit non-zero if any pair exceeds 8%
    python3 scripts/check_overlap.py --all     # every page type, gate at 15% (same-type pages stay under 15%)
    python3 scripts/check_overlap.py --all --list   # also print every pair above the limit
    python3 scripts/check_overlap.py --show crm-software help-desk-software  # print the shared phrases
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 6


def prose(c):
    parts = [c.get('intro', ''), c.get('definition', ''), c.get('summary_line', '')]
    parts += [x['heading'] + '. ' + x['text'] for x in c.get('criteria', [])] + c.get('market_notes', [])
    parts += [x['title'] + '. ' + x['text'] for x in c.get('how_to_choose', [])]
    parts += [f['q'] + ' ' + f['a'] for f in c.get('faqs', [])]
    for t in c.get('tools', []):
        parts += [t.get(k, '') for k in ('summary', 'tagline', 'verdict', 'weaknesses', 'wrong_for', 'best_for')]
    return ' '.join(parts)


def html_text(slug):
    s = open(os.path.join(ROOT, 'software', slug + '.html')).read()
    s = s.split('<main id="main">', 1)[1].split('</main>', 1)[0]
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'&[a-z]+;|&#\d+;', ' ', s)


def shingles(text):
    w = re.findall(r"[a-z0-9]+", text.lower())
    return {' '.join(w[i:i + N]) for i in range(len(w) - N + 1)}


SKIP = {'slug', 'url', 'source_url', 'source_name', 'image_query', 'image_alt', 'site', 'a', 'b', 'category', 'published', 'updated', 'date',
        'kind', 'year', 'icon', 'group', 'old_paths', 'related', 'related_guides', 'related_categories', 'related_tools', 'picks', 'sources', 'source',
        'keyword', 'topic', 'publisher', 'tags', 'features', 'label', 'volume', 'country', 'major', 'free_plan', 'pricing_model',
        'fact', 'a_name', 'b_name', 'a_site', 'b_site', 'subject', 'subject_site', 'name', 'title', 'company', 'hub', 'reviewed', 'extra_sources', 'platforms'}


def flat(o, key=None):
    """Every prose string of a data file, without slugs, urls, dates and other non-prose keys."""
    if isinstance(o, dict):
        return ' '.join(flat(v, k) for k, v in o.items() if k not in SKIP)
    if isinstance(o, list):
        return ' '.join(flat(v, key) for v in o)
    return o if isinstance(o, str) else ''


def load_type(name):
    """{page id: prose} for one page type."""
    out = {}
    if name == 'categories':
        d = os.path.join(ROOT, 'data', 'categories')
        for f in sorted(os.listdir(d)):
            if f.endswith('.json'):
                out[f[:-5]] = prose(json.load(open(os.path.join(d, f))))
    elif name == 'tools':
        d = os.path.join(ROOT, 'data', 'categories')
        for f in sorted(os.listdir(d)):
            if f.endswith('.json'):
                for t in json.load(open(os.path.join(d, f))).get('tools', []):
                    out.setdefault(t['slug'], ' '.join(t.get(k, '') for k in ('summary', 'verdict', 'weaknesses', 'wrong_for')))
    else:
        d = os.path.join(ROOT, 'data', name)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith('.json'):
                    out[f[:-5]] = flat(json.load(open(os.path.join(d, f))))
    return {k: v for k, v in out.items() if v.strip()}


def pair_report(texts, limit, show_pairs=False):
    sh = {s: shingles(t) for s, t in texts.items()}
    worst, rows, over = 0.0, [], []
    for a in sh:
        best, other = 0.0, ''
        for b in sh:
            if a == b or not sh[a]:
                continue
            pct = 100 * len(sh[a] & sh[b]) / len(sh[a])
            if pct > best:
                best, other = pct, b
            if limit is not None and pct > limit:
                over.append((pct, a, b))
        rows.append((best, a, other))
        worst = max(worst, best)
    return worst, sorted(rows, reverse=True), sorted(over, reverse=True)


def run_all(limit, show_pairs):
    bad = False
    for name in ('categories', 'tools', 'guides', 'research', 'comparisons', 'alternatives', 'news'):
        texts = load_type(name)
        if len(texts) < 2:
            print(f'{name:<13} {len(texts)} page(s), nothing to compare')
            continue
        worst, rows, over = pair_report(texts, limit)
        flag = 'FAIL' if over else 'ok'
        print(f'{name:<13} {len(texts):>3} pages  worst {worst:5.1f}%  ({rows[0][1]} vs {rows[0][2]})  {flag}')
        if over:
            bad = True
            for pct, a, b in (over if show_pairs else over[:5]):
                print(f'     {pct:5.1f}%  {a}  ~  {b}')
    print(f'\nLimit: {limit}% of one page\'s {N}-word sequences found on another page of the same type.')
    return bad


def main():
    args = sys.argv[1:]
    if '--all' in args:
        limit = float(args[args.index('--max') + 1]) if '--max' in args else 15.0
        sys.exit(1 if run_all(limit, '--list' in args) else 0)
    use_html = '--html' in args
    limit = float(args[args.index('--max') + 1]) if '--max' in args else None
    d = os.path.join(ROOT, 'data', 'categories')
    cats = {f[:-5]: json.load(open(os.path.join(d, f))) for f in sorted(os.listdir(d)) if f.endswith('.json')}
    texts = {s: (html_text(s) if use_html else prose(c)) for s, c in cats.items()}
    sh = {s: shingles(t) for s, t in texts.items()}

    if '--show' in args:
        a, b = args[args.index('--show') + 1: args.index('--show') + 3]
        for x in sorted(sh[a] & sh[b]):
            print(x)
        return

    worst_overall = 0
    rows = []
    for a in sh:
        best, other = 0.0, ''
        for b in sh:
            if a == b or not sh[a]:
                continue
            pct = 100 * len(sh[a] & sh[b]) / len(sh[a])
            if pct > best:
                best, other = pct, b
        rows.append((best, a, other))
        worst_overall = max(worst_overall, best)
    for best, a, other in sorted(rows, reverse=True):
        print(f'{a:<40} {best:5.1f}%  (closest: {other})')
    print(f'\nWorst pair: {worst_overall:.1f}% of one page\'s {N}-word sequences found on another page.')
    if limit is not None and worst_overall > limit:
        sys.exit(1)


if __name__ == '__main__':
    main()
