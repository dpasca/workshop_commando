# Commando Workshop

A small top-down, vertically scrolling shooter used as the starter for a hands-on workshop on
building game scaffolding with AI coding agents (Claude Code, Codex, OpenCode).

![](docs/screenshot.png)

## Run

```sh
pnpm install
pnpm dev
```

Controls: **WASD** move · **mouse** aim · **click** fire · **Space / right-click** grenade · **R** restart.

Rescue the POWs, reach the top. Bunkers and tanks shrug off bullets: use grenades, or a nearby red barrel.

## This branch: exercise 2, data + editor

The level and the enemies are TOML files in `data/`, and the page has an editor next to the game.

- **Edit the map:** pick *Terrain* or *Units*, choose from the palette, click or drag on the map. Shift-drag fills a rectangle,
  right-click picks what is under the cursor, undo/redo with ⌘Z / ⇧⌘Z. Click a row number to choose where *Play from row* starts.
  The blue frame on the map is what the game is showing; the yellow dot is the player.
- **Edit the enemies:** the *Enemies* tab has a form for every type: stats, one movement primitive, one attack primitive.
  *Clone as new type* makes a new one (say a faster sniper) without touching code.
- **Save** (⌘S) writes `data/levels/<name>.toml` / `data/enemies.toml` and the game reloads. Files changed by anything else
  (a text editor, a coding agent) reload the same way; if the file is invalid the game keeps running the last good version and
  the panel shows what is wrong. `pnpm check:data` validates the files from the command line.
- **Levels:** the dropdown switches level (`?level=name` in the URL); *New…* creates a blank one.
- **Dev only:** the editor and the file API are part of `pnpm dev`; `pnpm build` produces a game that cannot load levels.

File formats are documented at the top of each data file and in `AGENTS.md`.

## The exercises

Handouts are in `workshop/` (start with `workshop/README.md`).

1. **Hard-coded** (`main`): the level is a text grid in `src/level.ts`, behaviours are code. Add features and effects.
2. **Data + editor** (this branch, the finished version): the level and the enemy definitions move to TOML files, with a level editor and hot reload.
3. **Agent in the editor** (finished version on the `exercise-3` branch): the editor calls a headless coding agent to edit the level on request.

## Credits

Sprites and tiles: [Kenney](https://kenney.nl) — *Top-down Shooter* and *Top-Down Tanks*, CC0.

## Licence

The code and handouts are [MIT](LICENSE) licensed. The sprites and tiles keep their own CC0 licence (`public/assets/licenses/`).
