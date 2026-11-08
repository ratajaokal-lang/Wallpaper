/* Game analysis: runs the engine over every position of a game and turns it into a compact record. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./chess.js') : root.ChessCore;
  const E = isNode ? require('./engine.js') : root.ChessEngine;

  const CLS = ['ok', 'inaccuracy', 'mistake', 'blunder'];
  const PHASES = ['opening', 'middlegame', 'endgame'];
  const THRESH = [7, 14, 25]; // win-probability points lost: inaccuracy / mistake / blunder
  const LEVELS = {
    quick: { depth: 3, nodes: 40000, label: 'Quick' },
    normal: { depth: 4, nodes: 120000, label: 'Normal' },
    deep: { depth: 5, nodes: 400000, label: 'Deep' },
  };

  const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  const clampCp = (cp) => Math.max(-1500, Math.min(1500, cp));
  const moveAccuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
  const classify = (loss) => (loss >= THRESH[2] ? 3 : loss >= THRESH[1] ? 2 : loss >= THRESH[0] ? 1 : 0);
  const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function pieceUnits(pos) {
    let u = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const t = pos.b[sq] & 7;
      if (t === 2 || t === 3) u += 3; else if (t === 4) u += 5; else if (t === 5) u += 9;
    }
    return u;
  }
  const phaseOf = (pos) => (pos.full <= 10 ? 0 : pieceUnits(pos) <= 20 ? 2 : 1);

  function parseTimeControl(tc) {
    const m = /^(\d+)(?:\+(\d+))?$/.exec(tc || '');
    return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
  }

  function openingInfo(h, sans) {
    let name = h.Opening || '';
    if (!name && h.ECOUrl) {
      const seg = decodeURIComponent(h.ECOUrl.split('/').pop() || '');
      const words = seg.split('-').filter(Boolean);
      const cut = words.findIndex((w) => /^\d/.test(w) || /\.\.\./.test(w));
      name = (cut < 0 ? words : words.slice(0, cut)).join(' ');
    }
    if (!name || name === '?') name = sans.slice(0, 4).map((s, i) => (i % 2 ? '' : `${i / 2 + 1}.`) + s).join(' ');
    let family = name.includes(':') ? name.split(':')[0] : name;
    if (!name.includes(':')) {
      const w = name.split(/\s+/), i = w.findIndex((x) => /^(Variation|Attack|Gambit|Opening|Defense|Defence|Game|System|Countergambit)$/i.test(x));
      if (i >= 0 && i < w.length - 1) family = w.slice(0, i + 1).join(' ');
    }
    return { name, family: family.replace(/'/g, '’') };
  }

  function gameId(g) {
    const h = g.headers;
    const link = h.Link || h.Site || '';
    if (/^https?:\/\//.test(link) && /\/[A-Za-z0-9]{6,}/.test(link)) return link.replace(/\/(white|black)$/, '');
    let s = [h.White, h.Black, h.Date, h.UTCTime || h.StartTime || '', g.sans.slice(0, 12).join(' ')].join('|'), x = 5381;
    for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
    return 'pgn-' + (x >>> 0).toString(36);
  }

  function userColorFor(h, username) {
    if (!username) return null;
    const u = username.trim().toLowerCase();
    if ((h.White || '').toLowerCase() === u) return 0;
    if ((h.Black || '').toLowerCase() === u) return 1;
    return null;
  }

  /**
   * Analyze one parsed game. opts: {level:'quick'|'normal'|'deep', engine, cache:Map, username, cancel:{cancelled}}
   * Returns a compact, JSON-serialisable record.
   */
  async function analyzeGame(game, opts) {
    opts = opts || {};
    const lvl = LEVELS[opts.level || 'normal'];
    const eng = opts.engine || new E.Engine();
    const cache = opts.cache || new Map();
    const h = game.headers || {};
    const pos = new C.Position(h.FEN || C.START_FEN);
    const n = game.sans.length;

    // ---- pass 1: replay + search every position ----
    const plies = [], res = [];
    for (let i = 0; i <= n; i++) {
      if (opts.cancel && opts.cancel.cancelled) throw new Error('cancelled');
      const fen = pos.fen(), key = lvl.depth + '|' + fenKey(fen);
      let r = cache.get(key);
      if (!r) {
        const legal = pos.legalMoves();
        const s = eng.search(pos, { depth: lvl.depth, nodes: lvl.nodes });
        r = { score: s.score, mate: s.mate, uci: s.uci, san: null, cap: 0, check: false, promo: false };
        if (s.move) {
          r.san = pos.san(s.move, legal); r.cap = s.move.cap; r.promo = !!s.move.promo;
          r.check = /[+#]$/.test(r.san);
        }
        cache.set(key, r);
        if (i % 4 === 0) { if (opts.onProgress) opts.onProgress(i, n); await tick(); }
      }
      res.push({ ...r, turn: pos.turn });
      if (i === n) break;
      const legal = pos.legalMoves();
      const m = pos.parseSAN(game.sans[i], legal);
      if (!m) throw new Error(`Illegal move "${game.sans[i]}" at ply ${i + 1}`);
      plies.push({ fen, san: pos.san(m, legal), uci: C.uci(m), color: m.piece >> 3, phase: phaseOf(pos), m: { from: m.from, to: m.to, cap: m.cap } });
      pos.makeMove(m);
    }

    // ---- pass 2: losses, classes, tags ----
    const tc = parseTimeControl(h.TimeControl);
    const lastClk = [tc ? tc.base : null, tc ? tc.base : null];
    const evals = [clampCp(res[0].turn === 0 ? res[0].score : -res[0].score)];
    const mv = [], errors = [];
    const accSum = [0, 0], accN = [0, 0];
    const adv = [[0, 0], [0, 0]]; // per colour: [max, min] eval from that colour's view
    for (let i = 0; i < n; i++) {
      const p = plies[i], c = p.color, before = res[i], after = res[i + 1];
      const bestCp = clampCp(before.score);
      const playedBest = p.uci === before.uci;
      const playedCp = playedBest ? bestCp : clampCp(-after.score);
      const loss = playedBest ? 0 : Math.max(0, winPct(bestCp) - winPct(playedCp));
      const cls = classify(loss);
      accSum[c] += moveAccuracy(loss); accN[c]++;
      evals.push(clampCp(after.turn === 0 ? after.score : -after.score));
      const myView = c === 0 ? evals[i + 1] : -evals[i + 1];
      adv[c][0] = Math.max(adv[c][0], myView); adv[c][1] = Math.min(adv[c][1], myView);

      const clk = game.clocks && game.clocks[i] != null ? game.clocks[i] : null;
      let spent = null;
      if (clk != null && lastClk[c] != null) spent = Math.max(0, lastClk[c] + (tc ? tc.inc : 0) - clk);
      if (clk != null) lastClk[c] = clk;
      const tt = clk != null && tc ? (clk < Math.max(15, 0.1 * tc.base) ? 1 : 0) : 0;

      mv.push([i, p.phase, Math.round(loss * 10) / 10, cls, tt, clk == null ? null : Math.round(clk), spent == null ? null : Math.round(spent), c]);

      if (cls >= 1) {
        let kind = 'positional';
        if (after.mate != null && after.mate > 0) kind = 'allowed-mate';
        else if (before.mate != null && before.mate > 0) kind = 'missed-mate';
        else if (after.cap && (after.cap & 7) >= 2 && cls >= 2) kind = 'hung-piece';
        else if (before.cap && (before.cap & 7) >= 2 && cls >= 2) kind = 'missed-capture';
        else if ((before.check || before.promo) && cls >= 2) kind = 'missed-tactic';
        errors.push({
          ply: i, color: c, cls, loss: Math.round(loss * 10) / 10, kind, phase: p.phase,
          san: p.san, uci: p.uci, best: before.san, bestUci: before.uci,
          fen: p.fen, evalBefore: Math.round(bestCp),
          thrown: (c === 0 ? evals[i] : -evals[i]) >= 250 && cls >= 2,
          tt,
        });
      }
    }

    const uc = userColorFor(h, opts.username);
    const op = openingInfo(h, game.sans);
    return {
      v: 1, id: gameId(game), url: /^https?:/.test(h.Link || h.Site || '') ? (h.Link || h.Site) : null,
      white: h.White || '?', black: h.Black || '?', whiteElo: +h.WhiteElo || null, blackElo: +h.BlackElo || null,
      date: (h.UTCDate || h.Date || '').replace(/\./g, '-'), result: game.result || h.Result || '*',
      termination: h.Termination || '', tc: h.TimeControl || '', opening: op.name, family: op.family, eco: h.ECO || '',
      userColor: uc, level: opts.level || 'normal', fen: h.FEN || null,
      sans: plies.map((p) => p.san), evals, mv, errors,
      acc: [accN[0] ? Math.round(accSum[0] / accN[0] * 10) / 10 : null, accN[1] ? Math.round(accSum[1] / accN[1] * 10) / 10 : null],
      adv,
    };
  }

  /** Judge a user-chosen move in a position (used by the trainer). Returns {ok, best, loss, bestUci, bestSan}. */
  function judgeMove(fen, uciMove, level, engine) {
    const lvl = LEVELS[level || 'normal'], eng = engine || new E.Engine();
    const pos = new C.Position(fen);
    const m = pos.moveFromUci(uciMove);
    if (!m) return { ok: false, best: false, loss: 100, bestUci: null, bestSan: null };
    const r0 = eng.search(pos, { depth: lvl.depth, nodes: lvl.nodes });
    const bestSan = r0.move ? pos.san(r0.move) : null;
    if (r0.uci === uciMove) return { ok: true, best: true, loss: 0, bestUci: r0.uci, bestSan };
    pos.makeMove(m);
    const r1 = eng.search(pos, { depth: lvl.depth, nodes: lvl.nodes });
    const loss = Math.max(0, winPct(clampCp(r0.score)) - winPct(clampCp(-r1.score)));
    return { ok: loss < THRESH[0], best: false, loss: Math.round(loss * 10) / 10, bestUci: r0.uci, bestSan };
  }

  const api = { judgeMove, analyzeGame, winPct, moveAccuracy, classify, parseTimeControl, openingInfo, gameId, userColorFor, CLS, PHASES, THRESH, LEVELS, phaseOf };
  if (isNode) module.exports = api; else root.Analyzer = api;
})(typeof self !== 'undefined' ? self : this);
