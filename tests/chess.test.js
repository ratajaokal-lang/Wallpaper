const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/chess.js');

const PERFT = [
  ['startpos', C.START_FEN, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['endgame (ep/pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['promotions', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
for (const [name, fen, counts] of PERFT) {
  test('perft ' + name, () => {
    const pos = new C.Position(fen);
    counts.forEach((n, i) => assert.strictEqual(C.perft(pos, i + 1), n, `depth ${i + 1}`));
    assert.strictEqual(pos.fen(), new C.Position(fen).fen(), 'position restored after perft');
  });
}

test('incremental zobrist hash matches recomputed hash', () => {
  const pos = new C.Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let g = 0; g < 30; g++) {
    let plies = 0;
    while (plies < 60) {
      const ms = pos.legalMoves(); if (!ms.length) break;
      pos.makeMove(ms[rand(ms.length)]); plies++;
      const { h1, h2 } = pos; pos.computeHash();
      assert.deepStrictEqual([pos.h1, pos.h2], [h1, h2]);
    }
    while (pos.stack.length) pos.undoMove();
  }
});

test('SAN round trip incl. disambiguation, promotion, castling, mate', () => {
  const g = C.parsePGN('[Event "x"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 *')[0];
  const r = C.replay(g);
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(r.moves.map((m) => m.san), g.sans);
  const fm = C.replay(C.parsePGN('1. f3 e5 2. g4 Qh4# 0-1')[0]);
  assert.strictEqual(fm.moves[3].san, 'Qh4#');
  assert.ok(fm.pos.isCheckmate());
  const promo = new C.Position('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const m = promo.parseSAN('a8=Q+');
  assert.ok(m && m.promo === C.Q);
  const dis = new C.Position('R6R/8/8/8/8/8/1k6/7K w - - 0 1');
  assert.strictEqual(dis.san(dis.parseSAN('Rae8')), 'Rae8');
});

test('PGN parsing: comments, clocks, variations, NAGs, multiple games', () => {
  const txt = `[Event "A"]\n[White "w"]\n[Black "b"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:59.5]} (1... c5 2. Nf3) 2. Nf3 $1 Nc6 1-0\n\n[Event "B"]\n[Result "0-1"]\n\n1. d4 d5 0-1\n`;
  const gs = C.parsePGN(txt);
  assert.strictEqual(gs.length, 2);
  assert.deepStrictEqual(gs[0].sans, ['e4', 'e5', 'Nf3', 'Nc6']);
  assert.strictEqual(gs[0].clocks[0], 180);
  assert.strictEqual(gs[0].clocks[1], 179.5);
  assert.strictEqual(gs[0].headers.White, 'w');
  assert.deepStrictEqual(gs[1].sans, ['d4', 'd5']);
});

test('illegal move is reported, not thrown', () => {
  const r = C.replay(C.parsePGN('1. e4 e5 2. Ke3 *')[0]);
  assert.strictEqual(r.ok, false);
});
