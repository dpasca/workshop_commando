// Dry-run the editor's Ask against a real coding-agent CLI from the command line: how long does it take,
// does it return something valid, how many attempts. Run before the workshop on each machine/CLI.
//
//   pnpm try:agent claude "add a sniper nest on the right" 30 56
//   pnpm try:agent codex  "make it harder" 0 79 gpt-5.4-mini
//   args: <claude|codex|opencode> "<instruction>" [firstRow lastRow] [model]
import { readFileSync } from "node:fs";
import { ask, runAgent, type Backend } from "../server/ask";
import { parseEnemies } from "../src/data/enemies";
import { parseLevel } from "../src/data/level";

const [backend, instruction, r0, r1, model] = process.argv.slice(2);
if (!backend || !instruction) {
  console.error('usage: pnpm try:agent <claude|codex|opencode> "<instruction>" [firstRow lastRow] [model]');
  process.exit(2);
}
const enemies = parseEnemies(readFileSync("data/enemies.toml", "utf8"));
const level = parseLevel(readFileSync(`data/levels/${process.env.LEVEL ?? "river_crossing"}.toml`, "utf8"), enemies);
const rows: [number, number] | null = r0 && r1 ? [Number(r0), Number(r1)] : null;

const started = Date.now();
let calls = 0;
try {
  const result = await ask(level, enemies, { instruction, rows, layers: ["terrain", "units"], history: [] }, (prompt) => {
    calls++;
    console.log(`  call ${calls}: sending ${prompt.length} characters to ${backend}…`);
    return runAgent(backend as Backend, prompt, { model: model || undefined, signal: new AbortController().signal });
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (result.kind === "proposal") {
    const p = result.proposal;
    console.log(`✓ proposal in ${secs}s, ${calls} call(s): ${p.summary}`);
    console.log(`  changed ${p.changed.terrain} terrain + ${p.changed.units} unit cells in rows ${p.rows[0]}-${p.rows[1]}${p.warnings.length ? `; warnings: ${p.warnings.join("; ")}` : ""}`);
    if (p.message) console.log(`  agent's message: ${p.message}`);
  } else if (result.kind === "message") {
    console.log(`⚠ no change; the agent says (${secs}s): ${result.message}`);
  } else {
    console.log(`✗ no usable answer after ${result.attempts} attempts (${secs}s):\n${result.problems.map((p) => `    ${p}`).join("\n")}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.log(`✗ ${(e as Error).message} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  process.exitCode = 1;
}
