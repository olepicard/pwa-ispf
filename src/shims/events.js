'use strict';
//
// Browser replacement for Node's 'events' module (EventEmitter only).
//
class EventEmitter {
  constructor() { this._ev = new Map(); }
  _list(n) { if (!this._ev) this._ev = new Map(); if (!this._ev.has(n)) this._ev.set(n, []); return this._ev.get(n); }
  on(n, f) { this._list(n).push(f); return this; }
  addListener(n, f) { return this.on(n, f); }
  prependListener(n, f) { this._list(n).unshift(f); return this; }
  once(n, f) { const w = (...a) => { this.off(n, w); f(...a); }; w.listener = f; return this.on(n, w); }
  off(n, f) {
    const l = this._list(n);
    const i = l.findIndex(x => x === f || x.listener === f);
    if (i >= 0) l.splice(i, 1);
    return this;
  }
  removeListener(n, f) { return this.off(n, f); }
  removeAllListeners(n) { if (n === undefined) this._ev = new Map(); else this._ev.delete(n); return this; }
  emit(n, ...a) {
    const l = this._ev && this._ev.get(n);
    if (!l || !l.length) { if (n === 'error') throw a[0]; return false; }
    for (const f of l.slice()) f.apply(this, a);
    return true;
  }
  listenerCount(n) { return this._ev && this._ev.has(n) ? this._ev.get(n).length : 0; }
  listeners(n) { return this._list(n).slice(); }
  setMaxListeners() { return this; }
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
module.exports.default = EventEmitter;
