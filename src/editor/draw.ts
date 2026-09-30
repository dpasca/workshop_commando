import type { EnemyType } from "../data/enemies";
import { parseSpriteRef } from "../data/sprites";

// Canvas drawing helpers for the editor: the same art as the game, at thumbnail size.

const images = new Map<string, HTMLImageElement>();
/** Fired when a sprite finishes loading, so views can redraw. */
export const imageLoaded = new EventTarget();

export function image(key: string): HTMLImageElement | null {
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.onload = () => imageLoaded.dispatchEvent(new Event("load"));
    img.src = `/assets/${key}.png`;
    images.set(key, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

const TILE_PX = 64;
const SHEET_COLS = 27;

export function drawFrame(ctx: CanvasRenderingContext2D, frame: number, x: number, y: number, size: number) {
  const sheet = image("tiles");
  if (!sheet) return;
  ctx.drawImage(sheet, (frame % SHEET_COLS) * TILE_PX, Math.floor(frame / SHEET_COLS) * TILE_PX, TILE_PX, TILE_PX, x, y, size, size);
}

const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(img: HTMLImageElement, key: string, sx: number, sy: number, sw: number, sh: number, tint: string) {
  const id = `${key}|${tint}`;
  let c = tintCache.get(id);
  if (!c) {
    c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const g = c.getContext("2d")!;
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = tint;
    g.fillRect(0, 0, sw, sh);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    tintCache.set(id, c);
  }
  return c;
}

/** Draws a sprite reference ("key" or "tiles:N") fitted into a w x h box, optionally rotated and tinted. */
export function drawSprite(ctx: CanvasRenderingContext2D, ref: string, x: number, y: number, w: number, h: number, rotation = 0, tint = "") {
  const [key, frame] = parseSpriteRef(ref);
  const img = image(key === "tiles" ? "tiles" : key);
  if (!img) return;
  const sx = frame !== undefined ? (frame % SHEET_COLS) * TILE_PX : 0;
  const sy = frame !== undefined ? Math.floor(frame / SHEET_COLS) * TILE_PX : 0;
  const sw = frame !== undefined ? TILE_PX : img.naturalWidth;
  const sh = frame !== undefined ? TILE_PX : img.naturalHeight;
  const src: CanvasImageSource = tint ? tinted(img, ref, sx, sy, sw, sh, tint) : img;
  const [ox, oy] = tint ? [0, 0] : [sx, sy];
  // rotated by a quarter turn the sprite's width and height swap
  const quarter = Math.abs(Math.round(rotation / (Math.PI / 2))) % 2 === 1;
  const fit = Math.min(w / (quarter ? sh : sw), h / (quarter ? sw : sh));
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);
  ctx.drawImage(src, ox, oy, sw, sh, (-sw * fit) / 2, (-sh * fit) / 2, sw * fit, sh * fit);
  ctx.restore();
}

const TERRAIN_FRAME: Record<string, number> = { rd: 4, "~~": 18, "==": 43, "##": 352 };
const TERRAIN_OBJECT: Record<string, string> = { sb: "sandbag", tr: "tree_small", bx: "barrel_red" };

export function drawTerrain(ctx: CanvasRenderingContext2D, code: string, x: number, y: number, size: number) {
  drawFrame(ctx, TERRAIN_FRAME[code] ?? 0, x, y, size);
  if (TERRAIN_OBJECT[code]) drawSprite(ctx, TERRAIN_OBJECT[code], x + 1, y + 1, size - 2, size - 2);
  else if (code === "cr") drawFrame(ctx, 128, x + 2, y + 2, size - 4);
  else if (!(code in TERRAIN_FRAME) && code !== ".." && code !== "cr") {
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.floor(size * 0.45)}px Menlo, monospace`;
    ctx.fillText(code, x + 2, y + size * 0.65);
  }
}

/** Draws whatever a units-grid code means. `cells` = how many cells wide it may spread (tank = 2). */
export function drawUnit(ctx: CanvasRenderingContext2D, code: string, enemies: Record<string, EnemyType>, x: number, y: number, size: number) {
  const def = enemies[code];
  if (def) {
    const [fw, fh] = def.footprint;
    // soldiers are drawn facing down, like they do when they aim at the player
    const rotation = def.facing === "travel" ? Math.PI : def.facing === "fixed" ? 0 : Math.PI / 2;
    drawSprite(ctx, def.sprite, x, y, fw * size, fh * size, def.facing === "fixed" ? 0 : rotation, def.tint);
    if (def.turret && def.facing === "fixed") drawSprite(ctx, def.turret, x + size * 0.35, y + size * 0.4, size * 0.3, size * 0.7, 0);
    if (fw > 1 || fh > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, fw * size - 1, fh * size - 1);
      ctx.setLineDash([]);
    }
    return;
  }
  if (code === "h1") drawSprite(ctx, "pow", x, y, size, size, Math.PI / 2);
  else if (code === "g1") {
    ctx.fillStyle = "#3d5a2a";
    ctx.fillRect(x + size * 0.15, y + size * 0.25, size * 0.7, size * 0.5);
    ctx.fillStyle = "#e8d27a";
    ctx.fillRect(x + size * 0.3, y + size * 0.42, size * 0.4, size * 0.16);
  } else {
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.floor(size * 0.45)}px Menlo, monospace`;
    ctx.fillText(code, x + 2, y + size * 0.65);
  }
}
