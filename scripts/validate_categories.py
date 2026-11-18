#!/usr/bin/env python3
"""Validate category files against data/CATEGORY_BRIEF.md.

    python3 scripts/validate_categories.py            # all files
    python3 scripts/validate_categories.py <slug> ... # some files
Prints OK or the problems per file; exit 1 if any file fails.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CD = os.path.join(ROOT, 'data', 'categories')
FACTS = json.load(open(os.path.join(ROOT, 'data', 'facts', 'index.json'), encoding='utf-8')) if os.path.exists(os.path.join(ROOT, 'data', 'facts', 'index.json')) else {}
EXTRA = os.path.join(ROOT, 'data', 'facts')
BANNED = ['robust', 'seamless', 'cutting-edge', 'game-changer', 'game changer', 'revolutioniz', 'unleash', 'supercharge', 'best-in-class', "in today's", 'dive in', 'level up your', 'look no further', 'top 10', 'top ten', 'we tested', 'our testing', 'in our tests']
RIVALS = ['Lattice', 'Leapsome', 'Dialog', 'Welder', 'Learned', 'Flip', 'Staffbase', 'Blink', 'Beekeeper', 'Microsoft Viva']
HUBS = {'games', 'livestreaming', 'esports'}


def words(s):
    return len(re.findall(r"[A-Za-z0-9']+", s))


def all_text(o):
    if isinstance(o, dict):
        return ' '.join(all_text(v) for k, v in o.items() if k not in ('url', 'site', 'slug'))
    if isinstance(o, list):
        return ' '.join(all_text(v) for v in o)
    return o if isinstance(o, str) else ''


def check(slug):
    p = os.path.join(CD, slug + '.json')
    errs = []
    try:
        c = json.load(open(p, encoding='utf-8'))
    except Exception as ex:
        return [f'bad JSON: {ex}']
    for k in ('slug', 'name', 'title', 'group', 'hub', 'published', 'reviewed', 'summary_line', 'definition', 'intro', 'criteria', 'market_notes', 'how_to_choose', 'faqs', 'related', 'tools'):
        if k not in c:
            errs.append(f'missing {k}')
    if errs:
        return errs
    if c['slug'] != slug:
        errs.append('slug mismatch')
    if c['hub'] not in HUBS:
        errs.append('bad hub')
    if not re.match(r'^Best .+ in 2026$', c['title']) and not re.match(r'^Best .+ (for|in) .+2026$', c['title']):
        errs.append('title must be "Best ... in 2026"')
    if len(c['criteria']) != 4:
        errs.append(f'criteria {len(c["criteria"])} (need 4)')
    if len(c['how_to_choose']) != 3:
        errs.append('how_to_choose must be 3')
    if len(c['faqs']) < 6:
        errs.append('need 7 faqs')
    n = len(c['tools'])
    if not 10 <= n <= 14:
        errs.append(f'{n} tools (need 10-14)')
    seen = set()
    for t in c['tools']:
        s = t.get('slug', '?')
        if s in seen:
            errs.append(f'duplicate tool {s}')
        seen.add(s)
        for k in ('name', 'site', 'tagline', 'best_for', 'pricing', 'pricing_model', 'free_plan', 'features', 'summary', 'verdict', 'weaknesses', 'wrong_for', 'sources'):
            if not t.get(k) and k not in ('pricing_model',):
                errs.append(f'{s}: missing {k}')
        f = FACTS.get(s)
        if not f:
            errs.append(f'{s}: no fact record in data/facts (add an extra_*.json record for tools you researched)')
        elif f.get('status') != 'verified':
            errs.append(f'{s}: fact record is not verified ({f.get("drop_reason", "")[:60]})')
        srcs = t.get('sources') or []
        if len(srcs) < 2:
            errs.append(f'{s}: needs 2+ sources')
        if f:
            known = {x.get('url', '').rstrip('/') for x in f.get('facts', [])} | {f.get('site', '').rstrip('/')}
            for x in srcs:
                if x.get('url', '').rstrip('/') not in known:
                    errs.append(f'{s}: source url not in its fact record: {x.get("url")}')
        if words(t.get('verdict', '')) < 45:
            errs.append(f'{s}: verdict too short')
        if words(t.get('weaknesses', '')) < 20:
            errs.append(f'{s}: weaknesses too short')
    txt = all_text(c)
    low = txt.lower()
    if '—' in txt or ' – ' in txt:
        errs.append('em/en dash found')
    for b in BANNED:
        if b in low:
            errs.append(f'banned phrase: {b}')
    for r in RIVALS:
        if re.search(r'\b' + re.escape(r) + r'\b', txt):
            errs.append(f'banned vendor name: {r}')
    if '!' in txt:
        errs.append('exclamation mark')
    total = words(txt)
    if total < 2300:
        errs.append(f'only {total} words (need 2,300+)')
    return errs


def main():
    slugs = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(CD) if f.endswith('.json'))
    bad = 0
    for s in slugs:
        errs = check(s)
        if errs:
            bad += 1
            print(f'{s}: FAIL')
            for x in errs[:25]:
                print('   ', x)
        else:
            print(f'{s}: OK')
    sys.exit(1 if bad else 0)


main()
