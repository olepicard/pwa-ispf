'use strict';
//
// lspf PWA: start-up, session life cycle, key bar, menu (files, backup, font size, full screen).
//
// The Dialogue Manager and the applications are those of node-lspf, unchanged; only the terminal, the keyboard
// and the file system (IndexedDB) are specific to the browser.
//
const proc = require('./shims/process');
const path = require('./shims/path');
const { instance: vfs, IDBBackend, latin1Encode, decode } = require('./vfs');

const HOME = proc.env.HOME;
const PROFILE = HOME + '/.lspf-node';
const BUILD = (typeof self !== 'undefined' && self.__LSPF_BUILD__) || { version: 'dev', date: '' };

// ---------------------------------------------------------------------------------------------------------------
// File system: embedded libraries (read-only /lspf) + user files (IndexedDB)
// ---------------------------------------------------------------------------------------------------------------
function installAssets() {
  const assets = self.__LSPF_ASSETS__ || {};
  const t = Date.parse(BUILD.date) || Date.now();
  for (const p of Object.keys(assets)) vfs.addAsset(p, latin1Encode(assets[p]), t);
}

const SAMPLES = {
  'LISEZMOI.txt': [
    'lspf pour Android (PWA) - premiers pas',
    '======================================',
    '',
    'Ce répertoire (/home/lspf) est conservé dans le stockage du navigateur.',
    '',
    'Barre de touches en bas : F1..F12 (touche ⇧ pour F13..F24), Entrée, Tab, flèches...',
    'Les libellés des touches suivent vos définitions (commande KEYS).',
    '',
    'Écran tactile :',
    '  toucher            place le curseur (une touche PF affichée en bas : l\'appuie)',
    '  appui long         Entrée à cet endroit',
    '  glisser horizontal décale l\'affichage (EDIT, VIEW, BROWSE)',
    '  glisser vertical   fait défiler (UP / DOWN)',
    '  deux doigts        déplacer la vue, pincer pour changer la taille du texte',
    '',
    'Menu ☰ : importer / exporter des fichiers, sauvegarde complète, taille du texte, plein écran.',
    '',
    'Macros d\'édition : ~/.lspf-node/rexx (SUPALL, SUPFIND, SUPRES, EXMACRO sont fournies).',
    'Exemple : éditer exemples/PROG01.cbl, placer le curseur sur un mot et taper SUPALL.',
    '',
    'Les commandes système (option 6, TSO, SHELL) ne sont pas disponibles dans un navigateur.',
  ].join('\n') + '\n',
  'exemples/PROG01.cbl': [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. PROG01.',
    '      * Programme d\'exemple pour lspf PWA',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       01  WS-COMPTEUR      PIC 9(4) VALUE 0.',
    '       01  WS-TOTAL         PIC 9(6) VALUE 0.',
    '       01  WS-MESSAGE       PIC X(40) VALUE \'BONJOUR\'.',
    '       PROCEDURE DIVISION.',
    '       DEBUT.',
    '           PERFORM VARYING WS-COMPTEUR FROM 1 BY 1',
    '                   UNTIL WS-COMPTEUR > 10',
    '               ADD WS-COMPTEUR TO WS-TOTAL',
    '           END-PERFORM',
    '      * Affichage du résultat',
    '           DISPLAY WS-MESSAGE',
    '           DISPLAY \'TOTAL = \' WS-TOTAL',
    '           STOP RUN.',
  ].join('\n') + '\n',
  'exemples/JOB01.jcl': [
    '//JOB01    JOB (ACCT),\'EXEMPLE\',CLASS=A,MSGCLASS=X,NOTIFY=&SYSUID',
    '//*',
    '//* Exemple de JCL - compilation et exécution',
    '//*',
    '//STEP1    EXEC PGM=IEFBR14',
    '//DD1      DD DSN=USER.TEST.DATA,DISP=(NEW,CATLG,DELETE),',
    '//            SPACE=(TRK,(1,1)),UNIT=SYSDA,',
    '//            DCB=(RECFM=FB,LRECL=80,BLKSIZE=27920)',
    '//STEP2    EXEC PGM=PROG01',
    '//SYSOUT   DD SYSOUT=*',
  ].join('\n') + '\n',
  'exemples/large.txt': Array.from({ length: 30 }, (_, i) =>
    `${String(i + 1).padStart(3, '0')} ` + 'Ligne longue pour essayer le glisser horizontal - '.repeat(4) + `fin ${i + 1}`).join('\n') + '\n',
};

