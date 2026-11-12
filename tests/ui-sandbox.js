// The UI sandbox's guards (dev/ui-sandbox/shim.js, #281): what keeps Mackie's unauthenticated mixer API
// on this PC away from other web pages and the network, and the shell away from server.js.
//   node tests/ui-sandbox.js
// No dump, no root, no ports 80/89: the shim runs in front of a stand-in server.js (an HTTP server and a
// plain socket like port 89, on free ports), in a folder under build/ (not under /tmp: the shim takes
// /tmp, /srv, /root ... into the sandbox folder, its own folder too). The stand-in also tries the
// shell and paths out of the folder from inside, and reports what happened. The requests set their
// Host header themselves, as a browser at http://127.0.0.1/ would.
'use strict';
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SHIM = path.join(REPO, 'dev', 'ui-sandbox', 'shim.js');
const BUILD = path.join(REPO, 'build');
fs.mkdirSync(BUILD, { recursive: true });
const ROOT = fs.mkdtempSync(path.join(BUILD, 'ui-sandbox-test-'));

const STAND_IN = `'use strict';
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const report = {};
const tryIt = (name, f) => { try { report[name] = 'done: ' + f(); } catch (e) { report[name] = 'refused: ' + (e.code || '') + ' ' + e.message; } };
tryIt('escape', () => fs.readFileSync('/srv/../../escape.txt', 'utf8'));
tryIt('write', () => { fs.mkdirSync('/tmp', { recursive: true }); fs.writeFileSync('/tmp/probe', 'x'); return 'ok'; });
tryIt('spawn', () => cp.spawn('rm', ['-rf', '/']));
tryIt('execSync', () => cp.execSync('rm -rf /'));
cp.exec('rm -rf /', (err) => {
  report.exec = err ? 'refused: ' + err.message : 'done';
  const web = http.createServer((req, res) => res.end('mackie:' + req.url));
  web.on('upgrade', (req, sock) => sock.end('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n'));
  web.listen(0, () => {
    const plain = net.createServer((s) => s.on('data', (d) => s.end('got:' + d)));
    plain.listen(0, () => {
      report.web = web.address();
      report.plain = plain.address();
      console.log('READY ' + JSON.stringify(report));
    });
  });
});
`;
fs.mkdirSync(path.join(ROOT, 'srv'));
fs.writeFileSync(path.join(ROOT, 'srv', 'server.js'), STAND_IN);
fs.writeFileSync(path.join(ROOT, 'srv', 'index.html'),
  '<html><head>\n  <script src="app.js"></script>\n</head><body>mackie index</body></html>\n');
fs.mkdirSync(path.join(ROOT, 'root'));

