import Phaser from "phaser";
import { ENEMIES, TILE, TILE_FRAMES } from "../config";
import { DEPTH } from "../fx";
import type { GameScene } from "../scenes/GameScene";

// Enemy behaviours, hard-coded per type (workshop Phase 1 starting point).

export abstract class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  hp: number;
  abstract readonly score: number;
  /** Bullets only ping off armoured enemies; they need grenades or explosions. */
  armored = false;
  protected shadowImg: Phaser.GameObjects.Image;
  protected nextShot: number;

  constructor(protected world: GameScene, x: number, y: number, texture: string, hp: number, shadowScale: number) {
    super(world, x, y, texture);
    world.add.existing(this);
    world.physics.add.existing(this);
    this.hp = hp;
    this.setDepth(DEPTH.units);
    this.shadowImg = world.fx.shadow(shadowScale);
    this.nextShot = world.time.now + Phaser.Math.Between(800, 1800);
  }

  /** Called every frame while the enemy is on screen. */
  abstract think(time: number, player: Phaser.Math.Vector2): void;

  update(time: number, player: Phaser.Math.Vector2) {
    this.think(time, player);
    this.shadowImg.setPosition(this.x + 5, this.y + 7);
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

  protected die() {
    this.world.onEnemyKilled(this);
    this.destroy();
  }

  destroy(fromScene?: boolean) {
    this.shadowImg?.destroy();
    super.destroy(fromScene);
  }

  protected distanceTo(p: Phaser.Math.Vector2) {
    return Phaser.Math.Distance.Between(this.x, this.y, p.x, p.y);
  }

  protected angleTo(p: Phaser.Math.Vector2) {
    return Phaser.Math.Angle.Between(this.x, this.y, p.x, p.y);
  }
}

// s1: walks toward the player, stops at a distance, shoots aimed bullets.
export class Rifleman extends Enemy {
  readonly score = ENEMIES.s1.score;
  private strafe = Math.random() < 0.5 ? -1 : 1;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "rifleman", ENEMIES.s1.hp, 0.75);
    this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.s1;
    const a = this.angleTo(player);
    this.setRotation(a);
    const d = this.distanceTo(player);
    if (d > cfg.stopDistance) {
      this.body.setVelocity(Math.cos(a) * cfg.speed, Math.sin(a) * cfg.speed);
    } else {
      // side-step while in range
      this.body.setVelocity(Math.cos(a + Math.PI / 2) * cfg.speed * 0.5 * this.strafe, Math.sin(a + Math.PI / 2) * cfg.speed * 0.5 * this.strafe);
      if (Math.random() < 0.01) this.strafe *= -1;
    }
    if (d < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-400, 400);
      const tip = { x: this.x + Math.cos(a) * 30 - Math.sin(a) * 10, y: this.y + Math.sin(a) * 30 + Math.cos(a) * 10 };
      this.world.fireBullet("enemy", tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.muzzle(tip.x, tip.y, a, 0.8);
    }
  }
}

// s2: keeps its distance and lobs grenades over cover.
export class Grenadier extends Enemy {
  readonly score = ENEMIES.s2.score;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "grenadier", ENEMIES.s2.hp, 0.75);
    this.body.setCircle(15, this.width / 2 - 15, this.height / 2 - 15);
    this.setTint(0xd8c090);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.s2;
    const a = this.angleTo(player);
    this.setRotation(a);
    const d = this.distanceTo(player);
    const dir = d < cfg.minDistance ? -1 : d > cfg.maxDistance ? 1 : 0;
    this.body.setVelocity(Math.cos(a) * cfg.speed * dir, Math.sin(a) * cfg.speed * dir);
    if (d < cfg.maxDistance + TILE && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-500, 500);
      const miss = 30;
      this.world.lobGrenade("enemy", this.x, this.y, player.x + Phaser.Math.Between(-miss, miss), player.y + Phaser.Math.Between(-miss, miss));
    }
  }
}