function seed() {
  if (vfs.existsSync(HOME)) { if (!vfs.existsSync(PROFILE + '/rexx')) vfs.mkdirSync(PROFILE + '/rexx', { recursive: true }); return false; }
  vfs.mkdirSync(HOME, { recursive: true });
  vfs.mkdirSync(PROFILE + '/rexx', { recursive: true });
  vfs.mkdirSync('/tmp', { recursive: true });
  for (const [f, t] of Object.entries(SAMPLES)) {
    vfs.mkdirSync(path.dirname(HOME + '/' + f), { recursive: true });
    vfs.writeFileSync(HOME + '/' + f, t);
  }
  return true;
}

async function openStorage() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const be = await IDBBackend.open();
    const recs = await be.loadAll();
    for (const r of recs.sort((a, b) => (a.path < b.path ? -1 : 1))) {
      if (vfs.isRO(r.path)) continue;
      vfs.load(r.path, r.type === 'dir'
        ? { type: 'dir', mtime: r.mtime, ctime: r.ctime, ro: false }
        : { type: 'file', data: r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data || []), mtime: r.mtime, ctime: r.ctime, ro: false });
    }
    vfs.backend = be;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return be;
  } catch (e) {
    console.error('IndexedDB not available', e);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------------------------
const state = { session: null, term: null, input: null, ended: false, shift: false, kbdWanted: false };

function startSession(sel) {
  const { Session } = require('/lspf/lib/session.js');
  const term = state.term;
  term.removeAllListeners('key');
  term.removeAllListeners('resize');
  const config = { root: '/lspf', zuprof: PROFILE, user: proc.env.USER, version: BUILD.version + '-pwa', terminal: term };
  const s = new Session(config);
  state.session = s;
  state.ended = false;
  hideOverlay();
  s.start(sel || { pgm: 'PMAIN0A', parm: '', newappl: 'ISP', newpool: true })
    .then(() => endSession('Session lspf terminée.'))
    .catch((e) => { if (!(e && e.isProcessExit)) endSession('Erreur : ' + (e && e.message || e)); });
  return s;
}

function endSession(msg) {
  if (state.ended) return;
  state.ended = true;
  try { state.session && state.session.pools.saveAll(); } catch (e) { /* ignore */ }
  showOverlay(msg + '\n\nToucher pour relancer lspf.', () => startSession());
}

// ---------------------------------------------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function showOverlay(msg, onTap) {
  const o = $('overlay');
  o.textContent = msg;
  o.hidden = false;
  o.onclick = () => { o.hidden = true; if (onTap) onTap(); };
}
function hideOverlay() { $('overlay').hidden = true; }

function focusKbd() {
  const ta = $('kbd');
  ta.blur();
  ta.focus({ preventScroll: true });
  state.input.reset();
}

// ---------------------------------------------------------------------------------------------------------------
// Key bar
// ---------------------------------------------------------------------------------------------------------------
const DEFAULT_PF = [null, 'HELP', 'SPLIT', 'END', 'RETURN', 'RFIND', 'RCHANGE', 'UP', 'DOWN', 'SWAP', 'LEFT', 'RIGHT', 'RETRIEVE'];

