import Phaser from "phaser";
import { TILE } from "../config";
import type { AttackKind, MoveKind } from "../data/enemies";
import type { Enemy, Frame } from "./Enemy";

// The behaviour primitives. Each one reads its numbers from the enemy's entry in data/enemies.toml.
// To invent a new behaviour: add a function here, add its name to MOVE_KINDS / ATTACK_KINDS
// and its parameters to MOVE_FIELDS / ATTACK_FIELDS (src/data/enemies.ts).
// Distances in the data are tiles, times are seconds, speeds are tiles per second.

const num = (e: Enemy, group: "move" | "attack", key: string) => e.def[group][key] as number;
const str = (e: Enemy, group: "move" | "attack", key: string) => e.def[group][key] as string;

// ---------------------------------------------------------------- movement

export const moveBehaviors: Record<MoveKind, (e: Enemy, f: Frame) => void> = {
  // Stays where it is.
  static(e) {
    e.body.setVelocity(0, 0);
  },

  // Walks toward the player until `stop_distance`; then side-steps if `strafe`.
  chase(e, f) {
    const speed = e.def.speed * TILE;
    if (f.distance > num(e, "move", "stop_distance") * TILE) {
      e.body.setVelocity(Math.cos(f.angle) * speed, Math.sin(f.angle) * speed);
      return;
    }
    if (!e.def.move.strafe) return e.body.setVelocity(0, 0);
    const side = f.angle + Math.PI / 2;
    e.body.setVelocity(Math.cos(side) * speed * 0.5 * e.strafeDir, Math.sin(side) * speed * 0.5 * e.strafeDir);
    if (Math.random() < 0.01) e.strafeDir *= -1;
  },

  // Backs off when closer than `min`, closes in when farther than `max`.
  keep_distance(e, f) {
    const speed = e.def.speed * TILE;
    const dir = f.distance < num(e, "move", "min") * TILE ? -1 : f.distance > num(e, "move", "max") * TILE ? 1 : 0;
    e.body.setVelocity(Math.cos(f.angle) * speed * dir, Math.sin(f.angle) * speed * dir);
  },

  // Paces back and forth `distance` tiles either side of where it started; turns round at obstacles.
  patrol(e, f) {
    const axis = str(e, "move", "axis") === "y" ? "y" : "x";
    const limit = num(e, "move", "distance") * TILE;
    const offset = e[axis] - e.origin[axis];
    if (offset > limit) e.patrolDir = -1;
    else if (offset < -limit) e.patrolDir = 1;
    else if ((!e.body.blocked.none || !e.body.touching.none) && f.time - e.lastFlip > 400) {
      e.patrolDir *= -1;
      e.lastFlip = f.time;
    }
    const v = e.patrolDir * e.def.speed * TILE;
    e.body.setVelocity(axis === "x" ? v : 0, axis === "y" ? v : 0);
  },

  // Rolls up or down the road toward the player, only where there is road under its whole width.
  follow_road(e, f) {
    const dy = f.player.y - e.y;
    const ahead = e.y + Math.sign(dy) * TILE * 1.1;
    const canMove = Math.abs(dy) > num(e, "move", "stop_distance") * TILE && e.world.isRoadAt(e.x - TILE / 2, ahead) && e.world.isRoadAt(e.x + TILE / 2, ahead);
    e.body.setVelocity(0, canMove ? Math.sign(dy) * e.def.speed * TILE : 0);
  },
};

// ---------------------------------------------------------------- attacks

/** True when it is time to shoot again, and books the next shot (with a little jitter). */
function ready(e: Enemy, f: Frame, intervalSeconds: number) {
  if (f.time < e.nextShot) return false;
  e.nextShot = f.time + intervalSeconds * 1000 * Phaser.Math.FloatBetween(0.8, 1.2);
  return true;
}

function shoot(e: Enemy, angle: number) {
  const a = e.def.attack;
  const tip = e.muzzlePoint(angle, a.muzzle as number);
  const speed = (a.bullet_speed as number) * TILE;
  const range = (a.range as number) * TILE;
  if (a.projectile === "shell") {
    e.world.fireShell(tip.x, tip.y, angle, speed, range);
    e.world.fx.muzzle(tip.x, tip.y, angle, 1.8);
    e.world.cameras.main.shake(80, 0.002);
  } else {
    e.world.fireBullet("enemy", tip.x, tip.y, angle, speed, range);
    e.world.fx.muzzle(tip.x, tip.y, angle, 0.8);
  }
}

const FACING: Record<string, number> = { down: Math.PI / 2, up: -Math.PI / 2, left: Math.PI, right: 0 };

/** Where the arc attack points, clamped to its firing arc. */
function arcAim(e: Enemy, f: Frame) {
  const centre = FACING[str(e, "attack", "arc_facing")] ?? Math.PI / 2;
  const half = Phaser.Math.DegToRad(num(e, "attack", "arc_deg") / 2);
  const offset = Phaser.Math.Angle.Wrap(f.angle - centre);
  return { angle: centre + Phaser.Math.Clamp(offset, -half, half), inArc: Math.abs(offset) <= half };
}

/** The angle a turret sprite should point: at the player, or as far as its arc allows. */
export function turretAngle(e: Enemy, f: Frame) {
  return e.def.attack.kind === "arc" ? arcAim(e, f).angle : f.angle;
}

export const attackBehaviors: Record<AttackKind, (e: Enemy, f: Frame) => void> = {
  none() {},

  // Fires straight at the player when within `range`.
  aimed(e, f) {
    if (f.distance < num(e, "attack", "range") * TILE && ready(e, f, num(e, "attack", "interval"))) shoot(e, f.angle);
  },

  // Throws a grenade that lands near the player (over cover), `inaccuracy` tiles off.
  lob(e, f) {
    if (f.distance >= num(e, "attack", "range") * TILE || !ready(e, f, num(e, "attack", "interval"))) return;
    const miss = num(e, "attack", "inaccuracy") * TILE;
    e.world.lobGrenade("enemy", e.x, e.y, f.player.x + Phaser.Math.Between(-miss, miss), f.player.y + Phaser.Math.Between(-miss, miss));
  },

  // Like aimed, but only while the player is inside a fixed firing arc.
  arc(e, f) {
    const aim = arcAim(e, f);
    if (aim.inArc && f.distance < num(e, "attack", "range") * TILE && ready(e, f, num(e, "attack", "interval"))) shoot(e, aim.angle);
  },
};
