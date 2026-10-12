import type { Script } from "../model.js";
import { layoutScript, type LayoutPage } from "./layout.js";

/** Courier is one of the standard PDF fonts, so the pages match the formatted text. */
export function formatPdf(script: Script, options?: { watermark?: string }): Uint8Array {
  const pages = layoutScript(script);
  const watermark = (options?.watermark ?? "").toUpperCase();
  const streams = pages.map((page) => pageStream(script, page, watermark));
  const objects: string[] = ["<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"];
  const contentIds: number[] = [];
  for (const stream of streams) {
    objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    contentIds.push(objects.length);
  }
  const pageIds: number[] = [];
  for (const _content of contentIds) {
    objects.push("PAGE");
    pageIds.push(objects.length);
  }
  const pagesId = objects.length + 1;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F 1 0 R >> >> >>`;
  });
  objects.push(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let cursor = byteLength("%PDF-1.4\n");
  const offsets = [0];
  const chunks = ["%PDF-1.4\n"];
  objects.forEach((body, index) => {
    const chunk = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(cursor);
    chunks.push(chunk);
    cursor += byteLength(chunk);
  });
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    table += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  table += `trailer\n<< /Size ${objects.length + 1} /Root ${objects.length} 0 R >>\nstartxref\n${cursor}\n%%EOF`;
  chunks.push(table);
  return new TextEncoder().encode(chunks.join(""));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function pdfText(value: string): string {
  const ascii = value.replace(/[^\x20-\x7e]/gu, " ");
  return ascii.replace(/\\/gu, "\\\\").replace(/\(/gu, "\\(").replace(/\)/gu, "\\)");
}

function pageStream(script: Script, page: LayoutPage, watermark: string): string {
  // Six lines to the inch: the number sits half an inch down, and the 54 body lines fill the
  // nine inches between one-inch margins.
  const lines = ["BT", "/F 12 Tf", "12 TL", "72 747 Td"];
  const label = pageLabel(script, page).padStart(58);
  lines.push(`(${pdfText(label)}) Tj`, "0 -36 Td");
  for (const line of page.lines) {
    const star = line.origin !== undefined && revised(script, line.origin) ? "* " : "";
    const scene =
      line.kind === "scene-heading" && line.origin !== undefined ? sceneNumber(script, line.origin) : "";
    const color = line.origin !== undefined && line.kind === "scene-heading" ? storyColor(script, line.origin) : "";
    if (color) lines.push(color);
    lines.push(`(${pdfText(`${scene}${star}${line.text}`.slice(0, 96))}) Tj`, "T*");
    if (color) lines.push("0 0 0 rg");
  }
  lines.push("ET");
  if (watermark) lines.push("BT", "/F 18 Tf", "1 0 0 1 140 400 Tm", `(${pdfText(watermark)}) Tj`, "ET");
  return lines.join("\n");
}

function revised(script: Script, index: number): boolean {
  return script.paragraphs[index]?.runs.some((run) => Boolean(run.revisionId)) ?? false;
}

function sceneNumber(script: Script, index: number): string {
  const number = script.paragraphs[index]?.sceneNumber;
  return number ? `${number}. ` : "";
}

function pageLabel(script: Script, page: LayoutPage): string {
  const origin = page.lines.find((line) => line.origin !== undefined)?.origin;
  if (origin === undefined) return `${page.number}.`;
  const stamped = script.paragraphs[origin]?.attributes.FolioPage;
  if (stamped) return `${stamped}.`;
  let base = String(page.number);
  for (let cursor = origin - 1; cursor >= 0; cursor -= 1) {
    const earlier = script.paragraphs[cursor]?.attributes.FolioPage;
    if (earlier) {
      base = earlier;
      break;
    }
  }
  if (!script.paragraphs.some((paragraph) => paragraph.attributes.FolioLocked === "1")) return `${page.number}.`;
  const match = /^(\d+)([A-Z]?)$/u.exec(base);
  const letter = match?.[2] ? String.fromCharCode(match[2].charCodeAt(0) + 1) : "A";
  return `${match?.[1] ?? page.number}${letter}.`;
}

function storyColor(script: Script, index: number): string {
  let scene = index;
  while (scene >= 0 && script.paragraphs[scene]?.kind !== "scene-heading") scene -= 1;
  const color = script.paragraphs[scene]?.scene?.attributes.FolioStory ?? "";
  if (color === "#7ea2c4") return "0.49 0.64 0.77 rg";
  if (color === "#7dba8a") return "0.49 0.73 0.54 rg";
  if (color === "#d48b8b") return "0.83 0.55 0.55 rg";
  if (color === "#b7a3c9") return "0.72 0.64 0.79 rg";
  if (color === "#c6a36b") return "0.78 0.64 0.42 rg";
  return "";
}
