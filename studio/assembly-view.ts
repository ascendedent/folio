import { sceneSpans } from "../src/edit.js";
import {
  assemblyMark,
  assemblyOf,
  formatEighths,
  formatRuntime,
  sceneEighths,
  sceneIdOf,
  type CutStatus,
} from "../src/production.js";
import type { Store } from "./state.js";
import { button, choice } from "./widgets.js";

const STATUSES: CutStatus[] = ["cut", "hold", "lift", "omit"];

export function mountAssembly(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "assembly";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const spans = sceneSpans(store.script).map((span, index) => {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      const mark = assemblyOf(store.script, sceneId);
      return { span, sceneId, mark: { ...mark, order: mark.order || index } };
    });
    spans.sort((left, right) => left.mark.order - right.mark.order || left.span.start - right.span.start);
    const included = spans.filter((row) => row.mark.status !== "omit");
    const eighths = included.reduce((sum, row) => sum + sceneEighths(store.script, row.span), 0);
    const title = document.createElement("h2");
    title.textContent = "Assembly";
    const summary = document.createElement("p");
    summary.className = "report-summary";
    summary.dataset.testid = "runtime";
    summary.textContent = `${included.length} scenes in the cut · ${formatEighths(eighths)} · about ${formatRuntime(eighths)}`;
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "This order is the cut, separate from the script. Omit grays the scene on the page and drops it from the schedule builder.";
    root.append(title, summary, intro);
    spans.forEach((row, index) => {
      const line = document.createElement("article");
      line.className = `cut-row status-${row.mark.status}`;
      const heading = document.createElement("strong");
      heading.textContent = `${row.span.number || "–"}  ${row.span.heading}`;
      const length = document.createElement("span");
      length.textContent = formatEighths(sceneEighths(store.script, row.span));
      const status = choice(STATUSES, row.mark.status, (value) => {
        store.transact(() => assemblyMark(store.script, row.sceneId, { status: value as CutStatus, order: index }));
      });
      const note = document.createElement("input");
      note.value = row.mark.note;
      note.placeholder = "Editor note";
      note.addEventListener("change", () => {
        store.transact(() => assemblyMark(store.script, row.sceneId, { note: note.value, order: index }));
      });
      const move = (delta: number): void => {
        const next = spans.map((item) => item.sceneId);
        const swap = index + delta;
        const left = next[index];
        const right = next[swap];
        if (!left || !right) return;
        next[index] = right;
        next[swap] = left;
        store.transact(() => {
          next.forEach((sceneId, order) => assemblyMark(store.script, sceneId, { order }));
        });
      };
      line.append(heading, length, status, note, button("Up", () => move(-1)), button("Down", () => move(1)));
      root.append(line);
    });
  };

  const unsubscribe = store.subscribe((event) => {
    if (event === "script") paint();
  });
  paint();
  return () => {
    unsubscribe();
    root.remove();
  };
}
