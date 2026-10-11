import { makeParagraph } from "../src/edit.js";
import { paragraphText, type Paragraph } from "../src/model.js";
import type { Store } from "./state.js";

interface Lane {
  title: number;
  body: number | null;
  end: number;
}

function lanesOf(paragraphs: readonly Paragraph[]): Lane[] {
  const lanes: Lane[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (!paragraph || (paragraph.kind !== "outline-1" && paragraph.kind !== "section")) continue;
    let end = paragraphs.length;
    let body: number | null = null;
    for (let cursor = index + 1; cursor < paragraphs.length; cursor += 1) {
      const next = paragraphs[cursor];
      if (!next) break;
      if (next.kind === "outline-1" || next.kind === "section" || next.kind === "scene-heading") {
        end = cursor;
        break;
      }
      if (body === null && (next.kind === "outline-body" || next.kind === "synopsis" || next.kind === "summary")) body = cursor;
    }
    lanes.push({ title: index, body, end });
  }
  return lanes;
}

export function mountOutline(host: HTMLElement, store: Store): () => void {
  const scroller = document.createElement("div");
  scroller.className = "lanes";
  scroller.dataset.testid = "outline";
  host.append(scroller);

  const paint = (): void => {
    scroller.replaceChildren();
    const lanes = lanesOf(store.script.paragraphs);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "lane-add";
    add.textContent = "Add act";
    add.addEventListener("click", () => {
      store.transact(() => {
        const insertAt = lanes.length > 0 ? lanes[lanes.length - 1]!.end : 0;
        store.script.paragraphs.splice(
          insertAt,
          0,
          makeParagraph("outline-1", "New act"),
          makeParagraph("outline-body", ""),
        );
      });
    });
    if (lanes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "Outline lanes hold the acts. Add one, or send beat-board cards into the script.";
      scroller.append(empty, add);
      return;
    }
    for (const lane of lanes) {
      const column = document.createElement("section");
      column.className = "lane";
      const title = document.createElement("input");
      title.value = paragraphText(store.script.paragraphs[lane.title] ?? makeParagraph("outline-1"));
      title.addEventListener("input", () => {
        const paragraph = store.script.paragraphs[lane.title];
        if (!paragraph) return;
        store.beginBurst();
        paragraph.runs = [{ text: title.value }];
        store.noteText();
      });
      const body = document.createElement("textarea");
      body.placeholder = "What this act does";
      body.value = lane.body === null ? "" : paragraphText(store.script.paragraphs[lane.body]!);
      body.addEventListener("input", () => {
        store.beginBurst();
        if (lane.body === null) {
          store.script.paragraphs.splice(lane.title + 1, 0, makeParagraph("outline-body", body.value));
          lane.body = lane.title + 1;
          store.noteText();
          return;
        }
        const paragraph = store.script.paragraphs[lane.body];
        if (!paragraph) return;
        paragraph.runs = [{ text: body.value }];
        store.noteText();
      });
      column.append(title, body);
      scroller.append(column);
    }
    scroller.append(add);
  };

  const unsubscribe = store.subscribe((event) => {
    if (event === "script") paint();
  });
  paint();
  return () => {
    unsubscribe();
    scroller.remove();
  };
}
