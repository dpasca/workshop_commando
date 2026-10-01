import type Phaser from "phaser";
import { parseEnemies, serializeEnemies, type EnemyTypes } from "../data/enemies";
import { DataError } from "../data/errors";
import { checkLevel, summarize } from "../data/check";
import { blankLevel, cloneGrid, EMPTY, parseLevel, serializeLevel, type Grid, type LevelData } from "../data/level";
import { store, type World } from "../data/store";
import { AskPanel, type ClientProposal } from "./askPanel";
import { drawTerrain, drawUnit, imageLoaded } from "./draw";
import { EnemyForm } from "./enemyForm";
import { CELL, MapView } from "./mapView";

type Layer = "terrain" | "units";
type Snapshot = { terrain: Grid; units: Grid };

const HTML = `
<div class="ed-head">
  <select id="ed-level" title="level file in data/levels/"></select>
  <button id="ed-new">New…</button>
  <span id="ed-status" class="pill"></span>
</div>
<div class="ed-bar">
  <button id="ed-save" class="primary" title="write the files; the game reloads">Save <kbd>⌘S</kbd></button>
  <button id="ed-revert" title="throw away unsaved edits and reload from disk">Revert</button>
  <button id="ed-undo" title="⌘Z">Undo</button>
  <button id="ed-redo" title="⇧⌘Z">Redo</button>
  <button id="ed-play" title="restart the game from the orange row (click a row number), or from the bottom">Play here</button>
</div>
<div id="ed-msg"></div>
<div class="ed-tabs">
  <button data-tab="map" class="on">Map</button>
  <button data-tab="enemies">Enemies</button>
  <span class="hint">Tab hides this panel</span>
</div>
<section id="tab-map">
  <div class="row">
    <div class="seg"><button data-layer="terrain" class="on">Terrain</button><button data-layer="units">Units</button></div>
    <span id="ed-hover" class="hint"></span>
  </div>
  <div id="ed-palette"></div>
  <div class="hint">paint: click / drag · rectangle: shift + drag · pick: right-click · start row: click a row number · rows for the agent: drag on the row numbers</div>
  <div id="ed-check"></div>
  <div id="ed-map"></div>
</section>
<section id="tab-enemies" hidden></section>
`;

// The level editor panel. It edits copies of what is on disk; Save writes the TOML files through the
// dev server, and the game (and this panel) pick the change up from the file watcher. That means files
// changed by anything else, such as an agent or a text editor, arrive the same way.
export class Editor {
  level: LevelData | null = null;
  enemies: EnemyTypes | null = null;
  layer: Layer = "terrain";
  private brushes: Record<Layer, string> = { terrain: "rd", units: "s1" };

  private dirtyLevel = false;
  private dirtyEnemies = false;
  private baseLevelText = "";
  private baseEnemiesText = "";
  private syncedWorld: World | null = null;
  private lastSaved = "";
  private conflicts = new Set<"level" | "enemies">();
  private problems: string[] = [];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Rows the agent may change (null = all). */
  selection: [number, number] | null = null;
  proposal: ClientProposal | null = null;
  private busy = false;
  private peeking = false;
  private changedCells = new Set<string>();
  private shownCache: { proposal: ClientProposal; level: LevelData } | null = null;

  private map: MapView;
  private form: EnemyForm;
  private ask: AskPanel;
  private el = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;

