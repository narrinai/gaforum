#!/usr/bin/env python3
"""
Tells IndexNow (Bing, Yandex, Seznam, Naver; through Bing also ChatGPT Search)
which pages are new or changed. Works without arguments.

    python3 scripts/indexnow.py            # only what changed since the last submission
    python3 scripts/indexnow.py --all      # the whole sitemap
    python3 scripts/indexnow.py --dry-run  # show what would be submitted

Run it AFTER the deploy: IndexNow fetches the key and the pages live. The script
checks first that the key file is live. State (url -> lastmod) is kept in
data/indexnow.json; a URL is submitted again when its <lastmod> moves, and a URL
that left the sitemap is submitted once more so the engine drops it.
"""
import glob, json, os, re, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOMAIN = 'https://ga-forum.com'
HOST = DOMAIN.split('//', 1)[1]
KEY_DIRS = ['.']
SITEMAP_FILES = ['sitemap.xml', 'https://ga-forum.com/sitemap.xml']
STATE = os.path.join(ROOT, 'data', 'indexnow.json')
ENDPOINT = 'https://api.indexnow.org/indexnow'
BATCH = 10000


def find_key():
    for d in KEY_DIRS:
        for f in glob.glob(os.path.join(ROOT, d, '*.txt')):
            name = os.path.basename(f)[:-4]
            if re.fullmatch(r'[0-9a-f]{32}', name) and open(f).read().strip() == name:
                return name
    sys.exit('No IndexNow key file (<32 hex>.txt containing its own name) found.')


KEY = find_key()
KEY_URL = f'{DOMAIN}/{KEY}.txt'


def read(src):
    if src.startswith('http'):
        with urllib.request.urlopen(src, timeout=30) as r:
            return r.read().decode()
    return open(os.path.join(ROOT, src)).read()


def entries(xml):
    return re.findall(r'<loc>\s*([^<\s]+)\s*</loc>(?:\s*<lastmod>\s*([^<\s]*)\s*</lastmod>)?', xml)


def sitemap():
    xml = None
    for s in SITEMAP_FILES:
        try:
            xml = read(s)
            break
        except (OSError, urllib.error.URLError):
            continue
    if xml is None:
        sys.exit('No sitemap found.')
    out = {}
    if '<sitemapindex' in xml:
        for child, _ in entries(xml):
            if child.endswith('sitemap-recent.xml'):
                continue
            name = child.rsplit('/', 1)[-1]
            try:
                sub = read(name) if os.path.exists(os.path.join(ROOT, name)) else read(child)
            except (OSError, urllib.error.URLError):
                sub = read(child)
            out.update({u: d for u, d in entries(sub)})
    else:
        out.update({u: d for u, d in entries(xml)})
    return out


def key_is_live():
    try:
        with urllib.request.urlopen(KEY_URL, timeout=20) as r:
            return r.status == 200 and r.read().decode().strip() == KEY
    except urllib.error.URLError:
        return False


def main():
    urls = sitemap()
    sent = json.load(open(STATE)) if os.path.exists(STATE) else {}
    changed = sorted(urls) if '--all' in sys.argv else sorted(u for u, d in urls.items() if sent.get(u) != d)
    removed = sorted(u for u in sent if u not in urls)
    todo = changed + removed
    if not todo:
        print('nothing new to submit')
        return
    print(f'{len(changed)} new or changed, {len(removed)} removed, of {len(urls)} in the sitemap')
    if '--dry-run' in sys.argv:
        print('\n'.join(todo[:50]) + ('\n...' if len(todo) > 50 else ''))
        return
    if not key_is_live():
        sys.exit(f'{KEY_URL} is not live yet -- deploy first')
    for i in range(0, len(todo), BATCH):
        body = json.dumps({'host': HOST, 'key': KEY, 'keyLocation': KEY_URL,
                           'urlList': todo[i:i + BATCH]}).encode()
        req = urllib.request.Request(ENDPOINT, data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f'IndexNow: {r.status}')  # 200 received, 202 received and key being checked
        except urllib.error.HTTPError as e:
            sys.exit(f'IndexNow refused: {e.code} {e.read().decode(errors="replace")[:200]}')
    sent.update({u: urls[u] for u in changed})
    sent = {u: d for u, d in sorted(sent.items()) if u in urls}
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, 'w') as f:
        json.dump(sent, f, indent=1)
        f.write('\n')
    print(f'{os.path.relpath(STATE, ROOT)} updated')


if __name__ == '__main__':
    main()
