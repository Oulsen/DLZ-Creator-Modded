#!/usr/bin/env python3
"""Apply the DLZ Creator Modded patches to Mackie's /srv/app.js, /srv/server.js or the XS audio graph.

Usage: patch.py app <app.js>
       patch.py server <server.js>
       patch.py graph <mixergraph-dlzlite.js>   (/usr/local/share/evolve-a1/, dspserver's graph)
       patch.py --check app|server|graph <file>   (only check the anchors and the mod file, write
                                                   nothing; the installer runs this on the read-only
                                                   eMMC before its accept screen)

The first run keeps the original as <file>.orig; every run patches from that original, so it can
be re-run after changing the patches. Each anchor must occur exactly once in the original,
otherwise nothing is written (a different firmware build needs its anchors checked). Our own code
is appended afterwards: app-mod/dlzmod.js (with the mod version stamped in),
server-mod/dlzmod-server.js or graph-mod/dlzmod-graph.js.

The patched server.js only ever runs from the SD card, where the only SD slot holds the boot card
(FORMAT SD would wipe its bootloader and partition table) and Mackie updates must not be installed
(they can bring new GD32 firmware and overwrite the mod; see notes/modding-guide.md, Brick risks).
Recordings get free, unique names (server-mod/dlzmod-server.js).
"""
import os
import sys
from pathlib import Path

from modversion import read_version

HERE = Path(__file__).parent


def write_atomic(path, data):
    """Write next to the target, flush to disk, then rename over it: a power cut leaves the old file
    or the new one, never an empty one (the drop-in update runs this on the running card)."""
    tmp = path.with_name(path.name + ".dlzmod-new")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
VERSION_PLACEHOLDER = "%%DLZMOD_VERSION%%"

