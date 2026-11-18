#!/usr/bin/env python3
"""Compare GA Forum pages with similar pages on the sister sites (TKE, TI, ATC, EP, STP), so no page is a near copy.

Looks for sister HTML files whose path contains a gaming/streaming keyword and reports, per GA Forum ranking,
alternatives and comparison page, the highest share of its 6-word sequences found on one sister page.

    python3 scripts/check_sister_overlap.py            # gate 15%
    python3 scripts/check_sister_overlap.py --max 10
Sister repos are read from ~/Documents/<repo> (skipped when absent).
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.expanduser('~/Documents')
SISTERS = ['theknowledgeengineers', 'theinterregnum', 'aitoolcompare', 'europeanpurpose', 'sameteampartners']
KEYS = re.compile(r'game|stream|esport|video|webinar|virtual-event|event-|discord|obs|unity|twitch|vmix|wirecast|restream|on24|wowza|mux|'
                  r'community|forum|chat|anti-cheat|ddos|localiz|translat|caption|transcri|version-control|ci-cd|playtest|user-testing|'
                  r'influencer|creator|moderation|benchmark|monitor|launcher|mod-|voice|vtuber|overlay|clip|record|capture|analytics|attribution|'
                  r'ad-network|mediation|payment|support|help-desk|backend|server|cdn|remote', re.I)
N = 6


def text_of(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    m = re.search(r'<main[^>]*>(.*)</main>', s, re.S)
    s = m.group(1) if m else s
    s = re.sub(r'<(script|style|svg)[^>]*>.*?</\1>', ' ', s, flags=re.S)
    return re.sub(r'<[^>]+>|&[a-z#0-9]+;', ' ', s)


def shingles(t):
    w = re.findall(r'[a-z0-9]+', t.lower())
    return {' '.join(w[i:i + N]) for i in range(len(w) - N + 1)}


def main():
    limit = float(sys.argv[sys.argv.index('--max') + 1]) if '--max' in sys.argv else 15.0
    index = {}
    nfiles = 0
    for repo in SISTERS:
        base = os.path.join(HOME, repo)
        if not os.path.isdir(base):
            continue
        for p in glob.glob(os.path.join(base, '**', '*.html'), recursive=True):
            rel = os.path.relpath(p, base)
            if 'node_modules' in rel or rel.startswith(('.', 'dist/')) or not KEYS.search(rel):
                continue
            nfiles += 1
            key = f'{repo}/{rel}'
            for sh in shingles(text_of(p)):
                index.setdefault(sh, []).append(key)
    # boilerplate shared by many sister pages is not a copy signal
    common = {sh for sh, v in index.items() if len(v) > 25}
    worst, bad = 0.0, []
    pages = [p for d in ('software', 'alternatives', 'compare') for p in glob.glob(os.path.join(ROOT, d, '*.html'))]
    for p in sorted(pages):
        sh = shingles(text_of(p)) - common
        if not sh:
            continue
        counts = {}
        for s in sh:
            for k in index.get(s, ()):
                counts[k] = counts.get(k, 0) + 1
        if not counts:
            continue
        k, n = max(counts.items(), key=lambda x: x[1])
        pct = 100 * n / len(sh)
        worst = max(worst, pct)
        if pct > limit:
            bad.append((pct, os.path.relpath(p, ROOT), k))
    print(f'{len(pages)} GA Forum pages vs {nfiles} sister pages: worst {worst:.1f}%')
    for pct, a, k in sorted(bad, reverse=True):
        print(f'  {pct:5.1f}%  {a}  ~  {k}')
    sys.exit(1 if bad else 0)


main()
