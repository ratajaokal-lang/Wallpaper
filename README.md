# Chess Coach

Import your games from **Lichess** or **Chess.com** (or paste any PGN), let a built-in engine check every move, and get a **personalised training plan** based on your own recurring mistakes.

Everything runs in the browser — no server, no account, no dependencies. Games and progress are stored only in your browser (`localStorage`).

## Use it

Open `index.html` (double-click, or `npm start` and visit <http://localhost:8080>; it also works on GitHub Pages).

1. **Import** — enter your Lichess/Chess.com username, or paste/upload a PGN. "Try with demo games" loads synthetic sample games.
2. **Games / Review** — step through each game with an evaluation graph; mistakes (●) are explained, with the better move drawn on the board. Keys: ← → Home End, `N` next mistake, `F` flip.
3. **My plan** — ranked weaknesses with evidence from your games, 4-week targets, and a weekly schedule scaled to your minutes per day.
4. **Train** — replays positions from *your own* games where you went wrong; misses come back first.
5. Re-import after a few weeks: the plan compares your numbers with your baseline.

## What the report looks at

Blunder-checking (hung pieces / allowed mates), missed tactics, opening results per opening family, middlegame and endgame accuracy, time management (needs `[%clk]` comments, which both sites include), converting winning positions.

Move quality uses win-probability loss (Lichess formula): inaccuracy ≥ 7, mistake ≥ 14, blunder ≥ 25 points.

## Limits (please read)

- The engine (`js/engine.js`) is a compact alpha-beta engine with piece-square evaluation — far weaker than Stockfish. It reliably finds hung pieces, simple tactics and mates, but "positional" flags can be wrong. Use *Deep* for more precision.
- Lichess/Chess.com fetching uses their public, CORS-enabled APIs from your browser; Chess.com profiles must be public. Rate limits apply.
- Only standard chess is analysed.

## Development

```
npm test            # rules (perft), engine, analysis, stats, sources
npm run test:e2e    # Playwright browser tests (needs `playwright` installed)
npm run demo-data   # regenerate sample/demo.pgn + js/demo-data.js
```

`js/chess.js` passes standard perft counts (start position, Kiwipete and three other reference positions).
