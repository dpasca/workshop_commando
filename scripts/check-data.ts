// Validates data/enemies.toml and every data/levels/*.toml with the same parsers the game uses,
// and checks that the files are in the canonical format the editor writes (so saving from the
// editor doesn't rewrite a whole file). Run: pnpm check:data
import { readdirSync, readFileSync } from "node:fs";
import { parseEnemies, serializeEnemies } from "../src/data/enemies";
import { checkLevel, summarize } from "../src/data/check";
import { DataError } from "../src/data/errors";
import { parseLevel, serializeLevel } from "../src/data/level";

let failed = false;
const report = (file: string, e: unknown) => {
  failed = true;
  const problems = e instanceof DataError ? e.problems : [(e as Error).message];
  console.error(`✗ ${file}\n${problems.map((p) => `    ${p}`).join("\n")}`);
};

let enemies;
try {
  const text = readFileSync("data/enemies.toml", "utf8");
  enemies = parseEnemies(text);
  console.log(`✓ data/enemies.toml: ${Object.keys(enemies).length} types (${Object.keys(enemies).join(", ")})`);
  if (serializeEnemies(enemies) !== text) console.log("  note: not in the editor's canonical layout (harmless; the next editor save will reformat it)");
} catch (e) {
  report("data/enemies.toml", e);
}

if (enemies) {
  for (const file of readdirSync("data/levels").filter((f) => f.endsWith(".toml")).sort()) {
    try {
      const text = readFileSync(`data/levels/${file}`, "utf8");
      const level = parseLevel(text, enemies);
      const check = checkLevel(level, enemies);
      console.log(`${check.errors.length ? "✗" : "✓"} data/levels/${file}: "${level.name}", ${summarize(check)}`);
      for (const e of check.errors) console.error(`    error: ${e}`);
      for (const w of check.warnings) console.log(`    warning: ${w}`);
      if (check.errors.length) failed = true;
      if (serializeLevel(level) !== text) console.log("  note: not in the editor's canonical layout (harmless; the next editor save will reformat it)");
    } catch (e) {
      report(`data/levels/${file}`, e);
    }
  }
}
process.exit(failed ? 1 : 0);
