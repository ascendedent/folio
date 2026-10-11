import type { Document, Element } from "@xmldom/xmldom";
import { characterBase, characterNames, linkBeatsToScenes, locationStats, sceneSpans, slugLocation, type SceneSpan } from "./edit.js";
import { paragraphText, type Paragraph, type PreservedElement, type Script } from "./model.js";
import { ACTION_WIDTH, DIALOGUE_WIDTH, LINES_PER_PAGE, PAREN_WIDTH, wrapText } from "./text/layout.js";
import { parseXml } from "./xml.js";

export const SCENE_ID = "FolioId";

export const DEPARTMENTS = [
  "cast",
  "extras",
  "props",
  "wardrobe",
  "makeup",
  "vehicles",
  "animals",
  "stunts",
  "sfx",
  "vfx",
  "sound",
  "set",
  "notes",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const BUDGET_CATEGORIES = [
  "Story",
  "Cast",
  "Production",
  "Camera",
  "Art",
  "Locations",
  "Wardrobe / Makeup",
  "Sound",
  "Post",
  "Insurance / Other",
] as const;

export const SHOT_SIZES = ["WS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "INSERT"] as const;

export type CutStatus = "cut" | "omit" | "lift" | "hold";

export interface PersonNote {
  name: string;
  role: string;
  actor: string;
  note: string;
}

export interface BreakdownTag {
  id: string;
  sceneId: string;
  department: Department;
  text: string;
}

export interface StoryFrame {
  id: string;
  sceneId: string;
  order: number;
  size: string;
  angle: string;
  description: string;
  audio: string;
  sketch: string;
  image: string;
  movement: string;
}

export interface CatalogItem {
  id: string;
  department: string;
  name: string;
  note: string;
  image: string;
  rate: number;
}

export interface BudgetLine {
  id: string;
  category: string;
  description: string;
  quantity: number;
  rate: number;
  days: number;
  actual: number;
  sceneId: string;
  /** Set when the line was created from a catalog item. */
  catalogId?: string;
}

export interface ShootDay {
  id: string;
  label: string;
  date: string;
  call: string;
  notes: string;
  sceneIds: string[];
}

export interface AssemblyMark {
  sceneId: string;
  status: CutStatus;
  note: string;
  order: number;
}

export interface Snapshot {
  id: string;
  name: string;
  savedAt: number;
  script: Script;
}

export interface Production {
  people: PersonNote[];
  tags: BreakdownTag[];
  frames: StoryFrame[];
  budget: BudgetLine[];
  days: ShootDay[];
  assembly: AssemblyMark[];
  catalog: CatalogItem[];
  snapshots: Snapshot[];
}

export function emptyProduction(): Production {
  return { people: [], tags: [], frames: [], budget: [], days: [], assembly: [], catalog: [], snapshots: [] };
}

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function departmentOf(value: unknown): Department {
  return DEPARTMENTS.includes(value as Department) ? (value as Department) : "notes";
}

function statusOf(value: unknown): CutStatus {
  return value === "omit" || value === "lift" || value === "hold" || value === "cut" ? value : "cut";
}

export function normalizeProduction(value: unknown): Production {
  const raw = value && typeof value === "object" ? (value as Partial<Production>) : {};
  const production = emptyProduction();
  for (const person of Array.isArray(raw.people) ? raw.people : []) {
    const item = person as Partial<PersonNote>;
    const name = characterBase(textOf(item.name));
    if (!name) continue;
    production.people.push({ name, role: textOf(item.role), actor: textOf(item.actor), note: textOf(item.note) });
  }
  for (const tag of Array.isArray(raw.tags) ? raw.tags : []) {
    const item = tag as Partial<BreakdownTag>;
    if (!textOf(item.sceneId) || !textOf(item.text)) continue;
    production.tags.push({
      id: textOf(item.id) || uid("tag"),
      sceneId: textOf(item.sceneId),
      department: departmentOf(item.department),
      text: textOf(item.text),
    });
  }
  for (const frame of Array.isArray(raw.frames) ? raw.frames : []) {
    const item = frame as Partial<StoryFrame>;
    if (!textOf(item.sceneId)) continue;
    production.frames.push({
      id: textOf(item.id) || uid("fr"),
      sceneId: textOf(item.sceneId),
      order: numberOf(item.order),
      size: textOf(item.size) || "MS",
      angle: textOf(item.angle) || "Eye level",
      description: textOf(item.description),
      audio: textOf(item.audio),
      sketch: textOf(item.sketch),
      image: textOf(item.image),
      movement: textOf(item.movement),
    });
  }
  for (const asset of Array.isArray(raw.catalog) ? raw.catalog : []) {
    const item = asset as Partial<CatalogItem>;
    const name = textOf(item.name).trim();
    if (!name) continue;
    production.catalog.push({
      id: textOf(item.id) || uid("cat"),
      department: textOf(item.department) || "notes",
      name,
      note: textOf(item.note),
      image: textOf(item.image),
      rate: numberOf(item.rate),
    });
  }
  for (const line of Array.isArray(raw.budget) ? raw.budget : []) {
    const item = line as Partial<BudgetLine>;
    production.budget.push({
      id: textOf(item.id) || uid("bd"),
      category: textOf(item.category) || "Other",
      description: textOf(item.description),
      quantity: numberOf(item.quantity) || 1,
      rate: numberOf(item.rate),
      days: numberOf(item.days) || 1,
      actual: numberOf(item.actual),
      sceneId: textOf(item.sceneId),
      ...(textOf(item.catalogId) ? { catalogId: textOf(item.catalogId) } : {}),
    });
  }
  for (const day of Array.isArray(raw.days) ? raw.days : []) {
    const item = day as Partial<ShootDay>;
    production.days.push({
      id: textOf(item.id) || uid("day"),
      label: textOf(item.label) || "Day",
      date: textOf(item.date),
      call: textOf(item.call) || "07:00",
      notes: textOf(item.notes),
      sceneIds: Array.isArray(item.sceneIds) ? item.sceneIds.filter((id): id is string => typeof id === "string") : [],
    });
  }
  for (const mark of Array.isArray(raw.assembly) ? raw.assembly : []) {
    const item = mark as Partial<AssemblyMark>;
    if (!textOf(item.sceneId)) continue;
    production.assembly.push({
      sceneId: textOf(item.sceneId),
      status: statusOf(item.status),
      note: textOf(item.note),
      order: numberOf(item.order),
    });
  }
  for (const snapshot of Array.isArray(raw.snapshots) ? raw.snapshots : []) {
    const item = snapshot as Partial<Snapshot>;
    if (!item.script || !Array.isArray(item.script.paragraphs)) continue;
    if (item.script.production) item.script.production.snapshots = [];
    production.snapshots.push({
      id: textOf(item.id) || uid("snap"),
      name: textOf(item.name) || "Checkpoint",
      savedAt: numberOf(item.savedAt),
      script: item.script,
    });
  }
  return production;
}

export function ensureProduction(script: Script): Production {
  if (!script.production) script.production = emptyProduction();
  const production = script.production;
  if (!Array.isArray(production.people)) production.people = [];
  if (!Array.isArray(production.tags)) production.tags = [];
  if (!Array.isArray(production.frames)) production.frames = [];
  if (!Array.isArray(production.budget)) production.budget = [];
  if (!Array.isArray(production.days)) production.days = [];
  if (!Array.isArray(production.assembly)) production.assembly = [];
  if (!Array.isArray(production.catalog)) production.catalog = [];
  if (!Array.isArray(production.snapshots)) production.snapshots = [];
  return production;
}

export function productionIsEmpty(production: Production | undefined): boolean {
  if (!production) return true;
  return (
    production.people.length === 0 &&
    production.tags.length === 0 &&
    production.frames.length === 0 &&
    production.budget.length === 0 &&
    production.days.length === 0 &&
    production.assembly.length === 0 &&
    production.catalog.length === 0 &&
    production.snapshots.length === 0
  );
}

export function ensureSceneIds(script: Script): void {
  const used = new Set<string>();
  for (const paragraph of script.paragraphs) {
    const id = paragraph.attributes[SCENE_ID];
    if (!id) continue;
    if (used.has(id)) delete paragraph.attributes[SCENE_ID];
    else used.add(id);
  }
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind !== "scene-heading") continue;
    if (!paragraph.attributes[SCENE_ID]) paragraph.attributes[SCENE_ID] = uid("sc");
  }
}

