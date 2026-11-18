#!/usr/bin/env python3
"""Crawl every generated HTML file: 0 broken internal links, 0 orphan pages, or exit 1."""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {'404.html', 'thanks.html', 'search.html'}
files = [os.path.relpath(f, ROOT) for f in glob.glob(os.path.join(ROOT, '**', '*.html'), recursive=True)
         if '/node_modules/' not in f and '/.netlify/' not in f]
def url_of(f): return '/' if f == 'index.html' else '/' + f[:-5]
pages = {url_of(f): f for f in files}
import json
seed = json.load(open(os.path.join(ROOT, 'netlify/functions/lib/forum-seed.json')))
FORUM = {'/forum', '/forum/admin', '/forum/account'} | {'/forum/' + b['slug'] for b in seed['boards']} | {'/forum/t/' + t['id'] for t in seed['threads']}
inbound = {u: 0 for u in pages}
broken = []
for f in files:
    html = open(os.path.join(ROOT, f), encoding='utf-8').read()
    for href in re.findall(r'href="(/[^"#?]*)', html):
        if href.startswith(('/css/', '/fonts/', '/images/', '/js/', '/data/')) or href.endswith(('.svg', '.ico', '.png', '.xml', '.txt', '.webmanifest')):
            if not os.path.exists(os.path.join(ROOT, href.lstrip('/'))): broken.append((f, href))
            continue
        u = href.rstrip('/') or '/'
        if u in FORUM:
            continue
        if u in pages:
            if url_of(f) != u: inbound[u] += 1
        else:
            broken.append((f, href))
orphans = [u for u, n in inbound.items() if n == 0 and pages[u] not in SKIP and u != '/']
for f, h in broken: print('BROKEN', f, '->', h)
for u in orphans: print('ORPHAN', u)
print(f'{len(files)} pages, {len(broken)} broken, {len(orphans)} orphans')
sys.exit(1 if broken or orphans else 0)
