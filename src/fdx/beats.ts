import type { Element } from "@xmldom/xmldom";
import { paragraphText, type Paragraph, type Script } from "../model.js";
import { attr, attributesOf, childElements, localName, parseXml } from "../xml.js";

export type BeatSource = "board" | "outline" | "scene-card" | "character-arc";

export interface Beat {
  id: string;
  source: BeatSource;
  title: string;
  body: string;
  level?: number;
  sceneNumber?: string;
  sceneHeading?: string;
  page?: string;
  character?: string;
  tag?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  links: string[];
  attributes: Record<string, string>;
}

/**
 * Final Draft never published the Beat Board canvas schema. Cards, arcs, and
 * outline elements that do have a known shape are read structurally. Any
 * preserved Beat, Card, Lane, or StructurePoint element is read too, and the
 * original XML stays on the document so a real file round-trips.
 */
const ITEMS = new Set(["beat", "card", "indexcard", "structurepoint", "lane"]);
const LINKS = new Set(["flowline", "connection", "link", "flow"]);

function firstAttr(element: Element, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = attr(element, name);
    if (value) return value;
  }
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const attributes = element.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const item = attributes.item(index);
    if (item && wanted.has(item.name.toLowerCase()) && item.value) return item.value;
  }
  return undefined;
}

function childText(element: Element, names: readonly string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const child of childElements(element)) {
    if (!wanted.has(localName(child).toLowerCase())) continue;
    return (child.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function numberAttr(element: Element, names: readonly string[]): number | undefined {
  const raw = firstAttr(element, names);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function beatFromElement(element: Element, fallbackId: string): Beat {
  const attributes = attributesOf(element);
  const title = firstAttr(element, ["Title", "Name", "Label"]) ?? childText(element, ["Title", "Name", "Label"]);
  const body = childText(element, ["Body", "Summary", "Description", "Content", "Text"]);
  const beat: Beat = {
    id: firstAttr(element, ["Id", "ID", "id", "Uuid", "UUID"]) ?? fallbackId,
    source: "board",
    title,
    body,
    tag: localName(element),
    links: [],
    attributes,
  };
  const color = firstAttr(element, ["Color", "Colour", "Fill"]);
  const x = numberAttr(element, ["X", "x", "Left", "PosX"]);
  const y = numberAttr(element, ["Y", "y", "Top", "PosY"]);
  const width = numberAttr(element, ["Width", "W"]);
  const height = numberAttr(element, ["Height", "H"]);
  if (color) beat.color = color;
  if (x !== undefined) beat.x = x;
  if (y !== undefined) beat.y = y;
  if (width !== undefined) beat.width = width;
  if (height !== undefined) beat.height = height;
  return beat;
}

function walkBoard(element: Element, parent: Beat | null, beats: Beat[]): void {
  const tag = localName(element).toLowerCase();
  if (LINKS.has(tag)) {
    const target = firstAttr(element, ["To", "Target", "TargetId"]);
    if (parent && target) parent.links.push(target);
    return;
  }
  let next = parent;
  if (ITEMS.has(tag)) {
    next = beatFromElement(element, `board-${beats.length + 1}`);
    beats.push(next);
  }
  for (const child of childElements(element)) walkBoard(child, next, beats);
}

function absorbXml(xml: string, beats: Beat[]): void {
  try {
    const document = parseXml(xml);
    if (document.documentElement) walkBoard(document.documentElement, null, beats);
  } catch {
    // A preserved fragment that is not XML anymore is reported by inspect, not fatal here.
  }
}

function isOutlineHeading(paragraph: Paragraph): boolean {
  return (
    paragraph.kind === "section" ||
    paragraph.kind === "outline-1" ||
    paragraph.kind === "outline-2" ||
    paragraph.kind === "outline-3" ||
    paragraph.kind === "outline-4"
  );
}

function isOutlineBody(paragraph: Paragraph): boolean {
  return paragraph.kind === "outline-body" || paragraph.kind === "synopsis" || paragraph.kind === "summary";
}

function outlineLevel(paragraph: Paragraph): number {
  if (paragraph.level) return paragraph.level;
  if (paragraph.kind.startsWith("outline-") && paragraph.kind !== "outline-body") {
    return Number(paragraph.kind.slice("outline-".length));
  }
  return 1;
}

function storyBeats(script: Script): Beat[] {
  const beats: Beat[] = [];
  const paragraphs = script.paragraphs;
  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index];
    if (!paragraph) break;
    if (isOutlineHeading(paragraph)) {
      const bodies: string[] = [];
      let next = index + 1;
      while (next < paragraphs.length && paragraphs[next] && isOutlineBody(paragraphs[next])) {
        const text = paragraphText(paragraphs[next]).trim();
        if (text) bodies.push(text);
        next += 1;
      }
      beats.push({
        id: `outline-${beats.length + 1}`,
        source: "outline",
        title: paragraphText(paragraph).replace(/^#+\s*/, "").trim(),
        body: bodies.join("\n"),
        level: outlineLevel(paragraph),
        links: [],
        attributes: {},
      });
      index = next;
      continue;
    }
    if (paragraph.kind === "scene-heading") {
      const heading = paragraphText(paragraph).trim();
      const scene = paragraph.scene;
      if (scene && (scene.summary.trim() || scene.title?.trim())) {
        beats.push({
          id: `scene-${index + 1}`,
          source: "scene-card",
          title: scene.title?.trim() || heading,
          body: scene.summary.trim(),
          sceneHeading: heading,
          ...(paragraph.sceneNumber ? { sceneNumber: paragraph.sceneNumber } : {}),
          ...(scene.page ? { page: scene.page } : {}),
          links: [],
          attributes: {},
        });
      }
      for (const character of scene?.arcCharacters ?? []) {
        beats.push({
          id: `arc-${index + 1}-${character}`,
          source: "character-arc",
          title: character,
          body: "",
          character,
          sceneHeading: heading,
          ...(paragraph.sceneNumber ? { sceneNumber: paragraph.sceneNumber } : {}),
          links: [],
          attributes: {},
        });
      }
      index += 1;
      continue;
    }
    if (isOutlineBody(paragraph)) {
      const text = paragraphText(paragraph).trim();
      if (text) {
        beats.push({
          id: `outline-${beats.length + 1}`,
          source: "outline",
          title: "",
          body: text,
          links: [],
          attributes: {},
        });
      }
    }
    index += 1;
  }
  return beats;
}

function beatsFromBoard(script: Script): Beat[] {
  const board = script.board;
  if (!board) return [];
  return board.cards.map((card) => ({
    id: card.id,
    source: "board" as const,
    title: card.title,
    body: card.body,
    color: card.color,
    x: card.x,
    y: card.y,
    width: card.width,
    height: card.height,
    links: board.links.filter((link) => link.from === card.id).map((link) => link.to),
    attributes: { ...card.attributes },
  }));
}

export function extractBeats(script: Script): Beat[] {
  const board: Beat[] = beatsFromBoard(script);
  for (const extra of [...script.preserved, ...script.preservedContent]) absorbXml(extra.xml, board);
  for (const paragraph of script.paragraphs) {
    for (const extra of paragraph.preserved) absorbXml(extra.xml, board);
    for (const extra of paragraph.scene?.preserved ?? []) absorbXml(extra.xml, board);
  }
  return [...board, ...storyBeats(script)];
}
