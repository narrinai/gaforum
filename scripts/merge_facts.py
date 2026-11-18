#!/usr/bin/env python3
"""Merge the vendor fact files (data/facts/batch_*.json, rerun_*.json, extra_*.json) into data/facts/index.json.

A verified record beats a dropped one; between two verified records the one with more facts wins.
    python3 scripts/merge_facts.py
"""
import glob, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
F = os.path.join(ROOT, 'data', 'facts')
idx = {}
for p in sorted(glob.glob(os.path.join(F, '*.json'))):
    if os.path.basename(p) == 'index.json':
        continue
    try:
        rows = json.load(open(p, encoding='utf-8'))
    except Exception as ex:
        print('BAD JSON', p, ex)
        continue
    for r in rows:
        s = r.get('slug')
        if not s:
            continue
        old = idx.get(s)
        score = (r.get('status') == 'verified', len(r.get('facts') or []), bool(r.get('pricing')), bool(r.get('company')))
        if not old or score > old[0]:
            idx[s] = (score, r)
out = {s: r for s, (_, r) in sorted(idx.items())}
json.dump(out, open(os.path.join(F, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ver = sum(1 for r in out.values() if r.get('status') == 'verified')
print(f'{len(out)} tools, {ver} verified, {len(out) - ver} dropped')
