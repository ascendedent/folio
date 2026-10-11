import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeParagraph, moveScene, sceneSpans } from "../src/edit.js";
import { readFdx } from "../src/fdx/read.js";
import { writeFdx } from "../src/fdx/write.js";
import { emptyScene, paragraphText } from "../src/model.js";
import {
  budgetTotals,
  dayOutOfDays,
  duplicateScene,
  ensureProduction,
  ensureSceneIds,
  formatEighths,
  pushCatalogToBudget,
  renameCharacter,
  renameLocation,
  sceneEighths,
  sceneIdOf,
  scheduleByLocation,
  takeSnapshot,
  restoreSnapshot,
} from "../src/production.js";
import { fixture } from "./helpers.js";

describe("production links", () => {
  it("renames a character through cues, extensions, arcs, and cast tags", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const heading = script.paragraphs.find((paragraph) => paragraph.kind === "scene-heading");
    assert.ok(heading?.scene);
    const production = ensureProduction(script);
    production.tags.push({ id: "t1", sceneId: sceneIdOf(heading), department: "cast", text: "MAYA" });
    production.people.push({ name: "MAYA", role: "Lead", actor: "", note: "Keeps the coat." });
    assert.ok(renameCharacter(script, "maya", "MAYA CHEN") > 0);
    const cues = script.paragraphs.filter((paragraph) => paragraph.kind === "character").map((paragraph) => paragraphText(paragraph));
    assert.ok(cues.includes("MAYA CHEN"));
    assert.ok(cues.includes("MAYA CHEN (V.O.)"));
    assert.deepEqual(heading?.scene?.arcCharacters, ["MAYA CHEN"]);
    assert.equal(production.tags.find((tag) => tag.id === "t1")?.text, "MAYA CHEN");
    assert.equal(production.people[0]?.name, "MAYA CHEN");
  });

  it("renames a location without dropping the time of day", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    assert.equal(renameLocation(script, "kitchen", "DINER"), 1);
    const headings = script.paragraphs.filter((paragraph) => paragraph.kind === "scene-heading").map((paragraph) => paragraphText(paragraph));
    assert.deepEqual(headings, ["INT. DINER - NIGHT", "EXT. STREET - NIGHT"]);
  });

  it("keeps a scene id when the scene moves and gives a copy its own id", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const before = sceneSpans(script).map((span) => sceneIdOf(script.paragraphs[span.start]));
    moveScene(script, 0, 1);
    const after = sceneSpans(script).map((span) => sceneIdOf(script.paragraphs[span.start]));
    assert.deepEqual(after, [before[1], before[0]]);
    const sourceHeading = paragraphText(script.paragraphs[sceneSpans(script)[0]!.start]!);
    const copyAt = duplicateScene(script, 0);
    assert.notEqual(sceneIdOf(script.paragraphs[copyAt]), after[0]);
    assert.equal(paragraphText(script.paragraphs[copyAt]!), sourceHeading);
  });

  it("estimates page eighths and a budget", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const span = sceneSpans(script)[0];
    assert.ok(span);
    assert.ok(sceneEighths(script, span) >= 1);
    assert.equal(formatEighths(3), "3/8");
    assert.equal(formatEighths(10), "1 2/8");
    const production = ensureProduction(script);
    production.budget.push({
      id: "b",
      category: "Locations",
      description: "Kitchen",
      quantity: 2,
      rate: 100,
      days: 3,
      actual: 50,
      sceneId: sceneIdOf(script.paragraphs[span.start]),
    });
    assert.equal(budgetTotals(script).estimate, 600);
    assert.equal(budgetTotals(script).actual, 50);
  });

  it("groups unscheduled scenes into shooting days by location", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    assert.equal(scheduleByLocation(script), 2);
    const labels = script.production?.days.map((day) => day.label).sort();
    assert.deepEqual(labels, ["KITCHEN", "STREET"]);
  });

  it("round-trips production notes and scene ids through FDX", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const id = sceneIdOf(script.paragraphs.find((paragraph) => paragraph.kind === "scene-heading"));
    const production = ensureProduction(script);
    production.days.push({ id: "d1", label: "Day 1", date: "", call: "07:00", notes: "Call < 7 & bring rain", sceneIds: [id] });
    const again = readFdx(writeFdx(script));
    assert.equal(sceneIdOf(again.paragraphs.find((paragraph) => paragraph.kind === "scene-heading")), id);
    assert.equal(again.production?.days[0]?.notes, "Call < 7 & bring rain");
    assert.deepEqual(again.production?.days[0]?.sceneIds, [id]);
  });

  it("stores a checkpoint without nesting earlier checkpoints inside it", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    script.paragraphs.push(makeParagraph("action", "First"));
    takeSnapshot(script, "Before");
    script.paragraphs.push(makeParagraph("action", "Second"));
    const restored = restoreSnapshot(script, script.production?.snapshots[0]?.id ?? "");
    assert.ok(restored);
    assert.equal(restored?.paragraphs.some((paragraph) => paragraphText(paragraph) === "Second"), false);
    assert.equal(restored?.paragraphs.some((paragraph) => paragraphText(paragraph) === "First"), true);
    assert.equal(restored?.production?.snapshots.length, 1);
    assert.equal(script.production?.snapshots[0]?.script.production?.snapshots.length ?? 0, 0);
  });

  it("builds a day-out-of-days grid and prices cast from it", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const spans = sceneSpans(script);
    const kitchen = sceneIdOf(script.paragraphs[spans[0]!.start]);
    const street = sceneIdOf(script.paragraphs[spans[1]!.start]);
    const production = ensureProduction(script);
    production.days.push(
      { id: "d1", label: "Day 1", date: "", call: "07:00", notes: "", sceneIds: [kitchen] },
      { id: "d2", label: "Day 2", date: "", call: "07:00", notes: "", sceneIds: [] },
      { id: "d3", label: "Day 3", date: "", call: "07:00", notes: "", sceneIds: [street] },
    );
    const cast = dayOutOfDays(script, "cast");
    assert.deepEqual(cast.find((row) => row.name === "MAYA")?.codes, ["SW", "H", "WF"]);
    assert.equal(cast.find((row) => row.name === "MAYA")?.paid, 3);
    assert.deepEqual(cast.find((row) => row.name === "JON")?.codes, ["SWF", "", ""]);
    production.catalog.push({ id: "maya", department: "cast", name: "MAYA", note: "", image: "", rate: 100 });
    assert.equal(pushCatalogToBudget(script, "maya"), true);
    const line = production.budget.find((item) => item.catalogId === "maya");
    assert.equal(line?.days, 3);
    assert.equal(line?.rate, 100);
    assert.equal(line?.category, "Cast");
    assert.equal(budgetTotals(script).estimate, 300);
  });

  it("gives a blank scene an id", () => {
    const heading = makeParagraph("scene-heading", "INT. LOCATION - DAY");
    heading.scene = emptyScene();
    const script = readFdx(`<?xml version="1.0"?><FinalDraft DocumentType="Script" Version="5"><Content><Paragraph Type="Action"><Text>Hi</Text></Paragraph></Content></FinalDraft>`);
    script.paragraphs.unshift(heading);
    delete heading.attributes.FolioId;
    ensureSceneIds(script);
    assert.match(sceneIdOf(heading), /^sc-/);
  });
});
