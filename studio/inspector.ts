import { ELEMENT_MENU, sceneSpans } from "../src/edit.js";
import { emptyScene, paragraphText, type ElementKind } from "../src/model.js";
import { assemblyMark, assemblyOf, duplicateScene, sceneIdOf } from "../src/production.js";
import type { Store } from "./state.js";
import { CARD_COLORS, cardHex } from "./palette.js";

export function kindLabel(kind: ElementKind): string {
  return ELEMENT_MENU.find((item) => item.kind === kind)?.label ?? kind;
}

export function kindOptions(): { kind: ElementKind; label: string; number: number }[] {
  return ELEMENT_MENU.map((item, index) => ({
    kind: item.kind,
    number: index + 1,
    label: `${index + 1}  ${item.label}`,
  }));
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = document.createElement("span");
  name.textContent = label;
  wrap.append(name, control);
  return wrap;
}

export function mountInspector(host: HTMLElement, store: Store): void {
  const paint = (): void => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      host.contains(active) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active.isContentEditable)
    ) {
      return;
    }
    host.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Inspector";
    host.append(title);
    const selection = store.selection;
    if (selection?.type === "cards") {
      const cards = (store.script.board?.cards ?? []).filter((card) => selection.ids.includes(card.id));
      if (cards.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Select a beat card.";
        host.append(empty);
        return;
      }
      const card = cards[0];
      if (!card) return;
      const count = document.createElement("p");
      count.className = "muted";
      count.textContent = cards.length > 1 ? `${cards.length} cards selected` : "Beat card";
      host.append(count);
      const name = document.createElement("input");
      name.value = card.title;
      name.addEventListener("input", () => {
        store.beginBurst();
        card.title = name.value;
        store.noteText();
      });
      const body = document.createElement("textarea");
      body.value = card.body;
      body.addEventListener("input", () => {
        store.beginBurst();
        card.body = body.value;
        store.noteText();
      });
      host.append(field("Title", name), field("Body", body));
      const scenePick = document.createElement("select");
      scenePick.dataset.testid = "card-scene";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Not linked";
      scenePick.append(none);
      for (const span of sceneSpans(store.script)) {
        const id = sceneIdOf(store.script.paragraphs[span.start]);
        if (!id) continue;
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${span.number || "–"}  ${span.heading || "Untitled scene"}`;
        scenePick.append(option);
      }
      const shared = cards.every((item) => item.sceneId === card.sceneId) ? (card.sceneId ?? "") : "";
      scenePick.value = [...scenePick.options].some((option) => option.value === shared) ? shared : "";
      scenePick.addEventListener("change", () => {
        const sceneId = scenePick.value;
        store.transact(() => {
          for (const item of cards) item.sceneId = sceneId;
        });
      });
      host.append(field("Scene", scenePick));
      const colors = document.createElement("div");
      colors.className = "swatches";
      for (const color of CARD_COLORS) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.title = color.name;
        swatch.style.background = color.hex;
        swatch.classList.toggle("active", card.color.toLowerCase() === color.name.toLowerCase());
        swatch.addEventListener("click", () => {
          store.transact(() => {
            for (const item of cards) item.color = color.name;
          });
        });
        colors.append(swatch);
      }
      host.append(field("Color", colors));
      const where = document.createElement("p");
      where.className = "muted";
      where.textContent = `${Math.round(card.x)}, ${Math.round(card.y)} · ${cardHex(card.color)}`;
      host.append(where);
      return;
    }
    if (selection?.type === "link") {
      const copy = document.createElement("p");
      copy.textContent = `Flow ${selection.from} → ${selection.to}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove link";
      remove.addEventListener("click", () => {
        store.transact(() => {
          const board = store.script.board;
          if (!board) return;
          board.links = board.links.filter((link) => !(link.from === selection.from && link.to === selection.to));
          store.selection = null;
        });
      });
      host.append(copy, remove);
      return;
    }
    if (selection?.type !== "paragraph") {
      const copy = document.createElement("p");
      copy.className = "muted";
      copy.textContent = "Select a paragraph or a beat card.";
      host.append(copy);
      return;
    }
    const paragraph = store.script.paragraphs[selection.index];
    if (!paragraph) return;
    if (store.view === "board") {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Select a beat card to edit it. Scene beats stay in the navigator while you write.";
      host.append(hint);
      return;
    }
    const kind = document.createElement("p");
    kind.className = "kind-readout";
    kind.textContent = kindLabel(paragraph.kind);
    host.append(kind);
    if (paragraph.kind === "scene-heading") {
      const number = document.createElement("input");
      number.value = paragraph.sceneNumber ?? "";
      number.addEventListener("input", () => {
        store.beginBurst();
        paragraph.sceneNumber = number.value;
        store.noteText();
      });
      const summary = document.createElement("textarea");
      summary.value = paragraph.scene?.summary ?? "";
      summary.addEventListener("input", () => {
        store.beginBurst();
        if (!paragraph.scene) paragraph.scene = emptyScene();
        paragraph.scene.summary = summary.value;
        store.noteText();
      });
      const arcs = document.createElement("input");
      arcs.value = paragraph.scene?.arcCharacters.join(", ") ?? "";
      arcs.addEventListener("change", () => {
        store.transact(() => {
          if (!paragraph.scene) paragraph.scene = emptyScene();
          paragraph.scene.arcCharacters = arcs.value
            .split(",")
            .map((name) => name.trim().toUpperCase())
            .filter(Boolean);
        });
      });
      host.append(field("Scene number", number), field("Summary", summary), field("Character arcs", arcs));
      const sceneIndex = sceneSpans(store.script).findIndex((span) => span.start === selection.index);
      const sceneId = sceneIdOf(paragraph);
      const tools = document.createElement("div");
      tools.className = "inline";
      const duplicate = document.createElement("button");
      duplicate.type = "button";
      duplicate.textContent = "Duplicate scene";
      duplicate.addEventListener("click", () => {
        if (sceneIndex < 0) return;
        store.transact(() => {
          const at = duplicateScene(store.script, sceneIndex);
          if (at >= 0) store.caret = { index: at, offset: 0 };
        });
      });
      const omit = document.createElement("button");
      omit.type = "button";
      omit.dataset.testid = "omit-scene";
      const omitted = assemblyOf(store.script, sceneId).status === "omit";
      omit.textContent = omitted ? "Restore scene" : "Omit from cut";
      omit.addEventListener("click", () => {
        store.transact(() => assemblyMark(store.script, sceneId, { status: omitted ? "cut" : "omit" }));
      });
      tools.append(duplicate, omit);
      host.append(tools);
    }
    const note = document.createElement("textarea");
    note.value = paragraph.notes[0] ?? "";
    note.placeholder = "Script note, kept out of the printed page";
    note.addEventListener("input", () => {
      store.beginBurst();
      const text = note.value.trim();
      paragraph.notes = text ? [text] : [];
      store.noteText();
    });
    const pageBreak = document.createElement("input");
    pageBreak.type = "checkbox";
    pageBreak.checked = paragraph.startsNewPage === true;
    pageBreak.addEventListener("change", () => {
      store.transact(() => {
        paragraph.startsNewPage = pageBreak.checked;
      });
    });
    host.append(field("Note", note), field("Start a new page", pageBreak));
    if (paragraphText(paragraph).length > 80) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = `${paragraphText(paragraph).length} characters`;
      host.append(hint);
    }
  };

  store.subscribe((event) => {
    if (event === "selection" || event === "script" || event === "text" || event === "chrome") paint();
  });
  paint();
}
