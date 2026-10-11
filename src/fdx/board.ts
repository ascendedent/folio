import type { Document, Element } from "@xmldom/xmldom";
import type { Board, BoardCard, PreservedElement } from "../model.js";
import { attr, attributesOf, childElements, importFragment, localName, parseXml, serialize } from "../xml.js";

const ITEM_TAGS = new Set(["beat", "card", "indexcard", "structurepoint", "lane"]);
const LINK_TAGS = new Set(["flowline", "connection", "link", "flow"]);
const TEXT_TAGS = new Set(["body", "summary", "description", "content", "text", "title", "name", "label"]);
const CARD_WIDTH = 200;
const CARD_HEIGHT = 156;

const MODELED_ATTRS = new Set([
  "id",
  "Id",
  "ID",
  "Uuid",
  "UUID",
  "X",
  "x",
  "Left",
  "PosX",
  "Y",
  "y",
  "Top",
  "PosY",
  "Width",
  "W",
  "Height",
  "H",
  "Color",
  "Colour",
  "Fill",
  "Title",
  "Name",
  "Label",
  "FolioScene",
]);

export function emptyBoard(): Board {
  return { cards: [], links: [], attributes: {}, preserved: [] };
}

export function ensureBoard(script: { board?: Board }): Board {
  if (!script.board) script.board = emptyBoard();
  return script.board;
}

export function nextCardId(board: Board): string {
  const used = new Set(board.cards.map((card) => card.id));
  let number = board.cards.length + 1;
  while (used.has(`b${number}`)) number += 1;
  return `b${number}`;
}

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
    return (child.textContent ?? "").replace(/[ \t]+/gu, " ").trim();
  }
  return "";
}

function numberAttr(element: Element, names: readonly string[]): number | undefined {
  const raw = firstAttr(element, names);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function addLink(board: Board, from: string, to: string): void {
  if (!from || !to || from === to) return;
  if (board.links.some((link) => link.from === from && link.to === to)) return;
  board.links.push({ from, to });
}

function readCard(element: Element, fallbackId: string, index: number): BoardCard {
  const title = firstAttr(element, ["Title", "Name", "Label"]) ?? childText(element, ["Title", "Name", "Label"]);
  const body = childText(element, ["Body", "Summary", "Description", "Content", "Text"]);
  const x = numberAttr(element, ["X", "x", "Left", "PosX"]);
  const y = numberAttr(element, ["Y", "y", "Top", "PosY"]);
  const width = numberAttr(element, ["Width", "W"]);
  const height = numberAttr(element, ["Height", "H"]);
  const card: BoardCard = {
    id: firstAttr(element, ["Id", "ID", "id", "Uuid", "UUID"]) ?? fallbackId,
    title,
    body,
    x: x ?? 72 + (index % 4) * 280,
    y: y ?? 72 + Math.floor(index / 4) * 210,
    width: width ?? CARD_WIDTH,
    height: height ?? CARD_HEIGHT,
    color: firstAttr(element, ["Color", "Colour", "Fill"]) ?? "Gold",
    sceneId: element.hasAttribute("FolioScene") ? (attr(element, "FolioScene") ?? "") : undefined,
    attributes: attributesOf(element, [...MODELED_ATTRS]),
    preserved: [],
  };
  fitCardToText(card);
  return card;
}

/** Grow a card so its body is not clipped. Never shrinks a box the writer sized. */
export function fitCardToText(card: BoardCard): void {
  const text = card.body.replace(/\s+$/u, "");
  if (!text.trim()) return;
  const perLine = Math.max(8, Math.floor(Math.max(40, card.width - 20) / 6.6));
  let lines = 0;
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let column = 0;
    let row = 1;
    for (const word of words) {
      if (word.length > perLine) {
        if (column > 0) row += 1;
        row += Math.ceil(word.length / perLine) - 1;
        column = word.length % perLine || perLine;
        continue;
      }
      if (column === 0) column = word.length;
      else if (column + 1 + word.length <= perLine) column += 1 + word.length;
      else {
        row += 1;
        column = word.length;
      }
    }
    lines += row;
  }
  const needed = Math.ceil(40 + 28 + lines * 18.5);
  if (card.height < needed) card.height = needed;
}

