// Tests the Ask loop (prompt, parse, merge, validate, retry) with scripted fake agents. No network, no CLIs.
// Run: pnpm test:ask
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ask, buildPrompt, type AskRequest } from "../server/ask";
import { parseEnemies } from "../src/data/enemies";
import { pad3, parseLevel, type Grid } from "../src/data/level";

const enemies = parseEnemies(readFileSync("data/enemies.toml", "utf8"));
const level = parseLevel(readFileSync("data/levels/river_crossing.toml", "utf8"), enemies);
const grid = (g: Grid, r0: number, r1: number, edit?: (rows: Grid) => void) => {
  const rows = g.slice(r0, r1 + 1).map((r) => r.slice());
  edit?.(rows);
  return rows.map((r, i) => `${pad3(r0 + i)} ${r.join(" ")}`).join("\n");
};
/** Builds a reply for rows r0..r1 with optional edits to each grid. */
const reply = (r0: number, r1: number, t?: (g: Grid) => void, u?: (g: Grid) => void, summary = "did something") =>
  `SUMMARY: ${summary}\n\`\`\`toml\nterrain = '''\n${grid(level.terrain, r0, r1, t)}\n'''\nunits = '''\n${grid(level.units, r0, r1, u)}\n'''\n\`\`\`\n`;
const req = (over: Partial<AskRequest> = {}): AskRequest => ({ instruction: "add a rifleman", rows: [40, 44], layers: ["terrain", "units"], history: [], ...over });
const script = (...replies: string[]) => {
  const prompts: string[] = [];
  return { prompts, run: async (p: string) => (prompts.push(p), replies[Math.min(prompts.length - 1, replies.length - 1)]) };
};
let n = 0;
const test = async (name: string, fn: () => Promise<void>) => { await fn(); console.log(`✓ ${name}`); n++; };

await test("a good reply becomes a proposal", async () => {
  const s = script(reply(40, 44, undefined, (g) => (g[2][3] = "s1")));
  const r = await ask(level, enemies, req(), s.run);
  assert.equal(r.kind, "proposal");
  if (r.kind !== "proposal") return;
  assert.deepEqual(r.proposal.changed, { terrain: 0, units: 1 });
  assert.equal(r.proposal.attempts, 1);
  assert.equal(r.proposal.units[2][3], "s1");
  assert.equal(r.proposal.summary, "did something");
});

await test("the prompt carries the legend, behaviours, rules, selection, history and request", async () => {
  const s = script(reply(40, 44));
  await ask(level, enemies, req({ instruction: "make it nastier", history: [{ instruction: "add cover", rows: [10, 20], outcome: "accepted" }] }), s.run);
  const p = s.prompts[0];
  for (const needle of ["t1 tank", "covers 2x2", "sb  sandbags", "Only rows 040 to 044", "\"add cover\" (rows 010-020): accepted", "make it nastier", "AGENT_MESSAGE:", "walkable path"]) assert.ok(p.includes(needle), `prompt missing: ${needle}`);
  console.log(`  prompt is ${p.length} characters`);
});

await test("a rejected reply is retried with the problems and the previous reply", async () => {
  const onWall = reply(40, 44, (g) => (g[1][5] = "##"), (g) => (g[1][5] = "s1"), "stands on a wall");
  const good = reply(40, 44, undefined, (g) => (g[2][3] = "s1"), "second try");
  const s = script(onWall, good);
  const r = await ask(level, enemies, req(), s.run);
  assert.equal(r.kind, "proposal");
  if (r.kind !== "proposal") return;
  assert.equal(r.proposal.attempts, 2);
  assert.ok(s.prompts[1].includes("YOUR PREVIOUS REPLY WAS REJECTED"));
  assert.ok(s.prompts[1].includes("stands on ##"), "retry prompt should say what was wrong");
  assert.ok(s.prompts[1].includes("stands on a wall"), "retry prompt should include the previous reply");
});

