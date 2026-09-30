# Commando Workshop — agent notes

Top-down, vertically scrolling run-and-gun (Capcom's *Commando*, 1985, as the reference).
Starter project for a hands-on workshop. This is the **phase-2** state: the level and the enemies are
**data files** (`data/`), there is an in-browser editor, and the game reloads when the files change.

## Stack (pinned)

- TypeScript + Vite + **Phaser 3.90**. Not Phaser 4: its rendering/FX APIs differ; don't use v4 examples.
- Arcade physics only. Runtime dependencies: `phaser` and `smol-toml` (TOML parser/writer).
- `pnpm dev` (http://localhost:5173), `pnpm typecheck`, `pnpm check:data`, `pnpm build`.
- The data API and editor exist only under `pnpm dev` (they are a Vite dev-server plugin). `pnpm build` output cannot load levels.

## Data files (the part you will edit most)

- `data/levels/<name>.toml` — one level. Two grids, `terrain` and `units`, of equal size:
  16 columns x N rows (N = `level.height`, 12 to 400). **Every cell is exactly two characters, cells are separated
  by one space, and every row starts with its 3-digit row number** (`000` is the top, where the exit is; the player starts
  at the bottom). The loader rejects rows with the wrong number, wrong cell count, wrong cell width or unknown codes.
  - Terrain codes are the keys of `[legend.terrain]` in the same file. Unit codes are the enemy types in
    `data/enemies.toml` plus the keys of `[legend.pickups]`. `..` means empty/grass.
  - Multi-cell units (the tank is 2x2) are marked only by their top-left cell; the rest of the footprint stays `..`.
  - Terrain codes need code support to do anything (`src/scenes/GameScene.ts`); an unknown-but-declared code renders as grass.
- `data/enemies.toml` — one `[types.xx]` table per unit code: stats plus one movement primitive (`[types.xx.move]`)
  and one attack primitive (`[types.xx.attack]`). Distances are in **tiles**, times in **seconds**, speeds in **tiles per second**.
  Unknown fields are errors, so typos are caught.
- After editing any data file by hand, run **`pnpm check:data`**. It parses everything with the same code the game uses and
  prints every problem with its row/column. The running game keeps the last valid version and shows the errors in the editor panel.
- The editor (right of the game, `Tab` hides it) rewrites files in a canonical layout on save, so comments in data files are lost;
  keep notes in `name` fields or legends.

## Code layout

- `src/data/` — pure data layer, no Phaser: `level.ts` and `enemies.ts` (types, parse, serialize, field specs for the editor),
  `store.ts` (fetches the files, holds the current `world`, notifies on change), `sprites.ts` (sprite keys), `errors.ts`.
- `server/workshopData.ts` — Vite dev-server plugin: `GET/PUT /api/level/:name`, `GET/PUT /api/enemies`, `GET /api/levels`,
  and a websocket event `workshop:data-changed` when any `data/**/*.toml` changes on disk (whoever wrote it).
  PUT validates before writing, and writes atomically.
- `src/entities/Enemy.ts` — one generic enemy class driven by its entry in `enemies.toml`.
  `src/entities/behaviors.ts` — the movement and attack **primitives**. To add a behaviour: write the function, add its name to
  `MOVE_KINDS`/`ATTACK_KINDS` and its parameters to `MOVE_FIELDS`/`ATTACK_FIELDS` in `src/data/enemies.ts`; the editor form picks it up.
- `src/entities/Player.ts` — input, aiming, shooting, grenades.
- `src/scenes/GameScene.ts` — builds the world from `store.world`, collisions, weapons, camera, win/lose. It restarts when the world changes.
- `src/scenes/HudScene.ts` — score line and banners. `src/scenes/BootScene.ts` — loads sprites, then the data.
- `src/editor/` — the editor panel (plain DOM + canvas, not Phaser): `editor.ts` (state, save, conflicts), `mapView.ts` (paint),
  `enemyForm.ts` (generated from the field specs), `draw.ts` (thumbnails).
- `src/config.ts` — player and weapon numbers, tile frame indices. `src/fx.ts` — cosmetic effects only.
- `public/assets/` — Kenney CC0 sprites (licences in `public/assets/licenses/`).

## Workshop reference branches: don't spoil them

Later workshop phases have reference solutions on the branch `phase-3` (and `phase-2` is this one).
Participants may build a phase themselves or jump straight to its reference; that's their call, not yours.

- Unless the user explicitly asks, do not read, diff, check out, merge, cherry-pick or copy from other `phase-*`
  branches, and don't inspect them indirectly (`git log --all`, `git show phase-…`, `git grep` across refs).
- If the user asks to switch to a reference, prefer a separate worktree
  (`git worktree add ../commando-phase-3 phase-3`) so their own work stays untouched.

## Conventions

- Keep gameplay state out of `fx.ts`; effects must be safe to remove.
- Depth order is defined once in `DEPTH` (`src/fx.ts`).
- In dev builds the game is `window.game` and the editor is `window.editor` (for debugging and browser-driven checks).
  Browsers throttle background tabs; to test gameplay deterministically call `game.loop.sleep()` and drive it with `game.step(time, delta)`.
- Run `pnpm typecheck` and `pnpm check:data` before handing work back.