function absorbItem(element: Element, board: Board): void {
  const card = readCard(element, `b${board.cards.length + 1}`, board.cards.length);
  board.cards.push(card);
  for (const child of childElements(element)) {
    const tag = localName(child).toLowerCase();
    if (TEXT_TAGS.has(tag)) continue;
    if (LINK_TAGS.has(tag)) {
      const target = firstAttr(child, ["To", "Target", "TargetId"]);
      if (target) addLink(board, card.id, target);
      continue;
    }
    if (ITEM_TAGS.has(tag)) {
      absorbItem(child, board);
      continue;
    }
    card.preserved.push({ name: localName(child), xml: serialize(child) });
  }
}

export function boardFromXml(xml: string): Board | null {
  try {
    const document = parseXml(xml);
    const root = document.documentElement;
    if (!root || localName(root) !== "BeatBoard") return null;
    const board = emptyBoard();
    board.attributes = attributesOf(root);
    for (const child of childElements(root)) {
      if (ITEM_TAGS.has(localName(child).toLowerCase())) absorbItem(child, board);
      else board.preserved.push({ name: localName(child), xml: serialize(child) });
    }
    return board;
  } catch {
    return null;
  }
}

function isHiddenText(style: string | undefined): boolean {
  return (style ?? "").split(/[+\s]/u).includes("HiddenText");
}

function paragraphText(paragraph: Element, hidden: boolean): string {
  const texts: string[] = [];
  for (const text of childElements(paragraph, "Text")) {
    const isHidden = isHiddenText(attr(text, "Style"));
    if (isHidden !== hidden) continue;
    texts.push(text.textContent ?? "");
  }
  return texts.join("").replace(/[ \t]+/gu, " ").trim();
}

function listItemBody(item: Element): string {
  const visible: string[] = [];
  const hidden: string[] = [];
  for (const content of childElements(item, "Content")) {
    for (const paragraph of childElements(content, "Paragraph")) {
      const shown = paragraphText(paragraph, false);
      const concealed = paragraphText(paragraph, true);
      if (shown) visible.push(shown);
      if (concealed) hidden.push(concealed);
    }
  }
  const shown = visible.join("\n\n").trim();
  const concealed = hidden.join("\n\n").trim();
  if (!shown) return concealed;
  // Final Draft sometimes leaves a stray visible character and stores the beat as HiddenText.
  if (concealed.length > shown.length * 4 && concealed.includes(shown)) return concealed;
  return shown;
}

/**
 * Final Draft stores the beat canvas on DisplayBoard Type="Beat" (Left/Top/Width/Height)
 * and the words on ListItem Type="Beat" with the same Id.
 */
