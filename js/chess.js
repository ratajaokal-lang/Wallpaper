/* Chess rules core: 0x88 board, legal move generation, SAN, FEN, PGN.
 * No dependencies. Works as a browser global (ChessCore) and in Node (module.exports). */
(function (root) {
  'use strict';

  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const FILES = 'abcdefgh';
  const LETTER = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
  const KNIGHT = [33, 31, 18, 14, -33, -31, -18, -14];
  const KING = [1, -1, 16, -16, 17, 15, -17, -15];
  const BISHOP = [17, 15, -17, -15];
  const ROOK = [1, -1, 16, -16];
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const sqName = (s) => FILES[s & 7] + ((s >> 4) + 1);
  const sqFrom = (n) => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 16;
  const uci = (m) => sqName(m.from) + sqName(m.to) + (m.promo ? LETTER[m.promo].toLowerCase() : '');

  // ---- Zobrist hashing (two 32-bit halves) ----
  let seed = 0x9e3779b9;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  const ZP1 = new Int32Array(16 * 128), ZP2 = new Int32Array(16 * 128);
  const ZC1 = new Int32Array(16), ZC2 = new Int32Array(16);
  const ZE1 = new Int32Array(8), ZE2 = new Int32Array(8);
  for (let i = 0; i < ZP1.length; i++) { ZP1[i] = rnd(); ZP2[i] = rnd(); }
  for (let i = 0; i < 16; i++) { ZC1[i] = rnd(); ZC2[i] = rnd(); }
  for (let i = 0; i < 8; i++) { ZE1[i] = rnd(); ZE2[i] = rnd(); }
  const ZS1 = rnd(), ZS2 = rnd();

  // castling-rights mask by square touched (1=WK 2=WQ 4=BK 8=BQ)
  const CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[4] = 15 & ~3; CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1;
  CASTLE_MASK[116] = 15 & ~12; CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[119] = 15 & ~4;

  class Position {
    constructor(fen) {
      this.b = new Int8Array(128);
      this.kings = [-1, -1];
      this.stack = [];
      this.turn = 0; this.castling = 0; this.ep = -1; this.half = 0; this.full = 1;
      this.h1 = 0; this.h2 = 0;
      this.setFEN(fen || START_FEN);
    }

    setFEN(fen) {
      const parts = fen.trim().split(/\s+/);
      this.b.fill(0); this.stack = [];
      const rows = parts[0].split('/');
      if (rows.length !== 8) throw new Error('Bad FEN: ' + fen);
      for (let r = 0; r < 8; r++) {
        let f = 0;
        for (const ch of rows[r]) {
          if (ch >= '1' && ch <= '8') { f += +ch; continue; }
          const idx = 'pnbrqk'.indexOf(ch.toLowerCase());
          if (idx < 0) throw new Error('Bad FEN piece: ' + ch);
          const p = (idx + 1) | (ch === ch.toLowerCase() ? 8 : 0);
          const sq = (7 - r) * 16 + f;
          this.b[sq] = p;
          if ((p & 7) === K) this.kings[p >> 3] = sq;
          f++;
        }
      }
      this.turn = (parts[1] || 'w') === 'b' ? 1 : 0;
      const c = parts[2] || '-';
      this.castling = (c.includes('K') ? 1 : 0) | (c.includes('Q') ? 2 : 0) | (c.includes('k') ? 4 : 0) | (c.includes('q') ? 8 : 0);
      this.ep = parts[3] && parts[3] !== '-' ? sqFrom(parts[3]) : -1;
      this.half = +(parts[4] || 0); this.full = +(parts[5] || 1);
      this.computeHash();
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let e = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.b[r * 16 + f];
          if (!p) { e++; continue; }
          if (e) { s += e; e = 0; }
          const ch = LETTER[p & 7];
          s += p >> 3 ? ch.toLowerCase() : ch;
        }
        if (e) s += e;
        if (r) s += '/';
      }
      const c = (this.castling & 1 ? 'K' : '') + (this.castling & 2 ? 'Q' : '') + (this.castling & 4 ? 'k' : '') + (this.castling & 8 ? 'q' : '');
      return `${s} ${this.turn ? 'b' : 'w'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    computeHash() {
      let h1 = 0, h2 = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = this.b[sq];
        if (p) { h1 ^= ZP1[p * 128 + sq]; h2 ^= ZP2[p * 128 + sq]; }
      }
      h1 ^= ZC1[this.castling]; h2 ^= ZC2[this.castling];
      if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
      if (this.turn) { h1 ^= ZS1; h2 ^= ZS2; }
      this.h1 = h1; this.h2 = h2;
    }

    attacked(sq, by) {
      const b = this.b;
      let s;
      if (by === 0) {
        s = sq - 15; if (!(s & 0x88) && b[s] === 1) return true;
        s = sq - 17; if (!(s & 0x88) && b[s] === 1) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && b[s] === 9) return true;
        s = sq + 17; if (!(s & 0x88) && b[s] === 9) return true;
      }
      const off = by << 3;
      for (let i = 0; i < 8; i++) {
        s = sq + KNIGHT[i]; if (!(s & 0x88) && b[s] === (N | off)) return true;
        s = sq + KING[i]; if (!(s & 0x88) && b[s] === (K | off)) return true;
      }
      for (let i = 0; i < 4; i++) {
        let d = BISHOP[i]; s = sq + d;
        while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (B | off) || p === (Q | off)) return true; break; } s += d; }
        d = ROOK[i]; s = sq + d;
        while (!(s & 0x88)) { const p = b[s]; if (p) { if (p === (R | off) || p === (Q | off)) return true; break; } s += d; }
      }
      return false;
    }

    inCheck() { return this.attacked(this.kings[this.turn], this.turn ^ 1); }

    /** Pseudo-legal moves. capturesOnly = captures + promotions (for quiescence). */
    genMoves(capturesOnly) {
      const moves = [], b = this.b, us = this.turn, them = us ^ 1;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p || (p >> 3) !== us) continue;
        const t = p & 7;
        if (t === P) {
          const dir = us === 0 ? 16 : -16, rank = sq >> 4;
          const startRank = us === 0 ? 1 : 6, promoRank = us === 0 ? 6 : 1;
          let to = sq + dir;
          if (!b[to]) {
            if (rank === promoRank) {
              this._promos(moves, sq, to, p, 0, 0, capturesOnly);
            } else if (!capturesOnly) {
              moves.push({ from: sq, to, piece: p, cap: 0, promo: 0, flags: 0 });
              if (rank === startRank && !b[to + dir]) moves.push({ from: sq, to: to + dir, piece: p, cap: 0, promo: 0, flags: 2 });
            }
          }
          for (let k = -1; k <= 1; k += 2) {
            to = sq + dir + k;
            if (to & 0x88) continue;
            const tp = b[to];
            if (tp && (tp >> 3) === them) {
              if (rank === promoRank) this._promos(moves, sq, to, p, tp, 1, capturesOnly);
              else moves.push({ from: sq, to, piece: p, cap: tp, promo: 0, flags: 1 });
            } else if (to === this.ep && !tp) {
              moves.push({ from: sq, to, piece: p, cap: P | (them << 3), promo: 0, flags: 5 });
            }
          }
        } else if (t === N || t === K) {
          const offs = t === N ? KNIGHT : KING;
          for (let i = 0; i < 8; i++) {
            const to = sq + offs[i];
            if (to & 0x88) continue;
            const tp = b[to];
            if (!tp) { if (!capturesOnly) moves.push({ from: sq, to, piece: p, cap: 0, promo: 0, flags: 0 }); }
            else if ((tp >> 3) === them) moves.push({ from: sq, to, piece: p, cap: tp, promo: 0, flags: 1 });
          }
        } else {
          const dirs = t === B ? BISHOP : t === R ? ROOK : null;
          const n = dirs ? 4 : 8;
          for (let i = 0; i < n; i++) {
            const d = dirs ? dirs[i] : KING[i];
            let to = sq + d;
            while (!(to & 0x88)) {
              const tp = b[to];
              if (!tp) { if (!capturesOnly) moves.push({ from: sq, to, piece: p, cap: 0, promo: 0, flags: 0 }); }
              else { if ((tp >> 3) === them) moves.push({ from: sq, to, piece: p, cap: tp, promo: 0, flags: 1 }); break; }
              to += d;
            }
          }
        }
      }
      if (!capturesOnly) this._castles(moves);
      return moves;
    }

    _promos(moves, from, to, piece, cap, flags, queenOnly) {
      const list = queenOnly ? [Q] : [Q, R, B, N];
      for (const pr of list) moves.push({ from, to, piece, cap, promo: pr, flags });
    }

    _castles(moves) {
      const us = this.turn, b = this.b, them = us ^ 1;
      if (us === 0) {
        if (b[4] !== K) return;
        if ((this.castling & 1) && b[7] === R && !b[5] && !b[6] && !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them))
          moves.push({ from: 4, to: 6, piece: K, cap: 0, promo: 0, flags: 8 });
        if ((this.castling & 2) && b[0] === R && !b[1] && !b[2] && !b[3] && !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them))
          moves.push({ from: 4, to: 2, piece: K, cap: 0, promo: 0, flags: 16 });
      } else {
        if (b[116] !== (K | 8)) return;
        if ((this.castling & 4) && b[119] === (R | 8) && !b[117] && !b[118] && !this.attacked(116, them) && !this.attacked(117, them) && !this.attacked(118, them))
          moves.push({ from: 116, to: 118, piece: K | 8, cap: 0, promo: 0, flags: 8 });
        if ((this.castling & 8) && b[112] === (R | 8) && !b[113] && !b[114] && !b[115] && !this.attacked(116, them) && !this.attacked(115, them) && !this.attacked(114, them))
          moves.push({ from: 116, to: 114, piece: K | 8, cap: 0, promo: 0, flags: 16 });
      }
    }

    legalMoves() {
      const out = [], us = this.turn;
      for (const m of this.genMoves(false)) {
        this.makeMove(m);
        if (!this.attacked(this.kings[us], us ^ 1)) out.push(m);
        this.undoMove();
      }
      return out;
    }

    makeMove(m) {
      const us = this.turn, b = this.b, from = m.from, to = m.to, p = m.piece;
      this.stack.push({ m, castling: this.castling, ep: this.ep, half: this.half, h1: this.h1, h2: this.h2 });
      let h1 = this.h1 ^ ZC1[this.castling], h2 = this.h2 ^ ZC2[this.castling];
      if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
      h1 ^= ZP1[p * 128 + from]; h2 ^= ZP2[p * 128 + from];
      b[from] = 0;
      if (m.flags & 4) {
        const cs = to + (us === 0 ? -16 : 16);
        h1 ^= ZP1[m.cap * 128 + cs]; h2 ^= ZP2[m.cap * 128 + cs];
        b[cs] = 0;
      } else if (m.cap) {
        h1 ^= ZP1[m.cap * 128 + to]; h2 ^= ZP2[m.cap * 128 + to];
      }
      const np = m.promo ? (m.promo | (us << 3)) : p;
      b[to] = np;
      h1 ^= ZP1[np * 128 + to]; h2 ^= ZP2[np * 128 + to];
      if (m.flags & 24) {
        const rf = m.flags & 8 ? to + 1 : to - 2, rt = m.flags & 8 ? to - 1 : to + 1;
        const rook = R | (us << 3);
        b[rf] = 0; b[rt] = rook;
        h1 ^= ZP1[rook * 128 + rf] ^ ZP1[rook * 128 + rt]; h2 ^= ZP2[rook * 128 + rf] ^ ZP2[rook * 128 + rt];
      }
      if ((p & 7) === K) this.kings[us] = to;
      this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
      this.ep = (m.flags & 2) ? (from + to) >> 1 : -1;
      this.half = ((p & 7) === P || m.cap) ? 0 : this.half + 1;
      if (us === 1) this.full++;
      this.turn = us ^ 1;
      h1 ^= ZS1; h2 ^= ZS2;
      h1 ^= ZC1[this.castling]; h2 ^= ZC2[this.castling];
      if (this.ep >= 0) { h1 ^= ZE1[this.ep & 7]; h2 ^= ZE2[this.ep & 7]; }
      this.h1 = h1; this.h2 = h2;
    }

    undoMove() {
      const u = this.stack.pop(), m = u.m, b = this.b, us = this.turn ^ 1;
      this.turn = us;
      b[m.from] = m.piece;
      if (m.flags & 4) { b[m.to] = 0; b[m.to + (us === 0 ? -16 : 16)] = m.cap; }
      else b[m.to] = m.cap;
      if (m.flags & 24) {
        const rf = m.flags & 8 ? m.to + 1 : m.to - 2, rt = m.flags & 8 ? m.to - 1 : m.to + 1;
        b[rt] = 0; b[rf] = R | (us << 3);
      }
      if ((m.piece & 7) === K) this.kings[us] = m.from;
      this.castling = u.castling; this.ep = u.ep; this.half = u.half; this.h1 = u.h1; this.h2 = u.h2;
      if (us === 1) this.full--;
    }

    makeNull() {
      this.stack.push({ m: null, castling: this.castling, ep: this.ep, half: this.half, h1: this.h1, h2: this.h2 });
      if (this.ep >= 0) { this.h1 ^= ZE1[this.ep & 7]; this.h2 ^= ZE2[this.ep & 7]; }
      this.ep = -1; this.turn ^= 1; this.h1 ^= ZS1; this.h2 ^= ZS2;
    }
    undoNull() {
      const u = this.stack.pop();
      this.turn ^= 1; this.ep = u.ep; this.h1 = u.h1; this.h2 = u.h2;
    }

    /** True if the current position already occurred earlier (within the reversible window). */
    isRepetition() {
      const st = this.stack, lim = Math.max(0, st.length - this.half);
      for (let i = st.length - 2; i >= lim; i -= 2) if (st[i].h1 === this.h1 && st[i].h2 === this.h2) return true;
      return false;
    }

    isInsufficientMaterial() {
      let minors = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = this.b[sq] & 7;
        if (t === P || t === R || t === Q) return false;
        if (t === N || t === B) minors++;
      }
      return minors <= 1;
    }

    // ---------- SAN ----------
    san(m, legal) {
      legal = legal || this.legalMoves();
      let s;
      if (m.flags & 8) s = 'O-O';
      else if (m.flags & 16) s = 'O-O-O';
      else {
        const t = m.piece & 7;
        if (t === P) {
          s = (m.cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + LETTER[m.promo] : '');
        } else {
          s = LETTER[t];
          const others = legal.filter((o) => o.from !== m.from && o.piece === m.piece && o.to === m.to);
          if (others.length) {
            const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
            const sameRank = others.some((o) => (o.from >> 4) === (m.from >> 4));
            if (!sameFile) s += FILES[m.from & 7];
            else if (!sameRank) s += (m.from >> 4) + 1;
            else s += sqName(m.from);
          }
          s += (m.cap ? 'x' : '') + sqName(m.to);
        }
      }
      this.makeMove(m);
      if (this.inCheck()) s += this.legalMoves().length ? '+' : '#';
      this.undoMove();
      return s;
    }

    /** Find the legal move matching a SAN string (lenient about suffixes / missing disambiguation). */
    parseSAN(str, legal) {
      legal = legal || this.legalMoves();
      let s = str.replace(/[+#!?]+/g, '').replace(/0/g, 'O').replace(/e\.p\./, '').trim();
      if (/^O-O-O$/i.test(s)) return legal.find((m) => m.flags & 16) || null;
      if (/^O-O$/i.test(s)) return legal.find((m) => m.flags & 8) || null;
      const mt = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQnbrq]))?$/.exec(s);
      if (!mt) return null;
      const type = mt[1] ? 'PNBRQK'.indexOf(mt[1]) + 1 : P;
      const to = sqFrom(mt[4]);
      const promo = mt[5] ? 'PNBRQK'.indexOf(mt[5].toUpperCase()) + 1 : 0;
      let c = legal.filter((m) => (m.piece & 7) === type && m.to === to && (!m.promo || m.promo === (promo || Q)) && (!promo || m.promo === promo));
      if (mt[2]) c = c.filter((m) => (m.from & 7) === mt[2].charCodeAt(0) - 97);
      if (mt[3]) c = c.filter((m) => (m.from >> 4) === +mt[3] - 1);
      return c.length ? c[0] : null;
    }

    moveFromUci(u, legal) {
      legal = legal || this.legalMoves();
      return legal.find((m) => uci(m) === u) || null;
    }

    isCheckmate() { return this.inCheck() && this.legalMoves().length === 0; }
    isStalemate() { return !this.inCheck() && this.legalMoves().length === 0; }
  }

  function perft(pos, depth) {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of pos.legalMoves()) {
      if (depth === 1) { n++; continue; }
      pos.makeMove(m); n += perft(pos, depth - 1); pos.undoMove();
    }
    return n;
  }

  // ---------- PGN ----------
  function tokenizeMovetext(s) {
    const toks = []; let i = 0, depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '{') {
        const j = s.indexOf('}', i), end = j < 0 ? s.length : j;
        if (depth === 0) toks.push({ c: s.slice(i + 1, end) });
        i = end + 1; continue;
      }
      if (c === ';') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j + 1; continue; }
      if (c === '(') { depth++; i++; continue; }
      if (c === ')') { depth = Math.max(0, depth - 1); i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      let j = i;
      while (j < s.length && !/[\s{}();]/.test(s[j])) j++;
      if (depth === 0) toks.push({ t: s.slice(i, j) });
      i = j;
    }
    return toks;
  }

  function parseClock(comment) {
    const m = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(comment);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
  }

  /** Split PGN text into games: [{headers, sans[], clocks[], result}] (moves are NOT validated here). */
  function parsePGN(text) {
    const games = [];
    let headers = null, body = [];
    const flush = () => {
      if (headers && (body.join('').trim() || Object.keys(headers).length)) {
        const g = parseMovetext(body.join('\n'));
        if (g.sans.length) games.push({ headers, sans: g.sans, clocks: g.clocks, result: g.result || headers.Result || '*' });
      }
      headers = null; body = [];
    };
    for (const line of text.replace(/\r/g, '').split('\n')) {
      const h = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
      if (h) {
        if (headers && body.join('').trim()) flush();
        if (!headers) headers = {};
        headers[h[1]] = h[2].replace(/\\"/g, '"');
      } else {
        if (!headers) { if (!line.trim()) continue; headers = {}; }
        body.push(line);
      }
    }
    flush();
    return games;
  }

  function parseMovetext(s) {
    const sans = [], clocks = []; let result = null;
    for (const tk of tokenizeMovetext(s)) {
      if (tk.c !== undefined) {
        if (sans.length && clocks[sans.length - 1] == null) clocks[sans.length - 1] = parseClock(tk.c);
        continue;
      }
      let t = tk.t;
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { result = t; continue; }
      if (/^\$\d+$/.test(t)) continue;
      t = t.replace(/^\d+\.+/, '');
      if (!t || /^\.+$/.test(t)) continue;
      sans.push(t); clocks[sans.length - 1] = null;
    }
    return { sans, clocks, result };
  }

  /** Replay a parsed game; returns {ok, positions(fens), moves:[{san,uci,...}], error}. */
  function replay(game) {
    const pos = new Position(game.headers && game.headers.FEN ? game.headers.FEN : START_FEN);
    const moves = [];
    for (let i = 0; i < game.sans.length; i++) {
      const legal = pos.legalMoves();
      const m = pos.parseSAN(game.sans[i], legal);
      if (!m) return { ok: false, error: `Illegal move "${game.sans[i]}" at ply ${i + 1}`, moves, pos };
      const fenBefore = pos.fen();
      const san = pos.san(m, legal);
      pos.makeMove(m);
      moves.push({ san, uci: uci(m), fenBefore, color: (m.piece >> 3), m });
    }
    return { ok: true, moves, pos };
  }

  const api = { Position, perft, parsePGN, replay, uci, sqName, sqFrom, START_FEN, LETTER, P, N, B, R, Q, K };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ChessCore = api;
})(typeof self !== 'undefined' ? self : this);
