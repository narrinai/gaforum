#!/usr/bin/env python3
"""Render GA Forum Open Graph cards (1200x630 PNG) in the brand style (variant C "Thread").

Per-page card:
    python3 scripts/make_og.py --title "Best Game Engines for Indie Studios" \
        --kicker "Game development" --out images/og/game-engines.png

Default site card (images/og-default.png):
    python3 scripts/make_og.py --default --out images/og-default.png

Fonts are loaded from scripts/fonts/ (OFL, see scripts/fonts/OFL.txt).
Only Pillow is required.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")

W, H = 1200, 630
SS = 2  # supersampling factor for smooth shapes

BG = (255, 248, 236)      # #FFF8EC
TEXT = (35, 31, 61)       # #231F3D
PRIMARY = (242, 84, 45)   # #F2542D
ACCENT = (255, 197, 61)   # #FFC53D
MUTED = (111, 106, 133)   # #6F6A85
CREAM = (255, 248, 236)

TAGLINE = "Software rankings for game developers, streamers and esports teams"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def draw_mark(img, x, y, size):
    """Draw the bubble mark (64-unit grid from mark.svg) with its 64x64 box at (x, y)."""
    k = size / 64.0
    big = Image.new("RGBA", (int(64 * k * 4), int(64 * k * 4)), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    s = k * 4

    def P(px, py):
        return (px * s, py * s)

    # bubble body: rounded rect 6..58 x 6..48, radius 14
    d.rounded_rectangle([P(6, 6), P(58, 48)], radius=14 * s, fill=PRIMARY)
    # tail: H31 L15 59 L18 47 (joined into the body)
    d.polygon([P(31, 47), P(31, 48), P(15, 59), P(18, 47), P(18, 40), P(31, 40)], fill=PRIMARY)
    # bars
    d.rounded_rectangle([P(16, 17), P(46, 23)], radius=3 * s, fill=CREAM)
    d.rounded_rectangle([P(24, 28), P(48, 34)], radius=3 * s, fill=ACCENT)
    small = big.resize((int(64 * k), int(64 * k)), Image.LANCZOS)
    img.alpha_composite(small, (int(x), int(y)))


def wrap(draw, text, fnt, max_w):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fit_title(draw, text, max_w, max_lines=3, sizes=(76, 70, 64, 58, 54)):
    for size in sizes:
        f = font("BricolageGrotesque-ExtraBold.ttf", size)
        lines = wrap(draw, text, f, max_w)
        if len(lines) <= max_lines:
            return f, lines
    # still too long: cut to max_lines with an ellipsis
    f = font("BricolageGrotesque-ExtraBold.ttf", sizes[-1])
    lines = wrap(draw, text, f, max_w)[:max_lines]
    last = lines[-1]
    while draw.textlength(last + "...", font=f) > max_w and " " in last:
        last = last.rsplit(" ", 1)[0]
    lines[-1] = last.rstrip(",.;:") + "..."
    return f, lines


def base():
    img = Image.new("RGBA", (W * SS, H * SS), BG + (255,))
    d = ImageDraw.Draw(img)
    # accent shapes: yellow disc in the top right, coral strip at the bottom
    d.ellipse([(W - 170) * SS, -150 * SS, (W + 150) * SS, 170 * SS], fill=ACCENT)
    d.rectangle([0, (H - 14) * SS, W * SS, H * SS], fill=PRIMARY)
    return img, d


def wordmark(d, x, y, size):
    """'ga' + 'forum' in Bricolage Grotesque 800, the logo colours. Returns end x."""
    f = font("BricolageGrotesque-ExtraBold.ttf", size)
    sp = -size / 35.0  # letter-spacing -1 at 35px, as in the logo
    cx = x
    for part, col in (("ga", TEXT), ("forum", PRIMARY)):
        for ch in part:
            d.text((cx, y), ch, font=f, fill=col, anchor="ls")
            cx += d.textlength(ch, font=f) + sp
    return cx


def render_default(out):
    img, d = base()
    s = SS
    mark = 300
    mx, my = 110 * s, (H * s - mark * s) // 2 - 10 * s
    draw_mark(img, mx, my, mark * s)
    tx = mx + (mark + 40) * s
    title_f = font("BricolageGrotesque-ExtraBold.ttf", 118 * s)
    d.text((tx, 300 * s), "GA ", font=title_f, fill=TEXT, anchor="ls")
    gx = tx + d.textlength("GA ", font=title_f)
    d.text((gx, 300 * s), "Forum", font=title_f, fill=PRIMARY, anchor="ls")
    tag_f = font("DMSans-Medium.ttf", 34 * s)
    lines = wrap(d, TAGLINE, tag_f, (W - 90) * s - tx)
    y = 362 * s
    for ln in lines:
        d.text((tx, y), ln, font=tag_f, fill=MUTED, anchor="ls")
        y += 46 * s
    url_f = font("DMMono-Medium.ttf", 24 * s)
    d.text((tx, y + 30 * s), "ga-forum.com", font=url_f, fill=PRIMARY, anchor="ls")
    save(img, out)


def render_card(title, kicker, out):
    img, d = base()
    s = SS
    left = 90 * s
    max_w = (W - 180) * s
    y = 150 * s
    if kicker:
        kf = font("DMSans-Bold.ttf", 26 * s)
        k = kicker.upper()
        # letter-spaced kicker on a yellow underline
        cx = left
        for ch in k:
            d.text((cx, y), ch, font=kf, fill=PRIMARY, anchor="ls")
            cx += d.textlength(ch, font=kf) + 2.5 * s
        y += 34 * s
    f, lines = fit_title(d, title, max_w / s)
    f = font("BricolageGrotesque-ExtraBold.ttf", f.size * s)
    line_h = int(f.size * 1.08)
    y += line_h
    for ln in lines:
        d.text((left, y), ln, font=f, fill=TEXT, anchor="ls")
        y += line_h
    # footer: mark + wordmark + domain
    fy = (H - 64) * s
    draw_mark(img, left - 6 * s, fy - 46 * s, 64 * s)
    end = wordmark(d, left + 66 * s, fy, 38 * s)
    uf = font("DMMono-Medium.ttf", 22 * s)
    d.text(((W - 90) * s, fy, ), "ga-forum.com", font=uf, fill=MUTED, anchor="rs")
    save(img, out)


def save(img, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.convert("RGB").resize((W, H), Image.LANCZOS).save(out, optimize=True)
    print(out)


def main():
    ap = argparse.ArgumentParser(description="Render a GA Forum OG card (1200x630).")
    ap.add_argument("--title", help="page title, wrapped to at most 3 lines")
    ap.add_argument("--kicker", default="", help="small label above the title")
    ap.add_argument("--out", required=True, help="output PNG path")
    ap.add_argument("--default", action="store_true", help="render the default site card")
    a = ap.parse_args()
    if a.default:
        render_default(a.out)
    elif a.title:
        render_card(a.title, a.kicker, a.out)
    else:
        ap.error("--title is required unless --default is given")


if __name__ == "__main__":
    main()