# (what, anchor in Mackie's code, replacement)
APP_PATCHES = [
    (
        # startGUI builds the pages once the hub's INIT is in (dlzmod.theme with it); widgets copy
        # their colours when they are made
        "theme: palette set before the pages are built",
        # #131: and no EQ page open yet (the hub may still have the one of a screen before a restart)
        "function startGUI(t){",
        "function startGUI(t){DLZMOD_applyTheme();DLZMOD_rtaShown(null,!1);",
    ),
    (
        # the mixer's screen: every drawing property set is sent to glesgui from here (in a browser
        # the mod wraps the canvas itself, DLZMOD_tokens)
        "theme: colours written into the code",
        "set:i=>{let a={obj:t,call:s,args:[i]};",
        "set:i=>{i=DLZMOD_drawColor(s,i);let a={obj:t,call:s,args:[i]};",
    ),
    (
        "theme: the Overview's background",
        "MainMixer=class extends GenericMixer{constructor(t){super(t,{bgColor:Color.black,margin:2}),",
        'MainMixer=class extends GenericMixer{constructor(t){super(t,{bgColor:DLZMOD_ovColor("bg",Color.black),margin:2}),',
    ),
    (
        # an aux mix colours the knobs itself (knobColor: the aux's colour), that stays (DLZMOD_knobColor)
        "theme: the Overview's fader knobs",
        "Color.channel[s]||Color.white,t.fillCircle(0|e,0|i,o),o-=3.5)}t.fillStyle=this.knobColor||Color.white,t.fillCircle(0|e,0|i,o)",
        "Color.channel[s]||Color.white,t.fillCircle(0|e,0|i,o),o-=3.5)}t.fillStyle=DLZMOD_knobColor(this.knobColor),t.fillCircle(0|e,0|i,o)",
    ),
    (
        "theme: button outlines",
        "paintBody(t){t.beginPath(),t.fillStyle=this.colors[+this.state];let e=this.border/2;",
        "paintBody(t){DLZMOD_outline(this),t.beginPath(),t.fillStyle=this.colors[+this.state];let e=this.border/2;",
    ),
    (
        # app.setPage shows the header on every page switch (full-screen pages hide it again)
        "header: follow the Hide header setting",
        "t.topBar.show(),t.navBar.show(),t.panel.show(),e){case E_PAGE.EZASSISTANT:",
        "t.topBar.setVisible(!DLZMOD_headerHidden()),t.navBar.show(),t.panel.show(),e){case E_PAGE.EZASSISTANT:",
    ),
    (
        "settings: add Mod tab",
        "let t=[lang.SYSTEM,lang.BLUETOOTH_SD,lang.ROUTING_RECORDING,lang.ABOUT];",
        'let t=[lang.SYSTEM,lang.BLUETOOTH_SD,lang.ROUTING_RECORDING,lang.ABOUT,DLZMOD_tabLabel()];',
    ),
    (
        "settings: Mod tab in mod yellow (the accent colour with a theme)",
        "text:t[e],opaque:!1,colors:[Color.subNavButtonBg,Color.main],",
        "text:t[e],opaque:!1,colors:[Color.subNavButtonBg,4===e?DLZMOD_accent():Color.main],",
    ),
    (
        "settings: show Mod page",
        "case 3:this.about.show(),this.about2.show()}",
        "case 3:this.about.show(),this.about2.show();break;case 4:this.dlzmod.show()}",
    ),
    (
        "settings: create Mod page",
        "this.pages=[this.layout,this.bright,this.bt,this.sd,this.usb,this.rec2,this.rec,this.about,this.about2,this.stream]",
        "this.dlzmod=DLZMOD_settingsPage(this,l),"
        "this.pages=[this.layout,this.bright,this.bt,this.sd,this.usb,this.rec2,this.rec,this.about,this.about2,this.stream,this.dlzmod]",
    ),
    (
        # Mackie's settings class: onResize (equal tab widths) + paint, directly followed by
        # PageSamples, whose identical onResize/paint is followed by SampleInfo instead
        "settings: fixed-width Mod tab, yellow tab underline on the Mod page",
        "onResize(){if(this.banks){let t=this.banks.length,e=2,i=(this.w-e*(t-1))/t|0,s=this.w-(i*t+e*(t-1));"
        "this.banks.forEach(((t,a)=>t.setGeometry((i+e)*a,null,i+(a===this.banks.length-1?s:0),null)))}}"
        "paint(t){t.fRect(this.bgColor,0,0,this.w,this.h),t.fRect(Color.subNavButtonSeparator,0,0,this.w,40),"
        "t.fRect(Color.main,0,40,this.w,2)}},PageSamples=class",
        "onResize(){DLZMOD_layoutTabs(this)}"
        "paint(t){t.fRect(this.bgColor,0,0,this.w,this.h),t.fRect(Color.subNavButtonSeparator,0,0,this.w,40),"
        "t.fRect(4===this.page?DLZMOD_accent():Color.main,0,40,this.w,2)}},PageSamples=class",
    ),
    (
        # booted from SD, the only SD slot holds the boot card: FORMAT SD would wipe the running
        # system (server.js refuses it too, see SERVER_PATCHES)
        "settings: disable Format SD Card",
        'getState:function(){this.enabled=Data.get("sd")!==E_SD_STATUS.REMOVED},'
        'onPress:()=>{let t=Data.get("sd");t!==E_SD_STATUS.REMOVED&&new PopupConfirm',
        'getState:function(){this.enabled=!1},'
        'onPress:()=>{let t=Data.get("sd");!1&&t!==E_SD_STATUS.REMOVED&&new PopupConfirm',
    ),
    (
        "settings: hide Format SD Card",
        "text:lang.FORMAT_SD_CARD,size:[230,50]",
        "text:lang.FORMAT_SD_CARD,visible:!1,size:[230,50]",
    ),
    (
        "settings: note in the SD panel that the mod runs from this card",
        'PAINT_WINDOW_BG.call(this,t),t.drawText(lang.SD_CARD,this.w/2|0,e,'
        '{color:Color.white,font:s,align:"center",valign:"middle"});',
        'PAINT_WINDOW_BG.call(this,t),t.drawText(lang.SD_CARD,this.w/2|0,e,'
        '{color:Color.white,font:s,align:"center",valign:"middle"}),DLZMOD_paintSdNote(t,this);',
    ),
    (
        # after the bar, before the peak line: yellow/red zones and dB notches (DLZMOD_vuPaint);
        # e = full length, s = bar length in VUMeter.paint
        "meters: yellow and red zones, dB notches",
        "t.fillRect(0,this.h-s,this.w,s)}if(this.havePeak){",
        "t.fillRect(0,this.h-s,this.w,s)}DLZMOD_vuPaint(this,t,s,e);if(this.havePeak){",
    ),
    (
        # parseVuData: l = the strip's "gain" pickup, T = its index; i/o = post, t/a = pre (before
        # the gain), e = the strip: DLZMOD_vuSet feeds both bars by the Mod page's meter mode
        "meters: Mackie / both / before the fader (Mod page), left/mono meter",
        "if(e.vu.setValue(i,t),",
        "if(DLZMOD_vuSet(e.vu,l,T,i,t,e),",
    ),
    (
        "meters: Mackie / both / before the fader (Mod page), right meter of stereo strips",
        "if(e.vu2.setValue(o,a),",
        "if(DLZMOD_vuSet(e.vu2,l,T+1,o,a,e),",
    ),
    (
        # #131 the sound behind the EQ curve: the graph mod's band levels come with every VU message
        "eq spectrum: the band levels",
        "function parseVuData(t){function e(e,i){",
        "function parseVuData(t){DLZMOD_rtaVu(t);function e(e,i){",
    ),
    (
        "eq spectrum: the EQ page shown or hidden",
        'onShow(){this.syncBandSelection(!0),Data.regWidget("eqBand",this.syncEqBandCall),this.sync()}'
        'onHide(){Data.unRegWidget("eqBand",this.syncEqBandCall)}',
        'onShow(){DLZMOD_rtaShown(this,!0),this.syncBandSelection(!0),Data.regWidget("eqBand",this.syncEqBandCall),this.sync()}'
        'onHide(){DLZMOD_rtaShown(this,!1),Data.unRegWidget("eqBand",this.syncEqBandCall)}',
    ),
    (
        # PageEQ.sync: the selected channel (its key prefix, "i.0.", "m." ...) onto the page
        "eq spectrum: the EQ page's channel",
        "sync(t){let e=SELECTED();if(!e)return;let i=e.prefix;this.eq.setPrefix(i),",
        "sync(t){let e=SELECTED();if(!e)return;let i=e.prefix;DLZMOD_rtaSync(this,i),this.eq.setPrefix(i),",
    ),
    (
        # PageEQ.initWidgets: the EQ switch moves up in its box, the Spectrum switch goes under it
        "eq spectrum: the Spectrum switch under the EQ switch",
        "this.eq.bands[0]._bypass=1,this.onoff=new Switcher(this,{anchors:[116,55],size:[76,48],bgColors:[Color.buttonBg,this.color],knobMargin:2,inverted:!0}),",
        "this.eq.bands[0]._bypass=1,this.onoff=new Switcher(this,{anchors:[116,DLZMOD_rtaSwitchY()],size:[76,48],bgColors:[Color.buttonBg,this.color],knobMargin:2,inverted:!0}),"
        "this.dlzmodSpectrum=DLZMOD_rtaSwitch(this),",
    ),
    (
        # PageEQ.paint: the labels next to its switches, directly followed by PageGate
        "eq spectrum: the Spectrum switch's label",
        "this.hpf&&t.drawText(lang.HPF,26,this.hpf.geomCenterY())}},PageGate=class",
        "this.hpf&&t.drawText(lang.HPF,26,this.hpf.geomCenterY()),DLZMOD_rtaLabel(this,t)}},PageGate=class",
    ),
    (
        # #45: the server refuses the System Lock PIN and a factory reset from other devices; in a
        # browser Mackie's UI would lock or "reset" only itself, so there the buttons are not shown
        # (DLZMOD_external is known before the pages are built)
        "remote: no System Lock button in a browser",
        "text:lang.SYSTEM_LOCK,",
        "text:lang.SYSTEM_LOCK,visible:!DLZMOD_external(),",
    ),
    (
        # a mixer locked on its screen shows the lock in the browser too: tapping it says where to unlock
        "remote: unlocking only on the mixer's own screen",
        'ondown(){Data.get("lock")&&new PopupLock(app)}',
        'ondown(){Data.get("lock")&&(DLZMOD_screenOnly()||new PopupLock(app))}',
    ),
    (
        "remote: no Factory Reset (setup page) in a browser",
        "this.reset=new E1Button(this,{anchors:[30,null,30,i],w:e,text:wrapText(lang.FACTORY_RESET,30,15),",
        "this.reset=new E1Button(this,{anchors:[30,null,30,i],w:e,visible:!DLZMOD_external(),"
        "text:wrapText(lang.FACTORY_RESET,30,15),",
    ),
    (
        "remote: no Factory Reset (About) in a browser",
        "this.factoryReset=new E1Button(this,{anchors:[0,210,null,null,!0],text:lang.FACTORY_RESET,",
        "this.factoryReset=new E1Button(this,{anchors:[0,210,null,null,!0],visible:!DLZMOD_external(),"
        "text:lang.FACTORY_RESET,",
    ),
    (
        # #26: a download button on the Media page, left of Sort, in a browser and in a recordings
        # folder only (DLZMOD_mediaDownloadButton); e = the page's button style
        "media: download recordings in a browser",
        "this.bSort=new E1ToggleButton(this,{anchors:[316,-214,",
        "this.bDownload=DLZMOD_mediaDownloadButton(this,e),this.bSort=new E1ToggleButton(this,{anchors:[316,-214,",
    ),
    (
        # #14: Settings, Recording / Routing: a fourth switch under Bypass Processing, Post-Fader and
        # One-Tap Record (DLZMOD_recDateRow), set back by the panel's reset button with them
        "recording: date and time in names, the switch",
        '["settings.rec.onetap",lang.ONETAP_RECORD,0]];this.sws2=[]',
        '["settings.rec.onetap",lang.ONETAP_RECORD,0],DLZMOD_recDateRow()];this.sws2=[]',
    ),
    (
        # the four switches closer together, so the fourth fits in the panel
        "recording: date and time in names, the rows",
        "anchors:[null,175+64*e+15,18]",
        "anchors:[null,DLZMOD_recRowY(e),18]",
    ),
    (
        # rec2's paint, after the labels: the mod's mark next to the new one (the last row)
        "recording: date and time in names, the mod's mark",
        'let e=Data.get("recState");e&&e!=E_REC_STATE.FULL&&t.drawText(lang.RECORDING_IN_PROGRESS+"*",this.w/2|0,24',
        'DLZMOD_stockMark(t,this.sws2[this.sws2.length-1]);'
        'let e=Data.get("recState");e&&e!=E_REC_STATE.FULL&&t.drawText(lang.RECORDING_IN_PROGRESS+"*",this.w/2|0,24',
    ),
    (
        # #193: the player's title line without "DLZ|Creator - " in front of recordings (DLZMOD_trackName)
        "player: recording names without the artist",
        'let e=Data.get("player.name");if(e){',
        'let e=DLZMOD_trackName(Data.get("player.name"));if(e){',
    ),
    (
        # #13: at every (re)connect, after the hub's INIT: a browser gives the mixer its time
        # (DLZMOD_connected; the server takes it forward only, without internet)
        "time: a browser's clock when it connects",
        'onConnect:function(){this.cmd("INIT")},',
        'onConnect:function(){this.cmd("INIT"),DLZMOD_connected()},',
    ),
    (
        # the screen's frame timer (node has no requestAnimationFrame) waits 17 ms minus the time
        # since the last frame by the wall clock: a clock set back (chrony after a time set ahead,
        # #13) stopped every frame for as long as the jump [device: 91 s]. DLZMOD_frameNow never jumps
        "time: the screen's frames on a clock that never jumps",
        "let i=Date.now(),s=Math.max(0,17-(i-lastTime))",
        "let i=DLZMOD_frameNow(),s=Math.max(0,17-(i-lastTime))",
    ),
    (
        # next to Mackie's firmware popups: the drop-in update's result (DLZMOD_UPDATE_NOTE, once,
        # until its OK) and the installed build, last refusal and waiting update for the Mod page
        # (DLZMOD_UPDATE_STATUS), sent by the server mod when the screen has loaded
        "update: popup after a drop-in update, status on the Mod page",
        "$NET.addCallback(E_CMD.FIRMWARE_UPDATE_SUCCESS,(()=>showFirmwareUpdateSuccessPopup())),",
        "$NET.addCallback(E_CMD.FIRMWARE_UPDATE_SUCCESS,(()=>showFirmwareUpdateSuccessPopup())),"
        '$NET.addCallback("DLZMOD_UPDATE_NOTE",(t=>DLZMOD_showUpdateNote(t))),'
        '$NET.addCallback("DLZMOD_UPDATE_STATUS",(t=>DLZMOD_setUpdateStatus(t))),'
        # #65: an update waits for Install (asked on the mixer's own screen), and Install's answer
        '$NET.addCallback("DLZMOD_UPDATE_ASK",(t=>DLZMOD_askUpdate(t))),'
        '$NET.addCallback("DLZMOD_UPDATE_APPROVED",(t=>DLZMOD_updateApproved(t))),'
        # the card is not in the mixer it was made for (sd-system/dlzmod-cardcheck): every start
        '$NET.addCallback("DLZMOD_CARD_NOTE",(t=>DLZMOD_showCardNote(t))),'
        # Network panel on the Mod page: status, Wi-Fi scan list, outcome of a change
        '$NET.addCallback("DLZMOD_NET_STATE",(t=>DLZMOD_setNetState(t))),'
        '$NET.addCallback("DLZMOD_WIFI_LIST",(t=>DLZMOD_setWifiList(t))),'
        '$NET.addCallback("DLZMOD_NET_RESULT",(t=>DLZMOD_netResult(t))),'
        # Time tab (#9): the zone set, the outcome of a change
        '$NET.addCallback("DLZMOD_TIME_STATE",(t=>DLZMOD_setTimeState(t))),'
        '$NET.addCallback("DLZMOD_TIME_RESULT",(t=>DLZMOD_timeResult(t))),',
    ),
]

