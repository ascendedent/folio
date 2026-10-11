import { sceneSpans } from "../src/edit.js";
import { sceneIdOf } from "../src/production.js";
import type { Store } from "./state.js";

export function mountShots(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "shot-list";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Shot list";
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "Shots come from the storyboard and stay attached to the scene, including on a shooting day.";
    root.append(title, intro);
    const days = store.script.production?.days ?? [];
    const spans = sceneSpans(store.script);
    const groups = [
      { label: "All scenes", ids: spans.map((span) => sceneIdOf(store.script.paragraphs[span.start])) },
      ...days.map((day) => ({ label: day.label || "Day", ids: day.sceneIds })),
    ];
    for (const group of groups) {
      const frames = (store.script.production?.frames ?? []).filter((frame) => group.ids.includes(frame.sceneId));
      if (group.label !== "All scenes" && frames.length === 0) continue;
      const heading = document.createElement("h3");
      heading.textContent = group.label;
      const table = document.createElement("table");
      table.className = "grid";
      const head = document.createElement("tr");
      for (const label of ["Scene", "Shot", "Size", "Angle", "Movement", "Description"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        head.append(cell);
      }
      table.append(head);
      frames.forEach((frame, index) => {
        const span = spans.find((item) => sceneIdOf(store.script.paragraphs[item.start]) === frame.sceneId);
        const row = document.createElement("tr");
        for (const value of [
          span ? `${span.number || "–"} ${span.heading}` : frame.sceneId,
          String(index + 1),
          frame.size,
          frame.angle,
          frame.movement,
          frame.description,
        ]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        table.append(row);
      });
      root.append(heading, table);
    }
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
