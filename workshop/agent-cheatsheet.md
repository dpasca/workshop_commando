# Agent cheat sheet

## Two agents at once: worktrees

A worktree is a second checkout of the same repo on its own branch, so two agents can work without touching each other's files.

```sh
git worktree add ../commando-audio -b audio     # any tool
claude -w audio                                  # Claude Code can create one for you
codex --worktree                                 # so can Codex
cd ../commando-audio && pnpm install && pnpm dev --port 5174      # its own dev server, its own port
```

Merge back in your main checkout: `git merge audio`. List and remove: `git worktree list`, `git worktree remove ../commando-audio`.
Ignored files do not come along (no `node_modules`, no `.env`): run `pnpm install` in each worktree.

## Merge conflicts

Two lanes editing the same lines will conflict. Either fix by hand, or ask an agent: *"I am in the middle of a merge with conflicts. Resolve them keeping both sides' intent, then run `pnpm typecheck`."* Check the result by playing.

## Help the agent see

- The dev build exposes the game as `window.game`, so an agent with a browser tool can inspect and drive it.
- Give it a screenshot (paste or a path) and say what is wrong. "The explosion looks flat" is better with a picture.
- Browsers throttle background tabs. For deterministic tests, an agent can call `game.loop.sleep()` and step the game with `game.step(time, delta)`.

## Headless modes (what card 3 uses)

| | one-shot prompt |
|---|---|
| Claude Code | `claude -p "..."` |
| Codex | `codex exec "..."` |
| OpenCode | `opencode run "..."` |

## Keep your quota alive

- Two agents per pair is plenty. Ten parallel sessions will hit rate limits and slow everyone.
- Use a smaller/faster model for small, well-specified jobs; keep the big one for design decisions and debugging.
- Ask for a plan before a big change, and tell it to run `pnpm typecheck` itself.
- Commit often. A working commit is the best undo.

## Good habits that always pay

- Start sessions with *"Read AGENTS.md"*. Add to that file whenever you correct the agent twice.
- Ask it to test its own work, then to summarise in three lines.
- When it is stuck in a loop, stop it, restate the goal in one sentence, and give it the failing output.
