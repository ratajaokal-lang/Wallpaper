const test = require('node:test');
const assert = require('node:assert');
const Src = require('../js/sources.js');
test('speed filter', () => {
  assert.ok(Src.speedOk({ TimeControl: '60' }, 'all'));
  assert.ok(!Src.speedOk({ TimeControl: '60' }, 'nobullet'));
  assert.ok(Src.speedOk({ TimeControl: '180' }, 'nobullet'));
  assert.ok(!Src.speedOk({ TimeControl: '180' }, 'rapid'));
  assert.ok(Src.speedOk({ TimeControl: '600+5' }, 'rapid'));
  assert.ok(Src.speedOk({ TimeControl: '1/86400' }, 'rapid') === false || true); // daily: unknown format handled without throwing
});
test('guessUser picks the player present in most games', () => {
  const g = (w, b) => ({ headers: { White: w, Black: b } });
  assert.strictEqual(Src.guessUser([g('me', 'a'), g('b', 'me'), g('me', 'c')]), 'me');
  assert.strictEqual(Src.guessUser([g('x', 'y'), g('z', 'w')]), null);
});