// t1: rolls along the road toward the player, turret tracks and fires shells.
export class Tank extends Enemy {
  readonly score = ENEMIES.t1.score;
  private turret: Phaser.GameObjects.Image;
  private lastTrack = new Phaser.Math.Vector2();

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "tank", ENEMIES.t1.hp, 2.2);
    this.armored = true;
    this.setScale(1.5).setRotation(Math.PI); // sprite faces up; tanks come down the road
    this.body.setSize(this.width * 0.8, this.height * 0.8);
    this.body.setImmovable(true);
    this.turret = world.add.image(x, y, "tank_barrel").setOrigin(0.5, 0.15).setScale(1.5).setDepth(DEPTH.units + 1);
    this.lastTrack.set(x, y);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.t1;
    const dy = player.y - this.y;
    const ahead = this.y + Math.sign(dy) * TILE * 1.1;
    const canMove = Math.abs(dy) > cfg.stopDistance && this.world.isRoadAt(this.x - TILE / 2, ahead) && this.world.isRoadAt(this.x + TILE / 2, ahead);
    this.body.setVelocity(0, canMove ? Math.sign(dy) * cfg.speed : 0);
    this.setRotation(dy >= 0 ? Math.PI : 0);

    const a = this.angleTo(player);
    this.turret.setPosition(this.x, this.y).setRotation(a - Math.PI / 2);

    if (Phaser.Math.Distance.Between(this.x, this.y, this.lastTrack.x, this.lastTrack.y) > 24) {
      this.world.dropTrackDecal(this.x, this.y, this.rotation);
      this.lastTrack.set(this.x, this.y);
    }
    if (this.distanceTo(player) < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval + Phaser.Math.Between(-500, 500);
      const tip = { x: this.x + Math.cos(a) * 70, y: this.y + Math.sin(a) * 70 };
      this.world.fireShell(tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.muzzle(tip.x, tip.y, a, 1.8);
      this.world.cameras.main.shake(80, 0.002);
    }
  }

  protected die() {
    this.world.fx.explosion(this.x, this.y, 2);
    this.world.leaveWreck(this.x, this.y, this.rotation, "tank");
    super.die();
  }

  destroy(fromScene?: boolean) {
    this.turret?.destroy();
    super.destroy(fromScene);
  }
}

// b1: static bunker, gun sweeps a 90° arc facing down, fires often.
export class Bunker extends Enemy {
  readonly score = ENEMIES.b1.score;
  private gun: Phaser.GameObjects.Image;

  constructor(world: GameScene, x: number, y: number) {
    super(world, x, y, "tiles", ENEMIES.b1.hp, 1.3);
    this.setFrame(TILE_FRAMES.bunkerBase[0]).setDepth(DEPTH.obstacles).setTint(0x7d8470);
    this.armored = true;
    this.body.setImmovable(true);
    this.gun = world.add.image(x, y, "tank_barrel").setOrigin(0.5, 0.15).setDepth(DEPTH.obstacles + 1);
    this.shadowImg.setDepth(DEPTH.objShadow);
  }

  think(time: number, player: Phaser.Math.Vector2) {
    const cfg = ENEMIES.b1;
    const down = Math.PI / 2;
    const half = Phaser.Math.DegToRad(cfg.arcDeg / 2);
    const a = Phaser.Math.Clamp(this.angleTo(player), down - half, down + half);
    this.gun.setRotation(a - Math.PI / 2);
    const inArc = Math.abs(Phaser.Math.Angle.Wrap(this.angleTo(player) - down)) <= half;
    if (inArc && this.distanceTo(player) < cfg.range && time > this.nextShot) {
      this.nextShot = time + cfg.fireInterval;
      const tip = { x: this.x + Math.cos(a) * 44, y: this.y + Math.sin(a) * 44 };
      this.world.fireBullet("enemy", tip.x, tip.y, a, cfg.bulletSpeed, cfg.range);
      this.world.fx.muzzle(tip.x, tip.y, a, 1.1);
    }
  }

  protected die() {
    this.world.fx.explosion(this.x, this.y, 1.5);
    this.world.leaveWreck(this.x, this.y, 0, "bunker");
    super.die();
  }

  destroy(fromScene?: boolean) {
    this.gun?.destroy();
    super.destroy(fromScene);
  }
}

export function createEnemy(code: string, world: GameScene, x: number, y: number): Enemy | null {
  switch (code) {
    case "s1": return new Rifleman(world, x, y);
    case "s2": return new Grenadier(world, x, y);
    case "t1": return new Tank(world, x, y);
    case "b1": return new Bunker(world, x, y);
    default: return null;
  }
}
