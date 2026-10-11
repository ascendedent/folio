import { ensureBoard, fitCardToText, nextCardId } from "./fdx/board.js";
import { paragraphPages, wrapText } from "./text/layout.js";
import {
  KIND_FDX,
  paragraphText,
  type BoardCard,
  type ElementKind,
  type Paragraph,
  type Script,
  type TextRun,
} from "./model.js";

const CYCLE: ElementKind[] = ["scene-heading", "action", "character", "parenthetical", "dialogue", "transition"];

export const ELEMENT_MENU: { kind: ElementKind; label: string }[] = [
  { kind: "scene-heading", label: "Scene Heading" },
  { kind: "action", label: "Action" },
  { kind: "character", label: "Character" },
  { kind: "parenthetical", label: "Parenthetical" },
  { kind: "dialogue", label: "Dialogue" },
  { kind: "transition", label: "Transition" },
  { kind: "shot", label: "Shot" },
  { kind: "general", label: "General" },
  { kind: "outline-1", label: "Outline" },
];

/** Ranked element types for Tab, starting with the most likely alternative. */
export function guessKinds(kind: ElementKind, text: string, previous: ElementKind | null): ElementKind[] {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  const fromText: ElementKind[] = [];
  if (/^(?:INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)\s/u.test(upper)) fromText.push("scene-heading");
  if (/TO:\s*$/u.test(upper) || upper === "FADE OUT." || upper === "FADE IN:" || upper === "FADE TO:") fromText.push("transition");
  if (trimmed.startsWith("(") && trimmed.length < 48) fromText.push("parenthetical");
  if (trimmed.length > 0 && trimmed.length <= 32 && trimmed === upper && /[A-Z]/u.test(trimmed) && !/[.]/u.test(trimmed)) {
    fromText.push("character");
  }
  const contextual: ElementKind[] = [];
  switch (kind) {
    case "dialogue":
    case "lyric":
    case "singing":
      contextual.push("action", "parenthetical", "character", "transition");
      break;
    case "character":
    case "cast-list":
      contextual.push("action", "parenthetical", "dialogue", "transition");
      break;
    case "parenthetical":
      contextual.push("dialogue", "action", "character");
      break;
    case "action":
    case "general":
      if (previous === "scene-heading" || previous === "shot" || previous === "transition") {
        contextual.push("character", "shot", "transition", "scene-heading");
      } else if (previous === "dialogue" || previous === "character" || previous === "parenthetical") {
        contextual.push("character", "scene-heading", "transition");
      } else {
        contextual.push("character", "scene-heading", "parenthetical", "transition", "shot");
      }
      break;
    case "scene-heading":
      contextual.push("action", "shot", "character", "transition");
      break;
    case "transition":
      contextual.push("scene-heading", "action", "character");
      break;
    case "shot":
      contextual.push("action", "character", "scene-heading");
      break;
    default:
      contextual.push("action", "character", "dialogue", "scene-heading", "parenthetical", "transition");
  }
  const ordered = [...fromText, ...contextual];
  for (const item of ELEMENT_MENU) ordered.push(item.kind);
  return ordered.filter((item, index) => item !== kind && ordered.indexOf(item) === index);
}

const UPPER_KINDS = new Set<ElementKind>([
  "scene-heading",
  "character",
  "transition",
  "shot",
  "cast-list",
  "new-act",
  "end-of-act",
  "sequence",
]);

export const TRANSITIONS = [
  "CUT TO:",
  "FADE IN:",
  "FADE OUT.",
  "FADE TO:",
  "DISSOLVE TO:",
  "SMASH CUT TO:",
  "MATCH CUT TO:",
  "BACK TO:",
];

export const TIMES_OF_DAY = ["DAY", "NIGHT", "MORNING", "EVENING", "LATER", "CONTINUOUS", "MOMENTS LATER"];

export const SCENE_INTROS = ["INT. ", "EXT. ", "INT./EXT. ", "I/E. ", "EST. "];

export interface EnterResult {
  /** Retype the current paragraph and do not insert another. */
  become?: ElementKind;
  /** Kind of the paragraph that receives the text after the caret. */
  next: ElementKind | null;
}

export interface SceneSpan {
  start: number;
  end: number;
  heading: string;
  number: string;
  summary: string;
  arcs: string[];
}

export interface CharacterStat {
  name: string;
  cues: number;
  words: number;
  scenes: string[];
}

export interface LocationStat {
  location: string;
  scenes: number;
  headings: string[];
}

export interface FindHit {
  index: number;
  start: number;
  end: number;
}

