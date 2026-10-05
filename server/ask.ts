import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkLevel, newProblems, type CheckResult } from "../src/data/check";
import { describeEnemy } from "../src/data/describe";
import type { EnemyTypes } from "../src/data/enemies";
import { DataError } from "../src/data/errors";
import { EMPTY, LEVEL_WIDTH, pad3, parseGrid, parseLevel, serializeLevel, type Grid, type LevelData } from "../src/data/level";

// The editor's "Ask": a headless coding agent is used as a stateless function over the level.
//
//   (level, request) --prompt--> agent --reply text--> parse --> merge --> validate --> proposal
//
// The agent gets no tools and no files; everything it needs is in the prompt and everything it
// produces comes back as text. The app owns the state: the history is kept by the editor and written
// into the next prompt, not carried in an agent session.

export type Layer = "terrain" | "units";
export type Backend = "claude" | "codex" | "opencode";

export const BACKENDS: { id: Backend; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
];

export interface HistoryLine {
  instruction: string;
  rows: [number, number] | null;
  outcome: string;
}

export interface AskRequest {
  instruction: string;
  /** Rows the agent may change, inclusive. null = the whole map. */
  rows: [number, number] | null;
  /** Grids the agent may change. */
  layers: Layer[];
  history: HistoryLine[];
}

export interface Proposal {
  summary: string;
  rows: [number, number];
  /** The selected rows of each grid, as the level would have them after accepting. */
  terrain: Grid;
  units: Grid;
  changed: { terrain: number; units: number };
  warnings: string[];
  attempts: number;
  /** What the agent wanted the designer to know about this change, if anything. */
  message: string | null;
}

export type AskResult =
  | { kind: "proposal"; proposal: Proposal }
  | { kind: "message"; message: string }
  | { kind: "failed"; problems: string[]; attempts: number };

/**
 * What the loop reports while it works, so the editor can show it instead of a black box.
 * "output" is the agent's reply as it streams in; "activity" is a step the agent CLI reported;
 * "thinking" carries how many tokens the model has thought so far (the thoughts themselves are not shown).
 */
export type AskEvent =
  | { type: "prompt"; attempt: number; chars: number; prompt: string }
  | { type: "activity"; attempt: number; text: string }
  | { type: "thinking"; attempt: number; text: string }
  | { type: "output"; attempt: number; text: string }
  | { type: "reply"; attempt: number; chars: number; ms: number; reply: string }
  | { type: "problems"; attempt: number; problems: string[] };

/** Live output from an agent CLI: reply text as it arrives, or a step it reported. */
export type OnOutput = (kind: "output" | "activity" | "thinking", text: string) => void;

export const MAX_ATTEMPTS = 3;

// ------------------------------------------------------------------ prompt

const gridText = (g: Grid, r0 = 0) => g.map((row, i) => `${pad3(r0 + i)} ${row.join(" ")}`).join("\n");