function pfLabel(n) {
  const s = state.session;
  if (!s) return '';
  const v = s.pools.isps.vars;
  const pad = String(n).padStart(2, '0');
  const lab = v.get('ZPFL' + pad) || '';
  const cmd = (v.get('ZPF' + pad) || '').trim();
  const w = cmd.split(/\s+/)[0].toUpperCase();
  const deflt = DEFAULT_PF[((n - 1) % 12) + 1];
  let l = (!lab || (lab.toUpperCase() === deflt && w !== deflt)) ? (cmd.split(/\s+/).pop() || '') : lab;
  l = l.toLowerCase().replace(/^./, c => c.toUpperCase());
  return l.slice(0, 8);
}

function key(name, extra) { if (!state.ended) state.term.emitKey(Object.assign({ name }, extra || {})); }

const BAR2 = [
  { id: 'shift', label: '⇧', title: 'F13-F24', act: () => { state.shift = !state.shift; updateFKeys(); } },
  { id: 'kbd', label: '⌨', title: 'Clavier', act: () => { state.kbdWanted = true; focusKbd(); } },
  { label: 'Tab', act: () => key('tab'), repeat: true },
  { label: '⇤', title: 'Tab arrière', act: () => key('backtab'), repeat: true },
  { label: '←', act: () => key('left'), repeat: true },
  { label: '↑', act: () => key('up'), repeat: true },
  { label: '↓', act: () => key('down'), repeat: true },
  { label: '→', act: () => key('right'), repeat: true },
  { label: '⇱', title: 'Début (Home)', act: () => key('home') },
  { label: '⇲', title: 'Fin (End)', act: () => key('end') },
  { id: 'ins', label: 'Ins', title: 'Insertion / remplacement', act: () => key('insert') },
  { label: 'Del', title: 'Supprimer', act: () => key('delete'), repeat: true },
  { label: '⌫', title: 'Retour arrière', act: () => key('backspace'), repeat: true },
  { label: 'EOF', title: 'Effacer jusqu\'à la fin du champ (Ctrl-E)', act: () => key('ctrl', { ch: 'e', ctrl: true }) },
  { label: 'Esc', act: () => key('escape') },
  { id: 'enter', label: 'Entrée', act: () => key('enter') },
  { id: 'menu', label: '☰', title: 'Menu', act: () => openMenu(), onClick: true },
];

// Buttons act on pointerdown (no focus loss: the soft keyboard stays open) and repeat when held
function makeButton(def, cls) {
  const b = document.createElement('button');
  b.className = 'k ' + (cls || '') + (def.id ? ' k-' + def.id : '');
  b.type = 'button';
  b.innerHTML = def.html || '';
  if (!def.html) b.textContent = def.label;
  if (def.title) b.title = def.title;
  let timer = null;
  const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; b.classList.remove('down'); };
  if (def.onClick) b.addEventListener('click', () => def.act());
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('down');
    if (!def.onClick) def.act();
    if (def.repeat) timer = setTimeout(() => { timer = setInterval(def.act, 70); }, 420);
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

function buildBar() {
  const fk = $('fkeys');
  for (let i = 1; i <= 12; i++) {
    const b = makeButton({ html: `<b>F${i}</b><small></small>`, act: () => key('f' + (state.shift ? i + 12 : i)) }, 'fk');
    b.dataset.n = i;
    fk.appendChild(b);
  }
  const ks = $('keys');
  for (const d of BAR2) ks.appendChild(makeButton(d));
}

function updateFKeys() {
  for (const b of document.querySelectorAll('#fkeys .k')) {
    const n = +b.dataset.n + (state.shift ? 12 : 0);
    const label = pfLabel(n);
    const html = `<b>F${n}</b><small>${label.replace(/[<>&]/g, '')}</small>`;
    if (b.innerHTML !== html) b.innerHTML = html;
  }
  document.querySelector('.k-shift').classList.toggle('on', state.shift);
  document.querySelector('.k-ins').classList.toggle('on', state.term.insertMode);
}

// ---------------------------------------------------------------------------------------------------------------
// Files: import, export, backup, restore
// ---------------------------------------------------------------------------------------------------------------
function currentApp() {
  const s = state.session;
  return s && s.current && s.current.currentApp;
}

