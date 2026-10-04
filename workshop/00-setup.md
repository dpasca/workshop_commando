# 00 · Setup (15 min)

**Goal:** the game runs on your laptop, and your agent can answer.

```sh
git clone <repo url> commando && cd commando
pnpm install
node workshop/preflight.mjs      # checks Node, pnpm, git and your agent CLIs, and asks each one to say "OK"
pnpm dev                         # open http://localhost:5173
```

Controls: **WASD** move · **mouse** aim · **click** fire · **Space** or **right-click** grenade · **R** restart.
Rescue the POWs, reach the top. Bunkers and tanks shrug off bullets: use a grenade, or lure them next to a red barrel.

## If the preflight fails

- *Node too old:* you need 20.19+ (or 22.12+). Use `nvm`, `fnm` or the installer from nodejs.org.
- *No pnpm:* `corepack enable` (ships with Node), or `npm i -g pnpm`.
- *Agent not answering:* log in first (`claude`, `codex login`, `opencode auth login`), then re-run. You need only one that works.
- *Windows:* the preflight and `pnpm` work; where an exercise shows a shell command, use PowerShell or Git Bash. Tell us if something does not.

## Then

1. Open the project in your agent and say: **"Read AGENTS.md, then tell me how this game is organised."** That file is the briefing every agent reads here; check the answer makes sense.
2. Play for two minutes. Notice what you would change.
3. Agree who types first. Swap at every exercise.

Next: [01 Make it yours](01-make-it-yours.md).
