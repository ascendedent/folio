import { dayOutOfDays, type DoodCode } from "../src/production.js";
import type { Store } from "./state.js";
import { button } from "./widgets.js";

const CATEGORIES = ["cast", "location", "props", "wardrobe", "vehicles", "sfx", "vfx", "sound", "set"];

export function mountDood(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "dood";
  host.append(root);
  let department = "cast";

  const paint = (): void => {
    const keep = root.querySelector("select");
    if (keep && document.activeElement === keep) department = keep.value;
    root.replaceChildren();
    const bar = document.createElement("div");
    bar.className = "suite-bar";
    const title = document.createElement("h2");
    title.textContent = "Day out of days";
    const category = document.createElement("select");
    category.dataset.testid = "dood-category";
    for (const name of CATEGORIES) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      category.append(option);
    }
    category.value = department;
    category.addEventListener("change", () => {
      department = category.value;
      paint();
    });
    bar.append(title, category, button("Print", () => window.print()));
    const legend = document.createElement("p");
    legend.className = "muted";
    legend.textContent = "SW start · W work · H hold, paid but not shooting · WF finish · SWF one day only. A hold between two work days is what the schedule is costing you.";
    root.append(bar, legend);
    const days = store.script.production?.days ?? [];
    if (days.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Group the schedule into shooting days first. This grid reads those days.";
      root.append(empty);
      return;
    }
    const rows = dayOutOfDays(store.script, department);
    const table = document.createElement("table");
    table.className = "grid dood";
    const head = document.createElement("tr");
    for (const label of ["Name", ...days.map((day, index) => day.label || `Day ${index + 1}`), "Work", "Hold", "Paid"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      head.append(cell);
    }
    table.append(head);
    for (const row of rows) {
      const line = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = row.name;
      line.append(name);
      row.codes.forEach((code: DoodCode) => {
        const cell = document.createElement("td");
        cell.textContent = code;
        cell.className = code ? `dood-${code.toLowerCase()}` : "";
        line.append(cell);
      });
      for (const value of [row.work, row.hold, row.paid]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        line.append(cell);
      }
      table.append(line);
    }
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = `Nothing in ${department} is on a scheduled scene yet.`;
      root.append(empty);
    }
    root.append(table);
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
