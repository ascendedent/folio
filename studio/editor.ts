import { caretOffset, runsFromElement, runsToHtml, selectionOffsets, setCaret, setRange } from "./caret.js";
import type { Store } from "./state.js";
import { readFountain } from "../src/fountain/parse.js";
import { assemblyOf, sceneIdOf } from "../src/production.js";
import { pageMarks } from "../src/text/layout.js";
import { kindOptions } from "./inspector.js";
import {
  applyKind,
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
import { paragraphPages } from "../src/text/layout.js";

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

let styleTarget: ((style: "bold" | "italic" | "underline") => void) | null = null;

export function editorStyle(style: "bold" | "italic" | "underline"): void {
  styleTarget?.(style);
}

function looksLikeFountain(text: string): boolean {
  return /^(?:int|ext|est|int\.?\/ext|i\/e)[.\s]/imu.test(text);
}

export function mountEditor(host: HTMLElement, store: Store): () => void {
  const desk = document.createElement("div");
  desk.className = "desk";
  desk.dataset.testid = "script-desk";
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
  let focused: HTMLElement | null = null;

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
            const caret = caretOffset(focused);
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
    el.innerHTML = runsToHtml(paragraph.runs);
    setCaret(el, paragraphText(paragraph).length);
    syncing = false;
    hideSuggest();
    store.noteText();
  };

  const writeRuns = (el: HTMLElement, runs: TextRun[], offset: number): void => {
    syncing = true;
    el.innerHTML = runsToHtml(runs);
    setCaret(el, offset);
    syncing = false;
  };

  const applyInline = (style: "bold" | "italic" | "underline"): void => {
    if (!focused) return;
    const index = Number(focused.dataset.index);
    const paragraph = store.script.paragraphs[index];
    const range = selectionOffsets(focused);
    if (!paragraph || !range || range.start === range.end) return;
    store.beginBurst();
    paragraph.runs = toggleStyle(paragraph.runs, range.start, range.end, style);
    writeRuns(focused, paragraph.runs, range.end);
    store.noteText();
  };

  let block: { start: number; end: number } | null = null;
  let blockAnchor: number | null = null;
  let pageTimer = 0;
  const markBlock = (): void => {
    desk.querySelectorAll(".row").forEach((row) => row.classList.remove("block-selected"));
    if (!block) return;
    for (let index = block.start; index < block.end; index += 1) {
      desk.querySelector(`.paragraph[data-index="${index}"]`)?.closest(".row")?.classList.add("block-selected");
    }
  };

  const wire = (el: HTMLElement): void => {
    let revisionMark: { offset: number; length: number } | null = null;
    el.addEventListener("beforeinput", () => {
      store.beginBurst();
      if (!store.revision) {
        revisionMark = null;
        return;
      }
      const current = store.script.paragraphs[Number(el.dataset.index)];
      revisionMark = { offset: caretOffset(el), length: current ? paragraphText(current).length : 0 };
    });
    el.addEventListener("pointerdown", (event) => {
      const here = Number(el.dataset.index);
      if (!event.shiftKey) {
        block = null;
        blockAnchor = null;
        markBlock();
        return;
      }
      const anchor = blockAnchor ?? (store.selection?.type === "paragraph" ? store.selection.index : here);
      blockAnchor = anchor;
      block = { start: Math.min(anchor, here), end: Math.max(anchor, here) + 1 };
      markBlock();
    });
    el.addEventListener("focus", () => {
      focused = el;
      styleTarget = applyInline;
      if (!block) store.selectParagraph(Number(el.dataset.index));
      if (store.typewriter) el.scrollIntoView({ block: "center" });
    });
    el.addEventListener("input", () => {
      if (syncing) return;
      const index = Number(el.dataset.index);
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) return;
      let runs = runsFromElement(el);
      const offset = caretOffset(el);
      if (isUpperKind(paragraph.kind)) {
        runs = runs.map((run) => ({ ...run, text: run.text.toUpperCase() }));
      }
      if (store.revision && revisionMark) {
        const nextLength = runs.reduce((sum, run) => sum + run.text.length, 0);
        const added = nextLength - revisionMark.length;
        if (added > 0) runs = markRevisionRange(runs, revisionMark.offset, revisionMark.offset + added, store.revision);
        revisionMark = null;
      }
      if (isUpperKind(paragraph.kind) || store.revision) writeRuns(el, runs, offset);
      paragraph.runs = runs;
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
    el.addEventListener("blur", () => {
      const index = Number(el.dataset.index);
      const paragraph = store.script.paragraphs[index];
      if (!paragraph || paragraph.kind !== "parenthetical") return;
      const normalized = normalizeParenthetical(paragraphText(paragraph));
      if (normalized === paragraphText(paragraph)) return;
      store.beginBurst();
      paragraph.runs = [{ text: normalized }];
      el.innerHTML = runsToHtml(paragraph.runs);
      store.noteText();
    });
    el.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      const index = Number(el.dataset.index);
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) return;
      if (text.includes("\n")) {
        let inserted = paragraphsFromPlain(text);
        if (looksLikeFountain(text)) {
          try {
            const parsed = readFountain(text);
            if (parsed.paragraphs.length > 0) inserted = parsed.paragraphs;
          } catch {
            // The line-by-line guess still stands.
          }
        }
        store.transact(() => {
          store.script.paragraphs.splice(index + 1, 0, ...inserted);
          store.caret = { index: index + inserted.length, offset: 0 };
        });
        return;
      }
      const offset = caretOffset(el);
      store.beginBurst();
      const [left, right] = splitRuns(paragraph.runs, offset);
      paragraph.runs = joinRuns(joinRuns(left, [{ text }]), right);
      writeRuns(el, paragraph.runs, offset + text.length);
      store.noteText();
    });
    el.addEventListener("keydown", (event) => {
      const index = Number(el.dataset.index);
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        applyInline("bold");
        return;
      }
      if (mod && !event.altKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        applyInline("italic");
        return;
      }
      if (mod && !event.altKey && event.key.toLowerCase() === "u") {
        event.preventDefault();
        applyInline("underline");
        return;
      }
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
      if (typeArmed && /^[1-9]$/u.test(event.key)) {
        event.preventDefault();
        const option = kindOptions()[Number(event.key) - 1];
        typeArmed = false;
        hideSuggest();
        tabWalk = null;
        if (!option) return;
        const offset = caretOffset(el);
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
        const offset = caretOffset(el);
        store.transact(() => {
          applyKind(paragraph, option.kind);
          store.caret = { index, offset };
        });
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        hideSuggest();
        const offset = caretOffset(el);
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
        const offset = caretOffset(el);
        const [left, right] = splitRuns(paragraph.runs, offset);
        const before = left.map((run) => run.text).join("");
        const atEnd = offset >= paragraphText(paragraph).length;
        const decision = enterResult(paragraph.kind, before, atEnd);
        store.transact(() => {
          if (decision.become && decision.next === null) {
            paragraph.runs = left;
            applyKind(paragraph, decision.become);
            store.caret = { index, offset: paragraphText(paragraph).length };
            return;
          }
          paragraph.runs = left;
          const nextKind = decision.next ?? "action";
          const next = makeParagraph(nextKind, "");
          next.runs = isUpperKind(nextKind) ? right.map((run) => ({ ...run, text: run.text.toUpperCase() })) : right.map((run) => ({ ...run }));
          if (
            paragraph.dualGroup !== undefined &&
            (next.kind === "dialogue" || next.kind === "parenthetical" || next.kind === "character")
          ) {
            next.dualGroup = paragraph.dualGroup;
          }
          store.script.paragraphs.splice(index + 1, 0, next);
          store.caret = { index: index + 1, offset: 0 };
        });
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        block = { start: 0, end: store.script.paragraphs.length };
        markBlock();
        return;
      }
      if (block && mod && (event.key.toLowerCase() === "c" || event.key.toLowerCase() === "x")) {
        event.preventDefault();
        const text = store.script.paragraphs
          .slice(block.start, block.end)
          .map((item) => paragraphText(item))
          .join("\n");
        void navigator.clipboard.writeText(text);
        if (event.key.toLowerCase() === "x") {
          const start = block.start;
          store.transact(() => {
            store.script.paragraphs.splice(start, block ? block.end - start : 0);
            if (store.script.paragraphs.length === 0) store.script.paragraphs.push(makeParagraph("action", ""));
            store.caret = { index: Math.min(start, store.script.paragraphs.length - 1), offset: 0 };
          });
          block = null;
        }
        return;
      }
      if (block && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        const start = block.start;
        store.transact(() => {
          store.script.paragraphs.splice(start, block ? block.end - start : 0);
          if (store.script.paragraphs.length === 0) store.script.paragraphs.push(makeParagraph("action", ""));
          store.caret = { index: Math.min(start, store.script.paragraphs.length - 1), offset: 0 };
        });
        block = null;
        return;
      }
      if (event.shiftKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const origin = blockAnchor ?? index;
        const next = index + (event.key === "ArrowDown" ? 1 : -1);
        if (next < 0 || next >= store.script.paragraphs.length) return;
        blockAnchor = origin;
        block = { start: Math.min(origin, next), end: Math.max(origin, next) + 1 };
        markBlock();
        desk.querySelector<HTMLElement>(`.paragraph[data-index="${next}"]`)?.focus();
        return;
      }
      if (mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const spans = sceneSpans(store.script);
        const at = spans.findIndex((span) => index >= span.start && index < span.end);
        const dest = spans[at + (event.key === "ArrowDown" ? 1 : -1)];
        const target = dest ? desk.querySelector<HTMLElement>(`.paragraph[data-index="${dest.start}"]`) : null;
        target?.focus();
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        event.preventDefault();
        const pages = paragraphPages(store.script);
        const current = pages[index] ?? 1;
        const wanted = event.key === "PageDown" ? current + 1 : current - 1;
        const next = pages.findIndex((page) => page === wanted);
        const target = next >= 0 ? desk.querySelector<HTMLElement>(`.paragraph[data-index="${next}"]`) : null;
        target?.focus();
        return;
      }
      const collapsed = window.getSelection()?.isCollapsed ?? true;
      if (event.key === "Backspace" && collapsed && caretOffset(el) === 0) {
        event.preventDefault();
        if (index === 0) return;
        const previous = store.script.paragraphs[index - 1];
        if (!previous) return;
        const previousLength = paragraphText(previous).length;
        store.transact(() => {
          if (paragraphText(paragraph) !== "") {
            previous.runs = joinRuns(previous.runs, paragraph.runs);
            if (isUpperKind(previous.kind)) {
              previous.runs = previous.runs.map((run) => ({ ...run, text: run.text.toUpperCase() }));
            }
          }
          if (store.script.paragraphs.length > 1) store.script.paragraphs.splice(index, 1);
          store.caret = { index: index - 1, offset: previousLength };
        });
        return;
      }
      if (event.key === "ArrowUp" && collapsed && caretOffset(el) === 0 && suggest.classList.contains("hidden")) {
        if (index === 0) return;
        event.preventDefault();
        const previous = desk.querySelector<HTMLElement>(`.paragraph[data-index="${index - 1}"]`);
        if (!previous) return;
        setCaret(previous, runsFromElement(previous).reduce((sum, run) => sum + run.text.length, 0));
        return;
      }
      if (event.key === "ArrowDown" && collapsed && suggest.classList.contains("hidden")) {
        const length = paragraphText(paragraph).length;
        if (caretOffset(el) < length) return;
        const next = desk.querySelector<HTMLElement>(`.paragraph[data-index="${index + 1}"]`);
        if (!next) return;
        event.preventDefault();
        setCaret(next, 0);
      }
    });
  };

  let omitted = new Set<number>();

  const rowFor = (index: number): HTMLElement => {
    const paragraph = store.script.paragraphs[index];
    const row = document.createElement("div");
    row.className = "row";
    if (omitted.has(index)) row.classList.add("omitted");
    if (!paragraph) return row;
    if (store.selection?.type === "paragraph" && store.selection.index === index) row.classList.add("active");
    const gutter = document.createElement("span");
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
    editable.contentEditable = "true";
    editable.spellcheck = true;
    editable.dataset.index = String(index);
    editable.dataset.testid = "paragraph";
    editable.dataset.kind = paragraph.kind;
    editable.setAttribute("role", "textbox");
    editable.setAttribute("aria-label", paragraph.kind);
    editable.innerHTML = runsToHtml(paragraph.runs);
    if (paragraphText(paragraph) === "") editable.dataset.placeholder = PLACEHOLDER[paragraph.kind] ?? "";
    if (paragraph.kind === "character") {
      editable.style.setProperty("--cue", characterColor(characterBase(paragraphText(paragraph)) || "A"));
      if (displayContd(store.script, index)) editable.dataset.contd = "1";
    }
    wire(editable);
    row.append(gutter, editable);
    if (paragraph.notes.length > 0) {
      const flag = document.createElement("button");
      flag.type = "button";
      flag.className = "note-flag";
      flag.textContent = "Note";
      const shown = (paragraph.notes[0] ?? "Script note").replace(/^\d+-\d+\|/u, "");
      flag.title = shown;
      flag.addEventListener("click", () => store.selectParagraph(index));
      const margin = document.createElement("aside");
      margin.className = "margin-note";
      margin.textContent = shown;
      row.append(flag, margin);
    }
    return row;
  };

  const renderBlock = (body: HTMLElement, indices: number[]): void => {
    let cursor = 0;
    while (cursor < indices.length) {
      const index = indices[cursor];
      const paragraph = index === undefined ? undefined : store.script.paragraphs[index];
      if (index === undefined || !paragraph) {
        cursor += 1;
        continue;
      }
      const group = paragraph.dualGroup;
      if (group === undefined) {
        body.append(rowFor(index));
        cursor += 1;
        continue;
      }
      const members: number[] = [];
      while (cursor < indices.length) {
        const candidate = indices[cursor];
        if (candidate === undefined || store.script.paragraphs[candidate]?.dualGroup !== group) break;
        members.push(candidate);
        cursor += 1;
      }
      const dual = document.createElement("div");
      dual.className = "dual";
      const speeches: number[][] = [];
      for (const member of members) {
        if (store.script.paragraphs[member]?.kind === "character" || speeches.length === 0) speeches.push([member]);
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

  const otherEditorFocused = (): boolean => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.classList.contains("paragraph") && !desk.contains(active);
  };

  const shouldPlaceCaret = (): boolean => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && desk.contains(active)) return true;
    if (otherEditorFocused()) return false;
    return document.querySelector("[data-testid='script-desk']") === desk;
  };

  const paint = (): void => {
    const placeCaret = shouldPlaceCaret();
    hideSuggest();
    omitted = new Set();
    for (const span of sceneSpans(store.script)) {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      if (assemblyOf(store.script, sceneId).status !== "omit") continue;
      for (let index = span.start; index < span.end; index += 1) omitted.add(index);
    }
    const caret = store.takeCaret();
    desk.classList.toggle("show-numbers", store.sceneNumbers);
    desk.classList.toggle("show-watermark", store.watermark);
    desk.replaceChildren();
    const pages = paragraphPages(store.script);
    const groups: number[][] = [];
    store.script.paragraphs.forEach((_, index) => {
      const page = pages[index] ?? 1;
      while (groups.length < page) groups.push([]);
      groups[page - 1]?.push(index);
    });
    if (groups.length === 0) groups.push([]);
    const title = scriptTitle(store.script);
    const marks = pageMarks(store.script);
    groups.forEach((indices, pageIndex) => {
      const sheet = document.createElement("section");
      sheet.className = "sheet";
      sheet.dataset.testid = "sheet";
      sheet.dataset.page = String(pageIndex + 1);
      if (store.watermark) sheet.dataset.watermark = (title || "FOLIO").toUpperCase();
      const head = document.createElement("div");
      head.className = "sheet-head";
      head.append(document.createElement("span"));
      const slug = head.firstElementChild;
      if (slug && pageIndex > 0) slug.textContent = title;
      const number = document.createElement("span");
      number.className = "sheet-num";
      const first = indices[0];
      if (pageIndex > 0 && first !== undefined) number.textContent = `${displayPage(store.script, first, pageIndex + 1)}.`;
      head.append(number);
      const body = document.createElement("div");
      body.className = "sheet-body";
      const mark = marks[pageIndex];
      if (mark?.continuedName) {
        const banner = document.createElement("div");
        banner.className = "contd-banner";
        banner.textContent = `${mark.continuedName} (CONT'D)`;
        body.append(banner);
      }
      renderBlock(body, indices);
      if (mark?.more) {
        const more = document.createElement("div");
        more.className = "more-line";
        more.textContent = "(MORE)";
        body.append(more);
      }
      sheet.append(head, body);
      desk.append(sheet);
    });
    if (!placeCaret) {
      if (caret) store.caret = caret;
      return;
    }
    const target = caret ?? (store.selection?.type === "paragraph" ? { index: store.selection.index, offset: 0 } : null);
    if (!target) return;
    const el = desk.querySelector<HTMLElement>(`.paragraph[data-index="${target.index}"]`);
    if (!el) return;
    if (caret) setCaret(el, caret.offset);
    else el.scrollIntoView({ block: "nearest" });
    const range = store.selection?.type === "paragraph" ? store.selection : null;
    if (range?.start !== undefined && range.end !== undefined) setRange(el, range.start, range.end);
  };

  const onStore = (event: string): void => {
    if (event === "script" || event === "view") paint();
    else if (event === "text") {
      window.clearTimeout(pageTimer);
      pageTimer = window.setTimeout(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && desk.contains(active) && active.dataset.index) {
          store.caret = { index: Number(active.dataset.index), offset: caretOffset(active) };
        }
        paint();
      }, 280);
    }
    else if (event === "chrome") {
      desk.classList.toggle("show-numbers", store.sceneNumbers);
      desk.classList.toggle("show-watermark", store.watermark);
    } else if (event === "selection" || event === "find") {
      desk.querySelectorAll(".row.active").forEach((row) => row.classList.remove("active"));
      if (store.selection?.type !== "paragraph") return;
      const el = desk.querySelector<HTMLElement>(`.paragraph[data-index="${store.selection.index}"]`);
      el?.closest(".row")?.classList.add("active");
      if (!el) return;
      if (!shouldPlaceCaret()) {
        el.scrollIntoView({ block: "nearest" });
        return;
      }
      if (store.selection.start === undefined || store.selection.end === undefined) return;
      setRange(el, store.selection.start, store.selection.end);
      el.scrollIntoView({ block: "center" });
    }
  };

  const unsubscribe = store.subscribe(onStore);
  paint();
  desk.addEventListener("scroll", hideSuggest, true);

  return () => {
    if (styleTarget === applyInline) styleTarget = null;
    unsubscribe();
    suggest.remove();
    desk.remove();
  };
}
