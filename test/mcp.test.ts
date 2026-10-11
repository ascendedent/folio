import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitchen = path.join(root, "fixtures", "kitchen.fdx");

function frame(message: unknown): Buffer {
  const body = JSON.stringify(message);
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

async function talk(messages: unknown[]): Promise<unknown[]> {
  const child = spawn("node", ["--import", "tsx", "src/mcp.ts"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const replies: unknown[] = [];
  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
  });
  for (const message of messages) child.stdin.write(frame(message));
  child.stdin.end();
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`mcp exited ${code}`))));
    child.on("error", reject);
  });
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/iu.exec(header);
    if (!match?.[1]) break;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) break;
    replies.push(JSON.parse(buffer.subarray(start, start + length).toString("utf8")));
    buffer = buffer.subarray(start + length);
  }
  return replies;
}

async function session(): Promise<{ call: (name: string, arguments_?: Record<string, unknown>) => Promise<unknown>; close: () => Promise<void> }> {
  const child = spawn("node", ["--import", "tsx", "src/mcp.ts"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  const inbox: unknown[] = [];
  let waiting: ((message: unknown) => void) | null = null;
  const deliver = (message: unknown): void => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(message);
      return;
    }
    inbox.push(message);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match?.[1]) return;
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      deliver(JSON.parse(buffer.subarray(start, start + length).toString("utf8")));
      buffer = buffer.subarray(start + length);
    }
  });
  const next = (): Promise<unknown> => {
    const queued = inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      waiting = resolve;
    });
  };
  child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }));
  await next();
  child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
  let id = 2;
  return {
    async call(name, arguments_) {
      child.stdin.write(frame({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: arguments_ ?? {} } }));
      id += 1;
      return next();
    },
    close() {
      child.stdin.end();
      return new Promise((resolve, reject) => {
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`mcp exited ${code}`))));
      });
    },
  };
}

function toolText(message: unknown): string {
  const result = (message as { result?: { content?: { text?: string }[]; isError?: boolean } }).result;
  return result?.content?.[0]?.text ?? "";
}

function toolJson(message: unknown): Record<string, unknown> & unknown[] {
  return JSON.parse(toolText(message)) as Record<string, unknown> & unknown[];
}

const DESK_TOOLS = [
  "load_script",
  "write_fdx",
  "apply_kind",
  "move_scene",
  "renumber_scenes",
  "toggle_dual",
  "check_formatting",
  "count_words",
  "character_stats",
  "location_stats",
  "scene_spans",
  "find_in_script",
  "add_scene_beat",
  "story_to_board",
  "send_cards_to_script",
  "link_beats_to_scenes",
  "character_dialogue",
  "script_balance",
  "rename_character",
  "rename_location",
  "duplicate_scene",
  "take_snapshot",
  "restore_snapshot",
  "budget_totals",
  "budget_by_category",
  "schedule_by_location",
  "sync_catalog",
  "day_out_of_days",
  "push_catalog_to_budget",
  "refresh_catalog_budget",
  "seed_cast",
  "assembly_mark",
  "align_cards",
  "distribute_cards",
  "read_paragraphs",
  "read_beats",
  "read_title_page",
  "read_production",
  "set_paragraph_text",
  "insert_paragraph",
  "remove_paragraph",
  "set_notes",
  "set_scene_card",
  "set_title_field",
  "set_beat_card",
  "set_beat_link",
  "upsert_person",
  "upsert_tag",
  "upsert_frame",
  "upsert_catalog_item",
  "upsert_budget_line",
  "upsert_shoot_day",
];

