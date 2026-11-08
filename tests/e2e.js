// Browser smoke test (Playwright). Usage: node tests/e2e.js [outDir]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || null;
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  const shot = async (n) => { if (out) await page.screenshot({ path: `${out}/${n}.png` }); };
  await shot('1-import');

  // demo import -> plan
  await page.click('#demoBtn');
  await page.waitForSelector('#planWrap:not([hidden])', { timeout: 120000 });
  const h = await page.textContent('#planWrap');
  if (!/Coaching report for You/.test(h)) throw new Error('plan not rendered');
  if (!/Your top 3 priorities/.test(h)) throw new Error('no priorities');
  await shot('2-plan');
  const gamesBadge = await page.textContent('#gamesBadge');
  if (gamesBadge !== '28') throw new Error('badge ' + gamesBadge);

  // games -> review
  await page.click('[data-tab=games]');
  await page.click('#gamesList tbody tr:first-child');
  await page.waitForSelector('#reviewWrap:not([hidden])');
  await page.keyboard.press('n'); // next mistake
  await shot('3-review');
  const info = await page.textContent('#rvInfo');
  if (!/You: /.test(info)) throw new Error('review did not jump to a user mistake: ' + info);
  if (await page.$('#rvBestBtn')) { await page.click('#rvBestBtn'); await shot('3b-review-best'); }
  const pcs = await page.$$eval('#rvBoard .pc', (n) => n.length);
  if (pcs < 4) throw new Error('board empty');

  // train: make a wrong move and then show answer
  await page.click('[data-tab=train]');
  await page.waitForSelector('#trainWrap:not([hidden])');
  await shot('4-train');
  const status0 = await page.textContent('#trStatus');
  if (!/to move/.test(status0)) throw new Error('trainer not loaded: ' + status0);
  await page.click('#trShow');
  await shot('4b-train-answer');
  await page.click('#trNext');

  // mobile layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.click('[data-tab=plan]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await shot('5-plan-mobile');
  if (overflow) errors.push('horizontal overflow on mobile plan tab');

  // persistence across reload
  await page.reload();
  const badge2 = await page.textContent('#gamesBadge');
  if (badge2 !== '28') throw new Error('data not persisted: ' + badge2);

  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('e2e OK');
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
