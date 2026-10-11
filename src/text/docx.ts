import { blankScript, paragraphsFromPlain } from "../edit.js";
import type { Script } from "../model.js";

/** Read the paragraph text out of a .docx file. Pictures and styling are left behind. */
export async function readDocxScript(bytes: Uint8Array): Promise<Script> {
  const xml = await zipText(bytes, "word/document.xml");
  const text = xml
    .replace(/<w:p[ >]/gu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"");
  const script = blankScript();
  script.paragraphs = paragraphsFromPlain(text);
  return script;
}

async function zipText(bytes: Uint8Array, name: string): Promise<string> {
  let offset = 0;
  while (offset + 30 < bytes.length && bytes[offset] === 0x50 && bytes[offset + 1] === 0x4b) {
    const method = bytes[offset + 8]! | (bytes[offset + 9]! << 8);
    const compressed = bytes[offset + 18]! | (bytes[offset + 19]! << 8) | (bytes[offset + 20]! << 16) | (bytes[offset + 21]! << 24);
    const nameLength = bytes[offset + 26]! | (bytes[offset + 27]! << 8);
    const extraLength = bytes[offset + 28]! | (bytes[offset + 29]! << 8);
    const start = offset + 30 + nameLength + extraLength;
    const fileName = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const data = bytes.subarray(start, start + compressed);
    if (fileName === name) {
      const raw = method === 0 ? data : await inflateRaw(data);
      return new TextDecoder().decode(raw);
    }
    offset = start + compressed;
  }
  throw new Error("That Word file has no document text.");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack a Word file.");
  const stream = new Blob([Uint8Array.from(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