// Directory shown by the file list (3.4) if any, else the home directory
function currentDir() {
  const s = state.session;
  if (s && s.current) {
    for (let i = s.current.appStack.length - 1; i >= 0; i--) {
      const a = s.current.appStack[i];
      if (a.path && vfs.existsSync(a.path) && vfs.statSync(a.path).isDirectory()) return a.path;
    }
  }
  return HOME;
}

function download(name, bytes, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function importFiles(files) {
  const dir = currentDir();
  let n = 0;
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    vfs.writeFileSync(path.join(dir, f.name.replace(/[/\\]/g, '_')), buf);
    n++;
  }
  toast(`${n} fichier(s) importé(s) dans ${dir}  (Entrée ou REFRESH pour mettre à jour la liste)`, 4000);
}

function exportFile() {
  const app = currentApp();
  const def = (app && app.file) || (currentDir() + '/');
  const p = prompt('Fichier à exporter (chemin dans lspf) :', def);
  if (!p) return;
  try {
    const st = vfs.statSync(p);
    if (st.isDirectory()) { toast('C\'est un répertoire : utilisez la sauvegarde complète.'); return; }
    download(path.basename(p), vfs.readFileSync(p));
  } catch (e) { toast(e.message, 4000); }
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}

async function backup() {
  try { state.session && state.session.pools.saveAll(); } catch (e) { /* ignore */ }
  const files = vfs.userEntries().map(e => (e.type === 'dir' ? { path: e.path, type: 'dir' } : { path: e.path, type: 'file', mtime: e.mtime, data: b64(e.data) }));
  const o = { format: 'lspf-pwa-backup', version: 1, date: new Date().toISOString(), files };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  download(`lspf-sauvegarde-${stamp}.json`, new TextEncoder().encode(JSON.stringify(o)), 'application/json');
  toast(`${files.length} éléments sauvegardés.`);
}

async function restore(file) {
  let o;
  try { o = JSON.parse(await file.text()); } catch (e) { toast('Fichier de sauvegarde illisible.'); return; }
  if (!o || o.format !== 'lspf-pwa-backup' || !Array.isArray(o.files)) { toast('Ce fichier n\'est pas une sauvegarde lspf.'); return; }
  if (!confirm(`Remplacer tous vos fichiers par les ${o.files.length} éléments de la sauvegarde du ${(o.date || '').slice(0, 10)} ?`)) return;
  await wipeUserFiles();
  for (const f of o.files.sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (vfs.isRO(f.path)) continue;
    if (f.type === 'dir') vfs.mkdirSync(f.path, { recursive: true });
    else {
      vfs.mkdirSync(path.dirname(f.path), { recursive: true });
      vfs.writeFileSync(f.path, latin1Encode(atob(f.data)));
    }
  }
  if (vfs.backend) await vfs.backend.flush();
  location.reload();
}

async function wipeUserFiles() {
  for (const e of vfs.userEntries().reverse()) vfs.nodes.delete(e.path);
  if (vfs.backend) { vfs.backend.clear(); await vfs.backend.flush(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------------------------------------------
const MENU = [
  { label: '📂  Importer des fichiers…', act: () => $('importFiles').click() },
  { label: '💾  Exporter un fichier…', act: () => exportFile() },
  { label: '📦  Sauvegarde complète (.json)', act: () => backup() },
  { label: '♻️  Restaurer une sauvegarde…', act: () => $('restoreFile').click() },
  { label: '🔍  Texte plus grand', act: () => state.term.setFontScale(state.term.fontScale * 1.15), keep: true },
  { label: '🔎  Texte plus petit', act: () => state.term.setFontScale(state.term.fontScale / 1.15), keep: true },
  { label: '↺  Taille de texte automatique', act: () => state.term.setFontScale(1) },
  { label: '⛶  Plein écran', act: () => toggleFullscreen() },
  { label: '⌨  Clavier à chaque toucher : ', act: () => { state.kbdWanted = !state.kbdWanted; saveSetting('kbdWanted', state.kbdWanted); }, toggle: () => state.kbdWanted },
  { label: '🗑  Effacer toutes mes données…', act: () => eraseAll() },
  { label: 'ℹ️  À propos', act: () => about() },
];

function openMenu() {
  const m = $('menu');
  m.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'box';
  const h = document.createElement('div');
  h.className = 'title';
  h.textContent = 'lspf ' + BUILD.version;
  box.appendChild(h);
  for (const it of MENU) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label + (it.toggle ? (it.toggle() ? 'oui' : 'non') : '');
    b.onclick = () => { if (!it.keep) closeMenu(); it.act(); if (it.keep || it.toggle) { if (it.toggle) openMenu(); } };
    box.appendChild(b);
  }
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'close';
  c.textContent = 'Fermer';
  c.onclick = closeMenu;
  box.appendChild(c);
  m.appendChild(box);
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeMenu(); };
  state.input.enabled = false;
}
function closeMenu() { $('menu').hidden = true; state.input.enabled = true; }

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast('Plein écran non disponible.'));
}

