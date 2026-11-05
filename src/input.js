'use strict';
//
// Keyboard input for the web terminal.
//
//  - physical keyboards (PC, Chromebook, Samsung DeX, Bluetooth):  keydown events are mapped to lspf key names
//  - Android soft keyboards send almost everything as text composition (keyCode 229): the characters are taken
//    from the changes of a hidden textarea.  The textarea always holds a sentinel text so that Backspace can be
//    seen even when nothing has been typed.
//
const SENTINEL = '        ';

const NAMED = {
  Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Escape: 'escape',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

class KeyInput {
  constructor(term, textarea) {
    this.term = term;
    this.ta = textarea;
    this.composing = false;
    this.enabled = true;
    this.reset();
    textarea.addEventListener('input', () => this.onInput());
    textarea.addEventListener('compositionstart', () => { this.composing = true; });
    textarea.addEventListener('compositionend', () => { this.composing = false; this.onInput(); this.reset(); });
    textarea.addEventListener('blur', () => this.reset());
    document.addEventListener('keydown', (e) => this.onKeyDown(e), true);
  }

  emit(k) { if (this.enabled) this.term.emitKey(k); }

  reset() {
    this.ta.value = SENTINEL;
    try { this.ta.setSelectionRange(SENTINEL.length, SENTINEL.length); } catch (e) { /* not focused */ }
    this.prev = SENTINEL;
  }

  // Characters added / removed in the textarea since the last event
  onInput() {
    const v = this.ta.value, p0 = this.prev;
    let i = 0;
    while (i < v.length && i < p0.length && v[i] === p0[i]) i++;
    const dels = p0.length - i;
    const ins = v.slice(i);
    for (let k = 0; k < dels; k++) this.emit({ name: 'backspace' });
    for (const ch of ins) {
      if (ch === '\n' || ch === '\r') this.emit({ name: 'enter' });
      else if (ch === '\t') this.emit({ name: 'tab' });
      else this.emit({ name: 'char', ch });
    }
    this.prev = v;
    // keep the field short; never touch it while the keyboard is composing a word
    if (!this.composing && (v.length < SENTINEL.length || v.length > 64 || ins.includes('\n'))) this.reset();
  }

  onKeyDown(e) {
    if (!this.enabled || e.defaultPrevented) return;
    const t = e.target;
    // dialogs of the PWA keep their keys
    if (t && t !== this.ta && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.isComposing || e.keyCode === 229) return;   // soft keyboard: handled by onInput
    const k = this.map(e);
    if (k) {
      e.preventDefault();
      e.stopPropagation();
      this.emit(k);
      return;
    }
    // printable character without modifier: from the textarea through onInput, otherwise directly
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && t !== this.ta) {
      e.preventDefault();
      this.emit({ name: 'char', ch: e.key });
    }
  }

  map(e) {
    const key = e.key;
    const fk = /^F(\d{1,2})$/.exec(key);
    if (fk) {
      const n = +fk[1];
      return { name: 'f' + (e.shiftKey && n <= 12 ? n + 12 : n) };
    }
    if (key === 'Tab' && e.shiftKey) return { name: 'backtab' };
    if (NAMED[key]) {
      if (key === 'Backspace' && e.target === this.ta && !e.ctrlKey) {
        // let the textarea see it (keeps the diff in sync) unless it is empty
        return null;
      }
      return { name: NAMED[key], shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
    }
    if (key.length === 1 && e.ctrlKey && !e.altKey && /[a-z]/i.test(key)) return { name: 'ctrl', ch: key.toLowerCase(), ctrl: true };
    if (key.length === 1 && e.altKey && !e.ctrlKey && /[a-z0-9]/i.test(key)) return { name: 'alt', ch: key, alt: true };
    return null;
  }
}

module.exports = { KeyInput };
