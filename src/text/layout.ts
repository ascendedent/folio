import { paragraphText, type ElementKind, type Paragraph, type Script } from "../model.js";

/** US Screenplay, Normal: Courier 12 is 10 pitch, and the body holds 54 lines. */
export const LINES_PER_PAGE = 54;
export const ACTION_WIDTH = 60;
export const CHARACTER_INDENT = 22;
export const DIALOGUE_INDENT = 10;
export const DIALOGUE_WIDTH = 35;
export const PAREN_INDENT = 16;
export const PAREN_WIDTH = 25;
const DUAL_COLUMN = 28;

export interface LayoutLine {
  text: string;
  kind: string;
  /** Paragraph index this printed line came from. */
  origin?: number;
}

export interface LayoutPage {
  number: number;
  lines: LayoutLine[];
}

interface BuiltLine extends LayoutLine {
  group: number;
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      if (word.length > width) {
        if (current) {
          lines.push(current);
          current = "";
        }
        for (let index = 0; index < word.length; index += width) {
          lines.push(word.slice(index, index + width));
        }
        continue;
      }
      const next = current ? `${current} ${word}` : word;
      if (next.length <= width) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function pad(lines: readonly string[], spaces: number): string[] {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => (line ? prefix + line : ""));
}

function upper(text: string): string {
  return text.trim().toUpperCase();
}

function displayText(paragraph: Paragraph): string {
  return paragraphText(paragraph).trim();
}

interface Speech {
  paragraphs: Paragraph[];
}

function columnLines(speech: Speech): string[] {
  const lines: string[] = [];
  for (const paragraph of speech.paragraphs) {
    if (paragraph.kind === "character") lines.push(upper(displayText(paragraph)));
    else if (paragraph.kind === "parenthetical") {
      let text = displayText(paragraph);
      if (!text.startsWith("(")) text = `(${text})`;
      lines.push(...wrapText(text, DUAL_COLUMN));
    } else if (paragraph.kind === "dialogue") {
      lines.push(...wrapText(displayText(paragraph), DUAL_COLUMN));
    }
  }
  return lines;
}

function sideBySide(left: Speech, right: Speech): BuiltLine[] {
  const leftLines = columnLines(left);
  const rightLines = columnLines(right);
  const count = Math.max(leftLines.length, rightLines.length);
  const lines: BuiltLine[] = [];
  for (let index = 0; index < count; index += 1) {
    const l = leftLines[index] ?? "";
    const r = rightLines[index] ?? "";
    const text = r ? `${l.padEnd(DUAL_COLUMN)}    ${r}` : l;
    lines.push({ text, kind: "dialogue", group: 0 });
  }
  return lines;
}

function blockLines(paragraph: Paragraph): BuiltLine[] {
  const text = displayText(paragraph);
  switch (paragraph.kind) {
    case "scene-heading":
    case "shot":
    case "new-act":
    case "end-of-act":
    case "sequence":
      return wrapText(upper(text), ACTION_WIDTH).map((line) => ({ text: line, kind: paragraph.kind, group: 0 }));
    case "character":
    case "cast-list":
      return pad(wrapText(upper(text), ACTION_WIDTH - CHARACTER_INDENT), CHARACTER_INDENT).map((line) => ({
        text: line,
        kind: paragraph.kind,
        group: 0,
      }));
    case "parenthetical": {
      let body = text;
      if (!body.startsWith("(")) body = `(${body})`;
      return pad(wrapText(body, PAREN_WIDTH), PAREN_INDENT).map((line) => ({
        text: line,
        kind: paragraph.kind,
        group: 0,
      }));
    }
    case "dialogue":
      return pad(wrapText(text, DIALOGUE_WIDTH), DIALOGUE_INDENT).map((line) => ({
        text: line,
        kind: paragraph.kind,
        group: 0,
      }));
    case "transition":
      return wrapText(upper(text), ACTION_WIDTH).map((line) => ({
        text: line.length >= ACTION_WIDTH ? line : " ".repeat(ACTION_WIDTH - line.length) + line,
        kind: paragraph.kind,
        group: 0,
      }));
    case "centered":
      return wrapText(text, ACTION_WIDTH).map((line) => {
        const trimmed = line.trim();
        const left = Math.max(0, Math.floor((ACTION_WIDTH - trimmed.length) / 2));
        return { text: `${" ".repeat(left)}${trimmed}`, kind: paragraph.kind, group: 0 };
      });
    case "lyric":
    case "singing":
      return pad(wrapText(text, DIALOGUE_WIDTH), DIALOGUE_INDENT).map((line) => ({
        text: line,
        kind: paragraph.kind,
        group: 0,
      }));
    case "section":
    case "outline-1":
    case "outline-2":
    case "outline-3":
    case "outline-4":
    case "outline-body":
    case "synopsis":
    case "summary":
    case "action":
    case "general":
    case "unknown":
      return wrapText(text, ACTION_WIDTH).map((line) => ({ text: line, kind: paragraph.kind, group: 0 }));
    case "note":
    case "page-break":
      return [];
    default:
      return wrapText(text, ACTION_WIDTH).map((line) => ({ text: line, kind: paragraph.kind, group: 0 }));
  }
}

