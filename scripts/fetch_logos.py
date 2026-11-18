#!/usr/bin/env python3
"""Tool-logo pipeline: sister-site copies first, then fetch from the vendor site.

    python3 scripts/fetch_logos.py                 # all verified slugs in data/facts/index.json without a file
    python3 scripts/fetch_logos.py --header slug.. # retry given slugs with header-logo candidates (img/inline svg)
    python3 scripts/fetch_logos.py --sheets        # only (re)build contact sheets

Writes images/tools/<slug>.png (128x128) or .svg, and data/logo-review.json (slug -> source_url, method).
Slugs listed in data/logo-review.json under "dropped" (rejected after visual review) are skipped on reruns.
"""
import io, json, os, re, shutil, sys, urllib.request, urllib.parse, ssl
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'images', 'tools')
REVIEW = os.path.join(ROOT, 'data', 'logo-review.json')
SCRATCH = '/private/tmp/claude-501/-Users-sebastiaansmits-Documents-europeanpurpose/50ccc031-f8ba-4c2c-b848-796b01078711/scratchpad/gaforum'
LOGOMAP = SCRATCH + '/plan/logo-map.json'
SHEETS = SCRATCH + '/logos'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, timeout=15, maxb=6_000_000):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en'})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        data = r.read(maxb)
        return data, r.geturl(), r.headers.get('Content-Type', '')


class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self.metas, self.imgs, self.svgs = [], {}, [], []
        self._svg = None
        self._depth = 0
        self.inheader = 0

    def handle_starttag(self, tag, a):
        a = {k: (v or '') for k, v in a}
        if tag in ('header', 'nav'):
            self.inheader += 1
        if tag == 'link' and a.get('href'):
            self.links.append(a)
        elif tag == 'meta':
            k = a.get('property') or a.get('name')
            if k:
                self.metas[k.lower()] = a.get('content', '')
        elif tag == 'img':
            blob = ' '.join([a.get('class', ''), a.get('alt', ''), a.get('id', ''), a.get('src', '')]).lower()
            if 'logo' in blob and (a.get('src') or a.get('data-src')):
                self.imgs.append((a.get('src') or a.get('data-src'), self.inheader > 0))
        elif tag == 'svg':
            if self._svg is None:
                blob = ' '.join([a.get('class', ''), a.get('id', ''), a.get('aria-label', '')]).lower()
                if 'logo' in blob:
                    self._svg = [self.get_starttag_text()]
                    self._depth = 1
                return
            self._depth += 1
        if self._svg is not None and tag != 'svg':
            self._svg.append(self.get_starttag_text())

    def handle_endtag(self, tag):
        if tag in ('header', 'nav') and self.inheader:
            self.inheader -= 1
        if self._svg is not None:
            self._svg.append('</%s>' % tag)
            if tag == 'svg':
                self._depth -= 1
                if self._depth == 0:
                    self.svgs.append(''.join(self._svg))
                    self._svg = None

    def handle_data(self, d):
        if self._svg is not None:
            self._svg.append(d)


def size_key(s):
    m = re.match(r'(\d+)', s or '')
    return int(m.group(1)) if m else 0


def candidates(site, header=False):
    """Return list of (method, url_or_svgtext)."""
    html, final, _ = get(site)
    txt = html.decode('utf-8', 'replace')
    p = P()
    try:
        p.feed(txt)
    except Exception:
        pass
    base = final
    c = []
    j = lambda u: urllib.parse.urljoin(base, u)
    ats = [l for l in p.links if 'apple-touch-icon' in l.get('rel', '').lower()]
    ats.sort(key=lambda l: -size_key(l.get('sizes')))
    c += [('apple-touch-icon', j(l['href'])) for l in ats]
    icons = [l for l in p.links if l.get('rel', '').lower().split() and 'icon' in l.get('rel', '').lower().split() or l.get('rel', '').lower() in ('shortcut icon', 'icon')]
    icons = [l for l in icons if 'apple' not in l.get('rel', '').lower()]
    good = [l for l in icons if size_key(l.get('sizes')) >= 96 or l['href'].split('?')[0].lower().endswith('.svg') or 'svg' in l.get('type', '')]
    good.sort(key=lambda l: -size_key(l.get('sizes')))
    c += [('link-icon', j(l['href'])) for l in good]
    for l in p.links:
        if l.get('rel', '').lower() == 'manifest':
            try:
                md, mf, _ = get(j(l['href']))
                mj = json.loads(md.decode('utf-8', 'replace'))
                ic = sorted(mj.get('icons', []), key=lambda i: -size_key(i.get('sizes', '').split(' ')[-1]))
                c += [('manifest', urllib.parse.urljoin(mf, i['src'])) for i in ic if i.get('src')]
            except Exception:
                pass
    c.append(('__hint__', None))
    og = p.metas.get('og:image')
    if og:
        c.append(('og:image', j(og)))
    c.append(('root-apple-touch', urllib.parse.urljoin(base, '/apple-touch-icon.png')))
    if header:
        c = []
        for s in p.svgs:
            c.append(('inline-svg', s))
        for src, inh in sorted(p.imgs, key=lambda x: not x[1]):
            c.append(('header-img', j(src)))
    return c


