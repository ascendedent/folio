#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { extractBeats, type Beat } from "./fdx/beats.js";
import { exportFormat, exportScript } from "./export.js";
import { FolioError } from "./errors.js";
import { loadScript } from "./load.js";
import { scriptTitle, type Script } from "./model.js";
import { renderPreview } from "./preview.js";

const HELP = `Folio reads and writes screenplays.

Usage
  folio inspect <file> [--json]
  folio beats <file> [--json]
  folio export <file> --to fdx|fountain|text|rtf [--out path]
  folio preview <file> [--out path] [--open]

text is Final Draft's formatted text (Courier layout, 54 lines a page).
rtf is the same layout in Rich Text Format.
Fountain cannot store beat-board positions; export .fdx to keep them.
`;

function requireFile(positionals: string[]): string {
  const file = positionals[0];
  if (!file) throw new FolioError("Give a path to a .fdx or .fountain file.");
  return file;
}

function countBy(script: Script): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const paragraph of script.paragraphs) {
    const key = paragraph.fdxType || paragraph.kind;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function printBeat(beat: Beat): void {
  const place = [
    beat.x !== undefined && beat.y !== undefined ? `at ${beat.x},${beat.y}` : "",
    beat.color ? beat.color : "",
    beat.sceneNumber ? `scene ${beat.sceneNumber}` : "",
    beat.page ? `page ${beat.page}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  console.log(`[${beat.source}] ${beat.title || "(untitled)"}`);
  if (beat.body) console.log(`  ${beat.body}`);
  if (beat.sceneHeading && beat.source !== "scene-card") console.log(`  scene ${beat.sceneHeading}`);
  if (place) console.log(`  ${place}`);
  if (beat.links.length > 0) console.log(`  → ${beat.links.join(", ")}`);
}

function inspect(file: string, json: boolean): void {
  const script = loadScript(file);
  const beats = extractBeats(script);
  const report = {
    file,
    title: scriptTitle(script),
    version: script.version,
    paragraphs: countBy(script),
    preserved: script.preserved.map((element) => element.name),
    preservedContent: script.preservedContent.map((element) => element.name),
    beats: beats.reduce<Record<string, number>>((counts, beat) => {
      counts[beat.source] = (counts[beat.source] ?? 0) + 1;
      return counts;
    }, {}),
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(report.title || path.basename(file));
  if (report.version) console.log(`FDX version ${report.version}`);
  for (const [type, count] of Object.entries(report.paragraphs)) console.log(`  ${count} ${type}`);
  if (report.preserved.length > 0) console.log(`preserved: ${report.preserved.join(", ")}`);
  const beatSummary = Object.entries(report.beats)
    .map(([source, count]) => `${count} ${source}`)
    .join(", ");
  console.log(beatSummary ? `beats: ${beatSummary}` : "beats: none");
}

function beats(file: string, json: boolean): void {
  const found = extractBeats(loadScript(file));
  if (json) {
    console.log(JSON.stringify(found, null, 2));
    return;
  }
  if (found.length === 0) {
    console.log("No beats, index cards, or outline elements.");
    return;
  }
  for (const beat of found) printBeat(beat);
}

function exportFile(file: string, to: string | undefined, out: string | undefined): void {
  if (!to) throw new FolioError("export needs --to fdx, fountain, text, or rtf.");
  const format = exportFormat(to);
  if (!format) throw new FolioError(`Unknown format "${to}". Use fdx, fountain, text, or rtf.`);
  const script = loadScript(file);
  const result = exportScript(script, format);
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
  if (out) {
    writeFileSync(out, result.text);
    console.error(`wrote ${out}`);
    return;
  }
  process.stdout.write(result.text);
}

function preview(file: string, out: string | undefined, open: boolean): void {
  const script = loadScript(file);
  const target = out ?? path.join(tmpdir(), "folio-preview.html");
  writeFileSync(target, renderPreview(script));
  console.log(target);
  if (!open) return;
  const child = spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
  child.unref();
}

export function run(argv: string[]): number {
  try {
    const [command, ...rest] = argv;
    if (!command || command === "--help" || command === "-h" || command === "help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (command === "inspect") {
      const args = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } }, allowPositionals: true });
      inspect(requireFile(args.positionals), args.values.json === true);
      return 0;
    }
    if (command === "beats") {
      const args = parseArgs({ args: rest, options: { json: { type: "boolean", default: false } }, allowPositionals: true });
      beats(requireFile(args.positionals), args.values.json === true);
      return 0;
    }
    if (command === "export") {
      const args = parseArgs({
        args: rest,
        options: {
          to: { type: "string" },
          out: { type: "string" },
        },
        allowPositionals: true,
      });
      exportFile(requireFile(args.positionals), args.values.to, args.values.out);
      return 0;
    }
    if (command === "preview") {
      const args = parseArgs({
        args: rest,
        options: {
          out: { type: "string" },
          open: { type: "boolean", default: false },
        },
        allowPositionals: true,
      });
      preview(requireFile(args.positionals), args.values.out, args.values.open === true);
      return 0;
    }
    throw new FolioError(`Unknown command "${command}".\n\n${HELP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  process.exit(run(process.argv.slice(2)));
}
