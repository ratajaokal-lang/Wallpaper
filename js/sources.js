/* Fetch games from Lichess / Chess.com public APIs (CORS-enabled, no API key needed). Runs in the browser. */
(function (root) {
  'use strict';

  async function httpError(res, what) {
    if (res.status === 404) return new Error(`${what}: user not found. Check the spelling of the username.`);
    if (res.status === 429) return new Error(`${what} is rate-limiting requests. Wait a minute and try again.`);
    return new Error(`${what} returned HTTP ${res.status}.`);
  }

  async function fetchLichess(username, opts) {
    opts = opts || {};
    const q = new URLSearchParams({ max: String(opts.max || 30), clocks: 'true', opening: 'true', moves: 'true', tags: 'true', pgnInJson: 'false' });
    const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username.trim())}?${q}`, {
      headers: { Accept: 'application/x-chess-pgn' }, signal: opts.signal,
    });
    if (!res.ok) throw await httpError(res, 'Lichess');
    return res.text();
  }

  async function fetchChessCom(username, opts) {
    opts = opts || {};
    const u = username.trim().toLowerCase(), max = opts.max || 30;
    const get = async (url) => {
      const res = await fetch(url, { signal: opts.signal });
      if (!res.ok) throw await httpError(res, 'Chess.com');
      return res.json();
    };
    const arch = await get(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
    const urls = (arch.archives || []).slice().reverse();
    const pgns = [];
    for (let i = 0; i < urls.length && pgns.length < max; i++) {
      if (opts.onProgress) opts.onProgress(`Chess.com archive ${i + 1}/${urls.length} (${pgns.length} games so far)…`);
      const data = await get(urls[i]);
      const games = (data.games || []).filter((g) => g.pgn && (!g.rules || g.rules === 'chess')).reverse();
      for (const g of games) { pgns.push(g.pgn); if (pgns.length >= max) break; }
    }
    if (!pgns.length) throw new Error('No standard games found for that Chess.com user.');
    return pgns.join('\n\n');
  }

  /** speed filter on the TimeControl header: all | nobullet | rapid */
  function speedOk(headers, speed) {
    if (!speed || speed === 'all') return true;
    const m = /^(\d+)(?:\+(\d+))?$/.exec(headers.TimeControl || '');
    if (!m) return speed === 'nobullet'; // daily / unknown counts as slow
    const est = +m[1] + 40 * +(m[2] || 0); // Lichess-style estimate
    if (speed === 'nobullet') return est >= 180;
    if (speed === 'rapid') return est >= 480;
    return true;
  }

  /** Most common player name across games (when the user didn't tell us who they are). */
  function guessUser(games) {
    const c = {};
    for (const g of games) for (const k of ['White', 'Black']) { const n = g.headers[k]; if (n) c[n] = (c[n] || 0) + 1; }
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= Math.max(2, games.length * 0.6) ? top[0] : null;
  }

  const api = { fetchLichess, fetchChessCom, speedOk, guessUser };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sources = api;
})(typeof self !== 'undefined' ? self : this);
