"""Build opaque store artwork from checked-in storyboard and native screen captures."""

import argparse
from functools import lru_cache
import json
from pathlib import Path
import zipfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
FONTS = ROOT.parents[1] / "apps/mobile/assets/fonts"
STORY = json.loads((ROOT / "storyboard.json").read_text())
PAPER, INK, ORANGE = "#F4F4EF", "#111313", "#F04B2F"
BLACK = "#0C0E0D"


@lru_cache
def font(weight, size):
    return ImageFont.truetype(str(FONTS / f"SpaceGrotesk-{weight}.ttf"), round(size))


def wrap(draw, copy, face, width):
    lines = [""]
    for word in copy.split():
        candidate = f"{lines[-1]} {word}".strip()
        if lines[-1] and draw.textlength(candidate, font=face) > width:
            lines.append(word)
        else:
            lines[-1] = candidate
    return lines


def platform_shots(story, platform, root):
    source = story["platforms"][platform]["capturePlatform"]
    alternatives = story.get("fallbackShots", {}).get(source, {})
    for shot in story["shots"]:
        path = root / "captures" / source / f'{shot["capture"]}.png'
        alternative = alternatives.get(shot["id"])
        if alternative and not path.exists():
            alternate_path = path.with_name(f'{alternative["capture"]}.png')
            if alternate_path.exists():
                yield alternative, alternate_path
                continue
        yield shot, path