export function sceneIdOf(paragraph: Paragraph | undefined): string {
  return paragraph?.attributes[SCENE_ID] ?? "";
}

export function prepareScript(script: Script): void {
  ensureSceneIds(script);
  ensureProduction(script);
  pruneProduction(script);
  linkBeatsToScenes(script);
}

export function sceneIds(script: Script): Set<string> {
  const ids = new Set<string>();
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind === "scene-heading" && paragraph.attributes[SCENE_ID]) ids.add(paragraph.attributes[SCENE_ID]);
  }
  return ids;
}

export function pruneProduction(script: Script): boolean {
  const production = script.production;
  if (!production) return false;
  const live = sceneIds(script);
  const tags = production.tags.length;
  const frames = production.frames.length;
  const assembly = production.assembly.length;
  production.tags = production.tags.filter((tag) => live.has(tag.sceneId));
  production.frames = production.frames.filter((frame) => live.has(frame.sceneId));
  production.assembly = production.assembly.filter((mark) => live.has(mark.sceneId));
  for (const line of production.budget) {
    if (line.sceneId && !live.has(line.sceneId)) line.sceneId = "";
  }
  for (const day of production.days) day.sceneIds = day.sceneIds.filter((id) => live.has(id));
  return (
    production.tags.length !== tags ||
    production.frames.length !== frames ||
    production.assembly.length !== assembly
  );
}