SERVER_PATCHES = [
    (
        "media: refuse FORMAT_SD (the SD slot holds the boot card)",
        'FORMAT_SD:async e=>!!await Se("sd")||void 0',
        'FORMAT_SD:async e=>(console.error("dlzmod: FORMAT_SD refused, the SD slot holds the boot card"),void 0)',
    ),
    (
        # ca() links a found .upd and announces FIRMWARE_FOUND; the original stays as dead code
        "firmware: never offer an update file",
        "async function ca(e,t){",
        'async function ca(e,t){console.log("dlzmod: firmware updates are disabled on the SD card")}'
        "async function dlzmod_ca_orig(e,t){",
    ),
    (
        "firmware: refuse FIRMWARE_UPDATE",
        "async FIRMWARE_UPDATE(){",
        'async FIRMWARE_UPDATE(){return{rootResponse:{cmd:"FIRMWARE_UPDATE_FAILED",id:0,data:""}};',
    ),
    (
        # A() (REC_START): t is the recordings folder, y the file handed to dspserver; ce() is a
        # medium's mount point ("-" when empty), C()?w:x the XS / full-size folder name. No free name:
        # no recording, but de() already made the medium writable, so it goes back read-only (#98)
        "recording: free, unique names (DLZMOD_recName)",
        'let a=await le(t,"REC_[0-9]{4}");y=t+"/REC_"+"0".repeat(4-a.toString().length)+a+".wav"',
        'let a=await DLZMOD_recName(t,[ce("sd"),ce("usb")].map((m=>m+"/"+(C()?w:x))));if(!a)return void DLZMOD_roLater();y=t+"/"+a+".wav"',
    ),
    (
        # #104: a kept sample gets RS_<n> above every RS_ in its folder (DLZMOD_sampleName). Folder
        # unreadable: not stored, the recorder set back as stock's SAMPLE_REC_RESET does (the pad keeps
        # what it had; DLZMOD_roLater, started at the stop, then sees nothing busy)
        "samples: free, unique names (DLZMOD_sampleName)",
        'for(t=t+"RS_"+(await le(t,"RS_[0-9]{4}[._]")).toString().padStart(4,"0")+".wav",',
        'let a=await DLZMOD_sampleName(t);if(!a)return globalThis.setDataKey("sample.rec.state",ze.READY),'
        'globalThis.setDataKey("sample.rec.length",0),void globalThis.setDataKey("sample.rec.file","");'
        'for(t=t+a+".wav",',
    ),
    (
        # same round trip as Mackie's firmware popup: sent when a screen has loaded, OK comes back
        "update: popup after a drop-in update (DLZMOD_updateNoteSend)",
        "async GUI_LOADED(e,t,a,i){",
        "async GUI_LOADED(e,t,a,i){DLZMOD_updateNoteSend(i);",
    ),
    (
        # each connection's send function says whether it comes from the mixer itself (127.0.0.1:
        # the device's screen); DLZMOD_net only takes changes from those (DLZMOD_isLocal). #45:
        # another device only when paired (stamped dlzmodPaired), else it is dropped before anything
        # of it runs
        "network: socket.io connections marked local or paired, others dropped",
        '};Xt(),e.on("message",(async e=>await la(e,t)))}',
        '};t.send.dlzmodLocal=DLZMOD_isLocal(e.handshake&&e.handshake.address);'
        'if(!DLZMOD_remoteAdmit(e,t.send))return;'
        'Xt(),e.on("message",(async e=>await la(e,t)))}',
    ),
    (
        "network: TCP connections (port 89) marked local or not",
        'i=[];e.setEncoding("utf8")',
        'i=[];a.send.dlzmodLocal=DLZMOD_isLocal(e.remoteAddress),e.setEncoding("utf8")',
    ),
    (
        # #47: Mackie's file commands take paths and names from any client unchecked (notes/system.md,
        # "Access and security"; notes/mod.md). Every command passes DLZMOD_cmdAllowed first: file
        # commands only from the mixer's own screen, preset folders and names checked for everyone;
        # a refused one answers false
        "files: commands checked (DLZMOD_cmdAllowed)",
        'let a=e.cmd;if("function"!=typeof pa[a])',
        'let a=e.cmd;{let r=DLZMOD_cmdAllowed(pa,a,e.args,t.send,[ce("sd"),ce("usb")]);'
        'if(r)return console.error("dlzmod: refused",a,r),void t.send({cmd:a,id:e.id,data:!1})}'
        'if("function"!=typeof pa[a])',
    ),
    (
        # plain key/value messages: no prototype keys; file paths dspserver opens only from the screen.
        # A refused key is also taken out of the message: after this loop stock passes the whole
        # message on to every socket.io client, dspserver included (entries() is a copy, so deleting
        # while looping is safe)
        "files: data keys checked (DLZMOD_keyAllowed)",
        "for(const[a,i]of Object.entries(e))if(null!=a){",
        "for(const[a,i]of Object.entries(e))if(null!=a&&(DLZMOD_keyAllowed(a,i,t.send)||(delete e[a],!1))){",
    ),
    (
        # stock builds a shell line from file names on the card or stick: a name with ; would run
        "files: wavfinalizer without a shell",
        'try{await b("wavfinalizer "+t+"/"+e+" "+t+"/"+a)}',
        'try{await DLZMOD_wavfinalize(t+"/"+e,t+"/"+a)}',
    ),
    # #98: stock remounts a medium read-write to record, rename, delete or finish half-written
    # recordings at the start, but never back read-only (fe() only logs it), so a card with a
    # recordings folder stayed writable until switched off. DLZMOD_roLater does the remount once
    # nothing writes; every remount runs through one queue (DLZMOD_rw), so the last one asked wins
    (
        # de(): read-write "permanently" (recording, sample recorder, the start's finalizer)
        "media: read-write remounts queued (recording)",
        'v("Changing  mount "+e+" to  RW (Perm)"),await R("mount -o remount,rw "+e)',
        'v("Changing  mount "+e+" to  RW (Perm)"),await DLZMOD_rw((()=>R("mount -o remount,rw "+e)))',
    ),
    (
        # me(): read-write for 60 s around a rename or delete. Stock skips the remount while its own
        # flag says the medium is writable; that flag knows nothing of DLZMOD_roLater, so always remount
        # (each rename or delete then has its own 60 s timer: a few DLZMOD_roLater(0) calls, harmless).
        # Stock runs the remount in an async function nobody awaits and goes on after a fixed 500 ms:
        # a failed remount (rejected) would end node 18 as an unhandled rejection, and a remount still
        # waiting in the queue would leave the delete or rename on a read-only medium. Here a failed
        # remount is logged, and me() waits for the remount (w) before its 500 ms
        "media: read-write remounts queued, every time, awaited (rename, delete)",
        "async function me(e){(e==q&&0==H||e==M&&0==W)&&(!async function(e){H=e==q?1:H,W=e==M?1:W,"
        'v("Changing  mount "+e+" to  RW (TEMP)"),await R("mount -o remount,rw "+e),await ae(6e4),'
        "e==q&&2==H||e==M&&2==W||e==q&&0==H||e==M&&0==W||await fe(e)}(e),await ae(500))}",
        "async function me(e){let w;(!async function(e){H=e==q?1:H,W=e==M?1:W,"
        'v("Changing  mount "+e+" to  RW (TEMP)"),await(w=DLZMOD_rw((()=>R("mount -o remount,rw "+e)))'
        '.catch((t=>console.error("dlzmod: read-write remount:",t.message)))),await ae(6e4),'
        "e==q&&2==H||e==M&&2==W||e==q&&0==H||e==M&&0==W||await fe(e)}(e),await w,await ae(500))}",
    ),
    (
        # fe(): the end of a rename/delete's 60 s and of the start's finalizer
        "media: back to read-only for real (DLZMOD_roLater)",
        'v("Changing  mount "+e+" back to  RO1"),v("DONE RO")',
        'v("Changing  mount "+e+" back to  RO1"),DLZMOD_roLater(0),v("DONE RO")',
    ),
    (
        # P(): every end of a recording (stop, a full or removed medium). #26: the file lists of every
        # client again, once the recording has its final name (DLZMOD_dirsChanged; ee = stock's
        # broadcaster, the one its own UPDATE_DIRS goes through)
        "media: read-only after a recording (DLZMOD_roLater), file lists again",
        'async function P(){T("recState",k.READY),await S(50),T("recFile",""),T("hw_rec",0),await S(500)}',
        'async function P(){T("recState",k.READY),await S(50),T("recFile",""),T("hw_rec",0),await S(500),DLZMOD_roLater(),'
        "DLZMOD_dirsChanged(ee,3e3)}",
    ),
    (
        # #26: after a delete or a rename every client's file list again (stock refreshes only the
        # list of the one that asked)
        "media: file lists again after a delete",
        "async MEDIA_DELETE(e){let t=await he(e.path);return t&&kt(e.bankKey),t}",
        "async MEDIA_DELETE(e){let t=await he(e.path);return t&&(kt(e.bankKey),DLZMOD_dirsChanged(ee)),t}",
    ),
    (
        "media: file lists again after a rename",
        "}(e.path,e.newName);return t&&kt(e.bankKey),t}",
        "}(e.path,e.newName);return t&&(kt(e.bankKey),DLZMOD_dirsChanged(ee)),t}",
    ),
    (
        # the sample recorder stops into its keep/discard question; DLZMOD_roLater waits for the answer
        "media: read-only after the sample recorder (DLZMOD_roLater)",
        'async SAMPLE_REC_STOP(e){globalThis.setDataKey("sample.rec.state",ze.DECISION)}',
        'async SAMPLE_REC_STOP(e){globalThis.setDataKey("sample.rec.state",ze.DECISION),DLZMOD_roLater()}',
    ),
    (
        # /srv is served as it is: the originals patch.py and apply-mod.sh keep there stay private
        "files: kept originals not served (DLZMOD_noOrig)",
        'a=e();return a.get("/app.js",',
        # #45: other devices only with "Control from other devices" on and paired, and then only the
        # UI's own files (not srv_data.json or the presets). #26: then the recordings, read only
        # (DLZMOD_recHttp); ce() is a medium's mount point, "-" when empty. #114: a mod update sent
        # to the SD card's dlzmod-update/ (DLZMOD_updateUpload). #136: the boot log copied to the SD
        # card once a start has finished (DLZMOD_bootlogCopy; this setup runs once, at the start)
        'a=e();a.use(DLZMOD_noOrig);a.use(DLZMOD_remoteHttp);'
        'a.use(DLZMOD_recHttp((()=>[ce("sd"),ce("usb")])));a.use(DLZMOD_updateUpload((()=>ce("sd"))));'
        'DLZMOD_bootlogCopy((()=>ce("sd")));'
        'return a.get("/app.js",',
    ),
    (
        # #45: the socket.io handshake of another device needs the pairing cookie and the mixer's
        # own page as its origin (DLZMOD_allowRequest)
        "network: socket.io handshakes from other devices only when paired",
        "ct=new r(rt,{cookie:!1,allowEIO3:!0})",
        "ct=new r(rt,{cookie:!1,allowEIO3:!0,allowRequest:DLZMOD_allowRequest})",
    ),
    (
        # #45: port 89 is the screen's connection only: loopback, IPv4 and IPv6 (DLZMOD_listen89)
        "network: port 89 on loopback only",
        "pt&&pt.listen(89);",
        "pt&&DLZMOD_listen89(pt,da);",
    ),
    (
        # About's "Device IP Address" (polled every 5 s): Ethernet first as stock, else the Wi-Fi stick
        "network: About shows the Wi-Fi address when there is no Ethernet one",
        """Ce("ip addr show eth0 | grep -Pom 1 '[0-9.]{7,15}/'")""",
        """Ce("{ ip addr show eth0; ip addr show wlan0; } 2>/dev/null | grep -Pom 1 '[0-9.]{7,15}/'")""",
    ),
    (
        "update: the popup's OK (DLZMOD_UPDATE_NOTE_OK); Install (DLZMOD_UPDATE_APPROVE); Network panel (DLZMOD_NET)",
        "async FIRMWARE_UPDATE_SUCCESS_OK(){",
        "DLZMOD_UPDATE_NOTE_OK(){DLZMOD_updateNoteSeen()},"
        # #65: Install for the update waiting on the card, from the mixer's own screen only (i = its send)
        "DLZMOD_UPDATE_APPROVE(e,t,a,i){DLZMOD_updateApprove(e,i)},"
        # Network panel (Wi-Fi, SSH): answers go to this screen only (i = its send); not awaited,
        # so a 45 s Wi-Fi connect does not hold up the screen's other commands
        "DLZMOD_NET(e,t,a,i){DLZMOD_net(e,i)},"
        # Time tab (#9): the time zone; answers to the sender only (i), changes from the screen and
        # paired devices (DLZMOD_time)
        "DLZMOD_TIME(e,t,a,i){DLZMOD_time(e,i)},"
        "async FIRMWARE_UPDATE_SUCCESS_OK(){",
    ),
]

