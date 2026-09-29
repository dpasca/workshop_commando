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

## Workshop phases

1. **Hard-coded** — the level is a text grid in `src/level.ts`, behaviours are code. Add features and effects.
2. **Data + editor** — move the level (and enemy definitions) to TOML files and build a level editor with hot reload.
3. **Agent in the editor** — the editor calls a headless coding agent to edit the level on request.

## Credits

Sprites and tiles: [Kenney](https://kenney.nl) — *Top-down Shooter* and *Top-Down Tanks*, CC0.