export function cycleKind(kind: ElementKind, direction: 1 | -1): ElementKind {
  const index = CYCLE.indexOf(kind);
  if (index < 0) return direction === 1 ? "action" : "transition";
  return CYCLE[(index + direction + CYCLE.length) % CYCLE.length]!;
}

export function enterResult(kind: ElementKind, textBeforeCaret: string, caretAtEnd: boolean): EnterResult {
  const empty = caretAtEnd && textBeforeCaret.trim() === "";
  if ((kind === "character" || kind === "cast-list") && empty) return { become: "action", next: null };
  if ((kind === "dialogue" || kind === "lyric" || kind === "singing") && empty) return { become: "action", next: null };
  switch (kind) {
    case "scene-heading":
    case "shot":
    case "sequence":
    case "new-act":
    case "end-of-act":
      return { next: "action" };
    case "character":
    case "cast-list":
      return { next: "dialogue" };
    case "parenthetical":
      return { next: "dialogue" };
    case "dialogue":
    case "lyric":
    case "singing":
      return { next: "character" };
    case "transition":
      return { next: "scene-heading" };
    case "outline-1":
    case "outline-2":
    case "outline-3":
    case "outline-4":
    case "section":
      return { next: "outline-body" };
    case "outline-body":
    case "synopsis":
    case "summary":
      return { next: "action" };
    default:
      return { next: "action" };
  }
}

export function makeParagraph(kind: ElementKind, text = ""): Paragraph {
  const paragraph: Paragraph = {
    kind,
    fdxType: KIND_FDX[kind],
    runs: [{ text: UPPER_KINDS.has(kind) ? text.toUpperCase() : text }],
    notes: [],
    attributes: {},
    preserved: [],
  };
  if (kind.startsWith("outline-") && kind !== "outline-body") {
    paragraph.level = Number(kind.slice("outline-".length));
  }
  return paragraph;
}

export function blankScript(): Script {
  return {
    version: "5",
    documentType: "Script",
    template: "No",
    titlePage: [
      { type: "Title", text: "UNTITLED SCREENPLAY" },
      { type: "Credit", text: "Written by" },
      { type: "Author", text: "" },
      { type: "Draft date", text: "" },
      { type: "Contact", text: "" },
    ],
    paragraphs: [makeParagraph("scene-heading", "INT. LOCATION - DAY"), makeParagraph("action", "")],
    preserved: [],
    preservedContent: [],
    board: ensureBoard({}),
  };
}

export function applyKind(paragraph: Paragraph, kind: ElementKind): void {
  paragraph.kind = kind;
  paragraph.fdxType = KIND_FDX[kind];
  if (UPPER_KINDS.has(kind)) {
    for (const run of paragraph.runs) run.text = run.text.toUpperCase();
  }
  if (kind.startsWith("outline-") && kind !== "outline-body") {
    paragraph.level = Number(kind.slice("outline-".length));
  }
}

export function isUpperKind(kind: ElementKind): boolean {
  return UPPER_KINDS.has(kind);
}

export function characterBase(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*\^$/u, "")
    .trim()
    .toUpperCase();
}

export function normalizeParenthetical(text: string): string {
  const inner = text.trim().replace(/^\(+/, "").replace(/\)+$/, "").trim();
  return inner ? `(${inner})` : "";
}

function styleKey(run: TextRun): string {
  return [run.bold, run.italic, run.underline, run.strike, run.revisionId ?? ""].join("|");
}

export function splitRuns(runs: readonly TextRun[], offset: number): [TextRun[], TextRun[]] {
  const left: TextRun[] = [];
  const right: TextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const end = cursor + run.text.length;
    if (end <= offset) left.push({ ...run });
    else if (cursor >= offset) right.push({ ...run });
    else {
      const cut = offset - cursor;
      left.push({ ...run, text: run.text.slice(0, cut) });
      right.push({ ...run, text: run.text.slice(cut) });
    }
    cursor = end;
  }
  if (left.length === 0) left.push({ text: "" });
  if (right.length === 0) right.push({ text: "" });
  return [left, right];
}

export function joinRuns(left: readonly TextRun[], right: readonly TextRun[]): TextRun[] {
  const runs = [...left.map((run) => ({ ...run })), ...right.map((run) => ({ ...run }))].filter((run) => run.text !== "");
  const merged: TextRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && styleKey(previous) === styleKey(run)) previous.text += run.text;
    else merged.push({ ...run });
  }
  return merged.length > 0 ? merged : [{ text: "" }];
}