export function buildPrompt(level: LevelData, enemies: EnemyTypes, req: AskRequest, rows: [number, number], retry?: { previous: string; problems: string[] }): string {
  const [r0, r1] = rows;
  const terrainLegend = Object.entries(level.legendTerrain).map(([k, v]) => `  ${k}  ${v}`).join("\n");
  const unitLegend = [
    `  ${EMPTY}  nothing`,
    ...Object.entries(enemies).map(([c, t]) => `  ${describeEnemy(c, t)}`),
    ...Object.entries(level.legendPickups).map(([k, v]) => `  ${k}  ${v}`),
  ].join("\n");
  const may = req.layers.length === 2 ? "both the terrain and the units grids" : `only the ${req.layers[0]} grid (return the other one unchanged)`;
  const sample = (g: Grid) => gridText(g.slice(r0, Math.min(r0 + 2, r1 + 1)), r0);
  const history = req.history.length
    ? `\nRECENT REQUESTS ON THIS LEVEL (oldest first), with what the designer did with the result:\n${req.history
        .map((h) => `- "${h.instruction}"${h.rows ? ` (rows ${pad3(h.rows[0])}-${pad3(h.rows[1])})` : ""}: ${h.outcome}`)
        .join("\n")}\n`
    : "";
  const retryText = retry
    ? `\nYOUR PREVIOUS REPLY WAS REJECTED.\nProblems found:\n${retry.problems.map((p) => `- ${p}`).join("\n")}\n\nYour previous reply was:\n${retry.previous}\n\nFix these problems and reply again in the same format.\n`
    : "";

  return `You are the level designer for a small top-down run-and-gun game in the style of Capcom's Commando (1985).
You edit a level by returning replacement rows of its map. You have no tools and no files: everything you need is below, and your reply is read by a program.

THE GAME
- The player starts at the bottom (highest row number) and walks up to row 000. The screen is ${LEVEL_WIDTH} columns wide and 12 rows tall; it scrolls up as the player advances.
- The player has a rifle (unlimited) and a few grenades. Armored enemies ignore bullets; grenades and explosive barrels hurt them.
- The player can rescue POWs for points and pick up grenade boxes.

MAP FORMAT
- Two grids of the same size, "terrain" and "units". Every cell is exactly two characters, cells are separated by one space, and every row starts with its 3-digit row number.
- Multi-cell units are marked by their top-left cell only; the other cells they cover stay "${EMPTY}" in the units grid.

TERRAIN CODES
${terrainLegend}

UNIT CODES
${unitLegend}

RULES (a program checks these; a reply that breaks them is rejected)
- Use only the codes listed above.
- There must be a walkable path (grass, road, bridge) from the player start to row 000.
- Units stand on grass, road or bridge. A unit that follows the road (the tank) must have every cell of its footprint on road. Footprints must not overlap.
- No enemy within 4 tiles of the player start (the bottom rows). Pickups must be reachable on foot.
- No more than 18 enemies within any 12 consecutive rows.
- Good levels have pacing: quiet stretches, build-ups, ambushes, breathers. Give the player cover to fight from and a clear route.

WHAT YOU MAY CHANGE
- Only rows ${pad3(r0)} to ${pad3(r1)}, and ${may}. The rest of the map is shown for context only.

CURRENT MAP (all rows, for context)
terrain:
${gridText(level.terrain)}

units:
${gridText(level.units)}
${history}${retryText}
REQUEST
${req.instruction}

REPLY FORMAT
First one line: SUMMARY: <one sentence saying what you changed>
Then exactly one fenced block, containing ONLY rows ${pad3(r0)} to ${pad3(r1)} of both grids (that is ${r1 - r0 + 1} rows each), in order, with their row numbers, like this:

\`\`\`toml
terrain = '''
${sample(level.terrain)}
...
'''
units = '''
${sample(level.units)}
...
'''
\`\`\`

If something concerns you, add one line outside the block:
AGENT_MESSAGE: <what the designer should know>
For example: the request needs a kind of terrain, enemy or behaviour that is not listed above; the request is unclear and you had to guess; or you had to change more than was asked.
If the request cannot be done at all with the terrain codes, unit codes and enemy behaviours above, reply with only the AGENT_MESSAGE line and no block.
`;
}

// ------------------------------------------------------------------ reply

export interface Reply {
  summary: string;
  message: string | null;
  terrainText: string | null;
  unitsText: string | null;
}

export function extractReply(text: string): Reply {
  const grab = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  const grid = (name: string) => text.match(new RegExp(`\\b${name}\\s*=\\s*('''|""")([\\s\\S]*?)\\1`))?.[2] ?? null;
  return {
    summary: grab(/^\s*\**SUMMARY:\**\s*(.+)$/im) ?? "",
    message: grab(/^\s*\**AGENT\\?_MESSAGE:\**\s*(.+)$/im),
    terrainText: grid("terrain"),
    unitsText: grid("units"),
  };
}

