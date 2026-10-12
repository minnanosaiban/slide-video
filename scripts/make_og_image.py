"""Regenerate public/og-image-square.png and public/og-image-large.png.

Requires Pillow and a Japanese-capable TrueType font (Meiryo on Windows).
Run: python scripts/make_og_image.py

sidenote・pdf-tools と同じ構成のOGP画像：
- 横長（1200x630 / Twitterのlargeカード）＝左にアプリ名と説明、右にアプリのミニ画面
  （中央の1枚が大きく、左右が薄く見えるスライドの並び＋再生マーク）。
- 正方形（630x630 / summaryカード・小さいサムネイル）＝小さくても読める黒地に白抜き2行。
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = r"C:\Windows\Fonts\meiryo.ttc"
FONT_BOLD_PATH = r"C:\Windows\Fonts\meiryob.ttc"
OUT_DIR = Path(__file__).resolve().parent.parent / "public"

TITLE = "スライド動画メーカー"
DESC_LINES = ["画像・PDFを、", "X向けの動画に。"]
SUB_LINE = "ページめくり・キューブ回転など8種類"
SQUARE_LINES = ["スライド", "動画"]
URL = "slide-video-c0s.pages.dev"

BG = "#fafafa"
TEXT = "#0a0a0a"
MUTED = "#4d4d4d"
BORDER = "#e5e5e5"
BODY_BG = "#f2f2f2"
LINE = "#eceef1"
LINE_STRONG = "#d7dade"
STAMP = "#b93226"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD_PATH if bold else FONT_PATH, size, index=0)


def bar(d, x, y, w, h, color=LINE, radius=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius if radius is not None else h / 2, fill=color)


def slide_card(img, cx, cy, w, h, alpha, tone, clip):
    """スライド1枚（白い紙に、赤い細帯・見出し・本文の線・図）。alphaで薄く見せる。"""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2
    d.rounded_rectangle([x0 + 2, y0 + 5, x1 + 2, y1 + 5], radius=10, fill=(0, 0, 0, 34))   # 影
    d.rounded_rectangle([x0, y0, x1, y1], radius=10, fill="#ffffff", outline=BORDER, width=1)
    d.rounded_rectangle([x0, y0, x1, y0 + 6], radius=3, fill=STAMP)
    pad = w * 0.09
    bar(d, x0 + pad, y0 + h * 0.17, w * 0.42, max(6, h * 0.08), LINE_STRONG)
    for i, r in enumerate((0.82, 0.70, 0.76)):
        bar(d, x0 + pad, y0 + h * (0.36 + i * 0.13), w * r * 0.82, max(4, h * 0.05))
    d.rounded_rectangle([x1 - pad - w * 0.26, y1 - pad - h * 0.30, x1 - pad, y1 - pad], radius=6, fill=tone)
    a = layer.getchannel("A").point(lambda v: int(v * alpha))
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rectangle(clip, fill=255)      # 画面の枠の内側だけに見せる（はみ出しは切る）
    layer.putalpha(Image.composite(a, Image.new("L", img.size, 0), mask))
    img.paste(layer, (0, 0), layer)


def draw_mock(img):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 664, 146, 1144, 486
    d.rounded_rectangle([x0, y0, x1, y1], radius=18, fill="#ffffff", outline=BORDER, width=1)
    d.rounded_rectangle([x0, y0, x1, y0 + 46], radius=18, fill="#f3f3f3")
    d.rectangle([x0, y0 + 28, x1, y0 + 46], fill="#f3f3f3")
    d.line([x0, y0 + 46, x1, y0 + 46], fill=BORDER, width=1)
    for i, c in enumerate(("#ff5f57", "#ffbd2e", "#28c840")):
        cx = x0 + 24 + i * 20
        d.ellipse([cx - 6, y0 + 17, cx + 6, y0 + 29], fill=c)
    d.rounded_rectangle([x0 + 92, y0 + 12, x1 - 24, y0 + 34], radius=11, fill="#ffffff", outline=BORDER, width=1)
    d.text((x0 + 106, y0 + 16), URL, font=font(13), fill="#71717a")
    d.rectangle([x0 + 1, y0 + 47, x1 - 1, y1 - 1], fill=BODY_BG)

    # スライドの並び：中央が大きく、左右は小さく薄く（右から左へ流れるイメージ）
    cy = (y0 + 47 + y1) / 2 - 6
    mid = (x0 + x1) / 2
    clip = (x0 + 1, y0 + 47, x1 - 1, y1 - 1)
    slide_card(img, mid - 196, cy, 170, 96, 0.55, "#c9d3df", clip)
    slide_card(img, mid + 196, cy, 170, 96, 0.55, "#dcd3cf", clip)
    slide_card(img, mid, cy, 250, 140, 1.0, "#b9bfc7", clip)
    d = ImageDraw.Draw(img)
    # 再生マーク（中央のスライドの右下）
    px, py, r = mid + 104, cy + 52, 22
    d.ellipse([px - r, py - r, px + r, py + r], fill="#1e2126")
    d.polygon([(px - 6, py - 10), (px - 6, py + 10), (px + 11, py)], fill="#ffffff")
    # 進捗バー
    bar(d, x0 + 36, y1 - 22, x1 - x0 - 72, 6, LINE_STRONG)
    bar(d, x0 + 36, y1 - 22, int((x1 - x0 - 72) * 0.38), 6, STAMP)


def make_large():
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    title_font = font(46, bold=True)
    tb = d.textbbox((0, 0), TITLE, font=title_font)
    desc_font, sub_font = font(26), font(16)
    line_h = 42
    total = (tb[3] - tb[1]) + 28 + line_h * len(DESC_LINES) + 26
    top = (h - total) / 2
    d.text((72, top - tb[1]), TITLE, font=title_font, fill=TEXT)
    ty = top + (tb[3] - tb[1]) + 28
    for t in DESC_LINES:
        d.text((72, ty), t, font=desc_font, fill=MUTED)
        ty += line_h
    d.text((72, ty + 8), SUB_LINE, font=sub_font, fill="#71717a")

    draw_mock(img)
    img.save(OUT_DIR / "og-image-large.png")


def make_square():
    size = 630
    pad_x = 34
    line1, line2 = SQUARE_LINES
    scratch = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    avail_w = size - 2 * pad_x
    font_size = 260
    while font_size > 10:
        f = font(font_size)
        b1 = scratch.textbbox((0, 0), line1, font=f)
        b2 = scratch.textbbox((0, 0), line2, font=f)
        if max(b1[2] - b1[0], b2[2] - b2[0]) <= avail_w:
            break
        font_size -= 2
    h1, h2 = b1[3] - b1[1], b2[3] - b2[1]
    gap = round(font_size * 0.35)
    top = (size - (h1 + h2 + gap)) / 2

    img = Image.new("RGB", (size, size), "#000000")
    d = ImageDraw.Draw(img)
    d.text(((size - (b1[2] - b1[0])) / 2 - b1[0], top - b1[1]), line1, font=f, fill="#ffffff")
    d.text(((size - (b2[2] - b2[0])) / 2 - b2[0], top + h1 + gap - b2[1]), line2, font=f, fill="#ffffff")
    img.save(OUT_DIR / "og-image-square.png")


if __name__ == "__main__":
    make_square()
    make_large()
    print("wrote", OUT_DIR / "og-image-square.png")
    print("wrote", OUT_DIR / "og-image-large.png")
