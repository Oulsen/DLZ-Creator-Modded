# Changelog

## v0.2.0

- (DLZ BUG) Anyone on the same network can control the mixer, without a PIN or password
- (DLZ BUG) Once the SD card has recordings, it stays writable all the time and can be damaged by switching off
- (MOD FEATURE) Quicker and broader automatic checks for every change to the mod
- (MOD FEATURE) Ask before installing an update
- (MOD FEATURE) A development card that takes new test builds over Wi-Fi
- (MOD FEATURE) The Mod page and the logs on the card show which build is installed
- (MOD BUG) Recordings, presets and snapshots can only be deleted or renamed on the mixer's own screen
- (MOD BUG) Install time estimate far too high at the start of a step
- (MOD BUG) SSH card shows nothing while SSH is being set up
- (MOD BUG) Update: a few rare failure paths are not handled carefully enough
- (MOD BUG) Update: the check that the internal storage is locked can be skipped with the test settings
- (MOD BUG) Update: the check of a new startup script misses some ways to write the internal storage or the power chip
- (MOD BUG) Update: the check that a new updater keeps its safety checks can be fooled by its own list
- (MOD BUG) After an update the start screens still show the old version
- (MOD BUG) The developer helper for looking at the mixer can still change it

## v0.1.0

- (DLZ FEATURE) Recordings go to the SD card by default
- (DLZ FEATURE) Mod's SD card also holds recordings; "Format SD" is blocked
- (DLZ FEATURE) Unique recording names, like REC_0003_otter, numbered across SD card and USB
- (DLZ FEATURE) Better meters: level before and after the fader (choice in the mod settings), yellow and red zones, dB scale
- (DLZ FEATURE) Option to hide the header bar at the top of the screen, for more room
- (DLZ FEATURE) Connect to Wi-Fi from the screen (needs a USB Wi-Fi stick, the mixer has no Wi-Fi of its own)
- (DLZ FEATURE) Turn remote login (SSH) on from the screen with your own password, off by default
- (DLZ BUG) Recording crashes after take 9,999
- (DLZ BUG) A new recording can overwrite an older one
- (DLZ BUG) Anyone on the network, or a prepared SD card or USB stick, can change files on the mixer
- (MOD FEATURE) Install the mod on your own mixer yourself, with a step-by-step guide
- (MOD FEATURE) Faster install
- (MOD FEATURE) Update the mod without losing recordings or settings
- (MOD FEATURE) Safety locks: no firmware updates from the card, internal storage untouched
- (MOD FEATURE) Firmware check: only 1.2.0 (build 1731) is supported
- (MOD FEATURE) The mod also works on the full-size DLZ Creator
- (MOD FEATURE) Back up a mixer on other firmware, so the mod can support it
- (MOD FEATURE) "DLZ Creator Modded" tab in Settings
- (MOD FEATURE) Modded SD card with its own startup screens
- (MOD FEATURE) Startup log on the SD card, for bug reports
