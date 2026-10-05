import { pad3 } from "../data/level";
import { store } from "../data/store";
import type { Editor } from "./editor";

export interface ClientProposal {
  id: string;
  summary: string;
  rows: [number, number];
  terrain: string[][];
  units: string[][];
  changed: { terrain: number; units: number };
  warnings: string[];
  attempts: number;
  message: string | null;
  ms: number;
  backend: string;
}

interface HistoryEntry {
  id: string;
  instruction: string;
  rows: [number, number] | null;
  outcome: string;
  detail?: string;
}

const MARK: Record<string, string> = { accepted: "✓", rejected: "✗", message: "⚠", failed: "!", proposed: "…" };

// The "Ask an agent" section. The page calls the dev server, which runs a coding agent headlessly with the
// level in the prompt and sends back a proposal. Nothing is changed until you press Accept, and Accept is
// an ordinary undoable edit that still needs Save.
export class AskPanel {
  private root: HTMLDetailsElement;
  private abort: AbortController | null = null;
  private result: HTMLElement;
  private history: HTMLElement;
  private live: LiveView;

  constructor(private ed: Editor, host: HTMLElement) {
    this.root = document.createElement("details");
    this.root.className = "ask";
    this.root.open = true;
    this.root.innerHTML = `
      <summary>Ask an agent to edit the map</summary>
      <div class="row">
        <select id="ask-backend" title="which coding agent CLI answers"></select>
        <input id="ask-model" type="text" placeholder="model (optional), e.g. sonnet" title="passed to the CLI's model option; empty = its default. A mid-size model is often much faster for this job." />
      </div>
      <textarea id="ask-text" rows="3" placeholder="e.g. make the second half harder, but keep a clear route"></textarea>
      <div class="row">
        <label><input type="checkbox" id="ask-terrain" checked /> may change terrain</label>
        <label><input type="checkbox" id="ask-units" checked /> may change units</label>
      </div>
      <div class="row">
        <span id="ask-sel" class="hint"></span>
        <button id="ask-clear" title="let the agent change any row">Whole map</button>
        <button id="ask-view" title="select the rows the game is showing now">Game view</button>
      </div>
      <div class="row"><button id="ask-go" class="primary">Ask <kbd>⌘↵</kbd></button></div>
      <div id="ask-result"></div>
      <details id="ask-live" class="ask-live" hidden>
        <summary><span class="spinner"></span><b id="live-title"></b><span id="live-secs" class="live-secs"></span></summary>
        <div class="live-bar"><div></div></div>
        <div id="live-hint" class="hint"></div>
        <ol id="live-steps" class="live-steps"></ol>
        <details><summary id="live-prompt-sum">Prompt sent</summary><pre id="live-prompt" class="live-pre"></pre></details>
        <details id="live-out-box" open><summary>The agent's reply, as it arrives</summary><pre id="live-out" class="live-pre"></pre></details>
      </details>
      <div id="ask-history"></div>`;
    host.prepend(this.root);
    this.result = this.q("ask-result");
    this.history = this.q("ask-history");
    this.live = new LiveView((id) => this.q(id));

    this.q("ask-go").addEventListener("click", (e) => { this.go(); (e.currentTarget as HTMLElement).blur(); });
    this.q("ask-clear").addEventListener("click", (e) => { this.ed.setSelection(null); (e.currentTarget as HTMLElement).blur(); });
    this.q("ask-view").addEventListener("click", (e) => { this.selectGameView(); (e.currentTarget as HTMLElement).blur(); });
    this.q("ask-text").addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); this.go(); }
    });
    (this.q("ask-model") as HTMLInputElement).value = localStorage.getItem("commando.askModel") ?? "";
    void this.loadBackends();
    this.render();
  }

  private q<T extends HTMLElement = HTMLElement>(id: string) {
    return this.root.querySelector<T>(`#${id}`)!;
  }

  // ---------------------------------------------------------------- state

  private async loadBackends() {
    try {
      const { backends } = (await (await fetch("/api/ask/backends")).json()) as { backends: { id: string; label: string; available: boolean }[] };
      const select = this.q<HTMLSelectElement>("ask-backend");
      select.innerHTML = backends.map((b) => `<option value="${b.id}" ${b.available ? "" : "disabled"}>${b.label}${b.available ? "" : " (not installed)"}</option>`).join("");
      const saved = localStorage.getItem("commando.askBackend");
      const first = backends.find((b) => b.available)?.id;
      select.value = backends.some((b) => b.id === saved && b.available) ? saved! : first ?? "";
      select.addEventListener("change", () => localStorage.setItem("commando.askBackend", select.value));
    } catch { /* dev server not reachable yet */ }
  }

  async loadHistory() {
    try {
      const { entries } = (await (await fetch(`/api/ask/history?level=${encodeURIComponent(store.levelName)}`, { cache: "no-store" })).json()) as { entries: HistoryEntry[] };
      this.history.replaceChildren();
      if (!entries.length) return;
      const title = document.createElement("div");
      title.className = "hint";
      title.textContent = "Earlier requests on this level (click to reuse). The latest ones go into the next prompt.";
      this.history.append(title);
      for (const e of [...entries].reverse()) {
        const line = document.createElement("div");
        line.className = `hist ${e.outcome}`;
        line.textContent = `${MARK[e.outcome] ?? "?"} ${e.instruction}`;
        line.title = `${e.outcome}${e.detail ? `: ${e.detail}` : ""}${e.rows ? ` · rows ${pad3(e.rows[0])}-${pad3(e.rows[1])}` : ""}`;
        line.addEventListener("click", () => ((this.q("ask-text") as HTMLTextAreaElement).value = e.instruction));
        this.history.append(line);
      }
    } catch { /* ignore */ }
  }

  /** Called by the editor whenever its state changes. */
  render() {
    const sel = this.ed.selection;
    this.q("ask-sel").textContent = sel ? `rows ${pad3(sel[0])} to ${pad3(sel[1])} (drag on the row numbers)` : "whole map (drag on the row numbers to limit it)";
    const busy = this.abort !== null;
    const go = this.q<HTMLButtonElement>("ask-go");
    go.innerHTML = busy ? "Cancel" : "Ask <kbd>⌘↵</kbd>";
    go.disabled = !busy && !!this.ed.proposal;
    this.result.replaceChildren();
    const p = this.ed.proposal;
    if (p) this.showProposal(p);
    else if (this.lastMessage) this.result.append(this.lastMessage);
  }

  private lastMessage: HTMLElement | null = null;

  private say(kind: "error" | "warn" | "info", lines: string[]) {
    const div = document.createElement("div");
    div.className = `msg ${kind}`;
    div.textContent = lines.join("\n");
    this.lastMessage = div;
    this.render();
  }

  private showProposal(p: ClientProposal) {
    const box = document.createElement("div");
    box.className = "msg info";
    const text = document.createElement("div");
    text.textContent = `${p.summary}\n${p.changed.terrain} terrain + ${p.changed.units} unit cells changed in rows ${pad3(p.rows[0])}-${pad3(p.rows[1])} · ${p.backend}, ${(p.ms / 1000).toFixed(0)}s${p.attempts > 1 ? `, took ${p.attempts} attempts` : ""}${p.warnings.length ? `\nnote: ${p.warnings.join("; ")}` : ""}`;
    text.style.whiteSpace = "pre-wrap";
    const buttons = document.createElement("div");
    buttons.className = "row";
    const accept = button("Accept", () => this.ed.acceptProposal(), "primary");
    const reject = button("Reject", () => this.ed.rejectProposal());
    const peek = button("Hold to see original", () => {});
    peek.addEventListener("pointerdown", () => this.ed.peek(true));
    for (const ev of ["pointerup", "pointerleave"]) peek.addEventListener(ev, () => this.ed.peek(false));
    buttons.append(accept, reject, peek);
    box.append(text);
    if (p.message) {
      const note = document.createElement("div");
      note.className = "agent-msg";
      note.textContent = `Agent's message: ${p.message}`;
      box.append(note);
    }
    box.append(buttons);
    this.result.append(box);
  }

  // ---------------------------------------------------------------- actions

  private selectGameView() {
    const scene = this.ed.game.scene.getScene("game") as unknown as { cameras: { main: { scrollY: number } } } | null;
    const level = this.ed.level;
    if (!scene || !level) return;
    const top = Math.max(0, Math.floor(scene.cameras.main.scrollY / 64));
    this.ed.setSelection([top, Math.min(level.height - 1, top + 12)]);
  }

  private async go() {
    if (this.abort) {
      this.abort.abort(); // the server stops the agent when the request is dropped
      return;
    }
    const level = this.ed.level;
    if (!level || this.ed.proposal) return;
    const instruction = (this.q("ask-text") as HTMLTextAreaElement).value.trim();
    if (!instruction) return this.say("warn", ["Write what you want first."]);
    const layers = (["terrain", "units"] as const).filter((l) => (this.q(`ask-${l}`) as HTMLInputElement).checked);
    if (!layers.length) return this.say("warn", ["Allow at least one of terrain or units."]);
    const select = this.q<HTMLSelectElement>("ask-backend");
    const backend = select.value;
    const backendLabel = select.selectedOptions[0]?.textContent ?? backend;
    const model = (this.q("ask-model") as HTMLInputElement).value.trim();
    localStorage.setItem("commando.askModel", model);

    this.abort = new AbortController();
    this.lastMessage = null;
    const rows = this.ed.selection ? this.ed.selection[1] - this.ed.selection[0] + 1 : level.height;
    this.live.start(backend, backendLabel, model, rows);
    this.ed.setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        signal: this.abort.signal,
        body: JSON.stringify({ level: store.levelName, levelText: this.ed.levelText(), instruction, rows: this.ed.selection, layers, backend, model }),
      });
      // The dev server streams one JSON object per line while the agent works; the last one is the result.
      // Errors before the agent starts (nothing typed, CLI not installed) come back as plain JSON.
      const body = (res.headers.get("content-type") ?? "").includes("ndjson") ? await this.readEvents(res) : await res.json();
      if (body.ok) {
        this.live.finish("✓ Proposal ready: look at the map, then Accept or Reject.");
        this.ed.setProposal(body as ClientProposal);
      } else if (body.message) {
        this.live.finish("⚠ The agent sent a message instead of a change.");
        this.say("warn", ["The agent made no change. Its message:", body.message, "", "Saved to data/agent-messages.md for a coding session."]);
      } else {
        this.live.finish("✗ No usable answer.");
        this.say("error", ["No usable answer:", ...(body.errors ?? ["unknown error"]), ...(body.attempts ? [`(tried ${body.attempts} times)`] : [])]);
      }
    } catch (e) {
      const cancelled = (e as Error).name === "AbortError";
      this.live.finish(cancelled ? "Cancelled: the agent was stopped." : `✗ ${(e as Error).message}`);
      if (cancelled) this.say("info", ["Cancelled."]);
      else this.say("error", [(e as Error).message]);
    } finally {
      this.abort = null;
      this.ed.setBusy(false);
      void this.loadHistory();
    }
  }

  private async readEvents(res: Response): Promise<any> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: any = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "result") result = ev;
        else this.live.event(ev);
      }
    }
    return result ?? { ok: false, errors: ["the dev server stopped before answering"] };
  }
}

