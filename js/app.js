/* Chess Coach UI: import → analyse → review → personalised plan → trainer. */
(function () {
  'use strict';
  const C = ChessCore, A = Analyzer, S = Stats, Src = Sources;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- storage (always guarded: may be blocked or full) ----------
  const store = {
    ok: true,
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { store.ok = false; return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  let records = store.get('cc.records', []);
  let settings = Object.assign({ site: 'lichess', user: '', count: '30', speed: 'nobullet', level: 'normal', minutes: 30, active: '' }, store.get('cc.settings', {}));
  let drillState = store.get('cc.drills', {});
  const saveSettings = () => store.set('cc.settings', settings);
  const persistRecords = () => {
    if (records.length > 400) records = records.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 400);
    const ok = store.set('cc.records', records);
    if (!ok) logLine('⚠ Browser storage is full or blocked — your results work now but will not be saved after you close the page.', 'err');
  };
  const rkey = (r) => r.id + '|' + r.user;
  const activeRecords = () => records.filter((r) => r.user === (settings.active || '').toLowerCase() && r.userColor != null);

  // ---------- tabs ----------
  const TABS = ['import', 'games', 'review', 'plan', 'train'];
  let currentTab = 'import';
  function show(tab, opts) {
    if (!TABS.includes(tab)) tab = 'import';
    currentTab = tab;
    $$('#nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    TABS.forEach((t) => { $('#tab-' + t).hidden = t !== tab; });
    if (!(opts && opts.noHash)) { try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// quirks */ } }
    ({ games: renderGames, review: renderReview, plan: renderPlan, train: renderTrain }[tab] || (() => {}))();
    window.scrollTo(0, 0);
  }
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });

  // ---------- import ----------
  let busy = false, cancel = null;
  const engine = new ChessEngine.Engine(), cache = new Map();
  function logLine(t, cls) { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = t; $('#importLog').appendChild(d); }
  function setProgress(frac, text) {
    $('#progress').hidden = false; $('#bar').style.width = Math.round(frac * 100) + '%'; $('#progText').textContent = text;
  }
  function setBusy(b) {
    busy = b; ['fetchBtn', 'pgnBtn', 'demoBtn', 'clearBtn'].forEach((id) => { $('#' + id).disabled = b; });
    if (!b) $('#progress').hidden = true;
  }

  async function runImport(text, username, opts) {
    opts = opts || {};
    if (busy) return;
    setBusy(true); cancel = { cancelled: false }; $('#importLog').innerHTML = '';
    try {
      setProgress(0, 'Reading games…');
      let games = C.parsePGN(text);
      const total0 = games.length;
      games = games.filter((g) => !g.headers.Variant || /^standard$/i.test(g.headers.Variant));
      if (!username) username = Src.guessUser(games);
      if (!username) { logLine('Could not tell which player is you. Type your name exactly as it appears in the PGN.', 'err'); return; }
      const u = username.trim().toLowerCase();
      games = games.filter((g) => Src.speedOk(g.headers, opts.speed));
      const mine = games.filter((g) => A.userColorFor(g.headers, username) != null);
      const known = new Set(records.map(rkey));
      const fresh = mine.filter((g) => !known.has(A.gameId(g) + '|' + u));
      logLine(`Found ${total0} game(s) in the data; ${mine.length} are yours${total0 - mine.length ? ` (skipped ${total0 - mine.length}: other players, variants or filtered speed)` : ''}; ${mine.length - fresh.length} already analysed.`);
      if (!fresh.length) { logLine(mine.length ? 'Nothing new to analyse.' : `No games found for “${username}”. Check the spelling.`, mine.length ? '' : 'err'); if (mine.length) { settings.active = u; saveSettings(); } return; }

      const failed = [];
      let done = 0;
      for (let i = 0; i < fresh.length; i++) {
        if (cancel.cancelled) break;
        const g = fresh[i];
        setProgress(i / fresh.length, `Analysing game ${i + 1} of ${fresh.length}…`);
        try {
          const rec = await A.analyzeGame(g, {
            level: settings.level, username, engine, cache, cancel,
            onProgress: (p, n) => setProgress((i + p / Math.max(1, n)) / fresh.length, `Analysing game ${i + 1} of ${fresh.length} · move ${Math.ceil(p / 2)}/${Math.ceil(n / 2)}`),
          });
          rec.user = u; records.push(rec); done++;
          if (done % 3 === 0) persistRecords();
        } catch (err) {
          if (cancel.cancelled) break;
          failed.push(`${g.headers.White || '?'} vs ${g.headers.Black || '?'}: ${err.message}`);
        }
      }
      persistRecords();
      settings.active = u; saveSettings();
      logLine(`${cancel.cancelled ? 'Cancelled after' : 'Done —'} ${done} new game(s) analysed.`);
      failed.slice(0, 5).forEach((f) => logLine('Skipped: ' + f, 'err'));
      updateBadge();
      if (done) {
        const st = S.computeStats(activeRecords());
        if (st.n) { const snaps = store.get('cc.snaps.' + u, []); snaps.push(S.snapshot(st)); store.set('cc.snaps.' + u, snaps.slice(-30)); if (!store.get('cc.base.' + u, null) && st.n >= 8) store.set('cc.base.' + u, S.snapshot(st)); }
        if (!cancel.cancelled) show('plan');
      }
    } catch (err) {
      logLine('Something went wrong: ' + err.message, 'err');
    } finally { setBusy(false); }
  }

  $('#fetchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const site = $('input[name=site]:checked').value, user = $('#username').value.trim();
    if (!user) return;
    Object.assign(settings, { site, user, count: $('#count').value, speed: $('#speed').value, level: $('#level').value }); saveSettings();
    $('#importLog').innerHTML = ''; $('#fetchHint').textContent = '';
    setBusy(true); setProgress(0.02, `Fetching games from ${site === 'lichess' ? 'Lichess' : 'Chess.com'}…`);
    cancel = { cancelled: false };
    let text;
    try {
      const max = +settings.count;
      const fetchOpts = { max: settings.speed === 'all' ? max : Math.round(max * 1.6), onProgress: (t) => setProgress(0.05, t) };
      text = site === 'lichess' ? await Src.fetchLichess(user, fetchOpts) : await Src.fetchChessCom(user, fetchOpts);
    } catch (err) {
      setBusy(false);
      const net = err instanceof TypeError;
      logLine(net ? `Could not reach ${site === 'lichess' ? 'Lichess' : 'Chess.com'}. Check your connection or ad-blocker — or export your games as PGN and paste them on the right.` : err.message, 'err');
      return;
    }
    setBusy(false);
    // keep only the requested number after the speed filter
    const parsed = C.parsePGN(text).filter((g) => Src.speedOk(g.headers, settings.speed)).slice(0, +settings.count);
    const pgn = parsed.map((g) => rebuildPGN(g)).join('\n\n');
    await runImport(pgn, user, { speed: 'all' });
  });

  /** Re-serialise a parsed game so we can filter/limit before analysis. */
  function rebuildPGN(g) {
    const h = Object.entries(g.headers).map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`).join('\n');
    let mt = '';
    g.sans.forEach((s, i) => {
      if (i % 2 === 0) mt += `${i / 2 + 1}. `;
      const c = g.clocks[i];
      mt += s + (c != null ? ` {[%clk ${Math.floor(c / 3600)}:${String(Math.floor(c / 60) % 60).padStart(2, '0')}:${(c % 60).toFixed(1).padStart(4, '0')}]}` : '') + ' ';
    });
    return `${h}\n\n${mt}${g.result}`;
  }

  $('#pgnBtn').addEventListener('click', () => {
    const t = $('#pgnText').value.trim();
    if (!t) { $('#importLog').innerHTML = ''; logLine('Paste some PGN first (or choose a file).', 'err'); return; }
    settings.level = $('#level').value; saveSettings();
    runImport(t, $('#pgnUser').value.trim(), { speed: 'all' });
  });
  $('#pgnFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#pgnText').value = await f.text(); e.target.value = '';
  });
  $('#demoBtn').addEventListener('click', () => {
    settings.level = 'quick'; $('#level').value = 'quick';
    runImport(window.DEMO_PGN, 'You', { speed: 'all' });
  });
  $('#cancelBtn').addEventListener('click', () => { if (cancel) cancel.cancelled = true; });
  $('#clearBtn').addEventListener('click', () => {
    if (!confirm('Delete all analysed games, drills and progress stored in this browser?')) return;
    records = []; drillState = {};
    try { Object.keys(localStorage).filter((k) => k.startsWith('cc.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    cache.clear(); engine.clear(); rv.rec = null; updateBadge(); $('#importLog').innerHTML = ''; logLine('All saved data deleted.');
  });
  function updateBadge() { $('#gamesBadge').textContent = activeRecords().length; }

  // ---------- games list ----------
  const resultFor = (r) => { const s = S.userScore(r); return s === 1 ? 'W' : s === 0 ? 'L' : 'D'; };
  function renderGames() {
    const rs = activeRecords().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const el = $('#gamesList');
    if (!rs.length) { el.innerHTML = '<p class="empty">No games yet — import some first.</p>'; return; }
    el.innerHTML = `<div class="scroll"><table><thead><tr><th>Date</th><th>Opponent</th><th></th><th>Result</th><th>Opening</th><th>Accuracy</th><th title="Mistakes / blunders">Errors</th></tr></thead><tbody>${rs.map((r) => {
      const c = r.userColor, opp = c === 0 ? r.black : r.white, elo = c === 0 ? r.blackElo : r.whiteElo;
      const mine = r.errors.filter((e) => e.color === c);
      const m = mine.filter((e) => e.cls === 2).length, b = mine.filter((e) => e.cls === 3).length;
      return `<tr data-k="${esc(rkey(r))}" tabindex="0"><td>${esc(r.date)}</td><td>${esc(opp)}${elo ? ` <span class="fine">(${elo})</span>` : ''}</td><td><span class="dot ${c ? 'b' : 'w'}" title="${c ? 'Black' : 'White'}"></span></td><td><span class="pill ${resultFor(r)}">${resultFor(r)}</span></td><td>${esc(r.opening)}</td><td>${r.acc[c] == null ? '–' : r.acc[c] + '%'}</td><td>${m ? `<span style="color:var(--mist)">${m}?</span> ` : ''}${b ? `<span style="color:var(--blun)">${b}??</span>` : ''}${m + b ? '' : '–'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  $('#gamesList').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) openReview(tr.dataset.k, null); });
  $('#gamesList').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-k]'); if (tr) openReview(tr.dataset.k, null); } });

  // ---------- review ----------
  const rv = { rec: null, ply: 0, flip: false, fens: [], last: [], board: null, showBest: false };
  const KIND_TEXT = {
    'hung-piece': 'This move lets your opponent win a piece.',
    'allowed-mate': 'This move allows a forced checkmate.',
    'missed-mate': 'You had a forced checkmate here.',
    'missed-capture': 'A winning capture was available.',
    'missed-tactic': 'A forcing move (check or promotion) was much stronger.',
    positional: 'A quieter move was clearly better here.',
  };
  function openReview(k, ply) {
    const rec = records.find((r) => rkey(r) === k); if (!rec) return;
    rv.rec = rec; rv.flip = rec.userColor === 1; rv.showBest = false;
    const pos = new C.Position(rec.fen || C.START_FEN);
    rv.fens = [pos.fen()]; rv.last = [null];
    for (const san of rec.sans) { const m = pos.parseSAN(san); rv.last.push([m.from, m.to]); pos.makeMove(m); rv.fens.push(pos.fen()); }
    rv.ply = ply == null ? 0 : ply;
    show('review');
  }
  function renderReview() {
    const has = !!rv.rec;
    $('#reviewEmpty').hidden = has; $('#reviewWrap').hidden = !has;
    if (!has) return;
    const rec = rv.rec, n = rec.sans.length, p = rv.ply, uc = rec.userColor;
    if (!rv.board) rv.board = Board($('#rvBoard'), {});
    const showBest = rv.showBest && p > 0;
    const idx = showBest ? p - 1 : p, fen = rv.fens[idx];
    const e = p > 0 ? rec.errors.find((x) => x.ply === p - 1) : null;
    const arrows = showBest && e ? [{ from: C.sqFrom(e.bestUci.slice(0, 2)), to: C.sqFrom(e.bestUci.slice(2, 4)) }, { from: C.sqFrom(e.uci.slice(0, 2)), to: C.sqFrom(e.uci.slice(2, 4)), cls: 'bad' }] : [];
    const pos = new C.Position(fen);
    rv.board.render(fen, { flip: rv.flip, last: rv.last[idx], check: pos.inCheck() ? pos.kings[pos.turn] : undefined, arrows });

    const nm = (c) => `${esc(c === 0 ? rec.white : rec.black)} <span class="fine">${(c === 0 ? rec.whiteElo : rec.blackElo) || ''}</span>`;
    const bar = (c) => `<span>${c === uc ? '<b>You</b> · ' : ''}${nm(c)}</span><span class="fine">${rec.acc[c] == null ? '' : 'accuracy ' + rec.acc[c] + '%'}</span>`;
    const top = rv.flip ? 0 : 1;
    $('#rvTop').innerHTML = bar(top); $('#rvBottom').innerHTML = bar(top ^ 1);

    // info panel
    let html = '';
    if (p === 0) {
      const mine = rec.errors.filter((x) => x.color === uc);
      html = `<h3>${esc(rec.opening)}</h3><p class="fine">${esc(rec.date)} · ${esc(rec.tc || '')} · result <b>${esc(rec.result)}</b>${rec.url ? ` · <a href="${esc(rec.url)}" target="_blank" rel="noopener">open on site</a>` : ''}</p>
        <p>Your accuracy <b>${rec.acc[uc] == null ? '–' : rec.acc[uc] + '%'}</b> · ${mine.filter((x) => x.cls === 3).length} blunders, ${mine.filter((x) => x.cls === 2).length} mistakes, ${mine.filter((x) => x.cls === 1).length} inaccuracies.</p>
        <p class="fine">Use ← → to step through. Orange and red dots mark mistakes; <b>N</b> jumps to your next one.</p>`;
    } else {
      const m = rec.mv[p - 1], c = m[7], who = c === uc ? 'You' : 'Opponent', mnum = Math.floor((p - 1) / 2) + 1, dots = c === 0 ? '.' : '...';
      const cls = m[3];
      const label = cls === 0 ? (m[2] < 1.5 ? 'Best / excellent' : 'Good') : A.CLS[cls][0].toUpperCase() + A.CLS[cls].slice(1);
      const ev = rec.evals[p];
      html = `<h3>${who}: ${mnum}${dots} ${esc(rec.sans[p - 1])} <span class="tag c${cls}">${label}</span></h3>
        <p class="fine">Evaluation after the move: <span class="evalv">${fmtEval(ev)}</span> (White's view)${m[5] != null ? ` · clock ${fmtClock(m[5])}${m[6] != null ? ` · thought ${m[6]}s` : ''}` : ''}${m[4] ? ' · <b>time trouble</b>' : ''}</p>`;
      if (e) {
        html += `<p>${esc(KIND_TEXT[e.kind] || '')} It cost about <b>${e.loss}%</b> win chance.</p>
          <p>Better: <b>${esc(e.best || '?')}</b></p>
          <button class="btn ${showBest ? 'ghost' : ''}" id="rvBestBtn">${showBest ? 'Back to the game position' : 'Show the better move'}</button>`;
      } else if (cls === 0) html += '<p class="fine">No problem with this move.</p>';
    }
    $('#rvInfo').innerHTML = html;
    const bb = $('#rvBestBtn'); if (bb) bb.onclick = () => { rv.showBest = !rv.showBest; renderReview(); };

    // moves list
    const rows = [];
    for (let i = 0; i < n; i += 2) {
      const cell = (j) => j < n ? `<button class="mv c${rec.mv[j][3]} ${rec.mv[j][7] === uc ? '' : 'opp'} ${j + 1 === p ? 'cur' : ''}" data-p="${j + 1}">${esc(rec.sans[j])}</button>` : '<span></span>';
      rows.push(`<span class="n">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}`);
    }
    $('#rvMoves').innerHTML = rows.join('');
    const cur = $('#rvMoves .cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    drawGraph();
  }
  const fmtEval = (cp) => (Math.abs(cp) >= 1000 ? (cp > 0 ? '+10+' : '−10+') : (cp >= 0 ? '+' : '−') + (Math.abs(cp) / 100).toFixed(1));
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function drawGraph() {
    const rec = rv.rec, n = rec.evals.length - 1, W = 400, H = 90, y = (cp) => H / 2 - (Math.max(-800, Math.min(800, cp)) / 800) * (H / 2 - 4);
    const x = (i) => (n ? (i / n) * W : 0);
    const pts = rec.evals.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`);
    const marks = rec.errors.filter((e) => e.color === rec.userColor && e.cls >= 2).map((e) => `<circle cx="${x(e.ply + 1)}" cy="${y(rec.evals[e.ply + 1])}" r="3.2" fill="${e.cls === 3 ? 'var(--blun)' : 'var(--mist)'}"/>`).join('');
    $('#rvGraph').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation graph">
      <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/>
      <polygon points="0,${H / 2} ${pts.join(' ')} ${W},${H / 2}" fill="var(--accent-soft)" opacity=".9"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>${marks}
      <line x1="${x(rv.ply)}" x2="${x(rv.ply)}" y1="0" y2="${H}" stroke="var(--ink)" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }
  $('#rvGraph').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect(), n = rv.rec.sans.length;
    goPly(Math.round(((e.clientX - r.left) / r.width) * n));
  });
  function goPly(p) { if (!rv.rec) return; rv.ply = Math.max(0, Math.min(rv.rec.sans.length, p)); rv.showBest = false; renderReview(); }
  $('#rvMoves').addEventListener('click', (e) => { const b = e.target.closest('.mv'); if (b) goPly(+b.dataset.p); });
  $('#rvStart').onclick = () => goPly(0); $('#rvEnd').onclick = () => goPly(1e9);
  $('#rvPrev').onclick = () => goPly(rv.ply - 1); $('#rvNext').onclick = () => goPly(rv.ply + 1);
  $('#rvFlip').onclick = () => { rv.flip = !rv.flip; renderReview(); };
  function nextMistake() {
    if (!rv.rec) return;
    const errs = rv.rec.errors.filter((e) => e.color === rv.rec.userColor && e.cls >= 2).map((e) => e.ply + 1);
    if (!errs.length) return;
    goPly(errs.find((p) => p > rv.ply) || errs[0]);
  }
  $('#rvNextErr').onclick = nextMistake;
  document.addEventListener('keydown', (e) => {
    if (currentTab !== 'review' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'ArrowLeft') goPly(rv.ply - 1); else if (k === 'ArrowRight') goPly(rv.ply + 1);
    else if (k === 'Home') goPly(0); else if (k === 'End') goPly(1e9);
    else if (k === 'f' || k === 'F') { rv.flip = !rv.flip; renderReview(); } else if (k === 'n' || k === 'N') nextMistake(); else return;
    e.preventDefault();
  });

  // ---------- plan ----------
  const pctS = (x) => Math.round(x * 100);
  function trendSVG(trend) {
    if (trend.length < 2) return '<p class="fine">Analyse a few more games to see a trend.</p>';
    const W = 400, H = 130, pad = 16, xs = (i) => pad + (i / (trend.length - 1)) * (W - 2 * pad);
    const vals = trend.map((t) => t.acc), lo = Math.max(0, Math.min(...vals) - 5), hi = Math.min(100, Math.max(...vals) + 5);
    const ys = (v) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * pad);
    const ma = vals.map((_, i) => { const a = vals.slice(Math.max(0, i - 4), i + 1); return a.reduce((s, v) => s + v, 0) / a.length; });
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy per game over time">
      ${trend.map((t, i) => `<circle cx="${xs(i)}" cy="${ys(t.acc)}" r="3" fill="${t.score === 1 ? 'var(--ok)' : t.score === 0 ? 'var(--blun)' : 'var(--muted)'}" opacity=".75"><title>${esc(t.date)} · ${t.acc}%</title></circle>`).join('')}
      <polyline points="${ma.map((v, i) => `${xs(i)},${ys(v)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.4"/>
      <text x="4" y="12" font-size="9" fill="var(--muted)">${Math.round(hi)}%</text><text x="4" y="${H - 4}" font-size="9" fill="var(--muted)">${Math.round(lo)}%</text></svg>
      <p class="fine">Dots = single games (green win, red loss). Line = 5-game average accuracy.</p>`;
  }
  function delta(cur, base, lowerIsBetter, unit) {
    if (base == null || cur == null) return '';
    const d = Math.round((cur - base) * 10) / 10; if (!d) return '<span class="delta">no change</span>';
    const good = lowerIsBetter ? d < 0 : d > 0;
    return `<span class="delta ${good ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)}${unit || ''} vs baseline</span>`;
  }
  let planCache = null;
  function renderPlan() {
    const recs = activeRecords(), has = recs.length > 0;
    $('#planEmpty').hidden = has; $('#planWrap').hidden = !has;
    if (!has) return;
    const st = S.computeStats(recs); if (!st.n) { $('#planEmpty').hidden = false; $('#planWrap').hidden = true; return; }
    const u = settings.active, base = store.get('cc.base.' + u, null);
    const dispName = (recs[0].userColor === 0 ? recs[0].white : recs[0].black) || u;
    const plan = S.buildPlan(st, +settings.minutes || 30);
    planCache = { st, plan };
    const baseOK = base && base.n !== st.n;
    const tile = (v, l, d) => `<div class="stat"><b>${v}</b><span>${l}</span>${d ? '<br>' + d : ''}</div>`;
    const sevCls = (s) => (s >= 0.6 ? 'hi' : s >= 0.35 ? 'mid' : 'lo');
    const focusIds = new Set(plan.focus.map((a) => a.id));

    const areaHTML = (a, i) => `<div class="area ${sevCls(a.severity)}">
      <h3>${a.icon} ${i != null ? `${i + 1}. ` : ''}${esc(a.title)} <span class="sev" title="Severity ${Math.round(a.severity * 100)}/100"><i style="width:${Math.round(a.severity * 100)}%"></i></span></h3>
      <ul class="tight">${a.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <b>What to do</b><ul class="tight">${a.actions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="chips">${a.links.map(([t, h]) => `<a class="chip" href="${esc(h)}" target="_blank" rel="noopener">${esc(t)} ↗</a>`).join('')}<a class="chip" href="#train" data-train="${a.drill}">Train on my own mistakes →</a></div></div>`;

    $('#planWrap').innerHTML = `
      <div class="card"><div class="row wrap"><h2 style="margin:0">Coaching report for ${esc(dispName)}</h2><span class="fine">${st.n} games · ${st.moves} of your moves analysed${st.avgRating ? ` · avg rating ${Math.round(st.avgRating)}` : ''}</span></div>
        <div class="stats" style="margin-top:.8rem">
          ${tile(`${st.record.w}-${st.record.d}-${st.record.l}`, `W-D-L (${pctS(st.record.score)}% score)`)}
          ${tile(st.acc + '%', 'Average accuracy', baseOK ? delta(st.acc, base.acc, false, '%') : '')}
          ${tile(st.per100.blunder, 'Blunders / 100 moves', baseOK ? delta(st.per100.blunder, base.blunder, true) : '')}
          ${tile(st.per100.serious, 'Mistakes+blunders / 100', baseOK ? delta(st.per100.serious, base.serious, true) : '')}
        </div>
        ${st.strengths.length ? `<h3>What you do well</h3><ul class="tight">${st.strengths.map((x) => `<li>✅ ${esc(x)}</li>`).join('')}</ul>` : ''}
        ${st.n < 15 ? '<p class="fine">Tip: with fewer than ~20 games, treat the ranking as a first impression — import more games to firm it up.</p>' : ''}
      </div>

      <div class="card"><h2>Your top ${plan.focus.length} priorities</h2>${plan.focus.map(areaHTML).join('')}</div>

      <div class="card"><div class="row wrap"><h2 style="margin:0">Your weekly plan</h2>
        <label class="field inline">Time per day <select id="minSel">${[15, 20, 30, 45, 60, 90].map((m) => `<option ${m === plan.minutesPerDay ? 'selected' : ''} value="${m}">${m} min</option>`).join('')}</select></label></div>
        <h3 style="margin-top:1rem">Targets for the next 4 weeks</h3>
        ${plan.goals.map((g) => `<div class="goal"><span>${esc(g.title)}<br><span class="fine">${esc(g.label)}</span></span><span><b>${g.from}</b> → <b>${g.to}</b></span></div>`).join('')}
        <h3 style="margin-top:1rem">A typical week</h3>
        <div class="week">${plan.week.map((d) => `<div class="day"><h4>${d.day} <span class="fine">· ${d.blocks.reduce((s, b) => s + b.min, 0)} min</span></h4><ul class="tight">${d.blocks.map((b) => `<li><span class="min">${b.min}′</span> ${esc(b.what)}</li>`).join('')}</ul></div>`).join('')}</div>
        <h3 style="margin-top:1rem">Month at a glance</h3>
        <ul class="tight">${plan.monthly.map(([w, t]) => `<li><b>${w}:</b> ${esc(t)}</li>`).join('')}</ul>
        <p>${esc(plan.checkpoint)}</p>
        <div class="row wrap"><button class="btn ghost" id="copyPlan">Copy plan as text</button><button class="btn ghost" onclick="window.print()">Print</button>${base ? '<button class="btn ghost" id="resetBase">Reset baseline to now</button>' : ''}</div>
      </div>

      <div class="grid2">
        <div class="card"><h2>Accuracy over time</h2><div class="chart">${trendSVG(st.accTrend)}</div></div>
        <div class="card"><h2>By phase</h2>${st.phases.map((p) => `<div class="phase"><span>${p.name}</span><div class="pbar"><i style="width:${p.acc || 0}%"></i></div><span>${p.acc == null ? '–' : p.acc + '%'}</span></div>`).join('')}
          <p class="fine">Serious errors per 100 moves — ${st.phases.map((p) => `${p.name.toLowerCase()} ${p.seriousPer100}`).join(' · ')}.</p>
          <p class="fine">White: ${st.byColor[0].n} games, ${st.byColor[0].score == null ? '–' : pctS(st.byColor[0].score) + '%'} · Black: ${st.byColor[1].n} games, ${st.byColor[1].score == null ? '–' : pctS(st.byColor[1].score) + '%'}</p></div>
      </div>

      <div class="card"><h2>All areas, ranked</h2>${st.areas.map((a) => `<div class="phase" style="grid-template-columns:1fr 120px 3em"><span>${a.icon} ${esc(a.title)}${focusIds.has(a.id) ? ' <b>★</b>' : ''}</span><div class="pbar"><i style="width:${Math.round(a.severity * 100)}%;background:var(--${a.severity >= 0.6 ? 'blun' : a.severity >= 0.35 ? 'mist' : 'inacc'})"></i></div><span>${Math.round(a.severity * 100)}</span></div>`).join('')}
        <p class="fine">Severity compares your rates with typical club-level benchmarks (0 = no issue, 100 = major leak). Based on the built-in engine, so use it as a guide.</p></div>

      <div class="card scroll"><h2>Your openings</h2>${openingsTable(st)}</div>`;
    $('#minSel').onchange = (e) => { settings.minutes = +e.target.value; saveSettings(); renderPlan(); };
    $('#copyPlan').onclick = () => copyPlan(dispName);
    const rb = $('#resetBase'); if (rb) rb.onclick = () => { store.set('cc.base.' + u, S.snapshot(st)); renderPlan(); };
    $$('#planWrap [data-train]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); trainArea = a.dataset.train; show('train'); }));
  }
  function openingsTable(st) {
    if (!st.openings.length) return '<p class="fine">No data.</p>';
    return `<table><thead><tr><th>Opening</th><th>Colour</th><th>Games</th><th>Score</th><th>Avg. loss / opening move</th></tr></thead><tbody>${st.openings.slice(0, 12).map((o) =>
      `<tr><td>${esc(o.family)}</td><td><span class="dot ${o.color ? 'b' : 'w'}"></span></td><td>${o.n}</td><td>${pctS(o.score)}%</td><td>${o.avgLoss}%</td></tr>`).join('')}</tbody></table>`;
  }
  function copyPlan(u) {
    const { st, plan } = planCache;
    const L = [`CHESS COACH — plan for ${u}`, `${st.n} games · accuracy ${st.acc}% · ${st.per100.blunder} blunders/100 moves`, ''];
    plan.focus.forEach((a, i) => { L.push(`${i + 1}. ${a.title}`); a.evidence.forEach((x) => L.push('   - ' + x)); a.actions.forEach((x) => L.push('   > ' + x)); L.push(''); });
    L.push('TARGETS (4 weeks)'); plan.goals.forEach((g) => L.push(`- ${g.title}: ${g.from} -> ${g.to} (${g.label})`));
    L.push('', `WEEK (${plan.minutesPerDay} min/day)`); plan.week.forEach((d) => { L.push(d.day); d.blocks.forEach((b) => L.push(`  ${b.min}' ${b.what}`)); });
    const text = L.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { $('#copyPlan').textContent = 'Copied ✓'; }, () => { prompt('Copy your plan:', text); });
  }

  // ---------- trainer ----------
  let trainArea = 'all';
  const tr = { queue: [], i: 0, pos: null, sel: null, targets: [], board: null, hint: 0, tries: 0, done: false, session: { ok: 0, first: 0, seen: 0 } };
  function buildQueue() {
    const recs = activeRecords();
    const all = S.buildDrills(recs, trainArea === 'all' ? null : trainArea);
    const score = (d) => { const s = drillState[d.id]; return !s ? 1 : s.bad > s.ok ? 0 : 2 + s.ok; };
    tr.queue = all.map((d, idx) => ({ d, idx })).sort((a, b) => score(a.d) - score(b.d) || a.idx - b.idx).map((x) => x.d);
    tr.i = 0;
  }
  function renderTrain() {
    const recs = activeRecords();
    $('#trainEmpty').hidden = recs.length > 0; $('#trainWrap').hidden = !recs.length;
    if (!recs.length) return;
    const st = S.computeStats(recs);
    const opts = [['all', 'All my mistakes']].concat(st.areas.map((a) => [a.drill, `${a.icon} ${a.title}`]));
    const seen = new Set(); const sel = $('#trArea');
    sel.innerHTML = opts.filter(([v]) => !seen.has(v) && seen.add(v)).map(([v, t]) => `<option value="${v}" ${v === trainArea ? 'selected' : ''}>${esc(t)} (${S.buildDrills(recs, v === 'all' ? null : v).length})</option>`).join('');
    if (!tr.board) tr.board = Board($('#trBoard'), { onSquare: onTrainSquare });
    buildQueue(); loadDrill();
  }
  $('#trArea').addEventListener('change', (e) => { trainArea = e.target.value; buildQueue(); loadDrill(); });
  function cur() { return tr.queue[tr.i]; }
  function loadDrill() {
    const d = cur();
    tr.sel = null; tr.targets = []; tr.hint = 0; tr.tries = 0; tr.done = false;
    if (!d) { $('#trStatus').innerHTML = '<p>No positions in this category yet — nice! Pick another focus.</p>'; tr.board.render(C.START_FEN, {}); updateTrStats(); return; }
    tr.pos = new C.Position(d.fen);
    $('#trStatus').innerHTML = `<p><b>${d.color ? 'Black' : 'White'}</b> to move. In your game (${esc(d.family)}, ${esc(d.date)}) a better move existed. Can you find it?</p><p class="fine">Position ${tr.i + 1} of ${tr.queue.length}</p>`;
    drawTrain(); updateTrStats();
  }
  function drawTrain(extra) {
    const d = cur(); if (!d) return;
    tr.board.render(tr.pos.fen(), Object.assign({ flip: d.color === 1, selected: tr.sel == null ? undefined : tr.sel, targets: tr.targets, check: tr.pos.inCheck() ? tr.pos.kings[tr.pos.turn] : undefined }, extra || {}));
  }
  function onTrainSquare(sq) {
    const d = cur(); if (!d || tr.done) return;
    const legal = tr.pos.legalMoves(), p = tr.pos.b[sq];
    if (tr.sel != null && tr.targets.includes(sq)) { attempt(tr.sel, sq, legal); return; }
    if (p && (p >> 3) === tr.pos.turn) { tr.sel = sq; tr.targets = legal.filter((m) => m.from === sq).map((m) => m.to); } else { tr.sel = null; tr.targets = []; }
    drawTrain();
  }
  function attempt(from, to, legal) {
    const d = cur();
    const cand = legal.filter((m) => m.from === from && m.to === to);
    const m = cand.find((x) => x.promo === C.Q) || cand[0], u = C.uci(m);
    tr.sel = null; tr.targets = [];
    const mark = (ok) => { const s = drillState[d.id] || (drillState[d.id] = { ok: 0, bad: 0 }); s[ok ? 'ok' : 'bad']++; store.set('cc.drills', drillState); };
    if (u === d.playedUci) {
      tr.tries++; $('#trStatus').innerHTML = `<p class="no">That's the move you played in the game (${esc(d.played)}) — it cost about ${d.loss}% win chance.</p><p>Try something else.</p>`; drawTrain(); return;
    }
    let verdict;
    if (u === d.bestUci) verdict = { ok: true, best: true, bestSan: d.best };
    else verdict = A.judgeMove(d.fen, u, 'normal', engine);
    if (verdict.ok) {
      tr.done = true; mark(true); tr.session.ok++; if (tr.tries === 0) tr.session.first++; tr.session.seen++;
      const san = tr.pos.san(m);
      $('#trStatus').innerHTML = `<p class="ok">✓ ${esc(san)} — ${verdict.best ? 'the engine\'s top choice!' : 'also strong (engine prefers ' + esc(verdict.bestSan || d.best) + ').'}</p><p class="fine">In the game you played ${esc(d.played)}.</p>`;
      drawTrain({ last: [from, to] });
    } else {
      tr.tries++; mark(false);
      $('#trStatus').innerHTML = `<p class="no">✗ ${esc(tr.pos.san(m))} isn't it${verdict.loss ? ` (loses about ${verdict.loss}% win chance)` : ''}.</p><p>Try again, or use Hint.</p>`; drawTrain();
    }
    updateTrStats();
  }
  $('#trHint').onclick = () => {
    const d = cur(); if (!d || tr.done) return; tr.hint++;
    if (tr.hint === 1) $('#trStatus').insertAdjacentHTML('beforeend', `<p>💡 ${esc(KIND_TEXT[d.kind] || '')}</p>`);
    else { drawTrain({ hint: C.sqFrom(d.bestUci.slice(0, 2)) }); }
  };
  $('#trShow').onclick = () => {
    const d = cur(); if (!d || tr.done) return; tr.done = true;
    const s = drillState[d.id] || (drillState[d.id] = { ok: 0, bad: 0 }); s.bad++; store.set('cc.drills', drillState); tr.session.seen++;
    $('#trStatus').innerHTML = `<p>Best move: <b>${esc(d.best)}</b>. In the game you played <b>${esc(d.played)}</b> (−${d.loss}% win chance).</p>`;
    drawTrain({ arrows: [{ from: C.sqFrom(d.bestUci.slice(0, 2)), to: C.sqFrom(d.bestUci.slice(2, 4)) }, { from: C.sqFrom(d.playedUci.slice(0, 2)), to: C.sqFrom(d.playedUci.slice(2, 4)), cls: 'bad' }] });
    updateTrStats();
  };
  $('#trNext').onclick = () => { if (!tr.queue.length) return; tr.i = (tr.i + 1) % tr.queue.length; loadDrill(); };
  function updateTrStats() {
    const s = tr.session;
    $('#trStats').textContent = s.seen ? `This session: ${s.ok}/${s.seen} solved, ${s.first} on the first try.` : 'Positions come from your own games; ones you miss come back first.';
  }

  // ---------- init ----------
  function init() {
    $('#username').value = settings.user || ''; $('#count').value = settings.count; $('#speed').value = settings.speed; $('#level').value = settings.level;
    $(`input[name=site][value=${settings.site}]`).checked = true;
    $('#level').addEventListener('change', (e) => { settings.level = e.target.value; saveSettings(); });
    $$('input[name=site]').forEach((r) => r.addEventListener('change', () => {
      $('#fetchHint').textContent = r.value === 'chesscom' ? 'Chess.com: your profile must be public. Clocks are included, so time-management advice works.' : 'Lichess: no login needed for public games.';
    }));
    if (!settings.active && records.length) { const last = records.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]; settings.active = last.user; }
    updateBadge();
    const h = (location.hash || '').slice(1);
    show(TABS.includes(h) && h !== 'review' ? h : (activeRecords().length ? 'plan' : 'import'), { noHash: true });
    window.addEventListener('hashchange', () => { const t = (location.hash || '').slice(1); if (TABS.includes(t) && t !== currentTab && t !== 'review') show(t, { noHash: true }); });
    window.__cc = { records: () => records, runImport, show, state: () => ({ settings, rv, tr }) }; // handy for debugging / tests
  }
  init();
})();