  constructor(readonly game: Phaser.Game, private root: HTMLElement) {
    root.innerHTML = HTML;
    this.map = new MapView(this, this.el("ed-map"), this.el("ed-hover"));
    this.form = new EnemyForm(this, this.el("tab-enemies"));
    this.ask = new AskPanel(this, this.el("tab-map"));
    void this.ask.loadHistory();

    const on = (id: string, fn: () => void) =>
      this.el(id).addEventListener("click", (e) => {
        fn();
        (e.currentTarget as HTMLElement).blur();
      });
    on("ed-save", () => void this.save());
    on("ed-revert", () => this.revert());
    on("ed-undo", () => this.undo());
    on("ed-redo", () => this.redo());
    on("ed-play", () => this.play());
    on("ed-new", () => void this.newLevel());
    this.el("ed-level").addEventListener("change", (e) => void this.switchLevel((e.target as HTMLSelectElement).value));

    root.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        root.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
        this.el("tab-map").hidden = b.dataset.tab !== "map";
        this.el("tab-enemies").hidden = b.dataset.tab !== "enemies";
        b.blur();
        this.renderAll();
      }),
    );
    root.querySelectorAll<HTMLElement>("[data-layer]").forEach((b) =>
      b.addEventListener("click", () => {
        this.layer = b.dataset.layer as Layer;
        root.querySelectorAll("[data-layer]").forEach((x) => x.classList.toggle("on", x === b));
        b.blur();
        this.renderAll();
      }),
    );

    // Keys typed into the panel must not reach the game (WASD would walk the player).
    root.addEventListener("keydown", (e) => {
      this.shortcuts(e);
      if (isTyping(e.target)) e.stopPropagation();
    });
    window.addEventListener("keydown", (e) => {
      if (!root.contains(e.target as Node)) this.shortcuts(e);
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.dirtyLevel || this.dirtyEnemies) e.preventDefault();
    });

    imageLoaded.addEventListener("load", () => this.renderAll());
    store.on(() => this.onStore());
    this.onStore();
    void this.refreshLevelList();
  }

  // ---------------------------------------------------------------- model

  /** Adopts what the store has, unless there are unsaved edits (then it says so and lets you choose). */
  private onStore() {
    this.problems = store.errors;
    const world = store.world;
    if (world && world !== this.syncedWorld) {
      const first = this.syncedWorld === null;
      this.syncedWorld = world;
      if (first || store.enemiesText !== this.baseEnemiesText) {
        if (this.dirtyEnemies && !first) this.conflicts.add("enemies");
        else this.loadEnemies(world);
      }
      if (first || store.levelText !== this.baseLevelText) {
        if (this.dirtyLevel && !first) this.conflicts.add("level");
        else this.loadLevel(world);
      }
    }
    void this.refreshLevelList();
    this.renderAll();
  }

  private loadEnemies(world: World) {
    this.enemies = structuredClone(world.enemies);
    this.baseEnemiesText = store.enemiesText;
    this.dirtyEnemies = false;
    this.conflicts.delete("enemies");
    this.lastSaved = "";
  }

  private loadLevel(world: World) {
    this.level = structuredClone(world.level);
    this.baseLevelText = store.levelText;
    this.dirtyLevel = false;
    this.conflicts.delete("level");
    this.lastSaved = "";
    this.undoStack = [];
    this.redoStack = [];
    this.proposal = null;
    if (this.selection) this.selection = [Math.min(this.selection[0], this.level.height - 1), Math.min(this.selection[1], this.level.height - 1)];
    void this.ask?.loadHistory();
  }

  private revert() {
    if (!store.world) return;
    this.loadEnemies(store.world);
    this.loadLevel(store.world);
    this.lastSaved = "";
    this.renderAll();
  }

  markLevelDirty() {
    this.dirtyLevel = true;
    this.renderAll();
  }

  markEnemiesDirty() {
    this.dirtyEnemies = true;
    this.updateStatus();
    this.map.schedule();
    this.renderPalette();
  }

  // ---------------------------------------------------------------- painting

  private get grid(): Grid {
    return this.level![this.layer];
  }

  /** Sets one cell to the selected brush. Returns true if it changed. */
  paint(r: number, c: number): boolean {
    const level = this.level!;
    if (this.proposal || this.busy) return false; // finish with the agent's answer first
    const code = this.brushes[this.layer];
    if (this.grid[r][c] === code) return false;
    const fp = this.enemies?.[code]?.footprint;
    if (this.layer === "units" && fp && (c + fp[0] > level.width || r + fp[1] > level.height)) return false; // would run off the map
    this.grid[r][c] = code;
    return true;
  }

  pick(r: number, c: number) {
    this.brushes[this.layer] = this.grid[r][c];
    this.renderPalette();
  }

  describe(r: number, c: number) {
    const level = this.level!;
    const t = level.terrain[r][c], u = level.units[r][c];
    const name = (code: string) => level.legendTerrain[code] ?? level.legendPickups[code] ?? this.enemies?.[code]?.name ?? "?";
    const pad = (n: number) => String(n).padStart(3, "0");
    return `row ${pad(r)} col ${String(c).padStart(2, "0")} · ${t} ${name(t).split(":")[0]}${u !== EMPTY ? ` · ${u} ${name(u).split(":")[0]}` : ""}`;
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  discardUndo() {
    this.undoStack.pop();
  }

  private snapshot(): Snapshot {
    return { terrain: cloneGrid(this.level!.terrain), units: cloneGrid(this.level!.units) };
  }

  private undo() {
    const prev = this.undoStack.pop();
    if (!prev || !this.level) return;
    this.redoStack.push(this.snapshot());
    Object.assign(this.level, prev);
    this.markLevelDirty();
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next || !this.level) return;
    this.undoStack.push(this.snapshot());
    Object.assign(this.level, next);
    this.markLevelDirty();
  }

  // ---------------------------------------------------------------- asking an agent

  levelText() {
    return serializeLevel(this.level!);
  }

  setSelection(sel: [number, number] | null) {
    this.selection = sel;
    this.ask.render();
    this.map.schedule();
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.renderAll();
  }

  /** The level as it would be after accepting the agent's proposal (or as it is, with no proposal). */
  get shown(): LevelData | null {
    if (!this.level || !this.proposal || this.peeking) return this.level;
    if (this.shownCache?.proposal === this.proposal) return this.shownCache.level;
    const level = structuredClone(this.level);
    const p = this.proposal;
    p.terrain.forEach((row, i) => (level.terrain[p.rows[0] + i] = row));
    p.units.forEach((row, i) => (level.units[p.rows[0] + i] = row));
    this.shownCache = { proposal: p, level };
    return level;
  }

  isChanged(r: number, c: number) {
    return !this.peeking && this.changedCells.has(`${r},${c}`);
  }

  setProposal(p: ClientProposal) {
    this.proposal = p;
    this.changedCells.clear();
    for (const layer of ["terrain", "units"] as const) {
      p[layer].forEach((row, i) => row.forEach((code, c) => code !== this.level![layer][p.rows[0] + i][c] && this.changedCells.add(`${p.rows[0] + i},${c}`)));
    }
    const first = Math.min(...[...this.changedCells].map((k) => Number(k.split(",")[0])), p.rows[0]);
    this.root.scrollTop = this.el("ed-map").offsetTop + first * CELL - 120;
    this.renderAll();
  }

  peek(on: boolean) {
    this.peeking = on;
    this.map.schedule();
    this.renderCheck();
  }

  acceptProposal() {
    const p = this.proposal;
    if (!p || !this.level) return;
    this.pushUndo();
    p.terrain.forEach((row, i) => (this.level!.terrain[p.rows[0] + i] = row.slice()));
    p.units.forEach((row, i) => (this.level!.units[p.rows[0] + i] = row.slice()));
    this.proposal = null;
    void this.reportOutcome(p.id, "accepted");
    this.markLevelDirty();
  }

  rejectProposal() {
    const p = this.proposal;
    if (!p) return;
    this.proposal = null;
    this.peeking = false;
    void this.reportOutcome(p.id, "rejected");
    this.renderAll();
  }

  private async reportOutcome(id: string, outcome: "accepted" | "rejected") {
    await fetch("/api/ask/outcome", { method: "POST", body: JSON.stringify({ id, outcome }) }).catch(() => {});
    void this.ask.loadHistory();
  }

  private renderCheck() {
    const box = this.el("ed-check");
    const level = this.shown;
    if (!level || !this.enemies) return box.replaceChildren();
    const r = checkLevel(level, this.enemies);
    box.className = r.errors.length ? "check bad" : "check ok";
    box.replaceChildren();
    const head = document.createElement("div");
    head.textContent = `${r.errors.length ? "✗" : "✓"} ${summarize(r)}${this.proposal && !this.peeking ? " (with the agent's change)" : ""}`;
    box.append(head);
    for (const line of [...r.errors.map((e) => `error: ${e}`), ...r.warnings.map((w) => `warning: ${w}`)].slice(0, 5)) {
      const d = document.createElement("div");
      d.className = "issue";
      d.textContent = line;
      box.append(d);
    }
  }

  // ---------------------------------------------------------------- saving

  async save() {
    if (!this.level || !this.enemies) return;
    if (!this.dirtyLevel && !this.dirtyEnemies) return this.flash("nothing to save");
    // Enemies first: the level is validated against them.
    if (this.dirtyEnemies) {
      const text = serializeEnemies(this.enemies);
      const errors = await this.write("/api/enemies", text, () => parseEnemies(text));
      if (errors.length) return this.saveFailed(errors);
      this.baseEnemiesText = text;
      this.dirtyEnemies = false;
      this.conflicts.delete("enemies");
    }
    if (this.dirtyLevel) {
      const text = serializeLevel(this.level);
      const enemies = this.enemies;
      const errors = await this.write(`/api/level/${store.levelName}`, text, () => parseLevel(text, enemies));
      if (errors.length) return this.saveFailed(errors);
      this.baseLevelText = text;
      this.dirtyLevel = false;
      this.conflicts.delete("level");
    }
    this.lastSaved = `saved ${new Date().toLocaleTimeString()}`;
    this.saveErrors = [];
    this.renderAll();
  }

  private saveErrors: string[] = [];

  private saveFailed(errors: string[]) {
    this.saveErrors = errors;
    this.renderAll();
  }

  /** Checks the text locally (instant, same rules as the server), then writes it. */
  private async write(url: string, text: string, check: () => void): Promise<string[]> {
    try {
      check();
    } catch (e) {
      return e instanceof DataError ? e.problems : [(e as Error).message];
    }
    try {
      return await store.put(url, text);
    } catch (e) {
      return [`could not reach the dev server: ${(e as Error).message}`];
    }
  }

  // ---------------------------------------------------------------- levels

  private async refreshLevelList() {
    try {
      const { levels } = (await (await fetch("/api/levels", { cache: "no-store" })).json()) as { levels: string[] };
      const select = this.el("ed-level") as HTMLSelectElement;
      select.innerHTML = levels.map((l) => `<option ${l === store.levelName ? "selected" : ""}>${l}</option>`).join("");
    } catch {
      /* the server is not up yet; the next change refreshes it */
    }
  }

  private confirmDiscard() {
    return !(this.dirtyLevel || this.dirtyEnemies) || confirm("You have unsaved edits. Discard them?");
  }

  private async switchLevel(name: string) {
    if (!this.confirmDiscard()) return this.refreshLevelList();
    this.dirtyLevel = this.dirtyEnemies = false;
    this.baseLevelText = "";
    await store.switchLevel(name);
  }

  private async newLevel() {
    if (!this.confirmDiscard()) return;
    const name = (prompt("Name of the new level (a-z, 0-9, _ or -)") ?? "").trim().toLowerCase();
    if (!name) return;
    const title = name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    const errors = await store.put(`/api/level/${name}`, serializeLevel(blankLevel(title)));
    if (errors.length) return this.saveFailed(errors);
    await this.switchLevel(name);
  }

  private play() {
    // the game restarts by itself when files change; this restarts it without saving
    this.game.scene.getScene("game")?.scene.restart();
    // bring the part of the map the game is about to show into view
    const row = store.startRow ?? (this.level?.height ?? 1) - 1;
    this.root.scrollTop = this.el("ed-map").offsetTop + row * CELL - 220;
  }

  // ---------------------------------------------------------------- shortcuts

  private shortcuts(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const typing = isTyping(e.target);
    if (mod && e.key === "s") {
      e.preventDefault();
      void this.save();
    } else if (mod && e.key === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (e.key === "Tab" && !typing) {
      e.preventDefault();
      this.root.classList.toggle("collapsed");
      window.dispatchEvent(new Event("resize")); // let Phaser refit the canvas
    }
  }

  // ---------------------------------------------------------------- rendering

  private flash(text: string) {
    this.lastSaved = text;
    this.updateStatus();
  }

  renderAll() {
    this.updateStatus();
    this.renderMessages();
    this.renderPalette();
    this.renderCheck();
    this.ask.render();
    this.map.schedule();
    if (!this.el("tab-enemies").hidden) this.form.refresh();
    (this.root.querySelector("#ed-undo") as HTMLButtonElement).disabled = !this.undoStack.length;
    (this.root.querySelector("#ed-redo") as HTMLButtonElement).disabled = !this.redoStack.length;
  }

  updateStatus() {
    const pill = this.el("ed-status");
    const dirty = this.dirtyLevel || this.dirtyEnemies;
    pill.textContent = dirty ? "unsaved changes" : this.lastSaved || "in sync with disk";
    pill.className = `pill ${dirty ? "warn" : "ok"}`;
    const row = store.startRow;
    this.el("ed-play").textContent = row === null ? "Play here" : `Play from row ${String(row).padStart(3, "0")}`;
  }

  private renderMessages() {
    const box = this.el("ed-msg");
    box.replaceChildren();
    const add = (kind: string, lines: string[], action?: [string, () => void]) => {
      const div = document.createElement("div");
      div.className = `msg ${kind}`;
      div.textContent = lines.join("\n");
      if (action) {
        const b = document.createElement("button");
        b.textContent = action[0];
        b.addEventListener("click", () => { action[1](); b.blur(); });
        div.append(b);
      }
      box.append(div);
    };
    if (this.saveErrors.length) add("error", ["Not saved:", ...this.saveErrors]);
    if (this.problems.length) add("error", ["The files on disk are not valid, so the game keeps running the last good version:", ...this.problems]);
    for (const what of this.conflicts) {
      add("warn", [`The ${what} changed on disk while you had unsaved edits. Saving will overwrite it.`], [
        "Load from disk (discard mine)",
        () => { if (store.world) (what === "level" ? this.loadLevel(store.world) : this.loadEnemies(store.world)); this.renderAll(); },
      ]);
    }
  }

  private renderPalette() {
    const level = this.level;
    const host = this.el("ed-palette");
    host.replaceChildren();
    if (!level) return;
    const entries: [string, string][] =
      this.layer === "terrain"
        ? Object.entries(level.legendTerrain)
        : [[EMPTY, "nothing (eraser)"], ...Object.entries(this.enemies ?? {}).map(([c, t]) => [c, t.name] as [string, string]), ...Object.entries(level.legendPickups)];
    for (const [code, name] of entries) {
      const b = document.createElement("button");
      b.className = `pal${this.brushes[this.layer] === code ? " on" : ""}`;
      b.title = `${code}: ${name}`;
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const ctx = c.getContext("2d")!;
      if (this.layer === "terrain") drawTerrain(ctx, code, 0, 0, 32);
      else {
        ctx.fillStyle = "#2a8f4f";
        ctx.fillRect(0, 0, 32, 32);
        if (code === EMPTY) {
          ctx.strokeStyle = "#f66";
          ctx.lineWidth = 3;
          ctx.strokeRect(6, 6, 20, 20);
          ctx.beginPath();
          ctx.moveTo(6, 6); ctx.lineTo(26, 26); ctx.moveTo(26, 6); ctx.lineTo(6, 26);
          ctx.stroke();
        } else drawUnit(ctx, code, this.enemies ?? {}, 0, 0, 32);
      }
      const label = document.createElement("span");
      label.textContent = code;
      b.append(c, label);
      b.addEventListener("click", () => {
        this.brushes[this.layer] = code;
        this.renderPalette();
        b.blur();
      });
      host.append(b);
    }
  }
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

export function initEditor(game: Phaser.Game) {
  const editor = new Editor(game, document.getElementById("editor")!);
  if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = editor;
  return editor;
}
