# 01 · Make it yours (40 min)

**Goal:** change the game with your agent, feel what the edit-rebuild-reload cycle costs, and run **two agents in parallel** without them stepping on each other.

You work on two parts at once. Start part B first; it runs while you work on part A.

## Part A · features and effects (in your `master` checkout)

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
Pick features that can be **seen or measured** (a dash you can time, a banner you can screenshot). If you add a control, update the controls hint on the start banner in `src/scenes/HudScene.ts`.

## Part B · audio, in a separate worktree

The game is silent. Make an agent add sound **while you work on part A**:

```sh
git worktree add ../commando-audio -b audio
cd ../commando-audio && pnpm install      # or: claude -w audio
pnpm dev --port 5174                      # a second copy, on its own port
```

Brief for the audio agent (adapt it):

> Add sound to this game with the Web Audio API, **no audio files**: synthesised shots, explosions, grenade lob and pickup jingles,
> enemy hits, POW rescue, game over. Put everything in a new `src/audio.ts` and call it with **one-line calls** from the game code
> (`audio.play("shot")`), so the diff to existing files stays tiny. Browsers block audio until the first click or key press; handle that.

When it works: commit in the audio worktree (do it yourself if the agent can't; Codex's sandbox blocks commits), then in your `master` checkout `git merge audio`.
**Leave 10 minutes for the merge.** Expect a conflict or two where both parts touched the same lines (in our test: one import line).
Resolve by hand, or ask an agent; it took one 24 seconds.

> **Why a one-file design?** Two agents editing the same files in parallel is the expensive case. The less part B touches, the cheaper the merge.

## Done when

- [ ] part A: at least one feature is visible (or measurable) in the game
- [ ] part B: the game makes sound, committed on the `audio` branch
- [ ] you (not either agent) merged `audio` into your `master` checkout, and `pnpm typecheck` passes

## Notice (we will talk about it)

- How many times did you reload to tune one number? What would you have wanted instead, a slider? A file? A panel?
- What did you have to explain to the agent twice?
- What did the merge teach you about splitting work?

## Extras

A second effect · tune values in `src/config.ts` · a boss · make the audio react to what is happening (heartbeat when you are hurt).

Next: [02 Data and an editor](02-data-and-editor.md). *Exercise 1 has no finished version: it is open-ended. If you are behind, the next exercise starts from `master` too; your part A work is a bonus, not a prerequisite.*
