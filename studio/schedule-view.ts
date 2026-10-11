import { characterBase, sceneSpans } from "../src/edit.js";
import { paragraphText } from "../src/model.js";
import { formatEighths, sceneEighths, sceneIdOf, scheduleByLocation, splitSlug, uid } from "../src/production.js";
import type { Store } from "./state.js";
import { button } from "./widgets.js";

function stripColor(heading: string): string {
  const slug = splitSlug(heading);
  const night = slug?.time.includes("NIGHT") || slug?.time.includes("EVENING");
  if (slug?.intro.startsWith("EXT")) return night ? "#7ea2c4" : "#f4efe4";
  return night ? "#7dba8a" : "#e2c074";
}

export function mountSchedule(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "schedule";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Schedule";
    const bar = document.createElement("div");
    bar.className = "suite-bar";
    bar.append(
      title,
      button("Group by location", () => {
        store.transact(() => {
          const days = scheduleByLocation(store.script);
          store.setStatus(days ? `Added ${days} shooting days` : "Every scene is already on a day");
        });
      }, "group-days"),
      button("Add empty day", () => {
        store.transact(() => {
          const count = (store.script.production?.days.length ?? 0) + 1;
          store.script.production?.days.push({ id: uid("day"), label: `Day ${count}`, date: "", call: "07:00", notes: "", sceneIds: [] });
        });
      }),
    );
    root.append(bar);
    const spans = sceneSpans(store.script);
    const byId = new Map(spans.map((span) => [sceneIdOf(store.script.paragraphs[span.start]), span]));
    const scheduled = new Set((store.script.production?.days ?? []).flatMap((day) => day.sceneIds));
    const holding = document.createElement("section");
    holding.className = "day-card";
    const holdingTitle = document.createElement("h3");
    holdingTitle.textContent = "Not scheduled";
    holding.append(holdingTitle);
    for (const span of spans) {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      if (scheduled.has(sceneId)) continue;
      const strip = document.createElement("div");
      strip.className = "strip";
      strip.style.background = stripColor(span.heading);
      strip.textContent = `${span.number || "–"}  ${span.heading}  ·  ${formatEighths(sceneEighths(store.script, span))}`;
      holding.append(strip);
    }
    root.append(holding);
    for (const day of store.script.production?.days ?? []) {
      const card = document.createElement("section");
      card.className = "day-card call-sheet";
      const label = document.createElement("input");
      label.value = day.label;
      label.addEventListener("change", () => {
        store.beginBurst();
        day.label = label.value;
        store.noteText();
      });
      const date = document.createElement("input");
      date.type = "date";
      date.value = day.date;
      date.addEventListener("change", () => {
        store.beginBurst();
        day.date = date.value;
        store.noteText();
      });
      const call = document.createElement("input");
      call.value = day.call;
      call.className = "narrow";
      call.addEventListener("change", () => {
        store.beginBurst();
        day.call = call.value;
        store.noteText();
      });
      const head = document.createElement("div");
      head.className = "inline";
      head.append(label, date, call, button("Remove day", () => {
        store.transact(() => {
          const production = store.script.production;
          if (production) production.days = production.days.filter((item) => item.id !== day.id);
        });
      }));
      card.append(head);
      const cast = new Set<string>();
      let eighths = 0;
      for (const sceneId of day.sceneIds) {
        const span = byId.get(sceneId);
        if (!span) continue;
        eighths += sceneEighths(store.script, span);
        for (let index = span.start; index < span.end; index += 1) {
          const paragraph = store.script.paragraphs[index];
          if (paragraph?.kind === "character") {
            const name = characterBase(paragraphText(paragraph));
            if (name) cast.add(name);
          }
        }
        const strip = document.createElement("div");
        strip.className = "strip";
        strip.style.background = stripColor(span.heading);
        strip.textContent = `${span.number || "–"}  ${span.heading}  ·  ${formatEighths(sceneEighths(store.script, span))}`;
        const drop = button("Unschedule", () => {
          store.transact(() => {
            day.sceneIds = day.sceneIds.filter((id) => id !== sceneId);
          });
        });
        strip.append(drop);
        card.append(strip);
      }
      const add = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Add a scene";
      add.append(placeholder);
      for (const span of spans) {
        const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
        if (day.sceneIds.includes(sceneId)) continue;
        const option = document.createElement("option");
        option.value = sceneId;
        option.textContent = `${span.number || "–"} ${span.heading}`;
        add.append(option);
      }
      add.addEventListener("change", () => {
        if (!add.value) return;
        const sceneId = add.value;
        store.transact(() => {
          for (const other of store.script.production?.days ?? []) other.sceneIds = other.sceneIds.filter((id) => id !== sceneId);
          day.sceneIds.push(sceneId);
        });
      });
      const meta = document.createElement("p");
      meta.className = "muted";
      meta.textContent = `${formatEighths(eighths)} on the day · Call ${day.call || "—"} · Cast ${[...cast].join(", ") || "—"}`;
      const notes = document.createElement("textarea");
      notes.value = day.notes;
      notes.placeholder = "Company move, weather cover, hospital nearby";
      notes.addEventListener("change", () => {
        store.beginBurst();
        day.notes = notes.value;
        store.noteText();
      });
      card.append(meta, add, notes);
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