// What the agent is doing, shown while you wait: a timer, the steps, the exact prompt, and the reply as it
// streams in (Claude) or the steps the CLI reports (Codex). Afterwards it folds away and stays readable.
class LiveView {
  private root: HTMLDetailsElement;
  private started = 0;
  private timer = 0;
  private label = "";
  private writing = new Set<number>();
  private thinking = new Set<number>();
  private activities = 0;
  private rows = 0;
  private attemptText = "";

  constructor(private q: (id: string) => HTMLElement) {
    this.root = q("ask-live") as HTMLDetailsElement;
  }

  start(backend: string, label: string, model: string, rows: number) {
    this.label = label;
    this.rows = rows;
    this.started = Date.now();
    this.writing.clear();
    this.thinking.clear();
    this.activities = 0;
    this.attemptText = "";
    this.bar(null);
    this.q("live-steps").replaceChildren();
    this.q("live-prompt").textContent = "";
    this.q("live-prompt-sum").textContent = "Prompt sent";
    this.q("live-out").textContent = "";
    this.q("live-hint").textContent = `${typical(backend, model)}${rows > 30 ? " Fewer rows is faster too: drag on the row numbers." : ""} You can keep playing; Cancel stops the agent.`;
    this.title(`Waiting for ${label}…`);
    this.root.hidden = false;
    this.root.open = true;
    this.root.classList.add("running");
    this.tick();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  event(ev: { type: string; attempt: number; chars?: number; ms?: number; prompt?: string; text?: string; reply?: string; problems?: string[] }) {
    const n = ev.attempt;
    if (ev.type === "prompt") {
      this.step(n === 1 ? `Prompt built (${ev.chars!.toLocaleString()} characters) and sent to ${this.label}.` : `Asking again, attempt ${n} of 3, with the problems added to the prompt.`);
      this.q("live-prompt-sum").textContent = `Prompt sent${n > 1 ? ` (attempt ${n})` : ""}: ${ev.chars!.toLocaleString()} characters`;
      this.q("live-prompt").textContent = ev.prompt ?? "";
      if (n > 1) this.append(`\n\n--- attempt ${n} ---\n`);
      this.attemptText = "";
      this.bar(null);
      this.title(`Waiting for ${this.label}…`);
    } else if (ev.type === "activity") {
      if (this.activities++ < 12) this.step(ev.text!);
    } else if (ev.type === "thinking") {
      if (!this.thinking.has(n)) {
        this.thinking.add(n);
        this.step(`${this.label} is thinking first (its thoughts aren't shown, only how much).`);
      }
      this.title(`${this.label} is thinking… ~${Number(ev.text).toLocaleString()} tokens`);
    } else if (ev.type === "output") {
      if (!this.writing.has(n)) {
        this.writing.add(n);
        this.step(`${this.label} is writing its answer.`);
      }
      this.append(ev.text!);
      this.attemptText += ev.text!;
      // Both grids come back with numbered rows, so counting them gives real progress.
      const expected = this.rows * 2;
      const done = Math.min(expected, (this.attemptText.match(/^\s*\d{3} /gm) ?? []).length);
      this.title(done ? `${this.label} is writing… ${done} of ${expected} rows` : `${this.label} is writing…`);
      if (done) this.bar(done / expected);
    } else if (ev.type === "reply") {
      this.step(`Reply received: ${ev.chars!.toLocaleString()} characters after ${Math.round(ev.ms! / 1000)} s. Checking it…`);
      if (!this.writing.has(n)) this.append(ev.reply ?? ""); // nothing streamed (Codex): show the whole reply now
      this.bar(null);
      this.title("Checking the reply…");
    } else if (ev.type === "problems") {
      const p = ev.problems ?? [];
      this.step(`✗ The checks found ${p.length} problem${p.length === 1 ? "" : "s"}: ${p.slice(0, 2).join("; ")}${p.length > 2 ? "; …" : ""}`);
    }
  }

  finish(outcome: string) {
    clearInterval(this.timer);
    this.step(outcome);
    this.root.classList.remove("running");
    this.title(`How this answer was made (${this.seconds()} s)`);
    this.q("live-secs").textContent = "";
    this.root.open = false;
  }

  private seconds = () => Math.round((Date.now() - this.started) / 1000);
  private tick = () => (this.q("live-secs").textContent = `${this.seconds()} s`);
  private title = (text: string) => (this.q("live-title").textContent = text);

  /** null = an animated bar (no idea how far along), a number = how much of the reply has arrived. */
  private bar(fraction: number | null) {
    const fill = this.root.querySelector<HTMLElement>(".live-bar div")!;
    this.root.classList.toggle("measured", fraction !== null);
    fill.style.width = fraction === null ? "" : `${Math.round(fraction * 100)}%`;
  }

  private step(text: string) {
    const li = document.createElement("li");
    li.textContent = text;
    this.q("live-steps").append(li);
  }

  private append(text: string) {
    const out = this.q("live-out");
    out.textContent = (out.textContent + text).slice(-8000);
    out.scrollTop = out.scrollHeight;
  }
}

function typical(backend: string, model: string) {
  if (backend === "claude") return model ? `Usually 15 to 40 seconds with ${model}.` : "Usually 30 to 90 seconds with Claude's default model; sonnet is faster (type it in the model box).";
  if (backend === "codex") return "Usually 40 to 120 seconds. Codex sends its answer in one piece at the end.";
  return "Usually 15 to 60 seconds.";
}

function button(label: string, onClick: () => void, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", () => { onClick(); b.blur(); });
  return b;
}
