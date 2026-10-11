import { DOMImplementation, type Document, type Element } from "@xmldom/xmldom";
import { KIND_FDX, paragraphText, type Paragraph, type SceneInfo, type Script, type TextRun, type TitleField } from "../model.js";
import { importFragment, serialize } from "../xml.js";
import { appendBoard } from "./board.js";
import { appendProduction } from "../production.js";
import { styleAttribute } from "./text.js";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>';

function appendText(document: Document, parent: Element, run: TextRun): void {
  const text = document.createElement("Text");
  const style = styleAttribute(run);
  if (style) text.setAttribute("Style", style);
  if (run.revisionId) text.setAttribute("RevisionID", run.revisionId);
  text.appendChild(document.createTextNode(run.text));
  parent.appendChild(text);
}

function appendScene(document: Document, parent: Element, scene: SceneInfo): void {
  const useful =
    scene.summary.trim() !== "" ||
    scene.arcCharacters.length > 0 ||
    scene.length ||
    scene.page ||
    scene.title ||
    Object.keys(scene.attributes).length > 0 ||
    scene.preserved.length > 0;
  if (!useful) return;

  const element = document.createElement("SceneProperties");
  if (scene.length) element.setAttribute("Length", scene.length);
  if (scene.page) element.setAttribute("Page", scene.page);
  if (scene.title !== undefined && scene.title !== "") element.setAttribute("Title", scene.title);
  for (const [name, value] of Object.entries(scene.attributes)) element.setAttribute(name, value);

  if (scene.summary.trim()) {
    const summary = document.createElement("Summary");
    for (const line of scene.summary.split("\n")) {
      const paragraph = document.createElement("Paragraph");
      paragraph.setAttribute("Type", "General");
      appendText(document, paragraph, { text: line });
      summary.appendChild(paragraph);
    }
    element.appendChild(summary);
  }
  if (scene.arcCharacters.length > 0) {
    const arcs = document.createElement("SceneArcBeats");
    for (const name of scene.arcCharacters) {
      const beat = document.createElement("CharacterArcBeat");
      beat.setAttribute("Name", name);
      arcs.appendChild(beat);
    }
    element.appendChild(arcs);
  }
  for (const extra of scene.preserved) element.appendChild(importFragment(document, extra.xml));
  parent.appendChild(element);
}

function appendNote(document: Document, parent: Element, note: string): void {
  const scriptNote = document.createElement("ScriptNote");
  const paragraph = document.createElement("Paragraph");
  paragraph.setAttribute("Type", "General");
  appendText(document, paragraph, { text: note });
  scriptNote.appendChild(paragraph);
  parent.appendChild(scriptNote);
}

function appendParagraph(document: Document, parent: Element, paragraph: Paragraph): void {
  const element = document.createElement("Paragraph");
  const type = paragraph.fdxType || KIND_FDX[paragraph.kind] || "General";
  element.setAttribute("Type", paragraph.kind === "page-break" ? "Action" : type);
  if (paragraph.sceneNumber) element.setAttribute("Number", paragraph.sceneNumber);
  if (paragraph.alignment) element.setAttribute("Alignment", paragraph.alignment);
  if (paragraph.startsNewPage || paragraph.kind === "page-break") {
    element.setAttribute("StartsNewPage", "Yes");
  }
  for (const [name, value] of Object.entries(paragraph.attributes)) element.setAttribute(name, value);
  if (paragraph.scene) appendScene(document, element, paragraph.scene);

  const runs = paragraph.runs.length > 0 ? paragraph.runs : [{ text: "" }];
  for (const run of runs) appendText(document, element, run);
  for (const note of paragraph.notes) appendNote(document, element, note);
  for (const extra of paragraph.preserved) element.appendChild(importFragment(document, extra.xml));
  parent.appendChild(element);
}

function appendTitle(document: Document, root: Element, fields: readonly TitleField[]): void {
  if (fields.length === 0) return;
  const titlePage = document.createElement("TitlePage");
  const content = document.createElement("Content");
  for (const field of fields) {
    const paragraph = document.createElement("Paragraph");
    paragraph.setAttribute("Type", field.type);
    paragraph.setAttribute("Alignment", "Center");
    for (const line of field.text.split("\n")) appendText(document, paragraph, { text: line });
    content.appendChild(paragraph);
  }
  titlePage.appendChild(content);
  root.appendChild(titlePage);
}

export function writeFdx(script: Script): string {
  const implementation = new DOMImplementation();
  const document = implementation.createDocument(null, "FinalDraft", null);
  const root = document.documentElement;
  if (!root) throw new Error("Could not create a FinalDraft document.");
  root.setAttribute("DocumentType", script.documentType || "Script");
  root.setAttribute("Template", script.template || "No");
  root.setAttribute("Version", script.version || "5");

  const content = document.createElement("Content");
  let index = 0;
  let pendingNotes: string[] = [];
  const take = (paragraph: Paragraph): Paragraph => {
    if (pendingNotes.length === 0) return paragraph;
    const notes = [...pendingNotes, ...paragraph.notes];
    pendingNotes = [];
    return { ...paragraph, notes };
  };
  while (index < script.paragraphs.length) {
    const paragraph = script.paragraphs[index];
    if (!paragraph) break;
    if (paragraph.kind === "note") {
      const text = paragraphText(paragraph).trim();
      if (text) pendingNotes.push(text);
      index += 1;
      continue;
    }
    const group = paragraph.dualGroup;
    if (group !== undefined) {
      const dual = document.createElement("DualDialogue");
      while (index < script.paragraphs.length && script.paragraphs[index]?.dualGroup === group) {
        const member = script.paragraphs[index];
        if (member && member.kind !== "note") appendParagraph(document, dual, take(member));
        index += 1;
      }
      content.appendChild(dual);
      continue;
    }
    appendParagraph(document, content, take(paragraph));
    index += 1;
  }
  if (pendingNotes.length > 0) {
    appendParagraph(document, content, {
      kind: "action",
      fdxType: "Action",
      runs: [{ text: "" }],
      notes: pendingNotes,
      attributes: {},
      preserved: [],
    });
  }
  for (const extra of script.preservedContent) {
    content.appendChild(importFragment(document, extra.xml));
  }
  root.appendChild(content);
  appendTitle(document, root, script.titlePage);
  for (const extra of script.preserved) root.appendChild(importFragment(document, extra.xml));
  appendBoard(document, root, script.board);
  appendProduction(document, root, script.production);

  const serialized = serialize(document).replace(/^\s*<\?xml[^>]*>\s*/u, "");
  return `${XML_DECLARATION}\n${serialized}\n`;
}