/** Merges a reply into the level and runs every check. Returns the new level or the problems. */
export function applyReply(level: LevelData, enemies: EnemyTypes, reply: Reply, rows: [number, number], layers: Layer[]): { merged: LevelData } | { problems: string[] } {
  const [r0, r1] = rows;
  const want = r1 - r0 + 1;
  const problems: string[] = [];
  const parsed: Partial<Record<Layer, Grid>> = {};
  for (const layer of ["terrain", "units"] as const) {
    const text = layer === "terrain" ? reply.terrainText : reply.unitsText;
    if (text === null) {
      problems.push(`the reply has no ${layer} grid`);
      continue;
    }
    const g = parseGrid(text, layer, problems, r0);
    if (g.length !== want && !problems.length) problems.push(`${layer} has ${g.length} rows but rows ${pad3(r0)} to ${pad3(r1)} are ${want} rows`);
    parsed[layer] = g;
  }
  if (problems.length) return { problems };

  const merged = structuredClone(level);
  for (const layer of layers) parsed[layer]!.forEach((row, i) => (merged[layer][r0 + i] = row));
  try {
    return { merged: parseLevel(serializeLevel(merged), enemies) };
  } catch (e) {
    return { problems: (e instanceof DataError ? e.problems : [(e as Error).message]).slice(0, 12) };
  }
}

// ------------------------------------------------------------------ the loop

export async function ask(
  level: LevelData,
  enemies: EnemyTypes,
  req: AskRequest,
  run: (prompt: string, onOutput: OnOutput) => Promise<string>,
  onEvent: (e: AskEvent) => void = () => {},
): Promise<AskResult> {
  const rows: [number, number] = req.rows ? [Math.max(0, req.rows[0]), Math.min(level.height - 1, req.rows[1])] : [0, level.height - 1];
  const before = checkLevel(level, enemies);
  let retry: { previous: string; problems: string[] } | undefined;
  let last: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(level, enemies, req, rows, retry);
    const sent = Date.now();
    onEvent({ type: "prompt", attempt, chars: prompt.length, prompt });
    const reply = await run(prompt, (kind, text) => onEvent({ type: kind, attempt, text }));
    onEvent({ type: "reply", attempt, chars: reply.length, ms: Date.now() - sent, reply });
    const parsed = extractReply(reply);
    if (parsed.message && parsed.terrainText === null && parsed.unitsText === null) return { kind: "message", message: parsed.message };

    let problems: string[];
    const result = applyReply(level, enemies, parsed, rows, req.layers);
    let after: CheckResult | undefined;
    if ("problems" in result) problems = result.problems;
    else {
      after = checkLevel(result.merged, enemies);
      // Only what this change made worse counts; a level that was already imperfect elsewhere is not the agent's fault.
      problems = newProblems(before, after);
      if (!problems.length) {
        const [r0, r1] = rows;
        const diff = (layer: Layer) => result.merged[layer].slice(r0, r1 + 1).reduce((n, row, i) => n + row.filter((c, x) => c !== level[layer][r0 + i][x]).length, 0);
        return {
          kind: "proposal",
          proposal: {
            summary: parsed.summary || "(no summary)",
            rows,
            terrain: result.merged.terrain.slice(r0, r1 + 1),
            units: result.merged.units.slice(r0, r1 + 1),
            changed: { terrain: diff("terrain"), units: diff("units") },
            warnings: after.warnings.filter((w) => !before.warnings.includes(w)),
            attempts: attempt,
            message: parsed.message,
          },
        };
      }
    }
    last = problems;
    onEvent({ type: "problems", attempt, problems });
    retry = { previous: reply, problems };
  }
  return { kind: "failed", problems: last, attempts: MAX_ATTEMPTS };
}

// ------------------------------------------------------------------ backends

