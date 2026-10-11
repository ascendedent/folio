import {
  emptyScene,
  KIND_FDX,
  type ElementKind,
  type Paragraph,
  type Script,
  type TitleField,
} from "../model.js";
import { parseEmphasis } from "./emphasis.js";

const TITLE_KEYS = new Set([
  "title",
  "credit",
  "author",
  "authors",
  "source",
  "draft date",
  "date",
  "contact",
  "notes",
  "copyright",
  "revision",
]);

const SCENE_RE = /^(?:int|ext|est|int\.?\/ext|i\/e)(?:\.|\s)/iu;

function stripBoneyard(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "");
}

function hoistNotes(source: string): string {
  return source.replace(/\[\[([\s\S]*?)\]\]/gu, (_match, body: string) => {
    return `[[${body.replace(/\s+/gu, " ").trim()}]]`;
  });
}

function extractInlineNotes(line: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const text = line
    .replace(/\[\[(.*?)\]\]/gu, (_match, body: string) => {
      const note = body.trim();
      if (note) notes.push(note);
      return "";
    })
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
  return { text, notes };
}

function isSceneHeading(line: string): boolean {
  const bare = line.replace(/\s*#[^#]+#\s*$/u, "").trim();
  return SCENE_RE.test(bare);
}

function splitSceneNumber(line: string): { text: string; sceneNumber?: string } {
  const match = line.match(/^(.*?)(?:\s+#([^#]+)#)\s*$/u);
  if (!match) return { text: line.trim() };
  const sceneNumber = match[2]?.trim();
  return sceneNumber ? { text: match[1]?.trim() ?? "", sceneNumber } : { text: line.trim() };
}

function isTransition(line: string): boolean {
  if (line !== line.toUpperCase()) return false;
  return /TO:\s*$/u.test(line) || line === "FADE OUT." || line === "FADE OUT" || line === "FADE TO BLACK.";
}

function isCharacterCue(line: string): boolean {
  const cue = line.trim().replace(/\s*\^\s*$/u, "").replace(/^@/u, "");
  if (!cue || cue.length > 40) return false;
  const withoutExtension = cue.replace(/\s*\([^)]*\)\s*$/u, "");
  if (!/[A-Z]/u.test(withoutExtension)) return false;
  if (/[a-z]/u.test(withoutExtension)) return false;
  if (isSceneHeading(cue) || isTransition(cue)) return false;
  return true;
}

function isCentered(line: string): boolean {
  return /^>.*<$/u.test(line);
}

function isLyric(line: string): boolean {
  return line.startsWith("~");
}

function followedBySpeech(lines: readonly string[], index: number): boolean {
  const next = lines[index + 1];
  if (!next || next.trim() === "") return false;
  const visible = extractInlineNotes(next.trim()).text;
  if (!visible) return false;
  if (isSceneHeading(visible) || visible.startsWith("#") || isTransition(visible)) return false;
  return true;
}

function makeParagraph(
  kind: ElementKind,
  text: string,
  extras: Partial<Paragraph> = {},
): Paragraph {
  const paragraph: Paragraph = {
    kind,
    fdxType: extras.fdxType ?? KIND_FDX[kind],
    runs: extras.runs ?? (kind === "action" || kind === "dialogue" ? parseEmphasis(text) : [{ text }]),
    notes: extras.notes ?? [],
    attributes: extras.attributes ?? {},
    preserved: [],
  };
  if (extras.sceneNumber) paragraph.sceneNumber = extras.sceneNumber;
  if (extras.alignment) paragraph.alignment = extras.alignment;
  if (extras.startsNewPage) paragraph.startsNewPage = true;
  if (extras.dualGroup !== undefined) paragraph.dualGroup = extras.dualGroup;
  if (extras.level) paragraph.level = extras.level;
  if (extras.scene) paragraph.scene = extras.scene;
  if (extras.fdxType) paragraph.fdxType = extras.fdxType;
  return paragraph;
}

function attachNotes(paragraphs: Paragraph[], notes: readonly string[]): void {
  const previous = paragraphs[paragraphs.length - 1];
  if (!previous) {
    for (const note of notes) paragraphs.push(makeParagraph("note", note, { runs: [{ text: note }] }));
    return;
  }
  for (const note of notes) {
    const arc = note.match(/^arc:\s*(.+)$/iu);
    if (arc?.[1] && previous.kind === "scene-heading") {
      previous.scene ??= emptyScene();
      previous.scene.arcCharacters.push(arc[1].trim());
      continue;
    }
    previous.notes.push(note);
  }
}

function markPreviousSpeech(paragraphs: Paragraph[], group: number): void {
  let index = paragraphs.length - 1;
  while (index >= 0 && (paragraphs[index]?.kind === "dialogue" || paragraphs[index]?.kind === "parenthetical")) {
    index -= 1;
  }
  if (index < 0 || paragraphs[index]?.kind !== "character") return;
  for (let cursor = index; cursor < paragraphs.length; cursor += 1) {
    const paragraph = paragraphs[cursor];
    if (paragraph) paragraph.dualGroup = group;
  }
}

function takeTitle(lines: readonly string[]): { fields: TitleField[]; rest: string[] } {
  const first = lines.find((line) => line.trim() !== "");
  const match = first?.match(/^([A-Za-z][A-Za-z0-9 .'/-]{0,40}):/u);
  if (!match?.[1] || !TITLE_KEYS.has(match[1].trim().toLowerCase())) {
    return { fields: [], rest: [...lines] };
  }
  const fields: TitleField[] = [];
  let index = 0;
  let current: TitleField | null = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      break;
    }
    const keyed = /^\s/u.test(line) ? null : line.match(/^([A-Za-z][A-Za-z0-9 .'/-]{0,40}):\s*(.*)$/u);
    if (keyed?.[1]) {
      current = { type: keyed[1], text: keyed[2] ?? "" };
      fields.push(current);
      continue;
    }
    if (current && /^\s+/u.test(line)) {
      const extra = line.trim();
      current.text = current.text ? `${current.text}\n${extra}` : extra;
      continue;
    }
    return { fields: [], rest: [...lines] };
  }
  return { fields, rest: lines.slice(index) };
}

function opensElement(lines: readonly string[], index: number): boolean {
  const visible = extractInlineNotes((lines[index] ?? "").trim()).text;
  if (!visible) return (lines[index] ?? "").includes("[[");
  if (visible === "===") return true;
  if (visible.startsWith("#")) return true;
  if (visible.startsWith("=") && !visible.startsWith("==")) return true;
  if (visible.startsWith("@") || visible.startsWith("!")) return true;
  if (visible.startsWith(".") && !visible.startsWith("..")) return true;
  if (isCentered(visible) || (visible.startsWith(">") && !visible.endsWith("<"))) return true;
  if (isSceneHeading(visible) || isTransition(visible) || isLyric(visible)) return true;
  if (isCharacterCue(visible) && followedBySpeech(lines, index)) return true;
  return false;
}

export function readFountain(source: string): Script {
  const cleaned = hoistNotes(stripBoneyard(source.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n")));
  const titled = takeTitle(cleaned.split("\n"));
  const lines = titled.rest;
  const paragraphs: Paragraph[] = [];
  let dualCount = 0;
  let index = 0;

  const push = (paragraph: Paragraph, notes: readonly string[]): void => {
    paragraphs.push(paragraph);
    if (notes.length > 0) attachNotes(paragraphs, notes);
  };

  while (index < lines.length) {
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "") {
      index += 1;
      continue;
    }
    const noted = extractInlineNotes(trimmed);
    if (!noted.text) {
      attachNotes(paragraphs, noted.notes);
      index += 1;
      continue;
    }
    const visible = noted.text;

    if (visible === "===") {
      push(makeParagraph("page-break", "", { runs: [{ text: "" }], startsNewPage: true }), noted.notes);
      index += 1;
      continue;
    }

    const section = visible.match(/^(#+)\s*(.*)$/u);
    if (section?.[1]) {
      const level = section[1].length;
      const fdxType = level <= 4 ? `Outline ${level}` : "Outline 4";
      push(
        makeParagraph("section", section[2] ?? "", {
          runs: [{ text: section[2] ?? "" }],
          level: Math.min(level, 4),
          fdxType,
        }),
        noted.notes,
      );
      index += 1;
      continue;
    }

    if (visible.startsWith("=") && !visible.startsWith("==")) {
      const synopsis = visible.replace(/^=\s?/u, "");
      const previous = paragraphs[paragraphs.length - 1];
      if (previous?.kind === "scene-heading") {
        previous.scene ??= emptyScene();
        previous.scene.summary = previous.scene.summary ? `${previous.scene.summary}\n${synopsis}` : synopsis;
        attachNotes(paragraphs, noted.notes);
      } else {
        push(makeParagraph("synopsis", synopsis, { runs: [{ text: synopsis }] }), noted.notes);
      }
      index += 1;
      continue;
    }

    if (isCentered(visible)) {
      const text = visible.replace(/^>\s*/u, "").replace(/\s*<$/u, "");
      push(
        makeParagraph("centered", text, {
          runs: parseEmphasis(text),
          alignment: "Center",
          fdxType: "Action",
        }),
        noted.notes,
      );
      index += 1;
      continue;
    }

    if (visible.startsWith(">") && !visible.endsWith("<")) {
      const text = visible.replace(/^>\s*/u, "");
      push(makeParagraph("transition", text, { runs: [{ text }] }), noted.notes);
      index += 1;
      continue;
    }

    if (visible.startsWith("@")) {
      index = consumeCharacter(lines, index, visible.slice(1).trim(), paragraphs, () => {
        dualCount += 1;
        return dualCount;
      });
      attachNotes(paragraphs, noted.notes);
      continue;
    }

    if (visible.startsWith("!") || (visible.startsWith(".") && !visible.startsWith(".."))) {
      const forcedScene = visible.startsWith(".");
      const text = visible.slice(1).trim();
      if (forcedScene) {
        const split = splitSceneNumber(text);
        push(
          makeParagraph("scene-heading", split.text, {
            runs: [{ text: split.text }],
            ...(split.sceneNumber ? { sceneNumber: split.sceneNumber } : {}),
          }),
          noted.notes,
        );
        index += 1;
      } else {
        index = consumeAction(lines, index, text, paragraphs, noted.notes);
      }
      continue;
    }

    if (isSceneHeading(visible)) {
      const split = splitSceneNumber(visible);
      push(
        makeParagraph("scene-heading", split.text, {
          runs: [{ text: split.text }],
          ...(split.sceneNumber ? { sceneNumber: split.sceneNumber } : {}),
        }),
        noted.notes,
      );
      index += 1;
      continue;
    }

    if (isTransition(visible)) {
      push(makeParagraph("transition", visible, { runs: [{ text: visible }] }), noted.notes);
      index += 1;
      continue;
    }

    if (isLyric(visible)) {
      const text = visible.replace(/^~\s*/u, "");
      push(makeParagraph("lyric", text, { runs: parseEmphasis(text) }), noted.notes);
      index += 1;
      continue;
    }

    if (isCharacterCue(visible) && followedBySpeech(lines, index)) {
      index = consumeCharacter(lines, index, visible, paragraphs, () => {
        dualCount += 1;
        return dualCount;
      });
      continue;
    }

    index = consumeAction(lines, index, visible, paragraphs, noted.notes);
  }

  return {
    version: "5",
    documentType: "Script",
    template: "No",
    titlePage: titled.fields,
    paragraphs,
    preserved: [],
    preservedContent: [],
  };
}

function consumeCharacter(
  lines: readonly string[],
  start: number,
  cueText: string,
  paragraphs: Paragraph[],
  nextGroup: () => number,
): number {
  let cue = cueText.trim();
  const dual = /\s\^\s*$/u.test(cue) || cue.endsWith("^");
  cue = cue.replace(/\s*\^\s*$/u, "").trim();
  if (dual) markPreviousSpeech(paragraphs, nextGroup());
  const group = paragraphs[paragraphs.length - 1]?.dualGroup;
  const character = makeParagraph("character", cue, {
    runs: [{ text: cue }],
    ...(dual && group !== undefined ? { dualGroup: group } : {}),
  });
  if (dual && character.dualGroup === undefined) {
    const created = nextGroup();
    character.dualGroup = created;
  }
  paragraphs.push(character);
  const speechGroup = character.dualGroup;

  let index = start + 1;
  const dialogue: string[] = [];
  const flushDialogue = (): void => {
    if (dialogue.length === 0) return;
    paragraphs.push(
      makeParagraph("dialogue", dialogue.join("\n"), {
        runs: parseEmphasis(dialogue.join("\n")),
        ...(speechGroup !== undefined ? { dualGroup: speechGroup } : {}),
      }),
    );
    dialogue.length = 0;
  };

  while (index < lines.length && (lines[index] ?? "").trim() !== "") {
    if (opensElement(lines, index) && !isParentheticalLine((lines[index] ?? "").trim())) break;
    const noted = extractInlineNotes((lines[index] ?? "").trim());
    if (!noted.text) {
      attachNotes(paragraphs, noted.notes);
      index += 1;
      continue;
    }
    if (isParentheticalLine(noted.text)) {
      flushDialogue();
      let text = noted.text;
      if (!text.startsWith("(")) text = `(${text})`;
      paragraphs.push(
        makeParagraph("parenthetical", text, {
          runs: [{ text }],
          ...(speechGroup !== undefined ? { dualGroup: speechGroup } : {}),
        }),
      );
      attachNotes(paragraphs, noted.notes);
      index += 1;
      continue;
    }
    dialogue.push(noted.text);
    attachNotes(paragraphs, noted.notes);
    index += 1;
  }
  flushDialogue();
  return index;
}

function isParentheticalLine(line: string): boolean {
  const visible = extractInlineNotes(line).text;
  return /^\(.*\)$/u.test(visible);
}

function consumeAction(
  lines: readonly string[],
  start: number,
  first: string,
  paragraphs: Paragraph[],
  notes: readonly string[],
): number {
  const collected = [first];
  const foundNotes = [...notes];
  let index = start + 1;
  while (index < lines.length && (lines[index] ?? "").trim() !== "" && !opensElement(lines, index)) {
    const noted = extractInlineNotes((lines[index] ?? "").trim());
    if (noted.text) collected.push(noted.text);
    foundNotes.push(...noted.notes);
    index += 1;
  }
  const text = collected.join("\n");
  paragraphs.push(makeParagraph("action", text, { runs: parseEmphasis(text) }));
  if (foundNotes.length > 0) attachNotes(paragraphs, foundNotes);
  return index;
}
