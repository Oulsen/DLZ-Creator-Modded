"""The mod version, from the VERSION file in the repo root (shown on the installer's screens and in
Settings; not on the card's start screens, #97).

Format vMAJOR.MINOR.PATCH with a one-digit major and at most two-digit minor/patch (v0.1.0 .. v9.99.99):
the installer's screens show it tilted under the MODDED sticker, in the top right corner: a longer
version widens that picture and shortens the screen's title line (the limit comes from the start
screens' old layout, where it ran into the logo's "Z").
"""
import re
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"
VERSION_RE = re.compile(r"v\d\.\d{1,2}\.\d{1,2}")


def read_version(path: Path = VERSION_FILE) -> str:
    version = path.read_text(encoding="utf-8").strip()
    if not VERSION_RE.fullmatch(version):
        raise SystemExit(f"{path}: version '{version}' must look like v0.1.0 (max v9.99.99)")
    return version