export function markRevisionRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  revisionId: string,
): TextRun[] {
  if (end < start) return markRevisionRange(runs, end, start, revisionId);
  if (start === end) return runs.map((run) => ({ ...run }));
  const chars: TextRun[] = [];
  for (const run of runs) {
    for (const character of run.text) {
      chars.push({
        text: character,
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.underline ? { underline: true } : {}),
        ...(run.strike ? { strike: true } : {}),
        ...(run.revisionId ? { revisionId: run.revisionId } : {}),
      });
    }
  }
  for (let index = start; index < end && index < chars.length; index += 1) {
    const character = chars[index];
    if (character) character.revisionId = revisionId;
  }
  return joinRuns(chars, []);
}

export function toggleStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  style: "bold" | "italic" | "underline" | "strike",
): TextRun[] {
  if (end < start) return toggleStyle(runs, end, start, style);
  if (start === end) return runs.map((run) => ({ ...run }));
  const chars: TextRun[] = [];
  for (const run of runs) {
    for (const character of run.text) {
      chars.push({
        text: character,
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.underline ? { underline: true } : {}),
        ...(run.strike ? { strike: true } : {}),
        ...(run.revisionId ? { revisionId: run.revisionId } : {}),
      });
    }
  }
  const slice = chars.slice(start, end);
  const turnOff = slice.length > 0 && slice.every((character) => character[style]);
  for (let index = start; index < end && index < chars.length; index += 1) {
    const character = chars[index];
    if (!character) continue;
    if (turnOff) delete character[style];
    else character[style] = true;
  }
  return joinRuns(chars, []);
}

export function sceneSpans(script: Script): SceneSpan[] {
  const spans: SceneSpan[] = [];
  const paragraphs = script.paragraphs;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (!paragraph || paragraph.kind !== "scene-heading") continue;
    let end = paragraphs.length;
    for (let cursor = index + 1; cursor < paragraphs.length; cursor += 1) {
      if (paragraphs[cursor]?.kind === "scene-heading") {
        end = cursor;
        break;
      }
    }
    spans.push({
      start: index,
      end,
      heading: paragraphText(paragraph).trim(),
      number: paragraph.sceneNumber ?? "",
      summary: paragraph.scene?.summary ?? "",
      arcs: [...(paragraph.scene?.arcCharacters ?? [])],
    });
  }
  return spans;
}

export function moveScene(script: Script, fromScene: number, toScene: number): void {
  const spans = sceneSpans(script);
  const from = spans[fromScene];
  const destination = spans[toScene];
  if (!from || !destination || fromScene === toScene) return;
  let insertAt = toScene > fromScene ? destination.end : destination.start;
  if (from.start < insertAt) insertAt -= from.end - from.start;
  const moving = script.paragraphs.splice(from.start, from.end - from.start);
  script.paragraphs.splice(insertAt, 0, ...moving);
}

export function renumberScenes(script: Script): void {
  let number = 1;
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind !== "scene-heading") continue;
    paragraph.sceneNumber = String(number);
    number += 1;
  }
}

export function slugLocation(heading: string): string {
  const match = heading.trim().match(/^(?:INT\.\/EXT\.|I\/E\.|INT\.|EXT\.|EST\.)\s+(.+?)(?:\s+-\s+.+)?$/iu);
  return match?.[1]?.trim().toUpperCase() ?? "";
}

export function characterNames(script: Script): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind !== "character") continue;
    const name = characterBase(paragraphText(paragraph));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function sceneHeadings(script: Script): string[] {
  const headings: string[] = [];
  const seen = new Set<string>();
  for (const span of sceneSpans(script)) {
    const heading = span.heading.toUpperCase();
    if (!heading || seen.has(heading)) continue;
    seen.add(heading);
    headings.push(heading);
  }
  return headings;
}

