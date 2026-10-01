#!/usr/bin/env node
// Checks that this machine is ready for the workshop. Run it once before the day, and again if anything feels off:
//
//   node workshop/preflight.mjs
//
// It checks Node, pnpm, git and your coding-agent CLIs, and sends each CLI one tiny headless request
// ("reply with OK") to prove it is installed, logged in and can answer. That costs a few tokens per CLI.
// You only need ONE agent CLI to work. Plain Node, so it runs the same on macOS, Linux and Windows.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const win = process.platform === "win32";
const rows = [];
const add = (name, ok, detail, optional = false) => rows.push({ name, ok, detail, optional });

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell: win });
const version = (cmd) => {
  const r = run(cmd, ["--version"]);
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
};

// ---- tools
const [major, minor] = process.versions.node.split(".").map(Number);
add("Node", major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19), `v${process.versions.node} (need 20.19+ or 22.12+)`);
const pnpm = version("pnpm");
add("pnpm", !!pnpm, pnpm ?? "not found: run `corepack enable` or `npm i -g pnpm`");
const git = version("git");
add("git", !!git, git ?? "not found");
if (git) {
  const name = run("git", ["config", "user.name"]).stdout.trim();
  const email = run("git", ["config", "user.email"]).stdout.trim();
  add("git identity", !!(name && email), name && email ? `${name} <${email}>` : "set it: git config --global user.name / user.email (commits need it)");
}
add("node_modules", fs.existsSync("node_modules"), fs.existsSync("node_modules") ? "installed" : "run `pnpm install` in the project folder");

await new Promise((resolve) => {
  const server = net.createServer().once("error", () => { add("port 5173", false, "in use: another dev server is running (fine if it is yours), or use `pnpm dev --port 5180`", true); resolve(); })
    .once("listening", () => server.close(() => { add("port 5173", true, "free"); resolve(); })).listen(5173);
});

// ---- agent CLIs: one tiny headless request each
const q = (s) => (win ? `"${s.replace(/"/g, '\\"')}"` : s);
const PROMPT = "Reply with exactly the word: OK";

function ask(cmd, args, { timeoutMs = 90000, read } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, win ? args.map((a) => (/[\s"]/.test(a) ? q(a) : a)) : args, { stdio: ["ignore", "pipe", "pipe"], shell: win });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, detail: `no answer after ${timeoutMs / 1000}s` }); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, detail: e.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = read ? read(out) : out;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0 && /\bOK\b/i.test(text)) resolve({ ok: true, detail: `answered in ${secs}s` });
      else {
        // opencode reports errors as JSON events; show just the message
        const jsonError = out.split("\n").map((l) => { try { const e = JSON.parse(l); return e.type === "error" ? e.error?.data?.message ?? e.error?.name : ""; } catch { return ""; } }).find(Boolean);
        resolve({ ok: false, detail: jsonError ?? (err || out || `exit ${code}`).replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-2).join(" ").slice(0, 160) });
      }
    });
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
const agents = [
  { id: "claude", label: "Claude Code", args: ["-p", PROMPT, "--tools", "", "--no-session-persistence", "--output-format", "text"] },
  {
    id: "codex", label: "Codex",
    args: ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", tmp, "-o", path.join(tmp, "out.txt"), PROMPT],
    read: () => (fs.existsSync(path.join(tmp, "out.txt")) ? fs.readFileSync(path.join(tmp, "out.txt"), "utf8") : ""),
  },
  {
    id: "opencode", label: "OpenCode", args: ["run", "--pure", "--dir", tmp, "--format", "json", PROMPT],
    read: (out) => out.split("\n").map((l) => { try { const e = JSON.parse(l); return e.type === "text" ? e.part?.text ?? "" : ""; } catch { return ""; } }).join(""),
  },
];
let working = 0;
for (const a of agents) {
  const v = version(a.id);
  if (!v) { add(a.label, false, "not installed (fine if you use another one)", true); continue; }
  process.stdout.write(`checking ${a.label}… `);
  const r = await ask(a.id, a.args, { read: a.read });
  console.log(r.ok ? "ok" : "failed");
  if (r.ok) working++;
  add(a.label, r.ok, `${v}; ${r.detail}`, true);
}
fs.rmSync(tmp, { recursive: true, force: true });

// ---- report
console.log("");
for (const r of rows) console.log(`${r.ok ? "✓" : r.optional ? "–" : "✗"} ${r.name.padEnd(14)} ${r.detail}`);
const hardFail = rows.filter((r) => !r.ok && !r.optional);
console.log("");
if (!working) console.log("✗ No coding-agent CLI answered. You need at least one of Claude Code, Codex or OpenCode installed AND logged in.");
if (hardFail.length || !working) {
  console.log("Not ready yet: fix the ✗ lines above and run this again.");
  process.exit(1);
}
console.log(`Ready. ${working} agent CLI${working > 1 ? "s" : ""} working.`);
