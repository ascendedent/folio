import type { Element } from "@xmldom/xmldom";
import type { TextRun } from "../model.js";
import { attr, childElements, directText, localName } from "../xml.js";

type StyleFlags = Pick<TextRun, "bold" | "italic" | "underline" | "strike" | "revisionId">;

function flagsFromStyle(value: string | undefined): StyleFlags {
  const flags: StyleFlags = {};
  if (!value) return flags;
  const parts = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (parts.includes("bold")) flags.bold = true;
  if (parts.includes("italic")) flags.italic = true;
  if (parts.includes("underline")) flags.underline = true;
  if (parts.includes("strikethrough") || parts.includes("strikeout")) flags.strike = true;
  return flags;
}

function mergeFlags(base: StyleFlags, extra: StyleFlags): StyleFlags {
  return {
    ...(base.bold || extra.bold ? { bold: true } : {}),
    ...(base.italic || extra.italic ? { italic: true } : {}),
    ...(base.underline || extra.underline ? { underline: true } : {}),
    ...(base.strike || extra.strike ? { strike: true } : {}),
    ...(extra.revisionId ?? base.revisionId ? { revisionId: extra.revisionId ?? base.revisionId } : {}),
  };
}

function runFrom(text: string, flags: StyleFlags): TextRun {
  const run: TextRun = { text };
  if (flags.bold) run.bold = true;
  if (flags.italic) run.italic = true;
  if (flags.underline) run.underline = true;
  if (flags.strike) run.strike = true;
  if (flags.revisionId) run.revisionId = flags.revisionId;
  return run;
}

function runsIn(element: Element, inherited: StyleFlags): TextRun[] {
  const own = mergeFlags(inherited, flagsFromStyle(attr(element, "Style")));
  const revisionId = attr(element, "RevisionID");
  if (revisionId) own.revisionId = revisionId;
  const runs: TextRun[] = [];
  let sawChild = false;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    sawChild = true;
    if (child.nodeType === 3 || child.nodeType === 4) {
      const text = child.nodeValue ?? "";
      if (text) runs.push(runFrom(text, own));
      continue;
    }
    if (child.nodeType === 1 && localName(child as Element) === "Text") {
      runs.push(...runsIn(child as Element, own));
    }
  }
  if (!sawChild) runs.push(runFrom("", own));
  return runs;
}

export function readRuns(parent: Element): TextRun[] {
  const texts = childElements(parent, "Text");
  if (texts.length === 0) return [];
  return texts.flatMap((text) => runsIn(text, {}));
}

export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function readElementText(element: Element): string {
  const paragraphs = childElements(element, "Paragraph");
  if (paragraphs.length > 0) {
    return paragraphs.map((paragraph) => runsText(readRuns(paragraph))).join("\n");
  }
  const texts = childElements(element, "Text");
  if (texts.length > 0) return texts.map((text) => directText(text)).join("");
  return directText(element);
}

export function styleAttribute(run: TextRun): string | undefined {
  const flags: string[] = [];
  if (run.bold) flags.push("Bold");
  if (run.italic) flags.push("Italic");
  if (run.underline) flags.push("Underline");
  if (run.strike) flags.push("Strikethrough");
  return flags.length > 0 ? flags.join("+") : undefined;
}
