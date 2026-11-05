// Module loader of the lspf PWA bundle (CommonJS, synchronous).  Appended to lspf-bundle.js by build.js.
// Modules are functions registered in self.__LSPF_MODULES__ by absolute path:
//   /pwa/...   PWA code (src/)          /lspf/...  node-lspf (lib/, apps/)
(function (G) {
  'use strict';
  const defs = G.__LSPF_MODULES__;
  const cache = Object.create(null);
  const SHIMS = {
    fs: '/pwa/shims/fs.js', path: '/pwa/shims/path.js', os: '/pwa/shims/os.js', events: '/pwa/shims/events.js',
    child_process: '/pwa/shims/child_process.js', process: '/pwa/shims/process.js',
  };
  let PROCESS, BUFFER;

  function norm(p) {
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') out.pop(); else out.push(s);
    }
    return '/' + out.join('/');
  }
  function dirname(p) { return p.slice(0, p.lastIndexOf('/')) || '/'; }

  function resolve(from, name) {
    const bare = name.replace(/^node:/, '');
    if (SHIMS[bare]) return SHIMS[bare];
    const base = name.startsWith('/') ? norm(name) : norm(dirname(from) + '/' + name);
    for (const c of [base, base + '.js', base + '.json', base + '/index.js']) if (defs[c]) return c;
    const e = new Error(`Cannot find module '${name}' (required from ${from})`);
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }

  function load(id) {
    if (cache[id]) return cache[id].exports;
    const def = defs[id];
    const module = { id, filename: id, exports: {}, loaded: false };
    cache[id] = module;
    if (typeof def === 'string') module.exports = JSON.parse(def);
    else {
      const req = (n) => load(resolve(id, n));
      req.resolve = (n) => resolve(id, n);
      req.cache = cache;
      def.call(module.exports, module, module.exports, req, id, dirname(id), PROCESS, BUFFER);
    }
    module.loaded = true;
    return module.exports;
  }

  PROCESS = load('/pwa/shims/process.js');
  BUFFER = load('/pwa/vfs.js').VBuffer;
  G.process = G.process || PROCESS;
  G.lspfRequire = (n) => load(resolve('/', n));

  const main = load('/pwa/main.js');
  if (typeof document !== 'undefined' && document.getElementById('screen')) {
    const go = () => main.boot().catch((e) => {
      console.error(e);
      const o = document.getElementById('overlay');
      if (o) { o.textContent = 'Erreur au démarrage de lspf :\n' + (e && e.stack || e); o.hidden = false; }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})(typeof self !== 'undefined' ? self : globalThis);
