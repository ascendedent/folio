import { caretOffset, offsetOf, pointAt, runsFromElement, runsToHtml, selectionOffsets, setCaret, setRange } from "./caret.js";
import type { Store } from "./state.js";
import { readFountain } from "../src/fountain/parse.js";
import { assemblyOf, sceneIdOf } from "../src/production.js";
import { pageMarks } from "../src/text/layout.js";
import { kindOptions } from "./inspector.js";
import {
  applyKind,
  capitalizeSentenceRuns,
  guessKinds,
  markRevisionRange,
  sceneSpans,
  characterBase,
  characterColor,
  completions,
  displayContd,
  displayPage,
  enterResult,
  isUpperKind,
  joinRuns,
  makeParagraph,
  normalizeParenthetical,
  paragraphsFromPlain,
  splitRuns,
  toggleStyle,
} from "../src/edit.js";
import { paragraphText, scriptTitle, type ElementKind, type Paragraph, type TextRun } from "../src/model.js";
import { pagePieces, paragraphPages, type PagePiece } from "../src/text/layout.js";

const PLACEHOLDER: Partial<Record<ElementKind, string>> = {
  "scene-heading": "INT. LOCATION - DAY",
  action: "Action",
  character: "CHARACTER",
  parenthetical: "(parenthetical)",
  dialogue: "Dialogue",
  transition: "CUT TO:",
  shot: "ANGLE ON",
  "outline-1": "Outline",
  "outline-body": "What this section is about",
};

/** Copied paragraphs keep their element types when pasted back into Folio. */
const CLIPBOARD_TYPE = "application/x-folio-paragraphs+json";

type Point = { index: number; offset: number };
type Span = { from: Point; to: Point };

let styleTarget: ((style: "bold" | "italic" | "underline") => void) | null = null;
const typingStyle = { bold: false, italic: false, underline: false };

export function editorStyle(style: "bold" | "italic" | "underline"): void {
  styleTarget?.(style);
}

function looksLikeFountain(text: string): boolean {
  return /^(?:int|ext|est|int\.?\/ext|i\/e)[.\s]/imu.test(text);
}

function htmlFor(runs: readonly TextRun[]): string {
  // An empty paragraph holds a <br> so the caret can sit in it.
  return runsToHtml(runs) || "<br>";
}

function upperRuns(runs: readonly TextRun[]): TextRun[] {
  return runs.map((run) => ({ ...run, text: run.text.toUpperCase() }));
}

