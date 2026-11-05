'use strict';
//
// Virtual file system used by the 'fs' shim.
//
// All files live in memory (synchronous API, like Node's *Sync functions used by lspf).  Every change outside the
// read-only tree /lspf (libraries embedded in the bundle) is passed to a persistence backend: IndexedDB in the
// browser (IDBBackend), nothing in the Node tests.
//
const path = require('./shims/path');

const RO_ROOT = '/lspf';
const td8 = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
const te8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

// ---------------------------------------------------------------------------------------------------------------
// Encodings
// ---------------------------------------------------------------------------------------------------------------
function latin1Decode(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return s;
}
function latin1Encode(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
  return b;
}
function decode(b, enc) {
  enc = String(enc || 'utf8').toLowerCase();
  switch (enc) {
    case 'utf8': case 'utf-8': return td8.decode(b);
    case 'latin1': case 'binary': case 'ascii': return latin1Decode(b);
    case 'base64': return btoa(latin1Decode(b));
    case 'hex': return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    default: return td8.decode(b);
  }
}
function encode(s, enc) {
  enc = String(enc || 'utf8').toLowerCase();
  switch (enc) {
    case 'latin1': case 'binary': case 'ascii': return latin1Encode(s);
    case 'base64': return latin1Encode(atob(s));
    default: return te8.encode(s);
  }
}

// Uint8Array with Node Buffer's toString(encoding)
class VBuffer extends Uint8Array {
  toString(enc) { return decode(this, enc); }
  static from(x, enc) {
    if (typeof x === 'string') { const b = encode(x, enc); const v = new VBuffer(b.length); v.set(b); return v; }
    const v = new VBuffer(x.length); v.set(x); return v;
  }
  static isBuffer(x) { return x instanceof Uint8Array; }
  static alloc(n) { return new VBuffer(n); }
  static concat(list) {
    const n = list.reduce((s, b) => s + b.length, 0);
    const v = new VBuffer(n);
    let o = 0;
    for (const b of list) { v.set(b, o); o += b.length; }
    return v;
  }
  static byteLength(s) { return encode(String(s)).length; }
}

// ---------------------------------------------------------------------------------------------------------------
// Errors and stats
// ---------------------------------------------------------------------------------------------------------------
const MSGS = {
  ENOENT: 'no such file or directory', EEXIST: 'file already exists', ENOTDIR: 'not a directory',
  EISDIR: 'illegal operation on a directory', ENOTEMPTY: 'directory not empty', EROFS: 'read-only file system',
  EINVAL: 'invalid argument', EPERM: 'operation not permitted',
};
function fsError(code, syscall, p, p2) {
  const e = new Error(`${code}: ${MSGS[code] || code}, ${syscall} '${p}'${p2 ? ` -> '${p2}'` : ''}`);
  e.code = code; e.syscall = syscall; e.path = p; e.errno = -1;
  return e;
}

class Stats {
  constructor(n) {
    this.size = n.type === 'file' ? n.data.length : 4096;
    this.mtime = new Date(n.mtime);
    this.ctime = new Date(n.mtime);
    this.atime = new Date(n.mtime);
    this.birthtime = new Date(n.ctime || n.mtime);
    this.mtimeMs = n.mtime;
    this.mode = n.type === 'dir' ? 0o40755 : (n.ro ? 0o100444 : 0o100644);
    this.uid = 1000; this.gid = 1000; this.nlink = 1; this.dev = 1; this.ino = 0; this.blksize = 4096;
    this.blocks = Math.ceil(this.size / 512);
    this._dir = n.type === 'dir';
  }
  isFile() { return !this._dir; }
  isDirectory() { return this._dir; }
  isSymbolicLink() { return false; }
  isFIFO() { return false; }
  isSocket() { return false; }
  isCharacterDevice() { return false; }
  isBlockDevice() { return false; }
}

class Dirent {
  constructor(name, n) { this.name = name; this._dir = n.type === 'dir'; }
  isFile() { return !this._dir; }
  isDirectory() { return this._dir; }
  isSymbolicLink() { return false; }
  isFIFO() { return false; }
  isSocket() { return false; }
  isCharacterDevice() { return false; }
  isBlockDevice() { return false; }
}

