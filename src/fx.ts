import Phaser from "phaser";

// Depth layers, bottom to top.
export const DEPTH = {
  ground: 0,
  decals: 1,
  wallShadow: 2,
  walls: 3,
  objShadow: 4,
  obstacles: 5,
  unitShadow: 6,
  units: 10,
  bullets: 12,
  fx: 15,
  canopy: 20,
  text: 30,
  screen: 40,
};

// Visual effects. Everything here is cosmetic: no gameplay state.
export class Fx {
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private scene: Phaser.Scene) {
    this.sparks = scene.add.particles(0, 0, "spark", {
      speed: { min: 120, max: 420 },
      lifespan: { min: 200, max: 500 },
      scale: { start: 1.4, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.sparks.setDepth(DEPTH.fx + 1);
    this.debris = scene.add.particles(0, 0, "tiles", {
      frame: [0],
      speed: { min: 60, max: 220 },
      lifespan: { min: 300, max: 700 },
      scale: { start: 0.12, end: 0.04 },
      rotate: { min: 0, max: 360 },
      tint: [0x5a4a3a, 0x7a6a5a, 0x3a3a3a],
      emitting: false,
    });
    this.debris.setDepth(DEPTH.fx);
  }

  explosion(x: number, y: number, size = 1) {
    const s = this.scene;
    // flash
    const flash = s.add.image(x, y, "flash").setDepth(DEPTH.fx + 2).setBlendMode(Phaser.BlendModes.ADD).setScale(2.5 * size);
    s.tweens.add({ targets: flash, alpha: 0, scale: 4 * size, duration: 180, onComplete: () => flash.destroy() });

    // fireballs
    for (let i = 0; i < 5 + 3 * size; i++) {
      const frame = Phaser.Math.Between(0, 5);
      const fb = s.add
        .image(x + Phaser.Math.Between(-20, 20) * size, y + Phaser.Math.Between(-20, 20) * size, `smoke_orange${frame}`)
        .setDepth(DEPTH.fx)
        .setScale(0.3 * size)
        .setRotation(Math.random() * Math.PI * 2);
      s.tweens.add({
        targets: fb,
        scale: (0.7 + Math.random() * 0.5) * size,
        alpha: 0,
        duration: 350 + Math.random() * 250,
        delay: i * 25,
        onComplete: () => fb.destroy(),
      });
    }
    // lingering smoke
    for (let i = 0; i < 4 + 2 * size; i++) {
      const sm = s.add
        .image(x + Phaser.Math.Between(-24, 24) * size, y + Phaser.Math.Between(-24, 24) * size, `smoke_grey${Phaser.Math.Between(0, 5)}`)
        .setDepth(DEPTH.fx - 1)
        .setAlpha(0.7)
        .setScale(0.4 * size);
      s.tweens.add({
        targets: sm,
        y: sm.y - 40,
        scale: 1.1 * size,
        alpha: 0,
        duration: 1400 + Math.random() * 800,
        delay: 150 + i * 60,
        onComplete: () => sm.destroy(),
      });
    }
    this.sparks.explode(Math.round(18 * size), x, y);
    this.debris.explode(Math.round(10 * size), x, y);
    this.scorch(x, y, size);
    s.cameras.main.shake(120 + 120 * size, 0.004 * size);
  }

  scorch(x: number, y: number, size = 1) {
    const sc = this.scene.add
      .image(x, y, "scorch")
      .setDepth(DEPTH.decals)
      .setAlpha(0.45)
      .setScale(0.7 * size)
      .setRotation(Math.random() * Math.PI * 2);
    this.scene.tweens.add({ targets: sc, alpha: 0.25, duration: 20000 });
  }

  muzzle(x: number, y: number, rotation: number, size = 1) {
    const f = this.scene.add
      .image(x, y, "flash")
      .setDepth(DEPTH.fx)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.45 * size, 0.3 * size)
      .setRotation(rotation);
    this.scene.time.delayedCall(40, () => f.destroy());
  }

  impact(x: number, y: number) {
    this.sparks.explode(5, x, y);
    const puff = this.scene.add.image(x, y, `smoke_white${Phaser.Math.Between(0, 5)}`).setDepth(DEPTH.fx).setScale(0.15).setAlpha(0.7);
    this.scene.tweens.add({ targets: puff, scale: 0.35, alpha: 0, duration: 300, onComplete: () => puff.destroy() });
  }

  hitFlash(target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) {
    const prev = target.tintTopLeft;
    target.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => target.active && target.setTint(prev));
  }

  floatingText(x: number, y: number, text: string, color = "#ffe27a") {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: "Avenir Next, Helvetica, Arial", fontSize: "20px", fontStyle: "bold", color })
      .setOrigin(0.5)
      .setDepth(DEPTH.text)
      .setStroke("#000", 4);
    this.scene.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  // Soft shadow that follows a unit.
  shadow(scale = 1) {
    return this.scene.add.image(0, 0, "shadow").setDepth(DEPTH.unitShadow).setScale(scale);
  }
}
