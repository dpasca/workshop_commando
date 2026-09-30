import { parse, stringify } from "smol-toml";
import { DataError } from "./errors";
import { isValidSpriteRef } from "./sprites";

// Enemy types are data: a few numbers plus one movement primitive and one attack primitive.
// The primitives themselves are code (src/entities/behaviors.ts). A new kind of behaviour needs code;
// a new kind of enemy usually doesn't.
//
// Units: distances in tiles, times in seconds, speeds in tiles per second.

export type Value = number | string | boolean;
export type Params = Record<string, Value>;

export const MOVE_KINDS = ["static", "chase", "keep_distance", "patrol", "follow_road"] as const;
export const ATTACK_KINDS = ["none", "aimed", "lob", "arc"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
export type AttackKind = (typeof ATTACK_KINDS)[number];

export interface EnemyType {
  name: string;
  sprite: string;
  tint: string;
  scale: number;
  hp: number;
  speed: number;
  score: number;
  armored: boolean;
  footprint: [number, number];
  facing: "player" | "travel" | "fixed";
  turret: string;
  death: "soldier" | "tank" | "bunker";
  shadow: number;
  move: Params & { kind: MoveKind };
  attack: Params & { kind: AttackKind };
}
export type EnemyTypes = Record<string, EnemyType>;

export interface FieldSpec {
  key: string;
  type: "number" | "text" | "bool" | "select";
  options?: readonly string[];
  step?: number;
  min?: number;
  default: Value;
  help?: string;
}

export const TYPE_FIELDS: FieldSpec[] = [
  { key: "name", type: "text", default: "", help: "shown in the editor and given to the agent" },
  { key: "sprite", type: "text", default: "rifleman", help: 'image key, or "tiles:N" for a tilesheet frame' },
  { key: "tint", type: "text", default: "", help: 'optional colour multiplier, e.g. "#d8c090"' },
  { key: "scale", type: "number", step: 0.1, min: 0.1, default: 1 },
  { key: "hp", type: "number", step: 1, min: 1, default: 1 },
  { key: "speed", type: "number", step: 0.1, min: 0, default: 1, help: "tiles per second" },
  { key: "score", type: "number", step: 50, min: 0, default: 100 },
  { key: "armored", type: "bool", default: false, help: "bullets bounce off; grenades and explosions still hurt" },
  { key: "facing", type: "select", options: ["player", "travel", "fixed"], default: "player" },
  { key: "turret", type: "text", default: "", help: "optional image key for a turret that tracks the player" },
  { key: "death", type: "select", options: ["soldier", "tank", "bunker"], default: "soldier", help: "which death effect to play" },
  { key: "shadow", type: "number", step: 0.1, min: 0, default: 0.75 },
];

const NUM = (key: string, def: number, step = 0.1, min = 0, help?: string): FieldSpec => ({ key, type: "number", default: def, step, min, help });

export const MOVE_FIELDS: Record<MoveKind, FieldSpec[]> = {
  static: [],
  chase: [NUM("stop_distance", 4, 0.5, 0, "tiles; closer than this it side-steps instead"), { key: "strafe", type: "bool", default: false }],
  keep_distance: [NUM("min", 5, 0.5), NUM("max", 7, 0.5)],
  patrol: [{ key: "axis", type: "select", options: ["x", "y"], default: "x" }, NUM("distance", 3, 0.5, 0, "tiles each way from the start")],
  follow_road: [NUM("stop_distance", 3, 0.5)],
};

const PROJECTILE: FieldSpec = { key: "projectile", type: "select", options: ["bullet", "shell"], default: "bullet", help: "shells explode" };
export const ATTACK_FIELDS: Record<AttackKind, FieldSpec[]> = {
  none: [],
  aimed: [NUM("interval", 2, 0.1, 0.1, "seconds"), NUM("range", 8, 0.5, 0, "tiles"), NUM("bullet_speed", 4.4, 0.1), PROJECTILE, NUM("muzzle", 0.5, 0.1, 0, "tiles from centre")],
  lob: [NUM("interval", 3.5, 0.1, 0.1), NUM("range", 7, 0.5), NUM("inaccuracy", 0.5, 0.1, 0, "tiles of random miss")],
  arc: [
    NUM("interval", 1, 0.1, 0.1), NUM("range", 9, 0.5), NUM("bullet_speed", 4.7, 0.1), PROJECTILE, NUM("muzzle", 0.7, 0.1, 0, "tiles from centre"),
    NUM("arc_deg", 90, 5, 5, "total width of the firing arc"), { key: "arc_facing", type: "select", options: ["down", "up", "left", "right"], default: "down" },
  ],
};

export function defaultsFor(fields: FieldSpec[]): Params {
  return Object.fromEntries(fields.map((f) => [f.key, f.default]));
}

// ------------------------------------------------------------------ parsing

function readParams(raw: unknown, fields: FieldSpec[], where: string, problems: string[], extraKeys: string[] = []): Params {
  const out: Params = {};
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const known = new Set([...fields.map((f) => f.key), ...extraKeys]);
  for (const k of Object.keys(obj)) if (!known.has(k)) problems.push(`${where}: unknown field "${k}"`);
  for (const f of fields) {
    const v = obj[f.key];
    if (v === undefined) {
      out[f.key] = f.default;
      continue;
    }
    if (f.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) { problems.push(`${where}.${f.key}: expected a number`); continue; }
      if (f.min !== undefined && v < f.min) problems.push(`${where}.${f.key}: must be >= ${f.min}`);
    } else if (f.type === "bool") {
      if (typeof v !== "boolean") { problems.push(`${where}.${f.key}: expected true or false`); continue; }
    } else {
      if (typeof v !== "string") { problems.push(`${where}.${f.key}: expected a string`); continue; }
      if (f.type === "select" && !f.options!.includes(v)) problems.push(`${where}.${f.key}: must be one of ${f.options!.join(", ")}`);
    }
    out[f.key] = v as Value;
  }
  return out;
}