export function displayContd(script: Script, index: number): boolean {
  const paragraph = script.paragraphs[index];
  if (!paragraph || paragraph.kind !== "character") return false;
  const name = characterBase(paragraphText(paragraph));
  if (!name || /\(CONT'?D\)/iu.test(paragraphText(paragraph))) return false;
  let interrupted = false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = script.paragraphs[cursor];
    if (!previous) break;
    if (previous.kind === "scene-heading" || previous.kind === "transition" || previous.kind === "page-break") return false;
    if (previous.kind === "character") {
      return interrupted && characterBase(paragraphText(previous)) === name;
    }
    if (previous.kind === "action" || previous.kind === "shot" || previous.kind === "general") interrupted = true;
  }
  return false;
}

export interface FormatIssue {
  index: number;
  message: string;
}

function followingSpeech(script: Script, index: number): boolean {
  for (let cursor = index + 1; cursor < script.paragraphs.length; cursor += 1) {
    const paragraph = script.paragraphs[cursor];
    if (!paragraph || paragraphText(paragraph).trim() === "") continue;
    return paragraph.kind === "dialogue" || paragraph.kind === "parenthetical";
  }
  return true;
}

function editDistance(left: string, right: string): number {
  const grid = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) grid[i]![0] = i;
  for (let j = 0; j <= right.length; j += 1) grid[0]![j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min((grid[i - 1]![j] ?? 0) + 1, (grid[i]![j - 1] ?? 0) + 1, (grid[i - 1]![j - 1] ?? 0) + cost);
    }
  }
  return grid[left.length]?.[right.length] ?? 0;
}

/** Writer-facing proofread: broken cues, parentheticals, long action, and lookalike names. */
export function checkFormatting(script: Script): FormatIssue[] {
  const issues: FormatIssue[] = [];
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) continue;
    const text = paragraphText(paragraph);
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (paragraph.kind === "dialogue") {
      if (/\([^)]*\)/u.test(trimmed)) {
        issues.push({ index, message: "A parenthetical belongs on its own line, not inside the dialogue." });
      }
      let cue = false;
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const previous = script.paragraphs[cursor];
        if (!previous || paragraphText(previous).trim() === "") continue;
        if (previous.kind === "character" || previous.kind === "parenthetical") cue = true;
        break;
      }
      if (!cue) issues.push({ index, message: "Dialogue has no character cue above it." });
    }
    if (paragraph.kind === "character") {
      if (trimmed.endsWith(":")) issues.push({ index, message: "A character cue should not end with a colon." });
      if (!followingSpeech(script, index)) issues.push({ index, message: "This character cue has no dialogue." });
    }
    if (paragraph.kind === "parenthetical" && !/^\(.*\)$/u.test(trimmed)) {
      issues.push({ index, message: "Wrap the parenthetical in parentheses." });
    }
    if ((paragraph.kind === "action" || paragraph.kind === "dialogue") && / {2,}/u.test(text)) {
      issues.push({ index, message: "Extra spaces in this line." });
    }
    if (paragraph.kind === "action" && wrapText(trimmed, 60).length > 4) {
      issues.push({ index, message: "This action runs longer than four lines." });
    }
  }
  const names = characterNames(script).filter((name) => name.length >= 3);
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const a = names[left];
      const b = names[right];
      if (!a || !b || Math.abs(a.length - b.length) > 1) continue;
      if (editDistance(a, b) !== 1) continue;
      const index = script.paragraphs.findIndex(
        (paragraph) => paragraph.kind === "character" && characterBase(paragraphText(paragraph)) === b,
      );
      if (index >= 0) issues.push({ index, message: `${a} and ${b} are easy to mix up.` });
    }
  }
  return issues;
}

export function countWords(script: Script): number {
  let words = 0;
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind === "note" || paragraph.kind === "page-break") continue;
    const text = paragraphText(paragraph).trim();
    if (!text) continue;
    words += text.split(/\s+/u).length;
  }
  return words;
}

export function characterStats(script: Script): CharacterStat[] {
  const stats = new Map<string, CharacterStat>();
  let scene = "";
  let current: CharacterStat | null = null;
  for (const paragraph of script.paragraphs) {
    if (paragraph.kind === "scene-heading") {
      scene = paragraphText(paragraph).trim();
      current = null;
      continue;
    }
    if (paragraph.kind === "character") {
      const name = characterBase(paragraphText(paragraph));
      if (!name) {
        current = null;
        continue;
      }
      let stat = stats.get(name);
      if (!stat) {
        stat = { name, cues: 0, words: 0, scenes: [] };
        stats.set(name, stat);
      }
      stat.cues += 1;
      if (scene && !stat.scenes.includes(scene)) stat.scenes.push(scene);
      current = stat;
      continue;
    }
    if (paragraph.kind === "dialogue" && current) {
      const text = paragraphText(paragraph).trim();
      if (text) current.words += text.split(/\s+/u).length;
      continue;
    }
    if (paragraph.kind === "parenthetical") continue;
    current = null;
  }
  return [...stats.values()];
}

