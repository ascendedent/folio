import type { TextRun } from "../src/model.js";

export function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

export function runsToHtml(runs: readonly TextRun[]): string {
  const html = runs
    .map((run) => {
      let body = escapeHtml(run.text).replace(/\n/gu, "<br>");
      if (!body) return "";
      if (run.strike) body = `<s>${body}</s>`;
      if (run.underline) body = `<u>${body}</u>`;
      if (run.italic) body = `<i>${body}</i>`;
      if (run.bold) body = `<b>${body}</b>`;
      if (run.revisionId && /^[a-z]+$/u.test(run.revisionId)) {
        body = `<span class="rev rev-${run.revisionId}">${body}</span>`;
      }
      return body;
    })
    .join("");
  return html;
}

export function runsFromElement(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: Node, style: Omit<TextRun, "text">): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) runs.push({ text, ...style });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      runs.push({ text: "\n", ...style });
      return;
    }
    const next: Omit<TextRun, "text"> = { ...style };
    const tag = node.tagName;
    if (tag === "B" || tag === "STRONG") next.bold = true;
    if (tag === "I" || tag === "EM") next.italic = true;
    if (tag === "U") next.underline = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") next.strike = true;
    const revision = [...node.classList].find((name) => name.startsWith("rev-") && name !== "rev");
    if (revision) next.revisionId = revision.slice(4);
    for (const child of node.childNodes) walk(child, next);
  };
  for (const child of root.childNodes) walk(child, {});
  while (runs.length > 0) {
    const last = runs[runs.length - 1];
    if (!last) break;
    if (last.text === "\n" || last.text === "") {
      runs.pop();
      continue;
    }
    if (last.text.endsWith("\n")) last.text = last.text.replace(/\n+$/u, "");
    break;
  }
  return runs.length > 0 ? runs : [{ text: "" }];
}

function measureNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === "BR") return 1;
  let total = 0;
  for (const child of node.childNodes) total += measureNode(child);
  return total;
}

export function offsetOf(root: Node, target: Node, targetOffset: number): number {
  let count = 0;
  const visit = (node: Node): boolean => {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) count += targetOffset;
      else {
        for (const child of [...node.childNodes].slice(0, targetOffset)) count += measureNode(child);
      }
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent?.length ?? 0;
      return false;
    }
    if (node.nodeName === "BR") {
      count += 1;
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) return true;
    }
    return false;
  };
  visit(root);
  return count;
}

export function caretOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return 0;
  return offsetOf(root, range.endContainer, range.endOffset);
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

export function pointAt(root: Node, target: number): { node: Node; offset: number } {
  let left = Math.max(0, target);
  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (left <= length) return { node, offset: left };
      left -= length;
      return null;
    }
    if (node.nodeName === "BR") {
      if (left <= 0) {
        const parent = node.parentNode ?? root;
        const index = [...parent.childNodes].indexOf(node as ChildNode);
        return { node: parent, offset: index + 1 };
      }
      left -= 1;
      return null;
    }
    for (const child of node.childNodes) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(root) ?? { node: root, offset: root.childNodes.length };
}

function focusHost(root: HTMLElement): void {
  // A paragraph inside the script desk is not focusable itself; its editing host is.
  const host = root.isContentEditable ? (root.closest<HTMLElement>("[contenteditable='true']") ?? root) : root;
  if (document.activeElement !== host) host.focus({ preventScroll: true });
}

export function setCaret(root: HTMLElement, offset: number): void {
  focusHost(root);
  const point = pointAt(root, offset);
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function setRange(root: HTMLElement, start: number, end: number): void {
  focusHost(root);
  const from = pointAt(root, start);
  const to = pointAt(root, end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
