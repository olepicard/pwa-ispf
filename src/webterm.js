'use strict';
//
// Canvas terminal for the browser.  Same interface as node-lspf's lib/terminal.js Terminal:
//   rows, cols, insertMode, start(), stop(), beep(), invalidate(), render(screen, cursorRow, cursorCol)
//   events 'key' (same key objects as the ANSI decoder) and 'resize'
//
// Pointer input (mouse, touch, pen) is translated into the mouse events of lspf-node:
//   mouse    : press / drag / release / wheel, buttons as they are
//   touch    : tap = left click,  long press = right click (ENTER by default),
//              horizontal drag = left button drag (horizontal scrolling in EDIT / VIEW / BROWSE),
//              vertical swipe = wheel (UP / DOWN),  two fingers = pan the view / pinch = font size
//
const EventEmitter = require('./shims/events');

const PALETTE = {
  low: ['#000000', '#e5534b', '#3fcf5f', '#5b8cff', '#d8c040', '#d070d8', '#30c8c8', '#c8ccd0'],
  high: ['#000000', '#ff7b72', '#6dff8a', '#9cbcff', '#ffff66', '#ff90ff', '#66ffff', '#ffffff'],
};
const A_HIGH = 8, A_REV = 16, A_UL = 32;
const MIN_COLS = 80, MIN_ROWS = 24, MAX_COLS = 220;
const FONT = '"Cascadia Mono", "DejaVu Sans Mono", "Roboto Mono", "Droid Sans Mono", "Noto Sans Mono", Menlo, Consolas, monospace';

// Box drawing characters drawn with lines (fonts on Android do not always align them on the grid)
const BOX = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ru', '┘': 'lu', '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'lrud',
  '═': 'lr', '║': 'ud',
};

class WebTerminal extends EventEmitter {
  constructor(canvas, wrap, opts = {}) {
    super();
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.insertMode = false;
    this.rows = MIN_ROWS;
    this.cols = MIN_COLS;
    this.fontScale = opts.fontScale || 1;
    this.onTap = opts.onTap || (() => {});
    this.keyboardOpen = opts.keyboardOpen || (() => false);
    this.last = null;
    this.cursorOn = true;
    this.drawQueued = false;
    this.lastCursor = '';
    this.fit(true);
    this.installPointer();
    this.blink = setInterval(() => { this.cursorOn = !this.cursorOn; this.queueDraw(); }, 600);
    if (window.ResizeObserver) new ResizeObserver(() => this.fit(false)).observe(wrap);
    else window.addEventListener('resize', () => this.fit(false));
  }

  // ---- interface used by the Session ------------------------------------------------------------------------
  start() {}
  stop() {}
  write() {}
  invalidate() { this.queueDraw(); }
  beep() {
    if (navigator.vibrate) navigator.vibrate(40);
    this.flash = Date.now();
    this.queueDraw();
  }
  render(scr, crow, ccol) {
    this.last = { scr, crow, ccol };
    this.cursorOn = true;
    this.queueDraw();
    this.emit('rendered');
  }
  emitKey(k) { this.emit('key', k); }

  // Text of the last screen (tests, accessibility)
  text() {
    if (!this.last) return '';
    const s = this.last.scr, out = [];
    for (let r = 0; r < s.rows; r++) out.push(s.ch.slice(r * s.cols, (r + 1) * s.cols).join('').replace(/\s+$/, ''));
    return out.join('\n');
  }

  // ---- geometry ---------------------------------------------------------------------------------------------
  measure(fs) {
    this.ctx.font = `${fs}px ${FONT}`;
    return this.ctx.measureText('M').width;
  }

  setFontScale(s) {
    this.fontScale = Math.max(0.5, Math.min(3, s));
    try { localStorage.setItem('lspf.fontScale', String(this.fontScale)); } catch (e) { /* private mode */ }
    this.fit(true);
  }

