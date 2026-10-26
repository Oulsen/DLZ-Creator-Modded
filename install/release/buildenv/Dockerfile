# The one build environment of the release files (#158): the tag's workflow and the PC
# (build-release.cmd, through buildenv.sh) build in this image, so the package and the installer
# image come out byte for byte the same on both. Pinned twice: the base image by digest, and every
# package from snapshot.debian.org at one moment (the tool versions shape the bytes: gzip, cpio,
# Pillow/FreeType, the DejaVu fonts, dosfstools, mtools). A new SNAPSHOT or digest is a new build
# environment: rebuild the last release in it before trusting it (notes/updates.md, "Built where").
FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad

ARG SNAPSHOT=20261020T000000Z

# plain http: apt checks the snapshot's Release signatures itself; old snapshots are past their
# Valid-Until on purpose
RUN rm -f /etc/apt/sources.list.d/debian.sources \
 && printf '%s\n' \
      "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/$SNAPSHOT trixie main" \
      "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/$SNAPSHOT trixie-security main" \
      > /etc/apt/sources.list \
 && apt-get update -q \
 && DEBIAN_FRONTEND=noninteractive apt-get install -yq --no-install-recommends \
      ca-certificates curl git openssl \
      python3 python3-pil fonts-dejavu-core \
      cpio gzip dosfstools mtools qemu-user \
 && rm -rf /var/lib/apt/lists/*

# what the build reads of its environment: no time zone or locale in the bytes
ENV TZ=UTC LC_ALL=C.UTF-8
WORKDIR /src
