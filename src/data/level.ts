import { parse } from "smol-toml";
import { DataError } from "./errors";
import type { EnemyTypes } from "./enemies";

// A level is two grids of equal size: terrain and units. Every cell is exactly two characters.
// The file is TOML so the legend and the grids sit together; the grids are multi-line strings so they
// stay readable (and diff-able) as text.

export type Grid = string[][];

export interface LevelData {
  name: string;
  width: number;
  height: number;
  legendTerrain: Record<string, string>;
  legendPickups: Record<string, string>;
  terrain: Grid;
  units: Grid;
}

export const LEVEL_WIDTH = 16; // the view is exactly 16 tiles wide
export const MIN_HEIGHT = 12;
export const MAX_HEIGHT = 400;
export const EMPTY = "..";

export const DEFAULT_TERRAIN_LEGEND: Record<string, string> = {
  "..": "grass",
  rd: "road: walkable, tanks drive here",
  "==": "bridge: walkable",
  "~~": "water: blocks movement, not bullets",
  "##": "wall: blocks movement and bullets",
  sb: "sandbags: block movement and bullets",
  tr: "tree: blocks movement, not bullets",
  bx: "explosive barrel",
  cr: "crate: breakable",
};
export const DEFAULT_PICKUPS: Record<string, string> = {
  h1: "POW: walk into to rescue for a bonus",
  g1: "grenade box: +3 grenades",
};

export const pad3 = (n: number) => String(n).padStart(3, "0");

/** Parses numbered grid lines. `firstRow` is the number the first line must carry (0 for a whole grid). */
export function parseGrid(text: string, what: string, problems: string[], firstRow = 0): Grid {
  const rows: Grid = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const parts = line.split(/\s+/);
    const label = parts.shift()!;
    if (!/^\d{3}$/.test(label) || Number(label) !== firstRow + i) {
      problems.push(`${what}: line ${i + 1} should start with row number ${pad3(firstRow + i)}, found "${label}"`);
      return;
    }
    rows.push(parts);
  });
  return rows;
}

export function parseLevel(text: string, enemies: EnemyTypes): LevelData {
  let doc: Record<string, any>;
  try {
    doc = parse(text) as Record<string, any>;
  } catch (e) {
    throw new DataError([`level: ${(e as Error).message}`]);
  }
  const problems: string[] = [];
  const name = String(doc.level?.name ?? "");
  const width = Number(doc.level?.width);
  const height = Number(doc.level?.height);
  if (!name) problems.push("level.name: required");
  if (width !== LEVEL_WIDTH) problems.push(`level.width: must be ${LEVEL_WIDTH}`);
  if (!(height >= MIN_HEIGHT && height <= MAX_HEIGHT)) problems.push(`level.height: must be ${MIN_HEIGHT} to ${MAX_HEIGHT}`);

  const legendTerrain = (doc.legend?.terrain ?? {}) as Record<string, string>;
  const legendPickups = (doc.legend?.pickups ?? {}) as Record<string, string>;
  for (const k of [...Object.keys(legendTerrain), ...Object.keys(legendPickups)]) {
    if (k.length !== 2) problems.push(`legend: code "${k}" must be exactly two characters`);
  }
  if (!(EMPTY in legendTerrain)) problems.push(`legend.terrain: "${EMPTY}" (grass) is required`);

  const terrain = parseGrid(String(doc.map?.terrain ?? ""), "map.terrain", problems);
  const units = parseGrid(String(doc.map?.units ?? ""), "map.units", problems);
  const unitCodes = new Set([EMPTY, ...Object.keys(enemies), ...Object.keys(legendPickups)]);

  for (const [what, grid, allowed] of [
    ["map.terrain", terrain, new Set(Object.keys(legendTerrain))],
    ["map.units", units, unitCodes],
  ] as const) {
    if (grid.length !== height) problems.push(`${what}: has ${grid.length} rows, level.height says ${height}`);
    let reported = 0;
    grid.forEach((row, r) => {
      if (row.length !== LEVEL_WIDTH) {
        problems.push(`${what}: row ${pad3(r)} has ${row.length} cells, expected ${LEVEL_WIDTH}`);
        return;
      }
      row.forEach((code, c) => {
        if (code.length !== 2) problems.push(`${what}: row ${pad3(r)} column ${c}: "${code}" is not two characters`);
        else if (!allowed.has(code) && reported++ < 8) problems.push(`${what}: row ${pad3(r)} column ${c}: unknown code "${code}"`);
      });
    });
  }

  if (!problems.length) {
    // multi-cell units must fit inside the grid
    units.forEach((row, r) =>
      row.forEach((code, c) => {
        const fp = enemies[code]?.footprint;
        if (fp && (c + fp[0] > LEVEL_WIDTH || r + fp[1] > height)) {
          problems.push(`map.units: ${code} at row ${pad3(r)} column ${c} needs ${fp[0]}x${fp[1]} cells but runs off the map`);
        }
      }),
    );
  }
  if (problems.length) throw new DataError(problems);
  return { name, width, height, legendTerrain, legendPickups, terrain, units };
}

// ------------------------------------------------------------------ writing

const HEADER = `# Level file.
#
# [map] holds two grids of the same size: terrain and units. Every cell is exactly two characters,
# cells are separated by one space, and every row starts with its 3-digit row number
# (000 is the top, where the exit is; the player starts at the bottom).
# Terrain codes are listed in [legend.terrain]. Unit codes are the enemy types in enemies.toml
# plus the pickups in [legend.pickups]; ".." means nothing.
# Multi-cell units (the tank is 2x2) are marked by their top-left cell only.
# The editor rewrites this file on save, so comments are lost.

`;

const q = (s: string) => JSON.stringify(s);

export function serializeLevel(level: LevelData): string {
  const grid = (g: Grid) => g.map((row, r) => `${pad3(r)} ${row.join(" ")}`).join("\n");
  const legend = (l: Record<string, string>) => Object.entries(l).map(([k, v]) => `${q(k)} = ${q(v)}`).join("\n");
  return (
    HEADER +
    `[level]\nname = ${q(level.name)}\nwidth = ${level.width}\nheight = ${level.height}\n\n` +
    `[legend.terrain]\n${legend(level.legendTerrain)}\n\n` +
    `[legend.pickups]\n${legend(level.legendPickups)}\n\n` +
    `[map]\nterrain = '''\n${grid(level.terrain)}\n'''\n\nunits = '''\n${grid(level.units)}\n'''\n`
  );
}

export function blankLevel(name: string, height = 40): LevelData {
  const terrain: Grid = Array.from({ length: height }, () => Array.from({ length: LEVEL_WIDTH }, (_, c) => (c === 7 || c === 8 ? "rd" : EMPTY)));
  const units: Grid = Array.from({ length: height }, () => Array(LEVEL_WIDTH).fill(EMPTY));
  return {
    name, width: LEVEL_WIDTH, height,
    legendTerrain: { ...DEFAULT_TERRAIN_LEGEND }, legendPickups: { ...DEFAULT_PICKUPS },
    terrain, units,
  };
}

export const cloneGrid = (g: Grid): Grid => g.map((r) => r.slice());