# #131 the sound behind the EQ curve (graph-mod/dlzmod-graph.js): its meters, its buffer cleared at
# the start of each cycle, and a tap right after each channel's EQ (after Mackie's "dynin" meter, on
# the buffer(s) that meter reads)
GRAPH_PATCHES = [
    (
        "eq spectrum: its meters as the VU group dlzmod.rta",
        "configureVU({\n",
        "configureVU({\n    'dlzmod.rta': DLZMOD_rtaMeters(),\n",
    ),
    (
        "eq spectrum: its buffer cleared each cycle",
        "    {type: 'Clear', buf: masterL}, {type: 'Clear', buf: masterR},\n",
        "    {type: 'Clear', buf: DLZMOD_rtaBuf()},\n"
        "    {type: 'Clear', buf: masterL}, {type: 'Clear', buf: masterR},\n",
    ),
    (
        "eq spectrum: mics",
        "        {type: 'MaxMeter', vu: `vuInDynIn${i}`, threshold: VU_THRESHOLD},\n",
        "        {type: 'MaxMeter', vu: `vuInDynIn${i}`, threshold: VU_THRESHOLD},\n"
        "        DLZMOD_rtaTap(1 + i, [workBuf]),\n",
    ),
    (
        "eq spectrum: samples",
        "    workBufR, {type: 'MaxMeter', vu: `vuSmpDynIn`, threshold: VU_THRESHOLD},\n",
        "    workBufR, {type: 'MaxMeter', vu: `vuSmpDynIn`, threshold: VU_THRESHOLD},\n"
        "    DLZMOD_rtaTap(7, [workBuf, workBufR]),\n",
    ),
    (
        "eq spectrum: players",
        "        workBufR, {type: 'MaxMeter', vu: `vuPlDynIn${i}`, threshold: VU_THRESHOLD},\n",
        "        workBufR, {type: 'MaxMeter', vu: `vuPlDynIn${i}`, threshold: VU_THRESHOLD},\n"
        "        DLZMOD_rtaTap(3 + i, [workBuf, workBufR]),\n",
    ),
    (
        "eq spectrum: virtual channels",
        "        workBufR, {type: 'MaxMeter', vu: `vuViDynIn${i}`, threshold: VU_THRESHOLD},\n",
        "        workBufR, {type: 'MaxMeter', vu: `vuViDynIn${i}`, threshold: VU_THRESHOLD},\n"
        "        DLZMOD_rtaTap(5 + i, [workBuf, workBufR]),\n",
    ),
    (
        "eq spectrum: master",
        "    masterR, {type: 'MaxMeter', vu: `vuMasterDynIn`, threshold: VU_THRESHOLD},\n",
        "    masterR, {type: 'MaxMeter', vu: `vuMasterDynIn`, threshold: VU_THRESHOLD},\n"
        "    DLZMOD_rtaTap(8, [masterL, masterR]),\n",
    ),
    (
        # after everything of Mackie's, right before the file compiles its graph
        "eq spectrum: the analyser",
        "\ncompileGraph(graph)\n",
        "\ngraph.push(DLZMOD_rtaAnalyser())\n\ncompileGraph(graph)\n",
    ),
]

