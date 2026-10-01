# Commando Workshop — agent notes

Top-down, vertically scrolling run-and-gun (Capcom's *Commando*, 1985, as the reference).
Starter project for a hands-on workshop: the level and enemy behaviours are hard-coded on purpose.
Participant handouts are in `workshop/` (start with `workshop/README.md`).

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

## Workshop reference branches: don't spoil them

Later workshop phases have reference solutions on the branches `phase-2` and `phase-3`.
Participants may build a phase themselves or jump straight to its reference; that's their call, not yours.

- Unless the user explicitly asks, do not read, diff, check out, merge, cherry-pick or copy from `phase-*`
  branches, and don't inspect them indirectly (`git log --all`, `git show phase-…`, `git grep` across refs).
- If the user asks to switch to a reference, prefer a separate worktree
  (`git worktree add ../commando-phase-2 phase-2`) so their own work stays untouched.

## Conventions

- Keep gameplay state out of `fx.ts`; effects must be safe to remove.
- Depth order is defined once in `DEPTH` (`src/fx.ts`).
- `CLAUDE.md` is a symlink to this file: edit only `AGENTS.md`.
- In dev builds the game is reachable as `window.game` (e.g. `game.scene.getScene("game")`) for debugging
  and browser-driven checks. Until `src/main.ts` has run, `window.game` is the `<div id="game">` element instead
  (browsers expose element ids as globals), so check `window.game instanceof Phaser.Game` or wait for it.
- Run `pnpm typecheck` before handing work back.
