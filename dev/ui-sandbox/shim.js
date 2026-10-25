// Preloaded into Mackie's server.js by ui-sandbox.sh (node -r shim.js server.js).
// - the mixer's paths in the sandbox folder (DLZ_SANDBOX_ROOT): /srv, /tmp, /root ... without a drive
// - no shell commands: server.js runs mkfs/dd/parted/mount/systemctl, all blocked and logged,
//   except the mv + sync it uses to save srv_data.json (done natively here)
// - ports 80/89 bound to 127.0.0.1 only, so the unauthenticated mixer API stays off the LAN, and
//   only requests from the sandbox page itself (Host and Origin checked; on the plain port 89 only
//   connections that start with a JSON command): no other web page can use it
// - index.html always opens in the on-device layout (#INT), stretched like the device panel
'use strict';
const cp = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const util = require('util');

// server.js uses the mixer's absolute paths (/srv, /root/.dlzlite, /tmp/mnt, /dev/disk/by-id, /etc).
// On Windows those would land at the root of the current drive, so the file calls take them to the
// sandbox folder: a path under one of these top folders, written as /srv/... or as path.resolve
// gives it on Windows (<the sandbox's drive>:\srv\...). Everything else as it is. Without
// DLZ_SANDBOX_ROOT no start: those paths, and what the shim itself writes there, would hit a real drive.
const ROOT = process.env.DLZ_SANDBOX_ROOT || '';
if (!ROOT || !fs.existsSync(path.join(ROOT, 'srv', 'server.js'))) {
  console.error('[sandbox] DLZ_SANDBOX_ROOT must be the sandbox folder (with srv/server.js): start it with dev/ui-sandbox.sh');
  process.exit(1);
}
const TOPS = new Set(['srv', 'tmp', 'etc', 'root', 'dev', 'proc', 'boot']);
const ROOT_DRIVE = path.win32.parse(ROOT).root.slice(0, 1).toLowerCase();
const ROOT_LOW = path.resolve(ROOT).toLowerCase();
const inRoot = (p) => {
  const r = path.relative(ROOT_LOW, path.resolve(p).toLowerCase());
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
function inSandbox(p) {
  if (Buffer.isBuffer(p)) p = p.toString();
  else if (p instanceof URL && p.protocol === 'file:') p = require('url').fileURLToPath(p);
  if (typeof p !== 'string') return p;
  let rest = null;
  if (/^[\\/](?![\\/])/.test(p)) rest = p.slice(1);   // /srv/x, not a share (//host)
  else {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
    // the sandbox's own files stay as they are (a repo under D:\dev\ or D:\tmp\ too)
    if (m && m[1].toLowerCase() === ROOT_DRIVE && !inRoot(p)) rest = m[2];
  }
  if (rest === null || !TOPS.has(rest.split(/[\\/]/)[0].toLowerCase())) return p;
  const out = path.join(ROOT, rest);
  // never out of the sandbox folder (/tmp/../../x)
  if (!inRoot(out)) throw Object.assign(new Error(`sandbox: ${p} leads out of the sandbox folder`), { code: 'EACCES' });
  return out;
}
// the calls that take a path (first, or the first two), in fs and fs.promises; never the fd ones,
// whose string argument is data
const ONE = ['access', 'appendFile', 'chmod', 'chown', 'createReadStream', 'createWriteStream', 'exists', 'lchown',
  'lstat', 'lutimes', 'mkdir', 'mkdtemp', 'open', 'opendir', 'readdir', 'readFile', 'readlink', 'realpath', 'rm', 'rmdir',
  'stat', 'statfs', 'truncate', 'unlink', 'unwatchFile', 'utimes', 'watch', 'watchFile', 'writeFile'];
const TWO = ['copyFile', 'cp', 'link', 'rename', 'symlink'];
function redirect(obj, name, two) {
  const f = obj[name];
  if (typeof f !== 'function') return;
  obj[name] = function (a, b, ...rest) {
    return f.call(this, inSandbox(a), two ? inSandbox(b) : b, ...rest);
  };
  if (typeof f.native === 'function') {   // fs.realpath.native
    obj[name].native = f.native;
    redirect(obj[name], 'native', two);
  }
  const custom = f[util.promisify.custom];   // util.promisify(fs.exists)
  if (typeof custom === 'function') obj[name][util.promisify.custom] = (a, ...rest) => custom(inSandbox(a), ...rest);
}
for (const [names, two] of [[ONE, false], [TWO, true]]) {
  for (const n of names) {
    redirect(fs, n, two);
    redirect(fs, n + 'Sync', two);
    redirect(fs.promises, n, two);
  }
}

const SAVE_MV = /^mv (\S+srv_data\.json)\.tmp \1$/;
// Read-only queries polled by server.js: answer "no media, no network" instead of failing
const CANNED = [
  [/^lsblk -OJ$/, '{"blockdevices":[]}'],
  [/^ip addr show eth0\b/, ''],
];
const logged = new Set();

// DLZ_FAKE_MEDIA=sd, usb or sd,usb: a pretend SD card (its recordings part, mmcblk0p2) and/or USB
// stick (sda1), so the player's lists and the recordings download (#26) can be tried. server.js
// finds them in lsblk, "mounts" them (a folder tmp/mnt/<name> in the sandbox folder, seeded once
// with a few short silent recordings) and finds them mounted at the next lsblk. Remounts are
// no-ops; /proc/mounts lists them read-only, so the mod's read-only watcher (#98) is content.
// Off by default: other screens expect no media.
const FAKE_MEDIA = (process.env.DLZ_FAKE_MEDIA || '').split(',').filter((m) => m === 'sd' || m === 'usb')
  .map((m) => m === 'sd'
    ? { name: 'mmcblk0p2', parent: 'mmcblk0', subsystems: 'block:mmc:mmc_host:platform', label: 'DLZDATA', mounted: false }
    : { name: 'sda1', parent: 'sda', subsystems: 'block:scsi:usb:platform', label: 'STICK', mounted: false });
// an earlier run's list (the sandbox folder is shared between sessions): none until something mounts.
// (in the sandbox folder, like every root path here)
fs.rmSync('/proc/mounts', { force: true });
function fakeLsblk() {
  return JSON.stringify({ blockdevices: FAKE_MEDIA.map((d) => ({
    name: d.parent, path: '/dev/' + d.parent, fstype: null, mountpoint: null, subsystems: d.subsystems, size: '59.5G',
    children: [{ name: d.name, path: '/dev/' + d.name, fstype: 'vfat', label: d.label, subsystems: d.subsystems,
      mountpoint: d.mounted ? '/tmp/mnt/' + d.name : null, size: '58G', fsavail: '41.2G' }],
  })) });
}
// a silent 16-bit stereo 48 kHz WAV of `seconds`
function silentWav(seconds) {
  const data = seconds * 48000 * 4;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(192000, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data, 40);
  return Buffer.concat([h, Buffer.alloc(data)]);
}
function fakeMount(d) {
  const mnt = '/tmp/mnt/' + d.name;
  const rec = mnt + '/DLZ_Creator_XS_Recordings';
  if (!fs.existsSync(rec)) {
    fs.mkdirSync(rec + '/REC_0005', { recursive: true });
    const put = (name, seconds, minutesAgo) => {
      fs.writeFileSync(rec + '/' + name, silentWav(seconds));
      const t = new Date(Date.now() - minutesAgo * 60000);
      fs.utimesSync(rec + '/' + name, t, t);
    };
    put('REC_0001_otter.wav', 3, 600);
    put('REC_0002_owl.wav', 8, 300);
    put('Band take.wav', 5, 120);
    put('REC_0004_yak.wav', 2, 30);
    put('REC_0006_emu.wav.unfinished', 1, 1);
  }
  d.mounted = true;
  fs.mkdirSync('/proc', { recursive: true });
  fs.writeFileSync('/proc/mounts', FAKE_MEDIA.filter((m) => m.mounted)
    .map((m) => `/dev/${m.name} /tmp/mnt/${m.name} vfat ro,noatime,flush 0 0\n`).join(''));
}
const FAKE_MOUNT = /^mkdir -p '\/tmp\/mnt\/(\w+)' && mount -o ro,noatime(,flush)? '\/dev\/\1' '\/tmp\/mnt\/\1' +\|\| true$/;

function run(cmd) {
  const mv = SAVE_MV.exec(cmd);
  if (mv) {
    fs.renameSync(mv[1] + '.tmp', mv[1]);
    return '';
  }
  if (/^sync( -d \S+)?$/.test(cmd)) return '';
  if (FAKE_MEDIA.length) {
    if (cmd === 'lsblk -OJ') return fakeLsblk();
    const m = FAKE_MOUNT.exec(cmd);
    const d = m && FAKE_MEDIA.find((x) => x.name === m[1]);
    if (d) {
      fakeMount(d);
      console.log(`[sandbox] fake: mounted ${d.name} at ${inSandbox('/tmp/mnt/' + d.name)}`);
      return '';
    }
    // by mount point (recording) or by device (rename, delete: unguarded, an error ends server.js)
    const rm = /^mount -o remount,r[ow] (?:\/tmp\/mnt|\/dev)\/(\w+)$/.exec(cmd);
    if (rm && FAKE_MEDIA.some((x) => x.name === rm[1])) return '';
    // Mackie's look for a firmware file on a new medium (unguarded: an error would end server.js)
    if (/^\s*find \/tmp\/mnt\/\w+ -name \*\.upd /.test(cmd)) return '';
    const df = /^df (\/tmp\/mnt\/\w+)$/.exec(cmd);
    if (df) return `Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/x 60817408 17612800 43204608 29% ${df[1]}\n`;
  }
  // About's address with the mod's patch (eth0, then wlan0): the pretend stick's when connected
  if (/^\{ ip addr show eth0; ip addr show wlan0; \}/.test(cmd)) {
    if (fakeNet.connected) return '192.168.1.42/\n';
    throw Object.assign(new Error('no address'), { code: 1, stdout: '', stderr: '' });
  }
  const canned = CANNED.find(([re]) => re.test(cmd));
  if (canned) return canned[1];
  if (!logged.has(cmd)) {
    logged.add(cmd);
    console.log(`[sandbox] blocked: ${cmd}`);
  }
  throw Object.assign(new Error(`blocked by sandbox: ${cmd}`), { code: 1, stdout: '', stderr: '' });
}

function exec(cmd, opts, cb) {
  if (typeof opts === 'function') cb = opts;
  let err = null;
  let out = '';
  try {
    out = run(cmd);
  } catch (e) {
    err = e;
  }
  if (cb) process.nextTick(cb, err, out, '');
}
exec[util.promisify.custom] = (cmd) =>
  new Promise((resolve, reject) => {
    try {
      resolve({ stdout: run(cmd), stderr: '' });
    } catch (e) {
      reject(e);
    }
  });
cp.exec = exec;

function blockedSync(name) {
  return (cmd, args) => {
    throw new Error(`blocked by sandbox: ${name} ${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`);
  };
}
for (const name of ['execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
  cp[name] = blockedSync(name);
}

// Network panel (dlzmod-server.js, DLZMOD_net): a pretend Wi-Fi stick and SSH, so the screens can
// be tried. The mod's own keyfiles land in etc/NetworkManager/system-connections in the sandbox
// folder. No stick: DLZ_FAKE_WIFI=nostick. Password "12345678" acts as a wrong one.
// Stdin (passwords) is never logged.
const FAKE_NM = '/etc/NetworkManager/system-connections';
fs.mkdirSync(FAKE_NM, { recursive: true });
const fakeNet = {
  stick: process.env.DLZ_FAKE_WIFI !== 'nostick',
  connected: null,
  ssh: false,
  loaded: {},
  aps: [
    ['Studio 5G', 82, 'WPA2'], ['Studio 5G', 61, 'WPA2'], ['Home-Network', 74, 'WPA2 WPA3'],
    ['Cafe Gratis', 51, ''], ['Office:Guest', 40, 'WPA2 802.1X'], ['Neighbour \\ Net', 22, 'WPA1 WPA2'],
    ['', 30, 'WPA2'], ['New WPA3', 35, 'WPA3'],
  ],
};
const nmEsc = (v) => String(v).replace(/[\\:]/g, (c) => '\\' + c);
function fakeExec(file, args) {
  const a = args.join(' ');
  const prog = path.posix.basename(file);
  if (prog === 'nmcli') {
    if (/device status$/.test(a)) {
      return [0, 'eth0:ethernet:unavailable\n' + (fakeNet.stick ? 'wlan0:wifi:' + (fakeNet.connected ? 'connected' : 'disconnected') + '\n' : ''), '', 0];
    }
    if (/device wifi list/.test(a)) {
      if (!fakeNet.stick) return [10, '', 'Error: No Wi-Fi device found.', 0];
      return [0, fakeNet.aps.map(([s, sig, sec], i) => (s && s === fakeNet.connected && fakeNet.aps.findIndex((x) => x[0] === s) === i ? '*' : ' ') + ':' + nmEsc(s) + ':' + sig + ':' + sec).join('\n') + '\n',
        '', /--rescan yes/.test(a) ? 1500 : 0];
    }
    if (/^-g IP4.ADDRESS/.test(a)) return [0, fakeNet.connected ? '192.168.1.42/24\n' : '\n', '', 0];
    let m = /^connection load (.+)$/.exec(a);
    if (m) {
      const kf = fs.readFileSync(m[1], 'utf8');
      const uuid = /^uuid=(.+)$/m.exec(kf)[1];
      const ssid = Buffer.from(/^ssid=(.+)$/m.exec(kf)[1].split(';').filter(Boolean).map(Number)).toString();
      const psk = (/^psk=(.*)$/m.exec(kf) || [])[1];
      fakeNet.loaded[uuid] = { ssid, wrong: psk === '12345678' };
      return [0, '', '', 0];
    }
    m = /^--wait \d+ connection up uuid (.+)$/.exec(a);
    if (m) {
      const c = fakeNet.loaded[m[1]];
      if (!c || c.wrong) return [4, '', 'Error: Connection activation failed: Secrets were required, but not provided.', 3000];
      fakeNet.connected = c.ssid;
      return [0, 'Connection successfully activated', '', 3000];
    }
    m = /^connection delete uuid (.+)$/.exec(a);
    if (m) {
      const c = fakeNet.loaded[m[1]];
      if (c && c.ssid === fakeNet.connected) fakeNet.connected = null;
      delete fakeNet.loaded[m[1]];
      return [0, '', '', 0];
    }
  }
  if (prog === 'systemctl' && a === 'is-active ssh') return [fakeNet.ssh ? 0 : 3, fakeNet.ssh ? 'active\n' : 'inactive\n', '', 0];
  if (prog === 'systemctl' && /^(enable|disable) --now ssh$/.test(a)) {
    fakeNet.ssh = a.startsWith('enable');
    return [0, '', '', 800];
  }
  if (['chpasswd', 'ssh-keygen', 'sync'].includes(prog)) return [0, '', '', 200];
  // the mod's read-only remount (#98) of a pretend medium (DLZ_FAKE_MEDIA)
  if (prog === 'mount' && FAKE_MEDIA.length && /^-o remount,ro \/tmp\/mnt\/\w+$/.test(a)) return [0, '', '', 100];
  return null;
}
cp.execFile = function (file, args, opts, cb) {
  if (typeof opts === 'function') cb = opts;
  // the mod runs everything as `chrt -o 0 nice -n 20 <program> ...` (normal priority): unwrap
  const w = /^\/usr\/bin\/chrt$/.test(file) && (args || []).slice(0, 5).join(' ') === '-o 0 /usr/bin/nice -n 20';
  if (w) [file, args] = [args[5], args.slice(6)];
  const r = fakeExec(file, args || []);
  const stdin = { on() { return this; }, end() {} };   // the parts of a child's stdin the mod uses
  if (!r) {
    const cmd = file + ' ' + (args || []).join(' ');
    if (!logged.has(cmd)) {
      logged.add(cmd);
      console.log(`[sandbox] blocked: ${cmd}`);
    }
    process.nextTick(cb, Object.assign(new Error('blocked by sandbox: ' + cmd), { code: 1 }), '', '');
    return { stdin };
  }
  const [code, out, err, delay] = r;
  console.log(`[sandbox] fake: ${file} ${(args || []).join(' ')}`);
  setTimeout(() => cb(code ? Object.assign(new Error(err || 'exit ' + code), { code }) : null, out, err), delay);
  return { stdin };
};

// Always the on-device layout: app.js only reads the hash at start, so set #INT before it loads.
// (In a browser app.js otherwise runs as a remote control, without the knob panel.)
const FORCE_INT = '<script>location.hash.toUpperCase()==="#INT"||history.replaceState(null,"","#INT")</script>';
// The 7" 1024x600 panel has non-square pixels (154.2 x 85.9 mm active area: 0.1506 x 0.1432 mm),
// so the device shows everything 5.2% wider. Mouse input uses offsetX/Y, which honours transforms.
const PANEL_ASPECT = '<style>.app{transform:translate(-50%,-50%) scaleX(1.052)}</style>';
// No audio on the PC: moving fake meter levels after app.js (fake-vu-live.js, served from this folder
// at a path Mackie's server does not use; off with /?novu)
const FAKE_VU_URL = '/dlzmod-sandbox/fake-vu-live.js';
const FAKE_VU = '<script src="' + FAKE_VU_URL + '"></script>';
// Only this PC's own browser tab: listening on 127.0.0.1 alone still lets any web page open in the
// browser reach the server (a WebSocket is not held back by CORS; DNS rebinding gets around the
// address), and server.js deletes and renames files for its clients. So the Host must be this PC
// and an Origin, when the browser sends one, must be this sandbox's page.
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:(80|89))?$/i;
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:(80|89))?$/i;
function fromThisPc(req) {
  const origin = req.headers.origin;
  return LOCAL_HOST.test(req.headers.host || '') && (origin === undefined || LOCAL_ORIGIN.test(origin));
}
// DLZ_SANDBOX_REMOTE=1: http://localhost/ plays another device on the network (a phone): the mod
// sees a LAN address on that connection and the page is Mackie's own index.html (the browser
// layout), so control from other devices and pairing (#45) can be tried on this PC.
// http://127.0.0.1/ stays the mixer's own screen; the browser keeps a cookie per host, so the two
// stay apart. Still this PC only (Host and Origin as above).
const REMOTE = process.env.DLZ_SANDBOX_REMOTE === '1';
const PRETEND_PHONE = '192.0.2.10';
function asPhone(req) {
  if (!REMOTE || !/^localhost(:80)?$/i.test(req.headers.host || '')) return false;
  Object.defineProperty(req.socket, 'remoteAddress', { value: PRETEND_PHONE, configurable: true });
  return true;
}
const http = require('http');
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res) {
  if ((event === 'request' || event === 'upgrade') && !fromThisPc(req)) {
    const why = `host ${req.headers.host || '-'}, origin ${req.headers.origin || '-'}`;
    if (!logged.has(why)) {
      logged.add(why);
      console.log(`[sandbox] refused a request not from this PC's sandbox page (${why})`);
    }
    if (event === 'upgrade') res.destroy();   // res is the raw socket here
    else { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('sandbox: this PC only\n'); }
    return true;
  }
  const phone = (event === 'request' || event === 'upgrade') && asPhone(req);
  if (!phone && event === 'request' && req.method === 'GET' && /^\/(index\.html)?(\?.*)?$/.test(req.url)) {
    let html = fs.readFileSync('index.html', 'utf8')
      .replace('<script src="app.js">', FORCE_INT + '\n  <script src="app.js">')
      .replace('</head>', PANEL_ASPECT + '\n</head>');
    if (!/[?&]novu\b/.test(req.url)) html = html.replace('</body>', FAKE_VU + '\n</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return true;
  }
  if (event === 'request' && req.method === 'GET' && req.url === FAKE_VU_URL) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'fake-vu-live.js')));
    return true;
  }
  return emit.apply(this, arguments);
};

