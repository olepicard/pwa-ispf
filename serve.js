#!/usr/bin/env node
'use strict';
//
// Small static server for www/ (no dependencies), to try the PWA:
//
//   node serve.js [--port 8080] [--host 127.0.0.1] [--dir www]
//
// A PWA (service worker, installation) needs a secure origin: https://, or http://localhost.
// On an Android phone connected by USB:  adb reverse tcp:8080 tcp:8080  then open http://localhost:8080
//
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const PORT = +opt('--port', process.env.PORT || 8080);
const HOST = opt('--host', '127.0.0.1');
const ROOT = path.resolve(__dirname, opt('--dir', 'www'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function serve(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const type = TYPES[path.extname(f)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (path.basename(f) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    if (/gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|manifest/.test(type) && data.length > 1024) {
      headers['Content-Encoding'] = 'gzip';
      data = zlib.gzipSync(data);
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

if (require.main === module) {
  http.createServer(serve).listen(PORT, HOST, () => {
    console.log(`lspf PWA: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/  (${ROOT})`);
    if (HOST === '127.0.0.1') console.log('Android (USB):  adb reverse tcp:' + PORT + ' tcp:' + PORT + '  puis ouvrir http://localhost:' + PORT + ' dans Chrome');
  });
}

module.exports = { serve, ROOT };
