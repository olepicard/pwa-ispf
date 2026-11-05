'use strict';
//
// Minimal 'process' object for the browser.  process.exit() is routed to a handler set by the PWA
// (end of session screen) instead of terminating anything.
//
const HOME = '/home/lspf';
let cwd = HOME;

const proc = {
  env: { HOME, USER: 'lspf', LANG: 'fr_FR.UTF-8', TERM: 'lspf-pwa' },
  argv: ['lspf-pwa'],
  platform: 'linux',
  arch: 'wasm',
  version: 'v20.0.0-pwa',
  versions: { node: '20.0.0-pwa' },
  pid: 1,
  stdout: { isTTY: false, columns: 80, rows: 24, write() { return true; }, on() {} },
  stderr: { isTTY: false, write(s) { console.error(String(s)); return true; } },
  stdin: { isTTY: false, on() {}, setRawMode() {}, resume() {}, pause() {}, setEncoding() {} },
  cwd: () => cwd,
  chdir: (d) => { cwd = String(d); },
  nextTick: (f, ...a) => queueMicrotask(() => f(...a)),
  on() { return proc; },
  once() { return proc; },
  off() { return proc; },
  exitHandler: null,
  exit(code = 0) {
    if (proc.exitHandler) proc.exitHandler(code);
    // stop the current call chain like a real exit would
    const e = new Error('process.exit(' + code + ')');
    e.isProcessExit = true;
    throw e;
  },
  hrtime: Object.assign(() => { const t = performance.now(); return [Math.floor(t / 1000), Math.floor((t % 1000) * 1e6)]; },
    { bigint: () => BigInt(Math.floor(performance.now() * 1e6)) }),
  memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0 }),
  uptime: () => performance.now() / 1000,
};

module.exports = proc;
