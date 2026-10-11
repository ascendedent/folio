import { sceneSpans } from "../src/edit.js";
import { sceneIdOf, SHOT_SIZES, uid } from "../src/production.js";
import type { StoryFrame } from "../src/production.js";
import type { Store } from "./state.js";
import { readImageFile } from "./images.js";
import { button, choice } from "./widgets.js";

function sketchPad(frame: StoryFrame, store: Store): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  canvas.className = "sketch";
  const context = canvas.getContext("2d");
  const paper = (): void => {
    if (!context) return;
    context.fillStyle = "#f7f4ec";
    context.fillRect(0, 0, canvas.width, canvas.height);
  };
  paper();
  if (frame.sketch) {
    const image = new Image();
    image.onload = () => context?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = frame.sketch;
  }
  let drawing = false;
  const point = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * canvas.width) / rect.width,
      ((event.clientY - rect.top) * canvas.height) / rect.height,
    ];
  };
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    store.beginBurst();
    const [x, y] = point(event);
    context?.beginPath();
    context?.moveTo(x, y);
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing || !context) return;
    const [x, y] = point(event);
    context.strokeStyle = "#1c1915";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineTo(x, y);
    context.stroke();
  });
  const finish = (): void => {
    if (!drawing) return;
    drawing = false;
    frame.sketch = canvas.toDataURL("image/jpeg", 0.62);
    store.noteText();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  return canvas;
}

export function mountStoryboard(host: HTMLElement, store: Store): () => void {
  const root = document.createElement("div");
  root.className = "suite";
  root.dataset.testid = "storyboard";
  host.append(root);

  const paint = (): void => {
    root.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Storyboard";
    const intro = document.createElement("p");
    intro.className = "muted";
    intro.textContent = "Frames belong to a scene. Draw the shot, then note size, angle, and what we hear.";
    root.append(title, intro);
    for (const span of sceneSpans(store.script)) {
      const sceneId = sceneIdOf(store.script.paragraphs[span.start]);
      const block = document.createElement("section");
      block.className = "board-scene";
      const heading = document.createElement("h3");
      heading.textContent = `${span.number || "–"}  ${span.heading}`;
      const strip = document.createElement("div");
      strip.className = "frame-strip";
      const frames = (store.script.production?.frames ?? [])
        .filter((frame) => frame.sceneId === sceneId)
        .sort((left, right) => left.order - right.order);
      frames.forEach((frame, index) => {
        const card = document.createElement("article");
        card.className = "frame-card";
        const canvas = sketchPad(frame, store);
        const photo = document.createElement("img");
        photo.className = "frame-photo";
        photo.alt = "";
        if (frame.image) photo.src = frame.image;
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
              frame.image = url;
            });
          });
        });
        const size = choice(SHOT_SIZES, SHOT_SIZES.includes(frame.size as (typeof SHOT_SIZES)[number]) ? frame.size : "MS", (value) => {
          store.beginBurst();
          frame.size = value;
          store.noteText();
        });
        const angle = document.createElement("input");
        angle.value = frame.angle;
        angle.placeholder = "Eye level";
        angle.addEventListener("change", () => {
          store.beginBurst();
          frame.angle = angle.value;
          store.noteText();
        });
        const description = document.createElement("textarea");
        description.value = frame.description;
        description.placeholder = "What the frame shows";
        description.addEventListener("change", () => {
          store.beginBurst();
          frame.description = description.value;
          store.noteText();
        });
        const movement = document.createElement("input");
        movement.value = frame.movement ?? "";
        movement.placeholder = "Push in, pan, handheld";
        movement.addEventListener("change", () => {
          store.beginBurst();
          frame.movement = movement.value;
          store.noteText();
        });
        const audio = document.createElement("input");
        audio.value = frame.audio;
        audio.placeholder = "Dialogue or sound";
        audio.addEventListener("change", () => {
          store.beginBurst();
          frame.audio = audio.value;
          store.noteText();
        });
        const tools = document.createElement("div");
        tools.className = "inline";
        tools.append(
          button("Upload image", () => file.click(), "upload-frame"),
          button("Clear drawing", () => {
            store.transact(() => {
              frame.sketch = "";
              frame.image = "";
            });
          }),
          button("Remove", () => {
            store.transact(() => {
              const production = store.script.production;
              if (production) production.frames = production.frames.filter((item) => item.id !== frame.id);
            });
          }),
        );
        const label = document.createElement("strong");
        label.textContent = `${index + 1}  ${frame.size}`;
        card.append(label, frame.image ? photo : canvas, file, size, angle, movement, description, audio, tools);
        strip.append(card);
      });
      block.append(
        heading,
        strip,
        button("Add frame", () => {
          store.transact(() => {
            store.script.production?.frames.push({
              id: uid("fr"),
              sceneId,
              order: frames.length,
              size: "MS",
              angle: "Eye level",
              description: "",
              audio: "",
              sketch: "",
              image: "",
              movement: "",
            });
          });
        }, "add-frame"),
      );
      root.append(block);
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
