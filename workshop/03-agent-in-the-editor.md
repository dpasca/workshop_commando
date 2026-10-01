# 03 · An agent in the editor (45 min)

**Goal:** the editor asks a coding agent to change the map, and **you stay in control of what is accepted**.

Until now you talked to an agent and it changed your files. Now the direction flips: **your program calls the agent** as a component.
Every coding agent has a headless mode (`claude -p`, `codex exec`, `opencode run`) that takes a prompt and prints an answer. That is all you need.

## Five ideas worth taking away

1. **The agent is a stateless function.** Level in, level out. *Your app* owns the state: the map, the history, the undo. Nothing lives in an agent "session".
2. **You build the context.** The prompt is assembled by code: rules, legend, the map, the selected rows, the last few requests, the new request. Writing that template teaches you what the agent actually needs.
3. **Least privilege.** The agent gets no tools and no files; it can only answer with text. Your program applies the change, never the agent.
4. **Never trust the output.** Parse it, validate it, and show it before applying it. A reply that breaks the rules is sent back with the reasons (retry), not applied.
5. **Latency is a UX problem.** An answer takes 15 to 45 seconds. Show progress, allow cancel, and do not freeze the game.

## Steps (the floor first)

1. **Call a CLI from the dev server** with a fixed prompt and print what comes back (use the table below).
2. **Build the prompt** from your level: instructions, legend, the map, and the request. Ask for a reply in a format you can parse.
3. **Parse and validate** the reply (right number of rows, two-character cells, only known codes).
4. **Preview and apply.** Show the proposed change on the map; Accept applies it (undoable); Reject throws it away. Then Save as usual.

## Calling the CLIs headlessly

Run each in an **empty temporary folder** with tools off or read-only. These exact forms were tested; the prompt is the last (or `-p`) argument:

| Tool | Command | Where the answer is |
|---|---|---|
| Claude Code | `claude -p "<prompt>" --tools "" --no-session-persistence --output-format text --setting-sources "" --disable-slash-commands` | stdout |
| Codex | `codex exec --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config -C <tmpdir> -o <tmpdir>/out.txt "<prompt>"` | the file given to `-o` |
| OpenCode | `opencode run --pure --dir <tmpdir> --format json "<prompt>"` | JSON lines; join the `part.text` of events with `type: "text"` |

Add `--model sonnet` (Claude) or `-m <model>` (Codex, OpenCode) to trade quality for speed; in our tests Claude's `sonnet` answered in ~15 s against ~40 s for the default.
OpenCode's output format was written from its documentation and has not been exercised against a working login yet; if it differs, trust what you see.

Pitfalls: kill the child process when the user cancels · set a timeout · on Windows the command is a `.cmd` shim, so spawn through a shell and quote the prompt.

## What to put in the prompt

A role · the game in three sentences · the map format · the legend (and what each enemy does, in words) · the rules the result must obey · the full map for context ·
**which rows may change** · recent requests and what you did with them · the request · the exact reply format. Offer an escape hatch:
*"if this needs something the game cannot do, reply `NEEDS: <what>` instead"*. It is the cheapest way to find out what to build next.

## What to validate

Right rows and cell counts · only known codes · **there is still a walkable path from the bottom to the top** · units stand on walkable cells ·
a tank's four cells are all on road · nothing within a few tiles of the player's start · pickups reachable. (Write a checker; your agent can.)
Only blame the agent for problems *its change* introduced.

## Done when

- [ ] you type "add a bridge guarded by two snipers" and see a proposal on the map
- [ ] Accept applies it (and Undo takes it back), Save writes the file, the game reloads with it
- [ ] you can make it produce a reply that breaks the rules, and it is rejected with a reason

## Stretch

Retry with the problems fed back · limit it to a row range · a history list that feeds the next prompt · a model picker · the `NEEDS` log · run two CLIs on the same request and compare.

## Explore track (no building)

Use the finished version (`git worktree add ../commando-phase-3 phase-3`):

1. Try five requests: three sensible, one vague ("make it better"), one impossible ("add a helicopter boss").
2. Same request on two CLIs or two models. Compare time, result, and how well each followed the format.
3. Try to **break** it: what does it accept that it should not? What does the checker miss? Write down three findings.
4. Open `data/requests.md` and `data/ask_log.jsonl`. What would you build next from them?

## Finish: pack your level

Choose your best level and pack the pair of files to share: `data/enemies.toml` and `data/levels/<name>.toml`. In the last session we play each other's levels.
