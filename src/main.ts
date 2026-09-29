import Phaser from "phaser";
import { VIEW_H, VIEW_W } from "./config";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { HudScene } from "./scenes/HudScene";

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: "game",
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: "#1d2b1d",
  pixelArt: false,
  physics: { default: "arcade", arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, GameScene, HudScene],
});

// Dev-only handle for debugging from the browser console (and for agents driving a browser).
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
