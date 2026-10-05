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

## The exercises

Handouts are in `workshop/` (start with `workshop/README.md`).

1. **Hard-coded** (this branch): the level is a text grid in `src/level.ts`, behaviours are code. Add features and effects.
2. **Data + editor** (finished version on the `exercise-2` branch): the level and the enemy definitions move to TOML files, with a level editor and hot reload.
3. **Agent in the editor** (finished version on the `exercise-3` branch): the editor calls a headless coding agent to edit the level on request.

## Credits

Sprites and tiles: [Kenney](https://kenney.nl) — *Top-down Shooter* and *Top-Down Tanks*, CC0.

## Licence

The code and handouts are [MIT](LICENSE) licensed. The sprites and tiles keep their own CC0 licence (`public/assets/licenses/`).
