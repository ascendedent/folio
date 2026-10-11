#!/usr/bin/env node
/**
 * Thin stdio MCP. One loaded script.
 * Each desk job is its own tool so a grant can allow one and refuse another.
 * lock_pages and replace_all stay in the library and are not tools.
 */
import { writeFileSync } from "node:fs";
import {
  addSceneBeat,
  alignCards,
  applyKind,
  characterDialogue,
  characterStats,
  checkFormatting,
  countWords,
  distributeCards,
  findInScript,
  linkBeatsToScenes,
  locationStats,
  makeParagraph,
  moveScene,
  renumberScenes,
  sceneSpans,
  scriptBalance,
  sendCardsToScript,
  storyToBoard,
  toggleDual,
} from "./edit.js";
import { FolioError } from "./errors.js";
import { ensureBoard } from "./fdx/board.js";
import { writeFdx } from "./fdx/write.js";
import { loadScript } from "./load.js";
import { emptyScene, paragraphText, scriptTitle, type BoardCard, type ElementKind, type Script } from "./model.js";
import {
  assemblyMark,
  budgetByCategory,
  budgetTotals,
  BUDGET_CATEGORIES,
  dayOutOfDays,
  DEPARTMENTS,
  duplicateScene,
  ensureProduction,
  prepareScript,
  pushCatalogToBudget,
  refreshCatalogBudget,
  renameCharacter,
  renameLocation,
  restoreSnapshot,
  scheduleByLocation,
  sceneIdOf,
  seedCast,
  SHOT_SIZES,
  syncCatalog,
  takeSnapshot,
  uid,
  type BudgetLine,
  type CatalogItem,
  type CutStatus,
  type Department,
  type PersonNote,
  type ShootDay,
  type StoryFrame,
} from "./production.js";

const KINDS = [
  "scene-heading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "shot",
  "general",
  "cast-list",
  "singing",
  "new-act",
  "end-of-act",
  "sequence",
  "outline-1",
  "outline-2",
  "outline-3",
  "outline-4",
  "outline-body",
  "summary",
  "centered",
  "lyric",
  "section",
  "synopsis",
  "note",
  "page-break",
  "unknown",
] as const satisfies readonly ElementKind[];

const CUTS = ["cut", "omit", "lift", "hold"] as const satisfies readonly CutStatus[];

let current: Script | null = null;
let currentPath: string | null = null;

interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  writes?: boolean;
  run(args: Record<string, unknown>): unknown;
}

function requireScript(): Script {
  if (!current) throw new FolioError("Load a script first.");
  return current;
}

function summary(script: Script): Record<string, unknown> {
  const scenes = sceneSpans(script).slice(0, 80).map((span) => ({
    number: span.number,
    heading: span.heading,
    index: span.start,
  }));
  return {
    file: currentPath,
    title: scriptTitle(script) || "Untitled",
    paragraphs: script.paragraphs.length,
    scenes,
    beats: script.board?.cards.length ?? 0,
  };
}

function schema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function argsOf(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function has(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function num(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new FolioError(`${name} must be a number.`);
  return parsed;
}

function whole(value: unknown, name: string): number {
  const parsed = num(value, name);
  if (!Number.isInteger(parsed) || parsed < 0) throw new FolioError(`${name} must be a whole number.`);
  return parsed;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new FolioError(`${name} must be text.`);
  return value;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new FolioError(`${name} must be text.`);
  return value;
}

function flag(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new FolioError(`${name} must be true or false.`);
  return value;
}

function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  const raw = text(value, name);
  if (!allowed.includes(raw as T)) throw new FolioError(`${name} must be one of ${allowed.join(", ")}.`);
  return raw as T;
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new FolioError(`${name} must be a list of strings.`);
  }
  return value;
}

function paragraphAt(script: Script, index: number) {
  const paragraph = script.paragraphs[index];
  if (!paragraph) throw new FolioError(`No paragraph at ${index}.`);
  return paragraph;
}

function paragraphRecord(script: Script, index: number): Record<string, unknown> {
  const paragraph = paragraphAt(script, index);
  return {
    index,
    kind: paragraph.kind,
    text: paragraphText(paragraph),
    folioId: paragraph.attributes.FolioId ?? "",
    notes: [...paragraph.notes],
    summary: paragraph.scene?.summary ?? "",
    arcCharacters: [...(paragraph.scene?.arcCharacters ?? [])],
  };
}

