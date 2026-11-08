const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const C = require('../js/chess.js');
const A = require('../js/analyze.js');

test('hung queen is flagged as a blunder with kind hung-piece, best move suggested', async () => {
  // 1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? is fine; instead white blunders queen: 1.e4 e5 2.Qh5 Nf6 3.Qxe5+ Be7 ... use a clean hang:
  const pgn = '[White "me"]\n[Black "them"]\n[Result "0-1"]\n\n1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 0-1';
  const g = C.parsePGN(pgn)[0];
  const r = await A.analyzeGame(g, { level: 'normal', username: 'me' });
  assert.strictEqual(r.userColor, 0);
  const last = r.errors.filter((e) => e.color === 0).pop();
  assert.ok(last, 'expected an error for white');
  assert.strictEqual(last.cls, 3); assert.strictEqual(last.kind, 'hung-piece'); assert.strictEqual(last.san, 'Qxe5+'); assert.ok(last.best && last.best !== last.san);
  assert.ok(r.evals.length === r.sans.length + 1);
  assert.ok(r.acc[0] < r.acc[1] + 100);
});

test('analysis of demo games is fast and consistent', async () => {
  const games = C.parsePGN(fs.readFileSync(__dirname + '/../sample/demo.pgn', 'utf8')).slice(0, 4);
  const cache = new Map();
  const t = Date.now();
  let plies = 0, errs = 0;
  for (const g of games) {
    const r = await A.analyzeGame(g, { level: 'normal', username: 'You', cache });
    plies += r.sans.length; errs += r.errors.filter((e) => e.color === r.userColor && e.cls >= 2).length;
    assert.ok([0, 1].includes(r.userColor));
    assert.ok(r.mv.length === r.sans.length);
    assert.ok(r.acc[r.userColor] >= 0 && r.acc[r.userColor] <= 100);
  }
  const ms = Date.now() - t;
  console.log(`   ${games.length} games, ${plies} plies, ${errs} user mistakes/blunders, ${ms}ms (${(ms / plies).toFixed(1)} ms/ply)`);
  assert.ok(ms < 60000);
});

test('winPct / classify sanity', () => {
  assert.ok(Math.abs(A.winPct(0) - 50) < 1e-9);
  assert.strictEqual(A.classify(3), 0); assert.strictEqual(A.classify(8), 1);
  assert.strictEqual(A.classify(16), 2); assert.strictEqual(A.classify(30), 3);
});

test('opening family extraction', () => {
  assert.strictEqual(A.openingInfo({ Opening: 'Sicilian Defense: Najdorf Variation' }, []).family, 'Sicilian Defense');
  assert.strictEqual(A.openingInfo({ ECOUrl: 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.Ng5' }, []).family, 'Italian Game');
});
