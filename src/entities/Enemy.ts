import Phaser from "phaser";
import { TILE } from "../config";
import type { EnemyType } from "../data/enemies";
import { parseSpriteRef } from "../data/sprites";
import { DEPTH } from "../fx";
import type { GameScene } from "../scenes/GameScene";
import { attackBehaviors, moveBehaviors, turretAngle } from "./behaviors";

/** What a behaviour sees each frame. */
export interface Frame {
  time: number;
  player: Phaser.Math.Vector2;
  distance: number;
  /** Angle from the enemy to the player. */
  angle: number;
}

// One class for every enemy type. What makes a rifleman different from a tank is data
// (data/enemies.toml): sprite, hit points, and one movement plus one attack primitive.
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp: number;
  readonly armored: boolean;
  readonly score: number;
  /** Per-instance state used by the movement and attack primitives. */
  readonly origin: Phaser.Math.Vector2;
  strafeDir = Math.random() < 0.5 ? -1 : 1;
  patrolDir = 1;
  lastFlip = 0;
  nextShot: number;
  private shadowImg: Phaser.GameObjects.Image;
  private turretImg?: Phaser.GameObjects.Image;
  private lastTrack: Phaser.Math.Vector2;

  constructor(readonly world: GameScene, x: number, y: number, readonly code: string, readonly def: EnemyType) {
    const [texture, frame] = parseSpriteRef(def.sprite);
    super(world, x, y, texture, frame);
    world.add.existing(this);
    world.physics.add.existing(this);
    this.hp = def.hp;
    this.armored = def.armored;
    this.score = def.score;
    this.origin = new Phaser.Math.Vector2(x, y);
    this.lastTrack = new Phaser.Math.Vector2(x, y);
    this.nextShot = world.time.now + Phaser.Math.Between(800, 1800);

    this.setScale(def.scale);
    if (def.tint) this.setTint(parseInt(def.tint.slice(1), 16));
    if (def.armored || def.footprint[0] > 1 || def.footprint[1] > 1) this.body.setSize(this.width * 0.8, this.height * 0.8);
    else this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
    if (def.armored) this.body.setImmovable(true);
    if (def.facing === "travel") this.setRotation(Math.PI);

    // things that never move sit in the obstacle layer, everything else in the unit layer
    const fixed = def.move.kind === "static" && def.facing === "fixed";
    this.setDepth(fixed ? DEPTH.obstacles : DEPTH.units);
    this.shadowImg = world.fx.shadow(def.shadow).setDepth(fixed ? DEPTH.objShadow : DEPTH.unitShadow);
    if (def.turret) {
      this.turretImg = world.add.image(x, y, def.turret).setOrigin(0.5, 0.15).setScale(def.scale).setDepth(this.depth + 1);
    }
  }

  /** Called every frame while the enemy is on screen. */
  update(time: number, player: Phaser.Math.Vector2) {
    const frame: Frame = {
      time,
      player,
      distance: Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y),
      angle: Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y),
    };
    moveBehaviors[this.def.move.kind](this, frame);

    if (this.def.facing === "player") this.setRotation(frame.angle);
    else if (this.def.facing === "travel") this.setRotation(player.y >= this.y ? Math.PI : 0);

    attackBehaviors[this.def.attack.kind](this, frame);

    this.turretImg?.setPosition(this.x, this.y).setRotation(turretAngle(this, frame) - Math.PI / 2);
    this.shadowImg.setPosition(this.x + 5, this.y + 7);

    if (this.def.move.kind === "follow_road" && Phaser.Math.Distance.Between(this.x, this.y, this.lastTrack.x, this.lastTrack.y) > 24) {
      this.world.dropTrackDecal(this.x, this.y, this.rotation);
      this.lastTrack.set(this.x, this.y);
    }
  }

  damage(amount: number, fromBullet: boolean) {
    if (!this.active) return;
    if (fromBullet && this.armored) {
      this.world.fx.impact(this.x, this.y);
      return;
    }
    this.hp -= amount;
    this.world.fx.hitFlash(this);
    if (this.hp <= 0) this.die();
  }

  private die() {
    this.world.onEnemyKilled(this);
    const fx = this.world.fx;
    if (this.def.death === "tank") fx.explosion(this.x, this.y, 2);
    else if (this.def.death === "bunker") fx.explosion(this.x, this.y, 1.5);
    else fx.explosion(this.x, this.y, 0.35);
    this.world.leaveWreck(this);
    this.destroy();
  }

  destroy(fromScene?: boolean) {
    this.shadowImg?.destroy();
    this.turretImg?.destroy();
    super.destroy(fromScene);
  }

  /** Where a shot leaves the gun: `muzzle` tiles ahead, nudged sideways for a soldier's rifle. */
  muzzlePoint(angle: number, muzzleTiles: number) {
    const fwd = muzzleTiles * TILE;
    const side = this.def.turret ? 0 : 10;
    return { x: this.x + Math.cos(angle) * fwd - Math.sin(angle) * side, y: this.y + Math.sin(angle) * fwd + Math.cos(angle) * side };
  }
}