async function eraseAll() {
  if (!confirm('Effacer définitivement tous vos fichiers, profils et macros personnelles ?')) return;
  await wipeUserFiles();
  location.reload();
}

function about() {
  showOverlay([
    `lspf ${BUILD.version} — version PWA (${BUILD.date.slice(0, 10)})`,
    '',
    'Clone du Dialogue Manager ISPF : panneaux, tables, éditeur, macros REXX.',
    'Moteur : node-lspf, exécuté dans le navigateur. Licence GPL v3.',
    '',
    `Fichiers personnels : ${vfs.userEntries().length} éléments (stockage du navigateur${vfs.backend ? '' : ' INDISPONIBLE : rien n\'est conservé'}).`,
    '',
    'Toucher pour revenir.',
  ].join('\n'), null);
}

function loadSetting(k, d) { try { const v = localStorage.getItem('lspf.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
function saveSetting(k, v) { try { localStorage.setItem('lspf.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------------------------------
async function boot() {
  installAssets();
  await openStorage();
  seed();

  const { WebTerminal } = require('./webterm');
  const { KeyInput } = require('./input');
  state.kbdWanted = loadSetting('kbdWanted', false);
  buildBar();                     // first: the terminal is sized in the space left by the key bar
  state.term = new WebTerminal($('screen'), $('wrap'), {
    fontScale: loadSetting('fontScale', 1),
    onTap: () => { if (state.kbdWanted) focusKbd(); },
    keyboardOpen: () => document.activeElement === $('kbd') && !!window.visualViewport && window.visualViewport.height < window.screen.height * 0.75,
  });
  state.input = new KeyInput(state.term, $('kbd'));
  state.term.on('rendered', updateFKeys);

  $('importFiles').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };
  $('restoreFile').onchange = (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; };

  // Android Back button = F3 (END) instead of leaving the application
  history.pushState({ lspf: 1 }, '');
  window.addEventListener('popstate', () => {
    history.pushState({ lspf: 1 }, '');
    if (!$('menu').hidden) { closeMenu(); return; }
    key('f3');
  });

  // profiles are written when the application is hidden or closed
  const save = () => { try { state.session && state.session.pools.saveAll(); } catch (e) { /* ignore */ } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  proc.exitHandler = (code) => {
    setTimeout(() => endSession(code ? `lspf s'est arrêté (code ${code}).` : 'Session lspf terminée.'), 0);
  };
  startSession();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Nouvelle version installée : elle sera utilisée au prochain lancement.', 5000);
        });
      });
    }).catch((e) => console.warn('Service worker', e));
  }
}

// Test / debugging hooks
const LSPF = {
  vfs, state, boot, startSession, backup, decode, installAssets, seed, HOME, PROFILE,
  text: () => (state.term ? state.term.text() : ''),
  key: (name, extra) => key(name, extra),
  type: (s) => { for (const ch of s) key('char', { ch }); },
};

if (typeof window !== 'undefined') window.LSPF = LSPF;
module.exports = LSPF;
