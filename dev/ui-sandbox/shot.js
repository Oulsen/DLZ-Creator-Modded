// Screenshot the sandbox UI in headless Chrome, optionally after tapping through it.
// Usage: node shot.js <out.png> [x,y ...]   e.g. node shot.js settings.png 905,62
// Uses #INT (the on-device layout: knob panel on the right) unless DLZ_SHOT_URL is set.
// Taps are in UI pixels (1024x600), mapped through the canvas' on-page box, so they work with the
// sandbox's panel stretch; each tap waits 700 ms. The shot is cropped to the canvas.
// DLZ_SHOT_EVAL: optional JS expression run in the page before the taps, e.g. to fake a state the
// PC cannot produce: DLZ_SHOT_EVAL='Data.set("sd",1)' (SD card inserted). DLZ_SHOT_WAIT=<ms> waits
// after it, so the page can draw; DLZ_SHOT_AFTER=<ms> waits after the last tap. The moving fake meter levels (fake-vu-live.js) load on their own.
// DLZ_SHOT_COOKIE=<token>: a pairing cookie (dlzmod_pair, #45) for the page's host first, so a shot
// of http://localhost/ (DLZ_SANDBOX_REMOTE=1: another device on the network) shows the paired UI;
// the token comes from pairing with the PIN: dev/ui-sandbox/pair.js.
// DLZ_SHOT_DOWNLOADS=<folder>: downloads the page starts land there (headless Chrome refuses them
// otherwise), e.g. to check the recordings download (#26).
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.DLZ_SHOT_URL || 'http://127.0.0.1/#INT';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [out, ...taps] = process.argv.slice(2);
  if (!out) throw new Error('usage: node shot.js <out.png> [x,y ...]');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dlz-shot-'));
  const chrome = spawn(CHROME, [
    // no component updates: they would land in DLZ_SHOT_DOWNLOADS's folder
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-component-update',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=1200,700', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find((t) => t.type === 'page');
      } catch { /* chrome still starting */ }
    }
    if (!target) throw new Error('chrome did not start');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
    };
    const send = (method, params = {}) => new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 700, deviceScaleFactor: 1, mobile: false });
    if (process.env.DLZ_SHOT_COOKIE) {
      await send('Network.setCookie', { name: 'dlzmod_pair', value: process.env.DLZ_SHOT_COOKIE, url: URL,
        httpOnly: true, sameSite: 'Strict' });
    }
    if (process.env.DLZ_SHOT_DOWNLOADS) {
      await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(process.env.DLZ_SHOT_DOWNLOADS) });
    }
    await send('Page.navigate', { url: URL });
    await sleep(5000);
    const box = JSON.parse((await send('Runtime.evaluate', {
      expression: 'JSON.stringify(document.getElementById("app").getBoundingClientRect())',
      returnByValue: true,
    })).result.result.value);
    if (process.env.DLZ_SHOT_EVAL) {
      const r = await send('Runtime.evaluate', { expression: process.env.DLZ_SHOT_EVAL, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(`DLZ_SHOT_EVAL: ${r.result.exceptionDetails.exception.description}`);
    }
    // DLZ_SHOT_WAIT: ms to let the page draw after the eval (without taps the shot follows at once)
    if (process.env.DLZ_SHOT_WAIT) await sleep(Number(process.env.DLZ_SHOT_WAIT));
    for (const tap of taps) {
      const [ux, uy] = tap.split(',').map(Number);
      const x = box.left + ux * box.width / 1024;
      const y = box.top + uy * box.height / 600;
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
        await sleep(60);
      }
      await sleep(700);
    }
    // DLZ_SHOT_AFTER: ms to wait after the last tap (a slow answer from the server, e.g. a connect)
    if (process.env.DLZ_SHOT_AFTER) await sleep(Number(process.env.DLZ_SHOT_AFTER));
    const clip = { x: box.left, y: box.top, width: box.width, height: box.height, scale: 1 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log(`wrote ${out}`);
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
