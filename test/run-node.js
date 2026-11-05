'use strict';
//
// Runs www/lspf-bundle.js in an isolated vm context (browser-like globals, no Node modules): node-lspf must work
// entirely on the shims and the virtual file system.   node test/run-node.js   (after node build.js)
//
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(true); console.log('  ok   ' + name); }
  catch (e) { results.push(false); console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const tick = (ms = 40) => new Promise(r => setTimeout(r, ms));

function load() {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, TextEncoder, TextDecoder,
    performance, URL, atob, btoa,
  });
  ctx.self = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'lspf-bundle.js'), 'utf8'), ctx, { filename: 'lspf-bundle.js' });
  return ctx;
}

(async () => {
  const ctx = load();
  const req = ctx.lspfRequire;
  const L = req('/pwa/main.js');
  const vfs = L.vfs;
  const writes = [];
  L.installAssets();
  vfs.backend = { put: (p) => writes.push(p), del: (p) => writes.push('-' + p), flush: async () => {}, clear() {} };
  L.seed();

  console.log('Virtual file system and shims');
  await test('libraries mounted read-only, samples created and persisted', () => {
    assert.ok(vfs.existsSync('/lspf/plib/ISPPRIM'.replace('ISPPRIM', vfs.readdirSync('/lspf/plib')[0])));
    assert.ok(vfs.readdirSync('/lspf/rexx').includes('supall.rex'));
    assert.match(vfs.readFileSync('/home/lspf/exemples/PROG01.cbl', 'utf8'), /PROGRAM-ID\. PROG01/);
    assert.ok(writes.includes('/home/lspf/exemples/PROG01.cbl'));
    assert.ok(!writes.some(w => w.startsWith('/lspf/')));
    assert.throws(() => vfs.writeFileSync('/lspf/plib/x', 'y'), /EROFS/);
    assert.throws(() => vfs.readFileSync('/home/lspf/nope'), (e) => e.code === 'ENOENT');
  });
  await test('fs semantics: mkdir -p, rename of a tree, cpSync, readdir withFileTypes, append, latin1/utf8', () => {
    const fsm = req('fs'), p = req('path');
    fsm.mkdirSync('/home/lspf/t/a/b', { recursive: true });
    fsm.writeFileSync('/home/lspf/t/a/b/f.txt', 'é');
    fsm.appendFileSync('/home/lspf/t/a/b/f.txt', '!');
    assert.strictEqual(fsm.readFileSync('/home/lspf/t/a/b/f.txt', 'utf8'), 'é!');
    assert.strictEqual(fsm.readFileSync('/home/lspf/t/a/b/f.txt', 'latin1'), 'Ã©!');
    assert.strictEqual(fsm.readFileSync('/home/lspf/t/a/b/f.txt').toString('utf8'), 'é!');
    fsm.cpSync('/home/lspf/t/a', '/home/lspf/t/c', { recursive: true });
    fsm.renameSync('/home/lspf/t/a', '/home/lspf/t/z');
    assert.strictEqual(fsm.readdirSync('/home/lspf/t').join(), 'c,z');
    assert.ok(fsm.readdirSync('/home/lspf/t', { withFileTypes: true })[0].isDirectory());
    assert.strictEqual(fsm.statSync('/home/lspf/t/z/b/f.txt').size, 3);
    assert.throws(() => fsm.rmdirSync('/home/lspf/t'), /ENOTEMPTY/);
    fsm.rmSync('/home/lspf/t', { recursive: true });
    assert.ok(!fsm.existsSync('/home/lspf/t/c/b/f.txt'));
    assert.strictEqual(p.resolve('x/../y'), '/home/lspf/y');
    assert.strictEqual(p.join('/a', '../b', 'c.txt'), '/b/c.txt');
    assert.strictEqual(req('os').homedir(), '/home/lspf');
  });
  await test('file names are case-insensitive and keep their case', () => {
    const fsm = req('fs');
    assert.match(fsm.readFileSync('/HOME/LSPF/EXEMPLES/PROG01.CBL', 'utf8'), /PROG01/);
    fsm.writeFileSync('/home/lspf/EXEMPLES/Nouveau.TXT', 'x');
    assert.ok(fsm.readdirSync('/home/lspf/exemples').includes('Nouveau.TXT'));
    assert.strictEqual(fsm.realpathSync('/HOME/LSPF/exemples/nouveau.txt'), '/home/lspf/exemples/Nouveau.TXT');
    fsm.renameSync('/home/lspf/exemples/nouveau.txt', '/home/lspf/exemples/nouveau.txt');
    assert.ok(fsm.readdirSync('/home/lspf/exemples').includes('nouveau.txt'));
    fsm.unlinkSync('/home/lspf/exemples/NOUVEAU.TXT');
    assert.ok(!fsm.existsSync('/home/lspf/exemples/nouveau.txt'));
  });

  console.log('lspf session in the bundle');
  const EventEmitter = req('events');
  const term = new EventEmitter();
  Object.assign(term, {
    rows: 30, cols: 100, insertMode: false, start() {}, stop() {}, beep() {}, invalidate() {},
    render(scr, r, c) { this.last = scr; this.cursor = { row: r, col: c }; },
    text() { const s = this.last; const o = []; for (let r = 0; r < s.rows; r++) o.push(s.ch.slice(r * s.cols, (r + 1) * s.cols).join('').replace(/\s+$/, '')); return o.join('\n'); },
    type(s) { for (const ch of s) this.emit('key', { name: 'char', ch }); },
    key(name, x = {}) { this.emit('key', Object.assign({ name }, x)); },
    click(row, col, button = 0) { this.emit('key', { name: 'mouse', button, row, col }); this.emit('key', { name: 'mouseup', button, row, col }); },
  });
  const { Session } = req('/lspf/lib/session.js');
  const session = new Session({ root: '/lspf', zuprof: L.PROFILE, user: 'lspf', version: 'test', terminal: term });
  let ended = false;
  session.start({ pgm: 'PMAIN0A', parm: '', newappl: 'ISP', newpool: true }).then(() => { ended = true; });
  await tick(80);
  const cmd = async (c) => { term.click(3, 14); term.key('ctrl', { ch: 'e' }); term.type(c); term.key('enter'); await tick(); };

  await test('primary menu, help panel', async () => {
    assert.match(term.text(), /Option ===>/);
    term.key('f1'); await tick();
    assert.match(term.text(), /Tutorial|Help|HELP|Aide/);
    term.key('f3'); await tick();
    assert.match(term.text(), /Option ===>/);
  });
  await test('3.4 file list of the home directory', async () => {
    term.type('3.4'); term.key('enter'); await tick();
    const t = term.text();
    assert.match(t, /LISEZMOI\.txt/);
    assert.match(t, /exemples/);
    term.key('f3'); await tick();        // back to the primary menu (a second F3 would end the session)
    assert.match(term.text(), /Option ===>/);
  });
  await test('editor: macro SUPALL from F4, CHANGE, SAVE written to the virtual file system', async () => {
    await cmd('ed ~/exemples/PROG01.cbl');   // the option field is in capitals: the file system ignores the case
    assert.match(term.text(), /EDIT .*PROG01\.cbl/i);
    session.pools.isps.set('ZPF04', 'MACRO SUPALL');
    const lines = term.text().split('\n');
    const r = lines.findIndex(l => /01 {2}WS-TOTAL/.test(l));
    term.click(r, lines[r].indexOf('WS-TOTAL'));
    term.key('f4'); await tick(80);
    const t = term.text();
    assert.match(t, /Line\(s\) not Displayed/);
    assert.match(t, /ADD WS-COMPTEUR TO WS-TOTAL/);
    assert.doesNotMatch(t, /IDENTIFICATION DIVISION/);
    writes.length = 0;
    await cmd("res;c 'BONJOUR' 'SALUT';save");
    assert.match(vfs.readFileSync('/home/lspf/exemples/PROG01.cbl', 'utf8'), /VALUE 'SALUT'/);
    assert.ok(writes.includes('/home/lspf/exemples/PROG01.cbl'));
    term.key('f3'); await tick();
  });
  await test('system commands are reported as unavailable', async () => {
    await cmd('tso ls');
    assert.match(term.text(), /PWA|127/);
    term.key('f3'); await tick();
  });
  await test('profile saved in ~/.lspf-node, =X ends the session', async () => {
    term.type('=x'); term.key('enter'); await tick(80);
    assert.ok(ended);
    assert.ok(vfs.existsSync('/home/lspf/.lspf-node/ISPSPROF.json'));
    assert.match(vfs.readFileSync('/home/lspf/.lspf-node/ISPSPROF.json', 'utf8'), /MACRO SUPALL/);
  });

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