function wantsGap(kind: ElementKind, previous: ElementKind | null): boolean {
  if (!previous) return false;
  if (kind === "dialogue" || kind === "parenthetical" || kind === "note" || kind === "page-break") return false;
  if (previous === "scene-heading" && (kind === "action" || kind === "character" || kind === "shot")) return false;
  return true;
}

function buildLines(script: Script): BuiltLine[] {
  const lines: BuiltLine[] = [];
  let previous: ElementKind | null = null;
  let index = 0;

  const append = (incoming: BuiltLine[], gap: boolean): void => {
    if (gap && lines.length > 0 && lines[lines.length - 1]?.kind !== "page-break") {
      lines.push({ text: "", kind: "blank", group: 0 });
    }
    lines.push(...incoming);
  };

  while (index < script.paragraphs.length) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) break;
    if (paragraph.startsNewPage || paragraph.kind === "page-break") {
      lines.push({ text: "", kind: "page-break", group: 0, origin: index });
      previous = null;
      if (paragraph.kind === "page-break") {
        index += 1;
        continue;
      }
    }
    const dual = paragraph.dualGroup;
    if (dual !== undefined) {
      const origin = index;
      const chunk: Paragraph[] = [];
      while (index < script.paragraphs.length && script.paragraphs[index]?.dualGroup === dual) {
        const member = script.paragraphs[index];
        if (member) chunk.push(member);
        index += 1;
      }
      const characterAt = chunk.flatMap((item, itemIndex) => (item.kind === "character" ? [itemIndex] : []));
      if (lines.length > 0) lines.push({ text: "", kind: "blank", group: 0 });
      if (characterAt.length === 2) {
        const split = characterAt[1] ?? chunk.length;
        lines.push(
          ...sideBySide(
            { paragraphs: chunk.slice(0, split) },
            { paragraphs: chunk.slice(split) },
          ).map((line) => ({ ...line, origin })),
        );
      } else {
        chunk.forEach((member, memberIndex) => {
          lines.push(...blockLines(member).map((line) => ({ ...line, origin: origin + memberIndex })));
        });
      }
      previous = chunk[chunk.length - 1]?.kind ?? previous;
      continue;
    }

    if (paragraph.kind === "note") {
      index += 1;
      continue;
    }
    const rendered = blockLines(paragraph).map((line) => ({ ...line, origin: index }));
    append(rendered, wantsGap(paragraph.kind, previous));
    previous = paragraph.kind;
    index += 1;
  }
  return assignGroups(lines);
}

/**
 * Scene headings stay with the next line. A character cue stays with its
 * parenthetical and the first line of dialogue. Longer speeches may split.
 */
