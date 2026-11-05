'use strict';
//
// Browser replacement for Node's 'os' module.
//
const proc = require('./process');

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
const android = /Android\s+([\d.]+)/.exec(ua);

module.exports = {
  EOL: '\n',
  homedir: () => proc.env.HOME,
  tmpdir: () => '/tmp',
  hostname: () => (android ? 'android' : 'browser'),
  type: () => (android ? 'Android' : 'Browser'),
  platform: () => 'linux',
  release: () => (android ? android[1] : ''),
  version: () => ua,
  arch: () => 'wasm',
  userInfo: () => ({ username: proc.env.USER, uid: 1000, gid: 1000, homedir: proc.env.HOME, shell: '' }),
  cpus: () => [],
  totalmem: () => 0,
  freemem: () => 0,
  uptime: () => performance.now() / 1000,
};
