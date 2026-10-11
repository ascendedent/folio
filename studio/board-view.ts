import { ensureBoard, fitCardToText, nextCardId } from "../src/fdx/board.js";
import { alignCards, distributeCards, sendCardsToScript, storyToBoard } from "../src/edit.js";
import type { BoardCard } from "../src/model.js";
import { cardHex, snapTo } from "./palette.js";
import type { Store } from "./state.js";

const SVG = "http://www.w3.org/2000/svg";
const camera = { x: 64, y: 56, zoom: 1 };
let fitted = false;

function curve(from: BoardCard, to: BoardCard): string {
  const fromCx = from.x + from.width / 2;
  const toCx = to.x + to.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCy = to.y + to.height / 2;
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  if (Math.abs(toCx - fromCx) >= Math.abs(toCy - fromCy)) {
    if (toCx >= fromCx) {
      x1 = from.x + from.width;
      y1 = fromCy;
      x2 = to.x;
      y2 = toCy;
    } else {
      x1 = from.x;
      y1 = fromCy;
      x2 = to.x + to.width;
      y2 = toCy;
    }
  } else if (toCy >= fromCy) {
    x1 = fromCx;
    y1 = from.y + from.height;
    x2 = toCx;
    y2 = to.y;
  } else {
    x1 = fromCx;
    y1 = from.y;
    x2 = toCx;
    y2 = to.y + to.height;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const bend = Math.max(28, length / 3);
  const ux = dx / length;
  const uy = dy / length;
  return `M ${x1} ${y1} C ${x1 + ux * bend} ${y1 + uy * bend}, ${x2 - ux * bend} ${y2 - uy * bend}, ${x2} ${y2}`;
}

export function mountBoard(host: HTMLElement, store: Store): () => void {
  const viewport = document.createElement("div");
  viewport.className = "board-viewport";
  viewport.dataset.testid = "board";
  const bar = document.createElement("div");
  bar.className = "board-bar";
  const world = document.createElement("div");
  world.className = "board-world";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "board-links");
  svg.setAttribute("width", "5200");
  svg.setAttribute("height", "3400");
  world.append(svg);
  viewport.append(bar, world);
  host.append(viewport);

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "zoom-label";

  const button = (label: string, testId: string, run: () => void): HTMLButtonElement => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.dataset.testid = testId;
    node.addEventListener("click", run);
    return node;
  };

  const selectedIds = (): string[] => (store.selection?.type === "cards" ? store.selection.ids : []);

  bar.append(
    button("New card", "board-add", () => {
      store.transact(() => {
        const board = ensureBoard(store.script);
        const id = nextCardId(board);
        const rect = viewport.getBoundingClientRect();
        board.cards.push({
          id,
          title: "New beat",
          body: "",
          x: snapTo((rect.width / 2 - camera.x) / camera.zoom - 120, true),
          y: snapTo((80 - camera.y) / camera.zoom, true),
          width: 240,
          height: 156,
          color: "Gold",
          attributes: {},
          preserved: [],
        });
        store.selection = { type: "cards", ids: [id] };
      });
    }),
    button("Link", "board-link", () => {
      store.linking = !store.linking;
      store.linkFrom = null;
      store.emit("chrome");
      paintSelection();
    }),
    button("From script", "board-from-script", () => {
      store.transact(() => {
        storyToBoard(store.script);
      });
      fit();
    }),
    button("Send to script", "board-send", () => {
      const ids = selectedIds();
      if (ids.length === 0) {
        store.setStatus("Select a card to send into the script");
        return;
      }
      store.transact(() => {
        sendCardsToScript(store.script, ids);
      });
      store.setStatus("Sent the selected beats into the script as outline");
    }),
    button("Align", "board-align", () => {
      store.transact(() => alignCards(store.script, selectedIds(), "left"));
    }),
    button("Distribute", "board-distribute", () => {
      store.transact(() => distributeCards(store.script, selectedIds(), "x"));
    }),
    button("Snap", "board-snap", () => {
      store.snap = !store.snap;
      store.emit("chrome");
    }),
    button("−", "board-zoom-out", () => {
      camera.zoom = Math.max(0.35, camera.zoom / 1.1);
      applyCamera();
    }),
    zoomLabel,
    button("+", "board-zoom-in", () => {
      camera.zoom = Math.min(1.8, camera.zoom * 1.1);
      applyCamera();
    }),
    button("Fit", "board-fit", () => fit()),
  );

  function applyCamera(): void {
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  }

  function fit(): void {
    const cards = store.script.board?.cards ?? [];
    const rect = viewport.getBoundingClientRect();
    if (cards.length === 0 || rect.width === 0) {
      camera.x = 64;
      camera.y = 56;
      camera.zoom = 1;
      applyCamera();
      return;
    }
    const minX = Math.min(...cards.map((card) => card.x));
    const minY = Math.min(...cards.map((card) => card.y));
    const maxX = Math.max(...cards.map((card) => card.x + card.width));
    const maxY = Math.max(...cards.map((card) => card.y + card.height));
    const zoom = Math.min(1.15, (rect.width - 96) / Math.max(1, maxX - minX), (rect.height - 120) / Math.max(1, maxY - minY));
    camera.zoom = Math.max(0.35, Number.isFinite(zoom) ? zoom : 1);
    camera.x = 48 - minX * camera.zoom;
    camera.y = 72 - minY * camera.zoom;
    applyCamera();
  }

  function paintLinks(): void {
    svg.replaceChildren();
    const board = store.script.board;
    if (!board) return;
    const defs = document.createElementNS(SVG, "defs");
    const marker = document.createElementNS(SVG, "marker");
    marker.setAttribute("id", "folio-arrow");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "4");
    marker.setAttribute("orient", "auto");
    const head = document.createElementNS(SVG, "path");
    head.setAttribute("d", "M 0 0 L 8 4 L 0 8 z");
    head.setAttribute("fill", "#5e5348");
    marker.append(head);
    defs.append(marker);
    svg.append(defs);
    for (const link of board.links) {
      const from = board.cards.find((card) => card.id === link.from);
      const to = board.cards.find((card) => card.id === link.to);
      if (!from || !to) continue;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", curve(from, to));
      path.setAttribute("marker-end", "url(#folio-arrow)");
      path.setAttribute("class", "board-link");
      const selected = store.selection?.type === "link" && store.selection.from === link.from && store.selection.to === link.to;
      if (selected) path.classList.add("selected");
      path.dataset.testid = "board-link";
      path.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        store.selection = { type: "link", from: link.from, to: link.to };
        store.emit("selection");
      });
      svg.append(path);
    }
  }

  function paintSelection(): void {
    const ids = new Set(selectedIds());
    world.querySelectorAll<HTMLElement>(".beat-card").forEach((node) => {
      node.classList.toggle("selected", ids.has(node.dataset.id ?? ""));
      node.classList.toggle("link-source", store.linkFrom === node.dataset.id);
    });
    bar.querySelector<HTMLButtonElement>("[data-testid=board-link]")?.setAttribute("aria-pressed", store.linking ? "true" : "false");
    bar.querySelector<HTMLButtonElement>("[data-testid=board-snap]")?.setAttribute("aria-pressed", store.snap ? "true" : "false");
    paintLinks();
  }

  function place(card: BoardCard): void {
    const node = world.querySelector<HTMLElement>(`.beat-card[data-id="${CSS.escape(card.id)}"]`);
    if (!node) return;
    node.style.left = `${card.x}px`;
    node.style.top = `${card.y}px`;
    node.style.width = `${card.width}px`;
    node.style.height = `${card.height}px`;
  }

  function renderCard(card: BoardCard): HTMLElement {
    const node = document.createElement("article");
    node.className = "beat-card";
    node.dataset.id = card.id;
    node.dataset.testid = "beat-card";
    node.style.left = `${card.x}px`;
    node.style.top = `${card.y}px`;
    node.style.width = `${card.width}px`;
    node.style.height = `${card.height}px`;
    if (card.sceneId) {
      const heading = store.script.paragraphs.find(
        (paragraph) => paragraph.kind === "scene-heading" && paragraph.attributes.FolioId === card.sceneId,
      );
      const story = heading?.scene?.attributes.FolioStory;
      if (story) node.style.boxShadow = `inset 0 0 0 3px ${story}`;
    }
    const header = document.createElement("header");
    header.textContent = card.title.trim() || card.body.trim().split("\n")[0]?.slice(0, 48) || "Beat";
    header.style.background = cardHex(card.color);
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = card.body;
    const handle = document.createElement("span");
    handle.className = "resize";
    node.append(header, body, handle);

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || header.isContentEditable || spaceDown) return;
      event.stopPropagation();
      if (store.linking) {
        event.preventDefault();
        if (!store.linkFrom || store.linkFrom === card.id) {
          store.linkFrom = store.linkFrom === card.id ? null : card.id;
          store.emit("selection");
          return;
        }
        const from = store.linkFrom;
        store.transact(() => {
          const board = ensureBoard(store.script);
          if (!board.links.some((link) => link.from === from && link.to === card.id)) {
            board.links.push({ from, to: card.id });
          }
        });
        store.linkFrom = null;
        store.linking = false;
        return;
      }
      const already = store.selection?.type === "cards" && store.selection.ids.includes(card.id);
      const ids = event.shiftKey
        ? already
          ? store.selection?.type === "cards"
            ? store.selection.ids.filter((id) => id !== card.id)
            : []
          : [...selectedIds(), card.id]
        : already
          ? selectedIds()
          : [card.id];
      store.selection = { type: "cards", ids };
      store.emit("selection");
      const origins = ids.map((id) => {
        const item = store.script.board?.cards.find((entry) => entry.id === id);
        return { id, x: item?.x ?? 0, y: item?.y ?? 0 };
      });
      store.beginBurst();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      const move = (ev: PointerEvent): void => {
        const dx = (ev.clientX - startX) / camera.zoom;
        const dy = (ev.clientY - startY) / camera.zoom;
        if (Math.hypot(dx, dy) > 3) moved = true;
        for (const origin of origins) {
          const item = store.script.board?.cards.find((entry) => entry.id === origin.id);
          if (!item) continue;
          item.x = snapTo(origin.x + dx, store.snap);
          item.y = snapTo(origin.y + dy, store.snap);
          place(item);
        }
        paintLinks();
      };
      const up = (): void => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", up);
        store.finishGesture(moved);
      };
      header.setPointerCapture(event.pointerId);
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", up);
    });
    header.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      header.contentEditable = "true";
      header.focus();
    });
    header.addEventListener("blur", () => {
      if (!header.isContentEditable) return;
      header.contentEditable = "false";
      const title = header.textContent?.trim() ?? "";
      if (title === card.title) return;
      store.beginBurst();
      card.title = title || "Untitled";
      header.textContent = card.title;
      store.noteText();
    });
    body.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      body.contentEditable = "true";
      body.focus();
    });
    body.addEventListener("blur", () => {
      if (!body.isContentEditable) return;
      body.contentEditable = "false";
      const text = body.innerText.replace(/\n$/u, "");
      if (text === card.body) return;
      store.beginBurst();
      card.body = text;
      fitCardToText(card);
      place(card);
      paintLinks();
      sizeWorld();
      store.noteText();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (spaceDown) return;
      event.stopPropagation();
      event.preventDefault();
      store.beginBurst();
      const startX = event.clientX;
      const startY = event.clientY;
      const originW = card.width;
      const originH = card.height;
      const move = (ev: PointerEvent): void => {
        card.width = Math.max(180, snapTo(originW + (ev.clientX - startX) / camera.zoom, store.snap));
        card.height = Math.max(110, snapTo(originH + (ev.clientY - startY) / camera.zoom, store.snap));
        place(card);
        paintLinks();
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        store.finishGesture(true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    return node;
  }

  function sizeWorld(): void {
    const cards = store.script.board?.cards ?? [];
    const width = Math.max(5200, ...cards.map((card) => card.x + card.width + 480), 5200);
    const height = Math.max(3400, ...cards.map((card) => card.y + card.height + 480), 3400);
    world.style.width = `${width}px`;
    world.style.height = `${height}px`;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }

  function syncCardText(): void {
    const cards = store.script.board?.cards ?? [];
    if (world.querySelectorAll(".beat-card").length !== cards.length) {
      paintCards();
      return;
    }
    let grew = false;
    for (const card of cards) {
      const node = world.querySelector<HTMLElement>(`.beat-card[data-id="${CSS.escape(card.id)}"]`);
      if (!node) {
        paintCards();
        return;
      }
      const header = node.querySelector<HTMLElement>("header");
      const body = node.querySelector<HTMLElement>(".body");
      if (header && !header.isContentEditable) {
        const label = card.title.trim() || card.body.trim().split("\n")[0]?.slice(0, 48) || "Beat";
        if (header.textContent !== label) header.textContent = label;
      }
      if (body && !body.isContentEditable && body.textContent !== card.body) {
        body.textContent = card.body;
        const before = card.height;
        fitCardToText(card);
        if (card.height !== before) grew = true;
        place(card);
      }
    }
    if (grew) {
      sizeWorld();
      paintLinks();
    }
  }

  function paintCards(): void {
    world.querySelectorAll(".beat-card, .board-empty").forEach((node) => node.remove());
    sizeWorld();
    const cards = store.script.board?.cards ?? [];
    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "board-empty";
      empty.textContent = "Empty board. Add a card, or bring the scenes and outline across.";
      world.append(empty);
    }
    for (const card of cards) world.append(renderCard(card));
    paintSelection();
    if (!fitted) {
      fitted = true;
      fit();
    }
  }

  let panning = false;
  let spaceDown = false;

  function startPan(event: PointerEvent): void {
    panning = true;
    viewport.classList.add("is-panning");
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = camera.x;
    const originY = camera.y;
    const move = (ev: PointerEvent): void => {
      camera.x = originX + ev.clientX - startX;
      camera.y = originY + ev.clientY - startY;
      applyCamera();
    };
    const up = (): void => {
      panning = false;
      viewport.classList.remove("is-panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const onSpaceDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space") return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (active.isContentEditable ||
        active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.closest(".split-bar"))
    ) {
      return;
    }
    event.preventDefault();
    if (event.repeat) return;
    spaceDown = true;
    viewport.classList.add("space-pan");
  };
  const onSpaceUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space") return;
    spaceDown = false;
    viewport.classList.remove("space-pan");
  };
  window.addEventListener("keydown", onSpaceDown);
  window.addEventListener("keyup", onSpaceUp);

  viewport.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement;
    if (spaceDown || event.button === 1 || event.altKey) {
      if (target.closest("[contenteditable='true']") || target.closest(".board-bar")) return;
      event.preventDefault();
      startPan(event);
      return;
    }
    if (target.closest(".beat-card") || target.closest(".board-bar") || target.closest(".board-link")) return;
    const rect = viewport.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const marquee = document.createElement("div");
    marquee.className = "marquee";
    viewport.append(marquee);
    let moved = false;
    const move = (ev: PointerEvent): void => {
      moved = true;
      const left = Math.min(startX, ev.clientX) - rect.left;
      const top = Math.min(startY, ev.clientY) - rect.top;
      marquee.style.left = `${left}px`;
      marquee.style.top = `${top}px`;
      marquee.style.width = `${Math.abs(ev.clientX - startX)}px`;
      marquee.style.height = `${Math.abs(ev.clientY - startY)}px`;
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      marquee.remove();
      if (!moved) {
        store.selection = null;
        store.emit("selection");
        return;
      }
      const box = {
        left: (Math.min(startX, ev.clientX) - rect.left - camera.x) / camera.zoom,
        top: (Math.min(startY, ev.clientY) - rect.top - camera.y) / camera.zoom,
        right: (Math.max(startX, ev.clientX) - rect.left - camera.x) / camera.zoom,
        bottom: (Math.max(startY, ev.clientY) - rect.top - camera.y) / camera.zoom,
      };
      const ids = (store.script.board?.cards ?? [])
        .filter((card) => card.x < box.right && card.x + card.width > box.left && card.y < box.bottom && card.y + card.height > box.top)
        .map((card) => card.id);
      store.selection = { type: "cards", ids };
      store.emit("selection");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        const next = Math.min(1.8, Math.max(0.35, camera.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
        const rect = viewport.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const worldX = (px - camera.x) / camera.zoom;
        const worldY = (py - camera.y) / camera.zoom;
        camera.zoom = next;
        camera.x = px - worldX * next;
        camera.y = py - worldY * next;
      } else if (event.shiftKey) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        camera.x -= delta;
      } else {
        camera.x -= event.deltaX;
        camera.y -= event.deltaY;
      }
      applyCamera();
    },
    { passive: false },
  );

  const unsubscribe = store.subscribe((event) => {
    if (event === "script") paintCards();
    else if (event === "text") syncCardText();
    else if (event === "selection" || event === "chrome") paintSelection();
  });
  applyCamera();
  paintCards();

  return () => {
    if (panning) panning = false;
    spaceDown = false;
    window.removeEventListener("keydown", onSpaceDown);
    window.removeEventListener("keyup", onSpaceUp);
    unsubscribe();
    viewport.remove();
  };
}