function assignGroups(lines: BuiltLine[]): BuiltLine[] {
  const grouped = lines.map((line) => ({ ...line, group: 0 }));
  let nextGroup = 1;
  for (let index = 0; index < grouped.length; index += 1) {
    const line = grouped[index];
    if (!line || line.kind === "blank" || line.kind === "page-break") continue;
    if (line.kind === "scene-heading") {
      const group = nextGroup;
      nextGroup += 1;
      line.group = group;
      let cursor = index + 1;
      let attached = false;
      while (cursor < grouped.length && !attached) {
        const candidate = grouped[cursor];
        if (!candidate || candidate.kind === "page-break") break;
        candidate.group = group;
        if (candidate.kind !== "blank") attached = true;
        cursor += 1;
      }
      continue;
    }
    if (line.kind === "character") {
      const group = line.group !== 0 ? line.group : nextGroup;
      if (line.group === 0) nextGroup += 1;
      line.group = group;
      let cursor = index;
      let sawDialogue = false;
      while (cursor < grouped.length) {
        const candidate = grouped[cursor];
        if (!candidate) break;
        if (candidate.kind === "page-break") break;
        if (candidate.kind === "blank" && cursor !== index) break;
        if (
          candidate.kind !== "character" &&
          candidate.kind !== "parenthetical" &&
          candidate.kind !== "dialogue" &&
          candidate.kind !== "blank"
        ) {
          break;
        }
        if (candidate.kind === "dialogue") {
          if (sawDialogue) break;
          sawDialogue = true;
          candidate.group = group;
          break;
        }
        candidate.group = group;
        cursor += 1;
      }
    }
  }
  return grouped;
}

function pageFrom(lines: LayoutLine[], number: number): LayoutPage {
  const copy = [...lines];
  while (copy.length > 0 && copy[0]?.kind === "blank") copy.shift();
  while (copy.length > 0 && copy[copy.length - 1]?.kind === "blank") copy.pop();
  return { number, lines: copy };
}

function naivePages(lines: readonly BuiltLine[]): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let current: LayoutLine[] = [];
  const flush = (): void => {
    const page = pageFrom(current, pages.length + 1);
    if (page.lines.length > 0) pages.push(page);
    current = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.kind === "page-break") {
      flush();
      continue;
    }
    if (line.group !== 0 && current.length > 0) {
      let size = 0;
      let cursor = index;
      while (cursor < lines.length && lines[cursor]?.group === line.group) {
        size += 1;
        cursor += 1;
      }
      if (size <= LINES_PER_PAGE && current.length + size > LINES_PER_PAGE) {
        flush();
      }
    }
    if (current.length >= LINES_PER_PAGE) flush();
    if (line.kind === "blank" && current.length === 0) continue;
    const copy: LayoutLine = { text: line.text, kind: line.kind };
    if (line.origin !== undefined) copy.origin = line.origin;
    current.push(copy);
  }
  flush();
  return pages;
}

function lastContent(lines: readonly LayoutLine[]): { index: number; kind: string } | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && line.kind !== "blank") return { index, kind: line.kind };
  }
  return null;
}

/** Move a trailing scene heading or an unjoined character cue onto the next page. */
export function pullOrphans(pages: LayoutPage[]): boolean {
  let moved = false;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!page) continue;
    const last = lastContent(page.lines);
    if (!last) continue;
    if (last.kind !== "scene-heading" && last.kind !== "character" && last.kind !== "parenthetical") continue;
    const follower = pages[index + 1]?.lines.find((line) => line.kind !== "blank");
    const joined =
      last.kind === "scene-heading"
        ? follower?.kind === "action" || follower?.kind === "character" || follower?.kind === "shot" || follower?.kind === "dialogue"
        : follower?.kind === "dialogue" || follower?.kind === "parenthetical" || follower?.kind === "character";
    if (page.lines.length < LINES_PER_PAGE && !joined) continue;
    let start = last.index;
    if (last.kind === "parenthetical" || last.kind === "character") {
      while (start > 0) {
        const previous = page.lines[start - 1];
        if (!previous) break;
        if (previous.kind === "character" || previous.kind === "parenthetical") {
          start -= 1;
          continue;
        }
        break;
      }
    } else {
      while (start > 0 && page.lines[start - 1]?.kind === "scene-heading") start -= 1;
    }
    if (start === 0) continue;
    const spill = page.lines.splice(start);
    while (page.lines.length > 0 && page.lines[page.lines.length - 1]?.kind === "blank") page.lines.pop();
    const next = pages[index + 1] ?? { number: pages.length + 1, lines: [] };
    if (!pages[index + 1]) pages.push(next);
    while (spill.length > 0 && spill[0]?.kind === "blank") spill.shift();
    next.lines = [...spill, ...next.lines];
    moved = true;
  }
  return moved;
}