export function mountEditor(host: HTMLElement, store: Store): () => void {
  // The whole desk is one editing host, so a selection can run across
  // paragraphs and pages. Paragraph elements are plain blocks inside it.
  const desk = document.createElement("div");
  desk.className = "desk";
  desk.dataset.testid = "script-desk";
  desk.contentEditable = "true";
  desk.spellcheck = true;
  desk.setAttribute("role", "textbox");
  desk.setAttribute("aria-multiline", "true");
  desk.setAttribute("aria-label", "Script");
  host.append(desk);

  const suggest = document.createElement("div");
  suggest.className = "suggest hidden";
  suggest.dataset.testid = "suggest";
  document.body.append(suggest);

  let items: string[] = [];
  let suggestIndex = 0;
  let tabWalk: { index: number; from: ElementKind; text: string; previous: ElementKind | null; step: number } | null = null;
  let typeArmed = false;
  let syncing = false;
  let painting = false;
  let pointerHeld = false;
  let focused: HTMLElement | null = null;
  let inputTarget: HTMLElement | null = null;
  let revisionMark: { offset: number; length: number } | null = null;

  const sliceStartOf = (el: HTMLElement): number => Number(el.dataset.sliceStart ?? 0);

  const paragraphOf = (node: Node | null): HTMLElement | null => {
    const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
    const found = element?.closest<HTMLElement>(".paragraph") ?? null;
    return found && desk.contains(found) ? found : null;
  };

  /** The caret's offset in an element, never past its text. A trailing <br> placeholder does not count. */
  const caretIn = (el: HTMLElement): number => {
    const shown = runsFromElement(el).reduce((sum, run) => sum + run.text.length, 0);
    return Math.min(caretOffset(el), shown);
  };

  const caretParagraph = (): HTMLElement | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    return paragraphOf(selection.focusNode);
  };

  const elementAt = (point: Point): HTMLElement | undefined => {
    const matches = [...desk.querySelectorAll<HTMLElement>(`.paragraph[data-index="${point.index}"]`)];
    return (
      matches.find((node) => point.offset >= sliceStartOf(node) && point.offset <= Number(node.dataset.sliceEnd ?? 0)) ??
      matches[matches.length - 1]
    );
  };

  /** Where a DOM point falls in the script. A point between paragraphs snaps to the nearest one. */
  const pointOf = (node: Node, offset: number, edge: "start" | "end"): Point | null => {
    const el = paragraphOf(node);
    if (el) {
      const paragraph = store.script.paragraphs[Number(el.dataset.index)];
      const length = paragraph ? paragraphText(paragraph).length : 0;
      return { index: Number(el.dataset.index), offset: Math.min(length, sliceStartOf(el) + offsetOf(el, node, offset)) };
    }
    const probe = document.createRange();
    probe.setStart(node, offset);
    const all = [...desk.querySelectorAll<HTMLElement>(".paragraph")];
    if (edge === "start") {
      const next = all.find((candidate) => probe.comparePoint(candidate, 0) >= 0);
      return next ? { index: Number(next.dataset.index), offset: sliceStartOf(next) } : null;
    }
    const previous = all.reverse().find((candidate) => probe.comparePoint(candidate, candidate.childNodes.length) <= 0);
    return previous ? { index: Number(previous.dataset.index), offset: Number(previous.dataset.sliceEnd ?? 0) } : null;
  };

  const modelSpan = (): Span | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!desk.contains(range.commonAncestorContainer)) return null;
    const from = pointOf(range.startContainer, range.startOffset, "start");
    const to = pointOf(range.endContainer, range.endOffset, "end");
    if (!from || !to) return null;
    if (to.index < from.index || (to.index === from.index && to.offset < from.offset)) return { from, to: from };
    return { from, to };
  };

  /** True when the selection reaches past one paragraph element, which the browser cannot edit safely. */
  const crossing = (): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!desk.contains(range.commonAncestorContainer)) return false;
    const start = paragraphOf(range.startContainer);
    return !start || start !== paragraphOf(range.endContainer);
  };

  const focusDesk = (): void => {
    if (document.activeElement !== desk) desk.focus({ preventScroll: true });
  };

  const selectSpan = (from: Point, to: Point): void => {
    const a = elementAt(from);
    const b = elementAt(to);
    if (!a || !b) return;
    const start = pointAt(a, from.offset - sliceStartOf(a));
    const end = pointAt(b, to.offset - sliceStartOf(b));
    focusDesk();
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const spanText = (span: Span): string => {
    const lines: string[] = [];
    for (let index = span.from.index; index <= span.to.index; index += 1) {
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) continue;
      const text = paragraphText(paragraph);
      lines.push(text.slice(index === span.from.index ? span.from.offset : 0, index === span.to.index ? span.to.offset : text.length));
    }
    return lines.join("\n");
  };

  const spanParagraphs = (span: Span): { kind: ElementKind; runs: TextRun[] }[] => {
    const copied: { kind: ElementKind; runs: TextRun[] }[] = [];
    for (let index = span.from.index; index <= span.to.index; index += 1) {
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) continue;
      const end = index === span.to.index ? span.to.offset : paragraphText(paragraph).length;
      const [head] = splitRuns(paragraph.runs, end);
      const [, piece] = splitRuns(head, index === span.from.index ? span.from.offset : 0);
      copied.push({ kind: paragraph.kind, runs: joinRuns(piece, []) });
    }
    return copied;
  };

  /** Removes the span from the script. Call inside a transaction. */
  const removeSpan = (span: Span): Point => {
    const { from, to } = span;
    const paragraphs = store.script.paragraphs;
    const last = paragraphs[to.index];
    if (!last) return from;
    if (to.index > from.index && from.offset === 0) {
      // Whole lines went, so the line that remains keeps its own type.
      const [, tail] = splitRuns(last.runs, to.offset);
      last.runs = joinRuns(tail, []);
      paragraphs.splice(from.index, to.index - from.index);
      return { index: from.index, offset: 0 };
    }
    const first = paragraphs[from.index];
    if (!first) return from;
    const [head] = splitRuns(first.runs, from.offset);
    const [, tail] = splitRuns(last.runs, to.offset);
    first.runs = joinRuns(head, isUpperKind(first.kind) ? upperRuns(tail) : tail);
    if (to.index > from.index) paragraphs.splice(from.index + 1, to.index - from.index);
    return from;
  };

  const replaceSpan = (span: Span, text: string): void => {
    store.transact(() => {
      const at = removeSpan(span);
      const paragraph = store.script.paragraphs[at.index];
      if (paragraph && text) {
        const [left, right] = splitRuns(paragraph.runs, at.offset);
        paragraph.runs = joinRuns(joinRuns(left, [{ text: isUpperKind(paragraph.kind) ? text.toUpperCase() : text }]), right);
      }
      store.caret = { index: at.index, offset: at.offset + text.length };
    });
  };

  const hideSuggest = (): void => {
    items = [];
    suggest.classList.add("hidden");
    suggest.replaceChildren();
  };

  const paintSuggest = (): void => {
    suggest.replaceChildren();
    items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item;
      if (index === suggestIndex) button.classList.add("active");
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (typeArmed) {
          const option = kindOptions()[index];
          if (option && focused) {
            const caret = sliceStartOf(focused) + caretIn(focused);
            const paragraphIndex = Number(focused.dataset.index);
            store.transact(() => {
              const current = store.script.paragraphs[paragraphIndex];
              if (current) applyKind(current, option.kind);
              store.caret = { index: paragraphIndex, offset: caret };
            });
          }
          typeArmed = false;
          hideSuggest();
          return;
        }
        if (focused) accept(focused, item);
      });
      suggest.append(button);
    });
  };

  const showTypeMenu = (el: HTMLElement): void => {
    items = kindOptions().map((option) => option.label);
    suggestIndex = 0;
    typeArmed = true;
    paintSuggest();
    const rect = el.getBoundingClientRect();
    suggest.style.left = `${Math.max(8, rect.left)}px`;
    suggest.style.top = `${rect.bottom + 4}px`;
    suggest.classList.remove("hidden");
    suggest.dataset.testid = "type-menu";
  };

  const showSuggest = (el: HTMLElement, paragraph: Paragraph): void => {
    items = completions(store.script, paragraph.kind, paragraphText(paragraph));
    suggestIndex = 0;
    if (items.length === 0) {
      hideSuggest();
      return;
    }
    paintSuggest();
    const rect = el.getBoundingClientRect();
    suggest.style.left = `${Math.max(8, rect.left)}px`;
    suggest.style.top = `${rect.bottom + 4}px`;
    suggest.classList.remove("hidden");
  };

  const accept = (el: HTMLElement, value: string): void => {
    const index = Number(el.dataset.index);
    const paragraph = store.script.paragraphs[index];
    if (!paragraph) return;
    store.beginBurst();
    paragraph.runs = [{ text: isUpperKind(paragraph.kind) ? value.toUpperCase() : value }];
    syncing = true;
    el.innerHTML = htmlFor(paragraph.runs);
    setCaret(el, paragraphText(paragraph).length);
    syncing = false;
    hideSuggest();
    store.noteText();
  };

  const writeRuns = (el: HTMLElement, runs: TextRun[], offset: number): void => {
    syncing = true;
    el.innerHTML = htmlFor(runs);
    setCaret(el, offset);
    syncing = false;
  };

  const applyInline = (style: "bold" | "italic" | "underline"): void => {
    if (crossing()) {
      const span = modelSpan();
      if (!span) return;
      store.transact(() => {
        for (let index = span.from.index; index <= span.to.index; index += 1) {
          const paragraph = store.script.paragraphs[index];
          if (!paragraph) continue;
          const start = index === span.from.index ? span.from.offset : 0;
          const end = index === span.to.index ? span.to.offset : paragraphText(paragraph).length;
          if (end > start) paragraph.runs = toggleStyle(paragraph.runs, start, end, style);
        }
        store.caret = { ...span.to };
      });
      selectSpan(span.from, span.to);
      return;
    }
    const el = caretParagraph() ?? focused;
    if (!el) return;
    const index = Number(el.dataset.index);
    const paragraph = store.script.paragraphs[index];
    const range = selectionOffsets(el);
    if (!paragraph || !range) return;
    if (range.start === range.end) {
      typingStyle[style] = !typingStyle[style];
      store.setStatus(`${style[0]?.toUpperCase() ?? ""}${style.slice(1)} ${typingStyle[style] ? "on" : "off"} for new typing`);
      return;
    }
    const sliceStart = sliceStartOf(el);
    const sliceEnd = Number(el.dataset.sliceEnd ?? paragraphText(paragraph).length);
    store.beginBurst();
    paragraph.runs = toggleStyle(paragraph.runs, sliceStart + range.start, sliceStart + range.end, style);
    writeRuns(el, sliceRuns(index, sliceStart, sliceEnd), range.end);
    store.noteText();
  };

  /** Splits the paragraph at offset the way Enter does. Call inside a transaction. */
  const splitAt = (index: number, offset: number): void => {
    const paragraph = store.script.paragraphs[index];
    if (!paragraph) return;
    const [left, right] = splitRuns(paragraph.runs, offset);
    const before = left.map((run) => run.text).join("");
    const atEnd = offset >= paragraphText(paragraph).length;
    const decision = enterResult(paragraph.kind, before, atEnd);
    if (decision.become && decision.next === null) {
      paragraph.runs = joinRuns(left, []);
      applyKind(paragraph, decision.become);
      store.caret = { index, offset: paragraphText(paragraph).length };
      return;
    }
    paragraph.runs = joinRuns(left, []);
    const nextKind = decision.next ?? "action";
    const next = makeParagraph(nextKind, "");
    next.runs = joinRuns(isUpperKind(nextKind) ? upperRuns(right) : right, []);
    if (
      paragraph.dualGroup !== undefined &&
      (next.kind === "dialogue" || next.kind === "parenthetical" || next.kind === "character")
    ) {
      next.dualGroup = paragraph.dualGroup;
    }
    store.script.paragraphs.splice(index + 1, 0, next);
    store.caret = { index: index + 1, offset: 0 };
  };

  const setKinds = (span: Span, kind: ElementKind): void => {
    store.transact(() => {
      for (let index = span.from.index; index <= span.to.index; index += 1) {
        const paragraph = store.script.paragraphs[index];
        if (paragraph) applyKind(paragraph, kind);
      }
      store.caret = { ...span.to };
    });
    selectSpan(span.from, span.to);
  };

  const normalizeLeaving = (el: HTMLElement): void => {
    if (!el.isConnected) return;
    const paragraph = store.script.paragraphs[Number(el.dataset.index)];
    if (!paragraph || paragraph.kind !== "parenthetical") return;
    const normalized = normalizeParenthetical(paragraphText(paragraph));
    if (normalized === paragraphText(paragraph)) return;
    store.beginBurst();
    paragraph.runs = [{ text: normalized }];
    syncing = true;
    el.innerHTML = htmlFor(paragraph.runs);
    syncing = false;
    store.noteText();
  };

  const markCaret = (el: HTMLElement | null): void => {
    desk.querySelectorAll(".paragraph.is-caret").forEach((node) => node.classList.remove("is-caret"));
    el?.classList.add("is-caret");
  };

  // Stands in for focus and blur on single paragraphs.
  const onSelection = (): void => {
    if (painting || !desk.isConnected) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !desk.contains(selection.anchorNode)) return;
    const el = paragraphOf(selection.focusNode);
    if (!el) {
      if (selection.isCollapsed && !pointerHeld) {
        const node = selection.anchorNode;
        const point = pointOf(node, selection.anchorOffset, "start") ?? pointOf(node, selection.anchorOffset, "end");
        if (point) selectSpan(point, point);
      }
      return;
    }
    if (el === focused) return;
    const previous = focused;
    focused = el;
    styleTarget = applyInline;
    markCaret(el);
    if (selection.isCollapsed && previous && previous !== el) normalizeLeaving(previous);
    if (crossing()) return;
    store.selectParagraph(Number(el.dataset.index));
    if (store.typewriter) el.scrollIntoView({ block: "center" });
  };

  desk.addEventListener("focusin", () => clearFindHit());
  desk.addEventListener("focusout", () => {
    if (focused) normalizeLeaving(focused);
    focused = null;
    markCaret(null);
  });
  desk.addEventListener("pointerdown", () => {
    pointerHeld = true;
  });
  const release = (): void => {
    if (!pointerHeld) return;
    pointerHeld = false;
    onSelection();
  };
  window.addEventListener("pointerup", release);
  document.addEventListener("selectionchange", onSelection);
  desk.addEventListener("dragstart", (event) => event.preventDefault());
  desk.addEventListener("drop", (event) => event.preventDefault());

  desk.addEventListener("beforeinput", (event) => {
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      if (event.inputType === "historyUndo") store.undo();
      else store.redo();
      return;
    }
    if (crossing()) {
      event.preventDefault();
      const span = modelSpan();
      if (!span) return;
      if (event.inputType === "insertText" || event.inputType === "insertReplacementText") {
        const text = (event.data ?? event.dataTransfer?.getData("text/plain") ?? "").replace(/\r?\n/gu, " ");
        replaceSpan(span, text);
      } else if (event.inputType.startsWith("delete")) {
        replaceSpan(span, "");
      }
      return;
    }
    const el = paragraphOf(window.getSelection()?.anchorNode ?? null);
    if (
      !el ||
      event.inputType.startsWith("format") ||
      event.inputType === "insertFromDrop" ||
      event.inputType === "deleteByDrag" ||
      event.inputType === "insertParagraph"
    ) {
      event.preventDefault();
      return;
    }
    inputTarget = el;
    store.beginBurst();
    const current = store.script.paragraphs[Number(el.dataset.index)];
    const length = current ? paragraphText(current).length : 0;
    const at = sliceStartOf(el) + caretIn(el);
    revisionMark = store.revision ? { offset: at, length } : null;
    if (typingStyle.bold || typingStyle.italic || typingStyle.underline) {
      revisionMark = { offset: at, length };
    }
  });

  desk.addEventListener("compositionstart", () => {
    const span = crossing() ? modelSpan() : null;
    if (span) replaceSpan(span, "");
  });

  desk.addEventListener("input", () => {
    if (syncing) return;
    const el = inputTarget?.isConnected ? inputTarget : caretParagraph();
    inputTarget = null;
    if (!el) return;
    const index = Number(el.dataset.index);
    const paragraph = store.script.paragraphs[index];
    if (!paragraph) return;
    const sliceStart = sliceStartOf(el);
    const sliceEnd = Number(el.dataset.sliceEnd ?? paragraphText(paragraph).length);
    const edited = runsFromElement(el);
    const localOffset = caretIn(el);
    const [head] = splitRuns(paragraph.runs, sliceStart);
    const [, tail] = splitRuns(paragraph.runs, sliceEnd);
    let runs = joinRuns(joinRuns(head, edited), tail);
    if (isUpperKind(paragraph.kind)) {
      runs = upperRuns(runs);
    } else if (
      paragraph.kind === "action" ||
      paragraph.kind === "dialogue" ||
      paragraph.kind === "general" ||
      paragraph.kind === "lyric" ||
      paragraph.kind === "singing"
    ) {
      runs = capitalizeSentenceRuns(runs);
    }
    const nextLength = runs.reduce((sum, run) => sum + run.text.length, 0);
    const added = revisionMark ? nextLength - revisionMark.length : 0;
    if (revisionMark && added > 0) {
      if (store.revision) runs = markRevisionRange(runs, revisionMark.offset, revisionMark.offset + added, store.revision);
      if (typingStyle.bold) runs = toggleStyle(runs, revisionMark.offset, revisionMark.offset + added, "bold");
      if (typingStyle.italic) runs = toggleStyle(runs, revisionMark.offset, revisionMark.offset + added, "italic");
      if (typingStyle.underline) runs = toggleStyle(runs, revisionMark.offset, revisionMark.offset + added, "underline");
    }
    revisionMark = null;
    paragraph.runs = runs;
    const editedLength = edited.reduce((sum, run) => sum + run.text.length, 0);
    el.dataset.sliceEnd = String(sliceStart + editedLength);
    const shown = sliceRuns(index, sliceStart, sliceStart + editedLength);
    const shownText = shown.map((run) => run.text).join("");
    const domText = edited.map((run) => run.text).join("");
    if (shownText !== domText || (domText === "" && !el.querySelector("br"))) writeRuns(el, shown, localOffset);
    heldCaret = { index, offset: sliceStart + localOffset };
    const text = paragraphText(paragraph);
    if (text === "") el.dataset.placeholder = PLACEHOLDER[paragraph.kind] ?? "";
    else delete el.dataset.placeholder;
    if (paragraph.kind === "character") {
      el.style.setProperty("--cue", characterColor(characterBase(text) || "A"));
      el.dataset.contd = displayContd(store.script, index) ? "1" : "0";
    }
    store.noteText();
    showSuggest(el, paragraph);
    tabWalk = null;
  });

  const copySpan = (event: ClipboardEvent): Span | null => {
    if (!crossing()) return null;
    const span = modelSpan();
    if (!span) return null;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", spanText(span));
    event.clipboardData?.setData(CLIPBOARD_TYPE, JSON.stringify(spanParagraphs(span)));
    return span;
  };
  desk.addEventListener("copy", (event) => {
    copySpan(event);
  });
  desk.addEventListener("cut", (event) => {
    const span = copySpan(event);
    if (span) replaceSpan(span, "");
  });

  const pastedParagraphs = (data: DataTransfer | null): Paragraph[] | null => {
    const raw = data?.getData(CLIPBOARD_TYPE) ?? "";
    if (raw) {
      try {
        const copied = JSON.parse(raw) as { kind: ElementKind; runs: TextRun[] }[];
        if (Array.isArray(copied) && copied.length > 0) {
          return copied.map((item) => {
            const paragraph = makeParagraph(item.kind, "");
            paragraph.runs = joinRuns(item.runs, []);
            return paragraph;
          });
        }
      } catch {
        // Fall back to the plain text.
      }
    }
    const text = data?.getData("text/plain") ?? "";
    if (!text.includes("\n")) return null;
    if (looksLikeFountain(text)) {
      try {
        const parsed = readFountain(text);
        if (parsed.paragraphs.length > 0) return parsed.paragraphs;
      } catch {
        // The line-by-line guess still stands.
      }
    }
    return paragraphsFromPlain(text);
  };

  desk.addEventListener("paste", (event) => {
    event.preventDefault();
    const span = modelSpan();
    if (!span) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const inserted = pastedParagraphs(event.clipboardData);
    if (!inserted && !text) return;
    store.transact(() => {
      const at = removeSpan(span);
      const paragraph = store.script.paragraphs[at.index];
      if (!paragraph) return;
      if (!inserted) {
        const [left, right] = splitRuns(paragraph.runs, at.offset);
        paragraph.runs = joinRuns(joinRuns(left, [{ text: isUpperKind(paragraph.kind) ? text.toUpperCase() : text }]), right);
        store.caret = { index: at.index, offset: at.offset + text.length };
        return;
      }
      const last = inserted[inserted.length - 1];
      const lastLength = last ? paragraphText(last).length : 0;
      if (paragraphText(paragraph) === "") {
        store.script.paragraphs.splice(at.index, 1, ...inserted);
        store.caret = { index: at.index + inserted.length - 1, offset: lastLength };
        return;
      }
      const [left, right] = splitRuns(paragraph.runs, at.offset);
      const keepHead = left.some((run) => run.text !== "");
      const rest: Paragraph[] = [];
      if (right.some((run) => run.text !== "")) {
        const tail = makeParagraph(paragraph.kind, "");
        tail.runs = joinRuns(right, []);
        rest.push(tail);
      }
      if (keepHead) paragraph.runs = joinRuns(left, []);
      const start = keepHead ? at.index + 1 : at.index;
      store.script.paragraphs.splice(start, keepHead ? 0 : 1, ...inserted, ...rest);
      store.caret = { index: start + inserted.length - 1, offset: lastLength };
    });
  });

  const goTo = (target: HTMLElement | null | undefined): void => {
    if (!target) return;
    setCaret(target, 0);
    target.scrollIntoView({ block: "nearest" });
  };

  desk.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!suggest.classList.contains("hidden") && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      suggestIndex = (suggestIndex + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      paintSuggest();
      return;
    }
    if (event.key === "Escape") {
      hideSuggest();
      return;
    }
    if (crossing()) {
      const span = modelSpan();
      if (!span) return;
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        replaceSpan(span, "");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        store.transact(() => {
          const at = removeSpan(span);
          splitAt(at.index, at.offset);
        });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey && focused) showTypeMenu(focused);
        return;
      }
      if ((typeArmed || event.altKey) && /^[1-9]$/u.test(event.key)) {
        event.preventDefault();
        const option = kindOptions()[Number(event.key) - 1];
        typeArmed = false;
        hideSuggest();
        if (option) setKinds(span, option.kind);
      }
      return;
    }
    const el = caretParagraph();
    if (!el) {
      if (event.key === "Backspace" || event.key === "Delete" || event.key === "Enter" || event.key === "Tab") event.preventDefault();
      return;
    }
    const index = Number(el.dataset.index);
    const paragraph = store.script.paragraphs[index];
    if (!paragraph) return;
    if (typeArmed && /^[1-9]$/u.test(event.key)) {
      event.preventDefault();
      const option = kindOptions()[Number(event.key) - 1];
      typeArmed = false;
      hideSuggest();
      tabWalk = null;
      if (!option) return;
      const offset = sliceStartOf(el) + caretIn(el);
      store.transact(() => {
        applyKind(paragraph, option.kind);
        store.caret = { index, offset };
      });
      return;
    }
    if (event.altKey && /^[1-9]$/u.test(event.key)) {
      event.preventDefault();
      const option = kindOptions()[Number(event.key) - 1];
      if (!option) return;
      const offset = sliceStartOf(el) + caretIn(el);
      store.transact(() => {
        applyKind(paragraph, option.kind);
        store.caret = { index, offset };
      });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      hideSuggest();
      const offset = sliceStartOf(el) + caretIn(el);
      const previous = index > 0 ? (store.script.paragraphs[index - 1]?.kind ?? null) : null;
      if (!tabWalk || tabWalk.index !== index) {
        tabWalk = { index, from: paragraph.kind, text: paragraphText(paragraph), previous, step: 0 };
      }
      const list = guessKinds(tabWalk.from, tabWalk.text, tabWalk.previous);
      if (event.shiftKey) {
        typeArmed = true;
        showTypeMenu(el);
        return;
      }
      typeArmed = false;
      if (list.length === 0) return;
      tabWalk.step += 1;
      const next = list[(tabWalk.step - 1) % list.length];
      if (!next) return;
      store.transact(() => {
        applyKind(paragraph, next);
        store.caret = { index, offset };
      });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!suggest.classList.contains("hidden")) {
        const chosen = items[suggestIndex];
        if (chosen) accept(el, chosen);
        return;
      }
      const span = modelSpan();
      store.transact(() => {
        const at = span ? removeSpan(span) : { index, offset: sliceStartOf(el) + caretIn(el) };
        splitAt(at.index, at.offset);
      });
      return;
    }
    if (mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const spans = sceneSpans(store.script);
      const at = spans.findIndex((span) => index >= span.start && index < span.end);
      const dest = spans[at + (event.key === "ArrowDown" ? 1 : -1)];
      goTo(dest ? desk.querySelector<HTMLElement>(`.paragraph[data-index="${dest.start}"]`) : null);
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const pages = paragraphPages(store.script);
      const current = pages[index] ?? 1;
      const wanted = event.key === "PageDown" ? current + 1 : current - 1;
      const next = pages.findIndex((page) => page === wanted);
      goTo(next >= 0 ? desk.querySelector<HTMLElement>(`.paragraph[data-index="${next}"]`) : null);
      return;
    }
    const collapsed = window.getSelection()?.isCollapsed ?? true;
    if (event.key === "Backspace" && collapsed && caretIn(el) === 0) {
      event.preventDefault();
      const sliceStart = sliceStartOf(el);
      if (sliceStart > 0) {
        store.beginBurst();
        const [left, right] = splitRuns(paragraph.runs, sliceStart - 1);
        const [, tail] = splitRuns(right, 1);
        paragraph.runs = joinRuns(left, tail);
        heldCaret = { index, offset: sliceStart - 1 };
        store.caret = heldCaret;
        pageSignature = "";
        store.noteText();
        return;
      }
      if (index === 0) return;
      const previous = store.script.paragraphs[index - 1];
      if (!previous) return;
      const previousLength = paragraphText(previous).length;
      store.transact(() => {
        if (paragraphText(paragraph) !== "") {
          previous.runs = joinRuns(previous.runs, paragraph.runs);
          if (isUpperKind(previous.kind)) previous.runs = upperRuns(previous.runs);
        }
        if (store.script.paragraphs.length > 1) store.script.paragraphs.splice(index, 1);
        store.caret = { index: index - 1, offset: previousLength };
      });
      return;
    }
    if (event.key === "Delete" && collapsed) {
      const shown = runsFromElement(el).reduce((sum, run) => sum + run.text.length, 0);
      if (caretIn(el) < shown) return;
      // At the end of a paragraph the browser would pull the next one into this element.
      event.preventDefault();
      const end = sliceStartOf(el) + shown;
      const length = paragraphText(paragraph).length;
      if (end < length) {
        store.beginBurst();
        const [left, right] = splitRuns(paragraph.runs, end);
        const [, tail] = splitRuns(right, 1);
        paragraph.runs = joinRuns(left, tail);
        heldCaret = { index, offset: end };
        store.caret = heldCaret;
        pageSignature = "";
        store.noteText();
        return;
      }
      const next = store.script.paragraphs[index + 1];
      if (!next) return;
      store.transact(() => {
        if (paragraphText(next) !== "") {
          paragraph.runs = joinRuns(paragraph.runs, isUpperKind(paragraph.kind) ? upperRuns(next.runs) : next.runs);
        }
        store.script.paragraphs.splice(index + 1, 1);
        store.caret = { index, offset: length };
      });
    }
  });

  let omitted = new Set<number>();
  let pageSignature = "";
  let heldCaret: { index: number; offset: number } | null = null;

  const sliceRuns = (index: number, start: number, end: number): TextRun[] => {
    const paragraph = store.script.paragraphs[index];
    if (!paragraph) return [{ text: "" }];
    const [, tail] = splitRuns(paragraph.runs, start);
    const [head] = splitRuns(tail, Math.max(0, end - start));
    return head;
  };

  const fixed = <T extends HTMLElement>(node: T): T => {
    node.contentEditable = "false";
    return node;
  };

  const rowFor = (piece: PagePiece): HTMLElement => {
    const index = piece.index;
    const paragraph = store.script.paragraphs[index];
    const row = document.createElement("div");
    row.className = "row";
    if (omitted.has(index)) row.classList.add("omitted");
    if (!paragraph) return row;
    if (store.selection?.type === "paragraph" && store.selection.index === index) row.classList.add("active");
    const gutter = fixed(document.createElement("span"));
    gutter.className = "gutter";
    if (paragraph.kind === "scene-heading" && paragraph.sceneNumber) gutter.textContent = paragraph.sceneNumber;
    if (paragraph.runs.some((run) => run.revisionId)) gutter.dataset.revised = "1";
    if (paragraph.kind === "scene-heading") {
      const sceneId = sceneIdOf(paragraph);
      if ((store.script.board?.cards ?? []).some((card) => card.sceneId === sceneId)) row.classList.add("has-beat");
      const story = paragraph.scene?.attributes.FolioStory;
      if (story) row.style.setProperty("--story", story);
    }
    const editable = document.createElement("div");
    editable.className = `paragraph kind-${paragraph.kind}`;
    editable.spellcheck = paragraph.kind !== "character";
    editable.dataset.index = String(index);
    editable.dataset.sliceStart = String(piece.start);
    editable.dataset.sliceEnd = String(piece.end);
    editable.dataset.testid = "paragraph";
    editable.dataset.kind = paragraph.kind;
    editable.innerHTML = htmlFor(sliceRuns(index, piece.start, piece.end));
    if (paragraphText(paragraph) === "") editable.dataset.placeholder = PLACEHOLDER[paragraph.kind] ?? "";
    if (paragraph.kind === "character") {
      editable.style.setProperty("--cue", characterColor(characterBase(paragraphText(paragraph)) || "A"));
      if (displayContd(store.script, index)) editable.dataset.contd = "1";
    }
    row.append(gutter, editable);
    if (paragraph.notes.length > 0) {
      const flag = fixed(document.createElement("button"));
      flag.type = "button";
      flag.className = "note-flag";
      flag.textContent = "Note";
      const shown = (paragraph.notes[0] ?? "Script note").replace(/^\d+-\d+\|/u, "");
      flag.title = shown;
      flag.addEventListener("click", () => store.selectParagraph(index));
      const margin = fixed(document.createElement("aside"));
      margin.className = "margin-note";
      margin.textContent = shown;
      row.append(flag, margin);
    }
    return row;
  };

  const renderBlock = (body: HTMLElement, pieces: PagePiece[]): void => {
    let cursor = 0;
    while (cursor < pieces.length) {
      const piece = pieces[cursor];
      const paragraph = piece ? store.script.paragraphs[piece.index] : undefined;
      if (!piece || !paragraph) {
        cursor += 1;
        continue;
      }
      const group = paragraph.dualGroup;
      if (group === undefined) {
        body.append(rowFor(piece));
        cursor += 1;
        continue;
      }
      const members: PagePiece[] = [];
      while (cursor < pieces.length) {
        const candidate = pieces[cursor];
        if (!candidate || store.script.paragraphs[candidate.index]?.dualGroup !== group) break;
        members.push(candidate);
        cursor += 1;
      }
      const dual = document.createElement("div");
      dual.className = "dual";
      const speeches: PagePiece[][] = [];
      for (const member of members) {
        if (store.script.paragraphs[member.index]?.kind === "character" || speeches.length === 0) speeches.push([member]);
        else speeches[speeches.length - 1]?.push(member);
      }
      for (const speech of speeches.slice(0, 2)) {
        const column = document.createElement("div");
        column.className = "dual-col";
        for (const member of speech) column.append(rowFor(member));
        dual.append(column);
      }
      body.append(dual);
    }
  };

  const typingElsewhere = (): boolean => {
    const active = document.activeElement;
    return (
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) &&
      !desk.contains(active)
    );
  };

  const clearFindHit = (): void => {
    if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete("folio-find");
  };

  const showFindHit = (index: number, start: number, end: number): void => {
    const el = elementAt({ index, offset: start });
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") return;
    const from = pointAt(el, start - sliceStartOf(el));
    const to = pointAt(el, Math.min(end, Number(el.dataset.sliceEnd ?? end)) - sliceStartOf(el));
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    CSS.highlights.set("folio-find", new Highlight(range));
  };

  const otherEditorFocused = (): boolean => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.dataset.testid === "script-desk" && active !== desk;
  };

  const shouldPlaceCaret = (): boolean => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && desk.contains(active)) return true;
    if (otherEditorFocused()) return false;
    return document.querySelector("[data-testid='script-desk']") === desk;
  };

  const paint = (): void => {
    for (const paragraph of store.script.paragraphs) {
      const last = paragraph.runs[paragraph.runs.length - 1];
      if (last && /\n+$/u.test(last.text)) last.text = last.text.replace(/\n+$/u, "");
      if (!isUpperKind(paragraph.kind)) continue;
      for (const run of paragraph.runs) {
        const upper = run.text.toUpperCase();
        if (upper !== run.text) run.text = upper;
      }
    }
    const placeCaret = shouldPlaceCaret();
    hideSuggest();
    omitted = new Set();
    for (const span of sceneSpans(store.script)) {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      if (assemblyOf(store.script, sceneId).status !== "omit") continue;
      for (let index = span.start; index < span.end; index += 1) omitted.add(index);
    }
    const caret = store.takeCaret();
    painting = true;
    focused = null;
    desk.classList.toggle("show-numbers", store.sceneNumbers);
    desk.classList.toggle("show-watermark", store.watermark);
    desk.replaceChildren();
    const groups = pagePieces(store.script);
    if (groups.length === 0) groups.push([]);
    pageSignature = groups.map((page) => page.map((piece) => `${piece.index}:${piece.start}:${piece.end}`).join(",")).join("|");
    const title = scriptTitle(store.script);
    const marks = pageMarks(store.script);
    groups.forEach((pieces, pageIndex) => {
      const sheet = document.createElement("section");
      sheet.className = "sheet";
      sheet.dataset.testid = "sheet";
      sheet.dataset.page = String(pageIndex + 1);
      if (store.watermark) sheet.dataset.watermark = (title || "FOLIO").toUpperCase();
      const head = fixed(document.createElement("div"));
      head.className = "sheet-head";
      head.append(document.createElement("span"));
      const slug = head.firstElementChild;
      if (slug && pageIndex > 0) slug.textContent = title;
      const number = document.createElement("span");
      number.className = "sheet-num";
      const first = pieces[0]?.index;
      if (pageIndex > 0 && first !== undefined) number.textContent = `${displayPage(store.script, first, pageIndex + 1)}.`;
      head.append(number);
      const body = document.createElement("div");
      body.className = "sheet-body";
      const mark = marks[pageIndex];
      if (mark?.continuedName) {
        const banner = fixed(document.createElement("div"));
        banner.className = "contd-banner";
        banner.textContent = `${mark.continuedName} (CONT'D)`;
        body.append(banner);
      }
      renderBlock(body, pieces);
      if (mark?.more) {
        const more = fixed(document.createElement("div"));
        more.className = "more-line";
        more.textContent = "(MORE)";
        body.append(more);
      }
      sheet.append(head, body);
      desk.append(sheet);
    });
    painting = false;
    if (!placeCaret) {
      if (caret) store.caret = caret;
      return;
    }
    const target = caret ?? (store.selection?.type === "paragraph" ? { index: store.selection.index, offset: 0 } : null);
    if (!target) return;
    const matches = [...desk.querySelectorAll<HTMLElement>(`.paragraph[data-index="${target.index}"]`)];
    const el =
      matches.find((node) => {
        const start = sliceStartOf(node);
        const end = Number(node.dataset.sliceEnd ?? 0);
        return target.offset >= start && target.offset < end;
      }) ??
      matches.find((node) => Number(node.dataset.sliceEnd ?? 0) >= target.offset) ??
      matches[matches.length - 1];
    if (!el) return;
    if (caret) setCaret(el, target.offset - sliceStartOf(el));
    else el.scrollIntoView({ block: "nearest" });
    const range = store.selection?.type === "paragraph" ? store.selection : null;
    if (range?.start !== undefined && range.end !== undefined) setRange(el, range.start, range.end);
  };

  let pageTimer = 0;

  const onStore = (event: string): void => {
    if (event === "script" || event === "view") paint();
    else if (event === "text") {
      window.clearTimeout(pageTimer);
      pageTimer = window.setTimeout(() => {
        const groups = pagePieces(store.script);
        const signature = groups.map((page) => page.map((piece) => `${piece.index}:${piece.start}:${piece.end}`).join(",")).join("|");
        if (signature === pageSignature) return;
        if (heldCaret) store.caret = heldCaret;
        else {
          const active = caretParagraph();
          if (active && document.activeElement === desk) {
            store.caret = { index: Number(active.dataset.index), offset: sliceStartOf(active) + caretIn(active) };
          }
        }
        paint();
      }, 280);
    } else if (event === "chrome") {
      fitWidth();
      desk.classList.toggle("show-numbers", store.sceneNumbers);
      desk.classList.toggle("show-watermark", store.watermark);
    } else if (event === "selection" || event === "find") {
      desk.querySelectorAll(".row.active").forEach((row) => row.classList.remove("active"));
      if (store.selection?.type !== "paragraph") return;
      const el = desk.querySelector<HTMLElement>(`.paragraph[data-index="${store.selection.index}"]`);
      el?.closest(".row")?.classList.add("active");
      if (!el) return;
      const { start, end } = store.selection;
      if (!shouldPlaceCaret() || typingElsewhere()) {
        // Someone is typing in the find box or a field. Show the match without taking focus.
        if (start !== undefined && end !== undefined) showFindHit(store.selection.index, start, end);
        else el.scrollIntoView({ block: "nearest" });
        return;
      }
      clearFindHit();
      if (start === undefined || end === undefined) return;
      setRange(el, start, end);
      el.scrollIntoView({ block: "center" });
    }
  };

  // A sheet is always a full page wide, so lines wrap where the page count expects.
  // A narrow pane shrinks the whole desk instead of squeezing the sheet.
  const fitWidth = (): void => {
    const room = host.clientWidth - 20;
    const scale = room > 0 ? Math.min(1, Math.max(0.45, room / ((816 + 48) * store.zoom))) : 1;
    desk.style.zoom = String(store.zoom * scale);
  };
  const resize = new ResizeObserver(fitWidth);
  resize.observe(host);

  const unsubscribe = store.subscribe(onStore);
  fitWidth();
  paint();
  desk.addEventListener("scroll", hideSuggest, true);

  return () => {
    if (styleTarget === applyInline) styleTarget = null;
    clearFindHit();
    resize.disconnect();
    unsubscribe();
    document.removeEventListener("selectionchange", onSelection);
    window.removeEventListener("pointerup", release);
    window.clearTimeout(pageTimer);
    suggest.remove();
    desk.remove();
  };
}
