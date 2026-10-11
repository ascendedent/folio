import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blankScript,
  characterBase,
  completions,
  cycleKind,
  checkFormatting,
  smartFormat,
  guessPlainLine,
  paragraphDiff,
  paragraphsFromPlain,
  displayContd,
  enterResult,
  guessKinds,
  markRevisionRange,
  findInScript,
  makeParagraph,
  moveScene,
  replaceAll,
  sendCardsToScript,
  addSceneBeat,
  linkBeatsToScenes,
  storyToBoard,
  toggleStyle,
} from "../src/edit.js";
import { ensureBoard } from "../src/fdx/board.js";
import { paragraphText, type Script } from "../src/model.js";

function scriptWith(paragraphs: Script["paragraphs"]): Script {
  return { ...blankScript(), paragraphs, titlePage: [] };
}

describe("screenplay editing", () => {
  it("smart format forces cues and sentence starts", () => {
    const slug = makeParagraph("scene-heading", "x");
    slug.runs = [{ text: "int house night" }];
    const jacob = makeParagraph("character", "x");
    jacob.runs = [{ text: "JacOB" }];
    const voice = makeParagraph("character", "x");
    voice.runs = [{ text: "jacob (vo)" }];
    const transition = makeParagraph("transition", "x");
    transition.runs = [{ text: "cut to" }];
    const script = scriptWith([
      slug,
      makeParagraph("action", "a woman waits. the door opens."),
      jacob,
      makeParagraph("parenthetical", "Whispering"),
      makeParagraph("dialogue", "hello. the house is quiet."),
      voice,
      transition,
    ]);
    const changed = smartFormat(script);
    assert.equal(paragraphText(script.paragraphs[0]!), "INT. HOUSE - NIGHT");
    assert.equal(paragraphText(script.paragraphs[1]!), "A woman waits. The door opens.");
    assert.equal(paragraphText(script.paragraphs[2]!), "JACOB");
    assert.equal(paragraphText(script.paragraphs[3]!), "(whispering)");
    assert.equal(paragraphText(script.paragraphs[4]!), "Hello. The house is quiet.");
    assert.equal(paragraphText(script.paragraphs[5]!), "JACOB (V.O.)");
    assert.equal(paragraphText(script.paragraphs[6]!), "CUT TO:");
    assert.equal(changed, 7);
  });

  it("splits pasted prose into elements", () => {
    const paragraphs = paragraphsFromPlain("INT. KITCHEN - NIGHT\nMAYA\nYou kept it.\nShe nods.");
    assert.equal(paragraphs[0]?.kind, "scene-heading");
    assert.equal(paragraphs[1]?.kind, "character");
    assert.equal(paragraphs[2]?.kind, "dialogue");
    assert.equal(guessPlainLine("CUT TO:", "dialogue"), "transition");
  });

  it("diffs two drafts by line", () => {
    const rows = paragraphDiff(["Keep", "Cut this"], ["Keep", "Add this"]);
    assert.ok(rows.some((row) => row.kind === "cut" && row.text === "Cut this"));
    assert.ok(rows.some((row) => row.kind === "add" && row.text === "Add this"));
  });

  it("flags a cue problem and two names that are easy to mix up", () => {
    const script = scriptWith([
      makeParagraph("dialogue", "Hello (softly)."),
      makeParagraph("character", "MAYA"),
      makeParagraph("dialogue", "Hi."),
      makeParagraph("character", "MYA"),
      makeParagraph("action", "She leaves."),
    ]);
    const messages = checkFormatting(script).map((issue) => issue.message);
    assert.ok(messages.some((message) => message.includes("no character")));
    assert.ok(messages.some((message) => message.includes("own line")));
    assert.ok(messages.some((message) => message.includes("no dialogue")));
    assert.ok(messages.some((message) => message.includes("MAYA") && message.includes("MYA")));
  });

  it("guesses the most likely element when Tab is pressed", () => {
    assert.equal(guessKinds("dialogue", "You kept it.", "character")[0], "action");
    assert.equal(guessKinds("action", "INT. KITCHEN - NIGHT", "action")[0], "scene-heading");
    assert.equal(guessKinds("action", "CUT TO:", "action")[0], "transition");
    assert.equal(guessKinds("character", "MAYA", "action")[0], "action");
  });

  it("marks only a typed range with a revision color", () => {
    const runs = markRevisionRange([{ text: "You kept it." }], 4, 8, "blue");
    assert.equal(runs.map((run) => run.text).join(""), "You kept it.");
    assert.equal(runs.find((run) => run.text === "kept")?.revisionId, "blue");
    assert.equal(runs[0]?.revisionId, undefined);
  });

  it("cycles element types the way a screenplay editor does", () => {
    assert.equal(cycleKind("action", 1), "character");
    assert.equal(cycleKind("scene-heading", -1), "transition");
    assert.equal(cycleKind("shot", 1), "action");
  });

  it("chooses the next element on Enter", () => {
    assert.deepEqual(enterResult("scene-heading", "INT. KITCHEN - NIGHT", true), { next: "action" });
    assert.deepEqual(enterResult("character", "MAYA", true), { next: "dialogue" });
    assert.deepEqual(enterResult("character", "", true), { become: "action", next: null });
    assert.deepEqual(enterResult("dialogue", "You kept it.", true), { next: "character" });
    assert.deepEqual(enterResult("dialogue", "", true), { become: "action", next: null });
    assert.deepEqual(enterResult("parenthetical", "quiet", true), { next: "dialogue" });
    assert.deepEqual(enterResult("transition", "CUT TO:", true), { next: "scene-heading" });
    assert.equal(enterResult("action", "She waits", false).next, "action");
  });

  it("toggles bold across a range and keeps the surrounding text", () => {
    const runs = toggleStyle([{ text: "the coat" }], 4, 8, "bold");
    assert.equal(runs.map((run) => run.text).join(""), "the coat");
    assert.equal(runs[1]?.text, "coat");
    assert.equal(runs[1]?.bold, true);
  });

  it("reorders scenes as whole blocks", () => {
    const script = scriptWith([
      makeParagraph("scene-heading", "INT. KITCHEN - NIGHT"),
      makeParagraph("action", "One"),
      makeParagraph("scene-heading", "EXT. STREET - NIGHT"),
      makeParagraph("action", "Two"),
      makeParagraph("scene-heading", "INT. HALL - DAY"),
      makeParagraph("action", "Three"),
    ]);
    moveScene(script, 0, 2);
    assert.deepEqual(
      script.paragraphs.filter((paragraph) => paragraph.kind === "scene-heading").map((paragraph) => paragraphText(paragraph)),
      ["EXT. STREET - NIGHT", "INT. HALL - DAY", "INT. KITCHEN - NIGHT"],
    );
    assert.equal(paragraphText(script.paragraphs[1]!), "Two");
  });

  it("marks a returning character as continued", () => {
    const script = scriptWith([
      makeParagraph("scene-heading", "INT. KITCHEN - NIGHT"),
      makeParagraph("character", "MAYA"),
      makeParagraph("dialogue", "Hello."),
      makeParagraph("action", "She turns."),
      makeParagraph("character", "MAYA"),
      makeParagraph("dialogue", "Again."),
    ]);
    assert.equal(displayContd(script, 4), true);
    assert.equal(displayContd(script, 1), false);
  });

  it("completes a character cue from names already in the script", () => {
    const script = scriptWith([makeParagraph("character", "MAYA"), makeParagraph("character", "MA")]);
    assert.deepEqual(completions(script, "character", "MA"), ["MAYA"]);
    assert.equal(characterBase("MAYA (V.O.)"), "MAYA");
  });

  it("finds and replaces across paragraphs", () => {
    const script = scriptWith([makeParagraph("action", "The letter."), makeParagraph("dialogue", "The letter stays.")]);
    assert.equal(findInScript(script, "letter").length, 2);
    assert.equal(replaceAll(script, "letter", "note"), 2);
    assert.equal(paragraphText(script.paragraphs[0]!), "The note.");
  });

  it("sends a board card into the script as an outline", () => {
    const script = blankScript();
    const board = ensureBoard(script);
    board.cards.push({
      id: "b1",
      title: "Opening",
      body: "She burns the letter.",
      x: 0,
      y: 0,
      width: 240,
      height: 156,
      color: "Gold",
      attributes: {},
      preserved: [],
    });
    assert.equal(sendCardsToScript(script, ["b1"]), 2);
    assert.equal(script.paragraphs[0]?.kind, "outline-1");
    assert.equal(paragraphText(script.paragraphs[0]!), "Opening");
    const added = storyToBoard(script);
    assert.equal(added >= 1, true);
  });

  it("links a matching beat, leaves a tie alone, and can add another module on the same scene", () => {
    const kitchen = makeParagraph("scene-heading", "INT. KITCHEN - NIGHT");
    kitchen.attributes.FolioId = "sc-kitchen";
    const day = makeParagraph("scene-heading", "INT. HOUSE - DAY");
    day.attributes.FolioId = "sc-house-day";
    const night = makeParagraph("scene-heading", "INT. HOUSE - NIGHT");
    night.attributes.FolioId = "sc-house-night";
    const script = scriptWith([
      kitchen,
      makeParagraph("action", "She waits."),
      day,
      makeParagraph("action", "Day."),
      night,
      makeParagraph("action", "Night."),
    ]);
    const board = ensureBoard(script);
    const card = {
      x: 0,
      y: 0,
      width: 240,
      height: 120,
      color: "Gold",
      attributes: {},
      preserved: [],
    };
    board.cards.push(
      { ...card, id: "k", title: "INT. KITCHEN - NIGHT", body: "Letter." },
      { ...card, id: "tie", title: "INT. HOUSE - DAY NIGHT", body: "Both." },
    );
    linkBeatsToScenes(script);
    assert.equal(board.cards[0]?.sceneId, "sc-kitchen");
    assert.equal(board.cards[1]?.sceneId, undefined);
    const extra = addSceneBeat(script, "sc-kitchen");
    assert.equal(extra?.sceneId, "sc-kitchen");
    assert.equal(board.cards.filter((item) => item.sceneId === "sc-kitchen").length, 2);
    linkBeatsToScenes(script);
    assert.equal(board.cards.filter((item) => item.sceneId === "sc-kitchen").length, 2);
  });

  it("breaks an interior and exterior tie with the slug, and groups an overlapping module", () => {
    const inside = makeParagraph("scene-heading", "INT. FILM SET HOUSE - NIGHT");
    inside.attributes.FolioId = "sc-int";
    const outside = makeParagraph("scene-heading", "EXT. FILM SET HOUSE - NIGHT");
    outside.attributes.FolioId = "sc-ext";
    const script = scriptWith([
      inside,
      makeParagraph("action", "Inside."),
      outside,
      makeParagraph("action", "Outside."),
    ]);
    const board = ensureBoard(script);
    const shape = { width: 240, height: 160, color: "Gold", attributes: {}, preserved: [] };
    board.cards.push(
      { ...shape, id: "ext", title: "EXT. Film set home backyard. night", body: "Yard.", x: 0, y: 0 },
      { ...shape, id: "mod", title: "", body: "They knock.", x: 40, y: 40 },
      { ...shape, id: "int", title: "Int. Film Set house. Night", body: "Inside.", x: 800, y: 0 },
    );
    linkBeatsToScenes(script);
    assert.equal(board.cards[0]?.sceneId, "sc-ext");
    assert.equal(board.cards[1]?.sceneId, "sc-ext");
    assert.equal(board.cards[2]?.sceneId, "sc-int");
  });
});
