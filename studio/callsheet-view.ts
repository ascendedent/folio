import { characterBase, sceneSpans } from "../src/edit.js";
import { paragraphText, scriptTitle } from "../src/model.js";
import { formatEighths, sceneEighths, sceneIdOf, splitSlug } from "../src/production.js";
import type { Store } from "./state.js";
import { button } from "./widgets.js";

export function mountCallSheets(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite calls";
  root.dataset.testid = "call-sheets";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const bar = document.createElement("div");
    bar.className = "suite-bar";
    const title = document.createElement("h2");
    title.textContent = "Call sheets";
    bar.append(
      title,
      button("Print", () => window.print()),
    );
    root.append(bar);
    const days = store.script.production?.days ?? [];
    if (days.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Schedule at least one shooting day. The call sheet is built from that day, the script, and the breakdown.";
      root.append(empty);
      return;
    }
    const spans = sceneSpans(store.script);
    const byId = new Map(spans.map((span) => [sceneIdOf(store.script.paragraphs[span.start]), span]));
    days.forEach((day, dayIndex) => {
      const paper = document.createElement("section");
      paper.className = "call-paper";
      const heading = document.createElement("h3");
      heading.textContent = scriptTitle(store.script) || "Untitled";
      const meta = document.createElement("p");
      meta.textContent = `${day.label || `Day ${dayIndex + 1}`}${day.date ? ` · ${day.date}` : ""} · General call ${day.call || "—"}`;
      paper.append(heading, meta);
      const sceneTable = document.createElement("table");
      sceneTable.className = "grid";
      const head = document.createElement("tr");
      for (const label of ["Scene", "Slug", "Eighths", "Cast"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        head.append(cell);
      }
      sceneTable.append(head);
      const cast = new Set<string>();
      const locations = new Set<string>();
      const tags: string[] = [];
      for (const sceneId of day.sceneIds) {
        const span = byId.get(sceneId);
        if (!span) continue;
        const names: string[] = [];
        for (let index = span.start; index < span.end; index += 1) {
          const paragraph = store.script.paragraphs[index];
          if (paragraph?.kind !== "character") continue;
          const name = characterBase(paragraphText(paragraph));
          if (!name) continue;
          names.push(name);
          cast.add(name);
        }
        const slug = splitSlug(span.heading);
        if (slug?.location) locations.add(slug.location);
        for (const tag of store.script.production?.tags ?? []) {
          if (tag.sceneId === sceneId && tag.department !== "cast") tags.push(`${tag.department}: ${tag.text}`);
        }
        const row = document.createElement("tr");
        for (const value of [span.number || "–", span.heading, formatEighths(sceneEighths(store.script, span)), names.join(", ")]) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.append(cell);
        }
        sceneTable.append(row);
      }
      paper.append(sceneTable);
      const people = document.createElement("p");
      people.textContent = [...cast]
        .map((name) => {
          const person = store.script.production?.people.find((item) => item.name === name);
          return person?.actor ? `${name} (${person.actor})` : name;
        })
        .join(" · ");
      const where = document.createElement("p");
      where.textContent = `Locations: ${[...locations].join(", ") || "—"}`;
      const needs = document.createElement("p");
      needs.textContent = `Needs: ${[...new Set(tags)].join(" · ") || "—"}`;
      const notes = document.createElement("p");
      notes.textContent = day.notes ? `Notes: ${day.notes}` : "Notes: —";
      paper.append(people, where, needs, notes);
      const sides = document.createElement("div");
      sides.className = "sides";
      const sidesTitle = document.createElement("h4");
      sidesTitle.textContent = "Sides";
      sides.append(sidesTitle);
      for (const sceneId of day.sceneIds) {
        const span = byId.get(sceneId);
        if (!span) continue;
        const block = document.createElement("pre");
        block.textContent = store.script.paragraphs
          .slice(span.start, span.end)
          .map((paragraph) => paragraphText(paragraph))
          .join("\n");
        sides.append(block);
      }
      paper.append(sides);
      root.append(paper);
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
