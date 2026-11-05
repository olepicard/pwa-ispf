'use strict';
//
// No processes in a browser: system commands (option 6, TSO/SHELL, ADDRESS SYSTEM in macros) report an error.
//
const MSG = 'Les commandes système ne sont pas disponibles dans la version PWA (navigateur).\n';

function spawnSync() {
  return { status: 127, signal: null, stdout: '', stderr: MSG, output: [null, '', MSG], pid: 0 };
}

function unavailable() { throw new Error(MSG.trim()); }

module.exports = { spawnSync, execSync: unavailable, spawn: unavailable, exec: unavailable, execFileSync: unavailable };
