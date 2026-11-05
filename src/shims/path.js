'use strict';
//
// Browser replacement for Node's 'path' module (POSIX semantics only).
//
const proc = require('./process');

function normalizeArray(parts, allowAbove) {
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (allowAbove) out.push('..');
      continue;
    }
    out.push(p);
  }
  return out;
}

function normalize(p) {
  p = String(p);
  if (p === '') return '.';
  const abs = p.startsWith('/');
  const trail = p.endsWith('/');
  let r = normalizeArray(p.split('/'), !abs).join('/');
  if (!r && !abs) r = '.';
  if (r && trail) r += '/';
  return (abs ? '/' : '') + r;
}

function join(...parts) {
  const ps = parts.map(String).filter(x => x !== '');
  return ps.length ? normalize(ps.join('/')) : '.';
}

function resolve(...parts) {
  let r = '';
  for (let i = parts.length - 1; i >= 0 && !r.startsWith('/'); i--) {
    const p = String(parts[i]);
    if (!p) continue;
    r = p + (r ? '/' + r : '');
  }
  if (!r.startsWith('/')) r = proc.cwd() + (r ? '/' + r : '');
  const n = '/' + normalizeArray(r.split('/'), false).join('/');
  return n;
}

function isAbsolute(p) { return String(p).startsWith('/'); }

function dirname(p) {
  p = String(p);
  if (!p) return '.';
  const s = p.replace(/\/+$/, '') || '/';
  if (s === '/') return '/';
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return s.slice(0, i);
}

function basename(p, ext) {
  let b = String(p).replace(/\/+$/, '');
  b = b.slice(b.lastIndexOf('/') + 1);
  if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
  return b;
}

function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}

function relative(from, to) {
  const f = resolve(from).split('/').filter(Boolean);
  const t = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/');
}

function parse(p) {
  const root = isAbsolute(p) ? '/' : '';
  const base = basename(p);
  const ext = extname(p);
  return { root, dir: dirname(p), base, ext, name: ext ? base.slice(0, -ext.length) : base };
}

function format(o) {
  const dir = o.dir || o.root || '';
  const base = o.base || (o.name || '') + (o.ext || '');
  return dir ? (dir.endsWith('/') ? dir + base : dir + '/' + base) : base;
}

const path = { sep: '/', delimiter: ':', normalize, join, resolve, isAbsolute, dirname, basename, extname, relative, parse, format };
path.posix = path;
module.exports = path;