  // Compute font size, cell size, rows and columns from the space available.
  // The number of rows is only reduced when the width changes (keyboard opening does not re-layout the panels).
  fit(force) {
    const W = this.wrap.clientWidth || window.innerWidth;
    const H = this.wrap.clientHeight || window.innerHeight;
    if (!W || !H) return;
    const lineH = 1.18;
    const widthChanged = W !== this.lastW;
    let fs, cw, ch, cols, rows;
    // a height change while the soft keyboard is open keeps the layout; any other change (rotation, full screen,
    // window resize) computes a new one
    if (force || widthChanged || !this.fs || !this.keyboardOpen()) {
      // new layout (start, rotation, font change): 80 x 24 at least, as large as the window allows
      const ratio = this.measure(100) / 100;           // character width / font size
      fs = Math.min(W / (MIN_COLS * ratio), H / (MIN_ROWS * lineH));
      fs = Math.max(7, Math.min(28, fs)) * this.fontScale;
      fs = Math.floor(fs * 2) / 2;
      // 80 x 24 must really fit (the measured width may differ slightly from the estimate)
      if (this.fontScale <= 1) while (fs > 7 && (MIN_COLS * this.measure(fs) > W || MIN_ROWS * Math.ceil(fs * lineH) > H)) fs -= 0.5;
      cw = this.measure(fs);
      ch = Math.ceil(fs * lineH);
      cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(W / cw)));
      rows = Math.max(MIN_ROWS, Math.floor(H / ch));
    } else {
      // height change only (soft keyboard): keep the layout, the view scrolls to the cursor
      fs = this.fs; cw = this.cw; ch = this.ch; cols = this.cols;
      rows = Math.max(this.rows, Math.floor(H / ch));
    }
    this.lastW = W;
    const sizeChanged = fs !== this.fs || cw !== this.cw;
    this.fs = fs; this.cw = cw; this.ch = ch;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.ceil(cols * cw), cssH = rows * ch;
    if (sizeChanged || cols !== this.cols || rows !== this.rows || this.dpr !== dpr || !this.canvas.width) {
      this.dpr = dpr;
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.ceil(cssW * dpr);
      this.canvas.height = Math.ceil(cssH * dpr);
    }
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols; this.rows = rows;
      this.emit('resize', rows, cols);
    }
    this.queueDraw();
  }

  cellAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((clientX - r.left) / this.cw)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((clientY - r.top) / this.ch)));
    return { row, col };
  }

  // Keep the cursor visible when the screen is larger than the window (soft keyboard open, large font)
  scrollToCursor() {
    if (!this.last) return;
    const key = this.last.crow + ',' + this.last.ccol;
    if (key === this.lastCursor) return;
    this.lastCursor = key;
    const w = this.wrap, y = this.last.crow * this.ch, x = this.last.ccol * this.cw;
    if (y < w.scrollTop || y + this.ch > w.scrollTop + w.clientHeight) w.scrollTop = Math.max(0, y - w.clientHeight / 2);
    if (x < w.scrollLeft || x + this.cw > w.scrollLeft + w.clientWidth) w.scrollLeft = Math.max(0, x - w.clientWidth / 2);
  }

  // ---- drawing ----------------------------------------------------------------------------------------------
  queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  draw() {
    const ctx = this.ctx, cw = this.cw, ch = this.ch;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.cols * cw + 2, this.rows * ch);
    if (!this.last) return;
    const { scr, crow, ccol } = this.last;
    ctx.font = `${this.fs}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const R = Math.min(scr.rows, this.rows), C = Math.min(scr.cols, this.cols);
    const lw = Math.max(1, Math.round(ch / 14));
    for (let r = 0; r < R; r++) {
      const y = r * ch;
      for (let c = 0; c < C; c++) {
        const i = r * scr.cols + c;
        const a = scr.at[i];
        let chr = scr.ch[i];
        const fg = (a & A_HIGH ? PALETTE.high : PALETTE.low)[a & 7] || PALETTE.low[2];
        const x = c * cw;
        const rev = !!(a & A_REV);
        if (rev) { ctx.fillStyle = fg; ctx.fillRect(x, y, cw + 0.5, ch); }
        const color = rev ? '#000' : fg;
        if (a & A_UL) { ctx.fillStyle = color; ctx.fillRect(x, y + ch - lw, cw + 0.5, lw); }
        if (chr === ' ' || chr === '\u0000') continue;
        ctx.fillStyle = color;
        const box = BOX[chr];
        if (box) { this.drawBox(x, y, box, color, lw); continue; }
        ctx.fillText(chr, x, y + ch / 2 + 0.5);
      }
    }
    // cursor: underline in replace mode, bar in insert mode
    if (this.cursorOn && crow >= 0 && crow < this.rows && ccol >= 0 && ccol < this.cols) {
      ctx.fillStyle = '#ffffff';
      if (this.insertMode) ctx.fillRect(ccol * cw, crow * ch + 1, Math.max(2, lw * 2), ch - 2);
      else ctx.fillRect(ccol * cw, crow * ch + ch - Math.max(2, Math.round(ch / 6)), cw, Math.max(2, Math.round(ch / 6)));
    }
    if (this.flash && Date.now() - this.flash < 150) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, 0, this.cols * cw, this.rows * ch);
      setTimeout(() => this.queueDraw(), 160);
    }
    this.scrollToCursor();
  }

  drawBox(x, y, segs, color, lw) {
    const ctx = this.ctx, cw = this.cw, ch = this.ch;
    const cx = Math.round(x + cw / 2 - lw / 2), cy = Math.round(y + ch / 2 - lw / 2);
    ctx.fillStyle = color;
    if (segs.includes('l')) ctx.fillRect(x, cy, cx - x + lw, lw);
    if (segs.includes('r')) ctx.fillRect(cx, cy, x + cw - cx + 0.5, lw);
    if (segs.includes('u')) ctx.fillRect(cx, y, lw, cy - y + lw);
    if (segs.includes('d')) ctx.fillRect(cx, cy, lw, y + ch - cy);
  }

  // ---- pointer input ----------------------------------------------------------------------------------------
  installPointer() {
    const cv = this.canvas;
    this.touches = new Map();
    this.wheelAcc = 0;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    cv.addEventListener('pointermove', (e) => this.onMove(e));
    cv.addEventListener('pointerup', (e) => this.onUp(e, false));
    cv.addEventListener('pointercancel', (e) => this.onUp(e, true));
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelAcc += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      const cell = this.cellAt(e.clientX, e.clientY);
      while (Math.abs(this.wheelAcc) >= 90) {
        const down = this.wheelAcc > 0;
        this.wheelAcc -= down ? 90 : -90;
        this.emitKey({ name: down ? 'wheeldown' : 'wheelup', row: cell.row, col: cell.col });
      }
    }, { passive: false });
  }

  onDown(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    const cell = this.cellAt(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      const button = e.button === 1 ? 1 : e.button === 2 ? 2 : 0;
      this.mouseDown = { button, col: cell.col };
      this.emitKey({ name: 'mouse', button, row: cell.row, col: cell.col, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
      if (button === 0) this.onTap();
      return;
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      // two fingers: pan / pinch, cancel the one-finger gesture
      if (this.single) { clearTimeout(this.single.timer); if (this.single.mode === 'h') this.emitKey({ name: 'mouseup', button: 0, row: this.single.cell.row, col: this.single.lastCol }); }
      this.single = null;
      const [a, b] = [...this.touches.values()];
      this.two = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d0: Math.hypot(a.x - b.x, a.y - b.y), scale0: this.fontScale };
      return;
    }
    if (this.touches.size > 2) return;
    const st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cell, mode: 'pending', lastCol: cell.col, acc: 0, t0: Date.now() };
    st.timer = setTimeout(() => {
      if (this.single !== st || st.mode !== 'pending') return;
      st.mode = 'long';
      if (navigator.vibrate) navigator.vibrate(25);
      this.emitKey({ name: 'mouse', button: 2, row: cell.row, col: cell.col });
      this.emitKey({ name: 'mouseup', button: 2, row: cell.row, col: cell.col });
    }, 550);
    this.single = st;
  }

  onMove(e) {
    if (e.pointerType === 'mouse') {
      if (!this.mouseDown || !e.buttons) return;
      const cell = this.cellAt(e.clientX, e.clientY);
      if (cell.col === this.mouseDown.col) return;
      this.mouseDown.col = cell.col;
      this.emitKey({ name: 'mousemove', button: this.mouseDown.button, row: cell.row, col: cell.col });
      return;
    }
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this.two && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.wrap.scrollLeft -= mx - this.two.mx;
      this.wrap.scrollTop -= my - this.two.my;
      this.two.mx = mx; this.two.my = my;
      this.two.ratio = Math.hypot(a.x - b.x, a.y - b.y) / (this.two.d0 || 1);
      return;
    }
    const st = this.single;
    if (!st || st.id !== e.pointerId) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (st.mode === 'pending') {
      if (Math.hypot(dx, dy) < 12) return;
      clearTimeout(st.timer);
      st.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      st.lastY = st.y0;
      if (st.mode === 'h') this.emitKey({ name: 'mouse', button: 0, row: st.cell.row, col: st.cell.col });
    }
    if (st.mode === 'h') {
      const col = Math.max(0, Math.min(this.cols - 1, st.cell.col + Math.round(dx / this.cw)));
      if (col !== st.lastCol) { st.lastCol = col; this.emitKey({ name: 'mousemove', button: 0, row: st.cell.row, col }); }
    } else if (st.mode === 'v') {
      // the text follows the finger: moving up shows the following lines (3 lines per wheel event)
      st.acc += e.clientY - st.lastY;
      st.lastY = e.clientY;
      const step = this.ch * 3;
      while (Math.abs(st.acc) >= step) {
        const up = st.acc > 0;
        st.acc -= up ? step : -step;
        this.emitKey({ name: up ? 'wheelup' : 'wheeldown', row: st.cell.row, col: st.cell.col });
      }
    }
  }

  onUp(e, cancelled) {
    if (e.pointerType === 'mouse') {
      const cell = this.cellAt(e.clientX, e.clientY);
      if (this.mouseDown) this.emitKey({ name: 'mouseup', button: this.mouseDown.button, row: cell.row, col: cell.col });
      this.mouseDown = null;
      return;
    }
    this.touches.delete(e.pointerId);
    if (this.two) {
      if (this.touches.size === 0) {
        const ratio = this.two.ratio || 1;
        if (Math.abs(ratio - 1) > 0.15) this.setFontScale(this.two.scale0 * ratio);
        this.two = null;
      }
      return;
    }
    const st = this.single;
    if (!st || st.id !== e.pointerId) return;
    clearTimeout(st.timer);
    this.single = null;
    if (cancelled) { if (st.mode === 'h') this.emitKey({ name: 'mouseup', button: 0, row: st.cell.row, col: st.lastCol }); return; }
    if (st.mode === 'pending') {
      // tap; a second tap close to the first one is snapped on it (double tap = double click)
      let { row, col } = st.cell;
      const lt = this.lastTap, now = Date.now();
      if (lt && now - lt.t < 450 && Math.abs(lt.row - row) <= 1 && Math.abs(lt.col - col) <= 2) { row = lt.row; col = lt.col; }
      this.lastTap = { row, col, t: now };
      this.emitKey({ name: 'mouse', button: 0, row, col });
      this.emitKey({ name: 'mouseup', button: 0, row, col });
      this.onTap();
    } else if (st.mode === 'h') {
      this.emitKey({ name: 'mouseup', button: 0, row: st.cell.row, col: st.lastCol });
    }
  }
}

module.exports = { WebTerminal, MIN_COLS, MIN_ROWS };
