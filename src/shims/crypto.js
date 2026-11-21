'use strict';
//
// Browser replacement for the part of Node's 'crypto' module used by lspf (lib/zip.js, WinZip AES encryption),
// synchronous (WebCrypto is asynchronous only):
//
//   randomBytes(n)                                      crypto.getRandomValues
//   createHash('sha1'), createHmac('sha1', key)         update(data) ... digest([enc])
//   pbkdf2Sync(password, salt, iterations, keylen, 'sha1')
//   createCipheriv('aes-128|192|256-ecb', key, null)    update(data) (whole 16-byte blocks), final(),
//                                                       setAutoPadding(false); encryption only (enough for CTR)
//
const { VBuffer } = require('../vfs');

const toBytes = (d, enc) => (typeof d === 'string' ? VBuffer.from(d, enc) : d instanceof Uint8Array ? d : VBuffer.from(d));
const unsupported = (what) => { const e = new Error(`${what} is not supported in lspf-pwa`); e.code = 'ERR_CRYPTO_UNSUPPORTED'; return e; };

// ---------------------------------------------------------------------------------------------------------------
// Random bytes
// ---------------------------------------------------------------------------------------------------------------
function randomBytes(n) {
  const b = new VBuffer(n);
  const c = typeof globalThis !== 'undefined' && globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    for (let i = 0; i < n; i += 65536) c.getRandomValues(b.subarray(i, Math.min(n, i + 65536)));
  } else {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

// ---------------------------------------------------------------------------------------------------------------
// SHA-1
// ---------------------------------------------------------------------------------------------------------------
class Sha1 {
  constructor() {
    this.h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
    this.block = new Uint8Array(64); this.blen = 0; this.total = 0;
    this.w = new Int32Array(80);
  }
  compress(b, o) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4];
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (i < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = bb ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }
  update(data) {
    let i = 0;
    this.total += data.length;
    if (this.blen) {
      while (i < data.length && this.blen < 64) this.block[this.blen++] = data[i++];
      if (this.blen < 64) return this;
      this.compress(this.block, 0); this.blen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.compress(data, i);
    while (i < data.length) this.block[this.blen++] = data[i++];
    return this;
  }
  digest() {
    const bitsHi = Math.floor(this.total / 0x20000000), bitsLo = (this.total * 8) >>> 0;
    const pad = new Uint8Array(((this.blen < 56 ? 56 : 120) - this.blen) + 8);
    pad[0] = 0x80;
    const n = pad.length;
    pad[n - 8] = bitsHi >>> 24; pad[n - 7] = bitsHi >>> 16; pad[n - 6] = bitsHi >>> 8; pad[n - 5] = bitsHi;
    pad[n - 4] = bitsLo >>> 24; pad[n - 3] = bitsLo >>> 16; pad[n - 2] = bitsLo >>> 8; pad[n - 1] = bitsLo;
    this.update(pad);
    const out = new VBuffer(20);
    for (let i = 0; i < 5; i++) { out[4 * i] = this.h[i] >>> 24; out[4 * i + 1] = this.h[i] >>> 16; out[4 * i + 2] = this.h[i] >>> 8; out[4 * i + 3] = this.h[i]; }
    return out;
  }
}
const sha1 = (...parts) => { const s = new Sha1(); for (const p of parts) s.update(p); return s.digest(); };

const checkAlg = (alg) => { if (String(alg).toLowerCase().replace('-', '') !== 'sha1') throw unsupported(`Hash ${alg}`); };
const out = (b, enc) => (enc ? b.toString(enc) : b);

function createHash(alg) {
  checkAlg(alg);
  const s = new Sha1();
  return { update(d, enc) { s.update(toBytes(d, enc)); return this; }, digest: (enc) => out(s.digest(), enc) };
}

// HMAC-SHA1 with precomputed inner/outer pads
function hmacKey(key) {
  let k = toBytes(key);
  if (k.length > 64) k = sha1(k);
  const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
  return { ipad, opad };
}
function createHmac(alg, key) {
  checkAlg(alg);
  const { ipad, opad } = hmacKey(key);
  const inner = new Sha1().update(ipad);
  return {
    update(d, enc) { inner.update(toBytes(d, enc)); return this; },
    digest: (enc) => out(sha1(opad, inner.digest()), enc),
  };
}

function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  checkAlg(digest);
  const { ipad, opad } = hmacKey(password);
  const s = toBytes(salt);
  const prf = (m) => sha1(opad, new Sha1().update(ipad).update(m).digest());
  const res = new VBuffer(keylen);
  for (let block = 1, off = 0; off < keylen; block++) {
    const ctr = new Uint8Array([block >>> 24, block >>> 16, block >>> 8, block]);
    let u = prf(VBuffer.concat([s, ctr]));
    const t = VBuffer.from(u);
    for (let i = 1; i < iterations; i++) { u = prf(u); for (let k = 0; k < 20; k++) t[k] ^= u[k]; }
    const n = Math.min(20, keylen - off);
    res.set(t.subarray(0, n), off); off += n;
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// AES (encryption, FIPS-197), T-tables
// ---------------------------------------------------------------------------------------------------------------
const SBOX = new Uint8Array(256), T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
(function init() {
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); x &= 255; }
  for (let i = 0; i < 256; i++) {
    const inv = i ? exp[(255 - log[i]) % 255] : 0;
    let s = inv;
    for (let k = 1; k < 5; k++) s ^= ((inv << k) | (inv >>> (8 - k))) & 255;
    SBOX[i] = s ^ 0x63;
  }
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i], s2 = ((s << 1) ^ (s & 0x80 ? 0x11b : 0)) & 255, s3 = s2 ^ s;
    T0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T1[i] = ((T0[i] >>> 8) | (T0[i] << 24)) >>> 0;
    T2[i] = ((T0[i] >>> 16) | (T0[i] << 16)) >>> 0;
    T3[i] = ((T0[i] >>> 24) | (T0[i] << 8)) >>> 0;
  }
})();