const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'number' && typeof args[1] !== 'string') args.splice(1, 0, '127.0.0.1');
  return listen.apply(this, args);
};

// Port 89 is a plain socket (one JSON command per line), so the Host/Origin check above does not
// cover it: a web page can still POST to 127.0.0.1:89, and the lines after its HTTP headers would run
// as this PC's own commands. So a connection must start with a JSON command: its first non-blank byte
// is "[" or "{", or it is closed before server.js sees any of it (an HTTP request starts with its
// method, whatever its length; leading blanks are held back until that byte is in).
const netEmit = net.Server.prototype.emit;
net.Server.prototype.emit = function (event, socket) {
  if (event === 'connection' && !(this instanceof http.Server)) {
    const sockEmit = socket.emit;
    let held = Buffer.alloc(0);
    socket.emit = function (ev, chunk) {
      if (ev !== 'data') return sockEmit.apply(this, arguments);
      held = Buffer.concat([held, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const first = held.toString('latin1').search(/\S/);
      if (first < 0) return true;
      socket.emit = sockEmit;
      if (held[first] !== 0x5b && held[first] !== 0x7b) {
        if (!logged.has('not json on 89')) {
          logged.add('not json on 89');
          console.log('[sandbox] refused a connection on port 89 that does not start with a JSON command (a web page?)');
        }
        socket.destroy();
        return true;
      }
      return sockEmit.call(this, 'data', typeof chunk === 'string' ? held.toString() : held);
    };
  }
  return netEmit.apply(this, arguments);
};

console.log('[sandbox] shell commands blocked, listening on 127.0.0.1 only' +
  (REMOTE ? '; http://localhost/ plays a phone on the network' : ''));
