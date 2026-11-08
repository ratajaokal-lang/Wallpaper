/* Minimal DOM chess board: pieces as text glyphs, highlights, arrows, click handler. */
(function (root) {
  'use strict';
  const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
  const NS = 'http://www.w3.org/2000/svg';

  function Board(el, opts) {
    opts = opts || {};
    el.classList.add('board');
    el.innerHTML = '';
    const cells = [];
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      d.className = 'sq ' + (((i >> 3) + (i & 7)) % 2 ? 'dark' : 'light');
      el.appendChild(d); cells.push(d);
    }
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'arrows'); svg.setAttribute('viewBox', '0 0 8 8');
    svg.innerHTML = '<defs><marker id="ah-good" viewBox="0 0 4 4" refX="2" refY="2" markerUnits="userSpaceOnUse" markerWidth=".6" markerHeight=".6" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#2d7fd1"/></marker><marker id="ah-bad" viewBox="0 0 4 4" refX="2" refY="2" markerUnits="userSpaceOnUse" markerWidth=".6" markerHeight=".6" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#c8392f"/></marker></defs>';
    el.appendChild(svg);
    let flip = false, last = null;

    const sqAt = (i) => { const r = i >> 3, f = i & 7; return flip ? r * 16 + (7 - f) : (7 - r) * 16 + f; };
    el.addEventListener('click', (e) => {
      const c = e.target.closest('.sq'); if (!c || !opts.onSquare) return;
      opts.onSquare(+c.dataset.sq);
    });

    const api = {
      el,
      /** o: {flip, last:[from,to], selected, targets:[sq], check:sq, hint:sq, arrows:[{from,to,cls}]} */
      render(fen, o) {
        o = o || {}; flip = !!o.flip; last = o.last || null;
        const rows = fen.split(' ')[0].split('/');
        const b = {};
        rows.forEach((row, r) => { let f = 0; for (const ch of row) { if (ch >= '1' && ch <= '8') f += +ch; else { b[(7 - r) * 16 + f] = ch; f++; } } });
        for (let i = 0; i < 64; i++) {
          const sq = sqAt(i), c = cells[i], ch = b[sq];
          c.dataset.sq = sq;
          let cls = 'sq ' + (((i >> 3) + (i & 7)) % 2 ? 'dark' : 'light');
          if (last && (sq === last[0] || sq === last[1])) cls += ' last';
          if (o.selected === sq) cls += ' sel';
          if (o.hint === sq) cls += ' hint';
          if (o.check === sq) cls += ' check';
          if (o.targets && o.targets.includes(sq)) cls += b[sq] ? ' target cap' : ' target';
          c.className = cls;
          let html = '';
          if (ch) {
            const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1, white = ch === ch.toUpperCase();
            html += `<span class="pc ${white ? 'w' : 'b'}">${GLYPH[t]}︎</span>`;
          }
          if ((i & 7) === 0) html += `<i class="rk">${(sq >> 4) + 1}</i>`;
          if ((i >> 3) === 7) html += `<i class="fl">${'abcdefgh'[sq & 7]}</i>`;
          c.innerHTML = html;
        }
        api.arrows(o.arrows || []);
      },
      arrows(list) {
        svg.querySelectorAll('line').forEach((n) => n.remove());
        const xy = (sq) => { const f = sq & 7, r = sq >> 4; return flip ? [7 - f + 0.5, r + 0.5] : [f + 0.5, 7 - r + 0.5]; };
        // draw "bad" arrows first so the recommended move sits on top
        for (const a of list.slice().sort((p, q) => (q.cls === 'bad') - (p.cls === 'bad'))) {
          let [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
          const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
          x1 += ux * 0.15; y1 += uy * 0.15; x2 -= ux * 0.28; y2 -= uy * 0.28;
          const ln = document.createElementNS(NS, 'line');
          ln.setAttribute('x1', x1); ln.setAttribute('y1', y1); ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
          ln.setAttribute('class', 'arrow ' + (a.cls || '')); ln.setAttribute('marker-end', a.cls === 'bad' ? 'url(#ah-bad)' : 'url(#ah-good)');
          svg.appendChild(ln);
        }
      },
    };
    return api;
  }
  root.Board = Board;
})(typeof self !== 'undefined' ? self : this);
