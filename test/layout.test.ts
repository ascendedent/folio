import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFountain } from "../src/fountain/parse.js";
import { KIND_FDX, type ElementKind, type Paragraph, type Script } from "../src/model.js";
import { formatRtf } from "../src/text/rtf.js";
import { formatText, LINES_PER_PAGE, layoutScript, pageMarks, paragraphPages, pullOrphans, type LayoutPage } from "../src/text/layout.js";
import { formatPdf } from "../src/text/pdf.js";
import { textFromContent } from "../src/text/melt.js";
import { fixture } from "./helpers.js";

function paragraph(kind: ElementKind, text: string): Paragraph {
  return {
    kind,
    fdxType: KIND_FDX[kind],
    runs: [{ text }],
    notes: [],
    attributes: {},
    preserved: [],
  };
}

function scriptOf(paragraphs: Paragraph[]): Script {
  return {
    version: "5",
    documentType: "Script",
    template: "No",
    titlePage: [],
    paragraphs,
    preserved: [],
    preservedContent: [],
  };
}

describe("formatted text", () => {
  it("assigns a page to every paragraph", () => {
    const script = readFountain(fixture("kitchen.fountain"));
    const pages = paragraphPages(script);
    assert.equal(pages.length, script.paragraphs.length);
    assert.ok(pages.every((page) => page >= 1));
    assert.equal(pages[0], 1);
  });

  it("indents a character cue and keeps dialogue under it", () => {
    const text = formatText(readFountain(fixture("kitchen.fountain")));
    const lines = text.split("\n");
    const cue = lines.find((line) => line.includes("MAYA") && line.includes("JON"));
    assert.ok(cue, "dual dialogue shares a line");
    assert.match(text, /INT\. KITCHEN - NIGHT/);
    assert.match(text, /You kept it\./);
    assert.doesNotMatch(text, /Hold on the coat/);
    assert.doesNotMatch(text, /\*\*/);
    assert.doesNotMatch(text, /\(MORE\)/);
  });

  it("writes a PDF and reads text back out of a content stream", () => {
    const script = scriptOf([paragraph("scene-heading", "INT. KITCHEN - NIGHT"), paragraph("action", "She waits.")]);
    const pdf = new TextDecoder().decode(formatPdf(script, { watermark: "DRAFT" }));
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /She waits/);
    assert.equal(textFromContent("BT (INT. KITCHEN - NIGHT) Tj ET"), "INT. KITCHEN - NIGHT");
  });

  it("prints MORE and a continued cue when a speech crosses a page", () => {
    const speech = Array.from({ length: 200 }, (_unused, index) => `Line ${index + 1} keeps going`).join(" ");
    const script = scriptOf([
      paragraph("character", "MAYA"),
      paragraph("dialogue", speech),
      paragraph("dialogue", "She stops."),
    ]);
    const marks = pageMarks(script);
    assert.ok(marks.some((mark) => mark.more));
    assert.ok(marks.some((mark) => mark.continuedName === "MAYA"));
    const text = formatText(script);
    assert.match(text, /\(MORE\)/);
    assert.match(text, /MAYA \(CONT'D\)/);
  });

  it("paginates a long action passage without passing 54 lines", () => {
    const paragraphs = Array.from({ length: 40 }, (_unused, index) => paragraph("action", `Line ${index + 1}`));
    const pages = layoutScript(scriptOf(paragraphs));
    assert.ok(pages.length >= 2);
    for (const page of pages) assert.ok(page.lines.length <= LINES_PER_PAGE);
    const spoken = pages.flatMap((page) => page.lines).filter((line) => line.kind === "action");
    assert.equal(spoken.length, 40);
  });

  it("moves a character cue that would end a page onto the next page with its dialogue", () => {
    const pages: LayoutPage[] = [
      {
        number: 1,
        lines: [
          { text: "MAYA walks.", kind: "action" },
          { text: "", kind: "blank" },
          { text: "MAYA", kind: "character" },
        ],
      },
      {
        number: 2,
        lines: [{ text: "You kept it.", kind: "dialogue" }],
      },
    ];
    assert.equal(pullOrphans(pages), true);
    assert.equal(pages[0]?.lines.some((line) => line.kind === "character"), false);
    assert.equal(pages[1]?.lines[0]?.kind, "character");
    assert.equal(pages[1]?.lines[1]?.text, "You kept it.");
  });

  it("leaves a fresh character cue on the same page as the dialogue above it", () => {
    const pages: LayoutPage[] = [
      {
        number: 1,
        lines: [
          { text: "You kept it.", kind: "dialogue" },
          { text: "", kind: "character" },
        ],
      },
    ];
    assert.equal(pullOrphans(pages), false);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.lines[1]?.kind, "character");
  });

  it("moves a scene heading off the bottom of a page", () => {
    const pages: LayoutPage[] = [
      {
        number: 1,
        lines: [
          { text: "Rain.", kind: "action" },
          { text: "INT. KITCHEN - NIGHT", kind: "scene-heading" },
        ],
      },
      { number: 2, lines: [{ text: "She waits.", kind: "action" }] },
    ];
    pullOrphans(pages);
    assert.equal(pages[0]?.lines.some((line) => line.kind === "scene-heading"), false);
    assert.equal(pages[1]?.lines[0]?.kind, "scene-heading");
  });

  it("writes an RTF document in Courier", () => {
    const rtf = formatRtf(readFountain("INT. KITCHEN - NIGHT\n\nCafé.\n"));
    assert.match(rtf, /\\fmodern Courier New/);
    assert.match(rtf, /INT\. KITCHEN - NIGHT/);
    assert.match(rtf, /\\u233\?/);
  });
});