export function splitSlug(heading: string): { intro: string; location: string; time: string } | null {
  const match = heading.trim().match(/^(INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)\s+(.+?)(?:\s+-\s+(.*))?$/iu);
  if (!match) return null;
  return {
    intro: (match[1] ?? "").toUpperCase(),
    location: (match[2] ?? "").trim().toUpperCase(),
    time: (match[3] ?? "").trim().toUpperCase(),
  };
}

export function joinSlug(intro: string, location: string, time: string): string {
  return time ? `${intro} ${location} - ${time}` : `${intro} ${location}`;
}

export function renameCharacter(script: Script, from: string, to: string): number {
  const source = characterBase(from);
  const target = characterBase(to);
  if (!source || !target || source === target) return 0;
  let count = 0;
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind === "character") {
      const current = paragraphText(paragraph);
      if (characterBase(current) !== source) continue;
      const suffix = current.slice(characterBase(current).length);
      paragraph.runs = [{ text: `${target}${suffix}` }];
      count += 1;
    }
    if (paragraph.scene) {
      paragraph.scene.arcCharacters = paragraph.scene.arcCharacters.map((name) => (characterBase(name) === source ? target : name));
    }
  }
  const production = ensureProduction(script);
  for (const person of production.people) {
    if (person.name === source) person.name = target;
  }
  for (const tag of production.tags) {
    if (tag.department === "cast" && characterBase(tag.text) === source) {
      tag.text = target;
      count += 1;
    }
  }
  for (const asset of production.catalog) {
    if (asset.department === "cast" && characterBase(asset.name) === source) asset.name = target;
  }
  return count;
}

export function renameLocation(script: Script, from: string, to: string): number {
  const source = from.trim().toUpperCase();
  const target = to.trim().toUpperCase();
  if (!source || !target || source === target) return 0;
  let count = 0;
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind !== "scene-heading") continue;
    const slug = splitSlug(paragraphText(paragraph));
    if (!slug || slug.location !== source) continue;
    paragraph.runs = [{ text: joinSlug(slug.intro, target, slug.time) }];
    count += 1;
  }
  for (const day of script.production?.days ?? []) {
    if (day.label.trim().toUpperCase() === source) day.label = target;
  }
  return count;
}

