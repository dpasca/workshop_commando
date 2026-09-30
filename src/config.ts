// Game constants. Enemy numbers live in data/enemies.toml, the level in data/levels/.

export const TILE = 64;
export const VIEW_W = 1024; // 16 columns
export const VIEW_H = 768; // 12 rows visible

// Frame indices in public/assets/tiles.png (Kenney tilesheet, 27 columns, tile_N = N - 1).
export const TILE_FRAMES = {
  grass: [0, 1, 2, 3],
  road: [4, 5],
  water: [18, 19],
  bridge: [43],
  wall: [352],
  crate: [128],
  groundDecals: [182, 212, 236, 237, 238, 239],
};

export const PLAYER = {
  speed: 190,
  fireInterval: 110,
  bulletSpeed: 620,
  bulletSpread: 0.06,
  bulletRange: 520,
  startGrenades: 3,
  grenadeRange: 330,
  lives: 3,
  invulnerableMs: 2000,
};

export const GRENADE = {
  flightMs: 700,
  radius: 100,
  damage: 3,
};

export const POW_SCORE = 1000;
export const GRENADE_PICKUP = 3;
export const BARREL = { hp: 2, radius: 120, damage: 4 };
export const CRATE_HP = 3;
