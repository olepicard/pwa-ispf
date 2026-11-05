'use strict';
//
// Browser replacement for Node's 'fs' module: the synchronous API on the virtual file system (../vfs.js).
//
const { instance: vfs } = require('../vfs');

const API = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'writeFileSync', 'appendFileSync', 'readdirSync',
  'mkdirSync', 'mkdtempSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'cpSync',
  'realpathSync', 'accessSync'];

const fs = {};
for (const f of API) fs[f] = vfs[f].bind(vfs);
fs.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 };

// callback / promise variants built on the synchronous ones (not used by lspf, provided for completeness)
const cb = (name) => (...a) => {
  const done = typeof a[a.length - 1] === 'function' ? a.pop() : () => {};
  queueMicrotask(() => { try { done(null, fs[name + 'Sync'](...a)); } catch (e) { done(e); } });
};
fs.promises = {};
for (const f of API) {
  const n = f.replace(/Sync$/, '');
  if (n === f) continue;
  fs[n] = cb(n);
  fs.promises[n] = (...a) => new Promise((res, rej) => { try { res(fs[f](...a)); } catch (e) { rej(e); } });
}

module.exports = fs;
