'use strict';
//
// End-to-end test of the PWA in headless Chrome / Edge (DevTools protocol over Node's built-in WebSocket):
// Android phone emulation, touch gestures, soft keyboard text, installability, offline start, persistence.
//
//   node test/e2e-chrome.js [--shots DIR]      (after node build.js;  CHROME=path to override the browser)
//
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const assert = require('assert');
const { serve } = require('../serve');

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? path.resolve(args[args.indexOf('--shots') + 1]) : null;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const c = [process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  return c.find(f => fs.existsSync(f));
}

const getJSON = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.cbs = new Map(); this.listeners = [];
    ws.addEventListener('message', (m) => {
      const o = JSON.parse(m.data);
      if (o.id && this.cbs.has(o.id)) { const { res, rej } = this.cbs.get(o.id); this.cbs.delete(o.id); o.error ? rej(new Error(o.error.message)) : res(o.result); }
      else if (o.method) this.listeners.forEach(f => f(o));
    });
  }
  send(method, params = {}, ms = 15000) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      const t = setTimeout(() => { this.cbs.delete(id); rej(new Error(`${method}: no answer after ${ms} ms`)); }, ms);
      this.cbs.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expr, ms = 15000, what = expr) {
    const t0 = Date.now();
    for (;;) {
      try { if (await this.eval(expr)) return; } catch (e) { /* page loading */ }
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
      await sleep(100);
    }
  }
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(true); console.log('  ok   ' + name); }
  catch (e) { results.push(false); console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}

