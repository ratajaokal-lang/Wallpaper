/* Small alpha-beta chess engine (material + piece-square tables, TT, null move, LMR, quiescence).
 * Strong enough to spot hung pieces, missed tactics and mates; NOT Stockfish. Scores are centipawns
 * from the side to move's point of view. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./chess.js') : root.ChessCore;
  const MATE = 30000, INF = 32000;
  const VAL = [0, 100, 320, 330, 500, 900, 0];

  const rows = (s) => s.trim().split(/\s+/).map(Number);
  const PST = [null,
    rows(`0 0 0 0 0 0 0 0  50 50 50 50 50 50 50 50  10 10 20 30 30 20 10 10  5 5 10 25 25 10 5 5
          0 0 0 20 20 0 0 0  5 -5 -10 0 0 -10 -5 5  5 10 10 -20 -20 10 10 5  0 0 0 0 0 0 0 0`),
    rows(`-50 -40 -30 -30 -30 -30 -40 -50  -40 -20 0 0 0 0 -20 -40  -30 0 10 15 15 10 0 -30  -30 5 15 20 20 15 5 -30
          -30 0 15 20 20 15 0 -30  -30 5 10 15 15 10 5 -30  -40 -20 0 5 5 0 -20 -40  -50 -40 -30 -30 -30 -30 -40 -50`),
    rows(`-20 -10 -10 -10 -10 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 10 10 5 0 -10  -10 5 5 10 10 5 5 -10
          -10 0 10 10 10 10 0 -10  -10 10 10 10 10 10 10 -10  -10 5 0 0 0 0 5 -10  -20 -10 -10 -10 -10 -10 -10 -20`),
    rows(`0 0 0 0 0 0 0 0  5 10 10 10 10 10 10 5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5
          -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  0 0 0 5 5 0 0 0`),
    rows(`-20 -10 -10 -5 -5 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 5 5 5 0 -10  -5 0 5 5 5 5 0 -5
          0 0 5 5 5 5 0 -5  -10 5 5 5 5 5 0 -10  -10 0 5 0 0 0 0 -10  -20 -10 -10 -5 -5 -10 -10 -20`),
    rows(`-30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30
          -20 -30 -30 -40 -40 -30 -30 -20  -10 -20 -20 -20 -20 -20 -20 -10  20 20 0 0 0 0 20 20  20 30 10 0 0 10 30 20`),
  ];
  const KING_END = rows(`-50 -40 -30 -20 -20 -30 -40 -50  -30 -20 -10 0 0 -10 -20 -30  -30 -10 20 30 30 20 -10 -30  -30 -10 30 40 40 30 -10 -30
                         -30 -10 30 40 40 30 -10 -30  -30 -10 20 30 30 20 -10 -30  -30 -30 0 0 0 0 -30 -30  -50 -30 -30 -30 -30 -30 -30 -50`);
  const PASSED = [0, 0, 10, 20, 35, 60, 100, 0]; // by relative rank

  function evaluate(pos) {
    const b = pos.b;
    let score = 0, npm = 0, bishops = [0, 0];
    const pawnFiles = [new Int8Array(8), new Int8Array(8)];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq]; if (p && (p & 7) === 1) pawnFiles[p >> 3][sq & 7]++;
      if (p && (p & 7) > 1 && (p & 7) < 6) npm += VAL[p & 7];
    }
    const endgame = npm < 2600;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq]; if (!p) continue;
      const t = p & 7, c = p >> 3, r = sq >> 4, f = sq & 7;
      const idx = c === 0 ? (7 - r) * 8 + f : r * 8 + f;
      let v = VAL[t] + (t === 6 && endgame ? KING_END[idx] : PST[t][idx]);
      if (t === 3) bishops[c]++;
      if (t === 1) {
        if (pawnFiles[c][f] > 1) v -= 10;
        // passed pawn: no enemy pawns ahead on same/adjacent files
        let passed = true;
        for (let ff = Math.max(0, f - 1); ff <= Math.min(7, f + 1) && passed; ff++) {
          for (let rr = r + (c ? -1 : 1); rr >= 0 && rr < 8; rr += c ? -1 : 1) if (b[rr * 16 + ff] === (1 | ((c ^ 1) << 3))) { passed = false; break; }
        }
        if (passed) v += PASSED[c === 0 ? r : 7 - r] * (endgame ? 1.5 : 1);
      }
      score += c === 0 ? v : -v;
    }
    if (bishops[0] > 1) score += 30;
    if (bishops[1] > 1) score -= 30;
    return pos.turn === 0 ? score : -score;
  }

  class Engine {
    constructor() { this.tt = new Map(); this.killers = []; this.history = new Int32Array(16 * 128); this.nodes = 0; this.stop = false; }
    clear() { this.tt.clear(); this.history.fill(0); }

    /** opts: {depth, nodes}. Returns {score, move, uci, depth, nodes, mate}. mate = signed moves-to-mate or null. */
    search(pos, opts) {
      opts = opts || {};
      const maxDepth = opts.depth || 3;
      this.nodeLimit = opts.nodes || 100000;
      this.nodes = 0; this.stop = false; this.killers = [];
      if (this.tt.size > 400000) this.tt.clear();
      const rootMoves = pos.legalMoves();
      if (!rootMoves.length) {
        const sc = pos.inCheck() ? -MATE : 0;
        return { score: sc, move: null, uci: null, depth: 0, nodes: 0, mate: sc ? 0 : null };
      }
      let best = rootMoves[0], bestScore = 0, doneDepth = 0;
      let order = rootMoves;
      for (let d = 1; d <= maxDepth; d++) {
        let alpha = -INF, iterBest = null, iterScore = -INF;
        order.sort((a, b) => (b === best) - (a === best));
        for (const m of order) {
          pos.makeMove(m);
          let sc;
          if (pos.isRepetition() || pos.half >= 100) sc = 0;
          else if (iterBest === null) sc = -this.negamax(pos, d - 1, -INF, INF, 1, true);
          else {
            sc = -this.negamax(pos, d - 1, -alpha - 1, -alpha, 1, true);
            if (sc > alpha && !this.stop) sc = -this.negamax(pos, d - 1, -INF, -alpha, 1, true);
          }
          pos.undoMove();
          if (this.stop && d > 1) break;
          if (sc > iterScore) { iterScore = sc; iterBest = m; }
          if (sc > alpha) alpha = sc;
        }
        if (this.stop && d > 1) break;
        best = iterBest; bestScore = iterScore; doneDepth = d;
        if (Math.abs(bestScore) > MATE - 200) break;
        if (this.nodes > this.nodeLimit) break;
      }
      let mate = null;
      if (Math.abs(bestScore) > MATE - 200) mate = (bestScore > 0 ? 1 : -1) * Math.ceil((MATE - Math.abs(bestScore)) / 2);
      return { score: bestScore, move: best, uci: C.uci(best), depth: doneDepth, nodes: this.nodes, mate };
    }

    scoreMoves(pos, moves, ttMove, ply) {
      const k = this.killers[ply] || [];
      for (const m of moves) {
        let s = 0;
        if (ttMove && m.from === ttMove.from && m.to === ttMove.to && m.promo === ttMove.promo) s = 1e7;
        else if (m.cap) s = 1e6 + VAL[m.cap & 7] * 10 - VAL[m.piece & 7] / 10;
        else if (m.promo) s = 9e5;
        else if (k[0] && k[0].from === m.from && k[0].to === m.to) s = 8e5;
        else if (k[1] && k[1].from === m.from && k[1].to === m.to) s = 7e5;
        else s = this.history[m.piece * 128 + m.to];
        m.score = s;
      }
      moves.sort((a, b) => b.score - a.score);
    }

    negamax(pos, depth, alpha, beta, ply, allowNull) {
      if (++this.nodes > this.nodeLimit) this.stop = true;
      if (this.stop) return 0;
      if (pos.half >= 100 || pos.isRepetition() || (ply > 0 && pos.isInsufficientMaterial())) return 0;
      const inCheck = pos.inCheck();
      if (inCheck && ply < 40) depth++;
      if (depth <= 0) return this.quiesce(pos, alpha, beta, ply);

      const key = (pos.h1 >>> 0) * 2097152 + (pos.h2 & 0x1fffff);
      const e = this.tt.get(key);
      let ttMove = null;
      if (e) {
        ttMove = e.move;
        if (e.depth >= depth) {
          let s = e.score;
          if (s > MATE - 200) s -= ply; else if (s < -MATE + 200) s += ply;
          if (e.flag === 0) return s;
          if (e.flag === 1 && s >= beta) return s;
          if (e.flag === 2 && s <= alpha) return s;
        }
      }
      const isPV = beta - alpha > 1;
      if (!isPV && !inCheck && allowNull && depth >= 3 && this.hasPieces(pos)) {
        pos.makeNull();
        const s = -this.negamax(pos, depth - 3, -beta, -beta + 1, ply + 1, false);
        pos.undoNull();
        if (this.stop) return 0;
        if (s >= beta) return beta;
      }
      const moves = pos.genMoves(false);
      this.scoreMoves(pos, moves, ttMove, ply);
      const us = pos.turn;
      let legal = 0, bestScore = -INF, bestMove = null, flag = 2;
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        pos.makeMove(m);
        if (pos.attacked(pos.kings[us], us ^ 1)) { pos.undoMove(); continue; }
        legal++;
        let s;
        const quiet = !m.cap && !m.promo;
        if (legal === 1) s = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
        else {
          let red = (depth >= 3 && legal > 4 && quiet && !inCheck) ? 1 : 0;
          s = -this.negamax(pos, depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
          if (s > alpha && (red || s < beta)) s = -this.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
        }
        pos.undoMove();
        if (this.stop) return 0;
        if (s > bestScore) { bestScore = s; bestMove = m; }
        if (s > alpha) {
          alpha = s; flag = 0;
          if (alpha >= beta) {
            flag = 1;
            if (quiet) {
              const k = this.killers[ply] || (this.killers[ply] = []);
              if (!k[0] || k[0].from !== m.from || k[0].to !== m.to) { k[1] = k[0]; k[0] = m; }
              this.history[m.piece * 128 + m.to] += depth * depth;
            }
            break;
          }
        }
      }
      if (!legal) return inCheck ? -MATE + ply : 0;
      let st = bestScore;
      if (st > MATE - 200) st += ply; else if (st < -MATE + 200) st -= ply;
      this.tt.set(key, { depth, score: st, flag, move: bestMove });
      return bestScore;
    }

    hasPieces(pos) {
      const us = pos.turn;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = pos.b[sq];
        if (p && (p >> 3) === us && (p & 7) > 1 && (p & 7) < 6) return true;
      }
      return false;
    }

    quiesce(pos, alpha, beta, ply) {
      if (++this.nodes > this.nodeLimit) this.stop = true;
      if (this.stop) return 0;
      const stand = evaluate(pos);
      if (ply >= 64) return stand;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      const moves = pos.genMoves(true);
      this.scoreMoves(pos, moves, null, ply);
      const us = pos.turn;
      let best = stand;
      for (const m of moves) {
        if (!m.promo && stand + VAL[m.cap & 7] + 200 < alpha) continue; // delta pruning
        pos.makeMove(m);
        if (pos.attacked(pos.kings[us], us ^ 1)) { pos.undoMove(); continue; }
        const s = -this.quiesce(pos, -beta, -alpha, ply + 1);
        pos.undoMove();
        if (this.stop) return 0;
        if (s > best) best = s;
        if (s > alpha) { alpha = s; if (alpha >= beta) break; }
      }
      return best;
    }
  }

  const api = { Engine, evaluate, MATE, VAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ChessEngine = api;
})(typeof self !== 'undefined' ? self : this);
