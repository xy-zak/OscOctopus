"""Renders the app icon from the UI's pixel octopus (src/lib/ui/PixelLogo.svelte), pixel-exact at
every size: the octopus alone in the default accent, on a transparent background. Each size is
drawn directly in whole-pixel cells (never scaled), so edges stay crisp.

Usage (needs Pillow: `pip install pillow`), from the repo root:
    python scripts/make_icons.py <out-dir>
then copy everything but app-icon-1024.png into src-tauri/icons. The macOS icon.icns is made
from that 1024 px render: `npx tauri icon <out-dir>/app-icon-1024.png -o <tmp>`, and copy
<tmp>/icon.icns. Keep ART in step with PixelLogo.svelte."""
import os
import sys

from PIL import Image, ImageDraw

ART = [
    '..#####..',
    '.#######.',
    '##..#..##',
    '#########',
    '#########',
    '.#.#.#.#.',
    '#..#.#..#',
    '.#.....#.',
]
ACCENT = '#2ee6d6'  # RAINBOW colour 5 (teal), the accent the UI first shipped with


def render(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Whole-pixel cells, about 85% of the width (as big as fits at small sizes), centred.
    u = max(1, round(size * 0.85 / 9))
    while 9 * u > size and u > 1:
        u -= 1
    ox = (size - 9 * u) // 2
    oy = (size - 8 * u) // 2
    for y, row in enumerate(ART):
        for x, ch in enumerate(row):
            if ch == '#':
                d.rectangle((ox + x * u, oy + y * u, ox + (x + 1) * u - 1, oy + (y + 1) * u - 1), fill=ACCENT)
    return img


def main(out: str):
    os.makedirs(out, exist_ok=True)
    pngs = {
        '32x32.png': 32,
        '128x128.png': 128,
        '128x128@2x.png': 256,
        'icon.png': 512,
        'Square30x30Logo.png': 30,
        'Square44x44Logo.png': 44,
        'Square71x71Logo.png': 71,
        'Square89x89Logo.png': 89,
        'Square107x107Logo.png': 107,
        'Square142x142Logo.png': 142,
        'Square150x150Logo.png': 150,
        'Square284x284Logo.png': 284,
        'Square310x310Logo.png': 310,
        'StoreLogo.png': 50,
    }
    for name, size in pngs.items():
        render(size).save(os.path.join(out, name))
    ico_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    base = render(256)
    base.save(
        os.path.join(out, 'icon.ico'),
        sizes=[(s, s) for s in ico_sizes],
        append_images=[render(s) for s in ico_sizes if s != 256],
    )
    render(1024).save(os.path.join(out, 'app-icon-1024.png'))
    print('ok')


if __name__ == '__main__':
    main(sys.argv[1])