export function takeFinalDraftBoard(preserved: PreservedElement[]): Board | undefined {
  const boardsIndex = preserved.findIndex((element) => element.name === "DisplayBoards");
  if (boardsIndex < 0) return undefined;
  const boardsXml = preserved[boardsIndex]?.xml;
  if (!boardsXml) return undefined;
  let boardsRoot: Element;
  try {
    const parsed = parseXml(boardsXml).documentElement;
    if (!parsed || localName(parsed) !== "DisplayBoards") return undefined;
    boardsRoot = parsed;
  } catch {
    return undefined;
  }
  const beatBoard = childElements(boardsRoot).find(
    (element) => localName(element) === "DisplayBoard" && attr(element, "Type") === "Beat",
  );
  if (!beatBoard) return undefined;

  const itemsIndex = preserved.findIndex((element) => element.name === "ListItems");
  const texts = new Map<string, { title: string; body: string; color: string; sceneId?: string }>();
  const extraItems: PreservedElement[] = [];
  if (itemsIndex >= 0 && preserved[itemsIndex]) {
    try {
      const listRoot = parseXml(preserved[itemsIndex]!.xml).documentElement;
      if (listRoot) {
        for (const item of childElements(listRoot)) {
          if (localName(item) !== "ListItem") continue;
          if (attr(item, "Type") !== "Beat") {
            extraItems.push({ name: "ListItem", xml: serialize(item) });
            continue;
          }
          const id = attr(item, "Id");
          if (!id) continue;
          texts.set(id, {
            title: attr(item, "Title") ?? "",
            body: listItemBody(item),
            color: attr(item, "Color") ?? "#FFFFFFFFFFFF",
            sceneId: item.hasAttribute("FolioScene") ? (attr(item, "FolioScene") ?? "") : undefined,
          });
        }
      }
    } catch {
      return undefined;
    }
  }

  const board = emptyBoard();
  board.origin = "final-draft";
  const boardId = attr(beatBoard, "Id");
  const height = attr(beatBoard, "Height");
  const width = attr(beatBoard, "Width");
  const zoom = attr(beatBoard, "ZoomLevel");
  const scroll = attr(beatBoard, "ScrollOrigin");
  if (boardId) board.attributes.Id = boardId;
  if (height) board.attributes.Height = height;
  if (width) board.attributes.Width = width;
  if (zoom) board.attributes.ZoomLevel = zoom;
  if (scroll) board.attributes.ScrollOrigin = scroll;

  const placed = new Set<string>();
  for (const item of childElements(beatBoard, "Item")) {
    const id = attr(item, "Id");
    if (!id) continue;
    placed.add(id);
    const text = texts.get(id);
    const left = Number(attr(item, "Left") ?? "0");
    const top = Number(attr(item, "Top") ?? "0");
    const cardWidth = Number(attr(item, "Width") ?? String(CARD_WIDTH));
    const cardHeight = Number(attr(item, "Height") ?? "140");
    const fromItem = item.hasAttribute("FolioScene") ? (attr(item, "FolioScene") ?? "") : undefined;
    const card: BoardCard = {
      id,
      title: text?.title ?? "",
      body: text?.body ?? "",
      x: Number.isFinite(left) ? left : 0,
      y: Number.isFinite(top) ? top : 0,
      width: Number.isFinite(cardWidth) ? cardWidth : CARD_WIDTH,
      height: Number.isFinite(cardHeight) ? cardHeight : 140,
      color: text?.color ?? "#FFFFFFFFFFFF",
      sceneId: text?.sceneId !== undefined ? text.sceneId : fromItem,
      attributes: {},
      preserved: [],
    };
    fitCardToText(card);
    board.cards.push(card);
  }
  let extra = 0;
  for (const [id, text] of texts) {
    if (placed.has(id)) continue;
    const card: BoardCard = {
      id,
      title: text.title,
      body: text.body,
      x: 40,
      y: 40 + extra * 180,
      width: CARD_WIDTH,
      height: 140,
      color: text.color,
      sceneId: text.sceneId,
      attributes: {},
      preserved: [],
    };
    fitCardToText(card);
    board.cards.push(card);
    extra += 1;
  }
  for (const extraBoard of childElements(boardsRoot)) {
    if (extraBoard === beatBoard) continue;
    board.preserved.push({ name: localName(extraBoard), xml: serialize(extraBoard) });
  }
  board.preserved.push(...extraItems);

  const remove = [boardsIndex, itemsIndex].filter((index) => index >= 0).sort((left, right) => right - left);
  for (const index of remove) preserved.splice(index, 1);
  return board;
}

/** Lift a BeatBoard out of preserved root elements so the canvas can edit it. */
export function takeBoard(preserved: PreservedElement[]): Board | undefined {
  const index = preserved.findIndex((element) => element.name === "BeatBoard");
  if (index < 0) return undefined;
  const [item] = preserved.splice(index, 1);
  if (!item) return undefined;
  const board = boardFromXml(item.xml);
  if (!board) {
    preserved.splice(index, 0, item);
    return undefined;
  }
  return board;
}

