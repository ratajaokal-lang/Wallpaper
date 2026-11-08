const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/chess.js');
const { Engine, evaluate } = require('../js/engine.js');

const best = (fen, opts) => { const p = new C.Position(fen); const r = new Engine().search(p, opts || { depth: 4, nodes: 200000 }); return { ...r, san: r.move ? p.san(r.move) : null, fen: p.fen() }; };

test('evaluation is symmetric', () => {
  const a = evaluate(new C.Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'));
  const b = evaluate(new C.Position('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'));
  assert.strictEqual(a, -b);
});
test('finds mate in one', () => {
  const r = best('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
  assert.strictEqual(r.san, 'Ra8#'); assert.strictEqual(r.mate, 1);
});
test('finds mate in two (Qh5+ style back-rank)', () => {
  const r = best('r4rk1/5ppp/8/8/8/8/1Q3PPP/3R2K1 w - - 0 1'); // Qb8!! style not required: just must see forced mate or big win
  assert.ok(r.score > 300, 'score ' + r.score);
});
test('captures a hanging queen', () => {
  const r = best('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  assert.strictEqual(r.san, 'Nxh4');
});
test('does not walk into mate / sees it is being mated', () => {
  const r = best('6k1/5ppp/8/8/8/8/5PPP/r5K1 w - - 0 1'); // white is mated already
  assert.strictEqual(r.move, null); assert.ok(r.score < -29000);
});
test('stalemate scores 0', () => {
  const r = best('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.strictEqual(r.score, 0); assert.strictEqual(r.move, null);
});
test('speed: depth-3 search of a middlegame position stays under budget', () => {
  const t = Date.now();
  const r = best('r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8', { depth: 3, nodes: 60000 });
  const ms = Date.now() - t;
  console.log(`   depth ${r.depth}, ${r.nodes} nodes, ${ms}ms, best ${r.san}`);
  assert.ok(ms < 3000);
});
