import type { Element } from "@xmldom/xmldom";
import { FolioError } from "../errors.js";
import {
  emptyScene,
  kindFromFdx,
  type Paragraph,
  type PreservedElement,
  type SceneInfo,
  type Script,
  type TitleField,
} from "../model.js";
import { attr, attributesOf, childElements, localName, parseXml, serialize } from "../xml.js";
import { takeBoard, takeFinalDraftBoard } from "./board.js";
import { prepareScript, takeProduction } from "../production.js";
import { readElementText, readRuns, runsText } from "./text.js";

const MODELED_PARAGRAPH_ATTRS = ["Type", "Alignment", "StartsNewPage", "Number"];
const MODELED_SCENE_ATTRS = ["Length", "Page", "Title"];

function alignmentOf(value: string | undefined): Paragraph["alignment"] {
  if (value === "Left" || value === "Center" || value === "Right") return value;
  return undefined;
}

function readScene(element: Element): SceneInfo {
  const scene = emptyScene();
  const length = attr(element, "Length");
  const page = attr(element, "Page");
  const title = attr(element, "Title");
  if (length) scene.length = length;
  if (page) scene.page = page;
  if (title) scene.title = title;
  scene.attributes = attributesOf(element, MODELED_SCENE_ATTRS);

  for (const child of childElements(element)) {
    const name = localName(child);
    if (name === "Summary") {
      const text = readElementText(child).trim();
      scene.summary = scene.summary ? `${scene.summary}\n${text}` : text;
      continue;
    }
    if (name === "SceneArcBeats") {
      for (const beat of childElements(child, "CharacterArcBeat")) {
        const character = attr(beat, "Name")?.trim();
        if (character) scene.arcCharacters.push(character);
      }
      continue;
    }
    scene.preserved.push({ name, xml: serialize(child) });
  }
  return scene;
}

function readNotes(element: Element): string[] {
  const notes: string[] = [];
  for (const note of childElements(element, "ScriptNote")) {
    const text = readElementText(note).trim();
    if (text) notes.push(text);
  }
  return notes;
}

function readParagraph(element: Element, dualGroup?: number): Paragraph {
  const fdxType = attr(element, "Type") ?? "";
  const runs = readRuns(element);
  const text = runsText(runs).trim();
  const startsNewPage = attr(element, "StartsNewPage")?.toLowerCase() === "yes";
  let kind = kindFromFdx(fdxType);
  if (startsNewPage && kind === "action" && text === "") kind = "page-break";

  const paragraph: Paragraph = {
    kind,
    fdxType,
    runs,
    notes: readNotes(element),
    attributes: attributesOf(element, MODELED_PARAGRAPH_ATTRS),
    preserved: [],
  };
  const alignment = alignmentOf(attr(element, "Alignment"));
  if (alignment && alignment !== "Left") paragraph.alignment = alignment;
  if (startsNewPage) paragraph.startsNewPage = true;
  const sceneNumber = attr(element, "Number");
  if (sceneNumber) paragraph.sceneNumber = sceneNumber;
  if (dualGroup !== undefined) paragraph.dualGroup = dualGroup;
  if (kind.startsWith("outline-") && kind !== "outline-body") {
    paragraph.level = Number(kind.slice("outline-".length));
  }

  const sceneElement = childElements(element, "SceneProperties")[0];
  if (sceneElement) paragraph.scene = readScene(sceneElement);

  for (const child of childElements(element)) {
    const name = localName(child);
    if (name === "Text" || name === "SceneProperties" || name === "ScriptNote") continue;
    paragraph.preserved.push({ name, xml: serialize(child) });
  }
  return paragraph;
}

function readDual(element: Element, group: number): Paragraph[] {
  const direct = childElements(element, "Paragraph");
  if (direct.length > 0) return direct.map((paragraph) => readParagraph(paragraph, group));
  const nested: Paragraph[] = [];
  for (const wrapper of childElements(element)) {
    for (const paragraph of childElements(wrapper, "Paragraph")) {
      nested.push(readParagraph(paragraph, group));
    }
  }
  return nested;
}

function readTitlePage(element: Element): TitleField[] {
  const content = childElements(element, "Content")[0] ?? element;
  const fields: TitleField[] = [];
  for (const paragraph of childElements(content, "Paragraph")) {
    fields.push({
      type: attr(paragraph, "Type") ?? "General",
      text: runsText(readRuns(paragraph)),
    });
  }
  return fields;
}

function readContent(element: Element, script: Script): void {
  let dualCount = 0;
  for (const child of childElements(element)) {
    const name = localName(child);
    if (name === "Paragraph") {
      script.paragraphs.push(readParagraph(child));
      continue;
    }
    if (name === "DualDialogue") {
      dualCount += 1;
      script.paragraphs.push(...readDual(child, dualCount));
      continue;
    }
    script.preservedContent.push({ name, xml: serialize(child) });
  }
}

export function readFdx(source: string): Script {
  const document = parseXml(source);
  const root = document.documentElement;
  if (!root || localName(root) !== "FinalDraft") {
    throw new FolioError("The XML root element must be FinalDraft.");
  }

  const script: Script = {
    version: attr(root, "Version") ?? "",
    documentType: attr(root, "DocumentType") ?? "Script",
    template: attr(root, "Template") ?? "No",
    titlePage: [],
    paragraphs: [],
    preserved: [],
    preservedContent: [],
  };

  let sawContent = false;
  for (const child of childElements(root)) {
    const name = localName(child);
    if (name === "Content") {
      sawContent = true;
      readContent(child, script);
      continue;
    }
    if (name === "TitlePage") {
      script.titlePage.push(...readTitlePage(child));
      continue;
    }
    script.preserved.push({ name, xml: serialize(child) });
  }
  if (!sawContent) {
    throw new FolioError("The Final Draft document has no Content element.");
  }
  const board = takeBoard(script.preserved) ?? takeFinalDraftBoard(script.preserved);
  if (board) script.board = board;
  const production = takeProduction(script.preserved);
  if (production) script.production = production;
  prepareScript(script);
  return script;
}

export function preservedNamed(elements: readonly PreservedElement[], name: string): boolean {
  return elements.some((element) => element.name === name);
}
