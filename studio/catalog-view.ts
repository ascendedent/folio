import { pushCatalogToBudget, renameCharacter, renameLocation, syncCatalog, uid, type CatalogItem } from "../src/production.js";
import type { Store } from "./state.js";
import { readImageFile } from "./images.js";
import { button } from "./widgets.js";

export function mountCatalog(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "catalog";
  host.append(root);

  const paint = (): void => {
    if (root.contains(document.activeElement) && document.activeElement?.tagName !== "BUTTON") return;
    root.replaceChildren();
    const bar = document.createElement("div");
    bar.className = "suite-bar";
    const title = document.createElement("h2");
    title.textContent = "Catalog";
    bar.append(
      title,
      button("Update from script", () => {
        store.transact(() => {
          const added = syncCatalog(store.script);
          store.setStatus(added ? `Added ${added} catalog items` : "Catalog already matches the script");
        });
      }, "sync-catalog"),
      button("Add item", () => {
        store.transact(() => {
          store.script.production?.catalog.push({
            id: uid("cat"),
            department: "props",
            name: "New item",
            note: "",
            image: "",
            rate: 0,
          });
        });
      }),
    );
    root.append(bar);
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "Cast, locations, and breakdown tags live here. Renaming a cast entry renames the cues in the script.";
    root.append(intro);
    const groups = new Map<string, CatalogItem[]>();
    for (const item of store.script.production?.catalog ?? []) {
      const list = groups.get(item.department) ?? [];
      list.push(item);
      groups.set(item.department, list);
    }
    for (const [department, items] of groups) {
      const heading = document.createElement("h3");
      heading.textContent = department;
      root.append(heading);
      for (const item of items) {
        const card = document.createElement("article");
        card.className = "catalog-card";
        if (item.image) {
          const photo = document.createElement("img");
          photo.src = item.image;
          photo.alt = "";
          photo.className = "frame-photo";
          card.append(photo);
        }
        const name = document.createElement("input");
        name.value = item.name;
        name.addEventListener("change", () => {
          const next = name.value.trim();
          if (!next || next === item.name) return;
          store.transact(() => {
            if (item.department === "cast") renameCharacter(store.script, item.name, next);
            else if (item.department === "location") renameLocation(store.script, item.name, next);
            item.name = next;
          });
        });
        const note = document.createElement("textarea");
        note.value = item.note;
        note.placeholder = "Description, size, source";
        note.addEventListener("change", () => {
          store.beginBurst();
          item.note = note.value;
          store.noteText();
        });
        const rate = document.createElement("input");
        rate.type = "number";
        rate.value = String(item.rate);
        rate.className = "narrow";
        rate.addEventListener("change", () => {
          store.transact(() => {
            item.rate = Number(rate.value) || 0;
            if (store.script.production?.budget.some((line) => line.catalogId === item.id)) {
              pushCatalogToBudget(store.script, item.id);
            }
          });
        });
        const file = document.createElement("input");
        file.type = "file";
        file.accept = "image/*";
        file.hidden = true;
        file.addEventListener("change", () => {
          const chosen = file.files?.[0];
          file.value = "";
          if (!chosen) return;
          void readImageFile(chosen).then((url) => {
            store.transact(() => {
              item.image = url;
            });
          });
        });
        const tools = document.createElement("div");
        tools.className = "inline";
        tools.append(
          button("Upload image", () => file.click()),
          button("Put on budget", () => {
            store.transact(() => {
              pushCatalogToBudget(store.script, item.id);
              store.setStatus(`${item.name} is on the budget for ${item.rate} a day, holds included`);
            });
          }, "put-on-budget"),
          button("Remove", () => {
            store.transact(() => {
              const production = store.script.production;
              if (production) production.catalog = production.catalog.filter((asset) => asset.id !== item.id);
            });
          }),
          file,
        );
        card.append(name, note, rate, tools);
        root.append(card);
      }
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