function paragraphLines(paragraph: Paragraph): number {
  if (paragraph.kind === "note" || paragraph.kind === "page-break") return 0;
  const text = paragraphText(paragraph).trim();
  if (!text) return paragraph.kind === "scene-heading" ? 1 : 0;
  const width = paragraph.kind === "dialogue" ? DIALOGUE_WIDTH : paragraph.kind === "parenthetical" ? PAREN_WIDTH : ACTION_WIDTH;
  const body = paragraph.kind === "dialogue" || paragraph.kind === "parenthetical" ? 0 : 1;
  return wrapText(text, width).length + body;
}

export function sceneEighths(script: Script, span: SceneSpan): number {
  let lines = 0;
  for (let index = span.start; index < span.end; index += 1) {
    const paragraph = script.paragraphs[index];
    if (paragraph) lines += paragraphLines(paragraph);
  }
  return Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8));
}

export function formatEighths(eighths: number): string {
  const pages = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  if (pages <= 0) return `${remainder}/8`;
  if (remainder === 0) return `${pages}`;
  return `${pages} ${remainder}/8`;
}

export function formatRuntime(eighths: number): string {
  const minutes = eighths / 8;
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  if (whole <= 0) return `${seconds}s`;
  return seconds ? `${whole}m ${seconds}s` : `${whole}m`;
}

export function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function lineEstimate(line: BudgetLine): number {
  return line.quantity * line.rate * line.days;
}

export function budgetByCategory(script: Script): { category: string; estimate: number; actual: number }[] {
  const rows = new Map<string, { category: string; estimate: number; actual: number }>();
  for (const line of script.production?.budget ?? []) {
    const row = rows.get(line.category) ?? { category: line.category, estimate: 0, actual: 0 };
    row.estimate += lineEstimate(line);
    row.actual += line.actual;
    rows.set(line.category, row);
  }
  return [...rows.values()];
}

export function syncCatalog(script: Script): number {
  const production = ensureProduction(script);
  let added = 0;
  const ensure = (department: string, name: string): void => {
    const key = `${department}:${name}`.toUpperCase();
    if (production.catalog.some((item) => `${item.department}:${item.name}`.toUpperCase() === key)) return;
    production.catalog.push({ id: uid("cat"), department, name, note: "", image: "", rate: 0 });
    added += 1;
  };
  for (const name of characterNames(script)) ensure("cast", name);
  for (const location of locationStats(script)) ensure("location", location.location);
  for (const tag of production.tags) ensure(tag.department, tag.text);
  return added;
}

export type DoodCode = "" | "SW" | "W" | "WF" | "SWF" | "H";

export interface DoodRow {
  name: string;
  codes: DoodCode[];
  work: number;
  hold: number;
  paid: number;
}

function namesForDepartment(script: Script, department: string): string[] {
  if (department === "cast") return characterNames(script);
  if (department === "location") return locationStats(script).map((location) => location.location);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const tag of script.production?.tags ?? []) {
    if (tag.department !== department) continue;
    const key = tag.text.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(tag.text.trim());
  }
  return names;
}