function spillOverflow(pages: LayoutPage[]): boolean {
  let spilled = false;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!page || page.lines.length <= LINES_PER_PAGE) continue;
    const extra = page.lines.splice(LINES_PER_PAGE);
    const next = pages[index + 1] ?? { number: pages.length + 1, lines: [] };
    if (!pages[index + 1]) pages.push(next);
    while (extra.length > 0 && extra[0]?.kind === "blank") extra.shift();
    next.lines = [...extra, ...next.lines];
    spilled = true;
  }
  return spilled;
}

export interface PagePiece {
  index: number;
  /** Start offset in the paragraph text. */
  start: number;
  /** End offset in the paragraph text. The pieces of one paragraph cover it without gaps. */
  end: number;
}

function wrapWidth(kind: string): number {
  if (kind === "dialogue" || kind === "lyric" || kind === "singing") return DIALOGUE_WIDTH;
  if (kind === "parenthetical") return PAREN_WIDTH;
  if (kind === "character" || kind === "cast-list") return ACTION_WIDTH - CHARACTER_INDENT;
  return ACTION_WIDTH;
}

/** Offsets of each wrapped line. Adjacent ranges meet, and together they cover the whole string. */
function sourceRanges(text: string, width: number): { start: number; end: number }[] {
  const lead = text.length - text.trimStart().length;
  const body = text.trim();
  const ranges: { start: number; end: number }[] = [];
  let origin = 0;
  for (const part of body.split("\n")) {
    const words: { start: number; end: number }[] = [];
    const matcher = /\S+/gu;
    let found: RegExpExecArray | null;
    while ((found = matcher.exec(part))) words.push({ start: origin + found.index, end: origin + found.index + found[0].length });
    if (words.length === 0) ranges.push({ start: origin, end: origin });
    else {
      let start = words[0]?.start ?? origin;
      let end = words[0]?.end ?? origin;
      let length = end - start;
      for (const word of words.slice(1)) {
        const wordLength = word.end - word.start;
        if (wordLength > width) {
          if (length > 0) ranges.push({ start, end });
          for (let at = word.start; at < word.end; at += width) {
            ranges.push({ start: at, end: Math.min(word.end, at + width) });
          }
          start = word.end;
          end = word.end;
          length = 0;
          continue;
        }
        const next = length === 0 ? wordLength : length + 1 + wordLength;
        if (length > 0 && next > width) {
          ranges.push({ start, end });
          start = word.start;
          end = word.end;
          length = wordLength;
        } else {
          if (length === 0) start = word.start;
          end = word.end;
          length = next;
        }
      }
      if (length > 0) ranges.push({ start, end });
    }
    origin += part.length + 1;
  }
  if (ranges.length === 0) return [{ start: 0, end: text.length }];
  const shifted = ranges.map((range) => ({ start: range.start + lead, end: range.end + lead }));
  for (let index = 0; index < shifted.length - 1; index += 1) {
    const next = shifted[index + 1];
    const current = shifted[index];
    if (current && next) current.end = next.start;
  }
  const first = shifted[0];
  const last = shifted[shifted.length - 1];
  if (first) first.start = 0;
  if (last) last.end = text.length;
  return shifted;
}