function appendCard(document: Document, parent: Element, board: Board, card: BoardCard): void {
  const beat = document.createElement("Beat");
  beat.setAttribute("id", card.id);
  beat.setAttribute("X", String(Math.round(card.x)));
  beat.setAttribute("Y", String(Math.round(card.y)));
  beat.setAttribute("Width", String(Math.round(card.width)));
  beat.setAttribute("Height", String(Math.round(card.height)));
  if (card.color) beat.setAttribute("Color", card.color);
  if (card.title) beat.setAttribute("Title", card.title);
  if (card.sceneId !== undefined) beat.setAttribute("FolioScene", card.sceneId);
  for (const [name, value] of Object.entries(card.attributes)) {
    if (!beat.hasAttribute(name)) beat.setAttribute(name, value);
  }
  if (card.body) {
    const body = document.createElement("Body");
    body.appendChild(document.createTextNode(card.body));
    beat.appendChild(body);
  }
  for (const link of board.links) {
    if (link.from !== card.id) continue;
    const flow = document.createElement("FlowLine");
    flow.setAttribute("To", link.to);
    beat.appendChild(flow);
  }
  for (const extra of card.preserved) beat.appendChild(importFragment(document, extra.xml));
  parent.appendChild(beat);
}

function listItemElement(document: Document, card: BoardCard): Element {
  const item = document.createElement("ListItem");
  item.setAttribute("Color", card.color.startsWith("#") ? card.color : "#FFFFFFFFFFFF");
  item.setAttribute("Id", card.id);
  item.setAttribute("Title", card.title);
  item.setAttribute("Type", "Beat");
  if (card.sceneId !== undefined) item.setAttribute("FolioScene", card.sceneId);
  const content = document.createElement("Content");
  const paragraph = document.createElement("Paragraph");
  paragraph.setAttribute("Alignment", "Left");
  paragraph.setAttribute("Type", "General");
  const text = document.createElement("Text");
  text.setAttribute("Style", "");
  text.appendChild(document.createTextNode(card.body));
  paragraph.appendChild(text);
  content.appendChild(paragraph);
  item.appendChild(content);
  return item;
}

function appendFinalDraftBoard(document: Document, root: Element, board: Board): void {
  const boards = document.createElement("DisplayBoards");
  const beat = document.createElement("DisplayBoard");
  beat.setAttribute("Type", "Beat");
  beat.setAttribute("Id", board.attributes.Id || crypto.randomUUID());
  beat.setAttribute("Height", board.attributes.Height || "10000");
  beat.setAttribute("Width", board.attributes.Width || "24000");
  beat.setAttribute("ZoomLevel", board.attributes.ZoomLevel || "100.000");
  beat.setAttribute("ScrollOrigin", board.attributes.ScrollOrigin || "0,0");
  for (const card of board.cards) {
    const item = document.createElement("Item");
    item.setAttribute("Id", card.id);
    item.setAttribute("Left", String(Math.round(card.x)));
    item.setAttribute("Top", String(Math.round(card.y)));
    item.setAttribute("Width", String(Math.round(card.width)));
    item.setAttribute("Height", String(Math.round(card.height)));
    if (card.sceneId !== undefined) item.setAttribute("FolioScene", card.sceneId);
    beat.appendChild(item);
  }
  boards.appendChild(beat);
  for (const extra of board.preserved) {
    if (extra.name === "DisplayBoard") boards.appendChild(importFragment(document, extra.xml));
  }
  root.appendChild(boards);

  const lists = document.createElement("ListItems");
  for (const card of board.cards) lists.appendChild(listItemElement(document, card));
  for (const extra of board.preserved) {
    if (extra.name === "ListItem") lists.appendChild(importFragment(document, extra.xml));
  }
  root.appendChild(lists);
}

export function appendBoard(document: Document, root: Element, board: Board | undefined): void {
  if (!board) return;
  if (board.origin === "final-draft") {
    appendFinalDraftBoard(document, root, board);
    return;
  }
  const useful = board.cards.length > 0 || board.preserved.length > 0 || Object.keys(board.attributes).length > 0;
  if (!useful) return;
  const element = document.createElement("BeatBoard");
  for (const [name, value] of Object.entries(board.attributes)) element.setAttribute(name, value);
  for (const card of board.cards) appendCard(document, element, board, card);
  for (const extra of board.preserved) element.appendChild(importFragment(document, extra.xml));
  root.appendChild(element);
}
