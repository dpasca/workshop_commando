# Commando Workshop — agent notes

Top-down, vertically scrolling run-and-gun (Capcom's *Commando*, 1985, as the reference).
Starter project for a hands-on workshop. This branch, `exercise-3`, is the finished version of exercise 3: the level and the enemies are
**data files** (`data/`), there is an in-browser editor, the game reloads when the files change, and the editor can
ask a headless coding agent (Claude Code, Codex or OpenCode) to edit the map.
Participant handouts are in `workshop/` (start with `workshop/README.md`).

## Stack (pinned)

- TypeScript + Vite + **Phaser 3.90**. Not Phaser 4: its rendering/FX APIs differ; don't use v4 examples.
- Arcade physics only. Runtime dependencies: `phaser` and `smol-toml` (TOML parser/writer).
- `pnpm dev` (http://localhost:5173), `pnpm typecheck`, `pnpm check:data`, `pnpm test:ask`, `pnpm try:agent`, `pnpm build`.
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
  prints every problem with its row/column, then runs the **level checker** (`src/data/check.ts`): is there a walkable path from the
  start to row 000, are units on walkable cells, do tank footprints sit on road, do footprints overlap, is any enemy within 4 tiles of
  the start, are pickups reachable, is any screen overloaded. The running game keeps the last valid version and shows errors in the editor panel.
- The editor (right of the game, `Tab` hides it) rewrites files in a canonical layout on save, so comments in data files are lost;
  keep notes in `name` fields or legends.

## Code layout

- `src/data/` — pure data layer, no Phaser: `level.ts` and `enemies.ts` (types, parse, serialize, field specs for the editor),
  `store.ts` (fetches the files, holds the current `world`, notifies on change), `sprites.ts` (sprite keys), `errors.ts`.
- `server/workshopData.ts` — Vite dev-server plugin: `GET/PUT /api/level/:name`, `GET/PUT /api/enemies`, `GET /api/levels`,
  and a websocket event `workshop:data-changed` when any `data/**/*.toml` changes on disk (whoever wrote it).
  PUT validates before writing, and writes atomically.
- `server/ask.ts` — the editor's Ask: builds the prompt (rules, legend, behaviours generated from `enemies.toml`, the whole map, the
  rows the agent may change, recent history, the request), runs a coding-agent CLI headlessly, parses the reply, merges it, validates it
  (parser plus level checker; only problems the change *introduced* count) and retries up to 3 times feeding the problems back.
  The CLIs run in an empty temp directory with tools disabled / read-only sandbox, so the agent can only answer with text.
  `server/askLog.ts` keeps `data/ask_log.jsonl` (requests and what the designer did with them; the latest go into the next prompt)
  and `data/requests.md` (things the agent said need new code: "NEEDS: ..."). Both files are git-ignored.
  If you are a coding agent asked to work through `data/requests.md`, implement the missing capability (see the recipe for new
  behaviours below, or add terrain support in `GameScene.ts`), then run `pnpm check:data` and `pnpm test:ask`.
- `src/entities/Enemy.ts` — one generic enemy class driven by its entry in `enemies.toml`.
  `src/entities/behaviors.ts` — the movement and attack **primitives**. To add a behaviour: write the function, add its name to
  `MOVE_KINDS`/`ATTACK_KINDS` and its parameters to `MOVE_FIELDS`/`ATTACK_FIELDS` in `src/data/enemies.ts`; the editor form picks it up.
- `src/entities/Player.ts` — input, aiming, shooting, grenades.
- `src/scenes/GameScene.ts` — builds the world from `store.world`, collisions, weapons, camera, win/lose. It restarts when the world changes.
- `src/scenes/HudScene.ts` — score line and banners. `src/scenes/BootScene.ts` — loads sprites, then the data.
- `src/editor/` — the editor panel (plain DOM + canvas, not Phaser): `editor.ts` (state, save, conflicts, proposal preview),
  `mapView.ts` (paint, row selection), `enemyForm.ts` (generated from the field specs), `askPanel.ts` (the Ask section), `draw.ts` (thumbnails).
  The agent proposes, the editor applies: a proposal is previewed on the map (changed cells outlined), and Accept is an ordinary undoable
  edit that still needs Save. Nothing the agent says is written to disk directly.
- `src/config.ts` — player and weapon numbers, tile frame indices. `src/fx.ts` — cosmetic effects only.
- `public/assets/` — Kenney CC0 sprites (licences in `public/assets/licenses/`).

## Finished versions on other branches: don't spoil them

This branch is the finished version of exercise 3; exercise 2's is on the branch `exercise-2`.
Participants may build an exercise themselves or switch to its finished version; that's their call, not yours.

- Unless the user explicitly asks, do not read, diff, check out, merge, cherry-pick or copy from other `exercise-*`
  branches, and don't inspect them indirectly (`git log --all`, `git show exercise-…`, `git grep` across refs).
- If the user asks to switch to a finished version, prefer a separate worktree
  (`git worktree add ../commando-exercise-2 exercise-2`) so their own work stays untouched.

## Conventions

- Keep gameplay state out of `fx.ts`; effects must be safe to remove.
- Depth order is defined once in `DEPTH` (`src/fx.ts`).
- `CLAUDE.md` is a symlink to this file: edit only `AGENTS.md`.
- In dev builds the game is `window.game` and the editor is `window.editor` (for debugging and browser-driven checks).
  Browsers throttle background tabs; to test gameplay deterministically call `game.loop.sleep()` and drive it with `game.step(time, delta)`.
  Until `src/main.ts` has run, `window.game` is the `<div id="game">` element instead (browsers expose element ids as globals).
- Tests: `pnpm test:ask` runs the Ask loop against scripted fake agents (no network). `pnpm try:agent <cli> "<request>" [rows] [model]`
  tries it against a real CLI and prints timing and validity.
- Run `pnpm typecheck`, `pnpm check:data` and `pnpm test:ask` before handing work back.

## Git ownership and branch names

- Do not add AI co-author trailers, AI signatures, generated-by credits, or session links to commit messages or pull request descriptions. Preserve human author identity and human co-author credits.
- Use `master` as the default branch. Never choose another default branch name unless the user explicitly asks for it. Respect the existing branch when working in an established repository.
- Do not bypass or remove attribution settings or Git hooks enforcing this policy.
