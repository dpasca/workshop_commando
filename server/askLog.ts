import fs from "node:fs";
import path from "node:path";
import type { HistoryLine } from "./ask";

// What was asked and what the designer did with the answer, kept as JSON lines in data/ask_log.jsonl.
// The newest few entries for a level go back into the next prompt (the agent itself keeps no memory).
// Anything the agent flagged ("AGENT_MESSAGE: ...") is appended to data/agent-messages.md for a coding session.

export interface LogEntry {
  id: string;
  at: string;
  level: string;
  instruction: string;
  rows: [number, number] | null;
  backend: string;
  summary: string;
  outcome: "proposed" | "accepted" | "rejected" | "failed" | "message";
  detail?: string;
}

const logFile = (dataDir: string) => path.join(dataDir, "ask_log.jsonl");

export function appendEntry(dataDir: string, entry: LogEntry) {
  fs.appendFileSync(logFile(dataDir), JSON.stringify({ type: "ask", ...entry }) + "\n");
}

export function appendOutcome(dataDir: string, id: string, outcome: LogEntry["outcome"], detail?: string) {
  fs.appendFileSync(logFile(dataDir), JSON.stringify({ type: "outcome", id, outcome, detail, at: new Date().toISOString() }) + "\n");
}

export function readEntries(dataDir: string): LogEntry[] {
  if (!fs.existsSync(logFile(dataDir))) return [];
  const byId = new Map<string, LogEntry>();
  for (const line of fs.readFileSync(logFile(dataDir), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.type === "ask") byId.set(rec.id, rec);
      else if (rec.type === "outcome" && byId.has(rec.id)) Object.assign(byId.get(rec.id)!, { outcome: rec.outcome, detail: rec.detail });
    } catch {
      /* a half-written line: skip it */
    }
  }
  return [...byId.values()];
}

export const recent = (dataDir: string, level: string, limit: number) => readEntries(dataDir).filter((e) => e.level === level).slice(-limit);

/** The entries as the prompt wants them: only ones the designer has reacted to. */
export function forPrompt(entries: LogEntry[]): HistoryLine[] {
  return entries
    .filter((e) => e.outcome === "accepted" || e.outcome === "rejected" || e.outcome === "message")
    .map((e) => ({
      instruction: e.instruction,
      rows: e.rows,
      outcome: e.outcome === "accepted" ? "accepted" : e.outcome === "rejected" ? `rejected${e.detail ? ` (${e.detail})` : ""}` : `no change proposed; you said: ${e.detail ?? "(nothing)"}`,
    }));
}

export function appendAgentMessage(dataDir: string, level: string, instruction: string, message: string, proposed: boolean) {
  const file = path.join(dataDir, "agent-messages.md");
  const head = fs.existsSync(file) ? "" : "# Messages from the editor's agent\n\nEach line is something the level editor's agent flagged: a request it could not do (it needs new code: a terrain, an enemy behaviour, ...),\nor a concern about a change it proposed.\nHand this file to a coding session.\n\n";
  fs.appendFileSync(file, `${head}- ${new Date().toISOString().slice(0, 16).replace("T", " ")} · level \`${level}\` · asked: "${instruction}" · ${proposed ? "with a proposal" : "no change proposed"} · ${message}\n`);
}
