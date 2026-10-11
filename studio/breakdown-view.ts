import { sceneSpans } from "../src/edit.js";
import { DEPARTMENTS, formatEighths, sceneEighths, sceneIdOf, seedCast, uid, type Department } from "../src/production.js";
import type { Store } from "./state.js";
import { button, choice } from "./widgets.js";

export function mountBreakdown(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "breakdown";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const head = document.createElement("div");
    head.className = "suite-bar";
    const title = document.createElement("h2");
    title.textContent = "Breakdown";
    head.append(
      title,
      button("Pull cast from the script", () => {
        store.transact(() => {
          const added = seedCast(store.script);
          store.setStatus(added ? `Added ${added} cast tags` : "Cast tags already match the script");
        });
      }, "seed-cast"),
    );
    root.append(head);
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "Tags stay on the scene id, so reordering or renaming the slug keeps the breakdown attached.";
    root.append(intro);
    for (const span of sceneSpans(store.script)) {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      const card = document.createElement("section");
      card.className = "break-card";
      const heading = document.createElement("h3");
      heading.textContent = `${span.number || "–"}  ${span.heading || "UNTITLED"}  ·  ${formatEighths(sceneEighths(store.script, span))}`;
      card.append(heading);
      const tags = (store.script.production?.tags ?? []).filter((tag) => tag.sceneId === sceneId);
      const list = document.createElement("div");
      list.className = "tag-list";
      for (const tag of tags) {
        const chip = document.createElement("span");
        chip.className = `tag tag-${tag.department}`;
        chip.textContent = `${tag.department}: ${tag.text}`;
        const remove = button("×", () => {
          store.transact(() => {
            const production = store.script.production;
            if (!production) return;
            production.tags = production.tags.filter((item) => item.id !== tag.id);
          });
        });
        chip.append(remove);
        list.append(chip);
      }
      const department = choice(DEPARTMENTS, "props", () => undefined);
      const input = document.createElement("input");
      input.placeholder = "Coat, rain, stunt fall";
      const add = button("Add", () => {
        const text = input.value.trim();
        if (!text || !sceneId) return;
        store.transact(() => {
          store.script.production?.tags.push({
            id: uid("tag"),
            sceneId,
            department: department.value as Department,
            text,
          });
        });
      });
      const row = document.createElement("div");
      row.className = "inline";
      row.append(department, input, add);
      card.append(list, row);
      root.append(card);
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
