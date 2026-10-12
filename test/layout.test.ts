import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFdx } from "../src/fdx/read.js";
import { readFountain } from "../src/fountain/parse.js";
import { KIND_FDX, paragraphText, type ElementKind, type Paragraph, type Script } from "../src/model.js";
import { formatRtf } from "../src/text/rtf.js";
import { formatText, LINES_PER_PAGE, layoutScript, pageMarks, pagePieces, paragraphPages, pullOrphans, type LayoutPage } from "../src/text/layout.js";
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
  it("continues a paragraph on the next page", () => {
    const filler = Array.from({ length: 26 }, () => paragraph("action", "A short line of action."));
    const words = Array.from({ length: 700 }, () => "word").join(" ");
    const script = scriptOf([...filler, paragraph("action", words)]);
    const pieces = pagePieces(script);
    const hits = pieces.flatMap((page, pageIndex) =>
      page.filter((piece) => piece.index === filler.length).map((piece) => ({ pageIndex, ...piece })),
    );
    assert.ok(hits.length >= 2);
    assert.equal(
      hits.map((piece) => words.slice(piece.start, piece.end)).join(""),
      words,
    );
    assert.ok(hits[1]!.pageIndex > hits[0]!.pageIndex);
  });

  it("keeps both sides of a dual dialogue", () => {
    const script = readFdx(fixture("kitchen.fdx"));
    const pieces = pagePieces(script).flat();
    assert.ok(pieces.some((piece) => paragraphText(script.paragraphs[piece.index] ?? script.paragraphs[0]!) === "You kept it."));
    assert.ok(pieces.some((piece) => paragraphText(script.paragraphs[piece.index] ?? script.paragraphs[0]!) === "JON"));
    assert.ok(pieces.some((piece) => paragraphText(script.paragraphs[piece.index] ?? script.paragraphs[0]!) === "I kept the pocket."));
  });

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

  it("keeps a full PDF page inside one-inch margins", () => {
    const script = scriptOf(Array.from({ length: 200 }, (_unused, index) => paragraph("action", `Beat ${index + 1}.`)));
    const pdf = new TextDecoder().decode(formatPdf(script));
    const baselines = [...pdf.matchAll(/1 0 0 1 [\d.]+ (-?\d+) Tm \(Beat/g)].map((match) => Number(match[1]));
    assert.ok(Math.max(...baselines) <= 792 - 72 - 9, "body starts below the top margin");
    assert.ok(Math.min(...baselines) - 3 >= 72, `last line sits at ${Math.min(...baselines)}, inside the bottom margin`);
  });

  it("draws the PDF header and blank lines the way the editor does", () => {
    const script = scriptOf([
      paragraph("scene-heading", "INT. KITCHEN - NIGHT"),
      paragraph("action", "She waits."),
      ...Array.from({ length: 40 }, (_unused, index) => paragraph("action", `Beat ${index + 1}.`)),
    ]);
    script.titlePage = [{ type: "Title", text: "Wrap Party" }];
    const pdf = new TextDecoder().decode(formatPdf(script));
    const y = (text: string): number => Number(new RegExp(`(\\d+) Tm \\(${text}`).exec(pdf)?.[1]);
    assert.equal(y("INT. KITCHEN") - y("She waits"), 24, "a blank line after the scene heading");
    assert.doesNotMatch(pdf, /\(1\.\) Tj/, "no number on page one");
    assert.match(pdf, /\(Wrap Party\) Tj/);
    assert.match(pdf, /\(2\.\) Tj/);
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

  describe("moves a block whole when it would cross a page", () => {
    // 26 one-line paragraphs with gaps fill 51 of the 54 lines.
    const filler = (count = 26): Paragraph[] => Array.from({ length: count }, (_unused, index) => paragraph("action", `Beat ${index + 1}.`));
    const pagesOf = (script: Script, origins: number[]): number[] => {
      const pages = layoutScript(script);
      return origins.map((origin) => pages.findIndex((page) => page.lines.some((line) => line.origin === origin)));
    };

    it("keeps a whole speech together", () => {
      const lines = "This speech runs to four lines of dialogue so it cannot fit in the three lines left on the page.";
      // Five lines left: room for the cue and a first line, but not the whole speech.
      const script = scriptOf([...filler(25), paragraph("character", "MAYA"), paragraph("parenthetical", "quiet"), paragraph("dialogue", lines)]);
      assert.deepEqual(pagesOf(script, [25, 26, 27]), [1, 1, 1]);
      assert.ok(pageMarks(script).every((mark) => !mark.more && !mark.continuedName));
    });

    it("keeps a whole action paragraph together", () => {
      const lines = "She crosses the kitchen, opens every drawer in turn, finds nothing in any of them, and finally sits down at the table to wait for the kettle.";
      const script = scriptOf([...filler(), paragraph("action", lines)]);
      const pages = layoutScript(script);
      assert.ok(pages[0]?.lines.every((line) => line.origin !== 26));
      assert.ok(pages[1]?.lines.some((line) => line.origin === 26));
    });

    it("keeps a scene heading with the first two lines under it, and lets the rest continue", () => {
      const lines = "Rain beats on the window while she waits at the table, watching the door and counting the minutes until he comes back in out of the storm, soaked to the skin and carrying nothing at all.";
      // No room under the heading: it moves with its paragraph.
      const script = scriptOf([...filler(), paragraph("scene-heading", "INT. KITCHEN - NIGHT"), paragraph("action", lines)]);
      assert.deepEqual(pagesOf(script, [26, 27]), [1, 1]);
      // Room for the heading, its blank line and two lines: those stay, the rest continues overleaf.
      const roomy = scriptOf([...filler(25), paragraph("scene-heading", "INT. KITCHEN - NIGHT"), paragraph("action", lines)]);
      const pages = layoutScript(roomy);
      assert.ok(pages[0]?.lines.some((line) => line.origin === 25));
      assert.equal(pages[0]?.lines.filter((line) => line.origin === 26).length, 2);
      assert.equal(pages[1]?.lines.filter((line) => line.origin === 26).length, 2);
    });
  });

  it("writes an RTF document in Courier", () => {
    const rtf = formatRtf(readFountain("INT. KITCHEN - NIGHT\n\nCafé.\n"));
    assert.match(rtf, /\\fmodern Courier New/);
    assert.match(rtf, /INT\. KITCHEN - NIGHT/);
    assert.match(rtf, /\\u233\?/);
  });
});
