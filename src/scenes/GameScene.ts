import Phaser from "phaser";
import { BARREL, CRATE_HP, GRENADE, GRENADE_PICKUP, PLAYER, POW_SCORE, TILE, TILE_FRAMES, VIEW_H, VIEW_W } from "../config";
import { cloneGrid, type Grid } from "../data/level";
import { parseSpriteRef } from "../data/sprites";
import { store, type World } from "../data/store";
import { Enemy } from "../entities/Enemy";
import { Player } from "../entities/Player";
import { DEPTH, Fx } from "../fx";

type Side = "player" | "enemy";
type Obstacle = Phaser.GameObjects.GameObject & { x: number; y: number; getData(k: string): any; setData(k: string, v: any): any };

const WALKABLE = new Set(["..", "rd", "=="]);
const ROAD = new Set(["rd", "=="]);

export class GameScene extends Phaser.Scene {
  fx!: Fx;
  player!: Player;
  grenades = 0;

  world!: World;
  private terrain!: Grid;
  private units!: Grid;
  private rows = 0;
  private cols = 0;

  private solids!: Phaser.Physics.Arcade.StaticGroup;
  private enemies: Enemy[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private playerBullets!: Phaser.Physics.Arcade.Group;
  private enemyBullets!: Phaser.Physics.Arcade.Group;
  private shells!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.StaticGroup;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private wallLayer!: Phaser.Tilemaps.TilemapLayer;

  private score = 0;
  private lives = 0;
  private powsTotal = 0;
  private powsRescued = 0;
  private state: "playing" | "dead" | "won" | "over" = "playing";

  constructor() {
    super("game");
  }

  create() {
    this.enemies = [];
    this.clouds = [];
    this.state = "playing";
    this.world = store.world!;
    this.terrain = cloneGrid(this.world.level.terrain); // copy: barrels and crates clear their cell
    this.units = this.world.level.units;
    this.rows = this.terrain.length;
    this.cols = this.terrain[0].length;
    const worldW = this.cols * TILE, worldH = this.rows * TILE;
    this.physics.world.setBounds(0, 0, worldW, worldH);

    this.fx = new Fx(this);
    this.buildTerrain();

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.shells = this.physics.add.group();
    this.pickups = this.physics.add.staticGroup();

    const start = this.startPosition();
    this.player = new Player(this, start.x, start.y);
    this.buildUnits();

    // collisions
    for (const blocker of [this.groundLayer, this.wallLayer, this.solids] as Phaser.Types.Physics.Arcade.ArcadeColliderType[]) {
      this.physics.add.collider(this.player, blocker);
      this.physics.add.collider(this.enemies, blocker);
    }
    this.physics.add.collider(this.player, this.enemies.filter((e) => e.body.immovable));
    this.physics.add.overlap(this.playerBullets, this.enemies, (a, b) => {
      const [bullet, enemy] = this.split(this.playerBullets, a, b);
      if (!bullet.active) return;
      this.bulletHit(bullet as Phaser.Physics.Arcade.Image);
      (enemy as Enemy).damage(1, true);
    });
    for (const group of [this.playerBullets, this.enemyBullets]) {
      this.physics.add.overlap(group, this.solids, (a, b) => {
        const [bullet, o] = this.split(group, a, b);
        this.bulletVsObstacle(bullet as Phaser.Physics.Arcade.Image, o as Obstacle);
      }, (a, b) => (this.split(group, a, b)[1] as Obstacle).getData("kind") !== "tree");
    }
    this.physics.add.overlap(this.enemyBullets, this.player, (a, b) => {
      const [bullet] = this.split(this.enemyBullets, a, b);
      if (!bullet.active) return;
      this.bulletHit(bullet as Phaser.Physics.Arcade.Image);
      this.hurtPlayer();
    });
    for (const target of [this.player, this.solids] as Phaser.Types.Physics.Arcade.ArcadeColliderType[]) {
      this.physics.add.overlap(this.shells, target, (a, b) => {
        this.explodeShell(this.split(this.shells, a, b)[0] as Phaser.Physics.Arcade.Image);
      }, (a, b) => (this.split(this.shells, a, b)[1] as Obstacle).getData?.("kind") !== "tree");
    }
    this.physics.add.overlap(this.player, this.pickups, (_p, item) => this.collect(item as Phaser.Physics.Arcade.Image));

    // camera: only scrolls up, like the arcade original
    const cam = this.cameras.main;
    cam.setBounds(0, 0, worldW, worldH);
    cam.scrollY = Phaser.Math.Clamp(start.y - (VIEW_H - TILE * 1.2), 0, worldH - VIEW_H);
    // colour grade + vignette as screen-space overlays (works on any renderer)
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0xd9d2bc).setOrigin(0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(DEPTH.screen);
    this.add.image(VIEW_W / 2, VIEW_H / 2, "vignette").setDisplaySize(VIEW_W, VIEW_H).setScrollFactor(0).setDepth(DEPTH.screen + 1);

    this.score = 0;
    this.lives = PLAYER.lives;
    this.setGrenades(PLAYER.startGrenades);
    this.powsRescued = 0;
    this.syncHud();
    this.scene.launch("hud");

    this.input.keyboard!.on("keydown-R", () => this.scene.restart());

    // the files on disk changed (editor, agent, text editor): play the new world
    const off = store.on(({ worldChanged }) => worldChanged && this.scene.restart());
    this.events.once("shutdown", off);
  }

  /** Bottom of the level by default, or the row picked in the editor. */
  private startPosition() {
    const row = store.startRow;
    if (row === null || row >= this.rows) return { x: 8 * TILE, y: this.rows * TILE - TILE * 1.2 };
    for (const c of [7, 8, 6, 9, 5, 10, 4, 11, 3, 12, 2, 13]) {
      if (WALKABLE.has(this.terrain[row][c])) return { x: c * TILE + TILE / 2, y: row * TILE + TILE / 2 };
    }
    return { x: 8 * TILE, y: row * TILE + TILE / 2 };
  }

  update(time: number, delta: number) {
    const worldW = this.cols * TILE;
    for (const c of this.clouds) {
      c.x += (c.getData("speed") * delta) / 1000;
      if (c.x > worldW + 400) c.x = -400;
    }
    if (this.state === "won" || this.state === "over") return;
    this.player.update(time);

    const cam = this.cameras.main;
    // scroll up when the player pushes past 55% of the screen
    const targetScroll = this.player.y - VIEW_H * 0.55;
    if (targetScroll < cam.scrollY) cam.scrollY = Math.max(0, targetScroll);
    // the player can't walk back below the screen
    const bottom = cam.scrollY + VIEW_H - 28;
    if (this.player.y > bottom) {
      this.player.y = bottom;
      this.player.body.setVelocityY(Math.min(0, this.player.body.velocity.y));
    }

    const p = new Phaser.Math.Vector2(this.player.x, this.player.y);
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.y > cam.scrollY + VIEW_H + TILE * 3) { e.destroy(); continue; } // left behind
      const onScreen = e.y > cam.scrollY - TILE && e.y < cam.scrollY + VIEW_H + TILE;
      if (onScreen && this.player.alive) e.update(time, p);
      else e.body.setVelocity(0, 0);
    }
    this.enemies = this.enemies.filter((e) => e.active);

