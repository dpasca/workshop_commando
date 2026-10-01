# 02 · Data and an editor (45 min)

**Goal:** the level stops being code. It becomes a file you can edit **while the game runs**, and then a small editor does the editing for you.
This is the step that turns "a game" into "a game you can shape from the inside", and the step that lets an agent do it later.

## The contract (give this to your agent, or change it and tell it)

One level = one TOML file in `data/levels/`. Two grids of equal size, **16 columns × N rows**:

```toml
[level]
name = "River Crossing"
width = 16
height = 80

[legend.terrain]
".." = "grass"
"rd" = "road"
"##" = "wall"
"~~" = "water"
# ... one entry per terrain code

[map]
terrain = '''
000 .. .. .. .. .. .. .. rd rd .. .. .. .. .. tr ..
001 .. tr .. .. .. .. .. rd rd .. .. .. .. .. .. ..
'''
units = '''
000 .. .. .. .. .. .. .. .. .. .. .. .. .. .. .. ..
001 .. .. .. .. .. .. .. .. .. .. s1 .. .. .. .. ..
'''
```

Rules that make it work for humans **and** agents: every cell is exactly two characters · cells are separated by one space ·
every row starts with its 3-digit row number (so a line can be pointed at: "row 042") · row `000` is the top (the exit).
Your existing level is in `src/level.ts` in almost exactly this shape.

## Steps (the floor first)

1. **Level in a file.** Move the grids out of `src/level.ts` into `data/levels/<name>.toml` and load them. A TOML library helps (`smol-toml`).
2. **Hot reload.** Edit the file in a text editor, save, and the game restarts with the change. Think about who watches the file: the dev server knows when it changes.
3. **A painter.** A panel next to the game: a palette, a grid you can paint, a Save button. The browser cannot write files, so Save needs a small endpoint on the dev server.
4. **Be strict.** A broken file (wrong cell count, unknown code) must give a clear error and **not crash or lose the last good level**.

## Done when

- [ ] you change the file in a text editor and the running game reloads with it
- [ ] you paint a tile in your editor, press Save, and the game reloads with it
- [ ] a deliberately broken file shows a readable error and the game keeps running

## Stretch (pick what excites you)

Enemies as data (a table of types: sprite, hp, speed, one movement and one attack) · undo/redo · "play from this row" · a live overlay of where the camera and player are ·
several levels and a level picker · row numbers you can drag to select a region (you will want that in card 3).

## Explore track (no building)

Switch to the finished version (`git worktree add ../commando-phase-2 phase-2`, see the README) and:

- Design a 2-minute level with a story: a quiet start, an ambush, a bridge, a boss.
- Open **Enemies**, clone the sniper, make it twice as fast with half the range. Does the level still work?
- Edit the level file in a text editor **while playing**. Then break it on purpose and read the error.
- Run `pnpm check:data` after an edit.

## Notice

- What did you have to decide about the file format, and which decision would you change?
- Where do rules live now: in code, in data, or in your head?

Next: [03 An agent in the editor](03-agent-in-the-editor.md).
