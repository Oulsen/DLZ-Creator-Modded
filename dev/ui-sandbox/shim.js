// Preloaded into Mackie's server.js by ui-sandbox.sh (node -r shim.js server.js).
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

const SAVE_MV = /^mv (\S+srv_data\.json)\.tmp \1$/;
// Read-only queries polled by server.js: answer "no media, no network" instead of failing
const CANNED = [
  [/^lsblk -OJ$/, '{"blockdevices":[]}'],
  [/^ip addr show eth0\b/, ''],
];
const logged = new Set();

function run(cmd) {
  const mv = SAVE_MV.exec(cmd);
  if (mv) {
    fs.renameSync(mv[1] + '.tmp', mv[1]);
    return '';
  }
  if (/^sync( -d \S+)?$/.test(cmd)) return '';
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
// be tried. The mod's own keyfiles land in S:\etc\NetworkManager\system-connections (= dumps/sandbox
// on the subst drive). No stick: DLZ_FAKE_WIFI=nostick. Password "12345678" acts as a wrong one.
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