await test("progress events: prompt, reply and problems for each attempt, live output passed through", async () => {
  const onWall = reply(40, 44, (g) => (g[1][5] = "##"), (g) => (g[1][5] = "s1"), "stands on a wall");
  const good = reply(40, 44, undefined, (g) => (g[2][3] = "s1"));
  const replies = [onWall, good];
  const events: string[] = [];
  let i = 0;
  await ask(level, enemies, req(), async (_p, onOutput) => (onOutput("activity", "started"), onOutput("output", "SUMMARY"), replies[i++]), (e) => events.push(`${e.type}:${e.attempt}`));
  assert.deepEqual(events, ["prompt:1", "activity:1", "output:1", "reply:1", "problems:1", "prompt:2", "activity:2", "output:2", "reply:2"]);
});

await test("a message without a block is passed through", async () => {
  const r = await ask(level, enemies, req(), async () => "AGENT_MESSAGE: a cavalry unit that charges the player needs a new behaviour");
  assert.deepEqual(r, { kind: "message", message: "a cavalry unit that charges the player needs a new behaviour" });
});

await test("a message next to a good reply stays with the proposal", async () => {
  const r = await ask(level, enemies, req(), async () => `${reply(40, 44, undefined, (g) => (g[2][3] = "s1"))}\n**AGENT\\_MESSAGE:** I read "rifleman" as a sniper\n`);
  assert.equal(r.kind, "proposal");
  if (r.kind === "proposal") assert.equal(r.proposal.message, 'I read "rifleman" as a sniper');
});

await test("garbage three times fails with a useful reason", async () => {
  const s = script("I think this level is great as it is!");
  const r = await ask(level, enemies, req(), s.run);
  assert.equal(r.kind, "failed");
  if (r.kind === "failed") assert.ok(r.problems.join(" ").includes("no terrain grid"));
  assert.equal(s.prompts.length, 3);
});

await test("wrong row count is reported", async () => {
  const r = await ask(level, enemies, req(), async () => reply(40, 43));
  assert.equal(r.kind, "failed");
  if (r.kind === "failed") assert.ok(r.problems.join(" ").includes("5 rows"), r.problems.join("; "));
});

await test("a locked layer is kept as it was", async () => {
  const s = script(reply(40, 44, (g) => (g[2][2] = "tr"), (g) => (g[2][3] = "s1")));
  const r = await ask(level, enemies, req({ layers: ["units"] }), s.run);
  assert.equal(r.kind, "proposal");
  if (r.kind === "proposal") assert.deepEqual(r.proposal.changed, { terrain: 0, units: 1 });
});

await test("breaking the way through is rejected", async () => {
  const wall = reply(40, 44, (g) => g[2].fill("##"));
  const r = await ask(level, enemies, req(), async () => wall);
  assert.equal(r.kind, "failed");
  if (r.kind === "failed") assert.ok(r.problems.join(" ").includes("no walkable path"), r.problems.join("; "));
});

await test("problems that already existed elsewhere do not block a good change", async () => {
  const broken = structuredClone(level);
  broken.units[30][1] = "h1";
  for (const [r, c] of [[29, 1], [31, 1], [30, 0], [30, 2]]) broken.terrain[r][c] = "##"; // an unreachable POW, outside rows 40-44
  const r = await ask(broken, enemies, req(), async () => {
    const t = grid(broken.terrain, 40, 44), u = grid(broken.units, 40, 44, (g) => (g[2][3] = "s1"));
    return `SUMMARY: ok\n\`\`\`toml\nterrain = '''\n${t}\n'''\nunits = '''\n${u}\n'''\n\`\`\``;
  });
  assert.equal(r.kind, "proposal");
});

await test("markdown decoration around the block is tolerated", async () => {
  const decorated = `**SUMMARY:** added one\n\nSure! Here you go:\n\n${reply(40, 44, undefined, (g) => (g[2][3] = "s1")).replace("SUMMARY: did something\n", "")}\nHope that helps.`;
  const r = await ask(level, enemies, req(), async () => decorated);
  assert.equal(r.kind, "proposal");
  if (r.kind === "proposal") assert.equal(r.proposal.summary, "added one");
});

await test("whole-map requests use every row", async () => {
  const p = buildPrompt(level, enemies, req({ rows: null }), [0, level.height - 1]);
  assert.ok(p.includes("Only rows 000 to 079"));
});

console.log(`\n${n} passed`);