export function locationStats(script: Script): LocationStat[] {
  const stats = new Map<string, LocationStat>();
  for (const span of sceneSpans(script)) {
    const location = slugLocation(span.heading) || span.heading || "UNTITLED";
    let stat = stats.get(location);
    if (!stat) {
      stat = { location, scenes: 0, headings: [] };
      stats.set(location, stat);
    }
    stat.scenes += 1;
    stat.headings.push(span.heading);
  }
  return [...stats.values()];
}

export function completions(script: Script, kind: ElementKind, text: string): string[] {
  const upper = text.toUpperCase();
  if (kind === "transition") {
    return TRANSITIONS.filter((item) => item.startsWith(upper) && item !== upper).slice(0, 8);
  }
  if (kind === "character") {
    return characterNames(script)
      .filter((name) => name.startsWith(upper) && name !== upper)
      .slice(0, 8);
  }
  if (kind === "scene-heading") {
    const known = sceneHeadings(script).filter((heading) => heading.startsWith(upper) && heading !== upper);
    const intro = upper.match(/^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.|EST\.)\s*(.*)$/u);
    if (intro && !(intro[2] ?? "").includes(" - ")) {
      const partial = (intro[2] ?? "").trim();
      const places = locationStats(script)
        .map((item) => item.location)
        .filter((place) => place.startsWith(partial) && place !== partial)
        .map((place) => `${intro[1]} ${place} - `);
      if (places.length > 0) return places.slice(0, 8);
    }
    const time = upper.match(/^(.*?\s-\s)(\S*)$/u);
    if (time) {
      const prefix = time[1] ?? "";
      const partial = time[2] ?? "";
      const times = TIMES_OF_DAY.filter((item) => item.startsWith(partial) && item !== partial).map((item) => `${prefix}${item}`);
      return [...known, ...times].slice(0, 8);
    }
    const intros = SCENE_INTROS.filter((item) => item.startsWith(upper) && item.trim() !== upper.trim());
    return [...known, ...intros].slice(0, 8);
  }
  return [];
}

/** What a pasted or imported line most likely is. */
export function guessPlainLine(text: string, previous: ElementKind | null): ElementKind {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  if (!trimmed) return "action";
  if (/^(INT\.\/EXT\.|EXT\.\/INT\.|I\/E\.|INT\.|EXT\.|EST\.)(?=\s|$)/u.test(upper)) return "scene-heading";
  if (/TO:\s*$/u.test(upper) || upper === "FADE OUT." || upper === "FADE IN:") return "transition";
  if (trimmed.startsWith("(")) return "parenthetical";
  if (upper === trimmed && trimmed.length <= 32 && !trimmed.includes(".") && previous !== "character") return "character";
  if (previous === "character" || previous === "parenthetical") return "dialogue";
  return "action";
}

export function paragraphsFromPlain(text: string): Paragraph[] {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const paragraphs: Paragraph[] = [];
  let previous: ElementKind | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const kind = guessPlainLine(line, previous);
    paragraphs.push(makeParagraph(kind, line.trim()));
    previous = kind;
  }
  return paragraphs.length > 0 ? paragraphs : [makeParagraph("action", "")];
}

export function templateScript(kind: "tv" | "multicam" | "stage"): Script {
  const script = blankScript();
  const blocks: [ElementKind, string][] =
    kind === "tv"
      ? [
          ["outline-1", "COLD OPEN"],
          ["scene-heading", "INT. LOCATION - NIGHT"],
          ["action", ""],
          ["transition", "END OF COLD OPEN"],
          ["outline-1", "ACT ONE"],
          ["scene-heading", "INT. LOCATION - DAY"],
          ["action", ""],
          ["transition", "END OF ACT ONE"],
        ]
      : kind === "multicam"
        ? [
            ["scene-heading", "INT. LIVING ROOM - DAY"],
            ["action", "A multi-camera scene. Entrances are from the audience's left."],
            ["character", "NAME"],
            ["dialogue", ""],
          ]
        : [
            ["outline-1", "ACT ONE"],
            ["scene-heading", "THE ROOM"],
            ["action", "A stage play. The scene heading is the setting, not a slug line."],
            ["character", "NAME"],
            ["dialogue", ""],
          ];
  script.paragraphs = blocks.map(([element, text]) => makeParagraph(element, text));
  script.titlePage = [{ type: "Title", text: kind === "stage" ? "UNTITLED PLAY" : "UNTITLED EPISODE" }];
  return script;
}

