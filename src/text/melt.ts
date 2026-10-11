import { blankScript, guessPlainLine, makeParagraph } from "../edit.js";
import type { Script } from "../model.js";

/** Pull visible text out of a simple PDF. Compressed streams are inflated when the runtime can. */
export async function readPdfScript(bytes: Uint8Array): Promise<Script> {
  const latin = new TextDecoder("latin1").decode(bytes);
  const pieces: string[] = [];
  const streams = latin.split(/stream\r?\n/u).slice(1);
  for (const chunk of streams) {
    const raw = chunk.split(/endstream/u)[0] ?? "";
    const text = raw.includes("Tj") || raw.includes("TJ") ? raw : await inflate(raw);
    pieces.push(textFromContent(text));
  }
  const script = blankScript();
  let previous = null as Script["paragraphs"][number]["kind"] | null;
  for (const line of pieces.join("\n").split(/\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const kind = guessPlainLine(trimmed, previous);
    script.paragraphs.push(makeParagraph(kind, trimmed));
    previous = kind;
  }
  if (script.paragraphs.length === 0) script.paragraphs.push(makeParagraph("action", ""));
  return script;
}

export function textFromContent(content: string): string {
  const lines: string[] = [];
  const pattern = /\((?:\\\)|[^)])*\)\s*Tj|\[(.*?)\]\s*TJ/gu;
  for (const match of content.matchAll(pattern)) {
    const body = match[1] ?? match[0];
    const parts = [...body.matchAll(/\((?:\\\)|[^)])*\)/gu)].map((item) => unescapePdf(item[0].slice(1, -1)));
    if (parts.length > 0) lines.push(parts.join(""));
  }
  return lines.join("\n");
}

function unescapePdf(value: string): string {
  return value.replace(/\\([()\\])/gu, "$1").replace(/\\n/gu, "\n");
}

async function inflate(raw: string): Promise<string> {
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0) & 0xff);
  if (typeof DecompressionStream === "undefined") return raw;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());
  } catch {
    return raw;
  }
}
