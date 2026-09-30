import { TILE, VIEW_H } from "../config";
import { EMPTY, LEVEL_WIDTH } from "../data/level";
import { store } from "../data/store";
import { drawTerrain, drawUnit } from "./draw";
import type { Editor } from "./editor";

export const CELL = 24;
export const RULER = 40;

const pad3 = (n: number) => String(n).padStart(3, "0");

// The map as a canvas: paint terrain or units with the mouse.
//   click / drag       paint with the selected palette entry
//   shift + drag       fill a rectangle
//   right-click / alt  pick what is under the cursor
//   click a row number choose where "Play here" starts (click again to clear)
export class MapView {
  readonly canvas = document.createElement("canvas");
  private live = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private liveCtx = this.live.getContext("2d")!;
  private drag: { rect: boolean; start: [number, number]; cur: [number, number]; changed: boolean } | null = null;
  private pending = false;

  constructor(private ed: Editor, host: HTMLElement, private hover: HTMLElement) {
    const wrap = document.createElement("div");
    wrap.className = "map-wrap";
    this.live.className = "map-live";
    wrap.append(this.canvas, this.live);
    host.append(wrap);

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    this.canvas.addEventListener("pointerup", (e) => this.up(e));
    this.canvas.addEventListener("pointerleave", () => (this.hover.textContent = ""));
    setInterval(() => this.drawLive(), 150);
  }

  /** Coalesces redraw requests into one per frame. */
  schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  private cell(e: PointerEvent): { r: number; c: number; ruler: boolean } {
    const box = this.canvas.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const level = this.ed.level!;
    return {
      r: Math.max(0, Math.min(level.height - 1, Math.floor(y / CELL))),
      c: Math.max(0, Math.min(LEVEL_WIDTH - 1, Math.floor((x - RULER) / CELL))),
      ruler: x < RULER,
    };
  }

  private down(e: PointerEvent) {
    const level = this.ed.level;
    if (!level) return;
    const { r, c, ruler } = this.cell(e);
    if (ruler) {
      store.startRow = store.startRow === r ? null : r;
      this.ed.updateStatus();
      return this.render();
    }
    if (e.button === 2 || e.altKey) return this.ed.pick(r, c);
    if (e.button !== 0) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer: nothing to capture */ }
    this.ed.pushUndo();
    this.drag = { rect: e.shiftKey, start: [r, c], cur: [r, c], changed: false };
    if (!e.shiftKey) this.drag.changed = this.ed.paint(r, c);
    this.render();
  }

  private move(e: PointerEvent) {
    const level = this.ed.level;
    if (!level) return;
    const { r, c, ruler } = this.cell(e);
    this.hover.textContent = ruler ? `row ${pad3(r)}: click to start playing from here` : this.ed.describe(r, c);
    if (!this.drag) return;
    const [pr, pc] = this.drag.cur;
    if (pr === r && pc === c) return;
    if (!this.drag.rect) {
      // fill the gap if the mouse skipped cells
      const steps = Math.max(Math.abs(r - pr), Math.abs(c - pc));
      for (let i = 1; i <= steps; i++) {
        const rr = Math.round(pr + ((r - pr) * i) / steps), cc = Math.round(pc + ((c - pc) * i) / steps);
        if (this.ed.paint(rr, cc)) this.drag.changed = true;
      }
    }
    this.drag.cur = [r, c];
    this.render();
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* as above */ }
    if (d.rect) {
      const [r0, c0] = d.start, [r1, c1] = d.cur;
      for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
        for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) if (this.ed.paint(r, c)) d.changed = true;
      }
    }
    if (d.changed) this.ed.markLevelDirty();
    else this.ed.discardUndo();
    this.render();
  }

  render() {
    const level = this.ed.level;
    if (!level) return;
    const enemies = this.ed.enemies ?? {};
    const { canvas, ctx } = this;
    const w = RULER + LEVEL_WIDTH * CELL, h = level.height * CELL;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = this.live.width = w;
      canvas.height = this.live.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = "alphabetic";

    // ruler
    ctx.fillStyle = "#15191d";
    ctx.fillRect(0, 0, RULER, h);
    ctx.font = "11px Menlo, monospace";
    for (let r = 0; r < level.height; r++) {
      const isStart = store.startRow === r;
      if (isStart) {
        ctx.fillStyle = "#e08a1e";
        ctx.fillRect(0, r * CELL, RULER, CELL);
      }
      ctx.fillStyle = isStart ? "#111" : r % 10 === 0 ? "#e8e8e8" : "#7c8791";
      ctx.fillText((isStart ? "▶" : "") + pad3(r), 4, r * CELL + 16);
    }

    // terrain, then units on top (dimmed while editing terrain)
    for (let r = 0; r < level.height; r++) {
      for (let c = 0; c < LEVEL_WIDTH; c++) drawTerrain(ctx, level.terrain[r][c], RULER + c * CELL, r * CELL, CELL);
    }
    ctx.globalAlpha = this.ed.layer === "units" ? 1 : 0.6;
    for (const multi of [false, true]) {
      for (let r = 0; r < level.height; r++) {
        for (let c = 0; c < LEVEL_WIDTH; c++) {
          const code = level.units[r][c];
          if (code === EMPTY) continue;
          const fp = enemies[code]?.footprint;
          if ((fp && (fp[0] > 1 || fp[1] > 1)) === multi) drawUnit(ctx, code, enemies, RULER + c * CELL, r * CELL, CELL);
        }
      }
    }
    ctx.globalAlpha = 1;

    // grid
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= LEVEL_WIDTH; c++) {
      ctx.moveTo(RULER + c * CELL + 0.5, 0);
      ctx.lineTo(RULER + c * CELL + 0.5, h);
    }
    for (let r = 0; r <= level.height; r++) {
      ctx.moveTo(RULER, r * CELL + 0.5);
      ctx.lineTo(w, r * CELL + 0.5);
    }
    ctx.stroke();

    // rectangle being dragged
    if (this.drag?.rect) {
      const [r0, c0] = this.drag.start, [r1, c1] = this.drag.cur;
      ctx.strokeStyle = "#ffd24a";
      ctx.lineWidth = 2;
      ctx.strokeRect(RULER + Math.min(c0, c1) * CELL, Math.min(r0, r1) * CELL, (Math.abs(c1 - c0) + 1) * CELL, (Math.abs(r1 - r0) + 1) * CELL);
    }
  }

  /** The part of the level the game is showing right now, and the player. */
  private drawLive() {
    const ctx = this.liveCtx;
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    const scene = this.ed.game.scene.getScene("game") as unknown as { sys: { isActive(): boolean }; cameras: { main: { scrollY: number } }; player?: { x: number; y: number; alive: boolean } };
    if (!scene?.sys.isActive() || !scene.player) return;
    const top = (scene.cameras.main.scrollY / TILE) * CELL;
    ctx.strokeStyle = "#5ad1ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(RULER + 1, top + 1, LEVEL_WIDTH * CELL - 2, (VIEW_H / TILE) * CELL - 2);
    if (scene.player.alive) {
      ctx.fillStyle = "#ffe14a";
      ctx.strokeStyle = "#000";
      ctx.beginPath();
      ctx.arc(RULER + (scene.player.x / TILE) * CELL, (scene.player.y / TILE) * CELL, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