/**
 * The paragraphs on each printed page. A paragraph that crosses a page is
 * split into pieces so the editor can continue it on the next sheet.
 */
export function pagePieces(script: Script): PagePiece[][] {
  const pages = layoutScript(script);
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.origin === undefined || line.kind === "blank" || line.kind === "page-break") continue;
      counts.set(line.origin, (counts.get(line.origin) ?? 0) + 1);
    }
  }
  const ranges = new Map<number, { start: number; end: number }[]>();
  const used = new Map<number, number>();
  const pieces: PagePiece[][] = pages.map(() => []);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const lines = pages[pageIndex]?.lines ?? [];
    let cursor = 0;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (!line || line.origin === undefined || line.kind === "blank" || line.kind === "page-break") {
        cursor += 1;
        continue;
      }
      const origin = line.origin;
      let count = 0;
      while (
        cursor + count < lines.length &&
        lines[cursor + count]?.origin === origin &&
        lines[cursor + count]?.kind !== "blank" &&
        lines[cursor + count]?.kind !== "page-break"
      ) {
        count += 1;
      }
      const paragraph = script.paragraphs[origin];
      if (!paragraph) {
        cursor += count;
        continue;
      }
      if (paragraph.dualGroup !== undefined) {
        const group = paragraph.dualGroup;
        const already = pieces[pageIndex]?.some((piece) => script.paragraphs[piece.index]?.dualGroup === group);
        if (!already) {
          for (let member = 0; member < script.paragraphs.length; member += 1) {
            const item = script.paragraphs[member];
            if (item?.dualGroup !== group) continue;
            pieces[pageIndex]?.push({ index: member, start: 0, end: paragraphText(item).length });
          }
        }
        cursor += count;
        continue;
      }
      const text = paragraphText(paragraph);
      let source = ranges.get(origin);
      if (!source) {
        source = sourceRanges(text, wrapWidth(paragraph.kind));
        const expected = counts.get(origin) ?? 0;
        if (source.length !== expected) source = [{ start: 0, end: text.length }];
        ranges.set(origin, source);
      }
      const taken = used.get(origin) ?? 0;
      if (taken >= source.length) {
        cursor += count;
        continue;
      }
      const portion = source.length === 1 ? source : source.slice(taken, taken + count);
      const start = portion[0]?.start ?? 0;
      const end = portion[portion.length - 1]?.end ?? text.length;
      pieces[pageIndex]?.push({ index: origin, start, end });
      used.set(origin, source.length === 1 ? source.length : taken + portion.length);
      cursor += count;
    }
  }
  if (pieces.length === 0) pieces.push([]);
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph || (paragraph.kind !== "note" && paragraph.kind !== "page-break")) continue;
    if (pieces.some((page) => page.some((piece) => piece.index === index))) continue;
    let host = 0;
    for (let pageIndex = 0; pageIndex < pieces.length; pageIndex += 1) {
      if (pieces[pageIndex]?.some((piece) => piece.index < index)) host = pageIndex;
    }
    const page = pieces[host] ?? pieces[0];
    if (!page) continue;
    const at = page.findIndex((piece) => piece.index > index);
    const piece = { index, start: 0, end: paragraphText(paragraph).length };
    if (at < 0) page.push(piece);
    else page.splice(at, 0, piece);
  }
  return pieces;
}

/** Page number for each paragraph, using the same pagination as formatted text. */
export function paragraphPages(script: Script): number[] {
  const pages = layoutScript(script);
  const firstPage = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.origin === undefined || firstPage.has(line.origin)) continue;
      firstPage.set(line.origin, page.number);
    }
  }
  const result: number[] = [];
  let carry = 1;
  for (let index = 0; index < script.paragraphs.length; index += 1) {
    const page = firstPage.get(index);
    if (page !== undefined) carry = page;
    result.push(carry);
  }
  return result;
}

let layoutCacheKey = "";
let layoutCache: LayoutPage[] | null = null;

