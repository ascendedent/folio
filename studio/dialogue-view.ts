import { characterDialogue, characterNames, wordCounts } from "../src/edit.js";
import type { Store } from "./state.js";

function readVoices(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("folio.voices") || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function mountDialogue(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "report";
  root.dataset.testid = "dialogue-view";
  host.append(root);
  let name = "";

  const paint = (): void => {
    const names = characterNames(store.script);
    if (!name || !names.includes(name)) name = names[0] ?? "";
    const lines = name ? characterDialogue(store.script, name) : [];
    root.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Dialogue";
    const pick = document.createElement("select");
    pick.dataset.testid = "dialogue-name";
    for (const item of names) {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      pick.append(option);
    }
    pick.value = name;
    pick.addEventListener("change", () => {
      name = pick.value;
      paint();
    });
    const voicePick = document.createElement("select");
    voicePick.dataset.testid = "dialogue-voice";
    const voices = window.speechSynthesis?.getVoices() ?? [];
    const saved = readVoices();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Default voice";
    voicePick.append(none);
    for (const voice of voices) {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = voice.name;
      voicePick.append(option);
    }
    voicePick.value = saved[name] ?? "";
    voicePick.addEventListener("change", () => {
      const map = readVoices();
      if (voicePick.value) map[name] = voicePick.value;
      else delete map[name];
      localStorage.setItem("folio.voices", JSON.stringify(map));
    });
    const speech = document.createElement("pre");
    speech.className = "dialogue-lines";
    speech.textContent = lines.join("\n\n") || "No dialogue for this character yet.";
    const words = document.createElement("p");
    words.className = "muted";
    words.textContent = wordCounts(lines)
      .map((item) => `${item.word} ${item.count}`)
      .join(" · ");
    root.append(heading, pick, voicePick, speech, words);
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
