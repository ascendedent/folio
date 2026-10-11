import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBeats } from "../src/fdx/beats.js";
import { readFdx } from "../src/fdx/read.js";
import { writeFdx } from "../src/fdx/write.js";
import { parseEmphasis } from "../src/fountain/emphasis.js";
import { readFountain } from "../src/fountain/parse.js";
import { writeFountain } from "../src/fountain/write.js";
import { paragraphText } from "../src/model.js";
import { fixture } from "./helpers.js";

describe("Fountain", () => {
  it("parses emphasis without leaving the marker behind", () => {
    const runs = parseEmphasis("A **coat** drips");
    assert.equal(runs[0]?.text, "A ");
    assert.equal(runs[1]?.text, "coat");
    assert.equal(runs[1]?.bold, true);
    assert.equal(runs[2]?.text, " drips");
    assert.equal(parseEmphasis("a *b* c")[1]?.italic, true);
    assert.equal(parseEmphasis("no *close").map((run) => run.text).join(""), "no *close");
  });

  it("reads the kitchen fountain into the same story", () => {
    const script = readFountain(fixture("kitchen.fountain"));
    assert.equal(script.titlePage[0]?.text, "KITCHEN LETTER");
    const beats = extractBeats(script);
    assert.equal(beats.find((beat) => beat.source === "outline")?.title, "Act One");
    assert.equal(beats.find((beat) => beat.source === "outline")?.body, "She finds the letter.");
    const card = beats.find((beat) => beat.source === "scene-card");
    assert.equal(card?.title, "INT. KITCHEN - NIGHT");
    assert.equal(card?.body, "Maya finds the letter in the coat.");
    assert.equal(card?.sceneNumber, "1");
    assert.equal(beats.find((beat) => beat.source === "character-arc")?.character, "MAYA");
    const action = script.paragraphs.find((paragraph) => paragraph.kind === "action");
    assert.equal(action?.runs.some((run) => run.bold && run.text === "coat"), true);
    assert.deepEqual(action?.notes, ["Hold on the coat."]);
    const cues = script.paragraphs.filter((paragraph) => paragraph.kind === "character");
    assert.equal(cues[0]?.dualGroup, cues[1]?.dualGroup);
    assert.equal(paragraphText(cues[2]!), "MAYA (V.O.)");
    assert.equal(script.paragraphs.some((paragraph) => paragraph.kind === "transition"), true);
  });

  it("does not treat FADE IN: as a title page", () => {
    const script = readFountain("FADE IN:\n\nINT. HOUSE - DAY\n\nRain.\n");
    assert.equal(script.titlePage.length, 0);
    assert.equal(script.paragraphs[0]?.kind, "action");
    assert.equal(script.paragraphs[1]?.kind, "scene-heading");
  });

  it("drops a boneyard and keeps a forced character", () => {
    const script = readFountain("/* omit */\n\n@mccloud\nHello.\n");
    assert.equal(paragraphText(script.paragraphs[0]!), "mccloud");
    assert.equal(script.paragraphs[1]?.kind, "dialogue");
  });

  it("round-trips fountain and survives a trip through FDX", () => {
    const original = readFountain(fixture("kitchen.fountain"));
    const written = writeFountain(original).text;
    const again = readFountain(written);
    assert.deepEqual(
      again.paragraphs.map((paragraph) => [paragraph.kind, paragraphText(paragraph).trim()]),
      original.paragraphs.map((paragraph) => [paragraph.kind, paragraphText(paragraph).trim()]),
    );
    assert.equal(again.paragraphs.find((paragraph) => paragraph.kind === "scene-heading")?.scene?.summary, "Maya finds the letter in the coat.");
    const throughFdx = readFountain(writeFountain(readFdx(writeFdx(original))).text);
    assert.equal(paragraphText(throughFdx.paragraphs.find((paragraph) => paragraph.kind === "scene-heading")!), "INT. KITCHEN - NIGHT");
    assert.equal(throughFdx.paragraphs.filter((paragraph) => paragraph.kind === "character").length, 3);
  });

  it("warns when a beat board would be dropped", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const exported = writeFountain(script);
    assert.match(exported.warnings[0] ?? "", /Beat-board/);
    assert.doesNotMatch(exported.text, /She burns the letter/);
    assert.match(exported.text, /INT\. KITCHEN - NIGHT #1#/);
    assert.match(exported.text, /arc: MAYA/);
  });
});
