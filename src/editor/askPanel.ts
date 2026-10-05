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
  private timer = 0;
  private result: HTMLElement;
  private history: HTMLElement;

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
      <div class="row"><button id="ask-go" class="primary">Ask <kbd>⌘↵</kbd></button><span id="ask-status" class="hint"></span></div>
      <div id="ask-result"></div>
      <div id="ask-history"></div>`;
    host.prepend(this.root);
    this.result = this.q("ask-result");
    this.history = this.q("ask-history");

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
    const backend = this.q<HTMLSelectElement>("ask-backend").value;
    const model = (this.q("ask-model") as HTMLInputElement).value.trim();
    localStorage.setItem("commando.askModel", model);

    this.abort = new AbortController();
    this.lastMessage = null;
    const started = Date.now();
    this.q("ask-status").textContent = "waiting for the agent… 0s (you can keep playing)";
    this.timer = window.setInterval(() => (this.q("ask-status").textContent = `waiting for the agent… ${Math.round((Date.now() - started) / 1000)}s (you can keep playing)`), 1000);
    this.ed.setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        signal: this.abort.signal,
        body: JSON.stringify({ level: store.levelName, levelText: this.ed.levelText(), instruction, rows: this.ed.selection, layers, backend, model }),
      });
      const body = await res.json();
      if (body.ok) this.ed.setProposal(body as ClientProposal);
      else if (body.message) this.say("warn", ["The agent made no change. Its message:", body.message, "", "Saved to data/agent-messages.md for a coding session."]);
      else this.say("error", ["No usable answer:", ...(body.errors ?? ["unknown error"]), ...(body.attempts ? [`(tried ${body.attempts} times)`] : [])]);
    } catch (e) {
      if ((e as Error).name === "AbortError") this.say("info", ["Cancelled."]);
      else this.say("error", [(e as Error).message]);
    } finally {
      clearInterval(this.timer);
      this.abort = null;
      this.q("ask-status").textContent = "";
      this.ed.setBusy(false);
      void this.loadHistory();
    }
  }
}

function button(label: string, onClick: () => void, cls = "") {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", () => { onClick(); b.blur(); });
  return b;
}
