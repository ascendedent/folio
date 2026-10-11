import { extractBeats, type Beat } from "./fdx/beats.js";
import { scriptTitle, type Script } from "./model.js";
import { ACTION_WIDTH, layoutScript } from "./text/layout.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^#[0-9a-f]{3,8}$/iu.test(value)) return value;
  if (/^[a-z]{3,20}$/iu.test(value)) return value;
  return undefined;
}

function beatCard(beat: Beat): string {
  const color = safeColor(beat.color);
  const stripe = color ? ` style="border-left-color: ${escapeHtml(color)}"` : "";
  const where = [
    beat.x !== undefined && beat.y !== undefined ? `${beat.x}, ${beat.y}` : "",
    beat.sceneNumber ? `#${beat.sceneNumber}` : "",
    beat.page ? `p. ${beat.page}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const links = beat.links.length > 0 ? `<p class="meta">→ ${beat.links.map(escapeHtml).join(", ")}</p>` : "";
  return `<article class="card"${stripe}>
    <p class="source">${escapeHtml(beat.source)}</p>
    <h3>${escapeHtml(beat.title || "Untitled")}</h3>
    ${beat.body ? `<p>${escapeHtml(beat.body)}</p>` : ""}
    ${where ? `<p class="meta">${escapeHtml(where)}</p>` : ""}
    ${links}
  </article>`;
}

export function renderPreview(script: Script): string {
  const title = scriptTitle(script) || "Untitled";
  const pages = layoutScript(script);
  const beats = extractBeats(script);
  const sheets = pages
    .map((page) => {
      const label = page.number === 1 ? "" : `<div class="folio-number">${page.number}.</div>`;
      const body = escapeHtml(page.lines.map((line) => line.text).join("\n"));
      return `<section class="sheet">${label}<pre>${body}</pre></section>`;
    })
    .join("\n");
  const cards = beats.length > 0 ? beats.map(beatCard).join("\n") : `<p class="empty">No beats in this file.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #d9d3c7; color: #1c1a16; font-family: "Source Sans 3", "Segoe UI", sans-serif; }
    header { padding: 20px 28px 8px; }
    header h1 { margin: 0; font-size: 22px; font-weight: 650; }
    header p { margin: 4px 0 0; color: #5c564c; }
    .workspace { display: flex; gap: 24px; align-items: flex-start; padding: 12px 28px 40px; }
    .pages { display: flex; flex-direction: column; gap: 20px; }
    .sheet { width: 8.5in; min-height: 11in; background: white; padding: 0.7in 1in 1in 1.5in; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
    .folio-number { font-family: "Courier New", Courier, monospace; font-size: 12pt; text-align: right; margin-bottom: 12pt; }
    pre { margin: 0; width: ${ACTION_WIDTH}ch; font-family: "Courier New", Courier, monospace; font-size: 12pt; line-height: 12pt; white-space: pre; }
    .beats { width: 320px; position: sticky; top: 16px; }
    .beats h2 { margin: 0 0 12px; font-size: 15px; letter-spacing: 0.04em; text-transform: uppercase; }
    .card { background: white; border-left: 6px solid #c4b49a; padding: 10px 12px; margin-bottom: 10px; }
    .card h3 { margin: 0 0 6px; font-size: 16px; }
    .card p { margin: 0 0 6px; }
    .source, .meta { color: #6b6458; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .empty { color: #6b6458; }
    @media (max-width: 980px) {
      .workspace { flex-direction: column; }
      .beats { width: min(100%, 8.5in); position: static; }
      .sheet { width: 100%; min-height: 0; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${pages.length} page${pages.length === 1 ? "" : "s"} · ${beats.length} beat${beats.length === 1 ? "" : "s"}</p>
  </header>
  <div class="workspace">
    <div class="pages">${sheets}</div>
    <aside class="beats">
      <h2>Beats</h2>
      ${cards}
    </aside>
  </div>
</body>
</html>
`;
}