// ---------------------------------------------------------------------------------------------------------------
// Case-insensitive, case-preserving map of paths (like Windows):  ISPF command lines and fields are often in
// capitals, "ED ~/EXEMPLES/PROG01.CBL" must open ~/exemples/PROG01.cbl.
// ---------------------------------------------------------------------------------------------------------------
class PathMap {
  constructor() { this.m = new Map(); }
  get(p) { const e = this.m.get(p.toLowerCase()); return e && e.node; }
  has(p) { return this.m.has(p.toLowerCase()); }
  set(p, node) {
    const k = p.toLowerCase(), e = this.m.get(k);
    this.m.set(k, { path: e ? e.path : this.real(p), node });
    return this;
  }
  delete(p) { return this.m.delete(p.toLowerCase()); }
  // Stored spelling of a path (existing parents keep their case)
  real(p) {
    if (p === '/') return '/';
    const e = this.m.get(p.toLowerCase());
    if (e) return e.path;
    const d = path.dirname(p);
    return (d === '/' ? '' : this.real(d)) + '/' + path.basename(p);
  }
  *keys() { for (const e of this.m.values()) yield e.path; }
  *[Symbol.iterator]() { for (const e of this.m.values()) yield [e.path, e.node]; }
  get size() { return this.m.size; }
}

// ---------------------------------------------------------------------------------------------------------------
// VFS
// ---------------------------------------------------------------------------------------------------------------
class VFS {
  constructor() {
    this.nodes = new PathMap();
    this.backend = null;
    this.nodes.set('/', { type: 'dir', mtime: Date.now(), ctime: Date.now(), ro: false });
  }

  abs(p) {
    if (p instanceof URL) p = p.pathname;
    return path.resolve(String(p));
  }
  isRO(p) { p = p.toLowerCase(); return p === RO_ROOT || p.startsWith(RO_ROOT + '/'); }
  get(p) { return this.nodes.get(p); }

  persist(p) {
    if (!this.backend || this.isRO(p)) return;
    const n = this.nodes.get(p);
    if (n) this.backend.put(this.nodes.real(p), n); else this.backend.del(p);
  }

  // Load a node without persisting it (start-up)
  load(p, n) {
    this.ensureParents(p, false, n.ro);
    this.nodes.set(p, n);
  }