function paragraphBounds(script: Script, raw: Record<string, unknown>): { start: number; end: number } {
  let start = 0;
  let end = script.paragraphs.length;
  if (has(raw, "sceneId") && typeof raw.sceneId === "string" && raw.sceneId.trim()) {
    const sceneId = raw.sceneId;
    const span = sceneSpans(script).find((item) => sceneIdOf(script.paragraphs[item.start]) === sceneId);
    if (!span) throw new FolioError(`No scene ${sceneId}.`);
    start = span.start;
    end = span.end;
  }
  if (has(raw, "start")) start = Math.max(start, whole(raw.start, "start"));
  if (has(raw, "end")) end = Math.min(end, whole(raw.end, "end"));
  if (start > script.paragraphs.length || end < start) throw new FolioError("That paragraph range is outside the script.");
  return { start, end: Math.min(end, script.paragraphs.length) };
}

function sceneHeading(script: Script, sceneId: string) {
  const heading = script.paragraphs.find(
    (paragraph) => paragraph.kind === "scene-heading" && paragraph.attributes.FolioId === sceneId,
  );
  if (!heading) throw new FolioError(`No scene ${sceneId}.`);
  return heading;
}

function cardView(card: BoardCard): Record<string, unknown> {
  return {
    id: card.id,
    title: card.title,
    body: card.body,
    color: card.color,
    sceneId: card.sceneId ?? "",
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
  };
}

function beatCard(script: Script, id: string): BoardCard {
  const card = ensureBoard(script).cards.find((item) => item.id === id);
  if (!card) throw new FolioError(`No beat card ${id}.`);
  return card;
}

function none(): JsonSchema {
  return schema({});
}

const str = { type: "string" };
const numSchema = { type: "number" };
const bool = { type: "boolean" };
const strList = { type: "array", items: { type: "string" } };