def clean_svg(data):
    t = data.decode('utf-8', 'replace') if isinstance(data, bytes) else data
    if not re.search(r'<svg\b', t, re.I):
        return None
    if re.search(r'<script|javascript:|on\w+\s*=|<foreignObject|<image\b|<!ENTITY', t, re.I):
        return None
    if re.search(r'(?:href|src)\s*=\s*["\'](?!#)', t, re.I) or re.search(r'url\(\s*["\']?(?!#)(?!data:)', t, re.I) or '@import' in t:
        return None
    m = re.search(r'<svg\b[^>]*>', t, re.I)
    head = m.group(0)
    if 'viewBox' not in head and 'viewbox' not in head.lower():
        wm = re.search(r'\bwidth="([\d.]+)(?:px)?"', head)
        hm = re.search(r'\bheight="([\d.]+)(?:px)?"', head)
        if wm and hm:
            t = t.replace(head, head[:-1] + ' viewBox="0 0 %s %s">' % (wm.group(1), hm.group(1)), 1)
        else:
            return None
    if not re.search(r'<(path|circle|rect|polygon|ellipse|g|polyline|line)\b', t, re.I):
        return None
    if not re.search(r'<(path|circle|rect|polygon|ellipse|polyline)\b[^>]+', t, re.I):
        return None
    if 'xmlns=' not in t[:500]:
        t = re.sub(r'<svg\b', '<svg xmlns="http://www.w3.org/2000/svg"', t, count=1)
    return t