export function parseEnemies(text: string): EnemyTypes {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new DataError([`enemies.toml: ${(e as Error).message}`]);
  }
  const problems: string[] = [];
  const types = (doc.types ?? {}) as Record<string, Record<string, unknown>>;
  const out: EnemyTypes = {};
  if (!Object.keys(types).length) problems.push("enemies.toml: no [types.xx] tables");

  for (const [code, raw] of Object.entries(types)) {
    const where = `types.${code}`;
    if (!/^[a-z][a-z0-9]$/.test(code)) problems.push(`${where}: a unit code is two characters, a letter then a letter or digit`);
    const common = readParams(raw, TYPE_FIELDS, where, problems, ["footprint", "move", "attack"]);
    if (!common.name) problems.push(`${where}.name: required`);
    if (!isValidSpriteRef(String(common.sprite))) problems.push(`${where}.sprite: unknown sprite "${common.sprite}"`);
    if (common.turret && !isValidSpriteRef(String(common.turret))) problems.push(`${where}.turret: unknown sprite "${common.turret}"`);
    if (common.tint && !/^#[0-9a-fA-F]{6}$/.test(String(common.tint))) problems.push(`${where}.tint: use "#rrggbb"`);

    let footprint: [number, number] = [1, 1];
    const fp = raw.footprint;
    if (fp !== undefined) {
      if (Array.isArray(fp) && fp.length === 2 && fp.every((n) => Number.isInteger(n) && n >= 1 && n <= 4)) footprint = fp as [number, number];
      else problems.push(`${where}.footprint: expected [width, height] with whole numbers 1 to 4`);
    }

    const moveRaw = (raw.move ?? {}) as Record<string, unknown>;
    const attackRaw = (raw.attack ?? {}) as Record<string, unknown>;
    const moveKind = String(moveRaw.kind ?? "static") as MoveKind;
    const attackKind = String(attackRaw.kind ?? "none") as AttackKind;
    if (!MOVE_KINDS.includes(moveKind)) problems.push(`${where}.move.kind: must be one of ${MOVE_KINDS.join(", ")}`);
    if (!ATTACK_KINDS.includes(attackKind)) problems.push(`${where}.attack.kind: must be one of ${ATTACK_KINDS.join(", ")}`);
    const move = MOVE_KINDS.includes(moveKind) ? readParams(moveRaw, MOVE_FIELDS[moveKind], `${where}.move`, problems, ["kind"]) : {};
    const attack = ATTACK_KINDS.includes(attackKind) ? readParams(attackRaw, ATTACK_FIELDS[attackKind], `${where}.attack`, problems, ["kind"]) : {};

    out[code] = { ...(common as unknown as EnemyType), footprint, move: { kind: moveKind, ...move }, attack: { kind: attackKind, ...attack } };
  }
  if (problems.length) throw new DataError(problems);
  return out;
}

// ------------------------------------------------------------------ writing

const HEADER = `# Enemy types. One [types.xx] table per unit code used in the level's units grid.
# Each type is a few numbers plus one movement primitive and one attack primitive.
# Distances are in tiles, times in seconds, speeds in tiles per second.
#
#   move.kind    static | chase | keep_distance | patrol | follow_road
#   attack.kind  none | aimed | lob | arc
#
# The primitives are implemented in src/entities/behaviors.ts. Inventing a new behaviour needs code;
# inventing a new enemy from the existing ones only needs an entry here.
# The editor rewrites this file on save, so comments are lost; keep notes in the "name" field.

`;

export function serializeEnemies(types: EnemyTypes): string {
  const out: Record<string, unknown> = {};
  for (const [code, t] of Object.entries(types)) {
    const entry: Record<string, unknown> = {};
    for (const f of TYPE_FIELDS) {
      const v = t[f.key as keyof EnemyType];
      if ((f.key === "tint" || f.key === "turret") && !v) continue;
      entry[f.key] = v;
      if (f.key === "armored") entry.footprint = t.footprint;
    }
    entry.move = t.move;
    entry.attack = t.attack;
    out[code] = entry;
  }
  return HEADER + stringify({ types: out }) + "\n";
}
