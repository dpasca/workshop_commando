// Image keys loaded by BootScene from public/assets/<key>.png.
export const SPRITE_KEYS = [
  "player", "rifleman", "grenadier", "guard", "pow", "tank", "tank_barrel",
  "sandbag", "tree_large", "tree_small", "barrel_red", "tracks", "scorch",
  "bullet_player", "bullet_enemy", "shell",
] as const;

export const SMOKE_COLORS = ["orange", "grey", "white", "yellow"] as const;

/** A sprite reference is an image key ("rifleman") or a frame of the tilesheet ("tiles:356"). */
export function isValidSpriteRef(ref: string): boolean {
  if (/^tiles:\d+$/.test(ref)) return true;
  return (SPRITE_KEYS as readonly string[]).includes(ref);
}

/** "tiles:356" -> ["tiles", 356]; "rifleman" -> ["rifleman", undefined]. */
export function parseSpriteRef(ref: string): [string, number | undefined] {
  const m = ref.match(/^tiles:(\d+)$/);
  return m ? ["tiles", Number(m[1])] : [ref, undefined];
}
