import { parseEnemies, type EnemyTypes } from "./enemies";
import { DataError } from "./errors";
import { parseLevel, type LevelData } from "./level";

export interface World {
  level: LevelData;
  enemies: EnemyTypes;
}

type Listener = (change: { worldChanged: boolean }) => void;

// The one place that knows what is on disk. The game plays `world`; the editor edits copies of it.
// Whenever a file changes on disk (any writer), refresh() re-reads it. If the new files are valid the
// world is replaced and everybody is told; if not, the last good world keeps running and `errors` says why.
class Store {
  levelName = new URLSearchParams(location.search).get("level") ?? "river_crossing";
  levelText = "";
  enemiesText = "";
  world: World | null = null;
  errors: string[] = [];
  /** Row to start playing from; null = the bottom of the level. Set by the editor. */
  startRow: number | null = null;
  private listeners = new Set<Listener>();

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(worldChanged: boolean) {
    for (const fn of [...this.listeners]) fn({ worldChanged });
  }

  async refresh(force = false): Promise<void> {
    let enemiesText: string, levelText: string;
    try {
      [enemiesText, levelText] = await Promise.all([this.fetchText("/api/enemies"), this.fetchText(`/api/level/${this.levelName}`)]);
    } catch (e) {
      this.errors = [(e as Error).message];
      return this.emit(false);
    }
    if (!force && enemiesText === this.enemiesText && levelText === this.levelText) return;
    this.enemiesText = enemiesText;
    this.levelText = levelText;
    let worldChanged = false;
    try {
      const enemies = parseEnemies(enemiesText);
      this.world = { enemies, level: parseLevel(levelText, enemies) };
      this.errors = [];
      worldChanged = true;
    } catch (e) {
      this.errors = e instanceof DataError ? e.problems : [(e as Error).message];
    }
    this.emit(worldChanged);
  }

  async switchLevel(name: string) {
    this.levelName = name;
    this.startRow = null;
    const url = new URL(location.href);
    url.searchParams.set("level", name);
    history.replaceState(null, "", url);
    await this.refresh(true);
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ errors: [res.statusText] }));
      throw new Error((body.errors ?? [res.statusText]).join("; "));
    }
    return res.text();
  }

  async put(url: string, text: string): Promise<string[]> {
    const res = await fetch(url, { method: "PUT", body: text });
    if (res.ok) return [];
    const body = await res.json().catch(() => ({ errors: [res.statusText] }));
    return body.errors ?? [res.statusText];
  }
}

export const store = new Store();

// Any change to data/*.toml on disk, from any writer, reloads the world.
if (import.meta.hot) {
  import.meta.hot.on("workshop:data-changed", () => void store.refresh());
}
