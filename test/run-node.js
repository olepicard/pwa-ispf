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
  await test('Buffer API and file descriptors of the shims (XMIT, AMBLIST, SRCHFOR)', () => {
    const fsm = req('fs');
    const B = req('/pwa/vfs.js').VBuffer;
    const b = B.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0x25, 0x50, 0x44, 0x46]);
    assert.strictEqual(b.readUInt16BE(0), 0x1234);
    assert.strictEqual(b.readUInt32BE(1), 0x34567890 + 0x0a);
    assert.strictEqual(b.toString('hex', 1, 3), '3456');
    assert.strictEqual(b.indexOf('%PDF'), 5);
    assert.strictEqual(b.indexOf(0x56), 2);
    assert.ok(b.subarray(5, 9).equals(B.from('%PDF')));
    const w = B.alloc(4, 0x40);
    w.writeUInt16BE(0xc1c2, 1);
    assert.deepStrictEqual([...w], [0x40, 0xc1, 0xc2, 0x40]);
    fsm.writeFileSync('/home/lspf/fd.bin', b);
    const fd = fsm.openSync('/home/lspf/fd.bin', 'r');
    const h = B.alloc(4);
    assert.strictEqual(fsm.readSync(fd, h, 0, 4, 2), 4);
    assert.strictEqual(h.toString('hex'), '56789a25');
    fsm.closeSync(fd);
    assert.throws(() => fsm.openSync('/home/lspf/fd.bin', 'r+'), /EINVAL/);
    assert.throws(() => fsm.openSync('/lspf/rexx/x.bin', 'w'), /EROFS/);
    assert.throws(() => fsm.openSync('/home/lspf/fd.bin', 'wx'), /EEXIST/);
    assert.ok(fsm.statSync('/home/lspf/fd.bin').birthtimeMs > 0);
    // written piece by piece through a descriptor (ZIP archives), persisted when closed
    const wfd = fsm.openSync('/home/lspf/fd.bin', 'w');
    assert.strictEqual(fsm.writeSync(wfd, B.from('abcdef'), 1, 3, 0), 3);
    assert.strictEqual(fsm.writeSync(wfd, B.from('XY'), 0, 2, 70000), 2);
    assert.strictEqual(fsm.fstatSync(wfd).size, 70002);
    writes.length = 0;
    fsm.closeSync(wfd);
    assert.ok(writes.includes('/home/lspf/fd.bin'));
    const wb = fsm.readFileSync('/home/lspf/fd.bin');
    assert.deepStrictEqual([wb.length, wb.toString('latin1', 0, 3), wb.toString('latin1', 70000)], [70002, 'bcd', 'XY']);
    assert.throws(() => fsm.writeSync(wfd, B.from('z')), /EBADF/);
    fsm.utimesSync('/home/lspf/fd.bin', new Date(2020, 0, 1), new Date(2020, 0, 1));
    assert.strictEqual(fsm.statSync('/home/lspf/fd.bin').mtime.getFullYear(), 2020);
    fsm.chmodSync('/home/lspf/fd.bin', 0o644);
    fsm.unlinkSync('/home/lspf/fd.bin');
    // little-endian, 64-bit and string writes (ZIP headers)
    const le = B.alloc(16);
    le.writeUInt16LE(0x0201, 0); le.writeUInt32LE(0x06050403, 2); le.writeBigUInt64LE(0x0e0d0c0b0a090807n, 6);
    assert.strictEqual(le.write('AE', 14, 'latin1'), 2);
    assert.strictEqual(le.toString('hex'), '0102030405060708090a0b0c0d0e4145');
    assert.strictEqual(le.readBigUInt64LE(6), 0x0e0d0c0b0a090807n);
    assert.deepStrictEqual([B.compare(B.from('ab'), B.from('ac')), B.compare(B.from('b'), B.from('ab')), B.allocUnsafe(3).length], [-1, 1, 3]);
  });
  await test('zlib and crypto shims: ZIP archives (deflate, AES-256, ZipCrypto) read by Node, XMIT created', () => {
    const fsm = req('fs');
    const Z = req('/lspf/lib/zip.js');
    const NZ = require(path.join(__dirname, '..', '..', 'node-lspf', 'lib', 'zip.js'));   // real zlib / crypto
    fsm.mkdirSync('/home/lspf/zt/src/sub', { recursive: true });
    const text = 'IDENTIFICATION DIVISION.\n'.repeat(400) + 'é à ç\n';
    const bin = new Uint8Array(5000).map((_, i) => (i * 7919) & 255);
    fsm.writeFileSync('/home/lspf/zt/src/prog.cbl', text);
    fsm.writeFileSync('/home/lspf/zt/src/sub/data.bin', bin);
    for (const [pw, enc] of [[null, 'AES'], ['secret', 'AES'], ['secret', 'ZIPCRYPTO']]) {
      const out = `/home/lspf/zt/a-${enc}${pw ? '-pw' : ''}.zip`;
      const r = Z.createZip(out, ['/home/lspf/zt/src'], { password: pw, encryption: enc });
      assert.deepStrictEqual([r.files, r.dirs], [2, 2]);
      // read back in the bundle
      const z = Z.openZip(out);
      assert.strictEqual(z.encrypted, !!pw);
      if (pw) assert.throws(() => Z.extractAll(z, '/home/lspf/zt/bad', { password: 'wrong' }), (e) => e.code === 'EPASSWORD');
      const x = Z.extractAll(z, `/home/lspf/zt/x-${enc}${pw ? '-pw' : ''}`, { password: pw });
      z.close();
      assert.strictEqual(x.files, 2);
      assert.strictEqual(fsm.readFileSync(`${x.dir}/src/prog.cbl`, 'utf8'), text);
      assert.deepStrictEqual([...fsm.readFileSync(`${x.dir}/src/sub/data.bin`)], [...bin]);
      // and by node-lspf on Node.js (real zlib and crypto)
      const nz = NZ.openZip(Buffer.from(fsm.readFileSync(out)));
      const ent = nz.entries.find(e => e.name === 'src/prog.cbl');
      assert.strictEqual(ent.methodName, 'Deflate');
      assert.strictEqual(ent.encryption, pw ? (enc === 'AES' ? 'AES-256' : 'ZipCrypto') : '');
      assert.strictEqual(nz.read(ent, pw).toString('utf8'), text);
      nz.close();
    }
    // an archive made by Node.js (zlib, AES), extracted in the bundle
    const nodeZip = path.join(require('os').tmpdir(), `pwa-zip-${process.pid}.zip`);
    const nodeSrc = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pwa-src-'));
    fs.writeFileSync(path.join(nodeSrc, 'n.txt'), text);
    NZ.createZip(nodeZip, [path.join(nodeSrc, 'n.txt')], { password: 'p@ss', encryption: 'AES' });
    fsm.writeFileSync('/home/lspf/zt/node.zip', new Uint8Array(fs.readFileSync(nodeZip)));
    fs.rmSync(nodeZip); fs.rmSync(nodeSrc, { recursive: true });
    const nzz = Z.openZip('/home/lspf/zt/node.zip');
    assert.strictEqual(Z.extractAll(nzz, '/home/lspf/zt/fromnode', { password: 'p@ss' }).files, 1);
    nzz.close();
    assert.strictEqual(fsm.readFileSync('/home/lspf/zt/fromnode/n.txt', 'utf8'), text);
    // XMIT of a directory (PDS), read back by the XMIT reader
    const W = req('/lspf/lib/xmitwrite.js'), X = req('/lspf/lib/xmit.js');
    const xr = W.writeXmit('/home/lspf/zt/src', '/home/lspf/zt/src.xmit', {});
    assert.ok(xr.isPds);
    const px = X.parseXmit(fsm.readFileSync('/home/lspf/zt/src.xmit'));
    assert.ok(X.isXmitFile('/home/lspf/zt/src.xmit'));
    assert.ok(px.files[0].isPds && px.files[0].members.some(m => m.name === 'PROG'));
    fsm.rmSync('/home/lspf/zt', { recursive: true });
  });
  await test('3.4: XMIT files (viewer, AMBLIST), SRCHFOR, sort by a heading, a click on a name views it', async () => {
    const gen = require(path.join(__dirname, '..', '..', 'node-lspf', 'test', 'xmitgen.js'));
    const fsm = req('fs');
    fsm.mkdirSync('/home/lspf/xm', { recursive: true });
    fsm.writeFileSync('/home/lspf/xm/lib.xmi', new Uint8Array(gen.pdsXmit()));
    fsm.writeFileSync('/home/lspf/xm/load.xmi', new Uint8Array(gen.lmodXmit()));
    fsm.writeFileSync('/home/lspf/xm/note.txt', 'Bonjour le monde\nhello again\n');
    await cmd('3.4');
    await cmd('cd ~/xm');
    const rowOf = (s) => term.text().split('\n').findIndex(l => l.includes(s));
    const clickOn = async (s) => { const r = rowOf(s); term.click(r, term.text().split('\n')[r].indexOf(s) + 1); await tick(80); await tick(600); };
    assert.match(term.text(), /lib\.xmi +Xmit/);
    assert.match(term.text(), /load\.xmi +Xmit/);
    // a click on the name of an XMIT file opens the XMIT viewer
    await clickOn('lib.xmi');
    assert.match(term.text(), /XMIT File Viewer/);
    assert.match(term.text(), /ALPHA +Text +2/);
    term.click(rowOf('ALPHA'), 1); term.type('b'); term.key('enter'); await tick(80);
    assert.match(term.text(), /HELLO FROM ALPHA/);
    term.key('f3'); await tick();
    term.key('f3'); await tick();
    // AMBLIST of a load module
    await clickOn('load.xmi');
    term.click(rowOf('MAIN '), 1); term.type('i'); term.key('enter'); await tick(80);
    assert.match(term.text(), /MODULE SUMMARY/);
    term.key('f3'); await tick();
    term.key('f3'); await tick();
    // SRCHFOR in the files and in the XMIT members
    await cmd("srchfor 'hello'");
    assert.match(term.text(), /'hello' found in 2 file/);
    assert.match(term.text(), /lib\.xmi +\*Found 1/);
    // a click on the Size heading sorts the list (descending)
    const h = term.text().split('\n')[10];
    term.click(10, h.indexOf('Size')); await tick(80); await tick(600);
    assert.match(term.text().split('\n')[10], /Size ▼/);
    // a click on a text file name: VIEW
    await clickOn('note.txt');
    assert.match(term.text(), /VIEW .*note\.txt/);
    assert.match(term.text(), /Bonjour le monde/);
    term.key('f3'); await tick();
    assert.match(term.text(), /note\.txt +Viewed/);
    term.key('f3'); await tick();
    assert.match(term.text(), /Option ===>/);
  });
  await test('3.4: F1 / ? on an entry (contextual help), ZIP and XMIT line commands', async () => {
    const gen = require(path.join(__dirname, '..', '..', 'node-lspf', 'test', 'xmitgen.js'));
    const fsm = req('fs');
    fsm.mkdirSync('/home/lspf/ctx/src', { recursive: true });
    fsm.writeFileSync('/home/lspf/ctx/lib.xmi', new Uint8Array(gen.pdsXmit()));
    fsm.writeFileSync('/home/lspf/ctx/src/a.txt', 'alpha\n'.repeat(50));
    await cmd('3.4');
    await cmd('cd ~/ctx');
    const rowOf = (s) => term.text().split('\n').findIndex(l => l.includes(s));
    const lineCmd = async (s, c) => { term.click(rowOf(s), 1); term.type(c); term.key('enter'); await tick(80); };
    // F1 with the cursor on the line of an XMIT file
    term.click(rowOf('lib.xmi'), 1); term.key('f1'); await tick(80);
    assert.match(term.text(), /AIDE CONTEXTUELLE - lib\.xmi/);
    assert.match(term.text(), /XE +extrait tous les membres \(« unxmit »/);
    term.key('f3'); await tick();
    // ? before a directory: XMIT and ZIP
    await lineCmd('src ', '?');
    assert.match(term.text(), /AIDE CONTEXTUELLE - src/);
    assert.match(term.text(), /XMIT +crée un fichier XMIT : un PDS/);
    assert.match(term.text(), /ZIP +crée une archive ZIP du répertoire/);
    term.key('f3'); await tick();
    // ZIP of the directory: pop-up, Enter (no password)
    await lineCmd('src ', 'zip');
    term.key('enter'); await tick(120);
    assert.match(term.text(), /src\.zip +Zip/);
    assert.match(term.text(), /src +Zipped/);
    const z = req('/lspf/lib/zip.js').openZip('/home/lspf/ctx/src.zip');
    assert.deepStrictEqual([...z.entries.map(e => e.name)], ['src/', 'src/a.txt']);
    z.close();
    // XMIT of the directory: pop-up, Enter
    await lineCmd('src ', 'xmit');
    term.key('enter'); await tick(120);
    assert.match(term.text(), /XMIT done/);
    assert.ok(fsm.readdirSync('/home/lspf/ctx').some(f => /\.XMIT$/i.test(f)));
    term.key('f3'); await tick();
    assert.match(term.text(), /Option ===>/);
    fsm.rmSync('/home/lspf/ctx', { recursive: true });
  });
  await test('3.4: z/OS dump (SYSMDUMP) analyzed in the bundle, native and downloaded in text mode', async () => {
    const gen = require(path.join(__dirname, '..', '..', 'node-lspf', 'test', 'dumpgen.js'));
    const fsm = req('fs');
    fsm.mkdirSync('/home/lspf/dump', { recursive: true });
    fsm.writeFileSync('/home/lspf/dump/job.dump', new Uint8Array(gen.sysmdump()));
    fsm.writeFileSync('/home/lspf/dump/job.txt', new Uint8Array(gen.textModeDump({ eol: 'LF' })));
    // the analyzer on the Buffer of the shims: text-mode dump joined and translated back, control blocks, search
    const D = req('/lspf/lib/sysmdump.js');
    const d = D.parseDump(fsm.readFileSync('/home/lspf/dump/job.txt'));
    assert.deepStrictEqual([d.valid, d.transfer.mode, d.transfer.eol, d.n, d.warnings.length], [true, 'text', 'LF', 15, 0]);
    assert.deepStrictEqual([d.errorInfo().abend.text, d.errorInfo().psw.addr, d.whereText(0x25, 0x7abc), d.addressSpace(0x25).jobname, d.addressSpace(0x25).tcbs.length],
      ['S0C4', 0x7abc, 'TESTPGM+ABC', 'TESTJOB', 2]);
    assert.strictEqual(d.find(0x25, D.searchPatterns('CROSSPAG')[0].bytes), 0x7ffc);
    assert.strictEqual(d.find(0x25, D.searchPatterns("X'0D252515'")[0].bytes), 0x7ac0);
    assert.ok(d.fullReport('job.txt').length > 150);
    const n = D.parseDumpFile('/home/lspf/dump/job.dump');
    assert.deepStrictEqual([n.valid, n.encoding, n.header.title, n.localTime()], [true, 'EBCDIC', 'JOBNAME TESTJOB  STEPNAME STEP1  SYSTEM 0C4', '2026-06-11 16:22:01.123456']);
    assert.strictEqual(n.hexDump(0x25, 0x7ff0, 0x20).join('/'),
      '00007FF0  00000000 00000000 00000000 C3D9D6E2  |............CROS| |................|/00008000  E2D7C1C7 00000000 00000000 00000000  |SPAG............| |................|');
    // the viewer, from the file list
    await cmd('3.4');
    await cmd('cd ~/dump');
    const rowOf = (s) => term.text().split('\n').findIndex(l => l.includes(s));
    assert.match(term.text(), /job\.dump +Dump/);
    assert.match(term.text(), /job\.txt +Dump/);
    const r = rowOf('job.dump');
    term.click(r, term.text().split('\n')[r].indexOf('job.dump') + 1); await tick(80); await tick(600);   // a tap on the name
    assert.match(term.text(), /z\/OS Dump Viewer/);
    assert.match(term.text(), /TESTJOB {2}ASID 0025 {3}abend S0C4 reason 00000010/);
    assert.match(term.text(), /00007ABC {3}TESTPGM\+ABC/);
    term.click(rowOf('0025 TESTJOB'), 1); term.type('t'); term.key('enter'); await tick(80);
    assert.match(term.text(), /TCB SUMMARY - ASID 0025 TESTJOB/);
    term.key('f3'); await tick();
    await cmd('l 7ff0 32');
    assert.match(term.text(), /00008000 {2}E2D7C1C7 .*\|SPAG/);
    term.key('f3'); await tick();
    await cmd('report');
    assert.match(term.text(), /DUMP SUMMARY/);
    term.key('f3'); await tick();
    assert.match(term.text(), /Report written/);
    term.key('f3'); await tick();
    assert.match(term.text(), /job\.dump +Browsed/);
    term.key('f3'); await tick();
    assert.match(term.text(), /Option ===>/);
  });
  await test('RUN of a REXX exec with TSO services: shared XMIT found in ~/partages, EXECIO, CALL *(AMBLIST), EROFS', async () => {
    const gen = require(path.join(__dirname, '..', '..', 'node-lspf', 'test', 'xmitgen.js'));
    const fsm = req('fs');
    fsm.mkdirSync('/home/lspf/partages', { recursive: true });
    fsm.writeFileSync('/home/lspf/partages/MY.LOADLIB(1).XMIT', new Uint8Array(gen.lmodXmit()));   // name given by a share
    fsm.writeFileSync('/home/lspf/.lspf-node/rexx/ambt.rex', [
      '/* REXX */',
      '"ALLOC DD(SYSLIB) DA(\'MY.LOADLIB\') SHR REUSE"; say "lib" rc',
      '"ALLOC DD(SYSPRINT) NEW REUSE"',
      "QUEUE ' LISTIDR MEMBER=MAIN'",
      '"ALLOC F(SYSIN) NEW DELETE REUSE"',
      '"EXECIO "QUEUED()" DISKW SYSIN (FINIS"',
      '"CALL *(AMBLIST)"; say "amb" rc',
      '"EXECIO * DISKR SYSPRINT (STEM L. FINIS)"',
      'do i = 1 to l.0; if pos("MAIN ENTRY POINT:", l.i) > 0 then say strip(l.i); end',
      '"ALLOC F(OUT) DA(\'~/partages/result.txt\') NEW"',
      "o.1 = 'ligne 1'",
      '"EXECIO 1 DISKW OUT (STEM O. FINIS"; say "w" rc',
      '"ALLOC F(RO) DA(\'/lspf/rexx/nouveau.txt\') NEW"',
      '"EXECIO 1 DISKW RO (STEM O. FINIS"; say "ro" rc',
      '"FREE F(SYSIN SYSPRINT SYSLIB OUT RO)"'].join('\n') + '\n');
    await cmd('ed ~/exemples/PROG01.cbl');
    await cmd('run ambt');
    const t = term.text();
    assert.match(t, /lib 0/);
    assert.match(t, /amb 0/);
    assert.match(t, /MAIN ENTRY POINT: {2}00000010 {2}ENTRY1/);
    assert.match(t, /w 0/);
    assert.match(t, /READ-ONLY FILE SYSTEM/);
    assert.match(t, /ro 20/);
    assert.strictEqual(vfs.readFileSync('/home/lspf/partages/result.txt', 'utf8'), 'ligne 1\n');
    assert.ok(!vfs.readdirSync('/home/lspf/.lspf-node/spool/tso').some(f => /^TSO-/.test(f)));   // temporary files deleted
    term.key('f3'); await tick();
    term.key('f3'); await tick();
    assert.match(term.text(), /Option ===>/);
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