  ensureParents(p, persist, ro = false) {
    const parts = p.split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < parts.length - 1; i++) {
      cur += '/' + parts[i];
      if (!this.nodes.has(cur)) {
        this.nodes.set(cur, { type: 'dir', mtime: Date.now(), ctime: Date.now(), ro: ro || this.isRO(cur) });
        if (persist) this.persist(cur);
      }
    }
  }

  // Read-only file of the embedded libraries
  addAsset(p, bytes, mtime) {
    this.load(p, { type: 'file', data: bytes, mtime, ctime: mtime, ro: true });
  }

  checkParent(p, syscall) {
    const d = path.dirname(p);
    const pn = this.nodes.get(d);
    if (!pn) throw fsError('ENOENT', syscall, p);
    if (pn.type !== 'dir') throw fsError('ENOTDIR', syscall, p);
  }

  checkWritable(p, syscall) {
    if (this.isRO(p)) throw fsError('EROFS', syscall, p);
  }

  children(p) {
    const pre = (p === '/' ? '/' : p + '/').toLowerCase();
    const out = [];
    for (const k of this.nodes.keys()) {
      const kl = k.toLowerCase();
      if (kl.length > pre.length && kl.startsWith(pre) && kl.indexOf('/', pre.length) < 0) out.push(k.slice(pre.length));
    }
    return out.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  }

  // Stored paths of p and everything below it
  subtree(p) {
    const pl = p.toLowerCase(), pre = pl + '/';
    return [...this.nodes.keys()].filter(k => { const kl = k.toLowerCase(); return kl === pl || kl.startsWith(pre); });
  }

  // ---- fs API ---------------------------------------------------------------------------------------------
  existsSync(p) { try { return this.nodes.has(this.abs(p)); } catch (e) { return false; } }

  statSync(p, opts) {
    const a = this.abs(p);
    const n = this.nodes.get(a);
    if (!n) { if (opts && opts.throwIfNoEntry === false) return undefined; throw fsError('ENOENT', 'stat', a); }
    return new Stats(n);
  }
  lstatSync(p, opts) { return this.statSync(p, opts); }

  readFileSync(p, opts) {
    const a = this.abs(p);
    const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'open', a);
    if (n.type === 'dir') throw fsError('EISDIR', 'read', a);
    if (enc) return decode(n.data, enc);
    return VBuffer.from(n.data);
  }

  writeFileSync(p, data, opts) {
    const a = this.abs(p);
    const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
    const flag = opts && typeof opts === 'object' && opts.flag;
    this.checkWritable(a, 'open');
    this.checkParent(a, 'open');
    const old = this.nodes.get(a);
    if (old && old.type === 'dir') throw fsError('EISDIR', 'open', a);
    if (flag === 'wx' && old) throw fsError('EEXIST', 'open', a);
    let bytes = typeof data === 'string' ? encode(data, enc) : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    if (flag === 'a' && old) { const m = new Uint8Array(old.data.length + bytes.length); m.set(old.data); m.set(bytes, old.data.length); bytes = m; }
    const now = Date.now();
    this.nodes.set(a, { type: 'file', data: bytes, mtime: now, ctime: old ? old.ctime : now, ro: false });
    this.persist(a);
  }

  appendFileSync(p, data, opts) {
    const o = typeof opts === 'string' ? { encoding: opts } : Object.assign({}, opts || {});
    o.flag = 'a';
    this.writeFileSync(p, data, o);
  }

  readdirSync(p, opts) {
    const a = this.abs(p);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'scandir', a);
    if (n.type !== 'dir') throw fsError('ENOTDIR', 'scandir', a);
    const names = this.children(a);
    if (opts && opts.withFileTypes) return names.map(x => new Dirent(x, this.nodes.get(a === '/' ? '/' + x : a + '/' + x)));
    return names;
  }

  mkdirSync(p, opts) {
    const a = this.abs(p);
    const rec = opts && (opts === true || opts.recursive);
    const n = this.nodes.get(a);
    if (n) {
      if (rec && n.type === 'dir') return undefined;
      throw fsError('EEXIST', 'mkdir', a);
    }
    this.checkWritable(a, 'mkdir');
    if (rec) this.ensureParents(a, true); else this.checkParent(a, 'mkdir');
    this.nodes.set(a, { type: 'dir', mtime: Date.now(), ctime: Date.now(), ro: false });
    this.persist(a);
    return rec ? a : undefined;
  }

  mkdtempSync(prefix) {
    for (;;) {
      const p = prefix + Math.random().toString(36).slice(2, 8);
      if (!this.existsSync(p)) { this.mkdirSync(p, { recursive: true }); return this.abs(p); }
    }
  }

  unlinkSync(p) {
    const a = this.abs(p);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'unlink', a);
    this.checkWritable(a, 'unlink');
    if (n.type === 'dir') throw fsError('EISDIR', 'unlink', a);
    this.nodes.delete(a);
    this.persist(a);
  }

  rmdirSync(p, opts) {
    const a = this.abs(p);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'rmdir', a);
    this.checkWritable(a, 'rmdir');
    if (n.type !== 'dir') throw fsError('ENOTDIR', 'rmdir', a);
    if (a === '/') throw fsError('EPERM', 'rmdir', a);
    if (this.children(a).length && !(opts && opts.recursive)) throw fsError('ENOTEMPTY', 'rmdir', a);
    for (const k of this.subtree(a).sort().reverse()) { this.nodes.delete(k); this.persist(k); }
  }

  rmSync(p, opts = {}) {
    const a = this.abs(p);
    const n = this.nodes.get(a);
    if (!n) { if (opts.force) return; throw fsError('ENOENT', 'rm', a); }
    if (n.type === 'dir') {
      if (!opts.recursive) throw fsError('EISDIR', 'rm', a);
      this.rmdirSync(a, { recursive: true });
    } else this.unlinkSync(a);
  }

  renameSync(from, to) {
    const a = this.abs(from), b = this.abs(to);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'rename', a, b);
    this.checkWritable(a, 'rename');
    this.checkWritable(b, 'rename');
    this.checkParent(b, 'rename');
    if (this.nodes.real(a) === b) return;
    if (b.toLowerCase().startsWith(a.toLowerCase() + '/')) throw fsError('EINVAL', 'rename', a, b);
    const sameNode = a.toLowerCase() === b.toLowerCase();   // change of case only
    const t = sameNode ? null : this.nodes.get(b);
    if (t && t.type === 'dir' && (n.type !== 'dir' || this.children(b).length)) throw fsError(n.type === 'dir' ? 'ENOTEMPTY' : 'EISDIR', 'rename', a, b);
    if (t) { for (const k of this.subtree(b)) { this.nodes.delete(k); this.persist(k); } }
    for (const k of this.subtree(a).sort()) {
      const nn = this.nodes.get(k);
      const nk = b + k.slice(a.length);
      this.nodes.delete(k); this.persist(k);
      this.nodes.set(nk, nn); this.persist(nk);
    }
  }

  copyFileSync(from, to, flags) {
    const a = this.abs(from), b = this.abs(to);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'copyfile', a, b);
    if (n.type === 'dir') throw fsError('EISDIR', 'copyfile', a, b);
    if (flags === 1 && this.nodes.has(b)) throw fsError('EEXIST', 'copyfile', a, b);
    this.writeFileSync(b, n.data);
  }

  cpSync(from, to, opts = {}) {
    const a = this.abs(from), b = this.abs(to);
    const n = this.nodes.get(a);
    if (!n) throw fsError('ENOENT', 'cp', a, b);
    if (n.type !== 'dir') return this.copyFileSync(a, b);
    if (!opts.recursive) throw fsError('EISDIR', 'cp', a, b);
    if (b === a || b.startsWith(a + '/')) throw fsError('EINVAL', 'cp', a, b);
    this.mkdirSync(b, { recursive: true });
    for (const c of this.children(a)) this.cpSync(a + '/' + c, b + '/' + c, opts);
  }

  realpathSync(p) {
    const a = this.abs(p);
    if (!this.nodes.has(a)) throw fsError('ENOENT', 'realpath', a);
    return this.nodes.real(a);
  }

  accessSync(p) {
    const a = this.abs(p);
    if (!this.nodes.has(a)) throw fsError('ENOENT', 'access', a);
  }

  // All user files (for backups): [{ path, type, data }]
  userEntries() {
    const out = [];
    for (const [k, n] of this.nodes) if (k !== '/' && !this.isRO(k)) out.push({ path: k, type: n.type, data: n.data, mtime: n.mtime });
    return out.sort((x, y) => (x.path < y.path ? -1 : 1));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// IndexedDB persistence (browser)
// ---------------------------------------------------------------------------------------------------------------
class IDBBackend {
  constructor(db) { this.db = db; this.pending = 0; this.waiters = []; this.errors = 0; }

  static open(name = 'lspf-pwa') {
    return new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      // key = path in lower case (the file system is case-insensitive), path = stored spelling
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'key' });
      r.onsuccess = () => res(new IDBBackend(r.result));
      r.onerror = () => rej(r.error);
    });
  }

  loadAll() {
    return new Promise((res, rej) => {
      const out = [];
      const tx = this.db.transaction('files', 'readonly');
      const c = tx.objectStore('files').openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); };
      c.onerror = () => rej(c.error);
    });
  }

  op(f) {
    this.pending++;
    const tx = this.db.transaction('files', 'readwrite');
    f(tx.objectStore('files'));
    const done = () => { if (--this.pending === 0) { const w = this.waiters; this.waiters = []; w.forEach(x => x()); } };
    tx.oncomplete = done;
    tx.onerror = tx.onabort = () => { this.errors++; console.error('IndexedDB', tx.error); done(); };
  }

  put(p, n) {
    const rec = { key: p.toLowerCase(), path: p, type: n.type, mtime: n.mtime, ctime: n.ctime || n.mtime };
    if (n.type === 'file') rec.data = n.data;
    this.op(s => s.put(rec));
  }
  del(p) { this.op(s => s.delete(p.toLowerCase())); }
  clear() { this.op(s => s.clear()); }

  // Resolves when every pending write is on disk
  flush() { return this.pending ? new Promise(r => this.waiters.push(r)) : Promise.resolve(); }
}

const instance = new VFS();

module.exports = { VFS, IDBBackend, VBuffer, instance, decode, encode, latin1Encode, RO_ROOT };