export function characterDialogue(script: Script, name: string): string[] {
  const wanted = characterBase(name);
  const lines: string[] = [];
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph || paragraph.kind !== "character" || characterBase(paragraphText(paragraph)) !== wanted) continue;
    for (let cursor = index + 1; cursor < script.paragraphs.length; cursor += 1) {
      const next = script.paragraphs[cursor];
      if (!next || next.kind === "character" || next.kind === "scene-heading" || next.kind === "transition") break;
      if (next.kind === "dialogue") lines.push(paragraphText(next));
    }
  }
  return lines;
}

export function wordCounts(lines: readonly string[]): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const word of line.toLowerCase().match(/[a-z']+/gu) ?? []) {
      if (word.length < 3) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 20);
}

export function scriptBalance(script: Script): { label: string; count: number }[] {
  let interior = 0;
  let exterior = 0;
  let day = 0;
  let night = 0;
  for (const span of sceneSpans(script)) {
    const heading = span.heading.toUpperCase();
    if (heading.startsWith("EXT")) exterior += 1;
    else if (heading.startsWith("INT")) interior += 1;
    if (heading.includes("NIGHT")) night += 1;
    else if (heading.includes("DAY")) day += 1;
  }
  return [
    { label: "INT", count: interior },
    { label: "EXT", count: exterior },
    { label: "DAY", count: day },
    { label: "NIGHT", count: night },
  ];
}

export function paragraphDiff(before: readonly string[], after: readonly string[]): { kind: "same" | "cut" | "add"; text: string }[] {
  const used = new Set<number>();
  const rows: { kind: "same" | "cut" | "add"; text: string }[] = [];
  for (const line of before) {
    const at = after.findIndex((item, index) => item === line && !used.has(index));
    if (at >= 0) {
      used.add(at);
      rows.push({ kind: "same", text: line });
    } else if (line.trim()) rows.push({ kind: "cut", text: line });
  }
  after.forEach((line, index) => {
    if (!used.has(index) && line.trim()) rows.push({ kind: "add", text: line });
  });
  return rows;
}

/** Page number to print, including an A-page when the line was added after pages were locked. */
export function displayPage(script: Script, index: number, computed: number): string {
  const locked = script.paragraphs.some((paragraph) => paragraph.attributes.FolioLocked === "1");
  if (!locked) return String(computed);
  const own = script.paragraphs[index]?.attributes.FolioPage;
  if (own) return own;
  let base = String(computed);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const stamped = script.paragraphs[cursor]?.attributes.FolioPage;
    if (stamped) {
      base = stamped;
      break;
    }
  }
  const match = /^(\d+)([A-Z]?)$/u.exec(base);
  if (!match) return `${computed}A`;
  const letter = match[2] ? String.fromCharCode(match[2].charCodeAt(0) + 1) : "A";
  return `${match[1]}${letter}`;
}

export function lockPages(script: Script): void {
  const pages = paragraphPages(script);
  script.paragraphs.forEach((paragraph, index) => {
    paragraph.attributes.FolioPage = String(pages[index] ?? 1);
    paragraph.attributes.FolioLocked = "1";
  });
}

export function findInScript(script: Script, query: string): FindHit[] {
  const needle = query.trim();
  if (!needle) return [];
  const hits: FindHit[] = [];
  const lower = needle.toLowerCase();
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) continue;
    const haystack = paragraphText(paragraph).toLowerCase();
    let from = 0;
    while (from <= haystack.length) {
      const at = haystack.indexOf(lower, from);
      if (at < 0) break;
      hits.push({ index, start: at, end: at + needle.length });
      from = at + Math.max(needle.length, 1);
    }
  }
  return hits;
}

export function replaceHit(script: Script, hit: FindHit, replacement: string): void {
  const paragraph = script.paragraphs[hit.index];
  if (!paragraph) return;
  const text = paragraphText(paragraph);
  paragraph.runs = [{ text: text.slice(0, hit.start) + replacement + text.slice(hit.end) }];
}

export function replaceAll(script: Script, query: string, replacement: string): number {
  const hits = findInScript(script, query);
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    const hit = hits[index];
    if (hit) replaceHit(script, hit, replacement);
  }
  return hits.length;
}

function speechEnd(script: Script, characterIndex: number): number {
  let end = characterIndex + 1;
  while (end < script.paragraphs.length) {
    const kind = script.paragraphs[end]?.kind;
    if (kind !== "dialogue" && kind !== "parenthetical") break;
    end += 1;
  }
  return end;
}

