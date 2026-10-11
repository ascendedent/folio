import type { TextRun } from "../model.js";

type Marker = "***" | "**" | "*" | "_";

function markerAt(input: string, index: number, stack: readonly Marker[]): Marker | null {
  let marker: Marker | null = null;
  if (input.startsWith("***", index)) marker = "***";
  else if (input.startsWith("**", index)) marker = "**";
  else if (input.startsWith("*", index)) marker = "*";
  else if (input.startsWith("_", index)) marker = "_";
  if (marker !== "_") return marker;
  const closing = stack[stack.length - 1] === "_";
  const previous = index === 0 ? "" : input[index - 1] ?? "";
  if (closing || previous === "" || /\s/u.test(previous)) return "_";
  return null;
}

function apply(marker: Marker, flags: { bold: boolean; italic: boolean; underline: boolean }, on: boolean): void {
  if (marker === "***") {
    flags.bold = on;
    flags.italic = on;
    return;
  }
  if (marker === "**") flags.bold = on;
  else if (marker === "*") flags.italic = on;
  else flags.underline = on;
}

export function parseEmphasis(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const stack: Marker[] = [];
  const flags = { bold: false, italic: false, underline: false };
  let buffer = "";

  const flush = (): void => {
    if (!buffer) return;
    const run: TextRun = { text: buffer };
    if (flags.bold) run.bold = true;
    if (flags.italic) run.italic = true;
    if (flags.underline) run.underline = true;
    runs.push(run);
    buffer = "";
  };

  for (let index = 0; index < input.length; ) {
    const current = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (current === "\\" && "*_\\".includes(next)) {
      buffer += next;
      index += 2;
      continue;
    }
    const marker = markerAt(input, index, stack);
    if (marker && stack[stack.length - 1] === marker) {
      flush();
      stack.pop();
      apply(marker, flags, false);
      index += marker.length;
      continue;
    }
    if (marker && input.indexOf(marker, index + marker.length) !== -1) {
      flush();
      stack.push(marker);
      apply(marker, flags, true);
      index += marker.length;
      continue;
    }
    buffer += current;
    index += 1;
  }
  flush();
  return runs.length > 0 ? runs : [{ text: "" }];
}

export function writeEmphasis(runs: readonly TextRun[]): string {
  let out = "";
  for (const run of runs) {
    if (!run.text) continue;
    let piece = run.text;
    if (run.bold && run.italic) piece = `***${piece}***`;
    else if (run.bold) piece = `**${piece}**`;
    else if (run.italic) piece = `*${piece}*`;
    if (run.underline) piece = `_${piece}_`;
    out += piece;
  }
  return out;
}