function expandKey(key) {
  const nk = key.length / 4, nr = nk + 6, w = new Uint32Array(4 * (nr + 1));
  for (let i = 0; i < nk; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  let rcon = 1;
  const sub = (t) => ((SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255]) >>> 0;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1];
    if (i % nk === 0) { t = (sub(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24)) >>> 0; rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 255; }
    else if (nk > 6 && i % nk === 4) t = sub(t);
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return { w, nr };
}

function encryptBlock(k, src, so, dst, d) {
  const { w, nr } = k;
  const rd = (o) => ((src[so + o] << 24) | (src[so + o + 1] << 16) | (src[so + o + 2] << 8) | src[so + o + 3]) >>> 0;
  let s0 = rd(0) ^ w[0], s1 = rd(4) ^ w[1], s2 = rd(8) ^ w[2], s3 = rd(12) ^ w[3];
  let r = 4;
  for (let round = 1; round < nr; round++, r += 4) {
    const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ w[r];
    const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ w[r + 1];
    const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ w[r + 2];
    const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ w[r + 3];
    s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
  }
  const fin = (a, b, c, e, kw, o) => {
    const v = (((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 255] << 16) | (SBOX[(c >>> 8) & 255] << 8) | SBOX[e & 255]) ^ kw) >>> 0;
    dst[o] = v >>> 24; dst[o + 1] = v >>> 16; dst[o + 2] = v >>> 8; dst[o + 3] = v;
  };
  fin(s0, s1, s2, s3, w[r], d); fin(s1, s2, s3, s0, w[r + 1], d + 4); fin(s2, s3, s0, s1, w[r + 2], d + 8); fin(s3, s0, s1, s2, w[r + 3], d + 12);
}

function createCipheriv(alg, key, iv) {
  const m = /^aes-(128|192|256)-ecb$/i.exec(String(alg));
  if (!m) throw unsupported(`Cipher ${alg}`);
  const kb = toBytes(key);
  if (kb.length * 8 !== +m[1]) { const e = new Error('Invalid key length'); e.code = 'ERR_CRYPTO_INVALID_KEYLEN'; throw e; }
  const k = expandKey(kb);
  let rest = new Uint8Array(0);
  return {
    setAutoPadding() { return this; },
    update(d, enc) {
      let data = toBytes(d, enc);
      if (rest.length) { const c = new Uint8Array(rest.length + data.length); c.set(rest); c.set(data, rest.length); data = c; }
      const n = data.length - (data.length % 16);
      const res = new VBuffer(n);
      for (let o = 0; o < n; o += 16) encryptBlock(k, data, o, res, o);
      rest = data.slice(n);
      return res;
    },
    final() {
      if (rest.length) { const e = new Error('data not multiple of block length'); e.code = 'ERR_CRYPTO_INVALID_STATE'; throw e; }
      return new VBuffer(0);
    },
  };
}

function createDecipheriv(alg) { throw unsupported(`Decipher ${alg}`); }

module.exports = { randomBytes, createHash, createHmac, pbkdf2Sync, createCipheriv, createDecipheriv };
