
# test only (m7-update-test.sh case 12): a package whose apply puts a drop-in next to the GD32 guard
record_version() { printf '[Service]\nExecStart=/bin/false\n' > "$MNT/etc/systemd/system/flash-gd32.service.d/zz.conf"; }
