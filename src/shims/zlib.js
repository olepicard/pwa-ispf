'use strict';
//
// Browser replacement for the part of Node's 'zlib' module used by lspf (lib/zip.js): raw DEFLATE, synchronous
// (the browser CompressionStream API is asynchronous only).
//
//   inflateRawSync(buf)              RFC 1951 decoder: stored, fixed and dynamic Huffman blocks
//   deflateRawSync(buf, { level })   RFC 1951 encoder: LZ77 (hash chains, lazy matching from level 4) and fixed
//                                    Huffman codes; level 0 = stored blocks.  The output is a valid DEFLATE stream
//                                    read by any unzip tool, a little larger than zlib's (no dynamic Huffman codes).
//
const { VBuffer } = require('../vfs');

function zError(msg) {
  const e = new Error(msg);
  e.code = 'Z_DATA_ERROR'; e.errno = -3;
  return e;
}

// ---------------------------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------------------------
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// ---------------------------------------------------------------------------------------------------------------
// Inflate
// ---------------------------------------------------------------------------------------------------------------
// Canonical Huffman decoding table from code lengths: { counts[len], symbols[] }
function huffman(lengths, n) {
  const counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) { left = (left << 1) - counts[len]; if (left < 0) throw zError('invalid code lengths set'); }
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + counts[len];
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

let FIXED_LIT = null, FIXED_DIST = null;
function fixedTables() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED_LIT = huffman(l, 288);
    FIXED_DIST = huffman(new Uint8Array(30).fill(5), 30);
  }
}

function inflateRawSync(input) {
  const src = input instanceof Uint8Array ? input : VBuffer.from(input);
  let pos = 0, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4)), outLen = 0;
  const need = (n) => {
    if (outLen + n <= out.length) return;
    let size = out.length * 2;
    while (size < outLen + n) size *= 2;
    const o = new Uint8Array(size); o.set(out.subarray(0, outLen)); out = o;
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw zError('unexpected end of file');
      bitBuf |= src[pos++] << bitCnt; bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n; bitCnt -= n;
    return v;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw zError('invalid code');
  };
  const codes = (lit, dist) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) { need(1); out[outLen++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw zError('invalid literal/length code');
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      const ds = decode(dist);
      if (ds >= 30) throw zError('invalid distance code');
      const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
      if (d > outLen) throw zError('invalid distance too far back');
      need(len);
      for (let i = 0; i < len; i++, outLen++) out[outLen] = out[outLen - d];
    }
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;                          // to a byte boundary
      if (pos + 4 > src.length) throw zError('unexpected end of file');
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if (len !== (~nlen & 0xffff)) throw zError('invalid stored block lengths');
      if (pos + len > src.length) throw zError('unexpected end of file');
      need(len); out.set(src.subarray(pos, pos + len), outLen); outLen += len; pos += len;
    } else if (type === 1) {
      fixedTables();
      codes(FIXED_LIT, FIXED_DIST);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw zError('too many length or distance symbols');
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = huffman(cl, 19);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(clh);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let rep, val = 0;
        if (sym === 16) { if (!i) throw zError('invalid bit length repeat'); val = lengths[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) throw zError('invalid bit length repeat');
        while (rep--) lengths[i++] = val;
      }
      if (!lengths[256]) throw zError('invalid code -- missing end-of-block');
      codes(huffman(lengths.subarray(0, nlen), nlen), huffman(lengths.subarray(nlen), ndist));
    } else throw zError('invalid block type');
  } while (!last);
  return VBuffer.from(out.subarray(0, outLen));
}

// ---------------------------------------------------------------------------------------------------------------
// Deflate (fixed Huffman codes)
// ---------------------------------------------------------------------------------------------------------------
// LSB-first bit writer; Huffman codes are written bit-reversed
class BitWriter {
  constructor(size) { this.buf = new Uint8Array(Math.max(64, size)); this.len = 0; this.acc = 0; this.n = 0; }
  byte(b) {
    if (this.len >= this.buf.length) { const o = new Uint8Array(this.buf.length * 2); o.set(this.buf); this.buf = o; }
    this.buf[this.len++] = b;
  }
  bits(v, n) {
    this.acc |= v << this.n; this.n += n;
    while (this.n >= 8) { this.byte(this.acc & 255); this.acc >>>= 8; this.n -= 8; }
  }
  code(c, n) { let r = 0; for (let i = 0; i < n; i++) { r = (r << 1) | (c & 1); c >>>= 1; } this.bits(r, n); }
  align() { if (this.n > 0) { this.byte(this.acc & 255); this.acc = 0; this.n = 0; } }
  result() { this.align(); return this.buf.subarray(0, this.len); }
}

