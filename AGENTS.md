# Commando Workshop — agent notes

Top-down, vertically scrolling run-and-gun (Capcom's *Commando*, 1985, as the reference).
Starter project for a hands-on workshop: the level and enemy behaviours are hard-coded on purpose.

## Stack (pinned)

- TypeScript + Vite + **Phaser 3.90**. Not Phaser 4: its rendering/FX APIs differ; don't use v4 examples.
- Arcade physics only. No other runtime dependencies.
- `pnpm dev` (http://localhost:5173), `pnpm typecheck`, `pnpm build`.

## Layout

- `src/level.ts` — the level: two text grids (`TERRAIN`, `UNITS`), 16 columns x 80 rows, row 000 at the top.
  Every cell is exactly two characters, space-separated, each line prefixed by a 3-digit row number.
  The legend is in the file header. Tanks (`t1`) are 2x2; the code marks the top-left cell.
- `src/config.ts` — all tunable numbers (speeds, fire rates, HP, scores) and tile frame indices.
- `src/entities/Player.ts` — input, aiming, shooting, grenades.
- `src/entities/enemies.ts` — one class per enemy type (`Rifleman`, `Grenadier`, `Tank`, `Bunker`).
- `src/scenes/GameScene.ts` — builds the world from the grids, collisions, weapons, camera, win/lose.
- `src/scenes/HudScene.ts` — score line and banners. `src/fx.ts` — cosmetic effects only.
- `public/assets/` — Kenney CC0 sprites (licences in `public/assets/licenses/`).

## Conventions

- Keep gameplay state out of `fx.ts`; effects must be safe to remove.
- Depth order is defined once in `DEPTH` (`src/fx.ts`).
- In dev builds the game is reachable as `window.game` (e.g. `game.scene.getScene("game")`) for debugging
  and browser-driven checks.
- Run `pnpm typecheck` before handing work back.
