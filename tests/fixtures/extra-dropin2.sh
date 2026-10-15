
# test only (tests/update.sh): a package whose apply puts a drop-in where systemd applies it
# to every service
record_version() { mkdir -p "$MNT/usr/lib/systemd/system/service.d" && printf '[Service]\nExecStartPre=/bin/true\n' > "$MNT/usr/lib/systemd/system/service.d/zz.conf"; }