def normalize(data):
    """bytes -> PIL RGBA 128x128 or None."""
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    if getattr(im, 'n_frames', 1) > 1:
        im.seek(0)
    im = im.convert('RGBA')
    w, h = im.size
    if w < 64 or h < 64:
        return None
    a = im.getchannel('A')
    bb = a.point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bb:
        return None
    # single-colour / empty check
    small = im.resize((32, 32))
    px = [p for p in small.getdata() if p[3] > 8]
    if not px:
        return None
    cols = {(p[0] // 16, p[1] // 16, p[2] // 16) for p in px}
    if len(cols) <= 1 and len(px) > 0 and len(px) >= 32 * 32 * 0.98:
        return None  # full single-colour square
    if len(cols) <= 1 and len(px) < 32 * 32 * 0.98 and w == h and False:
        pass
    ratio = w / h
    if ratio > 1.6 or ratio < 0.625:
        return None  # banner-like
    # trim fully transparent margins only when there is transparency
    if a.getextrema()[0] < 255:
        im = im.crop(bb)
    w, h = im.size
    s = 112 / max(w, h)
    im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    canvas.paste(im, ((128 - im.size[0]) // 2, (128 - im.size[1]) // 2), im)
    return canvas


def try_candidate(slug, method, ref):
    """returns ('png', Image) / ('svg', text) / None"""
    if method == 'inline-svg':
        s = clean_svg(ref)
        return ('svg', s) if s else None
    data, final, ct = get(ref)
    low = final.split('?')[0].lower()
    if low.endswith('.svg') or 'svg' in ct or data[:300].lstrip().startswith((b'<svg', b'<?xml')):
        s = clean_svg(data)
        return ('svg', s) if s else None
    if low.endswith('.ico') or 'icon' in ct and not ct.startswith('image/png'):
        pass
    im = normalize(data)
    if im is None:
        return None
    if method == 'og:image':
        pass
    return ('png', im)


def process(slug, rec, header=False):
    site = rec.get('site')
    if not site:
        return slug, None, 'no site'
    try:
        cands = candidates(site, header)
    except Exception as ex:
        cands = []
        err = 'site fetch failed: %s' % type(ex).__name__
        if not header:
            cands = [('root-apple-touch', urllib.parse.urljoin(site, '/apple-touch-icon.png'))]
    hint = rec.get('logo_hint')
    for method, ref in cands:
        if method == '__hint__':
            if not hint:
                continue
            method, ref = 'logo_hint', hint
        try:
            r = try_candidate(slug, method, ref)
        except Exception:
            continue
        if r:
            return slug, (method, ref if method != 'inline-svg' else site, r), None
    return slug, None, 'no usable candidate'


def save(slug, kind, obj):
    for e in ('png', 'svg'):
        pth = os.path.join(OUT, '%s.%s' % (slug, e))
        if os.path.exists(pth):
            os.remove(pth)
    if kind == 'png':
        obj.save(os.path.join(OUT, slug + '.png'), optimize=True)
    else:
        open(os.path.join(OUT, slug + '.svg'), 'w', encoding='utf-8').write(obj)


def have(slug):
    return any(os.path.exists(os.path.join(OUT, slug + '.' + e)) for e in ('png', 'svg'))


def load_review():
    try:
        return json.load(open(REVIEW, encoding='utf-8'))
    except Exception:
        return {'logos': {}, 'dropped': {}}


def save_review(rv):
    rv['logos'] = dict(sorted(rv['logos'].items()))
    rv['dropped'] = dict(sorted(rv['dropped'].items()))
    json.dump(rv, open(REVIEW, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)


def sister_copy(slugs, rv):
    n = 0
    try:
        lm = json.load(open(LOGOMAP, encoding='utf-8'))['logos']
    except Exception:
        return 0
    bys = {v['slug']: v for v in lm.values()}
    for s in slugs:
        v = bys.get(s)
        if not v or have(s) or s in rv['dropped'] or not os.path.exists(v['path']):
            continue
        ext = v['path'].rsplit('.', 1)[-1].lower()
        dst = os.path.join(OUT, '%s.%s' % (s, ext if ext in ('png', 'svg') else 'png'))
        if ext in ('png', 'svg'):
            shutil.copyfile(v['path'], dst)
        else:
            Image.open(v['path']).convert('RGBA').save(dst)
        rv['logos'][s] = {'source_url': v['path'], 'method': 'sister:%s' % v.get('repo', '')}
        n += 1
    return n


def sheets():
    from PIL import ImageDraw
    os.makedirs(SHEETS, exist_ok=True)
    for f in os.listdir(SHEETS):
        if f.startswith('sheet'):
            os.remove(os.path.join(SHEETS, f))
    files = sorted(f for f in os.listdir(OUT) if f.endswith('.png'))
    svgs = sorted(f for f in os.listdir(OUT) if f.endswith('.svg'))
    cols, cell_w, cell_h = 8, 150, 140
    for i in range(0, len(files), 48):
        chunk = files[i:i + 48]
        rows = (len(chunk) + cols - 1) // cols
        sh = Image.new('RGB', (cols * cell_w, rows * cell_h), 'white')
        d = ImageDraw.Draw(sh)
        for j, f in enumerate(chunk):
            x, y = (j % cols) * cell_w, (j // cols) * cell_h
            try:
                im = Image.open(os.path.join(OUT, f)).convert('RGBA')
                im.thumbnail((96, 96))
                sh.paste(im, (x + (cell_w - im.size[0]) // 2, y + 6 + (96 - im.size[1]) // 2), im)
            except Exception:
                d.text((x + 10, y + 40), 'ERR', fill='red')
            d.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=(225, 225, 225))
            d.text((x + 4, y + 112), f[:-4][:24], fill='black')
        sh.save('%s/sheet%02d.png' % (SHEETS, i // 48 + 1))
    open(SHEETS + '/svg-list.txt', 'w').write('\n'.join(svgs))
    print('sheets:', (len(files) + 47) // 48, 'svgs:', len(svgs))


def main():
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    if '--sheets' in args:
        return sheets()
    idx = json.load(open(os.path.join(ROOT, 'data', 'facts', 'index.json'), encoding='utf-8'))
    ver = {s: r for s, r in idx.items() if r.get('status') == 'verified'}
    rv = load_review()
    rv.setdefault('logos', {})
    rv.setdefault('dropped', {})
    header = '--header' in args
    if header:
        todo = [a for a in args if not a.startswith('--')]
        for s in todo:
            rv['dropped'].pop(s, None)
    else:
        n = sister_copy(ver, rv)
        print('sister copies:', n)
        todo = [s for s in ver if not have(s) and s not in rv['dropped']]
    print('to fetch:', len(todo))
    miss = []
    with ThreadPoolExecutor(10) as ex:
        for slug, res, err in ex.map(lambda s: process(s, ver[s], header), todo):
            if not res:
                miss.append(slug)
                continue
            method, ref, (kind, obj) = res
            save(slug, kind, obj)
            rv['logos'][slug] = {'source_url': ref, 'method': method}
    save_review(rv)
    print('fetched:', len(todo) - len(miss), 'no candidate:', len(miss))
    print('missing:', ' '.join(miss))


if __name__ == '__main__':
    main()