const tools: Tool[] = [
  {
    name: "load_script",
    description: "Load an .fdx, .fdxt, or .fountain file. Replaces the script held in this session.",
    inputSchema: schema({ path: str }, ["path"]),
    run(args) {
      const path = text(args.path, "path");
      current = loadScript(path);
      currentPath = path;
      return summary(current);
    },
  },
  {
    name: "write_fdx",
    description: "Write the loaded script with writeFdx. path defaults to the file passed to load_script.",
    inputSchema: schema({ path: str }),
    run(args) {
      const script = requireScript();
      const path = typeof args.path === "string" && args.path.trim() ? args.path : currentPath;
      if (!path) throw new FolioError("Give a path. This session has no loaded file yet.");
      prepareScript(script);
      writeFileSync(path, writeFdx(script), "utf8");
      currentPath = path;
      return { wrote: path, ...summary(script) };
    },
  },
  {
    name: "apply_kind",
    description: "Set the element kind of one paragraph.",
    inputSchema: schema({ index: numSchema, kind: { type: "string", enum: [...KINDS] } }, ["index", "kind"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const index = whole(args.index, "index");
      const paragraph = paragraphAt(script, index);
      applyKind(paragraph, oneOf(args.kind, "kind", KINDS));
      return { index, kind: paragraph.kind, text: paragraphText(paragraph) };
    },
  },
  {
    name: "move_scene",
    description: "Move a scene from one scene index to another.",
    inputSchema: schema({ from: numSchema, to: numSchema }, ["from", "to"]),
    writes: true,
    run(args) {
      moveScene(requireScript(), whole(args.from, "from"), whole(args.to, "to"));
      return { moved: true };
    },
  },
  {
    name: "renumber_scenes",
    description: "Renumber the scene headings in order.",
    inputSchema: none(),
    writes: true,
    run() {
      renumberScenes(requireScript());
      return { renumbered: true };
    },
  },
  {
    name: "toggle_dual",
    description: "Toggle dual dialogue at a paragraph.",
    inputSchema: schema({ index: numSchema }, ["index"]),
    writes: true,
    run(args) {
      return { dual: toggleDual(requireScript(), whole(args.index, "index")) };
    },
  },
  {
    name: "check_formatting",
    description: "Report cue, parenthetical, spacing, and lookalike-name problems.",
    inputSchema: none(),
    run() {
      return checkFormatting(requireScript());
    },
  },
  {
    name: "count_words",
    description: "Count the words in the loaded script.",
    inputSchema: none(),
    run() {
      return { words: countWords(requireScript()) };
    },
  },
  {
    name: "character_stats",
    description: "Speaking stats for each character.",
    inputSchema: none(),
    run() {
      return characterStats(requireScript());
    },
  },
  {
    name: "location_stats",
    description: "Scene counts by location.",
    inputSchema: none(),
    run() {
      return locationStats(requireScript());
    },
  },
  {
    name: "scene_spans",
    description: "Scene headings with their paragraph ranges.",
    inputSchema: none(),
    run() {
      return sceneSpans(requireScript()).map((span) => ({
        number: span.number,
        heading: span.heading,
        start: span.start,
        end: span.end,
      }));
    },
  },
  {
    name: "find_in_script",
    description: "Find text in the loaded script.",
    inputSchema: schema({ query: str }, ["query"]),
    run(args) {
      return findInScript(requireScript(), text(args.query, "query")).slice(0, 50);
    },
  },
  {
    name: "add_scene_beat",
    description: "Add a beat card linked to a scene.",
    inputSchema: schema({ sceneId: str }, ["sceneId"]),
    writes: true,
    run(args) {
      const card = addSceneBeat(requireScript(), text(args.sceneId, "sceneId"));
      return card ? { id: card.id, title: card.title, sceneId: card.sceneId ?? "" } : null;
    },
  },
  {
    name: "story_to_board",
    description: "Pull scenes and outline beats onto the board.",
    inputSchema: none(),
    writes: true,
    run() {
      return { added: storyToBoard(requireScript()) };
    },
  },
  {
    name: "send_cards_to_script",
    description: "Send beat cards into the script as outline elements.",
    inputSchema: schema({ ids: strList }, ["ids"]),
    writes: true,
    run(args) {
      return { added: sendCardsToScript(requireScript(), stringList(args.ids, "ids")) };
    },
  },
  {
    name: "link_beats_to_scenes",
    description: "Link untitled or matching beat cards to scene headings. An explicit unlink is left alone.",
    inputSchema: none(),
    writes: true,
    run() {
      linkBeatsToScenes(requireScript());
      return { linked: true };
    },
  },
  {
    name: "character_dialogue",
    description: "Return one character's dialogue lines.",
    inputSchema: schema({ name: str }, ["name"]),
    run(args) {
      return characterDialogue(requireScript(), text(args.name, "name"));
    },
  },
  {
    name: "script_balance",
    description: "Count paragraphs by element kind.",
    inputSchema: none(),
    run() {
      return scriptBalance(requireScript());
    },
  },
  {
    name: "rename_character",
    description: "Rename a character. Also rewrites scene arcs, people, cast tags, and cast catalog rows.",
    inputSchema: schema({ from: str, to: str }, ["from", "to"]),
    writes: true,
    run(args) {
      return { changed: renameCharacter(requireScript(), text(args.from, "from"), text(args.to, "to")) };
    },
  },
  {
    name: "rename_location",
    description: "Rename a location inside scene headings. Also rewrites matching shooting-day labels.",
    inputSchema: schema({ from: str, to: str }, ["from", "to"]),
    writes: true,
    run(args) {
      return { changed: renameLocation(requireScript(), text(args.from, "from"), text(args.to, "to")) };
    },
  },
  {
    name: "duplicate_scene",
    description: "Copy one scene and give the copy its own id.",
    inputSchema: schema({ sceneIndex: numSchema }, ["sceneIndex"]),
    writes: true,
    run(args) {
      return { index: duplicateScene(requireScript(), whole(args.sceneIndex, "sceneIndex")) };
    },
  },
  {
    name: "take_snapshot",
    description: "Store a checkpoint. The reply is the id, name, and time, not the nested script.",
    inputSchema: schema({ name: str }, ["name"]),
    writes: true,
    run(args) {
      const shot = takeSnapshot(requireScript(), text(args.name, "name"));
      return { id: shot.id, name: shot.name, savedAt: shot.savedAt };
    },
  },
  {
    name: "restore_snapshot",
    description: "Replace the loaded script with a checkpoint.",
    inputSchema: schema({ id: str }, ["id"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const next = restoreSnapshot(script, text(args.id, "id"));
      if (!next) throw new FolioError("No checkpoint with that id.");
      current = next;
      return { restored: true };
    },
  },
  {
    name: "budget_totals",
    description: "Estimate and actual totals for the budget.",
    inputSchema: none(),
    run() {
      return budgetTotals(requireScript());
    },
  },
  {
    name: "budget_by_category",
    description: "Budget totals grouped by category.",
    inputSchema: none(),
    run() {
      return budgetByCategory(requireScript());
    },
  },
  {
    name: "schedule_by_location",
    description: "Group unscheduled scenes into shooting days by location. This writes days.",
    inputSchema: none(),
    writes: true,
    run() {
      return { days: scheduleByLocation(requireScript()) };
    },
  },
  {
    name: "sync_catalog",
    description: "Insert catalog rows for cast, locations, and breakdown tags that are missing. New rows have rate 0.",
    inputSchema: none(),
    writes: true,
    run() {
      return { added: syncCatalog(requireScript()) };
    },
  },
  {
    name: "day_out_of_days",
    description: "Day-out-of-days grid for cast, location, or a breakdown department.",
    inputSchema: schema({ department: str }, ["department"]),
    run(args) {
      return dayOutOfDays(requireScript(), text(args.department, "department"));
    },
  },
  {
    name: "push_catalog_to_budget",
    description: "Create or refresh the budget line for one catalog item.",
    inputSchema: schema({ catalogId: str }, ["catalogId"]),
    writes: true,
    run(args) {
      return { pushed: pushCatalogToBudget(requireScript(), text(args.catalogId, "catalogId")) };
    },
  },
  {
    name: "refresh_catalog_budget",
    description: "Reprice every budget line that came from the catalog.",
    inputSchema: none(),
    writes: true,
    run() {
      return { refreshed: refreshCatalogBudget(requireScript()) };
    },
  },
  {
    name: "seed_cast",
    description: "Write a cast breakdown tag for each character cue that does not already have one.",
    inputSchema: none(),
    writes: true,
    run() {
      return { seeded: seedCast(requireScript()) };
    },
  },
  {
    name: "assembly_mark",
    description: "Set the assembly status of a scene. status is cut, omit, lift, or hold.",
    inputSchema: schema(
      { sceneId: str, status: { type: "string", enum: [...CUTS] }, note: str, order: numSchema },
      ["sceneId", "status", "note"],
    ),
    writes: true,
    run(args) {
      assemblyMark(requireScript(), text(args.sceneId, "sceneId"), {
        status: oneOf(args.status, "status", CUTS),
        note: asString(args.note, "note"),
        ...(has(args, "order") ? { order: whole(args.order, "order") } : {}),
      });
      return { marked: true };
    },
  },
  {
    name: "align_cards",
    description: "Align beat cards to one edge. edge is left or top.",
    inputSchema: schema({ ids: strList, edge: { type: "string", enum: ["left", "top"] } }, ["ids", "edge"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const ids = stringList(args.ids, "ids");
      const edge = oneOf(args.edge, "edge", ["left", "top"] as const);
      const matched = (script.board?.cards ?? []).filter((card) => ids.includes(card.id));
      if (matched.length < 2) throw new FolioError("align_cards needs at least two cards.");
      alignCards(script, ids, edge);
      return { aligned: matched.length, edge };
    },
  },
  {
    name: "distribute_cards",
    description: "Space beat cards evenly. axis is x or y. Needs at least three cards.",
    inputSchema: schema({ ids: strList, axis: { type: "string", enum: ["x", "y"] } }, ["ids", "axis"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const ids = stringList(args.ids, "ids");
      const axis = oneOf(args.axis, "axis", ["x", "y"] as const);
      const matched = (script.board?.cards ?? []).filter((card) => ids.includes(card.id));
      if (matched.length < 3) throw new FolioError("distribute_cards needs at least three cards.");
      distributeCards(script, ids, axis);
      return { distributed: matched.length, axis };
    },
  },
  {
    name: "read_paragraphs",
    description: "Read paragraphs. Filter with a scene id, a start index, an end index, or a combination. end is exclusive.",
    inputSchema: schema({ sceneId: str, start: numSchema, end: numSchema }),
    run(args) {
      const script = requireScript();
      const bounds = paragraphBounds(script, args);
      const rows = [];
      for (let index = bounds.start; index < bounds.end; index += 1) rows.push(paragraphRecord(script, index));
      return rows;
    },
  },
  {
    name: "read_beats",
    description: "Read beat cards and the links between them.",
    inputSchema: none(),
    run() {
      const board = requireScript().board;
      return {
        cards: (board?.cards ?? []).map(cardView),
        links: (board?.links ?? []).map((link) => ({ from: link.from, to: link.to })),
      };
    },
  },
  {
    name: "read_title_page",
    description: "Read the title-page fields.",
    inputSchema: none(),
    run() {
      return requireScript().titlePage.map((field) => ({ type: field.type, text: field.text }));
    },
  },
  {
    name: "read_production",
    description: "Read people, tags, frames, catalog, budget, days, and assembly. Snapshots are id, name, and savedAt only.",
    inputSchema: none(),
    run() {
      const script = requireScript();
      if (!script.production) {
        return { people: [], tags: [], frames: [], catalog: [], budget: [], days: [], assembly: [], snapshots: [] };
      }
      const production = ensureProduction(script);
      return {
        people: production.people,
        tags: production.tags,
        frames: production.frames,
        catalog: production.catalog,
        budget: production.budget,
        days: production.days,
        assembly: production.assembly,
        snapshots: production.snapshots.map((shot) => ({ id: shot.id, name: shot.name, savedAt: shot.savedAt })),
      };
    },
  },
  {
    name: "set_paragraph_text",
    description: "Replace one paragraph's runs with a single plain run. The kind stays as it is.",
    inputSchema: schema({ index: numSchema, text: str }, ["index", "text"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const index = whole(args.index, "index");
      const paragraph = paragraphAt(script, index);
      paragraph.runs = [{ text: asString(args.text, "text") }];
      return paragraphRecord(script, index);
    },
  },
  {
    name: "insert_paragraph",
    description: "Insert a paragraph at index using makeParagraph. An index equal to the paragraph count appends.",
    inputSchema: schema({ index: numSchema, kind: { type: "string", enum: [...KINDS] }, text: str }, ["index", "kind", "text"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const index = whole(args.index, "index");
      if (index > script.paragraphs.length) throw new FolioError(`No paragraph at ${index}.`);
      const kind = oneOf(args.kind, "kind", KINDS);
      script.paragraphs.splice(index, 0, makeParagraph(kind, asString(args.text, "text")));
      prepareScript(script);
      return paragraphRecord(script, index);
    },
  },
  {
    name: "remove_paragraph",
    description: "Drop one paragraph. Scene omission stays on assembly_mark.",
    inputSchema: schema({ index: numSchema }, ["index"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const index = whole(args.index, "index");
      paragraphAt(script, index);
      const [removed] = script.paragraphs.splice(index, 1);
      return { index, kind: removed?.kind ?? "", text: removed ? paragraphText(removed) : "" };
    },
  },
  {
    name: "set_notes",
    description: "Replace one paragraph's notes with the given strings.",
    inputSchema: schema({ index: numSchema, notes: strList }, ["index", "notes"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const index = whole(args.index, "index");
      const paragraph = paragraphAt(script, index);
      paragraph.notes = stringList(args.notes, "notes");
      return { index, notes: [...paragraph.notes] };
    },
  },
  {
    name: "set_scene_card",
    description: "Update a scene heading's index-card summary and character arcs. Omitted fields stay as loaded.",
    inputSchema: schema({ sceneId: str, summary: str, arcCharacters: strList }, ["sceneId"]),
    writes: true,
    run(args) {
      const heading = sceneHeading(requireScript(), text(args.sceneId, "sceneId"));
      if (!heading.scene) heading.scene = emptyScene();
      if (has(args, "summary")) heading.scene.summary = asString(args.summary, "summary");
      if (has(args, "arcCharacters")) heading.scene.arcCharacters = stringList(args.arcCharacters, "arcCharacters");
      return {
        sceneId: heading.attributes.FolioId ?? "",
        summary: heading.scene.summary,
        arcCharacters: [...heading.scene.arcCharacters],
      };
    },
  },
  {
    name: "set_title_field",
    description: "Insert or replace one title-page field by type.",
    inputSchema: schema({ type: str, text: str }, ["type", "text"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const type = text(args.type, "type");
      const value = asString(args.text, "text");
      const field = script.titlePage.find((item) => item.type.toLowerCase() === type.toLowerCase());
      if (field) field.text = value;
      else script.titlePage.push({ type, text: value });
      const saved = script.titlePage.find((item) => item.type.toLowerCase() === type.toLowerCase());
      return { type: saved?.type ?? type, text: saved?.text ?? value };
    },
  },
  {
    name: "set_beat_card",
    description: "Update one existing beat card. Omitted fields stay. sceneId of an empty string unlinks the card.",
    inputSchema: schema({
      id: str,
      title: str,
      body: str,
      color: str,
      sceneId: str,
      x: numSchema,
      y: numSchema,
      width: numSchema,
      height: numSchema,
    }, ["id"]),
    writes: true,
    run(args) {
      const card = beatCard(requireScript(), text(args.id, "id"));
      if (has(args, "title")) card.title = asString(args.title, "title");
      if (has(args, "body")) card.body = asString(args.body, "body");
      if (has(args, "color")) card.color = asString(args.color, "color");
      if (has(args, "sceneId")) card.sceneId = asString(args.sceneId, "sceneId");
      if (has(args, "x")) card.x = num(args.x, "x");
      if (has(args, "y")) card.y = num(args.y, "y");
      if (has(args, "width")) card.width = num(args.width, "width");
      if (has(args, "height")) card.height = num(args.height, "height");
      return cardView(card);
    },
  },
  {
    name: "set_beat_link",
    description: "Add or remove a link between two beat cards. A duplicate add is ignored.",
    inputSchema: schema({ from: str, to: str, linked: bool }, ["from", "to", "linked"]),
    writes: true,
    run(args) {
      const script = requireScript();
      const from = text(args.from, "from");
      const to = text(args.to, "to");
      beatCard(script, from);
      beatCard(script, to);
      const board = ensureBoard(script);
      const linked = flag(args.linked, "linked");
      const exists = board.links.some((link) => link.from === from && link.to === to);
      if (linked && !exists) board.links.push({ from, to });
      if (!linked) board.links = board.links.filter((link) => link.from !== from || link.to !== to);
      return { from, to, linked };
    },
  },
  {
    name: "upsert_person",
    description: "Update a person matched by name, or append one.",
    inputSchema: schema({ name: str, role: str, actor: str, note: str }, ["name"]),
    writes: true,
    run(args) {
      const people = ensureProduction(requireScript()).people;
      const name = text(args.name, "name").trim().toUpperCase();
      let person = people.find((item) => item.name.toUpperCase() === name);
      if (!person) {
        person = { name, role: "", actor: "", note: "" };
        people.push(person);
      }
      if (has(args, "role")) person.role = asString(args.role, "role");
      if (has(args, "actor")) person.actor = asString(args.actor, "actor");
      if (has(args, "note")) person.note = asString(args.note, "note");
      return person satisfies PersonNote;
    },
  },
  {
    name: "upsert_tag",
    description: "Update a breakdown tag by id, or append one. department is a breakdown department.",
    inputSchema: schema(
      { id: str, sceneId: str, department: { type: "string", enum: [...DEPARTMENTS] }, text: str },
      ["sceneId", "department", "text"],
    ),
    writes: true,
    run(args) {
      const tags = ensureProduction(requireScript()).tags;
      const sceneId = text(args.sceneId, "sceneId");
      const department = oneOf(args.department, "department", DEPARTMENTS) as Department;
      const label = asString(args.text, "text");
      if (has(args, "id")) {
        const id = text(args.id, "id");
        const tag = tags.find((item) => item.id === id);
        if (!tag) throw new FolioError(`No tag ${id}.`);
        tag.sceneId = sceneId;
        tag.department = department;
        tag.text = label;
        return tag;
      }
      const tag = { id: uid("tag"), sceneId, department, text: label };
      tags.push(tag);
      return tag;
    },
  },
  {
    name: "upsert_frame",
    description: "Update a storyboard frame by id, or append one. Storyboard and shot list share this list.",
    inputSchema: schema(
      {
        id: str,
        sceneId: str,
        order: numSchema,
        size: { type: "string", enum: [...SHOT_SIZES] },
        angle: str,
        description: str,
        audio: str,
        movement: str,
        sketch: str,
        image: str,
      },
      ["sceneId", "order", "size", "angle", "description"],
    ),
    writes: true,
    run(args) {
      const frames = ensureProduction(requireScript()).frames;
      const patch = {
        sceneId: text(args.sceneId, "sceneId"),
        order: whole(args.order, "order"),
        size: oneOf(args.size, "size", SHOT_SIZES),
        angle: asString(args.angle, "angle"),
        description: asString(args.description, "description"),
      };
      const apply = (frame: StoryFrame): StoryFrame => {
        frame.sceneId = patch.sceneId;
        frame.order = patch.order;
        frame.size = patch.size;
        frame.angle = patch.angle;
        frame.description = patch.description;
        if (has(args, "audio")) frame.audio = asString(args.audio, "audio");
        if (has(args, "movement")) frame.movement = asString(args.movement, "movement");
        if (has(args, "sketch")) frame.sketch = asString(args.sketch, "sketch");
        if (has(args, "image")) frame.image = asString(args.image, "image");
        return frame;
      };
      if (has(args, "id")) {
        const id = text(args.id, "id");
        const frame = frames.find((item) => item.id === id);
        if (!frame) throw new FolioError(`No frame ${id}.`);
        return apply(frame);
      }
      const frame: StoryFrame = {
        id: uid("fr"),
        ...patch,
        audio: has(args, "audio") ? asString(args.audio, "audio") : "",
        movement: has(args, "movement") ? asString(args.movement, "movement") : "",
        sketch: has(args, "sketch") ? asString(args.sketch, "sketch") : "",
        image: has(args, "image") ? asString(args.image, "image") : "",
      };
      frames.push(frame);
      return frame;
    },
  },
  {
    name: "upsert_catalog_item",
    description: "Update a catalog item by id, or append one.",
    inputSchema: schema(
      { id: str, department: str, name: str, note: str, rate: numSchema, image: str },
      ["department", "name"],
    ),
    writes: true,
    run(args) {
      const catalog = ensureProduction(requireScript()).catalog;
      const department = text(args.department, "department");
      const name = text(args.name, "name");
      const apply = (item: CatalogItem): CatalogItem => {
        item.department = department;
        item.name = name;
        if (has(args, "note")) item.note = asString(args.note, "note");
        if (has(args, "rate")) item.rate = num(args.rate, "rate");
        if (has(args, "image")) item.image = asString(args.image, "image");
        return item;
      };
      if (has(args, "id")) {
        const id = text(args.id, "id");
        const item = catalog.find((asset) => asset.id === id);
        if (!item) throw new FolioError(`No catalog item ${id}.`);
        return apply(item);
      }
      const item: CatalogItem = {
        id: uid("cat"),
        department,
        name,
        note: has(args, "note") ? asString(args.note, "note") : "",
        rate: has(args, "rate") ? num(args.rate, "rate") : 0,
        image: has(args, "image") ? asString(args.image, "image") : "",
      };
      catalog.push(item);
      return item;
    },
  },
  {
    name: "upsert_budget_line",
    description: "Update a budget line by id, or append one.",
    inputSchema: schema(
      {
        id: str,
        category: { type: "string", enum: [...BUDGET_CATEGORIES] },
        description: str,
        quantity: numSchema,
        rate: numSchema,
        days: numSchema,
        actual: numSchema,
        sceneId: str,
        catalogId: str,
      },
      ["category", "description", "quantity", "rate", "days"],
    ),
    writes: true,
    run(args) {
      const budget = ensureProduction(requireScript()).budget;
      const category = oneOf(args.category, "category", BUDGET_CATEGORIES);
      const description = asString(args.description, "description");
      const quantity = num(args.quantity, "quantity");
      const rate = num(args.rate, "rate");
      const days = num(args.days, "days");
      const apply = (line: BudgetLine): BudgetLine => {
        line.category = category;
        line.description = description;
        line.quantity = quantity;
        line.rate = rate;
        line.days = days;
        if (has(args, "actual")) line.actual = num(args.actual, "actual");
        if (has(args, "sceneId")) line.sceneId = asString(args.sceneId, "sceneId");
        if (has(args, "catalogId")) line.catalogId = asString(args.catalogId, "catalogId");
        return line;
      };
      if (has(args, "id")) {
        const id = text(args.id, "id");
        const line = budget.find((item) => item.id === id);
        if (!line) throw new FolioError(`No budget line ${id}.`);
        return apply(line);
      }
      const line: BudgetLine = {
        id: uid("bd"),
        category,
        description,
        quantity,
        rate,
        days,
        actual: has(args, "actual") ? num(args.actual, "actual") : 0,
        sceneId: has(args, "sceneId") ? asString(args.sceneId, "sceneId") : "",
        ...(has(args, "catalogId") ? { catalogId: asString(args.catalogId, "catalogId") } : {}),
      };
      budget.push(line);
      return line;
    },
  },
  {
    name: "upsert_shoot_day",
    description: "Update a shooting day by id, or append one. A day needs sceneIds. The call sheet is built from these days plus the script and the breakdown.",
    inputSchema: schema(
      { id: str, label: str, date: str, call: str, notes: str, sceneIds: strList },
      ["label", "sceneIds"],
    ),
    writes: true,
    run(args) {
      const days = ensureProduction(requireScript()).days;
      const label = text(args.label, "label");
      const sceneIds = stringList(args.sceneIds, "sceneIds");
      if (sceneIds.length === 0) throw new FolioError("A shooting day needs sceneIds.");
      const apply = (day: ShootDay): ShootDay => {
        day.label = label;
        day.sceneIds = sceneIds;
        if (has(args, "date")) day.date = asString(args.date, "date");
        if (has(args, "call")) day.call = asString(args.call, "call");
        if (has(args, "notes")) day.notes = asString(args.notes, "notes");
        return day;
      };
      if (has(args, "id")) {
        const id = text(args.id, "id");
        const day = days.find((item) => item.id === id);
        if (!day) throw new FolioError(`No shooting day ${id}.`);
        return apply(day);
      }
      const day: ShootDay = {
        id: uid("day"),
        label,
        date: has(args, "date") ? asString(args.date, "date") : "",
        call: has(args, "call") ? asString(args.call, "call") : "",
        notes: has(args, "notes") ? asString(args.notes, "notes") : "",
        sceneIds,
      };
      days.push(day);
      return day;
    },
  },
];

function toolResult(payload: unknown, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function callTool(name: string, input: unknown): Record<string, unknown> {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new FolioError(`Unknown tool ${name}.`);
  const payload = tool.run(argsOf(input));
  if (tool.writes && current) prepareScript(current);
  return toolResult(payload);
}

type Rpc = { jsonrpc?: string; id?: number | string | null; method?: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } };

function handle(message: Rpc): void {
  if (message.id === undefined || message.id === null) return;
  try {
    if (message.method === "initialize") {
      respond(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "folio", version: "0.1.0" },
      });
      return;
    }
    if (message.method === "tools/list") {
      respond(message.id, {
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      });
      return;
    }
    if (message.method === "tools/call") {
      respond(message.id, callTool(message.params?.name ?? "", message.params?.arguments));
      return;
    }
    if (message.method === "ping") {
      respond(message.id, {});
      return;
    }
    respondError(message.id, -32601, `Unknown method ${message.method ?? ""}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Folio MCP failed.";
    if (message.method === "tools/call") {
      respond(message.id, toolResult({ error: messageText }, true));
      return;
    }
    respondError(message.id, -32000, messageText);
  }
}

function respond(id: number | string, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(payload: unknown): void {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on("end", () => {
  process.exit(0);
});
process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/iu.exec(header);
    if (!match?.[1]) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    handle(JSON.parse(body) as Rpc);
  }
});
