const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const C = require('../js/chess.js');
const A = require('../js/analyze.js');
const S = require('../js/stats.js');

let records;
test.before(async () => {
  const games = C.parsePGN(fs.readFileSync(__dirname + '/../sample/demo.pgn', 'utf8'));
  const cache = new Map(); records = [];
  for (const g of games) records.push(await A.analyzeGame(g, { level: 'quick', username: 'You', cache }));
});

test('stats, areas, plan and drills are produced and well-formed', () => {
  const st = S.computeStats(records);
  assert.strictEqual(st.n, 28);
  assert.strictEqual(st.record.w + st.record.d + st.record.l, 28);
  assert.ok(st.acc > 0 && st.acc <= 100);
  assert.ok(st.areas.length >= 6);
  for (let i = 1; i < st.areas.length; i++) assert.ok(st.areas[i - 1].severity >= st.areas[i].severity);
  const plan = S.buildPlan(st, 30);
  assert.strictEqual(plan.week.length, 7);
  for (const d of plan.week) assert.ok(d.blocks.reduce((s, b) => s + b.min, 0) <= 31 && d.blocks.length >= 1, d.day);
  assert.strictEqual(plan.focus.length, 3);
  plan.goals.forEach((g) => assert.ok(g.to <= g.from));
  const drills = S.buildDrills(records);
  assert.ok(drills.length > 0);
  for (const d of drills) { const p = new C.Position(d.fen); assert.ok(p.moveFromUci(d.bestUci), 'best move legal'); assert.ok(p.moveFromUci(d.playedUci), 'played move legal'); }
  console.log('   top areas:', st.areas.slice(0, 4).map((a) => `${a.id}:${a.severity}`).join(', '), '| drills:', drills.length, '| acc', st.acc, '| per100', JSON.stringify(st.per100));
});

test('unknown user colour is excluded, not crashing', async () => {
  const g = C.parsePGN('[White "a"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0')[0];
  const r = await A.analyzeGame(g, { level: 'quick', username: 'nobody' });
  assert.strictEqual(r.userColor, null);
  assert.deepStrictEqual(S.computeStats([r]), { n: 0 });
});

test('snapshot has comparable fields', () => {
  const sn = S.snapshot(S.computeStats(records));
  assert.ok(sn.n === 28 && typeof sn.acc === 'number');
});
