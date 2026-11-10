"""
Draws the campus line art (public/campus-lines*.svg) into ready-made pictures, so the browser
doesn't have to.

Why: the drawing is about 19,000 line segments. As a page background a browser redraws all of them
for every strip of the page it paints (50 ms a time on a fast computer, several times that on a
slow one), which made scrolling the Now and Clubs pages stutter, and every repaint of the top bar
did the same. A picture of the drawing is unpacked once and then just copied.

Writes, next to the SVGs in public/:
  campus-lines.webp            the purple drawing, 1500 px wide: the size the pages show it at in
                               any window up to 1500 px wide
  campus-lines-wide.webp       the same 1920 px wide, for full-HD screens, where the drawing
                               stretches to the window's width
  campus-lines-dark.webp       both again in the dark theme's lilac
  campus-lines-dark-wide.webp
  campus-lines-nav.webp        the strip of the white drawing that shows through the top bar, at 2x

DubHub.css picks between them ("Which file the drawing comes from"): a picture where it comes out
the same as the SVG would (standard-density screens up to full HD, and full-HD laptops at 125%
scaling) and on lower-end computers; other screens keep the SVG, which stays sharp at any size.
The top bar always uses its strip.

Run it again after changing an SVG (needs Playwright and Chrome, like the scrapers):
    python scripts/render-campus-lines.py
"""
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright

PUBLIC = Path(__file__).resolve().parent.parent / "public"

# The drawing's own size (its viewBox), and the widths the page pictures are made at.
ART_W, ART_H = 1200, 1172
PAGE_W = 1500
WIDE_W = 1920

# The top bar shows the white drawing 1200 px wide, placed at "30% 42%" (see .nav::before in
# DubHub.css), so only a band about as tall as the bar ever shows: rows 467 to 527 of it on a 60 px
# bar, a few px different on the phone's 52 px one. The strip keeps rows NAV_TOP to NAV_BOTTOM,
# with room to spare. DubHub.css has the same NAV_TOP in the strip's position: change both together.
NAV_TOP, NAV_BOTTOM = 456, 544
NAV_SCALE = 2  # twice the size, so it stays sharp on high-density screens

# How see-through each pixel is, rounded to a few steps. A line's soft edges don't need 256 steps
# when the whole drawing is shown at about 14% strength, and fewer steps make the file a third of
# the size. 15 is the buildings' faint fill (6%), kept exactly.
LEVELS = [0, 15, 51, 102, 153, 204, 255]

DRAW = """
async ([svg, width, height, x, y, drawWidth, drawHeight, levels]) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + svg;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
  const picture = ctx.getImageData(0, 0, width, height);
  const px = picture.data;
  // The drawing is one color throughout: read it from the most solid pixel.
  let solid = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > px[solid + 3]) solid = i;
  const [r, g, b] = [px[solid], px[solid + 1], px[solid + 2]];
  const nearest = new Uint8Array(256);
  for (let a = 0; a < 256; a++) nearest[a] = levels.reduce((best, l) => (Math.abs(l - a) < Math.abs(best - a) ? l : best));
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = nearest[px[i + 3]];
  }
  ctx.putImageData(picture, 0, 0);
  // Quality 1 makes Chrome save WebP without loss: exactly these pixels.
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/webp', 1));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
"""


def render(page, svg_name, out_name, width, height, x, y, draw_width, draw_height):
    svg = base64.b64encode((PUBLIC / svg_name).read_bytes()).decode()
    data = base64.b64decode(page.evaluate(DRAW, [svg, width, height, x, y, draw_width, draw_height, LEVELS]))
    (PUBLIC / out_name).write_bytes(data)
    print(f"{out_name}: {width}x{height}, {len(data) / 1024:.0f} KB")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        page = browser.new_page(device_scale_factor=1)
        for width, suffix in [(PAGE_W, ""), (WIDE_W, "-wide")]:
            height = round(width * ART_H / ART_W)
            render(page, "campus-lines.svg", f"campus-lines{suffix}.webp", width, height, 0, 0, width, height)
            render(page, "campus-lines-dark.svg", f"campus-lines-dark{suffix}.webp", width, height, 0, 0, width, height)
        render(
            page, "campus-lines-white.svg", "campus-lines-nav.webp",
            ART_W * NAV_SCALE, (NAV_BOTTOM - NAV_TOP) * NAV_SCALE,
            0, -NAV_TOP * NAV_SCALE, ART_W * NAV_SCALE, ART_H * NAV_SCALE,
        )
        browser.close()


if __name__ == "__main__":
    main()
