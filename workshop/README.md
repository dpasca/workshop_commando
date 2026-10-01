# Workshop handouts

Today you build the **tooling** around a small Commando-style shooter, and you build it with AI coding agents.
The game is deliberately plain. What matters is the scaffolding that lets you, and then an agent, shape it from the inside.

```
 hard-coded game  →  data files + editor  →  an agent that edits the data for you
     (card 1)             (card 2)                     (card 3)
```

## How the day works

- **Pairs, one agent CLI each.** Claude Code, Codex or OpenCode; any one is enough. Mix them: seeing how differently they behave is part of the point.
- **Three cards, in order.** Each has a goal, a "done when" line, and stretch goals. Nobody is graded; the cards are a menu.
- **Build or explore, your choice, any time.**
  - *Build:* implement the card with your agent. Needs a working agent and some patience.
  - *Explore:* skip to the finished version of that phase and play with it, then try to break it. This is a full path, not a consolation prize.
  - Switching is one command and keeps your own work safe (see below).
- **Aim for the floor, then reach.** If you are not at "done when" with ~10 minutes left in card 2 or 3, take the reference and use it. You will want it for the next card.
- **Your decisions are the point.** In our dry runs an agent alone reached each floor in 7 to 18 minutes. Spend the rest of the time deciding, checking, and understanding what was built. Each card has a "Decide before you prompt" list.

| Card | Time | |
|---|---|---|
| [00 Setup](00-setup.md) | 15 min | clone, install, run, check your agent |
| [01 Make it yours](01-make-it-yours.md) | 45 min | features and effects, plus audio in a parallel worktree |
| [02 Data and an editor](02-data-and-editor.md) | 45 min | level and enemies as files, hot reload, a map editor |
| [03 An agent in the editor](03-agent-in-the-editor.md) | 45 min | the editor asks a coding agent to edit the map |
| [Cheat sheet](agent-cheatsheet.md) | | worktrees, headless modes, ports, merge conflicts, rate limits |
| [Constraint cards](constraints.md) | | optional make-do rules to draw for card 1 |

## The reference solutions

Finished versions of cards 2 and 3 live on branches of this repo: `phase-2` and `phase-3`.
Your agent has been asked not to peek at them unless you tell it to. To use one without touching your own work:

```sh
git worktree add ../commando-phase-2 phase-2     # or phase-3
cd ../commando-phase-2 && pnpm install && pnpm dev --port 5174
```

Each branch builds on the previous one, and its `README.md` and `AGENTS.md` describe what it does.

## Sharing levels at the end

Share your level file (AirDrop, USB, a gist, chat). If your enemies are data too (the reference has `data/enemies.toml`), share that file as well,
since a level only works with the enemy definitions it uses. On the reference, drop the level into `data/levels/` and open `?level=<name>`;
on your own build, use whatever loading you made.
