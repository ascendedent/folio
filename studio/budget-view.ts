import { sceneSpans } from "../src/edit.js";
import { BUDGET_CATEGORIES, budgetByCategory, budgetTotals, lineEstimate, money, refreshCatalogBudget, sceneIdOf, uid } from "../src/production.js";
import type { Store } from "./state.js";
import { button, choice } from "./widgets.js";

export function mountBudget(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "budget";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const totals = budgetTotals(store.script);
    const title = document.createElement("h2");
    title.textContent = "Budget";
    const bar = document.createElement("div");
    bar.className = "suite-bar";
    bar.append(
      title,
      button("Refresh catalog lines", () => {
        store.transact(() => {
          const count = refreshCatalogBudget(store.script);
          store.setStatus(count ? `Updated ${count} catalog lines` : "No catalog lines on the budget yet");
        });
      }, "refresh-budget"),
    );
    const summary = document.createElement("p");
    summary.className = "report-summary";
    summary.dataset.testid = "budget-total";
    summary.textContent = `Estimate ${money(totals.estimate)} · Spent ${money(totals.actual)} · Left ${money(totals.estimate - totals.actual)}`;
    root.append(bar, summary);
    const top = document.createElement("table");
    top.className = "grid";
    top.dataset.testid = "top-sheet";
    const topHead = document.createElement("tr");
    for (const label of ["Account", "Estimate", "Spent", "Left"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      topHead.append(cell);
    }
    top.append(topHead);
    for (const row of budgetByCategory(store.script)) {
      const line = document.createElement("tr");
      for (const value of [row.category, money(row.estimate), money(row.actual), money(row.estimate - row.actual)]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        line.append(cell);
      }
      top.append(line);
    }
    root.append(top);
    const table = document.createElement("table");
    table.className = "grid";
    const head = document.createElement("tr");
    for (const label of ["Category", "Description", "Qty", "Rate", "Days", "Estimate", "Spent", "Scene", ""]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      head.append(cell);
    }
    table.append(head);
    const scenes = sceneSpans(store.script);
    for (const line of store.script.production?.budget ?? []) {
      const row = document.createElement("tr");
      const category = document.createElement("td");
      category.textContent = line.category;
      const description = document.createElement("td");
      const descriptionInput = document.createElement("input");
      descriptionInput.value = line.description;
      descriptionInput.addEventListener("change", () => {
        store.beginBurst();
        line.description = descriptionInput.value;
        store.noteText();
      });
      description.append(descriptionInput);
      const spent = document.createElement("td");
      const spentInput = document.createElement("input");
      spentInput.type = "number";
      spentInput.value = String(line.actual);
      spentInput.addEventListener("change", () => {
        store.beginBurst();
        line.actual = Number(spentInput.value) || 0;
        store.noteText();
      });
      spent.append(spentInput);
      const scene = document.createElement("td");
      const match = scenes.find((span) => sceneIdOf(store.script.paragraphs[span.start]) === line.sceneId);
      scene.textContent = match ? match.number || match.heading : "—";
      const remove = document.createElement("td");
      remove.append(
        button("Remove", () => {
          store.transact(() => {
            const production = store.script.production;
            if (production) production.budget = production.budget.filter((item) => item.id !== line.id);
          });
        }),
      );
      const cells = [String(line.quantity), money(line.rate), String(line.days), money(lineEstimate(line))];
      row.append(category, description);
      for (const value of cells) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      row.append(spent, scene, remove);
      table.append(row);
    }
    root.append(table);
    const form = document.createElement("div");
    form.className = "inline";
    const category = choice(BUDGET_CATEGORIES, "Locations", () => undefined);
    const description = document.createElement("input");
    description.placeholder = "Location fee";
    const quantity = document.createElement("input");
    quantity.type = "number";
    quantity.value = "1";
    quantity.className = "narrow";
    const rate = document.createElement("input");
    rate.type = "number";
    rate.value = "0";
    rate.placeholder = "Rate";
    rate.className = "narrow";
    const days = document.createElement("input");
    days.type = "number";
    days.value = "1";
    days.className = "narrow";
    const scene = document.createElement("select");
    const anywhere = document.createElement("option");
    anywhere.value = "";
    anywhere.textContent = "Whole show";
    scene.append(anywhere);
    for (const span of scenes) {
      const option = document.createElement("option");
      option.value = sceneIdOf(store.script.paragraphs[span.start]);
      option.textContent = `${span.number || "–"} ${span.heading}`;
      scene.append(option);
    }
    form.append(
      category,
      description,
      quantity,
      rate,
      days,
      scene,
      button("Add line", () => {
        store.transact(() => {
          store.script.production?.budget.push({
            id: uid("bd"),
            category: category.value,
            description: description.value.trim() || category.value,
            quantity: Number(quantity.value) || 1,
            rate: Number(rate.value) || 0,
            days: Number(days.value) || 1,
            actual: 0,
            sceneId: scene.value,
          });
        });
      }, "add-budget"),
    );
    root.append(form);
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