function onPath(bin: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export const availableBackends = () => BACKENDS.map((b) => ({ ...b, available: onPath(b.id) }));

function exec(cmd: string, args: string[], opts: { cwd: string; signal: AbortSignal; timeoutMs: number; onLine?: (line: string) => void }) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", partial = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      if (!opts.onLine) return;
      const lines = (partial + d).split("\n");
      partial = lines.pop()!;
      for (const line of lines) if (line.trim()) opts.onLine(line);
    });
    child.stderr.on("data", (d) => (stderr += d));
    const stop = (why: string) => {
      child.kill("SIGTERM");
      reject(new Error(why));
    };
    const timer = setTimeout(() => stop(`${cmd} took longer than ${Math.round(opts.timeoutMs / 1000)}s`), opts.timeoutMs);
    const onAbort = () => stop("cancelled");
    opts.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => reject(new Error(`could not run ${cmd}: ${e.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, code });
    });
  });
}

const ANSI = /\x1b\[[0-9;]*m/g;
const tail = (s: string) => s.replace(ANSI, "").trim().slice(-600);
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

function parseLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/**
 * Runs one prompt through a coding-agent CLI in headless mode and returns its final text.
 * Each runs in an empty temp directory with tools disabled or read-only, so it cannot touch the project.
 * Claude and Codex print JSON events while they work; those are passed to onOutput as they arrive.
 */
export async function runAgent(backend: Backend, prompt: string, opts: { model?: string; signal: AbortSignal; timeoutMs?: number; onOutput?: OnOutput }): Promise<string> {
  const say: OnOutput = opts.onOutput ?? (() => {});
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "commando-ask-"));
  const common = { cwd, signal: opts.signal, timeoutMs: opts.timeoutMs ?? 240_000 };
  try {
    if (backend === "claude") {
      // stream-json prints one event per line; the text arrives in small deltas, the final answer in the "result" event.
      const args = ["-p", prompt, "--tools", "", "--no-session-persistence", "--setting-sources", "", "--disable-slash-commands",
        "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
      if (opts.model) args.push("--model", opts.model);
      type ClaudeEvent = {
        type?: string; subtype?: string; model?: string; is_error?: boolean; result?: string; estimated_tokens?: number;
        event?: { type?: string; delta?: { type?: string; text?: string } };
      };
      let result: ClaudeEvent | null = null;
      const r = await exec("claude", args, {
        ...common,
        onLine: (line) => {
          const ev = parseLine<ClaudeEvent>(line);
          if (!ev) return;
          if (ev.type === "system" && ev.subtype === "init") say("activity", `Claude started (model ${ev.model ?? "default"})`);
          else if (ev.type === "system" && ev.subtype === "thinking_tokens" && ev.estimated_tokens) say("thinking", String(ev.estimated_tokens));
          else if (ev.type === "stream_event" && ev.event?.delta?.type === "text_delta" && ev.event.delta.text) say("output", ev.event.delta.text);
          else if (ev.type === "result") result = ev;
        },
      });
      const res = result as ClaudeEvent | null;
      if (res && !res.is_error && res.subtype === "success" && typeof res.result === "string") return res.result;
      throw new Error(`claude failed (exit ${r.code}): ${res?.result ? tail(res.result) : tail(r.stderr || r.stdout)}`);
    }
    if (backend === "codex") {
      const out = path.join(cwd, "last-message.txt");
      // --json prints one event per line as Codex works (no text deltas); the final message is written to `out`.
      const args = ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-C", cwd, "-o", out, "--json"];
      if (opts.model) args.push("-m", opts.model);
      args.push(prompt);
      type CodexEvent = { type?: string; item?: { type?: string; text?: string; command?: string } };
      const r = await exec("codex", args, {
        ...common,
        onLine: (line) => {
          const ev = parseLine<CodexEvent>(line);
          const it = ev?.item;
          if (ev?.type === "turn.started") say("activity", "Codex started");
          else if (ev?.type === "item.completed" && it?.type === "reasoning" && it.text) say("activity", `thinking: ${short(it.text)}`);
          else if (ev?.type === "item.started" && it?.type === "command_execution") say("activity", `running: ${short(it.command ?? "")}`);
          else if (ev?.type === "item.completed" && it?.type === "agent_message") say("activity", "answer written");
        },
      });
      if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`codex failed (exit ${r.code}): ${tail(r.stderr || r.stdout)}`);
      return fs.readFileSync(out, "utf8");
    }
    // opencode: `run --format json` prints one JSON event per line; the answer is in the "text" events.
    const args = ["run", "--pure", "--dir", cwd, "--format", "json"];
    if (opts.model) args.push("-m", opts.model);
    args.push(prompt);
    const r = await exec("opencode", args, common);
    let text = "";
    for (const line of r.stdout.split("\n")) {
      let ev: { type?: string; part?: { text?: string }; error?: { data?: { message?: string }; name?: string } };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "error") throw new Error(`opencode: ${ev.error?.data?.message ?? ev.error?.name ?? "unknown error"}`);
      if (ev.type === "text" && ev.part?.text) text += ev.part.text;
    }
    if (!text) throw new Error(`opencode returned no text (exit ${r.code}): ${tail(r.stderr || r.stdout)}`);
    return text;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
