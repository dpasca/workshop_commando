import {
  ATTACK_FIELDS, ATTACK_KINDS, defaultsFor, MOVE_FIELDS, MOVE_KINDS, TYPE_FIELDS,
  type EnemyType, type FieldSpec, type Params,
} from "../data/enemies";
import { SPRITE_KEYS } from "../data/sprites";
import { drawUnit } from "./draw";
import type { Editor } from "./editor";

// Edits the enemy types (data/enemies.toml): stats, one movement primitive, one attack primitive.
// The forms are generated from the field specs in src/data/enemies.ts, so a new field or primitive
// added there shows up here automatically.
export class EnemyForm {
  private code = "";
  private select = document.createElement("select");
  private preview = document.createElement("canvas");
  private body = document.createElement("div");

  constructor(private ed: Editor, host: HTMLElement) {
    const top = document.createElement("div");
    top.className = "row";
    this.preview.width = this.preview.height = 96;
    this.preview.className = "preview";
    const clone = button("Clone as new type…", () => this.clone());
    top.append(this.select, clone, this.preview);
    this.select.addEventListener("change", () => {
      this.code = this.select.value;
      this.build();
    });
    const datalist = document.createElement("datalist");
    datalist.id = "sprite-keys";
    datalist.innerHTML = SPRITE_KEYS.map((k) => `<option value="${k}">`).join("");
    host.append(top, this.body, datalist);
  }

  refresh() {
    const enemies = this.ed.enemies;
    if (!enemies) return;
    if (!enemies[this.code]) this.code = Object.keys(enemies)[0] ?? "";
    this.select.innerHTML = Object.entries(enemies).map(([c, t]) => `<option value="${c}">${c}: ${t.name.split(":")[0]}</option>`).join("");
    this.select.value = this.code;
    this.build();
  }

  drawPreview() {
    const enemies = this.ed.enemies;
    const ctx = this.preview.getContext("2d")!;
    ctx.fillStyle = "#2a8f4f";
    ctx.fillRect(0, 0, 96, 96);
    if (enemies?.[this.code]) drawUnit(ctx, this.code, enemies, 0, 0, 48);
  }

  private changed() {
    this.ed.markEnemiesDirty();
    this.drawPreview();
  }

  private build() {
    const type = this.ed.enemies?.[this.code];
    this.body.replaceChildren();
    if (!type) return;
    this.drawPreview();

    this.section("Type", TYPE_FIELDS, type as unknown as Params, () => this.changed());
    const footprint = document.createElement("label");
    footprint.className = "field";
    footprint.innerHTML = `<span title="cells covered, width x height; the map marks the top-left cell">footprint</span>`;
    for (const i of [0, 1] as const) {
      const input = numberInput({ key: "fp", type: "number", step: 1, min: 1, default: 1 }, type.footprint[i], (v) => {
        type.footprint[i] = Math.max(1, Math.min(4, Math.round(v)));
        this.changed();
      });
      footprint.append(input);
    }
    this.body.children[this.body.children.length - 1].append(footprint);

    this.kindSection("Movement", "move", MOVE_KINDS, MOVE_FIELDS, type);
    this.kindSection("Attack", "attack", ATTACK_KINDS, ATTACK_FIELDS, type);
  }

  private section(title: string, fields: FieldSpec[], target: Params, onChange: () => void) {
    const box = document.createElement("fieldset");
    box.innerHTML = `<legend>${title}</legend>`;
    for (const spec of fields) box.append(fieldRow(spec, target, onChange));
    this.body.append(box);
    return box;
  }

  private kindSection<K extends string>(title: string, group: "move" | "attack", kinds: readonly K[], fields: Record<K, FieldSpec[]>, type: EnemyType) {
    const box = document.createElement("fieldset");
    box.innerHTML = `<legend>${title}</legend>`;
    const kindSpec: FieldSpec = { key: "kind", type: "select", options: kinds, default: kinds[0] };
    const target = type[group] as Params;
    const params = document.createElement("div");
    const fill = () => {
      params.replaceChildren();
      for (const spec of fields[type[group].kind as K]) params.append(fieldRow(spec, target, () => this.changed()));
    };
    box.append(
      fieldRow(kindSpec, target, () => {
        // switching primitive: new defaults, but keep same-named numbers (range, interval, ...)
        const prev = { ...type[group] };
        const next: Params = { kind: prev.kind, ...defaultsFor(fields[prev.kind as K]) };
        for (const k of Object.keys(next)) if (k !== "kind" && typeof prev[k] === typeof next[k]) next[k] = prev[k];
        type[group] = next as never;
        // the object identity changed; rebuild the whole tab so the inputs point at the new one
        this.changed();
        this.build();
      }),
      params,
    );
    fill();
    this.body.append(box);
  }

  private clone() {
    const enemies = this.ed.enemies;
    if (!enemies?.[this.code]) return;
    const code = (prompt("Code for the new type: two characters, a letter then a letter or digit (e.g. s5)") ?? "").trim();
    if (!code) return;
    if (!/^[a-z][a-z0-9]$/.test(code)) return alert(`"${code}" is not a valid code.`);
    if (enemies[code]) return alert(`"${code}" already exists.`);
    enemies[code] = structuredClone(enemies[this.code]);
    enemies[code].name = `${enemies[code].name.split(":")[0]} copy`;
    this.code = code;
    this.ed.markEnemiesDirty();
    this.ed.renderAll();
  }
}

// ------------------------------------------------------------------ inputs

function button(label: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = label;
  b.addEventListener("click", () => {
    onClick();
    b.blur();
  });
  return b;
}

function numberInput(spec: FieldSpec, value: number, onChange: (v: number) => void) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  if (spec.step !== undefined) input.step = String(spec.step);
  if (spec.min !== undefined) input.min = String(spec.min);
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return input;
}

function fieldRow(spec: FieldSpec, target: Params, onChange: () => void) {
  const label = document.createElement("label");
  label.className = "field";
  const name = document.createElement("span");
  name.textContent = spec.key;
  if (spec.help) name.title = spec.help;
  label.append(name);
  const value = target[spec.key] ?? spec.default;

  if (spec.type === "number") {
    label.append(numberInput(spec, value as number, (v) => { target[spec.key] = v; onChange(); }));
  } else if (spec.type === "bool") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value as boolean;
    input.addEventListener("change", () => { target[spec.key] = input.checked; onChange(); });
    label.append(input);
  } else if (spec.type === "select") {
    const select = document.createElement("select");
    select.innerHTML = spec.options!.map((o) => `<option ${o === value ? "selected" : ""}>${o}</option>`).join("");
    select.addEventListener("change", () => { target[spec.key] = select.value; onChange(); });
    label.append(select);
  } else {
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(value);
    if (spec.key === "sprite" || spec.key === "turret") input.setAttribute("list", "sprite-keys");
    input.addEventListener("input", () => { target[spec.key] = input.value; onChange(); });
    label.append(input);
  }
  return label;
}
