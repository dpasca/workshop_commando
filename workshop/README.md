# Workshop handouts

Today you build the **tooling** around a small Commando-style shooter, and you build it with AI coding agents.
The game is deliberately plain. What matters is the scaffolding that lets you, and then an agent, shape it from the inside.

```
 hard-coded game  →  data files + editor  →  an agent that edits the data for you
   (exercise 1)          (exercise 2)                 (exercise 3)
```

## How the day works

- **Pairs, one AI coding tool per pair.** Claude Code, Codex or OpenCode: whichever you already use.
- **Three exercises, in order.** Each has a goal with a "done when" checklist, and extras if you have time. Nobody is graded.
- **Build it yourself, or use the finished version.** Your choice, at any time.
  - *Build it yourself:* implement the exercise with your agent.
  - *Use the finished version:* switch to it, play with it, then try to break it. This is a real option, not a consolation prize.
  - Switching is one command and keeps your own work safe (see below).
- **Reach the goal first, then the extras.** If you are not close to the goal with ~10 minutes left in exercise 2 or 3, switch to the finished version. You will want it for the next exercise.
- **Your decisions are the point.** In our tests, an agent working alone reached each goal in 10 to 20 minutes. Spend the rest of the time deciding, checking, and understanding what was built. Each exercise has a "Decide before you prompt" list.

| Exercise | Time | |
|---|---|---|
| [00 Setup](00-setup.md) | 15 min | clone, install, run, check your agent |
| [01 Make it yours](01-make-it-yours.md) | 45 min | features and effects, plus audio in a parallel worktree |
| [02 Data and an editor](02-data-and-editor.md) | 45 min | level and enemies as files, hot reload, a map editor |
| [03 An agent in the editor](03-agent-in-the-editor.md) | 45 min | the editor asks a coding agent to edit the map |
| [Cheat sheet](agent-cheatsheet.md) | | worktrees, headless modes, ports, merge conflicts, rate limits |
| [Constraint cards](constraints.md) | | optional make-do rules to draw for exercise 1 |

## The finished versions

Finished versions of exercises 2 and 3 live on branches of this repo: `exercise-2` and `exercise-3`.
Your agent has been asked not to peek at them unless you tell it to. To use one without touching your own work:

```sh
git worktree add ../commando-exercise-2 exercise-2     # or exercise-3
cd ../commando-exercise-2 && pnpm install && pnpm dev --port 5174
```

Each branch builds on the previous one, and its `README.md` and `AGENTS.md` describe what it does.

## Showing your level at the end

In the last part of the day, each pair shows its best level on its own laptop, or on the projector. Nothing to copy or send.
