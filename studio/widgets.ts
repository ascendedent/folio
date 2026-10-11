export function button(label: string, run: () => void, testId?: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = label;
  if (testId) node.dataset.testid = testId;
  node.addEventListener("click", run);
  return node;
}

export function labeled(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = document.createElement("span");
  name.textContent = label;
  wrap.append(name, control);
  return wrap;
}

export function choice(options: readonly string[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const node = document.createElement("select");
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    node.append(item);
  }
  node.value = value;
  node.addEventListener("change", () => onChange(node.value));
  return node;
}