function onDay(script: Script, department: string, name: string, day: ShootDay): boolean {
  const wanted = name.trim().toUpperCase();
  if (!wanted) return false;
  for (const sceneId of day.sceneIds) {
    const span = sceneSpans(script).find((item) => sceneIdOf(script.paragraphs[item.start]) === sceneId);
    if (!span) continue;
    if (department === "location") {
      if (slugLocation(span.heading) === wanted) return true;
      continue;
    }
    if (department === "cast") {
      for (let index = span.start; index < span.end; index += 1) {
        const paragraph = script.paragraphs[index];
        if (paragraph?.kind === "character" && characterBase(paragraphText(paragraph)) === wanted) return true;
      }
      continue;
    }
    if (
      (script.production?.tags ?? []).some(
        (tag) => tag.sceneId === sceneId && tag.department === department && tag.text.trim().toUpperCase() === wanted,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Cast, locations, or a breakdown department across the shooting days. */
export function dayOutOfDays(script: Script, department: string): DoodRow[] {
  const days = script.production?.days ?? [];
  const rows: DoodRow[] = [];
  for (const name of namesForDepartment(script, department)) {
    const working = days.map((day) => onDay(script, department, name, day));
    const indexes = working.flatMap((on, index) => (on ? [index] : []));
    const codes: DoodCode[] = working.map(() => "");
    if (indexes.length === 1) codes[indexes[0]!] = "SWF";
    else if (indexes.length > 1) {
      const first = indexes[0]!;
      const last = indexes[indexes.length - 1]!;
      codes[first] = "SW";
      codes[last] = "WF";
      for (let day = first + 1; day < last; day += 1) codes[day] = working[day] ? "W" : "H";
    }
    const work = indexes.length;
    const hold = codes.filter((code) => code === "H").length;
    if (work === 0) continue;
    rows.push({ name, codes, work, hold, paid: work + hold });
  }
  return rows.sort((left, right) => {
    const a = left.codes.findIndex((code) => code !== "");
    const b = right.codes.findIndex((code) => code !== "");
    return a - b || left.name.localeCompare(right.name);
  });
}

function budgetCategory(department: string): string {
  if (department === "cast") return "Cast";
  if (department === "location") return "Locations";
  if (department === "wardrobe" || department === "makeup") return "Wardrobe / Makeup";
  if (department === "sound") return "Sound";
  if (department === "vfx" || department === "sfx") return "Post";
  return "Art";
}

/** Create or refresh the budget line tied to a catalog item. Days include holds. */
export function pushCatalogToBudget(script: Script, catalogId: string): boolean {
  const production = ensureProduction(script);
  const item = production.catalog.find((asset) => asset.id === catalogId);
  if (!item) return false;
  const row = dayOutOfDays(script, item.department).find((entry) => entry.name.toUpperCase() === item.name.toUpperCase());
  const days = Math.max(1, row?.paid ?? 1);
  const existing = production.budget.find((line) => line.catalogId === catalogId);
  if (existing) {
    existing.category = budgetCategory(item.department);
    existing.description = item.name;
    existing.rate = item.rate;
    existing.days = days;
    existing.quantity = existing.quantity || 1;
    return true;
  }
  production.budget.push({
    id: uid("bd"),
    category: budgetCategory(item.department),
    description: item.name,
    quantity: 1,
    rate: item.rate,
    days,
    actual: 0,
    sceneId: "",
    catalogId,
  });
  return true;
}

export function refreshCatalogBudget(script: Script): number {
  const lines = script.production?.budget ?? [];
  let count = 0;
  for (const line of lines) {
    if (!line.catalogId) continue;
    if (pushCatalogToBudget(script, line.catalogId)) count += 1;
  }
  return count;
}

export function budgetTotals(script: Script): { estimate: number; actual: number } {
  const lines = script.production?.budget ?? [];
  return {
    estimate: lines.reduce((sum, line) => sum + lineEstimate(line), 0),
    actual: lines.reduce((sum, line) => sum + line.actual, 0),
  };
}

export function seedCast(script: Script): number {
  const production = ensureProduction(script);
  ensureSceneIds(script);
  let added = 0;
  for (const span of sceneSpans(script)) {
    const sceneId = sceneIdOf(script.paragraphs[span.start]);
    if (!sceneId) continue;
    const names = new Set<string>();
    for (let index = span.start; index < span.end; index += 1) {
      const paragraph = script.paragraphs[index];
      if (paragraph?.kind !== "character") continue;
      const name = characterBase(paragraphText(paragraph));
      if (name) names.add(name);
    }
    for (const name of names) {
      const exists = production.tags.some(
        (tag) => tag.sceneId === sceneId && tag.department === "cast" && characterBase(tag.text) === name,
      );
      if (exists) continue;
      production.tags.push({ id: uid("tag"), sceneId, department: "cast", text: name });
      added += 1;
    }
  }
  return added;
}

export function duplicateScene(script: Script, sceneIndex: number): number {
  const span = sceneSpans(script)[sceneIndex];
  if (!span) return -1;
  const copy = script.paragraphs.slice(span.start, span.end).map((paragraph) => {
    const next = structuredClone(paragraph);
    if (next.kind === "scene-heading") delete next.attributes[SCENE_ID];
    return next;
  });
  script.paragraphs.splice(span.end, 0, ...copy);
  ensureSceneIds(script);
  return span.end;
}

export function assemblyMark(script: Script, sceneId: string, patch: Partial<AssemblyMark>): void {
  const production = ensureProduction(script);
  const current = production.assembly.find((mark) => mark.sceneId === sceneId);
  if (current) {
    if (patch.status) current.status = patch.status;
    if (patch.note !== undefined) current.note = patch.note;
    if (patch.order !== undefined) current.order = patch.order;
    return;
  }
  const order = patch.order ?? production.assembly.length;
  production.assembly.push({ sceneId, status: patch.status ?? "cut", note: patch.note ?? "", order });
}

export function assemblyOf(script: Script, sceneId: string): AssemblyMark {
  return (
    script.production?.assembly.find((mark) => mark.sceneId === sceneId) ?? {
      sceneId,
      status: "cut",
      note: "",
      order: 0,
    }
  );
}

export function scheduleByLocation(script: Script): number {
  const production = ensureProduction(script);
  ensureSceneIds(script);
  const taken = new Set(production.days.flatMap((day) => day.sceneIds));
  const groups = new Map<string, string[]>();
  for (const span of sceneSpans(script)) {
    const sceneId = sceneIdOf(script.paragraphs[span.start]);
    if (!sceneId || taken.has(sceneId)) continue;
    if (assemblyOf(script, sceneId).status === "omit") continue;
    const key = slugLocation(span.heading) || span.heading || "UNASSIGNED";
    const list = groups.get(key) ?? [];
    list.push(sceneId);
    groups.set(key, list);
  }
  for (const [label, sceneIdsForDay] of groups) {
    production.days.push({ id: uid("day"), label, date: "", call: "07:00", notes: "", sceneIds: sceneIdsForDay });
  }
  return groups.size;
}

export function takeSnapshot(script: Script, name: string): Snapshot {
  const production = ensureProduction(script);
  const copy = structuredClone(script);
  if (copy.production) {
    copy.production.snapshots = [];
    for (const frame of copy.production.frames) {
      frame.sketch = "";
      frame.image = "";
    }
    for (const asset of copy.production.catalog) asset.image = "";
  }
  const snapshot: Snapshot = { id: uid("snap"), name: name.trim() || "Checkpoint", savedAt: Date.now(), script: copy };
  production.snapshots.unshift(snapshot);
  production.snapshots = production.snapshots.slice(0, 24);
  return snapshot;
}

export function restoreSnapshot(script: Script, id: string): Script | null {
  const snapshot = script.production?.snapshots.find((item) => item.id === id);
  if (!snapshot) return null;
  const snapshots = script.production?.snapshots ?? [];
  const next = structuredClone(snapshot.script);
  next.production = normalizeProduction(next.production ?? emptyProduction());
  next.production.snapshots = snapshots;
  prepareScript(next);
  return next;
}

export function takeProduction(preserved: PreservedElement[]): Production | undefined {
  const index = preserved.findIndex((element) => element.name === "FolioProduction");
  if (index < 0) return undefined;
  const [item] = preserved.splice(index, 1);
  if (!item) return undefined;
  try {
    const document = parseXml(item.xml);
    const raw = document.documentElement?.textContent ?? "";
    if (!raw.trim()) return emptyProduction();
    return normalizeProduction(JSON.parse(raw) as unknown);
  } catch {
    preserved.splice(index, 0, item);
    return undefined;
  }
}

export function appendProduction(document: Document, root: Element, production: Production | undefined): void {
  if (!production || productionIsEmpty(production)) return;
  const element = document.createElement("FolioProduction");
  element.setAttribute("Version", "1");
  const stored = normalizeProduction(production);
  for (const snapshot of stored.snapshots) {
    if (snapshot.script.production) snapshot.script.production.snapshots = [];
  }
  element.appendChild(document.createTextNode(JSON.stringify(stored)));
  root.appendChild(element);
}
