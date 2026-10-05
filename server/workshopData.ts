import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseEnemies } from "../src/data/enemies";
import { DataError } from "../src/data/errors";
import { parseLevel } from "../src/data/level";
import { ask, availableBackends, runAgent, type AskRequest, type Backend } from "./ask";
import { appendEntry, appendAgentMessage, appendOutcome, forPrompt, readEntries, recent, type LogEntry } from "./askLog";

// Dev-server plugin: the browser can't write files, so this exposes data/ over a tiny HTTP API and
// tells the page when a file changes on disk (whoever changed it: the editor, an agent, a text editor).
//
//   GET  /api/levels          -> { levels: ["river_crossing", ...] }
//   GET  /api/level/:name     -> the level's TOML text
//   PUT  /api/level/:name     -> validate, then write (creates the file if new)
//   GET  /api/enemies         -> enemies.toml text
//   PUT  /api/enemies         -> validate (including every level), then write
//   GET  /api/ask/backends    -> which agent CLIs are installed
//   GET  /api/ask/history     -> recent Ask requests for ?level=
//   POST /api/ask             -> run the level-editing agent; returns a proposal (writes nothing)
//   POST /api/ask/outcome     -> record whether the proposal was accepted or rejected
//
// Change notifications use Vite's websocket: event "workshop:data-changed".

const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;

