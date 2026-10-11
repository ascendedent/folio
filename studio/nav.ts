import { addSceneBeat, characterColor, characterStats, locationStats, makeParagraph, moveScene, sceneSpans } from "../src/edit.js";
import { fitCardToText } from "../src/fdx/board.js";
import type { BoardCard } from "../src/model.js";
import { formatEighths, renameCharacter, renameLocation, sceneEighths, sceneIdOf } from "../src/production.js";
import { cardHex } from "./palette.js";
import type { Store } from "./state.js";
import { paragraphPages } from "../src/text/layout.js";

type NavTab = "scenes" | "cast" | "places" | "beats";

export function mountNav(host: HTMLElement, store: Store): void {
  let tab: NavTab = "scenes";
  let filter = "";
  const tabs = document.createElement("div");
  tabs.className = "nav-tabs";
  const filterInput = document.createElement("input");
  filterInput.className = "nav-filter";
  filterInput.placeholder = "Filter";
  filterInput.dataset.testid = "nav-filter";
  filterInput.addEventListener("input", () => {
    filter = filterInput.value;
    paint();
  });
  const list = document.createElement("div");
  list.className = "nav-list";
  list.dataset.testid = "nav-list";
  const dock = document.createElement("div");
  dock.className = "nav-beats";
  dock.dataset.testid = "nav-scene-cards";
  dock.hidden = true;
  host.append(tabs, filterInput, list, dock);
  let dockKey = "";

  const paintTabs = (): void => {
    tabs.replaceChildren();
    for (const item of [
      ["scenes", "Scenes"],
      ["beats", "Beats"],
      ["cast", "Cast"],
      ["places", "Places"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item[1];
      button.classList.toggle("active", tab === item[0]);
      button.addEventListener("click", () => {
        tab = item[0];
        paint();
      });
      tabs.append(button);
    }
  };

  const paint = (): void => {
    const scroll = list.scrollTop;
    paintTabs();
    list.replaceChildren();
    if (tab === "scenes") {
      const pages = paragraphPages(store.script);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "nav-add";
      add.textContent = "Add scene";
      add.dataset.testid = "add-scene";
      add.addEventListener("click", () => {
        store.transact(() => {
          const count = sceneSpans(store.script).length + 1;
          const heading = makeParagraph("scene-heading", "INT. LOCATION - DAY");
          heading.sceneNumber = String(count);
          store.script.paragraphs.push(heading, makeParagraph("action", ""));
          store.caret = { index: store.script.paragraphs.length - 2, offset: 0 };
          store.selection = { type: "paragraph", index: store.script.paragraphs.length - 2 };
        });
        if (store.view !== "script" && store.view !== "split") store.setView("script");
      });
      list.append(add);
      const needle = filter.trim().toUpperCase();
      sceneSpans(store.script).forEach((span, sceneIndex) => {
        if (needle && !span.heading.toUpperCase().includes(needle) && !span.number.includes(needle)) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scene-item";
        button.dataset.testid = "scene-item";
        const active = store.selection?.type === "paragraph" && store.selection.index >= span.start && store.selection.index < span.end;
        button.classList.toggle("active", active);
        const number = document.createElement("span");
        number.textContent = span.number || "–";
        const label = document.createElement("span");
        label.textContent = span.heading || "UNTITLED SCENE";
        const page = document.createElement("span");
        page.className = "scene-page";
        page.textContent = `${pages[span.start] ?? 1} · ${formatEighths(sceneEighths(store.script, span))}`;
        button.append(number, label, page);
        button.draggable = true;
        button.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", String(sceneIndex));
        });
        button.addEventListener("dragover", (event) => event.preventDefault());
        button.addEventListener("drop", (event) => {
          event.preventDefault();
          const from = Number(event.dataTransfer?.getData("text/plain"));
          if (Number.isNaN(from) || from === sceneIndex) return;
          store.transact(() => moveScene(store.script, from, sceneIndex));
        });
        button.addEventListener("click", () => store.reveal(span.start));
        const story = store.script.paragraphs[span.start]?.scene?.attributes.FolioStory;
        if (story) number.style.color = story;
        list.append(button);
      });
    } else if (tab === "beats") {
      const needle = filter.trim().toUpperCase();
      for (const span of sceneSpans(store.script)) {
        const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
        const modules = (store.script.board?.cards ?? []).filter((card) => card.sceneId === sceneId);
        const blob = [span.heading, span.number, ...modules.map((card) => `${card.title} ${card.body}`)].join(" ").toUpperCase();
        if (needle && !blob.includes(needle)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scene-item";
        button.dataset.testid = "beat-scene";
        const active = store.selection?.type === "paragraph" && store.selection.index >= span.start && store.selection.index < span.end;
        button.classList.toggle("active", active);
        const number = document.createElement("span");
        number.textContent = span.number || "–";
        const label = document.createElement("span");
        label.textContent = span.heading || "UNTITLED SCENE";
        const count = document.createElement("span");
        count.className = "scene-page";
        count.textContent = modules.length === 1 ? "1 beat" : `${modules.length} beats`;
        button.append(number, label, count);
        button.addEventListener("click", () => store.reveal(span.start));
        list.append(button);
        for (const card of modules) {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "nav-beat";
          row.dataset.testid = "beat-module";
          const line = card.title.trim() || card.body.trim().split("\n")[0] || "Beat";
          row.textContent = line.length > 72 ? `${line.slice(0, 72)}…` : line;
          row.addEventListener("click", () => store.reveal(span.start));
          list.append(row);
        }
      }
    } else if (tab === "cast") {
      for (const character of characterStats(store.script)) {
        const row = document.createElement("div");
        row.className = "scene-item";
        const swatch = document.createElement("i");
        swatch.style.background = characterColor(character.name);
        const label = document.createElement("button");
        label.type = "button";
        label.textContent = character.name;
        const meta = document.createElement("span");
        meta.className = "scene-page";
        meta.textContent = String(character.cues);
        const rename = document.createElement("input");
        rename.value = character.name;
        rename.className = "rename";
        rename.setAttribute("aria-label", `Rename ${character.name}`);
        rename.addEventListener("change", () => {
          store.transact(() => {
            renameCharacter(store.script, character.name, rename.value);
          });
          store.setStatus(`Renamed ${character.name}`);
        });
        label.addEventListener("click", () => {
          const index = store.script.paragraphs.findIndex(
            (paragraph) => paragraph.kind === "character" && paragraph.runs.some((run) => run.text.toUpperCase().includes(character.name)),
          );
          if (index >= 0) store.reveal(index);
        });
        row.append(swatch, label, meta, rename);
        list.append(row);
      }
    } else {
      for (const location of locationStats(store.script)) {
        const row = document.createElement("div");
        row.className = "scene-item";
        const label = document.createElement("button");
        label.type = "button";
        label.textContent = location.location;
        const meta = document.createElement("span");
        meta.className = "scene-page";
        meta.textContent = String(location.scenes);
        const rename = document.createElement("input");
        rename.value = location.location;
        rename.className = "rename";
        rename.setAttribute("aria-label", `Rename ${location.location}`);
        rename.addEventListener("change", () => {
          store.transact(() => {
            renameLocation(store.script, location.location, rename.value);
          });
        });
        label.addEventListener("click", () => {
          const span = sceneSpans(store.script).find((item) => item.heading.toUpperCase().includes(location.location));
          if (span) store.reveal(span.start);
        });
        row.append(label, meta, rename);
        list.append(row);
      }
    }
    list.scrollTop = scroll;
  };

  const currentScene = (): { heading: string; number: string; sceneId: string } | null => {
    const selection = store.selection;
    if (selection?.type !== "paragraph") return null;
    const span = sceneSpans(store.script).find((item) => selection.index >= item.start && selection.index < item.end);
    if (!span) return null;
    return {
      heading: span.heading,
      number: span.number,
      sceneId: sceneIdOf(store.script.paragraphs[span.start]),
    };
  };

  const paintDock = (): void => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      dock.contains(active) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    if (!store.showSceneBeat) {
      dock.hidden = true;
      dock.replaceChildren();
      dockKey = "";
      return;
    }
    const scene = currentScene();
    if (!scene) {
      dock.hidden = true;
      dock.replaceChildren();
      dockKey = "";
      return;
    }
    const modules = (store.script.board?.cards ?? []).filter((card) => scene.sceneId && card.sceneId === scene.sceneId);
    const key = `${scene.sceneId}|${modules.map((card) => `${card.id}\u0000${card.title}\u0000${card.body}\u0000${card.color}`).join("\n")}`;
    if (key === dockKey) return;
    dockKey = key;
    dock.hidden = false;
    dock.replaceChildren();
    const head = document.createElement("h3");
    head.textContent = `${scene.number || "–"}  ${scene.heading || "Scene"}`;
    dock.append(head);
    if (modules.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No beat card on this scene yet.";
      dock.append(empty);
    }
    for (const card of modules) dock.append(navBeatCard(card));
    const create = document.createElement("button");
    create.type = "button";
    create.className = "nav-add";
    create.dataset.testid = "nav-new-beat";
    create.textContent = "New beat module";
    create.addEventListener("click", () => {
      if (!scene.sceneId) return;
      store.transact(() => addSceneBeat(store.script, scene.sceneId));
    });
    dock.append(create);
  };

  const navBeatCard = (card: BoardCard): HTMLElement => {
    const node = document.createElement("article");
    node.className = "nav-beat-card";
    node.dataset.testid = "nav-beat-card";
    const header = document.createElement("header");
    header.style.background = cardHex(card.color);
    const title = document.createElement("input");
    title.value = card.title;
    title.placeholder = "Beat title";
    title.addEventListener("input", () => {
      store.beginBurst();
      card.title = title.value;
      store.noteText();
    });
    header.append(title);
    const body = document.createElement("textarea");
    body.value = card.body;
    body.placeholder = "Beat";
    body.addEventListener("input", () => {
      store.beginBurst();
      card.body = body.value;
      fitCardToText(card);
      store.noteText();
    });
    node.append(header, body);
    return node;
  };

  const render = (): void => {
    paint();
    paintDock();
  };

  store.subscribe((event) => {
    if (event === "script" || event === "text" || event === "selection" || event === "chrome") render();
  });
  render();
}