export function toggleDual(script: Script, index: number): boolean {
  const current = script.paragraphs[index];
  if (!current) return false;
  if (current.dualGroup !== undefined) {
    const group = current.dualGroup;
    for (const paragraph of script.paragraphs) {
      if (paragraph.dualGroup === group) delete paragraph.dualGroup;
    }
    return true;
  }
  let first = index;
  while (first > 0) {
    const kind = script.paragraphs[first]?.kind;
    if (kind === "character") break;
    if (kind === "dialogue" || kind === "parenthetical") {
      first -= 1;
      continue;
    }
    break;
  }
  if (script.paragraphs[first]?.kind !== "character") return false;
  const after = speechEnd(script, first);
  if (script.paragraphs[after]?.kind !== "character") return false;
  const end = speechEnd(script, after);
  const group = script.paragraphs.reduce((max, paragraph) => Math.max(max, paragraph.dualGroup ?? 0), 0) + 1;
  for (let cursor = first; cursor < end; cursor += 1) {
    const paragraph = script.paragraphs[cursor];
    if (paragraph) paragraph.dualGroup = group;
  }
  return true;
}

const BEAT_STOP = new Set(["A", "AN", "THE", "AND", "OF", "TO", "LATER", "CONTINUOUS", "MOMENTS", "IMMEDIATELY", "AFTER"]);

function sceneIntro(value: string): string {
  const match = value
    .trim()
    .toUpperCase()
    .match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)/u);
  if (!match) return "";
  const raw = match[1] ?? "";
  if (raw.includes("INT") && raw.includes("EXT")) return "INT/EXT";
  if (raw.startsWith("I/E")) return "INT/EXT";
  if (raw.startsWith("INT")) return "INT";
  if (raw.startsWith("EXT")) return "EXT";
  if (raw.startsWith("EST")) return "EST";
  return "";
}

/** Tokens that can match a beat title to a scene heading. Keeps the time of day. */
export function beatTokens(value: string): string[] {
  const stripped = value
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\([^)]*$/u, " ")
    .toUpperCase()
    .replace(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+/u, "")
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();
  return stripped
    .split(" ")
    .filter((token) => token.length > 1 && !BEAT_STOP.has(token))
    .map((token) => (token === "HOME" ? "HOUSE" : token));
}

function beatScore(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let hits = 0;
  for (const token of left) if (rightSet.has(token)) hits += 1;
  if (hits === 0) return 0;
  return hits / new Set([...left, ...right]).size;
}

function overlapArea(left: BoardCard, right: BoardCard): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

/**
 * Attach cards to the scene whose heading matches the card title.
 * A scene may take several cards. An existing scene id, including an explicit unlink, is left as it is.
 * When interior and exterior of the same place tie, the slug intro breaks the tie.
 * A card with no title that overlaps a linked card joins that scene.
 */
export function linkBeatsToScenes(script: Script): void {
  const board = script.board;
  if (!board) return;
  const scenes = sceneSpans(script)
    .map((span) => ({
      id: script.paragraphs[span.start]?.attributes.FolioId ?? "",
      tokens: beatTokens(span.heading),
      intro: sceneIntro(span.heading),
    }))
    .filter((scene) => scene.id && scene.tokens.length > 0);
  const live = new Set(scenes.map((scene) => scene.id));
  for (const card of board.cards) {
    if (card.sceneId && !live.has(card.sceneId)) card.sceneId = undefined;
    if (card.sceneId !== undefined) continue;
    const tokens = beatTokens(card.title);
    const ranked: { id: string; score: number; intro: string }[] = [];
    for (const scene of scenes) {
      const score = beatScore(tokens, scene.tokens);
      if (score > 0) ranked.push({ id: scene.id, score, intro: scene.intro });
    }
    ranked.sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score < 0.5) continue;
    const tied = ranked.filter((item) => item.score >= best.score - 0.001);
    if (tied.length === 1) {
      card.sceneId = best.id;
      continue;
    }
    const intro = sceneIntro(card.title);
    const introHits = tied.filter((item) => intro && item.intro === intro);
    if (introHits.length === 1) card.sceneId = introHits[0]?.id;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const card of board.cards) {
      if (card.sceneId !== undefined || beatTokens(card.title).length > 0) continue;
      const areas = new Map<string, number>();
      for (const other of board.cards) {
        if (!other.sceneId || other === card) continue;
        const area = overlapArea(card, other);
        if (area <= 0) continue;
        areas.set(other.sceneId, (areas.get(other.sceneId) ?? 0) + area);
      }
      const ranked = [...areas.entries()].sort((left, right) => right[1] - left[1]);
      const top = ranked[0];
      const next = ranked[1];
      if (!top || (next && next[1] >= top[1])) continue;
      card.sceneId = top[0];
      changed = true;
    }
  }
}

