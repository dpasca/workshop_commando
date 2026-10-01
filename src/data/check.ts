import type { EnemyTypes } from "./enemies";
import { EMPTY, LEVEL_WIDTH, type LevelData } from "./level";

// Is this level playable? Structural validity (parse) is checked elsewhere; this asks the game-design
// questions. `errors` mean "do not accept this level" (the agent loop retries on them); `warnings` are advice.
//
// Terrain meanings mirror src/scenes/GameScene.ts: the player walks on grass, road and bridge, and is
// stopped by walls, water, sandbags, trees, barrels and crates.

export interface CheckResult {
  errors: string[];
  warnings: string[];
  stats: { rows: number; enemies: number; pows: number; grenadeBoxes: number; busiestScreen: number; byType: Record<string, number> };
}

export const WALKABLE = new Set([EMPTY, "rd", "=="]);
const ROAD = new Set(["rd", "=="]);
const SCREEN_ROWS = 12;
const SPAWN_SAFE_TILES = 4;
const BUSY_SCREEN = 18;

const pad3 = (n: number) => String(n).padStart(3, "0");
const at = (r: number, c: number) => `row ${pad3(r)} column ${c}`;

export function checkLevel(level: LevelData, enemies: EnemyTypes): CheckResult {
  const { terrain, units, height } = level;
  const errors: string[] = [];
  const warnings: string[] = [];
  const walkable = (r: number, c: number) => r >= 0 && r < height && c >= 0 && c < LEVEL_WIDTH && WALKABLE.has(terrain[r][c]);

  // --- units: where they stand
  const occupied = new Map<string, string>(); // "r,c" -> description of what covers the cell
  const armoredCells = new Set<string>();
  const stats: CheckResult["stats"] = { rows: height, enemies: 0, pows: 0, grenadeBoxes: 0, busiestScreen: 0, byType: {} };
  const enemyRows: number[] = [];

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < LEVEL_WIDTH; c++) {
      const code = units[r][c];
      if (code === EMPTY) continue;
      stats.byType[code] = (stats.byType[code] ?? 0) + 1;
      const def = enemies[code];
      if (!def) {
        if (code === "h1") stats.pows++;
        if (code === "g1") stats.grenadeBoxes++;
        if (!walkable(r, c)) errors.push(`${code} at ${at(r, c)} is on ${terrain[r][c]}, which the player cannot reach`);
        occupied.set(`${r},${c}`, code);
        continue;
      }
      stats.enemies++;
      enemyRows.push(r);
      const [fw, fh] = def.footprint;
      const blocked: string[] = [];
      const offRoad: string[] = [];
      for (let dr = 0; dr < fh; dr++) {
        for (let dc = 0; dc < fw; dc++) {
          const rr = r + dr, cc = c + dc;
          const key = `${rr},${cc}`;
          if (occupied.has(key)) errors.push(`${code} at ${at(r, c)} overlaps ${occupied.get(key)}`);
          occupied.set(key, `${code} at ${at(r, c)}`);
          if (def.armored) armoredCells.add(key);
          if (!walkable(rr, cc)) blocked.push(`${terrain[rr]?.[cc] ?? "off the map"} at ${at(rr, cc)}`);
          else if (def.move.kind === "follow_road" && !ROAD.has(terrain[rr][cc])) offRoad.push(at(rr, cc));
        }
      }
      if (blocked.length) errors.push(`${code} at ${at(r, c)} stands on ${blocked[0]}${blocked.length > 1 ? ` (+${blocked.length - 1} more cells)` : ""}; units need grass, road or bridge`);
      if (offRoad.length) errors.push(`${code} at ${at(r, c)} follows the road but ${offRoad.length} of its ${fw * fh} cells are not on road`);
    }
  }

  // --- the way through: from the player's start to the top row
  const startRow = height - 2;
  const starts = [7, 8].filter((c) => walkable(startRow, c));
  if (!starts.length) errors.push(`the player start (${at(startRow, 7)}) is blocked`);

  const flood = (blocked: (r: number, c: number) => boolean) => {
    const seen = new Set<string>();
    const queue: [number, number][] = [];
    for (const c of starts) {
      if (blocked(startRow, c)) continue;
      seen.add(`${startRow},${c}`);
      queue.push([startRow, c]);
    }
    for (let i = 0; i < queue.length; i++) {
      const [r, c] = queue[i];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc;
        if (!walkable(nr, nc) || blocked(nr, nc) || seen.has(`${nr},${nc}`)) continue;
        seen.add(`${nr},${nc}`);
        queue.push([nr, nc]);
      }
    }
    return seen;
  };
  const reachable = flood(() => false);
  const exit = [...reachable].some((k) => k.startsWith("0,"));
  if (starts.length && !exit) {
    // describe where it gets stuck, to help whoever fixes it
    const furthest = Math.min(...[...reachable].map((k) => Number(k.split(",")[0])));
    errors.push(`no walkable path from the start to the exit; the way is cut off at about row ${pad3(furthest)}`);
  }
  if (exit && ![...flood((r, c) => armoredCells.has(`${r},${c}`))].some((k) => k.startsWith("0,"))) {
    warnings.push("armored units (tanks, bunkers) block every way through; the player has to destroy one with grenades");
  }

  // pickups must be reachable
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < LEVEL_WIDTH; c++) {
      const code = units[r][c];
      if ((code === "h1" || code === "g1") && walkable(r, c) && exit && !reachable.has(`${r},${c}`)) {
        errors.push(`${code} at ${at(r, c)} cannot be reached from the start`);
      }
    }
  }

  // --- fairness
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < LEVEL_WIDTH; c++) {
      if (!enemies[units[r][c]]) continue;
      if (Math.max(Math.abs(r - startRow), Math.abs(c - 7.5)) <= SPAWN_SAFE_TILES) {
        errors.push(`${units[r][c]} at ${at(r, c)} is within ${SPAWN_SAFE_TILES} tiles of the player start`);
      }
    }
  }
  for (let top = 0; top + SCREEN_ROWS <= height; top++) {
    const n = enemyRows.filter((r) => r >= top && r < top + SCREEN_ROWS).length;
    stats.busiestScreen = Math.max(stats.busiestScreen, n);
  }
  if (stats.busiestScreen > BUSY_SCREEN) warnings.push(`one screen holds ${stats.busiestScreen} enemies; more than ${BUSY_SCREEN} is likely unfair`);
  if (height < SCREEN_ROWS * 2) warnings.push(`only ${height} rows: less than two screens long`);

  return { errors: dedupe(errors), warnings: dedupe(warnings), stats };
}

const dedupe = (a: string[]) => [...new Set(a)];

/** Problems present in `after` that were not already in `before`: what a change made worse. */
export function newProblems(before: CheckResult, after: CheckResult): string[] {
  const old = new Set(before.errors);
  return after.errors.filter((e) => !old.has(e));
}

export function summarize(r: CheckResult): string {
  const s = r.stats;
  return `${s.rows} rows · ${s.enemies} enemies · ${s.pows} POWs · busiest screen ${s.busiestScreen}`;
}