# target: (patches, appended mod file, stamp the mod version into it)
TARGETS = {
    "app": (APP_PATCHES, HERE / "app-mod" / "dlzmod.js", True),
    "server": (SERVER_PATCHES, HERE / "server-mod" / "dlzmod-server.js", False),
    "graph": (GRAPH_PATCHES, HERE / "graph-mod" / "dlzmod-graph.js", False),
}


def main():
    args = sys.argv[1:]
    check = args[:1] == ["--check"]
    if check:
        args = args[1:]
    if len(args) != 2 or args[0] not in TARGETS:
        sys.exit(__doc__)
    patches, mod_js, stamp = TARGETS[args[0]]
    target = Path(args[1])
    orig = target.with_name(target.name + ".orig")
    if check:   # the stock file itself (or its kept original); nothing is written, not even .orig
        orig = orig if orig.exists() else target
    elif not orig.exists():
        write_atomic(orig, target.read_bytes())
    # bytes in, bytes out: no newline translation, so Windows and Linux builds are identical
    src = orig.read_bytes().decode("utf-8")

    for what, anchor, repl in patches:
        n = src.count(anchor)
        if n != 1:
            sys.exit(f"anchor for '{what}' found {n} times, expected 1; nothing written")
        src = src.replace(anchor, repl)
        print(f"{'anchor ok' if check else 'patched'}: {what}")

    mod = mod_js.read_bytes().decode("utf-8").replace("\r\n", "\n")
    note = ""
    if stamp:
        version = read_version()
        if mod.count(VERSION_PLACEHOLDER) != 1:
            sys.exit(f"{mod_js.name}: expected one {VERSION_PLACEHOLDER}; nothing written")
        mod = mod.replace(VERSION_PLACEHOLDER, version)
        note = f" ({version})"
    if check:
        print(f"check ok: {len(patches)} anchors in {orig}, {mod_js.name}{note}")
        return
    src += "\n;" + mod
    write_atomic(target, src.encode("utf-8"))
    print(f"appended {mod_js.name}{note}; wrote {target} (original: {orig.name})")


if __name__ == "__main__":
    main()
