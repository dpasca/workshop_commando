import Phaser from "phaser";
import { VIEW_H, VIEW_W } from "../config";
import { LEVEL_NAME } from "../level";

type Hud = { score: number; lives: number; grenades: number; pows: number; powsTotal: number };

// Score, lives, grenades, POWs, plus the start and end overlays.
export class HudScene extends Phaser.Scene {
  private text!: Phaser.GameObjects.Text;

  constructor() {
    super("hud");
  }

  create() {
    const style = { fontFamily: "Avenir Next, Helvetica, Arial", fontSize: "20px", fontStyle: "bold", color: "#ffffff" };
    this.add.rectangle(0, 0, VIEW_W, 40, 0x000000, 0.45).setOrigin(0);
    this.text = this.add.text(16, 9, "", style).setStroke("#000", 3);
    this.refresh(this.registry.get("hud"));
    const onChange = (_p: unknown, key: string, value: Hud) => key === "hud" && this.refresh(value);
    this.registry.events.on("changedata", onChange);
    this.events.once("shutdown", () => this.registry.events.off("changedata", onChange));

    const game = this.scene.get("game");
    game.events.once("gameover", (r: { won: boolean; score: number }) => this.showEnd(r.won, r.score));
    game.events.once("shutdown", () => this.scene.stop());

    this.banner(LEVEL_NAME.toUpperCase(), "WASD move · mouse aim · click fire · SPACE / right-click grenade", 2000);
  }

  private refresh(h?: Hud) {
    if (!h) return;
    this.text.setText(
      `SCORE ${String(h.score).padStart(6, "0")}    LIVES ${"♥".repeat(Math.max(0, h.lives))}    GRENADES ${h.grenades}    POW ${h.pows}/${h.powsTotal}`,
    );
  }

  private banner(title: string, sub: string, ms?: number) {
    const c = this.add.container(VIEW_W / 2, VIEW_H / 2 - 40);
    const t = this.add.text(0, 0, title, { fontFamily: "Avenir Next, Arial", fontSize: "56px", fontStyle: "bold", color: "#ffe27a" }).setOrigin(0.5).setStroke("#000", 8);
    const s = this.add.text(0, 52, sub, { fontFamily: "Avenir Next, Arial", fontSize: "20px", color: "#ffffff" }).setOrigin(0.5).setStroke("#000", 4);
    c.add([t, s]);
    if (ms) this.tweens.add({ targets: c, alpha: 0, delay: ms, duration: 600, onComplete: () => c.destroy() });
  }

  private showEnd(won: boolean, score: number) {
    this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x000000, 0.5).setOrigin(0);
    this.banner(won ? "MISSION COMPLETE" : "GAME OVER", `score ${score} · press R to play again`);
  }
}
