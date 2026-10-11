import type { Store } from "./state.js";

const FIELDS = ["Title", "Credit", "Author", "Source", "Draft date", "Contact"];

export function mountTitle(host: HTMLElement, store: Store): () => void {
  const desk = document.createElement("div");
  desk.className = "desk";
  host.append(desk);

  const paint = (): void => {
    desk.replaceChildren();
    const sheet = document.createElement("section");
    sheet.className = "sheet title-sheet";
    sheet.dataset.testid = "title-page";
    const form = document.createElement("div");
    form.className = "title-form";
    for (const type of FIELDS) {
      const field = store.script.titlePage.find((item) => item.type.toLowerCase() === type.toLowerCase());
      const label = document.createElement("label");
      label.textContent = type;
      const input = document.createElement(type === "Contact" ? "textarea" : "input");
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.value = field?.text ?? "";
      }
      input.addEventListener("input", () => {
        store.beginBurst();
        const value = input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.value : "";
        const existing = store.script.titlePage.find((item) => item.type.toLowerCase() === type.toLowerCase());
        if (existing) existing.text = value;
        else store.script.titlePage.push({ type, text: value });
        store.noteText();
      });
      label.append(input);
      form.append(label);
    }
    sheet.append(form);
    desk.append(sheet);
  };

  const unsubscribe = store.subscribe((event) => {
    if (event === "script") paint();
  });
  paint();
  return () => {
    unsubscribe();
    desk.remove();
  };
}
