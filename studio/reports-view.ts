import { characterStats, countWords, locationStats, sceneSpans, scriptBalance } from "../src/edit.js";
import { scriptTitle } from "../src/model.js";
import { layoutScript, paragraphPages } from "../src/text/layout.js";
import type { Store } from "./state.js";

function table(headers: string[], rows: string[][]): HTMLTableElement {
  const node = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const line = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      line.append(cell);
    }
    body.append(line);
  }
  node.append(head, body);
  return node;
}

export function mountReports(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "report";
  root.dataset.testid = "reports";
  host.append(root);

  const paint = (): void => {
    const pages = layoutScript(store.script);
    const pageOf = paragraphPages(store.script);
    const scenes = sceneSpans(store.script);
    const characters = characterStats(store.script);
    const locations = locationStats(store.script);
    root.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = scriptTitle(store.script) || "Untitled";
    const summary = document.createElement("p");
    summary.className = "report-summary";
    summary.textContent = `${pages.length} pages · ${scenes.length} scenes · ${countWords(store.script)} words · ${characters.length} characters`;
    const scenesHeading = document.createElement("h3");
    scenesHeading.textContent = "Scenes";
    const castHeading = document.createElement("h3");
    castHeading.textContent = "Characters";
    const placesHeading = document.createElement("h3");
    placesHeading.textContent = "Locations";
    const balanceHeading = document.createElement("h3");
    balanceHeading.textContent = "Balance";
    const lengthHeading = document.createElement("h3");
    lengthHeading.textContent = "Scene length";
    root.append(
      heading,
      summary,
      scenesHeading,
      table(
        ["#", "Page", "Heading", "Summary"],
        scenes.map((scene) => [scene.number || "—", String(pageOf[scene.start] ?? 1), scene.heading, scene.summary]),
      ),
      castHeading,
      table(
        ["Name", "Cues", "Dialogue words", "Scenes"],
        characters.map((character) => [character.name, String(character.cues), String(character.words), String(character.scenes.length)]),
      ),
      placesHeading,
      table(
        ["Location", "Scenes"],
        locations.map((location) => [location.location, String(location.scenes)]),
      ),
      balanceHeading,
      table(
        ["Kind", "Scenes"],
        scriptBalance(store.script).map((item) => [item.label, String(item.count)]),
      ),
      lengthHeading,
      table(
        ["#", "Heading", "Pages"],
        scenes.map((scene, index) => {
          const start = pageOf[scene.start] ?? 1;
          const endIndex = scenes[index + 1]?.start ?? store.script.paragraphs.length - 1;
          const end = pageOf[endIndex] ?? start;
          const pages = Math.max(1, end - start + (end === start ? 1 : 0));
          return [scene.number || "—", scene.heading, String(pages)];
        }),
      ),
      lengthChart(scenes, pageOf, store.script.paragraphs.length),
    );
  };

  function lengthChart(scenes: ReturnType<typeof sceneSpans>, pageOf: number[], total: number): HTMLElement {
    const chart = document.createElement("div");
    chart.className = "length-chart";
    const rows = scenes.map((scene, index) => {
      const start = pageOf[scene.start] ?? 1;
      const end = pageOf[scenes[index + 1]?.start ?? total - 1] ?? start;
      return { heading: scene.heading || "Untitled", pages: Math.max(1, end - start + (end === start ? 1 : 0)) };
    });
    const max = Math.max(1, ...rows.map((row) => row.pages));
    for (const row of rows) {
      const line = document.createElement("div");
      const bar = document.createElement("div");
      bar.className = "length-bar";
      bar.style.width = `${(row.pages / max) * 100}%`;
      const caption = document.createElement("span");
      caption.textContent = `${row.heading} · ${row.pages}`;
      line.append(bar, caption);
      chart.append(line);
    }
    return chart;
  }

  const unsubscribe = store.subscribe((event) => {
    if (event === "script" || event === "text") paint();
  });
  paint();
  return () => {
    unsubscribe();
    root.remove();
  };
}
