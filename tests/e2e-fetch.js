// Mocks the Lichess and Chess.com HTTP APIs inside the browser to exercise the fetch -> analyse path.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const demo = fs.readFileSync(path.resolve(__dirname, '../sample/demo.pgn'), 'utf8').replace(/\[Site "demo"\]/g, '[Site "https://lichess.org/abcd1234"]');
const games = demo.split(/\n\n(?=\[Event )/);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const site of ['lichess', 'chesscom']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(site + ' pageerror: ' + e.message));
    const cors = { 'access-control-allow-origin': '*' };
    await page.route('https://lichess.org/api/games/user/**', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/x-chess-pgn', body: games.slice(0, 6).join('\n\n') }));
    await page.route('https://api.chess.com/pub/player/*/games/archives', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ archives: ['https://api.chess.com/pub/player/you/games/2026/10'] }) }));
    await page.route('https://api.chess.com/pub/player/you/games/2026/10', (r) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ games: games.slice(0, 6).map((p) => ({ pgn: p, rules: 'chess' })) }) }));
    await page.route('https://lichess.org/api/games/user/missing*', (r) => r.fulfill({ status: 404, headers: cors, body: '' }));
    await page.goto('file://' + path.resolve(__dirname, '../index.html') + '#import');
    await page.check(`input[name=site][value=${site}]`);
    await page.fill('#username', 'You');
    await page.selectOption('#count', '10'); await page.selectOption('#speed', 'all'); await page.selectOption('#level', 'quick');
    await page.click('#fetchBtn');
    await page.waitForSelector('#planWrap:not([hidden])', { timeout: 120000 });
    const badge = await page.textContent('#gamesBadge');
    if (badge !== '6') errors.push(`${site}: expected 6 games, got ${badge}`);
    // second run is a no-op (dedupe)
    await page.click('[data-tab=import]'); await page.click('#fetchBtn');
    await page.waitForFunction(() => /already analysed|Nothing new/.test(document.querySelector('#importLog').textContent), null, { timeout: 30000 });
    if ((await page.textContent('#gamesBadge')) !== '6') errors.push(site + ': duplicates were added');
    await ctx.close();
  }
  // error path: 404 shows a friendly message
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.route('https://lichess.org/api/games/user/**', (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.fill('#username', 'nobody'); await page.click('#fetchBtn');
  await page.waitForFunction(() => /user not found/.test(document.querySelector('#importLog').textContent), null, { timeout: 15000 });
  // network-level failure shows the offline hint
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.route('https://lichess.org/**', (r) => r.abort());
  await p2.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p2.fill('#username', 'x'); await p2.click('#fetchBtn');
  await p2.waitForFunction(() => /Could not reach Lichess/.test(document.querySelector('#importLog').textContent), null, { timeout: 15000 });
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('e2e-fetch OK');
})().catch((e) => { console.error('E2E-FETCH FAILED:', e.message); process.exit(1); });