// fixed literal/length code of a symbol: [code, bits]
function fixedLit(s) {
  if (s < 144) return [0x30 + s, 8];
  if (s < 256) return [0x190 + s - 144, 9];
  if (s < 280) return [s - 256, 7];
  return [0xc0 + s - 280, 8];
}
const LIT_CODES = Array.from({ length: 288 }, (_, s) => fixedLit(s));
const LEN_SYM = new Uint16Array(259), DIST_SYM = (d) => { let i = 29; while (DIST_BASE[i] > d) i--; return i; };
for (let s = 0; s < 29; s++) for (let l = LEN_BASE[s]; l < (s < 28 ? LEN_BASE[s + 1] : 259); l++) LEN_SYM[l] = s;
LEN_SYM[258] = 28;

// [max chain, lazy matching, good length (stop searching)] by level
const LEVELS = [null, [4, false, 8], [8, false, 16], [16, false, 32], [16, true, 32], [32, true, 64], [128, true, 128],
  [256, true, 258], [1024, true, 258], [4096, true, 258]];

function deflateRawSync(input, opts = {}) {
  const src = input instanceof Uint8Array ? input : VBuffer.from(input);
  const level = opts.level === undefined || opts.level < 0 ? 6 : Math.min(9, opts.level | 0);
  const w = new BitWriter(src.length / 2 + 64);
  if (level === 0 || !src.length) {
    // stored blocks (an empty input is one empty stored block)
    let p = 0;
    do {
      const n = Math.min(65535, src.length - p);
      w.bits(p + n >= src.length ? 1 : 0, 1); w.bits(0, 2); w.align();
      w.byte(n & 255); w.byte(n >>> 8); w.byte(~n & 255); w.byte((~n >>> 8) & 255);
      for (let i = 0; i < n; i++) w.byte(src[p + i]);
      p += n;
    } while (p < src.length);
    return VBuffer.from(w.result());
  }
  const [maxChain, lazy, good] = LEVELS[level];
  const WSIZE = 32768, HBITS = 15, HSIZE = 1 << HBITS, HMASK = HSIZE - 1;
  const head = new Int32Array(HSIZE).fill(-1), prev = new Int32Array(WSIZE);
  const n = src.length;
  const hash = (i) => ((src[i] << 10) ^ (src[i + 1] << 5) ^ src[i + 2]) & HMASK;
  const insert = (i) => { if (i + 2 < n) { const h = hash(i); prev[i & (WSIZE - 1)] = head[h]; head[h] = i; } };
  const longest = (i) => {
    let best = 0, dist = 0, chain = maxChain;
    const max = Math.min(258, n - i);
    if (max < 3) return [0, 0];
    let j = head[hash(i)];
    while (j >= 0 && i - j <= WSIZE && chain-- > 0) {
      if (src[j + best] === src[i + best] && src[j] === src[i]) {
        let l = 0;
        while (l < max && src[j + l] === src[i + l]) l++;
        if (l > best) { best = l; dist = i - j; if (l >= max || l >= good) break; }
      }
      const pj = prev[j & (WSIZE - 1)];
      if (pj >= j) break;
      j = pj;
    }
    return best >= 3 ? [best, dist] : [0, 0];
  };
  const lit = (b) => { const [c, l] = LIT_CODES[b]; w.code(c, l); };
  const match = (len, dist) => {
    const s = LEN_SYM[len];
    const [c, l] = LIT_CODES[257 + s]; w.code(c, l);
    if (LEN_EXTRA[s]) w.bits(len - LEN_BASE[s], LEN_EXTRA[s]);
    const ds = DIST_SYM(dist);
    w.code(ds, 5);
    if (DIST_EXTRA[ds]) w.bits(dist - DIST_BASE[ds], DIST_EXTRA[ds]);
  };
  w.bits(1, 1); w.bits(1, 2);                          // one final block, fixed Huffman codes
  let i = 0;
  while (i < n) {
    let [len, dist] = longest(i);
    if (len && lazy && len < good && i + 1 < n) {
      insert(i);
      const [l2, d2] = longest(i + 1);
      if (l2 > len) { lit(src[i]); i++; len = l2; dist = d2; } else { match(len, dist); for (let k = 1; k < len; k++) insert(i + k); i += len; continue; }
      match(len, dist); for (let k = 0; k < len; k++) insert(i + k); i += len; continue;
    }
    if (len) { match(len, dist); for (let k = 0; k < len; k++) insert(i + k); i += len; } else { lit(src[i]); insert(i); i++; }
  }
  lit(256);
  return VBuffer.from(w.result());
}

module.exports = { inflateRawSync, deflateRawSync, constants: { Z_DATA_ERROR: -3 } };
