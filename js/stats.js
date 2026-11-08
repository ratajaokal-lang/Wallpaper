/* Turns analysed games into a weakness report + personalised training plan + drill list. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const A = isNode ? require('./analyze.js') : root.Analyzer;

  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const r1 = (x) => Math.round(x * 10) / 10;
  const pct = (x) => Math.round(x * 100);
  const PHASE_NAMES = ['Opening', 'Middlegame', 'Endgame'];

  /** 1 win, 0.5 draw, 0 loss from the user's side; null if unknown. */
  function userScore(rec) {
    if (rec.userColor == null) return null;
    if (rec.result === '1/2-1/2') return 0.5;
    if (rec.result === '1-0') return rec.userColor === 0 ? 1 : 0;
    if (rec.result === '0-1') return rec.userColor === 1 ? 1 : 0;
    return null;
  }

  function computeStats(records) {
    const recs = records.filter((r) => r.userColor != null && userScore(r) != null)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const S = { n: recs.length };
    if (!recs.length) return S;

    // results
    const sc = recs.map(userScore);
    S.record = { w: sc.filter((x) => x === 1).length, d: sc.filter((x) => x === 0.5).length, l: sc.filter((x) => x === 0).length, score: mean(sc) };
    S.byColor = [0, 1].map((c) => {
      const rr = recs.filter((r) => r.userColor === c);
      return { n: rr.length, score: rr.length ? mean(rr.map(userScore)) : null, acc: rr.length ? r1(mean(rr.map((r) => r.acc[c]))) : null };
    });
    S.acc = r1(mean(recs.map((r) => r.acc[r.userColor])));
    S.accTrend = recs.map((r) => ({ id: r.id, date: r.date, acc: r.acc[r.userColor], score: userScore(r) }));
    S.avgRating = r1(mean(recs.map((r) => (r.userColor === 0 ? r.whiteElo : r.blackElo)).filter(Boolean))) || null;

    // moves
    const mvs = [], perGame = [];
    for (const r of recs) {
      const mm = r.mv.filter((m) => m[7] === r.userColor);
      perGame.push(mm); for (const m of mm) mvs.push({ m, r });
    }
    const total = mvs.length;
    const cnt = [0, 0, 0, 0]; mvs.forEach(({ m }) => cnt[m[3]]++);
    const per100 = (x) => r1((x / Math.max(1, total)) * 100);
    S.moves = total;
    S.counts = { inaccuracy: cnt[1], mistake: cnt[2], blunder: cnt[3] };
    S.per100 = { inaccuracy: per100(cnt[1]), mistake: per100(cnt[2]), blunder: per100(cnt[3]), serious: per100(cnt[2] + cnt[3]) };

    // phases
    S.phases = [0, 1, 2].map((p) => {
      const mm = mvs.filter(({ m }) => m[1] === p).map(({ m }) => m);
      const e = mm.length;
      return {
        name: PHASE_NAMES[p], moves: e, avgLoss: r1(mean(mm.map((m) => m[2]))),
        acc: e ? r1(mean(mm.map((m) => A.moveAccuracy(m[2])))) : null,
        seriousPer100: e ? r1(mm.filter((m) => m[3] >= 2).length / e * 100) : 0,
        games: recs.filter((r, i) => perGame[i].some((m) => m[1] === p)).length,
      };
    });

    // error kinds (user only, mistakes + blunders)
    const kinds = {};
    const userErrs = [];
    for (const r of recs) for (const e of r.errors) if (e.color === r.userColor) { userErrs.push({ e, r }); if (e.cls >= 2) kinds[e.kind] = (kinds[e.kind] || 0) + 1; }
    S.kinds = kinds;
    S.kindPer100 = {}; for (const k in kinds) S.kindPer100[k] = per100(kinds[k]);

    // openings
    const og = {};
    recs.forEach((r, i) => {
      const key = r.userColor + '|' + r.family;
      const g = og[key] || (og[key] = { color: r.userColor, family: r.family, n: 0, sc: [], loss: [], serious: 0, opMoves: 0 });
      g.n++; g.sc.push(userScore(r));
      const op = perGame[i].filter((m) => m[1] === 0);
      g.loss.push(...op.map((m) => m[2])); g.opMoves += op.length; g.serious += op.filter((m) => m[3] >= 2).length;
    });
    S.openings = Object.values(og).map((g) => ({ color: g.color, family: g.family, n: g.n, score: mean(g.sc), avgLoss: r1(mean(g.loss)), serious: g.serious }))
      .sort((a, b) => b.n - a.n);

    // time management
    const tg = recs.filter((r) => r.mv.some((m) => m[5] != null));
    const T = { games: tg.length };
    if (tg.length) {
      const tm = mvs.filter(({ r }) => tg.includes(r)).map(({ m }) => m);
      const tt = tm.filter((m) => m[4] === 1), nt = tm.filter((m) => m[4] === 0);
      T.ttShare = tt.length / Math.max(1, tm.length);
      T.ttSeriousRate = tt.length ? tt.filter((m) => m[3] >= 2).length / tt.length : 0;
      T.normSeriousRate = nt.length ? nt.filter((m) => m[3] >= 2).length / nt.length : 0;
      T.timeLosses = tg.filter((r) => userScore(r) === 0 && /time/i.test(r.termination || '')).length;
      const spent = tm.filter((m) => m[6] != null);
      T.quickSerious = spent.filter((m) => m[3] >= 2 && m[6] <= 2).length;
      T.seriousTotal = spent.filter((m) => m[3] >= 2).length;
      T.gamesWithTT = tg.filter((r, idx) => tm.length && r.mv.some((m) => m[4] === 1)).length;
    }
    S.time = T;

    // conversion / defence
    const winning = recs.filter((r) => r.adv[r.userColor][0] >= 300);
    const losing = recs.filter((r) => r.adv[r.userColor][1] <= -300);
    S.conversion = { winning: winning.length, converted: winning.filter((r) => userScore(r) === 1).length, thrown: winning.filter((r) => userScore(r) < 1).length };
    S.defence = { losing: losing.length, saved: losing.filter((r) => userScore(r) >= 0.5).length };

    // endgames
    const eg = recs.filter((r, i) => perGame[i].filter((m) => m[1] === 2).length >= 6);
    S.endgame = { games: eg.length, score: eg.length ? mean(eg.map(userScore)) : null };

    // early disasters
    S.shortLosses = recs.filter((r) => userScore(r) === 0 && r.sans.length <= 40).length;

    S.areas = buildAreas(S, recs);
    S.strengths = buildStrengths(S);
    return S;
  }

  // ---------------- weakness areas ----------------
  const LICHESS = (t) => `https://lichess.org/training/${t}`;
  function buildAreas(S, recs) {
    const A_ = [];
    const k = S.kinds, p = S.per100, ph = S.phases;
    const hung = (k['hung-piece'] || 0) + (k['allowed-mate'] || 0);
    const hungRate = r1(hung / Math.max(1, S.moves) * 100);
    A_.push({
      id: 'safety', title: 'Blunder-checking (leaving pieces / mates hanging)', icon: '🛡️',
      severity: clamp(hungRate / 2.2) * (S.moves > 100 ? 1 : 0.7),
      metric: { label: 'Hung pieces or allowed mates per 100 moves', value: hungRate },
      evidence: [`${hung} serious errors that dropped a piece or allowed mate in ${S.n} games (${hungRate} per 100 moves).`,
        S.counts.blunder ? `${S.counts.blunder} blunders overall (${p.blunder} per 100 moves).` : 'No outright blunders — good.'],
      actions: [
        'Adopt a 10-second blunder check before EVERY move: (1) What did their last move change? (2) Which of my pieces are undefended? (3) Which checks, captures and threats do they have after my move?',
        'Play slower in the first 15 moves of each game to bank time for this check — you can afford it.',
        'Daily: 10 puzzles in "hanging piece" and "mate in 1" themes, saying the opponent\'s best reply out loud before you move.',
      ],
      links: [['Hanging piece puzzles', LICHESS('hangingPiece')], ['Mate in 1', LICHESS('mateIn1')]],
      drill: 'safety',
    });

    const missed = (k['missed-capture'] || 0) + (k['missed-tactic'] || 0) + (k['missed-mate'] || 0);
    const missedRate = r1(missed / Math.max(1, S.moves) * 100);
    A_.push({
      id: 'tactics', title: 'Spotting tactics (forks, pins, checks, free material)', icon: '⚔️',
      severity: clamp(missedRate / 2.5) * (S.moves > 100 ? 1 : 0.7),
      metric: { label: 'Missed tactical shots per 100 moves', value: missedRate },
      evidence: [`${missed} serious misses of a winning capture, check sequence, or mate (${missedRate} per 100 moves).`,
        (k['missed-mate'] ? `${k['missed-mate']} missed forced mates.` : 'No missed forced mates.')],
      actions: [
        'Each move, scan in order: Checks → Captures → Threats (for both sides) before any quiet move.',
        'Daily: 15 timed tactics puzzles (fork, pin, skewer, discovered attack). Aim for accuracy first, then speed.',
        'Use the Train tab: it replays positions where YOU missed a shot in your own games.',
      ],
      links: [['Fork', LICHESS('fork')], ['Pin', LICHESS('pin')], ['Discovered attack', LICHESS('discoveredAttack')], ['Mate in 2', LICHESS('mateIn2')]],
      drill: 'tactics',
    });

    const op = ph[0];
    const worstOp = S.openings.filter((o) => o.n >= 3).sort((a, b) => a.score - b.score)[0];
    A_.push({
      id: 'opening', title: 'Opening play', icon: '📖',
      severity: clamp(op.avgLoss / 3.5) * 0.6 + clamp((0.5 - (worstOp ? worstOp.score : 0.5)) / 0.4) * 0.4,
      metric: { label: 'Average win-chance lost per opening move (%)', value: op.avgLoss },
      evidence: [`Opening accuracy ${op.acc ?? '–'}%; ${op.seriousPer100} serious errors per 100 opening moves.`,
        worstOp ? `Weakest line: ${worstOp.family} as ${worstOp.color ? 'Black' : 'White'} — ${pct(worstOp.score)}% in ${worstOp.n} games.` : 'Not enough games per opening to single one out yet.'],
      actions: [
        worstOp ? `Study ${worstOp.family} for ${worstOp.color ? 'Black' : 'White'}: review the first 10 moves of your games in it (Review tab), find where you left theory, and learn the main plan, not just moves.`
          : 'Pick one opening per colour and play it for at least 30 games so patterns repeat.',
        'Build a tiny repertoire: 1 system as White, 1 reply to 1.e4, 1 reply to 1.d4. Depth beats breadth below 1800.',
        'After each game, check only the first 12 moves in the Review tab and note the first moment you were out of book.',
      ],
      links: [['Lichess opening explorer', 'https://lichess.org/analysis#explorer']],
      drill: 'opening',
    });

    A_.push({
      id: 'middlegame', title: 'Middlegame decisions', icon: '♟️',
      severity: clamp(ph[1].avgLoss / 6) * (ph[1].moves > 60 ? 1 : 0.6),
      metric: { label: 'Average win-chance lost per middlegame move (%)', value: ph[1].avgLoss },
      evidence: [`Middlegame accuracy ${ph[1].acc ?? '–'}%; ${ph[1].seriousPer100} serious errors per 100 moves.`],
      actions: [
        'For every middlegame move write down a one-line plan: "I want to ___". If you cannot, improve your worst piece.',
        'Study one annotated master game a week from a position type you actually reach (use your most-played opening).',
        'Use candidate moves: always find 3 moves before choosing one.',
      ],
      links: [['Strategy puzzles', LICHESS('advantage')]],
      drill: 'middlegame',
    });

    const e = ph[2];
    A_.push({
      id: 'endgame', title: 'Endgames', icon: '🏁',
      severity: clamp(e.avgLoss / 6) * (e.moves > 40 ? 1 : 0.5) + (S.endgame.games >= 3 && S.endgame.score < 0.5 ? 0.15 : 0),
      metric: { label: 'Average win-chance lost per endgame move (%)', value: e.avgLoss },
      evidence: [`Endgame accuracy ${e.acc ?? '–'}% over ${e.moves} moves.`,
        S.endgame.games ? `You scored ${pct(S.endgame.score)}% in the ${S.endgame.games} games that reached an endgame.` : 'Few games reached an endgame.'],
      actions: [
        'Learn the essentials once: king+pawn opposition, Lucena & Philidor rook endings, basic mates.',
        'Weekly: 5 endgame puzzles + play one position out against the engine/a friend from a won endgame.',
        'In endgames activate your king early and push passed pawns — slow down and calculate concrete lines.',
      ],
      links: [['Endgame puzzles', LICHESS('endgame')], ['Rook endgames', LICHESS('rookEndgame')], ['Pawn endgames', LICHESS('pawnEndgame')]],
      drill: 'endgame',
    });

    const T = S.time;
    if (T.games) {
      const mult = T.normSeriousRate > 0 ? T.ttSeriousRate / T.normSeriousRate : (T.ttSeriousRate > 0 ? 3 : 1);
      A_.push({
        id: 'time', title: 'Time management', icon: '⏱️',
        severity: clamp(T.ttShare / 0.2) * 0.5 + clamp(T.timeLosses / Math.max(2, S.n * 0.2)) * 0.3 + clamp((mult - 1) / 3) * 0.2,
        metric: { label: 'Share of moves played in time trouble (%)', value: r1(T.ttShare * 100) },
        evidence: [`${pct(T.ttShare)}% of your moves came under ${'time pressure (<10% of the clock or <15s)'}.`,
          T.ttSeriousRate ? `In time trouble ${pct(T.ttSeriousRate)}% of moves are serious errors vs ${pct(T.normSeriousRate)}% normally.` : 'No errors in time trouble.',
          T.timeLosses ? `${T.timeLosses} game(s) lost on time.` : 'No time-forfeit losses.',
          T.seriousTotal ? `${T.quickSerious} of ${T.seriousTotal} serious errors were played in 2 seconds or less.` : ''].filter(Boolean),
        actions: [
          'Set a budget: spend at most ~25% of your time by move 15, ~60% by move 30. Check the clock every 5 moves.',
          'Spend your thinking time on critical moments (captures, pawn breaks, king safety); play obvious recaptures and book moves fast.',
          'If you are below 20% of the clock, simplify instead of calculating long lines. Consider formats with an increment (e.g. 10+5).',
        ],
        links: [['Rapid time controls on Lichess', 'https://lichess.org']],
        drill: 'time',
      });
    }

    const cv = S.conversion;
    if (cv.winning >= 3) {
      const thrownRate = cv.thrown / cv.winning;
      A_.push({
        id: 'convert', title: 'Converting winning positions', icon: '🎯',
        severity: clamp(thrownRate / 0.5),
        metric: { label: 'Winning positions (≥ +3) not converted (%)', value: pct(thrownRate) },
        evidence: [`You had a decisive advantage (≥ +3) in ${cv.winning} games but only won ${cv.converted}.`],
        actions: [
          'When ahead: trade pieces (not pawns), eliminate counterplay, keep your king safe — do not hunt for flashy moves.',
          'Before each move ask: "What is my opponent\'s only hope?" and remove it.',
          'Practice winning endgames (R+P vs R, extra-piece endings) against the engine.',
        ],
        links: [['Advantage puzzles', LICHESS('advantage')], ['Crushing puzzles', LICHESS('crushing')]],
        drill: 'convert',
      });
    }

    for (const a of A_) a.severity = Math.round(clamp(a.severity) * 100) / 100;
    return A_.sort((a, b) => b.severity - a.severity);
  }

  function buildStrengths(S) {
    const out = [];
    const ph = S.phases.filter((p) => p.moves >= 20 && p.acc != null).sort((a, b) => b.acc - a.acc);
    if (ph.length) out.push(`${ph[0].name} is your most accurate phase (${ph[0].acc}% accuracy).`);
    const best = S.openings.filter((o) => o.n >= 3).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.5) out.push(`${best.family} as ${best.color ? 'Black' : 'White'} works for you: ${pct(best.score)}% in ${best.n} games.`);
    if (S.defence.losing >= 3 && S.defence.saved / S.defence.losing >= 0.3) out.push(`Resilience: you rescued ${S.defence.saved} of ${S.defence.losing} games where you were clearly worse.`);
    if (S.conversion.winning >= 3 && S.conversion.converted / S.conversion.winning >= 0.7) out.push(`Good converter: ${S.conversion.converted} of ${S.conversion.winning} winning positions were won.`);
    if (S.time.games && S.time.ttShare < 0.08) out.push('Solid clock management — you rarely end up in time trouble.');
    const [w, b] = S.byColor;
    if (w.n >= 4 && b.n >= 4 && Math.abs(w.score - b.score) < 0.1) out.push('Balanced results with both colours.');
    if (S.per100.blunder < 1) out.push(`Few outright blunders (${S.per100.blunder} per 100 moves).`);
    return out;
  }

  // ---------------- plan ----------------
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  /** minutesPerDay: 15|30|45|60... Returns {focus:[areas], goals:[], week:[{day,blocks:[{min,what,area}]}], habits:[], checkpoint} */
  function buildPlan(S, minutesPerDay) {
    const mpd = minutesPerDay || 30;
    const cand = S.areas.filter((a) => a.severity >= 0.15);
    const focus = (cand.length ? cand : S.areas).slice(0, 3);
    const goals = focus.map((a) => {
      const v = a.metric.value;
      const target = a.id === 'convert' ? Math.max(0, Math.round(v * 0.6)) : r1(v * 0.65);
      return { area: a.id, title: a.title, label: a.metric.label, from: v, to: target };
    });
    const f = (i) => focus[i % focus.length];
    const tr = Math.max(5, Math.round(mpd * 0.4)), sh = Math.max(5, Math.round(mpd * 0.3));
    const week = [
      { day: DAYS[0], blocks: [{ min: mpd - 5, what: `Focus 1 — ${f(0).title}: ${f(0).actions[2] || f(0).actions[0]}`, area: f(0).id }, { min: 5, what: 'Re-do 2 positions from the Train tab.', area: 'train' }] },
      { day: DAYS[1], blocks: [{ min: tr, what: 'Train tab: your own mistakes (aim for 10 positions).', area: 'train' }, { min: mpd - tr, what: `Focus 2 — ${f(1).title}: ${f(1).actions[1] || f(1).actions[0]}`, area: f(1).id }] },
      { day: DAYS[2], blocks: [{ min: mpd, what: `Play 1–2 slow games (15+10 or longer) using the checklist: ${f(0).actions[0]}`, area: 'play' }] },
      { day: DAYS[3], blocks: [{ min: mpd - sh, what: `Focus ${focus.length > 2 ? 3 : 1} — ${f(2).title}: ${f(2).actions[0]}`, area: f(2).id }, { min: sh, what: 'Train tab: failed positions from earlier this week.', area: 'train' }] },
      { day: DAYS[4], blocks: [{ min: mpd, what: 'Play 1–2 slow games. After each, write down the one moment you want to remember.', area: 'play' }] },
      { day: DAYS[5], blocks: [{ min: Math.round(mpd * 0.6), what: 'Review your worst game of the week in the Review tab (step through every red/orange move; guess the best move before revealing it).', area: 'review' }, { min: Math.round(mpd * 0.4), what: `Puzzles for ${f(0).title}.`, area: f(0).id }] },
      { day: DAYS[6], blocks: [{ min: Math.max(10, Math.round(mpd * 0.7)), what: 'Light day: puzzles you enjoy, or study one annotated master game.', area: 'fun' }] },
    ];
    const habits = [...new Set(focus.map((a) => a.actions[0]))];
    return {
      minutesPerDay: mpd, focus, goals, week, habits,
      checkpoint: 'In 3–4 weeks, import your next 20+ games and press Analyze again. The app compares your numbers with this baseline.',
      monthly: [
        ['Week 1', `Build the habit: ${f(0).actions[0].split(':')[0]}. Don't worry about results.`],
        ['Week 2', `Add ${f(1).title.toLowerCase()} work and keep the Week 1 habit on every move.`],
        ['Week 3', `Add ${f(2).title.toLowerCase()}; re-do all failed Train positions.`],
        ['Week 4', 'Play more games, import & re-analyze, compare with the baseline, then pick your next 3 focus areas.'],
      ],
    };
  }

  // ---------------- drills ----------------
  /** Positions from the user's own games where they erred (mistake/blunder), worst first. */
  function buildDrills(records, areaId) {
    const out = [], seen = new Set();
    for (const r of records) {
      if (r.userColor == null) continue;
      for (const e of r.errors) {
        if (e.color !== r.userColor || e.cls < 2 || !e.bestUci) continue;
        if (e.evalBefore <= -800) continue; // already lost
        const key = e.fen.split(' ').slice(0, 4).join(' ');
        if (seen.has(key)) continue;
        if (areaId === 'opening' && e.phase !== 0) continue;
        if (areaId === 'endgame' && e.phase !== 2) continue;
        if (areaId === 'middlegame' && e.phase !== 1) continue;
        if (areaId === 'safety' && e.kind !== 'hung-piece' && e.kind !== 'allowed-mate') continue;
        if (areaId === 'tactics' && !/^missed-/.test(e.kind)) continue;
        if (areaId === 'convert' && !e.thrown) continue;
        if (areaId === 'time' && !e.tt) continue;
        seen.add(key);
        out.push({
          id: r.id + '#' + e.ply, gameId: r.id, ply: e.ply, fen: e.fen, color: e.color, played: e.san, playedUci: e.uci,
          best: e.best, bestUci: e.bestUci, kind: e.kind, loss: e.loss, phase: e.phase, family: r.family, date: r.date, evalBefore: e.evalBefore,
        });
      }
    }
    // tactical misses first (clearer lessons), then by loss
    const w = (d) => (/^missed-|hung|allowed/.test(d.kind) ? 1 : 0);
    return out.sort((a, b) => w(b) - w(a) || b.loss - a.loss);
  }

  /** Compact snapshot for progress tracking across sessions. */
  function snapshot(S) {
    return {
      date: new Date().toISOString().slice(0, 10), n: S.n, acc: S.acc, score: r1(S.record.score * 100),
      blunder: S.per100.blunder, serious: S.per100.serious,
      safety: S.areas.find((a) => a.id === 'safety')?.metric.value ?? null,
      tactics: S.areas.find((a) => a.id === 'tactics')?.metric.value ?? null,
    };
  }

  const api = { computeStats, buildPlan, buildDrills, snapshot, userScore };
  if (isNode) module.exports = api; else root.Stats = api;
})(typeof self !== 'undefined' ? self : this);