(async () => {
  const browser = findBrowser();
  if (!browser) { console.log('No Chrome / Edge found: set CHROME=path'); process.exit(2); }
  const server = http.createServer(serve).listen(0, '127.0.0.1');
  await new Promise(r => server.on('listening', r));
  const URL0 = `http://127.0.0.1:${server.address().port}/`;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'lspf-e2e-'));
  const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = +fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (e) { /* not yet */ }
  }
  const page = (await getJSON(`http://127.0.0.1:${port}/json/list`)).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new CDP(ws);
  const logs = [];
  cdp.listeners.push((o) => {
    if (o.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + JSON.stringify(o.params.exceptionDetails.exception && o.params.exceptionDetails.exception.description));
    if (o.method === 'Runtime.consoleAPICalled' && (o.params.type === 'error' || o.params.type === 'warning')) logs.push(o.params.type + ' ' + o.params.args.map(a => a.value || a.description).join(' '));
  });

  // Android phone, landscape (Pixel 7: 915 x 412 CSS pixels)
  const W = 915, H = 412;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2.625, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const shot = async (name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await sleep(150);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const text = () => cdp.eval('LSPF.text()');
  const geo = () => cdp.eval(`(() => { const r = document.getElementById('screen').getBoundingClientRect(); const t = LSPF.state.term;
    return { x: r.left, y: r.top, cw: t.cw, ch: t.ch, rows: t.rows, cols: t.cols, fs: t.fs }; })()`);
  const cellXY = (g, row, col) => ({ x: g.x + (col + 0.5) * g.cw, y: g.y + (row + 0.5) * g.ch });
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const tap = async (p) => { await touch('touchStart', [p]); await sleep(30); await touch('touchEnd', []); await sleep(120); };
  const tapCell = async (row, col) => tap(cellXY(await geo(), row, col));
  const button = async (sel) => {
    const p = await cdp.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await tap(p);
  };
  const softType = async (s) => { await cdp.send('Input.insertText', { text: s }); await sleep(120); };
  const enter = () => button('.k-enter');
  const key = async (k, code, vk) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(150);
  };
  const drag = async (from, to, steps = 12) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); await sleep(15); }
    await touch('touchEnd', []);
    await sleep(250);
  };

  console.log(`PWA in ${path.basename(browser)} (headless), Android ${W}x${H} landscape`);
  await cdp.send('Page.navigate', { url: URL0 });
  await test('starts on the primary option menu, 80x24 or more, fills the phone screen', async () => {
    await cdp.waitFor("window.LSPF && LSPF.text().includes('Option ===>')", 20000, 'primary menu');
    const g = await geo();
    assert.ok(g.cols >= 80 && g.rows >= 24, `screen ${g.cols}x${g.rows}`);
    assert.ok(g.cols * g.cw <= W + 1, 'no horizontal overflow');
    await shot('1-menu');
  });
  await test('installable: manifest without error, service worker active', async () => {
    const m = await cdp.send('Page.getAppManifest');
    assert.deepStrictEqual(m.errors, []);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    assert.deepStrictEqual(inst.installabilityErrors.map(e => e.errorId), []);
    await cdp.waitFor('navigator.serviceWorker.ready.then(r => !!r.active)', 10000, 'service worker');
  });
  await test('PF key bar shows the PF key definitions; touch tap + soft keyboard + Entrée: 3.4 file list', async () => {
    const f3 = await cdp.eval("document.querySelector('#fkeys .k[data-n=\"3\"]').textContent");
    assert.strictEqual(f3, 'F3End');
    await tapCell(3, 14);
    await button('.k-kbd');                 // soft keyboard
    assert.ok(await cdp.eval("document.activeElement.id === 'kbd'"));
    await softType('3.4');
    await enter();
    await cdp.waitFor("LSPF.text().includes('LISEZMOI.txt')", 5000, 'file list');
    await shot('2-filelist');
  });
  await test('physical keyboard F3, then ED of a wide file', async () => {
    await key('F3', 'F3', 114);
    await cdp.waitFor("LSPF.text().includes('Option ===>')", 5000, 'menu after F3');
    await tapCell(3, 14);
    await softType('ed ~/exemples/large.txt');
    await enter();
    await cdp.waitFor("/EDIT .*large\\.txt/i.test(LSPF.text())", 5000, 'editor');
    assert.match(await text(), /Columns 00001/);
    await shot('3-editor');
  });
  await test('horizontal finger drag scrolls the editor to the right, and back', async () => {
    const g = await geo();
    await drag(cellXY(g, 8, 70), cellXY(g, 8, 20));
    await cdp.waitFor("!/Columns 00001/.test(LSPF.text())", 5000, 'scrolled right');
    await shot('4-drag');
    await drag(cellXY(g, 8, 20), cellXY(g, 8, 75));
    await cdp.waitFor("/Columns 00001/.test(LSPF.text())", 5000, 'scrolled back');
  });
  await test('vertical swipe scrolls down (UP/DOWN)', async () => {
    const g = await geo();
    await drag(cellXY(g, 20, 40), cellXY(g, 8, 40));
    await cdp.waitFor("!LSPF.text().includes('Top of Data')", 5000, 'scrolled down');
    await drag(cellXY(g, 8, 40), cellXY(g, 22, 40));
    await cdp.waitFor("LSPF.text().includes('Top of Data')", 5000, 'scrolled up');
  });
  await test('typing in the data with the soft keyboard, Backspace, SAVE; survives a reload (IndexedDB)', async () => {
    const t = (await text()).split('\n');
    const r = t.findIndex(l => /^ 000001 /.test(l));
    await tapCell(r, 8);
    await softType('XYZ');
    await button('.k-ins');                       // insert mode on/off works from the bar
    await button('.k-ins');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await sleep(120);
    await tapCell(3, 14);
    await softType('save');
    await enter();
    await shot('7-save');
    try { await cdp.waitFor("LSPF.vfs.readFileSync('/home/lspf/exemples/large.txt', 'utf8').startsWith('XY')", 5000, 'saved'); }
    catch (e) { console.log((await text()).split('\n').slice(0, 8).join('\n')); throw e; }
    await cdp.eval('LSPF.vfs.backend.flush()');
    await cdp.send('Page.reload');
    await cdp.waitFor("window.LSPF && LSPF.text().includes('Option ===>')", 20000, 'reload');
    assert.match(await cdp.eval("LSPF.vfs.readFileSync('/home/lspf/exemples/large.txt', 'utf8').slice(0, 6)"), /^XY Lig/);   // XYZ over 001, Backspace pulls the line left
  });
  await test('long press = ENTER at the touched position (point-and-shoot on the menu: 2 Edit)', async () => {
    const t = (await text()).split('\n');
    const r = t.findIndex(l => /^ 2 {2}Edit/.test(l));
    const p = cellXY(await geo(), r, 4);
    await touch('touchStart', [p]); await sleep(800); await touch('touchEnd', []);
    await cdp.waitFor("!LSPF.text().includes('Primary Menu Panel')", 5000, 'option 2 selected');
    await key('F3', 'F3', 114);
  });
  await test('Android Back button = F3', async () => {
    await cdp.waitFor("LSPF.text().includes('Option ===>')", 5000, 'menu');
    await tapCell(3, 14); await button('.k-kbd'); await softType('3.4'); await enter();
    await cdp.waitFor("LSPF.text().includes('LISEZMOI.txt')", 5000, 'file list');
    await cdp.eval('history.back()');
    await cdp.waitFor("LSPF.text().includes('Option ===>')", 5000, 'back to the menu');
  });
  await test('menu: opens, closes; offline start from the service worker cache', async () => {
    await button('.k-menu');
    assert.ok(await cdp.eval("!document.getElementById('menu').hidden"));
    await shot('5-menu');
    await cdp.eval("document.querySelector('#menu button.close').click()");
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Page.reload');
    await cdp.waitFor("window.LSPF && LSPF.text().includes('Option ===>')", 20000, 'offline start');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  });
  await test('portrait orientation: still 80 columns, key bar visible', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await sleep(500);
    const g = await geo();
    const fit = await cdp.eval("({ canvas: document.getElementById('screen').getBoundingClientRect().width, wrap: document.getElementById('wrap').clientWidth, inner: innerWidth })");
    await shot('6-portrait');
    assert.ok(g.cols >= 80, 'cols ' + g.cols);
    assert.ok(fit.canvas <= fit.wrap + 1, `80 columns must fit the width: ${JSON.stringify(Object.assign(fit, g))}`);
    assert.ok(await cdp.eval("document.getElementById('bar').getBoundingClientRect().bottom <= innerHeight + 1"));
  });

  if (logs.length) console.log('  browser messages:\n    ' + logs.join('\n    '));
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  ws.close(); proc.kill(); server.close();
  setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* locked */ } process.exit(failed ? 1 : 0); }, 500);
})().catch((e) => { console.error(e); process.exit(1); });