describe("MCP", () => {
  it("lists one tool per desk job and keeps lock and replace off the grant list", async () => {
    const replies = await talk([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const names = ((replies[1] as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((tool) => tool.name).sort();
    assert.deepEqual(names, [...DESK_TOOLS].sort());
    assert.equal(names.includes("edit"), false);
    assert.equal(names.includes("production"), false);
    assert.equal(names.includes("lock_pages"), false);
    assert.equal(names.includes("replace_all"), false);
    assert.equal((replies[0] as { result?: { serverInfo?: { name?: string } } }).result?.serverInfo?.name, "folio");
  });

  it("loads a script, renames a character, and writes FDX", async () => {
    const out = path.join(mkdtempSync(path.join(tmpdir(), "folio-mcp-")), "kitchen.fdx");
    const replies = await talk([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "load_script", arguments: { path: kitchen } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rename_character", arguments: { from: "MAYA", to: "MAYA REED" } } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "write_fdx", arguments: { path: out } } },
    ]);
    assert.match(toolText(replies[2]), /KITCHEN/);
    assert.equal(toolJson(replies[3]).changed, 2);
    assert.match(readFileSync(out, "utf8"), /MAYA REED/);
  });

  it("reads pages and beats, then writes a paragraph, a card, and a shooting day", async () => {
    const replies = await talk([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "set_paragraph_text", arguments: { index: 0, text: "no script" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "load_script", arguments: { path: kitchen } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_paragraphs", arguments: {} } },
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read_beats", arguments: {} } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_title_page", arguments: {} } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read_production", arguments: {} } },
    ]);
    assert.equal((replies[1] as { result?: { isError?: boolean } }).result?.isError, true);
    const paragraphs = toolJson(replies[3]) as unknown as { index: number; kind: string; text: string; folioId: string }[];
    const action = paragraphs.find((paragraph) => paragraph.text.includes("stands at the counter"));
    const heading = paragraphs.find((paragraph) => paragraph.kind === "scene-heading" && paragraph.folioId);
    assert.ok(action);
    assert.ok(heading);
    const beats = toolJson(replies[4]) as unknown as { cards: { id: string; title: string }[]; links: { from: string; to: string }[] };
    assert.equal(beats.cards.some((card) => card.id === "b1"), true);
    const title = toolJson(replies[5]) as unknown as { type: string; text: string }[];
    assert.equal(title.some((field) => field.type === "Title"), true);
    const production = toolJson(replies[6]) as unknown as { snapshots: { script?: unknown }[] };
    assert.equal(production.snapshots.every((shot) => shot.script === undefined), true);

    const desk = await session();
    await desk.call("load_script", { path: kitchen });
    const live = toolJson(await desk.call("read_paragraphs")) as unknown as { index: number; kind: string; text: string; folioId: string }[];
    const sceneId = live.find((paragraph) => paragraph.kind === "scene-heading")?.folioId ?? "";
    const actionIndex = live.find((paragraph) => paragraph.text.includes("stands at the counter"))?.index ?? action.index;
    assert.equal((toolJson(await desk.call("set_paragraph_text", { index: actionIndex, text: "MAYA sets the letter down." })) as { text?: string }).text, "MAYA sets the letter down.");
    assert.equal((toolJson(await desk.call("set_beat_card", { id: "b1", title: "Opening beat", sceneId: "" })) as { sceneId?: string }).sceneId, "");
    await desk.call("set_beat_link", { from: "b1", to: "b2", linked: true });
    await desk.call("set_beat_link", { from: "b1", to: "b2", linked: true });
    await desk.call("set_scene_card", { sceneId, summary: "The letter." });
    await desk.call("upsert_person", { name: "MAYA", role: "lead" });
    await desk.call("upsert_shoot_day", { label: "Day 1", call: "07:00", sceneIds: [sceneId] });
    await desk.call("take_snapshot", { name: "Desk" });
    const linked = toolJson(await desk.call("read_beats")) as unknown as { cards: { title: string; sceneId: string }[]; links: { from: string; to: string }[] };
    const saved = toolJson(await desk.call("read_production")) as unknown as {
      people: { name: string; role: string }[];
      days: { label: string; call: string; sceneIds: string[] }[];
      snapshots: { name: string; script?: unknown }[];
    };
    await desk.close();
    assert.equal(linked.cards.find((card) => card.title === "Opening beat")?.sceneId, "");
    assert.equal(linked.links.filter((link) => link.from === "b1" && link.to === "b2").length, 1);
    assert.equal(saved.people.some((person) => person.name === "MAYA" && person.role === "lead"), true);
    assert.equal(saved.days.some((day) => day.label === "Day 1" && day.call === "07:00" && day.sceneIds.includes(sceneId)), true);
    assert.equal(saved.snapshots.some((shot) => shot.name === "Desk" && shot.script === undefined), true);
  });
});
