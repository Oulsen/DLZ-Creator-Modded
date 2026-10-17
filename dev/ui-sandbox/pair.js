// Pair the sandbox's pretend other device (DLZ_SANDBOX_REMOTE=1, http://localhost/) as a real one
// pairs (#45): switch "Control from other devices" on from the mixer's side (port 89, the screen's
// own connection), read the PIN it shows there, post it to /dlzmod-pair as that device. Prints the
// pairing token, for shot.js (DLZ_SHOT_COOKIE) or a browser's dlzmod_pair cookie on localhost.
// Usage: node dev/ui-sandbox/pair.js        (the sandbox running)
'use strict';
const net = require('net');

function screenPin() {
  return new Promise((resolve, reject) => {
    const s = net.connect(89, '127.0.0.1');
    let buf = '';
    const timer = setTimeout(() => { s.destroy(); reject(new Error('no PIN from the sandbox in 10 s')); }, 10000);
    s.on('error', reject);
    s.on('connect', () => s.write(JSON.stringify({ cmd: 'DLZMOD_NET', id: 1, args: { op: 'pair', on: true } }) + '\n'));
    s.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const pair = m && m.cmd === 'DLZMOD_NET_STATE' && m.data && m.data.pair;
        if (pair && pair.on && pair.pin) {
          clearTimeout(timer);
          s.destroy();
          return resolve(pair.pin);
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
  });
}

async function main() {
  const pin = await screenPin();
  const r = await fetch('http://localhost/dlzmod-pair', {
    method: 'POST', redirect: 'manual', body: 'pin=' + pin,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost' },
  });
  const m = /dlzmod_pair=([0-9a-f]+)/.exec(r.headers.get('set-cookie') || '');
  if (!m) throw new Error('not paired: HTTP ' + r.status + ' (sandbox started with DLZ_SANDBOX_REMOTE=1?)');
  console.log(m[1]);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
