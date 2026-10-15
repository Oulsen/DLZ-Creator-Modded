#!/bin/sh
# Compose the modded boot visuals from the device's own originals and our pre-rendered layers
# (mklayers.py): the Weston background /etc/dlz.png and the kernel bootsplash.
# - logo: Mackie's, cut from the original dlz.png (logobbox.py) and scaled; it is never shipped
# - splash pic 0: logo + our splash layer, rotated 180 degrees (the panel is mounted upside down)
# - splash pic 1: the original spinner, recoloured to our green (Pillow's grey formula, v * c // 255)
# Runs on the PC (build-sd.sh) and on the device; needs ffmpeg and python3 (stdlib only).
#
# Usage: mkvisuals.sh <original dlz.png> <original bootsplash> <layers dir> <out dlz.png> <out bootsplash>
set -eu

TOOLS=$(cd "$(dirname "$0")" && pwd)
SRC_PNG=$1
SRC_SPLASH=$2
LAYERS=$3
OUT_PNG=$4
OUT_SPLASH=$5

. "$LAYERS/layout.env"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
# overlay in RGB: its default yuv420 would smear the colours
compose() {  # <out> <width> <height> <logo x> <logo y> <layer> <extra filters> [ffmpeg output options]
  out=$1 cw=$2 ch=$3 lx=$4 ly=$5 layer=$6 extra=$7
  shift 7
  ff -f lavfi -i "color=c=black:s=${cw}x${ch}" -i "$work/logo.png" -i "$layer" -filter_complex \
    "[0]format=rgb24[bg];[bg][1]overlay=$lx:$ly:format=rgb[a];[a][2]overlay=0:0:format=rgb${extra},format=rgb24" \
    -frames:v 1 "$@" "$out"
}

eval "$(python3 "$TOOLS/logobbox.py" "$SRC_PNG" "$LOGO_W")"
ff -i "$SRC_PNG" -vf "crop=$CROP,scale=$LOGO_W:$LOGO_H:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24" \
  "$work/logo.png"

compose "$OUT_PNG" "$W" "$H" "$MARKER_X" "$MARKER_Y" "$LAYERS/marker.png" ""
echo "$OUT_PNG: marker (logo $CROP -> ${LOGO_W}x$LOGO_H)"

python3 "$TOOLS/bootsplash.py" unpack --raw "$SRC_SPLASH" "$work/splash" >/dev/null
python3 - "$work/splash/manifest.json" "$BOX_W" "$BOX_H" > "$work/pics" <<'PY'
import json, sys
path, box_w, box_h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
m = json.load(open(path))
logo, spinner = m["pics"]
if len(logo["frames"]) != 1:
    sys.exit(f"expected one logo frame, found {len(logo['frames'])}")
logo["width"], logo["height"] = box_w, box_h
json.dump(m, open(path, "w"), indent=2)
print(logo["frames"][0], spinner["width"], spinner["height"], len(spinner["frames"]))
PY
read -r logo_frame spin_w spin_h spin_n < "$work/pics"

compose "$work/splash/$logo_frame" "$BOX_W" "$BOX_H" "$SPLASH_X" "$SPLASH_Y" "$LAYERS/splash.png" ",hflip,vflip" \
  -f rawvideo

# all spinner frames in one ffmpeg run (raw frames back to back), split again afterwards
cat "$work"/splash/pic1_*.rgb > "$work/spin.rgb"
mix="rr=.299:rg=.587:rb=.114:gr=.299:gg=.587:gb=.114:br=.299:bg=.587:bb=.114"
lut="r='trunc(val*$GREEN_R/255)':g='trunc(val*$GREEN_G/255)':b='trunc(val*$GREEN_B/255)'"
ff -f rawvideo -pix_fmt rgb24 -s "${spin_w}x$spin_h" -i "$work/spin.rgb" \
  -vf "colorchannelmixer=$mix,lutrgb=$lut,format=rgb24" -f rawvideo -pix_fmt rgb24 "$work/spin-green.rgb"
rm "$work"/splash/pic1_*.rgb
split -d -a 3 -b $((spin_w * spin_h * 3)) --additional-suffix=.rgb "$work/spin-green.rgb" "$work/splash/pic1_"
[ "$(ls "$work"/splash/pic1_*.rgb | wc -l)" = "$spin_n" ]

python3 "$TOOLS/bootsplash.py" pack --raw "$work/splash" "$OUT_SPLASH" >/dev/null
echo "$OUT_SPLASH: splash (logo picture ${BOX_W}x$BOX_H, $spin_n spinner frames recoloured)"
