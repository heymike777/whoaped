"""Package the editable screenshot compositions for the Figma desktop editor."""

import argparse
import base64
import io
import json
from pathlib import Path
import zipfile

from PIL import Image

from render_exports import platform_shots

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--partial", action="store_true", help="Package only the captures already verified.")
options = parser.parse_args()
story = json.loads((ROOT / "storyboard.json").read_text())
assets = {}
missing = set()
available = {}

for platform, spec in story["platforms"].items():
    available[platform] = []
    source = spec["capturePlatform"]
    for shot, path in platform_shots(story, platform, ROOT):
        capture = shot["capture"]
        if not path.exists():
            missing.add(str(path.relative_to(ROOT)))
            continue
        available[platform].append(shot)
        key = f"{source}/{capture}"
        if key in assets:
            continue
        with Image.open(path) as image:
            width, height = image.size
            if width < 1000 or height < 1000:
                raise ValueError(f"Capture too small: {path} {image.size}")
            jpeg = io.BytesIO()
            image.convert("RGB").save(jpeg, "JPEG", quality=96, subsampling=0, optimize=True)
        assets[key] = {"width": width, "height": height, "base64": base64.b64encode(jpeg.getvalue()).decode()}

if missing and not options.partial:
    raise SystemExit("Missing native captures:\n" + "\n".join(sorted(missing)))

data = {"storyboard": story, "assets": assets, "available": available,
        "brandSvg": (ROOT.parent / "whoaped-app-icon.svg").read_text()}
template = (ROOT / "figma_template.js").read_text()
output = template.replace("__SCREENSHOT_DATA__", json.dumps(data, separators=(",", ":")))
target = ROOT / "figma-plugin"
target.mkdir(exist_ok=True)
(target / "code.js").write_text(output)
manifest = {
    "name": "WhoAped · Store screenshots", "id": "whoaped-store-screenshots",
    "api": "1.0.0", "main": "code.js", "editorType": ["figma"],
    "documentAccess": "dynamic-page", "networkAccess": {"allowedDomains": ["none"]},
}
(target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
with zipfile.ZipFile(ROOT / "exports" / "WhoAped-Figma-Import.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for file in [target / "code.js", target / "manifest.json"]:
        archive.write(file, file.name)
print(f"Packaged {len(assets)} native captures for {sum(map(len, available.values()))} editable Figma frames.")