    // bullets stop at walls and range limit
    for (const group of [this.playerBullets, this.enemyBullets, this.shells]) {
      for (const obj of [...group.getChildren()] as Phaser.Physics.Arcade.Image[]) {
        const travelled = Phaser.Math.Distance.Between(obj.x, obj.y, obj.getData("x0"), obj.getData("y0"));
        if (this.terrainAt(obj.x, obj.y) === "##" || travelled > obj.getData("range")) {
          if (group === this.shells) this.explodeShell(obj);
          else this.bulletHit(obj);
        }
      }
    }

    if (this.player.alive && this.player.y < TILE * 0.8) this.win();
  }

  // ---------------------------------------------------------------- terrain

  private buildTerrain() {
    const pick = (a: number[]) => a[Math.floor(Math.random() * a.length)];
    const ground = this.terrain.map((row) =>
      row.map((c) => (c === "rd" ? pick(TILE_FRAMES.road) : c === "~~" ? pick(TILE_FRAMES.water) : c === "==" ? pick(TILE_FRAMES.bridge) : pick(TILE_FRAMES.grass))),
    );
    const walls = this.terrain.map((row) => row.map((c) => (c === "##" ? TILE_FRAMES.wall[0] : -1)));

    const gMap = this.make.tilemap({ data: ground, tileWidth: TILE, tileHeight: TILE });
    this.groundLayer = gMap.createLayer(0, gMap.addTilesetImage("tiles", "tiles_extruded", TILE, TILE, 1, 2)!, 0, 0)!.setDepth(DEPTH.ground);
    this.groundLayer.setCollision(TILE_FRAMES.water);

    const wMap = this.make.tilemap({ data: walls, tileWidth: TILE, tileHeight: TILE });
    this.wallLayer = wMap.createLayer(0, wMap.addTilesetImage("tiles", "tiles_extruded", TILE, TILE, 1, 2)!, 0, 0)!.setDepth(DEPTH.walls);
    this.wallLayer.setCollisionByExclusion([-1]);

    const shadows = this.add.graphics().setDepth(DEPTH.wallShadow);
    shadows.fillStyle(0x000000, 0.45);
    this.solids = this.physics.add.staticGroup();

    this.forEachCell(this.terrain, (code, x, y) => {
      if (code === "##") shadows.fillRect(x - TILE / 2 + 12, y - TILE / 2 + 14, TILE, TILE);
      else if (code === "sb") this.addObstacle(this.add.image(x, y, "sandbag"), "sandbag", 999);
      else if (code === "bx") this.addObstacle(this.add.image(x, y, "barrel_red"), "barrel", BARREL.hp);
      else if (code === "cr") this.addObstacle(this.add.image(x, y, "tiles", TILE_FRAMES.crate[0]), "crate", CRATE_HP);
      else if (code === "tr") this.addTree(x, y);
    });

    this.decorateGround();
    this.addWaterShimmer();
    this.addCloudShadows();
  }

  // Cosmetic: tile tint variation, scattered rocks and plants, soft road and river edges.
  private decorateGround() {
    this.wallLayer.forEachTile((t) => { if (t.index >= 0) t.tint = 0x8f9aa3; });
    const edges = this.add.graphics().setDepth(DEPTH.decals);
    const at = (r: number, c: number) => this.terrain[r]?.[c];
    this.forEachCell(this.terrain, (code, x, y) => {
      const r = Math.floor(y / TILE), c = Math.floor(x / TILE);
      const left = x - TILE / 2, top = y - TILE / 2;
      if (code === "..") {
        if (Math.random() < 0.35) {
          this.add.image(x + Phaser.Math.Between(-20, 20), y + Phaser.Math.Between(-20, 20), "tiles", Phaser.Utils.Array.GetRandom(TILE_FRAMES.groundDecals))
            .setScale(Phaser.Math.FloatBetween(0.35, 0.6)).setRotation(Math.random() * Math.PI * 2).setAlpha(0.8).setDepth(DEPTH.decals);
        }
      }
      if (code === "rd") {
        edges.fillStyle(0x000000, 0.18);
        if (at(r, c - 1) !== "rd") edges.fillRect(left, top, 6, TILE);
        if (at(r, c + 1) !== "rd") edges.fillRect(left + TILE - 6, top, 6, TILE);
      }
      if (code === "~~" || code === "==") {
        // dark bank above/below the river, lighter foam line on the water
        if (at(r - 1, c) !== "~~" && at(r - 1, c) !== "==") {
          edges.fillStyle(0x000000, 0.3).fillRect(left, top, TILE, 10);
          if (code === "~~") edges.fillStyle(0xffffff, 0.25).fillRect(left, top + 10, TILE, 3);
        }
        if (at(r + 1, c) !== "~~" && at(r + 1, c) !== "==") {
          edges.fillStyle(0x000000, 0.2).fillRect(left, top + TILE - 6, TILE, 6);
        }
      }
    });
  }

  // Big soft shadows drifting over the battlefield.
  private addCloudShadows() {
    const worldW = this.cols * TILE, worldH = this.rows * TILE;
    for (let y = 0; y < worldH; y += 520) {
      const cloud = this.add.image(Phaser.Math.Between(0, worldW), y + Phaser.Math.Between(0, 300), "shadow")
        .setScale(Phaser.Math.FloatBetween(7, 11), Phaser.Math.FloatBetween(4, 6))
        .setAlpha(0.22).setDepth(DEPTH.canopy + 1);
      cloud.setData("speed", Phaser.Math.Between(12, 22));
      this.clouds.push(cloud);
    }
  }

  private addObstacle(img: Phaser.GameObjects.Image, kind: string, hp: number) {
    img.setDepth(DEPTH.obstacles).setData("kind", kind).setData("hp", hp);
    img.setData("shadowImg", this.add.image(img.x + 6, img.y + 8, "shadow").setScale(1.1).setDepth(DEPTH.objShadow));
    this.solids.add(img);
    const body = img.body as Phaser.Physics.Arcade.StaticBody;
    if (kind === "barrel") body.setCircle(18, img.width / 2 - 18, img.height / 2 - 18);
  }

  private addTree(x: number, y: number) {
    const big = Math.random() < 0.6;
    const canopy = this.add
      .image(x + Phaser.Math.Between(-6, 6), y + Phaser.Math.Between(-6, 6), big ? "tree_large" : "tree_small")
      .setDepth(DEPTH.canopy)
      .setRotation(Math.random() * Math.PI * 2)
      .setScale(big ? 1.05 : 1.2);
    this.add.image(x + 14, y + 18, "shadow").setScale(big ? 2.4 : 1.8).setDepth(DEPTH.objShadow).setAlpha(0.8);
    // gentle sway
    this.tweens.add({ targets: canopy, scale: canopy.scale * 1.03, duration: 1800 + Math.random() * 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    const trunk = this.add.zone(x, y, 30, 30).setData("kind", "tree");
    this.solids.add(trunk);
  }

  private addWaterShimmer() {
    this.forEachCell(this.terrain, (code, x, y) => {
      if (code !== "~~") return;
      for (let i = 0; i < 2; i++) {
        const g = this.add.image(x + Phaser.Math.Between(-24, 24), y + Phaser.Math.Between(-24, 24), "glow")
          .setDepth(DEPTH.decals).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5, 0.15).setAlpha(0);
        this.tweens.add({ targets: g, alpha: 0.5, x: g.x + 12, duration: 1200 + Math.random() * 1500, delay: Math.random() * 3000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }
    });
  }

  // ---------------------------------------------------------------- units

  private buildUnits() {
    this.powsTotal = 0;
    this.forEachCell(this.units, (code, x, y) => {
      const def = this.world.enemies[code];
      if (def) {
        // multi-cell units are marked by their top-left cell; centre them on their footprint
        this.enemies.push(new Enemy(this, x + ((def.footprint[0] - 1) * TILE) / 2, y + ((def.footprint[1] - 1) * TILE) / 2, code, def));
        return;
      }
      if (code === "h1") {
        this.powsTotal++;
        const pow = this.pickups.create(x, y, "pow").setData("kind", "pow").setDepth(DEPTH.units).setRotation(Math.PI / 2);
        const help = this.add.text(x, y - 38, "HELP!", { fontFamily: "Avenir Next, Arial", fontSize: "14px", fontStyle: "bold", color: "#fff" })
          .setOrigin(0.5).setStroke("#000", 3).setDepth(DEPTH.text);
        pow.setData("label", help);
        this.tweens.add({ targets: help, y: help.y - 6, duration: 500, yoyo: true, repeat: -1 });
      } else if (code === "g1") {
        const box = this.pickups.create(x, y, "grenade_box").setData("kind", "grenades").setDepth(DEPTH.obstacles);
        this.tweens.add({ targets: box, scale: 1.15, duration: 600, yoyo: true, repeat: -1 });
      }
    });
  }

  onEnemyKilled(e: Enemy) {
    this.addScore(e.score);
    this.fx.floatingText(e.x, e.y - 20, `${e.score}`);
  }

  /** What is left behind: a fading body for soldiers, a smoking wreck for vehicles and bunkers. */
  leaveWreck(e: Enemy) {
    const { x, y, rotation } = e;
    const [texture, frame] = parseSpriteRef(e.def.sprite);
    if (e.def.death === "soldier") {
      const body = this.add.image(x, y, texture, frame).setRotation(rotation).setScale(e.def.scale).setTint(0x333333).setAlpha(0.55).setDepth(DEPTH.decals);
      this.tweens.add({ targets: body, alpha: 0, delay: 4000, duration: 2000, onComplete: () => body.destroy() });
      return;
    }
    this.add.image(x, y, texture, frame).setRotation(rotation).setScale(e.def.scale).setTint(0x2a2a2a).setDepth(DEPTH.decals + 0.5);
    // smoke keeps rising from the wreck
    this.time.addEvent({
      delay: 220, repeat: 40, callback: () => {
        const s = this.add.image(x + Phaser.Math.Between(-10, 10), y, `smoke_grey${Phaser.Math.Between(0, 5)}`).setDepth(DEPTH.fx - 1).setScale(0.25).setAlpha(0.6);
        this.tweens.add({ targets: s, y: y - 90, x: s.x + 20, scale: 0.8, alpha: 0, duration: 2200, onComplete: () => s.destroy() });
      },
    });
  }

  dropTrackDecal(x: number, y: number, rotation: number) {
    const t = this.add.image(x, y, "tracks").setRotation(rotation).setDepth(DEPTH.decals).setAlpha(0.35).setScale(1.4);
    this.tweens.add({ targets: t, alpha: 0, delay: 5000, duration: 3000, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- weapons

  fireBullet(side: Side, x: number, y: number, angle: number, speed: number, range: number) {
    const group = side === "player" ? this.playerBullets : this.enemyBullets;
    const b = group.create(x, y, side === "player" ? "bullet_player" : "bullet_enemy") as Phaser.Physics.Arcade.Image;
    b.setDepth(DEPTH.bullets).setRotation(angle + Math.PI / 2).setScale(side === "player" ? 0.55 : 0.45).setBlendMode(Phaser.BlendModes.ADD);
    b.setData({ x0: x, y0: y, range });
    b.body!.setSize(10, 10);
    this.physics.velocityFromRotation(angle, speed, b.body!.velocity);
    if (side === "enemy") b.setTint(0xff6040);
  }

  fireShell(x: number, y: number, angle: number, speed: number, range: number) {
    const s = this.shells.create(x, y, "shell") as Phaser.Physics.Arcade.Image;
    s.setDepth(DEPTH.bullets).setRotation(angle + Math.PI / 2).setScale(1.1).setData({ x0: x, y0: y, range });
    this.physics.velocityFromRotation(angle, speed, s.body!.velocity);
  }

  lobGrenade(side: Side, x0: number, y0: number, x1: number, y1: number) {
    const g = this.add.image(x0, y0, "grenade").setDepth(DEPTH.bullets);
    const shadow = this.add.image(x0, y0, "shadow").setScale(0.3).setDepth(DEPTH.unitShadow);
    const state = { t: 0 };
    this.tweens.add({
      targets: state,
      t: 1,
      duration: GRENADE.flightMs,
      onUpdate: () => {
        const x = Phaser.Math.Linear(x0, x1, state.t), y = Phaser.Math.Linear(y0, y1, state.t);
        const h = Math.sin(state.t * Math.PI) * 70;
        shadow.setPosition(x, y);
        g.setPosition(x, y - h).setScale(1 + h / 60).setRotation(state.t * 12);
      },
      onComplete: () => {
        g.destroy();
        shadow.destroy();
        this.explodeAt(x1, y1, GRENADE.radius, GRENADE.damage, side, 1);
      },
    });
  }

  /** Area damage. Player grenades hurt enemies; enemy grenades hurt the player; barrels hurt everyone. */
  explodeAt(x: number, y: number, radius: number, damage: number, side: Side | "all", size: number) {
    this.fx.explosion(x, y, size);
    const inRange = (o: { x: number; y: number }) => Phaser.Math.Distance.Between(x, y, o.x, o.y) < radius;
    if (side !== "enemy") for (const e of [...this.enemies]) if (e.active && inRange(e)) e.damage(damage, false);
    if (side !== "player" && this.player.alive && inRange(this.player)) this.hurtPlayer();
    for (const o of [...(this.solids.getChildren() as unknown as Obstacle[])]) {
      if (o.active && inRange(o) && (o.getData("kind") === "barrel" || o.getData("kind") === "crate")) {
        this.time.delayedCall(90, () => this.damageObstacle(o, damage));
      }
    }
  }

  private bulletHit(b: Phaser.Physics.Arcade.Image) {
    if (!b.active) return;
    this.fx.impact(b.x, b.y);
    b.destroy();
  }

  private bulletVsObstacle(b: Phaser.Physics.Arcade.Image, o: Obstacle) {
    if (!b.active) return;
    this.bulletHit(b);
    this.damageObstacle(o, 1);
  }

  private explodeShell(s: Phaser.Physics.Arcade.Image) {
    if (!s.active) return;
    const { x, y } = s;
    s.destroy();
    this.explodeAt(x, y, 60, 2, "enemy", 0.7);
  }

  private damageObstacle(o: Obstacle, amount: number) {
    if (!o.active) return;
    const kind = o.getData("kind");
    if (kind !== "barrel" && kind !== "crate") return;
    const hp = o.getData("hp") - amount;
    o.setData("hp", hp);
    if (o instanceof Phaser.GameObjects.Image) this.fx.hitFlash(o);
    if (hp > 0) return;
    const { x, y } = o;
    o.getData("shadowImg")?.destroy();
    o.destroy();
    this.setTerrainAt(x, y, "..");
    if (kind === "barrel") this.explodeAt(x, y, BARREL.radius, BARREL.damage, "all", 1.4);
    else this.fx.explosion(x, y, 0.4);
  }

  // ---------------------------------------------------------------- player

  private hurtPlayer() {
    if (!this.player.alive || this.time.now < this.player.invulnerableUntil || this.state !== "playing") return;
    this.player.alive = false;
    this.player.body.setVelocity(0, 0);
    this.player.setVisible(false);
    this.fx.explosion(this.player.x, this.player.y, 0.5);
    this.lives--;
    this.syncHud();
    if (this.lives <= 0) {
      this.state = "over";
      this.time.delayedCall(900, () => this.events.emit("gameover", { won: false, score: this.score }));
      return;
    }
    this.time.delayedCall(1200, () => this.respawn());
  }

  private respawn() {
    const cam = this.cameras.main;
    // find a walkable cell near the bottom centre of the screen
    const row = Math.min(this.rows - 1, Math.floor((cam.scrollY + VIEW_H - TILE) / TILE));
    let best = { x: this.player.x, y: this.player.y };
    for (let r = row; r > row - 4; r--) {
      const cols = [7, 8, 6, 9, 5, 10, 4, 11];
      const c = cols.find((c) => WALKABLE.has(this.terrain[r][c]));
      if (c !== undefined) { best = { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }; break; }
    }
    this.player.setPosition(best.x, best.y).setVisible(true);
    this.player.alive = true;
    this.player.invulnerableUntil = this.time.now + PLAYER.invulnerableMs;
  }

  private collect(item: Phaser.Physics.Arcade.Image) {
    if (!item.active) return;
    if (item.getData("kind") === "pow") {
      this.powsRescued++;
      this.addScore(POW_SCORE);
      this.fx.floatingText(item.x, item.y - 30, "RESCUED!", "#9fffa0");
      item.getData("label")?.destroy();
      item.disableBody(true, false);
      this.tweens.add({ targets: item, y: item.y + 300, alpha: 0, duration: 2000, onComplete: () => item.destroy() });
    } else {
      this.setGrenades(this.grenades + GRENADE_PICKUP);
      this.fx.floatingText(item.x, item.y - 20, `+${GRENADE_PICKUP} GRENADES`, "#ffe27a");
      item.destroy();
    }
    this.syncHud();
  }

  private win() {
    this.state = "won";
    this.player.body.setVelocity(0, 0);
    this.events.emit("gameover", { won: true, score: this.score + this.lives * 500 });
  }

  // ---------------------------------------------------------------- helpers

  /** Arcade callbacks don't guarantee argument order; returns [member of group, other]. */
  private split(group: Phaser.Physics.Arcade.Group, a: unknown, b: unknown): [Phaser.GameObjects.GameObject, Phaser.GameObjects.GameObject] {
    const ga = a as Phaser.GameObjects.GameObject, gb = b as Phaser.GameObjects.GameObject;
    return group.contains(ga) ? [ga, gb] : [gb, ga];
  }

  setGrenades(n: number) {
    this.grenades = n;
    this.syncHud();
  }

  private addScore(n: number) {
    this.score += n;
    this.syncHud();
  }

  private syncHud() {
    this.registry.set("hud", { score: this.score, lives: this.lives, grenades: this.grenades, pows: this.powsRescued, powsTotal: this.powsTotal });
  }

  private forEachCell(grid: Grid, fn: (code: string, x: number, y: number) => void) {
    grid.forEach((row, r) => row.forEach((code, c) => fn(code, c * TILE + TILE / 2, r * TILE + TILE / 2)));
  }

  private cellAt(x: number, y: number) {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols ? { r, c } : null;
  }

  terrainAt(x: number, y: number) {
    const cell = this.cellAt(x, y);
    return cell ? this.terrain[cell.r][cell.c] : "##";
  }

  private setTerrainAt(x: number, y: number, code: string) {
    const cell = this.cellAt(x, y);
    if (cell) this.terrain[cell.r][cell.c] = code;
  }

  isRoadAt(x: number, y: number) {
    return ROAD.has(this.terrainAt(x, y));
  }
}
