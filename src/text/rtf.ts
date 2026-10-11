import { formatText } from "./layout.js";
import type { Script } from "../model.js";

function rtfEscape(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "\\") {
      out += "\\\\";
      continue;
    }
    if (char === "{") {
      out += "\\{";
      continue;
    }
    if (char === "}") {
      out += "\\}";
      continue;
    }
    const code = char.codePointAt(0) ?? 0;
    if (code > 127 && code <= 0xffff) {
      const signed = code > 32767 ? code - 65536 : code;
      out += `\\u${signed}?`;
      continue;
    }
    out += char;
  }
  return out;
}

/** Rich text with Courier 12 and the same line breaks as formatted text. */
export function formatRtf(script: Script): string {
  const body = formatText(script)
    .split("\n")
    .map((line) => (line === "\f" ? "\\page" : `${rtfEscape(line)}\\par`))
    .join("\n");
  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\fmodern Courier New;}}
\\paperw12240\\paperh15840
\\margl2160\\margr1440\\margt1440\\margb1440
\\f0\\fs24\\sl240\\slmult1
${body}
}`;
}
