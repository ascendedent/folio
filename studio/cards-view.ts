import { addSceneBeat, moveScene, sceneSpans } from "../src/edit.js";
import { fitCardToText } from "../src/fdx/board.js";
import { emptyScene, type BoardCard } from "../src/model.js";
import { sceneIdOf } from "../src/production.js";
import { cardHex } from "./palette.js";
import type { Store } from "./state.js";
import { paragraphPages } from "../src/text/layout.js";

function stripe(heading: string): string {
  if (/^EXT\b/iu.test(heading)) return cardHex("Green");
  if (/^INT\b/iu.test(heading)) return cardHex("Gold");
  return cardHex("Slate");
}

export function mountCards(host: HTMLElement, store: Store): () => void {
  const scroller = document.createElement("div");
  scroller.className = "card-scroll";
  host.append(scroller);

  const paint = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && scroller.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) {
      return;
    }
    const pages = paragraphPages(store.script);
    const spans = sceneSpans(store.script);
    const cards = store.script.board?.cards ?? [];
    scroller.replaceChildren();
    const groups = document.createElement("div");
    groups.className = "card-groups";
    groups.dataset.testid = "index-cards";

    const beatCard = (card: BoardCard): HTMLElement => {
      const node = document.createElement("article");
      node.className = "index-card";
      node.dataset.testid = "index-beat";
      node.dataset.id = card.id;
      const band = document.createElement("header");
      band.style.background = cardHex(card.color);
      const title = document.createElement("input");
      title.value = card.title;
      title.placeholder = "Beat title";
      title.addEventListener("input", () => {
        store.beginBurst();
        card.title = title.value;
        store.noteText();
      });
      band.append(title);
      const body = document.createElement("textarea");
      body.value = card.body;
      body.placeholder = "What happens in this beat";
      body.addEventListener("input", () => {
        store.beginBurst();
        card.body = body.value;
        fitCardToText(card);
        store.noteText();
      });
      const tools = document.createElement("div");
      tools.className = "inline card-tools";
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "On board";
      open.addEventListener("click", () => {
        store.selection = { type: "cards", ids: [card.id] };
        store.setView("board");
      });
      const unlink = document.createElement("button");
      unlink.type = "button";
      unlink.textContent = card.sceneId ? "Unlink" : "Unlinked";
      unlink.disabled = !card.sceneId;
      unlink.addEventListener("click", () => {
        store.transact(() => {
          card.sceneId = "";
        });
      });
      tools.append(open, unlink);
      node.append(band, body, tools);
      return node;
    };

    spans.forEach((span, sceneIndex) => {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      const modules = cards.filter((card) => sceneId && card.sceneId === sceneId);
      const group = document.createElement("section");
      group.className = "card-group";
      group.dataset.scene = String(sceneIndex);
      const head = document.createElement("header");
      head.className = "card-group-head";
      head.draggable = true;
      head.style.background = stripe(span.heading);
      const label = document.createElement("button");
      label.type = "button";
      label.textContent = `${span.number || "–"}  ${span.heading || "UNTITLED SCENE"}`;
      label.addEventListener("click", () => store.reveal(span.start));
      const page = document.createElement("span");
      page.textContent = `p. ${pages[span.start] ?? 1}`;
      head.append(label, page);
      head.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", String(sceneIndex));
        group.classList.add("dragging");
      });
      head.addEventListener("dragend", () => group.classList.remove("dragging"));
      group.addEventListener("dragover", (event) => event.preventDefault());
      group.addEventListener("drop", (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData("text/plain"));
        if (Number.isNaN(from) || from === sceneIndex) return;
        store.transact(() => moveScene(store.script, from, sceneIndex));
      });
      const grid = document.createElement("div");
      grid.className = "card-grid";
      if (modules.length === 0) {
        const summary = document.createElement("textarea");
        summary.className = "index-summary";
        summary.value = span.summary;
        summary.placeholder = "Scene summary. A new beat module copies this onto the board.";
        summary.addEventListener("input", () => {
          const heading = store.script.paragraphs[span.start];
          if (!heading) return;
          store.beginBurst();
          if (!heading.scene) heading.scene = emptyScene();
          heading.scene.summary = summary.value;
          store.noteText();
        });
        const empty = document.createElement("article");
        empty.className = "index-card";
        empty.append(summary);
        grid.append(empty);
      }
      for (const card of modules) grid.append(beatCard(card));
      const create = document.createElement("button");
      create.type = "button";
      create.className = "nav-add";
      create.dataset.testid = "card-new-beat";
      create.textContent = "New beat module";
      create.addEventListener("click", () => {
        store.transact(() => addSceneBeat(store.script, sceneId));
      });
      group.append(head, grid, create);
      groups.append(group);
    });

    const loose = cards.filter((card) => !card.sceneId);
    if (loose.length > 0) {
      const group = document.createElement("section");
      group.className = "card-group";
      const head = document.createElement("header");
      head.className = "card-group-head";
      const label = document.createElement("span");
      label.textContent = "Not linked to a scene";
      head.append(label);
      const grid = document.createElement("div");
      grid.className = "card-grid";
      for (const card of loose) grid.append(beatCard(card));
      group.append(head, grid);
      groups.append(group);
    }

    if (spans.length === 0 && loose.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "Scene cards appear when the script has scene headings.";
      scroller.append(empty);
      return;
    }
    scroller.append(groups);
  };

  const unsubscribe = store.subscribe((event) => {
    if (event === "script" || event === "text") paint();
  });
  paint();
  return () => {
    unsubscribe();
    scroller.remove();
  };
}
