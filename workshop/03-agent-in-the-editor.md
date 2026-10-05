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

## Decide before you prompt

In our tests, an agent working alone reached this goal in about 15 minutes. Spend your time on the decisions:

1. **Reply format.** "Return the complete rows of the selected range, with their numbers" keeps replies small and easy to check.
2. **What may change.** Which rows, which grid, and is the agent ever allowed to touch enemy definitions?
3. **Edits while it thinks.** The answer takes 15 to 45 s. The simplest rule: pause painting until you accept or reject.
4. **Where the rules live.** The player start and what counts as walkable are private to `GameScene.ts` today. Move them to a shared module so the game and your checker agree.

## Steps (the goal first)

1. **Call a CLI from the dev server** with a fixed prompt and print what comes back (use the table below).
2. **Build the prompt** from your level: instructions, legend, the map, and the request. Ask for a reply in a format you can parse.
3. **Parse and validate** the reply: right number of rows, two-character cells, only known codes, and **one gameplay check: there is still a walkable path from the bottom to the top**. The rest of the list below is extra.
4. **Preview and apply.** Show the proposed change on the map; Accept applies it (undoable); Reject throws it away. Then Save as usual.

## Calling the CLIs headlessly

Run each in an **empty temporary folder**: Claude with its tools off, Codex in a read-only sandbox. Either way the agent has nothing to read and nowhere to write, so all it can do is answer.
These exact forms were tested; the prompt is the last argument (or stdin, see below). The CLI returns whatever the model writes, so **your prompt must pin down the reply format** and your parser should tolerate chatter around it.

| Tool | Command | Where the answer is |
|---|---|---|
| Claude Code | `claude -p "<prompt>" --tools "" --no-session-persistence --output-format text --setting-sources "" --disable-slash-commands` | stdout |
| Codex | `codex exec --sandbox read-only --skip-git-repo-check --ephemeral --ignore-user-config -C <tmpdir> -o <tmpdir>/out.txt "<prompt>"` | the file given to `-o` |
| OpenCode | `opencode run --pure --dir <tmpdir> --format json "<prompt>"` | JSON lines; join the `part.text` of events with `type: "text"` |

Add `--model sonnet` (Claude) or `-m <model>` (Codex, OpenCode) to trade quality for speed; in our tests Claude's `sonnet` answered in 10 to 19 s against ~40 s for the default.
**Pass the prompt on stdin** instead of as an argument: the prompt is 10 to 15 KB. `claude -p` reads stdin when no prompt is given; for Codex use `-` as the prompt (`codex exec ... -`). Both tested. This also avoids quoting trouble on Windows.
OpenCode's output format was written from its documentation and has not been exercised against a working login yet; if it differs, trust what you see.

Pitfalls: kill the child process when the user cancels · set a timeout · on Windows the command is a `.cmd` shim, so spawn it through a shell (and pass the prompt on stdin).

## What to put in the prompt

A role · the game in three sentences · the map format · the legend (and what each enemy does, in words) · the rules the result must obey · the full map for context ·
**which rows may change** · recent requests and what you did with them (an extra) · the request · the exact reply format. Offer an escape hatch:
*"if this needs something the game cannot do, reply `NEEDS: <what>` instead"*. It is the cheapest way to find out what to build next.

## What to validate

Right rows and cell counts · only known codes · **there is still a walkable path from the bottom to the top** · units stand on walkable cells ·
a tank's four cells are all on road · nothing within 4 tiles of the player's start · pickups reachable. (Write a checker; your agent can.)
Only blame the agent for problems *its change* introduced.

Definitions, so everyone's checker agrees: walkable = `..`, `rd`, `==` · everything else blocks (treat barrels and crates as blocking, even though they can be shot) ·
the player starts at the bottom centre: second-to-last row, columns 7 and 8.

## Done when

- [ ] you type "add a bridge guarded by two snipers" and see a proposal on the map
- [ ] Accept applies it (and Undo takes it back), Save writes the file, the game reloads with it
- [ ] you can make it produce a reply that breaks the rules, and it is rejected with a reason.
  A good model with the rules in its prompt rarely breaks them, so force it: leave the rules out of the prompt (a checkbox helps) and ask for
  "a wall across the whole map", or paste a hand-written bad reply into your parser.

## Extras

Retry with the problems fed back · limit it to a row range · a history list that feeds the next prompt · a model picker ·
log `NEEDS` replies to a file a coding session can work from · try the same request with two models and compare.

## Or: use the finished version

Switch to it (`git worktree add ../commando-exercise-3 exercise-3`) and:

1. Try five requests: three sensible, one vague ("make it better"), one impossible ("add a helicopter boss").
2. The same request with two models (for example `sonnet` and the default). Compare time, result, and how well each followed the format.
3. Try to **break** it: what does it accept that it should not? What does the checker miss? Write down three findings.
4. Open `data/requests.md` and `data/ask_log.jsonl` (the finished version writes them). What would you build next from them?

## Finish: pick your level

Choose your best level to show in the last session, on your laptop or on the projector, together with one request that worked and one that did not.