function layoutKey(script: Script): string {
  let key = `${script.paragraphs.length}:`;
  for (const paragraph of script.paragraphs) {
    key += paragraph.kind[0] ?? "";
    key += paragraph.startsNewPage ? "P" : "";
    for (const run of paragraph.runs) key += `${run.text}\n`;
  }
  return key;
}

export function layoutScript(script: Script): LayoutPage[] {
  const key = layoutKey(script);
  if (layoutCache && key === layoutCacheKey) return layoutCache;
  let pages = naivePages(buildLines(script));
  for (let pass = 0; pass < 8; pass += 1) {
    const pulled = pullOrphans(pages);
    const spilled = spillOverflow(pages);
    pages = pages.filter((page) => page.lines.length > 0);
    if (!pulled && !spilled) break;
  }
  layoutCache = pages.map((page, index) => ({ number: index + 1, lines: page.lines }));
  layoutCacheKey = key;
  return layoutCache;
}

function cueName(text: string): string {
  return text
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/\s*\^$/u, "")
    .trim()
    .toUpperCase();
}

/** The character cue that owns this dialogue or parenthetical. */
function owningCue(script: Script, origin: number): { index: number; name: string } | null {
  for (let index = origin; index >= 0; index -= 1) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) break;
    if (paragraph.kind === "character") {
      const name = cueName(paragraphText(paragraph));
      return name ? { index, name } : null;
    }
    if (paragraph.kind !== "dialogue" && paragraph.kind !== "parenthetical") return null;
  }
  return null;
}

function edgeLine(lines: readonly LayoutLine[], fromEnd: boolean): LayoutLine | undefined {
  const ordered = fromEnd ? [...lines].reverse() : lines;
  return ordered.find((line) => line.kind !== "blank" && line.kind !== "page-break");
}

export interface PageMark {
  more: boolean;
  continuedName: string;
}

/** (MORE) and a continued cue where one speech crosses a printed page. */
export function pageMarks(script: Script): PageMark[] {
  const pages = layoutScript(script);
  return pages.map((page, index) => {
    const next = pages[index + 1];
    const last = edgeLine(page.lines, true);
    const firstNext = next ? edgeLine(next.lines, false) : undefined;
    let more = false;
    if (
      last?.origin !== undefined &&
      firstNext?.origin !== undefined &&
      (last.kind === "dialogue" || last.kind === "parenthetical") &&
      (firstNext.kind === "dialogue" || firstNext.kind === "parenthetical")
    ) {
      const cue = owningCue(script, last.origin);
      const nextCue = owningCue(script, firstNext.origin);
      more = cue !== null && nextCue !== null && cue.index === nextCue.index;
    }
    const first = edgeLine(page.lines, false);
    let continuedName = "";
    if (first?.origin !== undefined && (first.kind === "dialogue" || first.kind === "parenthetical")) {
      const cue = owningCue(script, first.origin);
      if (cue) {
        const cuePage = pages.findIndex((item) =>
          item.lines.some((line) => line.origin === cue.index && line.kind === "character"),
        );
        if (cuePage !== -1 && cuePage < index) continuedName = cue.name;
      }
    }
    return { more, continuedName };
  });
}

export function formatText(script: Script): string {
  const pages = layoutScript(script);
  const marks = pageMarks(script);
  return pages
    .map((page, index) => {
      const mark = marks[index];
      const lines = [...page.lines.map((line) => line.text)];
      if (mark?.continuedName) lines.unshift(`${" ".repeat(CHARACTER_INDENT)}${mark.continuedName} (CONT'D)`, "");
      if (mark?.more) lines.push("", `${" ".repeat(CHARACTER_INDENT)}(MORE)`);
      const body = lines.join("\n");
      if (page.number === 1) return body;
      const label = `${page.number}.`;
      const header = `${" ".repeat(Math.max(0, ACTION_WIDTH - label.length))}${label}`;
      return `${header}\n\n${body}`;
    })
    .join("\n\f\n");
}
