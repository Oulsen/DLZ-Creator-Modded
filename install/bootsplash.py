"""Unpack / pack Linux kernel bootsplash files (bootsplash.armbian).

Format: include/uapi/linux/bootsplash_file.h (Armbian kernel bootsplash patch).
  file header (128 B) | pic headers (32 B each) | blobs: header (16 B) + raw RGB data, padded to 16 B

  unpack [--raw] <bootsplash file> <dir>   -> dir/manifest.json + dir/pic<P>_<NNN>.png (or .rgb)
  pack   [--raw] <dir> <bootsplash file>   <- manifest.json + PNGs (or raw RGB24 frames)

--raw keeps the frames as raw RGB24 and needs no Pillow (used on the device, see mkvisuals.sh).
"""
import argparse
import json
import os
import struct

MAGIC_LE = b"hsalpstoob xuniL"
VERSION = 55561
FILE_HDR = struct.Struct("<16sH4BHBBH100s")
PIC_HDR = struct.Struct("<HHBBHBB22s")
BLOB_HDR = struct.Struct("<IHB9s")


def unpack(path: str, outdir: str, raw: bool) -> None:
    data = open(path, "rb").read()
    magic, version, r, g, b, _, num_blobs, num_pics, _, frame_ms, _ = FILE_HDR.unpack_from(data, 0)
    if magic != MAGIC_LE or version != VERSION:
        raise ValueError(f"not a bootsplash file (magic {magic!r}, version {version})")

    off = FILE_HDR.size
    pics = []
    for _ in range(num_pics):
        w, h, nblobs, pos, pos_off, anim_type, anim_loop, _ = PIC_HDR.unpack_from(data, off)
        pics.append(dict(width=w, height=h, position=pos, position_offset=pos_off,
                         anim_type=anim_type, anim_loop=anim_loop, frames=[]))
        off += PIC_HDR.size

    os.makedirs(outdir, exist_ok=True)
    for _ in range(num_blobs):
        length, btype, pic_id, _ = BLOB_HDR.unpack_from(data, off)
        off += BLOB_HDR.size
        if btype != 0:
            raise ValueError(f"unsupported blob type {btype}")
        pic = pics[pic_id]
        name = f"pic{pic_id}_{len(pic['frames']):03d}." + ("rgb" if raw else "png")
        frame = data[off:off + length]
        if raw:
            with open(os.path.join(outdir, name), "wb") as f:
                f.write(frame)
        else:
            from PIL import Image
            Image.frombytes("RGB", (pic["width"], pic["height"]), frame).save(os.path.join(outdir, name))
        pic["frames"].append(name)
        off += length + (-length % 16)

    manifest = dict(background=[r, g, b], frame_ms=frame_ms, pics=pics)
    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"{path}: {num_pics} pics, {num_blobs} frames, {frame_ms} ms/frame -> {outdir}")


def pack(indir: str, path: str, raw: bool) -> None:
    with open(os.path.join(indir, "manifest.json")) as f:
        m = json.load(f)
    pics = m["pics"]

    out = bytearray(FILE_HDR.pack(MAGIC_LE, VERSION, *m["background"], 0,
                                  sum(len(p["frames"]) for p in pics), len(pics), 0,
                                  m["frame_ms"], b"\0" * 100))
    for p in pics:
        out += PIC_HDR.pack(p["width"], p["height"], len(p["frames"]), p["position"],
                            p["position_offset"], p["anim_type"], p["anim_loop"], b"\0" * 22)
    for pic_id, p in enumerate(pics):
        for name in p["frames"]:
            if raw:
                with open(os.path.join(indir, name), "rb") as f:
                    frame = f.read()
                if len(frame) != p["width"] * p["height"] * 3:
                    raise ValueError(f"{name}: {len(frame)} bytes, expected {p['width']}x{p['height']} RGB24")
            else:
                from PIL import Image
                img = Image.open(os.path.join(indir, name)).convert("RGB")
                if img.size != (p["width"], p["height"]):
                    raise ValueError(f"{name}: {img.size} != {(p['width'], p['height'])}")
                frame = img.tobytes()
            out += BLOB_HDR.pack(len(frame), 0, pic_id, b"\0" * 9) + frame + b"\0" * (-len(frame) % 16)

    with open(path, "wb") as f:
        f.write(out)
    print(f"{path}: {len(out)} bytes")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for cmd in ("unpack", "pack"):
        p = sub.add_parser(cmd)
        p.add_argument("--raw", action="store_true", help="raw RGB24 frames instead of PNG (no Pillow)")
        p.add_argument("src")
        p.add_argument("dst")
    args = ap.parse_args()
    (unpack if args.cmd == "unpack" else pack)(args.src, args.dst, args.raw)


if __name__ == "__main__":
    main()
