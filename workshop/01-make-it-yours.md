# 01 · Make it yours (45 min)

**Goal:** change the game with your agent, feel what the edit-rebuild-reload cycle costs, and run **two agents in parallel** without them stepping on each other.

You work in two lanes at once. Start lane B first; it runs while you work on lane A.

## Lane A · features and effects (in your main checkout)

Pick one or two from the menu (or invent your own). Draw a [constraint card](constraints.md) if you want a make-do twist.

| Area | Ideas |
|---|---|
| Weapons | flamethrower · shotgun spread · machine gun that overheats · rocket with splash · grenade that bounces |
| Enemies | kamikaze runner · medic that revives others · mortar with a visible target circle · jeep that rams · boss with phases |
| World | destructible walls · mines · mud that slows you · a bridge that collapses · searchlights |
| Player | dash/roll · shield pickup · health bar instead of one hit · ammo pickups |
| Feedback | damage numbers · hit-stop · kill-streak banner · minimap · screen-shake tuning |
| Look | night level with a flashlight cone · rain · muzzle light · heat haze on explosions |

Ask for the result, tell the agent to run `pnpm typecheck`, and make it **look at the game** (see the cheat sheet: agents can drive a browser, and the dev build exposes `window.game`).

## Lane B · audio, in a separate worktree

The game is silent. Make an agent add sound **while you work on lane A**:

```sh
git worktree add ../commando-audio -b audio
cd ../commando-audio && pnpm install      # or: claude -w audio
pnpm dev --port 5174                      # a second copy, on its own port
```

Brief for the audio agent (adapt it):

> Add sound to this game with the Web Audio API, **no audio files**: synthesised shots, explosions, grenade lob and pickup jingles,
> enemy hits, POW rescue, game over. Put everything in a new `src/audio.ts` and call it with **one-line calls** from the game code
> (`audio.play("shot")`), so the diff to existing files stays tiny. Browsers block audio until the first click; handle that.

When it works: commit in the audio worktree, then in your main checkout `git merge audio`.
Expect a few conflicts if both lanes touched the same lines; resolving them (by hand, or ask an agent) is part of the exercise.

> **Why a one-file design?** Two agents editing the same files in parallel is the expensive case. The less lane B touches, the cheaper the merge.

## Done when

- [ ] at least one feature from lane A is visible in the game
- [ ] the game makes sound, merged from lane B
- [ ] `pnpm typecheck` passes

## Notice (we will talk about it)

- How many times did you reload to tune one number? What would you have wanted instead, a slider? A file? A panel?
- What did you have to explain to the agent twice?
- What did the merge teach you about splitting work?

## Stretch

A second effect · tune values in `src/config.ts` · a boss · make the audio react to what is happening (heartbeat when you are hurt).

Next: [02 Data and an editor](02-data-and-editor.md). *If you are behind, the next card starts from `main` too; your lane A work is a bonus, not a prerequisite.*