export function workshopData(): Plugin {
  let dataDir = "";
  const levelsDir = () => path.join(dataDir, "levels");
  const enemiesFile = () => path.join(dataDir, "enemies.toml");
  const levelFile = (name: string) => path.join(levelsDir(), `${name}.toml`);

  const send = (res: ServerResponse, status: number, body: unknown, type = "application/json") => {
    res.statusCode = status;
    res.setHeader("Content-Type", `${type}; charset=utf-8`);
    res.setHeader("Cache-Control", "no-store");
    res.end(type === "application/json" ? JSON.stringify(body) : String(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = "";
      req.on("data", (c) => {
        data += c;
        if (data.length > 1_000_000) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });

  // Write via a temp file so a reader (the game reloading) never sees half a file.
  const writeAtomic = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  };

  const levelNames = () =>
    fs.existsSync(levelsDir()) ? fs.readdirSync(levelsDir()).filter((f) => f.endsWith(".toml")).map((f) => f.slice(0, -5)).sort() : [];

  const handleAsk = async (req: IncomingMessage, res: ServerResponse) => {
    const body = JSON.parse(await readBody(req)) as {
      level: string; levelText: string; instruction: string; rows: [number, number] | null;
      layers: AskRequest["layers"]; backend: Backend; model?: string;
    };
    const instruction = String(body.instruction ?? "").trim();
    if (!instruction) return send(res, 400, { ok: false, errors: ["write what you want first"] });
    if (!availableBackends().some((b) => b.id === body.backend && b.available)) return send(res, 400, { ok: false, errors: [`${body.backend} is not installed (not found on PATH)`] });
    const enemies = parseEnemies(fs.readFileSync(enemiesFile(), "utf8"));
    const level = parseLevel(String(body.levelText), enemies); // the editor's current text, including unsaved edits

    const abort = new AbortController();
    res.on("close", () => !res.writableEnded && abort.abort()); // the page cancelled or went away: stop the agent
    const started = Date.now();
    const rows = body.rows ? ([Number(body.rows[0]), Number(body.rows[1])] as [number, number]) : null;
    const askReq: AskRequest = { instruction, rows, layers: body.layers?.length ? body.layers : ["terrain", "units"], history: forPrompt(recent(dataDir, body.level, 5)) };
    const entry: LogEntry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), level: body.level, instruction, rows, backend: body.backend, summary: "", outcome: "failed" };

    let result;
    try {
      result = await ask(level, enemies, askReq, (prompt) => runAgent(body.backend, prompt, { model: body.model || undefined, signal: abort.signal }));
    } catch (e) {
      if (abort.signal.aborted) return;
      appendEntry(dataDir, { ...entry, outcome: "failed", detail: (e as Error).message });
      return send(res, 502, { ok: false, errors: [(e as Error).message] });
    }
    const ms = Date.now() - started;
    if (result.kind === "proposal") {
      appendEntry(dataDir, { ...entry, summary: result.proposal.summary, outcome: "proposed" });
      if (result.proposal.message) appendAgentMessage(dataDir, body.level, instruction, result.proposal.message, true);
      return send(res, 200, { ok: true, id: entry.id, ms, backend: body.backend, ...result.proposal });
    }
    if (result.kind === "message") {
      appendEntry(dataDir, { ...entry, outcome: "message", detail: result.message });
      appendAgentMessage(dataDir, body.level, instruction, result.message, false);
      return send(res, 200, { ok: false, id: entry.id, ms, message: result.message });
    }
    appendEntry(dataDir, { ...entry, outcome: "failed", detail: result.problems.join("; ").slice(0, 300) });
    return send(res, 200, { ok: false, id: entry.id, ms, errors: result.problems, attempts: result.attempts });
  };

  return {
    name: "workshop-data",
    apply: "serve",
    configResolved(config) {
      dataDir = path.join(config.root, "data");
    },
    configureServer(server) {
      server.watcher.add(dataDir);
      let timer: NodeJS.Timeout | undefined;
      const changed = (file: string) => {
        if (!file.endsWith(".toml") || !file.startsWith(dataDir)) return;
        clearTimeout(timer);
        timer = setTimeout(() => server.ws.send({ type: "custom", event: "workshop:data-changed", data: { file: path.relative(dataDir, file) } }), 80);
      };
      for (const ev of ["add", "change", "unlink"] as const) server.watcher.on(ev, changed);

      server.middlewares.use("/api", async (req, res, next) => {
        try {
          const url = (req.url ?? "").split("?")[0];
          const method = req.method ?? "GET";

          if (url === "/levels" && method === "GET") return send(res, 200, { levels: levelNames() });

          if (url === "/enemies") {
            if (method === "GET") return send(res, 200, fs.readFileSync(enemiesFile(), "utf8"), "text/plain");
            if (method === "PUT") {
              const text = await readBody(req);
              const enemies = parseEnemies(text);
              const problems: string[] = [];
              for (const name of levelNames()) {
                try {
                  parseLevel(fs.readFileSync(levelFile(name), "utf8"), enemies);
                } catch (e) {
                  if (e instanceof DataError) problems.push(...e.problems.map((p) => `level ${name}: ${p}`));
                }
              }
              if (problems.length) throw new DataError(["these changes would break existing levels:", ...problems]);
              writeAtomic(enemiesFile(), text);
              return send(res, 200, { ok: true });
            }
          }

          if (url === "/ask/backends" && method === "GET") return send(res, 200, { backends: availableBackends() });

          if (url === "/ask/history" && method === "GET") {
            const level = new URL(req.url ?? "", "http://x").searchParams.get("level") ?? "";
            return send(res, 200, { entries: recent(dataDir, level, 8) });
          }

          if (url === "/ask/outcome" && method === "POST") {
            const body = JSON.parse(await readBody(req)) as { id: string; outcome: LogEntry["outcome"]; detail?: string };
            if (!readEntries(dataDir).some((e) => e.id === body.id)) return send(res, 404, { ok: false, errors: ["unknown request id"] });
            appendOutcome(dataDir, body.id, body.outcome, body.detail);
            return send(res, 200, { ok: true });
          }

          if (url === "/ask" && method === "POST") return await handleAsk(req, res);

          const m = url.match(/^\/level\/([^/]+)$/);
          if (m) {
            const name = decodeURIComponent(m[1]);
            if (!NAME.test(name)) return send(res, 400, { ok: false, errors: [`bad level name "${name}": use a-z, 0-9, _ and -`] });
            if (method === "GET") {
              if (!fs.existsSync(levelFile(name))) return send(res, 404, { ok: false, errors: [`no level "${name}"`] });
              return send(res, 200, fs.readFileSync(levelFile(name), "utf8"), "text/plain");
            }
            if (method === "PUT") {
              const text = await readBody(req);
              parseLevel(text, parseEnemies(fs.readFileSync(enemiesFile(), "utf8")));
              writeAtomic(levelFile(name), text);
              return send(res, 200, { ok: true });
            }
          }
          next();
        } catch (e) {
          if (e instanceof DataError) return send(res, 400, { ok: false, errors: e.problems });
          send(res, 500, { ok: false, errors: [(e as Error).message] });
        }
      });
    },
  };
}
