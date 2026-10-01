import type { EnemyType } from "./enemies";

// Plain-English descriptions generated from the data, so they cannot drift from what the game does.
// Used in the prompt for the editor's agent and available to the editor UI.

const n = (v: unknown) => Number(v);

export function describeMove(t: EnemyType): string {
  const m = t.move;
  switch (m.kind) {
    case "static": return "never moves";
    case "chase": return `walks toward the player and stops ${n(m.stop_distance)} tiles away${m.strafe ? ", then side-steps" : ""}`;
    case "keep_distance": return `keeps ${n(m.min)} to ${n(m.max)} tiles from the player`;
    case "patrol": return `paces ${n(m.distance)} tiles each way along the ${m.axis} axis`;
    case "follow_road": return "drives along the road toward the player";
  }
}

export function describeAttack(t: EnemyType): string {
  const a = t.attack;
  switch (a.kind) {
    case "none": return "does not attack";
    case "aimed": return `fires ${a.projectile === "shell" ? "explosive shells" : "bullets"} about every ${n(a.interval)}s at up to ${n(a.range)} tiles`;
    case "lob": return `lobs grenades over cover about every ${n(a.interval)}s at up to ${n(a.range)} tiles`;
    case "arc": return `fires about every ${n(a.interval)}s at up to ${n(a.range)} tiles, but only inside a ${n(a.arc_deg)} degree arc facing ${a.arc_facing}`;
  }
}

export function describeEnemy(code: string, t: EnemyType): string {
  const [w, h] = t.footprint;
  const size = w > 1 || h > 1 ? `, covers ${w}x${h} cells (code marks the top-left)` : "";
  const armor = t.armored ? ", armored: bullets bounce off, grenades and explosions work" : "";
  return `${code} ${t.name.split(":")[0]}: ${t.hp} hit points, ${describeMove(t)}; ${describeAttack(t)}${armor}${size}`;
}