/** Start another beat module on a scene. Does not replace modules already there. */
export function addSceneBeat(script: Script, sceneId: string): BoardCard | null {
  const span = sceneSpans(script).find((item) => script.paragraphs[item.start]?.attributes.FolioId === sceneId);
  if (!span || !sceneId) return null;
  const board = ensureBoard(script);
  const right = board.cards.reduce((max, card) => Math.max(max, card.x + card.width), 40);
  const card: BoardCard = {
    id: nextCardId(board),
    title: span.heading || "Beat",
    body: span.summary,
    x: right + 36,
    y: 72,
    width: 240,
    height: 156,
    color: "Gold",
    sceneId,
    attributes: {},
    preserved: [],
  };
  fitCardToText(card);
  board.cards.push(card);
  return card;
}

export function storyToBoard(script: Script): number {
  const board = ensureBoard(script);
  const titles = new Set(board.cards.map((card) => card.title.trim().toLowerCase()));
  let added = 0;
  const add = (title: string, body: string, color: string, sceneId?: string): void => {
    const key = title.trim().toLowerCase();
    if (!key) return;
    if (titles.has(key)) {
      if (sceneId) {
        const existing = board.cards.find((card) => card.title.trim().toLowerCase() === key && !card.sceneId);
        if (existing) existing.sceneId = sceneId;
      }
      return;
    }
    titles.add(key);
    const count = board.cards.length;
    const card: BoardCard = {
      id: nextCardId(board),
      title: title.trim(),
      body: body.trim(),
      x: 72 + (count % 4) * 280,
      y: 72 + Math.floor(count / 4) * 210,
      width: 240,
      height: 156,
      color,
      sceneId,
      attributes: {},
      preserved: [],
    };
    fitCardToText(card);
    board.cards.push(card);
    added += 1;
  };
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph || (paragraph.kind !== "outline-1" && paragraph.kind !== "section")) continue;
    const following = script.paragraphs[index + 1];
    const body =
      following && (following.kind === "outline-body" || following.kind === "synopsis" || following.kind === "summary")
        ? paragraphText(following)
        : "";
    add(paragraphText(paragraph), body, "Violet");
  }
  for (const span of sceneSpans(script)) {
    const color = /^EXT\b/iu.test(span.heading) ? "Green" : /^INT\b/iu.test(span.heading) ? "Gold" : "Slate";
    add(span.heading, span.summary, color, script.paragraphs[span.start]?.attributes.FolioId);
  }
  return added;
}

export function sendCardsToScript(script: Script, ids: readonly string[]): number {
  const board = script.board;
  if (!board) return 0;
  const made: Paragraph[] = [];
  for (const id of ids) {
    const card = board.cards.find((item) => item.id === id);
    if (!card) continue;
    if (card.title.trim()) made.push(makeParagraph("outline-1", card.title.trim()));
    if (card.body.trim()) made.push(makeParagraph("outline-body", card.body.trim()));
  }
  if (made.length === 0) return 0;
  const at = script.paragraphs.findIndex((paragraph) => paragraph.kind === "scene-heading");
  script.paragraphs.splice(at < 0 ? script.paragraphs.length : at, 0, ...made);
  return made.length;
}

export function alignCards(script: Script, ids: readonly string[], edge: "left" | "top"): void {
  const cards = (script.board?.cards ?? []).filter((card) => ids.includes(card.id));
  if (cards.length < 2) return;
  if (edge === "left") {
    const x = Math.min(...cards.map((card) => card.x));
    for (const card of cards) card.x = x;
    return;
  }
  const y = Math.min(...cards.map((card) => card.y));
  for (const card of cards) card.y = y;
}

export function distributeCards(script: Script, ids: readonly string[], axis: "x" | "y"): void {
  const cards = (script.board?.cards ?? [])
    .filter((card) => ids.includes(card.id))
    .sort((left, right) => left[axis] - right[axis]);
  if (cards.length < 3) return;
  const first = cards[0]?.[axis] ?? 0;
  const last = cards[cards.length - 1]?.[axis] ?? first;
  const step = (last - first) / (cards.length - 1);
  cards.forEach((card, index) => {
    card[axis] = Math.round(first + step * index);
  });
}

const CUE_COLORS = ["#c4a574", "#7ea2c4", "#7dba8a", "#d48b8b", "#b09bc9", "#d09a6a", "#8fb8b0"];

export function characterColor(name: string): string {
  let hash = 0;
  for (const character of name) hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  return CUE_COLORS[hash % CUE_COLORS.length] ?? "#c4a574";
}
