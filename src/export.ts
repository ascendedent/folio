import { extractBeats } from "./fdx/beats.js";
import { writeFdx } from "./fdx/write.js";
import { writeFountain } from "./fountain/write.js";
import type { Script } from "./model.js";
import { formatText } from "./text/layout.js";
import { formatRtf } from "./text/rtf.js";

export type ExportFormat = "fdx" | "fountain" | "text" | "rtf";

export function exportFormat(value: string): ExportFormat | null {
  switch (value.toLowerCase()) {
    case "fdx":
    case "finaldraft":
      return "fdx";
    case "fountain":
    case "spmd":
      return "fountain";
    case "text":
    case "txt":
    case "formatted":
    case "layout":
      return "text";
    case "rtf":
      return "rtf";
    default:
      return null;
  }
}

export function exportScript(script: Script, format: ExportFormat): { text: string; warnings: string[] } {
  if (format === "fdx") return { text: writeFdx(script), warnings: [] };
  if (format === "fountain") return writeFountain(script);
  const warnings: string[] = [];
  if (extractBeats(script).some((beat) => beat.source === "board")) {
    warnings.push("Beat-board positions are not part of formatted text. Export .fdx to keep the board.");
  }
  if (script.paragraphs.some((paragraph) => paragraph.notes.length > 0)) {
    warnings.push("Script notes are kept in FDX and Fountain, and left out of the printed page.");
  }
  const text = format === "rtf" ? formatRtf(script) : formatText(script);
  return { text, warnings };
}