def compose(screen, shot, platform, width, height):
    is_tablet = platform == "apple-ipad"
    dark = shot["tone"] == "ink"
    bg, fg = (INK, PAPER) if dark else (PAPER, INK)
    muted = "#BBC5BC" if dark else "#505955"
    grid = "#303932" if dark else "#DCE1D8"
    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)
    margin = round(width * (.063 if is_tablet else .075))
    unit = height / 2622

    # Reuse the actual app mark alongside the wordmark.
    mark_size = round(55 * unit)
    mark = Image.open(ROOT.parent / "whoaped-app-icon-2048.png").convert("RGB")
    mark = ImageOps.fit(mark, (mark_size, mark_size), Image.Resampling.LANCZOS)
    mask = Image.new("L", mark.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, mark_size - 1, mark_size - 1), max(1, mark_size // 4), fill=255)
    word_y = round(80 * unit)
    image.paste(mark, (margin, word_y), mask)
    draw.text((margin + mark_size + round(17 * unit), word_y + mark_size / 2), "WhoAped",
              font=font("Bold", 49 * unit), fill=fg, anchor="lm")
    rule_y = round(174 * unit)
    draw.line((margin, rule_y, width - margin, rule_y), fill=grid, width=max(2, round(2 * unit)))

    title_size = round((143 if is_tablet else 119) * unit)
    title = shot["title"].splitlines()
    while any(draw.textlength(line, font=font("Bold", title_size)) > width - 2 * margin for line in title):
        title_size -= 2
    title_y = round(224 * unit)
    for i, line in enumerate(title):
        draw.text((margin, title_y + i * title_size * 1.015), line, font=font("Bold", title_size), fill=fg, anchor="lt")
    title_bottom = title_y + (len(title) - 1) * title_size * 1.015 + title_size
    body_font = font("Regular", (48 if is_tablet else 42) * unit)
    body_y = title_bottom + round(28 * unit)
    text_w = width * (.65 if is_tablet else .84)
    lines = wrap(draw, shot["subtitle"], body_font, text_w)
    for i, line in enumerate(lines):
        draw.text((margin, body_y + i * body_font.size * 1.24), line, font=body_font, fill=muted, anchor="lt")
    body_bottom = body_y + len(lines) * body_font.size * 1.24
    accent_y = round(body_bottom + 25 * unit)
    draw.rounded_rectangle((margin, accent_y, margin + round(44 * unit), accent_y + max(4, round(6 * unit))),
                           radius=4, fill=ORANGE)

    # Keep the entire native viewport visible so tab bars and form actions survive export.
    top = max(round(height * (.279 if is_tablet else .276)), round(accent_y + 51 * unit))
    bottom = height - round((72 if is_tablet else 65) * unit)
    trim = round((27 if is_tablet else 24) * unit)
    desired_width = width * (.86 if is_tablet else .83) - trim * 2
    available_height = bottom - top - 2 * trim
    scale = min(desired_width / screen.width, available_height / screen.height)
    screen_w, screen_h = round(screen.width * scale), round(screen.height * scale)
    shell_w, shell_h = screen_w + 2 * trim, screen_h + 2 * trim
    slide = round(width * (.035 if shot["layout"] == "offset" else 0))
    left = (width - shell_w) // 2 + slide
    radius = round((68 if is_tablet else 100) * unit)

    grid_top, grid_bottom = top + round(114 * unit), height - round(127 * unit)
    grid_gap = round(width * .107)
    for x in range(margin, width - margin + 1, grid_gap):
        draw.line((x, grid_top, x, grid_bottom), fill=grid, width=2)
    for y in range(grid_top, grid_bottom + 1, grid_gap):
        draw.line((margin, y, width - margin, y), fill=grid, width=2)
    cursor_x, cursor_y = margin + grid_gap, grid_top + 2 * grid_gap
    draw.ellipse((cursor_x - 5, cursor_y - 5, cursor_x + 5, cursor_y + 5), fill=ORANGE)

    shell = (left, top, left + shell_w, top + shell_h)
    shadow = Image.new("L", image.size)
    drop = round(19 * unit)
    ImageDraw.Draw(shadow).rounded_rectangle((left, top + drop, left + shell_w, top + shell_h + drop),
                                             radius, fill=120 if dark else 90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26 * unit))
    image.paste(BLACK, (0, 0, width, height), shadow)
    draw.rounded_rectangle(shell, radius, fill=BLACK, outline="#6D746E" if dark else "#ADB5AD",
                           width=max(2, round(3 * unit)))
    if not is_tablet:
        draw.rounded_rectangle((left - 4, top + radius * 2, left + 3, top + radius * 3), 3, fill="#555C56")
        draw.rounded_rectangle((left + shell_w - 3, top + radius * 2, left + shell_w + 4, top + radius * 3.4),
                               3, fill="#555C56")
    screen = screen.resize((screen_w, screen_h), Image.Resampling.LANCZOS)
    mask = Image.new("L", screen.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, screen_w - 1, screen_h - 1), radius - trim, fill=255)
    image.paste(screen, (left + trim, top + trim), mask)
    if platform.startswith("apple-iphone"):
        # Simulator output omits the physical Dynamic Island.
        island_w, island_h = round(screen_w * .245), round(screen_w * .067)
        center_x = left + shell_w / 2
        y = top + trim + round(screen_w * .033)
        draw.rounded_rectangle((center_x - island_w / 2, y, center_x + island_w / 2, y + island_h),
                               island_h // 2, fill="#060606")
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--partial", action="store_true", help="Preview only the captures already verified.")
    args = parser.parse_args()
    out = ROOT / "exports"
    report = []
    rows = []
    missing = []
    for platform, spec in STORY["platforms"].items():
        folder = out / platform
        folder.mkdir(parents=True, exist_ok=True)
        row = []
        for shot, source in platform_shots(STORY, platform, ROOT):
            if not source.exists():
                missing.append(str(source.relative_to(ROOT)))
                continue
            with Image.open(source) as raw:
                original = raw.convert("RGB")
            artwork = compose(original, shot, platform, spec["width"], spec["height"])
            file = folder / f'{shot["id"]}.jpg'
            artwork.save(file, quality=94, subsampling=0, optimize=True)
            with Image.open(file) as verified:
                assert verified.size == (spec["width"], spec["height"]) and verified.mode == "RGB", file
            assert file.stat().st_size < spec.get("maxFileBytes", 20_000_000), file
            report.append({"path": str(file.relative_to(out)), "width": artwork.width, "height": artwork.height,
                           "bytes": file.stat().st_size, "capture": str(source.relative_to(ROOT)),
                           "captureSize": list(original.size)})
            artwork.thumbnail((205, 294), Image.Resampling.LANCZOS)
            row.append(artwork)
        if row:
            rows.append((platform, row))
    if missing and not args.partial:
        raise SystemExit("Missing native captures:\n" + "\n".join(missing))

    contact = Image.new("RGB", (1770, 120 + 368 * len(rows)), "#E3E7E0")
    pen = ImageDraw.Draw(contact)
    pen.text((36, 36), "WhoAped · Store screenshots", fill=INK, font=font("Bold", 46))
    for row_index, (platform, thumbs) in enumerate(rows):
        y = 120 + 368 * row_index
        spec = STORY["platforms"][platform]
        pen.text((36, y), f"{platform}   {spec['width']} × {spec['height']}",
                 fill=INK, font=font("Medium", 25))
        for i, thumb in enumerate(thumbs):
            contact.paste(thumb, (36 + i * 217, y + 48))
    contact.save(out / "preview.jpg", quality=90, optimize=True)
    (out / "validation.json").write_text(json.dumps({"images": report, "missing": sorted(set(missing))}, indent=2) + "\n")
    with zipfile.ZipFile(out / "WhoAped-Store-Screenshots.zip", "w", compression=zipfile.ZIP_STORED) as package:
        for result in report:
            package.write(out / result["path"], result["path"])
    solana = [item for item in report if item["path"].startswith("solana-mobile/")]
    if 4 <= len(solana) <= 8:
        with zipfile.ZipFile(out / "WhoAped-Solana-dApp-Store.zip", "w", compression=zipfile.ZIP_STORED) as package:
            for result in solana:
                file = out / result["path"]
                package.write(file, file.name)
    print(f"{len(report)} RGB JPEGs verified. {len(set(missing))} storyboard slots have no matching capture.")


if __name__ == "__main__":
    main()