let failed = 0;
let n = 0;
async function check(name, f) {
  n++;
  try {
    await f();
    console.log('ok    ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + ': ' + e.message);
  }
}

// the shim in front of the stand-in; resolves with its report once it listens
function start(env) {
  const child = cp.spawn(process.execPath, ['-r', SHIM, 'server.js'], {
    cwd: path.join(ROOT, 'srv'),
    env: { ...process.env, DLZ_SANDBOX_ROOT: ROOT, DLZ_SANDBOX_LOOP: '', DLZ_SANDBOX_REMOTE: '', DLZ_FAKE_MEDIA: '',
      DLZ_FAKE_WIFI: '', DLZ_SANDBOX_BRANCH: '', DLZ_SANDBOX_COMMIT: '', DLZ_SANDBOX_DIRTY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.exited = new Promise((ok) => child.on('exit', (code) => ok(code)));
  child.ready = new Promise((ok, fail) => {
    child.stdout.on('data', (d) => {
      out += d;
      const m = /^READY (.*)$/m.exec(out);
      if (m) ok(JSON.parse(m[1]));
    });
    child.stderr.on('data', (d) => { out += d; });
    child.exited.then((code) => fail(new Error('the shim ended (' + code + ') before it listened:\n' + out)));
    setTimeout(() => fail(new Error('no start in 15 s:\n' + out)), 15000);
  });
  child.output = () => out;
  return child;
}

// one HTTP request with the given Host and Origin: { status, body }
function request(port, { method = 'GET', url = '/', host = '127.0.0.1', origin } = {}) {
  return new Promise((ok, fail) => {
    const headers = { Host: host };
    if (origin !== undefined) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

// a WebSocket-style upgrade: 'upgraded' or 'closed'
function upgrade(port, origin) {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/socket.io/', headers: {
      Host: '127.0.0.1', Origin: origin, Connection: 'Upgrade', Upgrade: 'websocket' } });
    req.on('upgrade', (res, sock) => { sock.destroy(); ok('upgraded'); });
    req.on('response', () => ok('answered'));
    req.on('error', (e) => (e.code === 'ECONNRESET' || /socket hang up/.test(e.message) ? ok('closed') : fail(e)));
    req.end();
  });
}

// raw bytes to the plain socket: what comes back before it closes
function plain(port, text) {
  return new Promise((ok, fail) => {
    let got = '';
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    s.on('data', (d) => { got += d; });
    s.on('close', () => ok(got));
    s.on('error', (e) => (e.code === 'ECONNRESET' ? ok(got) : fail(e)));
    setTimeout(() => { s.destroy(); ok(got); }, 3000);
  });
}

async function main() {
  await check('no start without DLZ_SANDBOX_ROOT', async () => {
    const code = await new Promise((ok) => cp.spawn(process.execPath, ['-r', SHIM, '-e', ''], {
      env: { ...process.env, DLZ_SANDBOX_ROOT: '' }, stdio: 'ignore' }).on('exit', ok));
    assert.strictEqual(code, 1);
  });

  // XS (/root/.dlzlite in the folder), not started by dev/ui-sandbox.sh
  fs.writeFileSync(path.join(ROOT, 'root', '.dlzlite'), '');
  const a = start({});
  try {
    const r = await a.ready;
    const W = r.web.port;
    const P = r.plain.port;

    await check('both servers bound to 127.0.0.1 only', () => {
      assert.strictEqual(r.web.address, '127.0.0.1');
      assert.strictEqual(r.plain.address, '127.0.0.1');
    });
    await check('a path out of the sandbox folder is refused', () => assert.match(r.escape, /^refused: EACCES/));
    await check('/tmp lands in the sandbox folder', () => {
      assert.strictEqual(r.write, 'done: ok');
      assert.ok(fs.existsSync(path.join(ROOT, 'tmp', 'probe')));
    });
    await check('shell commands are blocked (exec, execSync, spawn)', () => {
      assert.match(r.exec, /^refused: blocked by sandbox/);
      assert.match(r.execSync, /^refused: .*blocked by sandbox/);
      assert.match(r.spawn, /^refused: .*blocked by sandbox/);
    });

    await check('/ is the dev page', async () => {
      const x = await request(W, { url: '/' });
      assert.strictEqual(x.status, 200);
      assert.match(x.body, /<title>DLZ Sandbox<\/title>/);
    });
    await check('/index.html is Mackie\'s page in the device layout', async () => {
      const x = await request(W, { url: '/index.html' });
      assert.strictEqual(x.status, 200);
      assert.match(x.body, /mackie index/);
      assert.match(x.body, /"#INT"/);
    });
    await check('this PC\'s own requests reach Mackie\'s server', async () => {
      for (const [host, origin] of [['127.0.0.1', undefined], ['localhost', 'http://localhost'], ['127.0.0.1:89', 'http://127.0.0.1:80']]) {
        const x = await request(W, { url: '/data', host, origin });
        assert.strictEqual(x.body, 'mackie:/data', `${host} ${origin}`);
      }
    });
    await check('another host is refused (other names, ports, DNS rebinding)', async () => {
      for (const host of ['evil.example', '127.0.0.1.evil.example', '127.0.0.1:8080', '192.168.1.5', '']) {
        const x = await request(W, { url: '/data', host });
        assert.strictEqual(x.status, 403, host);
        assert.doesNotMatch(x.body, /mackie/, host);
      }
    });
    await check('another web page (Origin) is refused', async () => {
      for (const origin of ['http://evil.example', 'http://127.0.0.1:8080', 'https://127.0.0.1', 'null']) {
        const x = await request(W, { url: '/data', origin });
        assert.strictEqual(x.status, 403, origin);
      }
    });
    await check('a WebSocket from another web page is closed, from the sandbox page upgraded', async () => {
      assert.strictEqual(await upgrade(W, 'http://evil.example'), 'closed');
      assert.strictEqual(await upgrade(W, 'http://127.0.0.1'), 'upgraded');
    });
    await check('port 89: a connection that does not start with JSON is closed unread', async () => {
      assert.strictEqual(await plain(P, 'POST / HTTP/1.1\r\nHost: 127.0.0.1:89\r\n\r\n["x"]\n'), '');
      assert.strictEqual(await plain(P, '  \n GET'), '');
    });
    await check('port 89: a JSON command goes through', async () => {
      assert.strictEqual(await plain(P, ' ["cmd"]\n'), 'got: ["cmd"]\n');
      assert.strictEqual(await plain(P, '{"a":1}\n'), 'got:{"a":1}\n');
    });

    await check('/__dev/model says the XS, the mod version and what was patched in', async () => {
      const x = JSON.parse((await request(W, { url: '/__dev/model' })).body);
      assert.strictEqual(x.model, 'xs');
      assert.strictEqual(x.version, fs.readFileSync(path.join(REPO, 'VERSION'), 'utf8').trim());
      assert.strictEqual(x.branch, '');
      assert.strictEqual(x.dirty, false);
      assert.deepStrictEqual(x.extras, []);
      assert.ok(Date.now() - Date.parse(x.started) < 60000);
    });
    await check('the switch: only a POST, only with this PC\'s Origin', async () => {
      assert.strictEqual((await request(W, { url: '/__dev/switch' })).status, 404);
      assert.strictEqual((await request(W, { method: 'POST', url: '/__dev/switch' })).status, 403);
      assert.strictEqual((await request(W, { method: 'POST', url: '/__dev/switch', origin: 'http://evil.example' })).status, 403);
      assert.strictEqual((await request(W, { method: 'POST', url: '/__dev/switch', host: 'evil.example', origin: 'http://127.0.0.1' })).status, 403);
    });
    await check('the switch: refused when not started by dev/ui-sandbox.sh, the server keeps running', async () => {
      assert.strictEqual((await request(W, { method: 'POST', url: '/__dev/switch', origin: 'http://127.0.0.1' })).status, 409);
      assert.strictEqual((await request(W, { url: '/data' })).body, 'mackie:/data');
    });
  } finally {
    a.kill();
    await a.exited;
  }

  // full-size (no /root/.dlzlite), started as dev/ui-sandbox.sh does
  fs.rmSync(path.join(ROOT, 'root', '.dlzlite'));
  const b = start({ DLZ_SANDBOX_LOOP: '1', DLZ_SANDBOX_BRANCH: 'feature/x', DLZ_SANDBOX_COMMIT: 'abc1234', DLZ_SANDBOX_DIRTY: '1', DLZ_FAKE_MEDIA: 'sd,usb' });
  try {
    const W = (await b.ready).web.port;
    await check('/__dev/model says the full-size, the checkout and the extras', async () => {
      const x = JSON.parse((await request(W, { url: '/__dev/model' })).body);
      assert.strictEqual(x.model, 'full');
      assert.deepStrictEqual([x.branch, x.commit, x.dirty], ['feature/x', 'abc1234', true]);
      assert.deepStrictEqual(x.extras, ['pretend SD card', 'pretend USB stick']);
    });
    await check('the switch from the sandbox page: answered, then the shim ends with 75', async () => {
      const x = await request(W, { method: 'POST', url: '/__dev/switch', origin: 'http://127.0.0.1' });
      assert.strictEqual(x.status, 200);
      assert.deepStrictEqual(JSON.parse(x.body), { model: 'full', to: 'xs' });
      const code = await Promise.race([b.exited, new Promise((ok) => setTimeout(() => ok('still running'), 5000))]);
      assert.strictEqual(code, 75);
    });
  } finally {
    b.kill();
  }
}

main()
  .catch((e) => { failed++; console.log('FAIL  ' + e.message); })
  .finally(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    console.log(`${n - failed} of ${n} passed`);
    process.exitCode = failed ? 1 : 0;
  });
