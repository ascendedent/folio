import { paragraphText, type Paragraph, type Script, type TitleField } from "../model.js";
import { extractBeats } from "../fdx/beats.js";
import { writeEmphasis } from "./emphasis.js";

const SCENE_RE = /^(?:int|ext|est|int\.?\/ext|i\/e)(?:\.|\s)/iu;

function writeTitle(fields: readonly TitleField[]): string {
  if (fields.length === 0) return "";
  const lines = fields.map((field) => {
    const parts = field.text.split("\n");
    const first = parts[0] ?? "";
    const rest = parts.slice(1).map((line) => `    ${line}`);
    return [`${field.type}: ${first}`, ...rest].join("\n");
  });
  return `${lines.join("\n")}\n\n`;
}

function sceneLine(paragraph: Paragraph): string {
  const text = paragraphText(paragraph).trim();
  const body = SCENE_RE.test(text) ? text : `.${text}`;
  return paragraph.sceneNumber ? `${body} #${paragraph.sceneNumber}#` : body;
}

function isSecondDualCharacter(paragraphs: readonly Paragraph[], index: number): boolean {
  const group = paragraphs[index]?.dualGroup;
  if (group === undefined) return false;
  let seen = 0;
  for (let cursor = 0; cursor <= index; cursor += 1) {
    const paragraph = paragraphs[cursor];
    if (paragraph?.dualGroup === group && paragraph.kind === "character") seen += 1;
  }
  return seen >= 2;
}

function actionText(paragraph: Paragraph): string {
  const text = writeEmphasis(paragraph.runs);
  const first = text.split("\n")[0]?.trim() ?? "";
  const risky =
    SCENE_RE.test(first) ||
    first.startsWith("#") ||
    first.startsWith("=") ||
    first.startsWith(">") ||
    first.startsWith(".") ||
    first.startsWith("!") ||
    first.startsWith("@") ||
    first === first.toUpperCase() && /[A-Z]/u.test(first) && first.length > 0 && !first.includes(" ");
  if (!risky) return text;
  return text
    .split("\n")
    .map((line, lineIndex) => (lineIndex === 0 ? `!${line}` : line))
    .join("\n");
}

function formatParagraph(paragraphs: readonly Paragraph[], index: number): string | null {
  const paragraph = paragraphs[index];
  if (!paragraph) return null;
  const text = paragraphText(paragraph).trim();
  switch (paragraph.kind) {
    case "scene-heading": {
      const lines = [sceneLine(paragraph)];
      if (paragraph.scene?.summary.trim()) lines.push(`= ${paragraph.scene.summary.trim()}`);
      for (const name of paragraph.scene?.arcCharacters ?? []) lines.push(`[[arc: ${name}]]`);
      for (const note of paragraph.notes) lines.push(`[[${note}]]`);
      return lines.join("\n");
    }
    case "action":
    case "general":
    case "shot":
      return [actionText(paragraph), ...paragraph.notes.map((note) => `[[${note}]]`)].join("\n");
    case "character":
      return null;
    case "parenthetical":
    case "dialogue":
      return null;
    case "transition": {
      const transition = paragraphText(paragraph).trim();
      const printable = /TO:\s*$/u.test(transition) || transition.startsWith("FADE") ? transition : `> ${transition}`;
      return printable;
    }
    case "centered":
      return `> ${writeEmphasis(paragraph.runs)} <`;
    case "lyric":
    case "singing":
      return `~ ${writeEmphasis(paragraph.runs)}`;
    case "section":
    case "outline-1":
    case "outline-2":
    case "outline-3":
    case "outline-4": {
      const level = paragraph.level ?? Number(paragraph.kind.split("-")[1] ?? "1");
      const marks = "#".repeat(Number.isFinite(level) && level > 0 ? level : 1);
      return `${marks} ${text}`;
    }
    case "outline-body":
    case "synopsis":
    case "summary":
      return text ? `= ${text}` : null;
    case "note":
      return text ? `[[${text}]]` : null;
    case "page-break":
      return "===";
    case "new-act":
    case "end-of-act":
    case "sequence":
    case "cast-list":
      return text;
    case "unknown":
      return text ? `!${text}` : null;
    default:
      return text || null;
  }
}

function writeSpeech(paragraphs: readonly Paragraph[], index: number): { text: string; next: number } {
  const paragraph = paragraphs[index];
  if (!paragraph) return { text: "", next: index + 1 };
  let cue = paragraphText(paragraph).trim();
  if (isSecondDualCharacter(paragraphs, index)) cue = `${cue} ^`;
  const lines = [cue];
  let cursor = index + 1;
  while (cursor < paragraphs.length) {
    const next = paragraphs[cursor];
    if (!next || (next.kind !== "parenthetical" && next.kind !== "dialogue")) break;
    if (next.kind === "parenthetical") {
      let text = paragraphText(next).trim();
      if (!text.startsWith("(")) text = `(${text})`;
      if (!text.endsWith(")")) text = `${text})`;
      lines.push(text);
    } else {
      lines.push(writeEmphasis(next.runs));
    }
    for (const note of next.notes) lines.push(`[[${note}]]`);
    cursor += 1;
  }
  for (const note of paragraph.notes) lines.push(`[[${note}]]`);
  return { text: lines.join("\n"), next: cursor };
}

export function writeFountain(script: Script): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  if (extractBeats(script).some((beat) => beat.source === "board")) {
    warnings.push(
      "Beat-board positions cannot be stored in Fountain. Export .fdx to keep the board.",
    );
  }
  const chunks: string[] = [];
  let index = 0;
  while (index < script.paragraphs.length) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) break;
    if (paragraph.kind === "character") {
      const speech = writeSpeech(script.paragraphs, index);
      if (speech.text.trim()) chunks.push(speech.text);
      index = speech.next;
      continue;
    }
    const formatted = formatParagraph(script.paragraphs, index);
    if (formatted?.trim()) chunks.push(formatted);
    index += 1;
  }
  const body = chunks.join("\n\n");
  const text = `${writeTitle(script.titlePage)}${body}${body.endsWith("\n") ? "" : "\n"}`;
  return { text, warnings };
}
