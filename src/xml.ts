import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { FolioError } from "./errors.js";

export function parseXml(source: string): Document {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError(level, message) {
      if (level === "error" || level === "fatalError") errors.push(message);
    },
  });
  const document = parser.parseFromString(source, "application/xml");
  if (errors.length > 0) {
    throw new FolioError(`Malformed XML: ${errors[0]}`);
  }
  if (!document.documentElement) {
    throw new FolioError("The XML document has no root element.");
  }
  return document;
}

export function serialize(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

export function localName(node: Element): string {
  return node.localName || node.nodeName;
}

export function childElements(node: Element, name?: string): Element[] {
  const found: Element[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (!name || localName(element) === name) found.push(element);
  }
  return found;
}

export function descendants(node: Element, name: string): Element[] {
  const found: Element[] = [];
  const walk = (current: Element): void => {
    for (const child of childElements(current)) {
      if (localName(child) === name) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

export function attr(node: Element, name: string): string | undefined {
  if (!node.hasAttribute(name)) return undefined;
  return node.getAttribute(name) ?? undefined;
}

export function attributesOf(node: Element, skip: readonly string[] = []): Record<string, string> {
  const kept: Record<string, string> = {};
  const attributes = node.attributes;
  for (let index = 0; index < attributes.length; index += 1) {
    const item = attributes.item(index);
    if (!item || skip.includes(item.name)) continue;
    kept[item.name] = item.value;
  }
  return kept;
}

export function directText(node: Element): string {
  let text = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue ?? "";
  }
  return text;
}

export function importFragment(document: Document, xml: string): Element {
  const parsed = parseXml(xml);
  const root = parsed.documentElement;
  if (!root) throw new FolioError("Could not restore a preserved XML element.");
  const imported = document.importNode(root, true);
  if (imported.nodeType !== 1) {
    throw new FolioError("Could not restore a preserved XML element.");
  }
  return imported as Element;
}
