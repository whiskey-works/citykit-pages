#!/bin/sh
# Fails if any shipped file carries a home or build path, a private network address or a local host name, or if
# any image still carries metadata (text chunks, EXIF, XMP), where render paths hide. Generic patterns only.
# Usage: scrub-check.sh <site-dir>
set -u
PY=${PYTHON:-python3}
DIR=${1:-site}
PAT='claude\.ai/|/Users/|/home/|/nix/store|/tmp/|/private/var|[A-Za-z]:\\Users|file://|\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b|\b192\.168\.[0-9]|\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]|localhost|127\.0\.0\.1|\.local\b|\.lan\b|\.internal\b|\.blend\b'
fail=0
echo "scrub: text over $(find "$DIR" -type f | wc -l | tr -d ' ') files in $DIR"
hits=$(grep -rIEn "$PAT" "$DIR" | cut -c1-200)
if [ -n "$hits" ]; then echo "$hits"; echo "scrub: FAIL (text above)"; fail=1; fi
# Binary files (wasm, glb, images): strings search catches embedded paths.
for f in $(find "$DIR" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.wasm' -o -name '*.glb' -o -name '*.bin' \)); do
  if strings -n 6 "$f" | grep -Eq "$PAT"; then echo "scrub: FAIL binary $f"; strings -n 6 "$f" | grep -E "$PAT" | head -3; fail=1; fi
done
# Image metadata: none allowed.
"$PY" - "$DIR" <<'PY' || fail=1
import sys, os
from PIL import Image
bad = 0; n = 0
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        if not f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')): continue
        p = os.path.join(root, f); n += 1
        im = Image.open(p); info = {k: v for k, v in im.info.items() if k not in ('dpi', 'jfif', 'jfif_version', 'jfif_unit', 'jfif_density', 'progressive', 'progression', 'gamma', 'transparency', 'loop', 'duration', 'background', 'lossless')}
        exif = im.getexif()
        if info or len(exif):
            bad += 1; print("scrub: FAIL metadata", p, sorted(info)[:6], "exif" if len(exif) else "")
print(f"scrub: {n} images checked for metadata, {bad} with metadata")
sys.exit(1 if bad else 0)
PY
[ $fail = 0 ] && echo "scrub: OK" || { echo "scrub: FAILED"; exit 1; }
