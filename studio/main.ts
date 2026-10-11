import sampleFdx from "../fixtures/kitchen.fdx?raw";
import { exportScript, type ExportFormat } from "../src/export.js";
import {
  applyKind,
  blankScript,
  countWords,
  findInScript,
  renumberScenes,
  replaceAll,
  replaceHit,
  sceneSpans,
  characterNames,
  checkFormatting,
  smartFormat,
  lockPages,
  paragraphDiff,
  templateScript,
  toggleDual,
  type FindHit,
} from "../src/edit.js";
import { readFdx } from "../src/fdx/read.js";
import { writeFdx } from "../src/fdx/write.js";
import { readFountain } from "../src/fountain/parse.js";
import { paragraphText, scriptTitle, type ElementKind } from "../src/model.js";
import { layoutScript, paragraphPages } from "../src/text/layout.js";
import { DEPARTMENTS, ensureProduction, restoreSnapshot, takeSnapshot } from "../src/production.js";
import { mountAssembly } from "./assembly-view.js";
import { mountCallSheets } from "./callsheet-view.js";
import { mountCatalog } from "./catalog-view.js";
import { mountDood } from "./dood-view.js";
import { mountBoard } from "./board-view.js";
import { mountBreakdown } from "./breakdown-view.js";
import { mountBudget } from "./budget-view.js";
import { download } from "./caret.js";
import { mountCards } from "./cards-view.js";
import { editorStyle, mountEditor } from "./editor.js";
import { kindLabel, kindOptions, mountInspector } from "./inspector.js";
import { mountNav } from "./nav.js";
import { mountOutline } from "./outline-view.js";
import { mountDialogue } from "./dialogue-view.js";
import { mountReports } from "./reports-view.js";
import { saveChrome } from "./state.js";
import { formatPdf } from "../src/text/pdf.js";
import { readDocxScript } from "../src/text/docx.js";
import { readPdfScript } from "../src/text/melt.js";
import { mountSchedule } from "./schedule-view.js";
import { createStore, type ViewId } from "./state.js";
import { mountShots } from "./shots-view.js";
import { mountStoryboard } from "./storyboard-view.js";
import { mountTitle } from "./title-view.js";

const VIEWS: { id: ViewId; label: string; test: string }[] = [
  { id: "script", label: "Script", test: "view-script" },
  { id: "board", label: "Board", test: "view-board" },
  { id: "cards", label: "Cards", test: "view-cards" },
  { id: "outline", label: "Outline", test: "view-outline" },
  { id: "title", label: "Title", test: "view-title" },
  { id: "split", label: "Split", test: "view-split" },
  { id: "reports", label: "Reports", test: "view-reports" },
];

const PRODUCTION: { id: ViewId; label: string }[] = [
  { id: "breakdown", label: "Breakdown" },
  { id: "storyboard", label: "Storyboard" },
  { id: "budget", label: "Budget" },
  { id: "schedule", label: "Schedule" },
  { id: "assembly", label: "Assembly" },
  { id: "calls", label: "Call sheets" },
  { id: "shots", label: "Shot list" },
  { id: "catalog", label: "Catalog" },
  { id: "dood", label: "Day out of days" },
  { id: "lines", label: "Dialogue" },
];

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

async function boot(): Promise<void> {
  const store = createStore();
  await store.ready;
  const app = document.createElement("div");
  app.className = "app";
  const top = document.createElement("header");
  top.className = "top";
  const brand = document.createElement("div");
  brand.className = "brand";
  const mark = document.createElement("span");
  mark.innerHTML =
    '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#c6a36b"/><path fill="#241c10" d="M8.5 6.5h15.2v4.4H13.2v2.8h8.4v4.2h-8.4v7.6H8.5z"/></svg>';
  brand.append(mark, document.createTextNode("Folio"));
  const menubar = document.createElement("nav");
  menubar.className = "menubar";
  menubar.setAttribute("aria-label", "Menus");
  const splitButton = document.createElement("button");
  splitButton.type = "button";
  splitButton.className = "top-split";
  splitButton.dataset.testid = "view-split";
  splitButton.title = "Split";
  splitButton.setAttribute("aria-label", "Split");
  splitButton.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  let viewBeforeSplit: ViewId = "script";
  splitButton.addEventListener("click", () => {
    if (store.view === "split") {
      const back = viewBeforeSplit === "split" ? "script" : viewBeforeSplit;
      store.setView(back);
      return;
    }
    viewBeforeSplit = store.view;
    store.setView("split");
  });
  top.append(brand, menubar, splitButton);
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const findbar = document.createElement("div");
  findbar.className = "findbar";
  findbar.hidden = true;
  const workspace = document.createElement("div");
  workspace.className = "workspace";
  const nav = document.createElement("aside");
  nav.className = "nav";
  const stage = document.createElement("main");
  stage.className = "stage";
  stage.dataset.testid = "stage";
  const inspector = document.createElement("aside");
  inspector.className = "inspector";
  workspace.append(nav, stage, inspector);
  const status = document.createElement("footer");
  status.className = "statusbar";
  status.dataset.testid = "status";
  app.append(top, toolbar, findbar, workspace, status);
  const modal = document.createElement("div");
  const root = document.querySelector("#app");
  root?.replaceChildren(app, modal);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".fdx,.fdxt,.fountain,.spmd,.txt";
  fileInput.hidden = true;
  app.append(fileInput);

  let destroy: (() => void) | null = null;
  let shown: ViewId | null = null;
  let findHits: FindHit[] = [];
  let findAt = 0;

  const show = (): void => {
    if (shown === store.view) return;
    shown = store.view;
    destroy?.();
    stage.replaceChildren();
    if (store.view === "script") destroy = mountEditor(stage, store);
    else if (store.view === "board") destroy = mountBoard(stage, store);
    else if (store.view === "cards") destroy = mountCards(stage, store);
    else if (store.view === "outline") destroy = mountOutline(stage, store);
    else if (store.view === "title") destroy = mountTitle(stage, store);
    else if (store.view === "reports") destroy = mountReports(stage, store);
    else if (store.view === "lines") destroy = mountDialogue(stage, store);
    else if (store.view === "breakdown") destroy = mountBreakdown(stage, store);
    else if (store.view === "storyboard") destroy = mountStoryboard(stage, store);
    else if (store.view === "budget") destroy = mountBudget(stage, store);
    else if (store.view === "schedule") destroy = mountSchedule(stage, store);
    else if (store.view === "assembly") destroy = mountAssembly(stage, store);
    else if (store.view === "calls") destroy = mountCallSheets(stage, store);
    else if (store.view === "shots") destroy = mountShots(stage, store);
    else if (store.view === "catalog") destroy = mountCatalog(stage, store);
    else if (store.view === "dood") destroy = mountDood(stage, store);
    else destroy = mountSplit(stage);
  };

  const paneViews: { id: ViewId; label: string }[] = [
    { id: "script", label: "Script" },
    { id: "board", label: "Beat board" },
    { id: "cards", label: "Cards" },
    { id: "outline", label: "Outline" },
    { id: "title", label: "Title page" },
    { id: "lines", label: "Dialogue" },
    { id: "reports", label: "Reports" },
    { id: "breakdown", label: "Breakdown" },
    { id: "storyboard", label: "Storyboard" },
    { id: "schedule", label: "Schedule" },
    { id: "budget", label: "Budget" },
    { id: "assembly", label: "Assembly" },
    { id: "calls", label: "Call sheets" },
    { id: "shots", label: "Shot list" },
    { id: "catalog", label: "Catalog" },
    { id: "dood", label: "Day out of days" },
  ];

  const mountView = (host: HTMLElement, id: ViewId): (() => void) => {
    if (id === "board") return mountBoard(host, store);
    if (id === "cards") return mountCards(host, store);
    if (id === "outline") return mountOutline(host, store);
    if (id === "title") return mountTitle(host, store);
    if (id === "lines") return mountDialogue(host, store);
    if (id === "reports") return mountReports(host, store);
    if (id === "breakdown") return mountBreakdown(host, store);
    if (id === "storyboard") return mountStoryboard(host, store);
    if (id === "schedule") return mountSchedule(host, store);
    if (id === "budget") return mountBudget(host, store);
    if (id === "assembly") return mountAssembly(host, store);
    if (id === "calls") return mountCallSheets(host, store);
    if (id === "shots") return mountShots(host, store);
    if (id === "catalog") return mountCatalog(host, store);
    if (id === "dood") return mountDood(host, store);
    return mountEditor(host, store);
  };

  const mountSplit = (host: HTMLElement): (() => void) => {
    const root = document.createElement("div");
    root.className = "split";
    const stops: (() => void)[] = [];
    const selects: HTMLSelectElement[] = [];
    const sides = ["splitLeft", "splitRight"] as const;

    const remember = (): void => {
      saveChrome(store.theme, store.zoom, {
        splitLeft: store.splitLeft,
        splitRight: store.splitRight,
        splitRatio: String(Math.round(store.splitRatio)),
      });
    };

    const panes = sides.map((key, index) => {
      const pane = document.createElement("section");
      pane.className = "split-pane";
      const bar = document.createElement("div");
      bar.className = "split-bar";
      const select = document.createElement("select");
      select.dataset.testid = key;
      select.setAttribute("aria-label", index === 0 ? "Left pane" : "Right pane");
      for (const view of paneViews) {
        const option = document.createElement("option");
        option.value = view.id;
        option.textContent = view.label;
        select.append(option);
      }
      const chosen = paneViews.some((view) => view.id === store[key]) ? store[key] : index === 0 ? "script" : "board";
      store[key] = chosen;
      select.value = chosen;
      const body = document.createElement("div");
      body.className = "split-body";
      const mount = (): void => {
        stops[index]?.();
        body.replaceChildren();
        stops[index] = mountView(body, store[key]);
      };
      select.addEventListener("change", () => {
        store[key] = select.value as ViewId;
        remember();
        mount();
        store.emit("chrome");
      });
      bar.append(select);
      pane.append(bar, body);
      selects.push(select);
      mount();
      return pane;
    });

    const applyRatio = (): void => {
      const ratio = Math.min(82, Math.max(18, store.splitRatio || 58));
      const left = panes[0];
      const right = panes[1];
      if (left) left.style.flex = `0 0 ${ratio}%`;
      if (right) right.style.flex = "1 1 0";
    };
    applyRatio();

    const gutter = document.createElement("div");
    gutter.className = "split-gutter";
    gutter.dataset.testid = "split-gutter";
    gutter.title = "Drag to resize. Double-click to swap sides.";
    gutter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const width = root.clientWidth || 1;
      const startX = event.clientX;
      const start = store.splitRatio;
      gutter.classList.add("is-drag");
      const move = (ev: PointerEvent): void => {
        store.splitRatio = Math.min(82, Math.max(18, start + ((ev.clientX - startX) / width) * 100));
        applyRatio();
      };
      const up = (): void => {
        gutter.classList.remove("is-drag");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        remember();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    gutter.addEventListener("dblclick", () => {
      const swap = store.splitLeft;
      store.splitLeft = store.splitRight;
      store.splitRight = swap;
      const leftSelect = selects[0];
      const rightSelect = selects[1];
      if (leftSelect) leftSelect.value = store.splitLeft;
      if (rightSelect) rightSelect.value = store.splitRight;
      leftSelect?.dispatchEvent(new Event("change"));
      rightSelect?.dispatchEvent(new Event("change"));
    });

    const left = panes[0];
    const right = panes[1];
    if (left && right) root.append(left, gutter, right);
    host.append(root);
    return () => {
      stops.forEach((stop) => stop());
      root.remove();
    };
  };

  const kindSelect = document.createElement("select");
  kindSelect.className = "kind";
  kindSelect.dataset.testid = "element-kind";
  kindSelect.setAttribute("aria-label", "Element type");
  for (const option of kindOptions()) {
    const item = document.createElement("option");
    item.value = option.kind;
    item.textContent = option.label;
    kindSelect.append(item);
  }
  kindSelect.addEventListener("change", () => {
    if (store.selection?.type !== "paragraph") return;
    const index = store.selection.index;
    const kind = kindSelect.value as ElementKind;
    store.transact(() => {
      const paragraph = store.script.paragraphs[index];
      if (!paragraph) return;
      applyKind(paragraph, kind);
      store.caret = { index, offset: paragraphText(paragraph).length };
    });
  });

  const toolButton = (label: string, run: () => void, testId?: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (testId) button.dataset.testid = testId;
    if (testId?.startsWith("style-")) button.dataset.writing = "1";
    button.addEventListener("click", run);
    return button;
  };

  const fdxName = (): string =>
    store.fileName.toLowerCase().endsWith(".fdx") ? store.fileName : `${store.fileName.replace(/\.[^.]+$/u, "")}.fdx`;

  let fileHandle: FileSystemFileHandle | null = null;

  const saveFolder = (): string => {
    try {
      const parsed = JSON.parse(localStorage.getItem("folio.chrome.v1") || "{}") as Record<string, string>;
      return parsed.saveDir || "";
    } catch {
      return "";
    }
  };

  const chooseSaveFolder = async (): Promise<void> => {
    const bridge = nativeBridge();
    if (!bridge) {
      store.setStatus("The save folder can be set from the Folio app.");
      return;
    }
    const result = await bridge.postMessage({ action: "choose-folder", folder: saveFolder() });
    if (!result?.ok || !result.path) return;
    saveChrome(store.theme, store.zoom, { saveDir: result.path });
    store.setStatus(`New scripts save in ${result.path}`);
  };

  type RecentFile = { name: string; path: string };

  const recentFiles = (): RecentFile[] => {
    try {
      const parsed = JSON.parse(localStorage.getItem("folio.recent.v1") || "[]") as RecentFile[];
      return parsed.filter((item) => item.name && item.path);
    } catch {
      return [];
    }
  };

  const openDir = (): string => {
    try {
      const parsed = JSON.parse(localStorage.getItem("folio.chrome.v1") || "{}") as Record<string, string>;
      return parsed.openDir || "";
    } catch {
      return "";
    }
  };

  const rememberRecent = (name: string, path: string): void => {
    const next = [{ name, path }, ...recentFiles().filter((item) => item.path !== path)].slice(0, 8);
    localStorage.setItem("folio.recent.v1", JSON.stringify(next));
    const folder = path.replace(/[/][^/]+$/u, "");
    if (folder) saveChrome(store.theme, store.zoom, { openDir: folder });
  };

  const nativeBridge = (): { postMessage: (body: unknown) => Promise<{ ok?: boolean; name?: string; path?: string; text?: string }> } | null => {
    const handler = window.webkit?.messageHandlers?.folio;
    if (!handler) return null;
    return handler;
  };

  const rememberedPath = (name: string, saveAs: boolean): string => {
    if (saveAs) return "";
    if (store.filePath) return store.filePath;
    try {
      const recent = JSON.parse(localStorage.getItem("folio.recent.v1") || "[]") as { name: string; path: string }[];
      return recent.find((item) => item.name === name)?.path ?? "";
    } catch {
      return "";
    }
  };

  const saveFdx = async (saveAs = false): Promise<void> => {
    const name = fdxName();
    const xml = writeFdx(store.script);
    const bridge = nativeBridge();
    if (bridge) {
      const result = await bridge.postMessage({
        action: saveAs ? "save-as" : "save",
        name,
        xml,
        path: rememberedPath(name, saveAs),
        folder: saveFolder(),
      });
      if (!result?.ok || !result.path || !result.name) return;
      store.filePath = result.path;
      store.fileName = result.name;
      rememberRecent(result.name, result.path);
      store.markSaved(`Saved ${result.path}`);
      return;
    }
    const picker = window.showSaveFilePicker;
    if (picker) {
      try {
        if (saveAs || !fileHandle) {
          fileHandle = await picker({
            suggestedName: name,
            types: [{ description: "Final Draft", accept: { "application/xml": [".fdx"] } }],
          });
        }
        const writable = await fileHandle.createWritable();
        await writable.write(xml);
        await writable.close();
        store.fileName = fileHandle.name;
        store.markSaved(`Saved ${fileHandle.name}`);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        store.setStatus(error instanceof Error ? error.message : "Could not save.");
      }
      return;
    }
    download(name, xml, "application/xml");
    store.setStatus(`Downloaded ${name}. Save stays unsaved until the file is written.`);
  };

  const exportAs = (format: ExportFormat): void => {
    const result = exportScript(store.script, format);
    const extension = format === "fountain" ? "fountain" : format === "rtf" ? "rtf" : "txt";
    const base = store.fileName.replace(/\.[^.]+$/u, "");
    download(`${base}.${extension}`, result.text, "text/plain");
    store.setStatus(result.warnings[0] ?? `Downloaded ${base}.${extension}`);
  };

  const openText = (name: string, text: string, path = ""): void => {
    const lower = name.toLowerCase();
    const script = lower.endsWith(".fdx") || lower.endsWith(".fdxt") ? readFdx(text) : readFountain(text);
    store.filePath = path;
    fileHandle = null;
    store.replace(script, name);
    if (path) rememberRecent(name, path);
    store.setStatus(path ? `Opened ${path}` : `Opened ${name}`);
  };

  const openFile = async (): Promise<void> => {
    if (!confirmReplace("Open a screenplay? This replaces the open draft.")) return;
    const bridge = nativeBridge();
    if (bridge) {
      try {
        const result = await bridge.postMessage({ action: "open", folder: openDir() || saveFolder() });
        if (!result?.ok || !result.name || result.text === undefined) return;
        openText(result.name, result.text, result.path ?? "");
      } catch (error) {
        store.setStatus(error instanceof Error ? error.message : "Could not open that file.");
      }
      return;
    }
    const picker = window.showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          types: [{ description: "Screenplay", accept: { "application/xml": [".fdx", ".fdxt"], "text/plain": [".fountain", ".txt"] } }],
        });
        fileHandle = handle.name.toLowerCase().endsWith(".fdx") ? handle : null;
        openText(handle.name, await (await handle.getFile()).text());
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        store.setStatus(error instanceof Error ? error.message : "Could not open that file.");
      }
      return;
    }
    fileInput.click();
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      openText(file.name, await file.text());
    } catch (error) {
      store.setStatus(error instanceof Error ? error.message : "Could not open that file.");
    }
  });

  const confirmReplace = (message: string): boolean => !store.dirty || window.confirm(message);

  const newScript = (): void => {
    if (!confirmReplace("Start a new screenplay? This replaces the open draft.")) return;
    store.filePath = "";
    fileHandle = null;
    store.replace(blankScript(), "Untitled.fdx");
    store.setStatus("New screenplay");
  };

  const openSample = (): void => {
    if (!confirmReplace("Open the sample? This replaces the open draft.")) return;
    store.filePath = "";
    fileHandle = null;
    store.replace(readFdx(sampleFdx), "Kitchen Letter.fdx");
    store.setStatus("Sample screenplay");
  };

  const openTemplate = (kind: "tv" | "multicam" | "stage"): void => {
    if (!confirmReplace("Open a template? This replaces the open draft.")) return;
    store.filePath = "";
    fileHandle = null;
    store.replace(templateScript(kind), kind === "stage" ? "Play.fdx" : "Episode.fdx");
    store.setStatus(`Opened the ${kind} template`);
  };

  const exportPdf = (): void => {
    const bytes = formatPdf(store.script, { watermark: store.watermark ? scriptTitle(store.script) || "FOLIO" : "" });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fdxName().replace(/\.fdx$/iu, ".pdf");
    link.click();
    URL.revokeObjectURL(url);
    store.setStatus("Downloaded the PDF");
  };

  const importDocx = (): void => {
    if (!confirmReplace("Import a Word file? This replaces the open draft.")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async (buffer) => {
        const script = await readDocxScript(new Uint8Array(buffer));
        store.filePath = "";
        fileHandle = null;
        store.replace(script, file.name.replace(/\.docx$/iu, ".fdx"));
        store.setStatus(`Imported ${file.name}`);
      });
    });
    input.click();
  };

  const importPdf = (): void => {
    if (!confirmReplace("Import a PDF? This replaces the open draft.")) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,application/pdf";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async (buffer) => {
        const script = await readPdfScript(new Uint8Array(buffer));
        store.replace(script, file.name.replace(/\.pdf$/iu, ".fdx"));
        store.setStatus(`Imported ${file.name}`);
      });
    });
    input.click();
  };

  const compareDraft = (): void => {
    const snapshots = ensureProduction(store.script).snapshots;
    if (snapshots.length === 0) {
      store.setStatus("Save a checkpoint before comparing.");
      return;
    }
    const older = document.createElement("select");
    const newer = document.createElement("select");
    for (const snapshot of snapshots) {
      for (const pick of [older, newer]) {
        const option = document.createElement("option");
        option.value = snapshot.id;
        option.textContent = snapshot.name;
        pick.append(option);
      }
    }
    older.value = snapshots[1]?.id ?? snapshots[0]?.id ?? "";
    newer.value = snapshots[0]?.id ?? "";
    const render = (): void => {
      const left = snapshots.find((item) => item.id === older.value) ?? snapshots[0];
      const right = snapshots.find((item) => item.id === newer.value) ?? snapshots[0];
      const rows = paragraphDiff(
        (left?.script.paragraphs ?? []).map((paragraph) => paragraphText(paragraph)),
        newer.value === "current"
          ? store.script.paragraphs.map((paragraph) => paragraphText(paragraph))
          : (right?.script.paragraphs ?? store.script.paragraphs).map((paragraph) => paragraphText(paragraph)),
      ).filter((row) => row.kind !== "same");
      body.replaceChildren();
      if (rows.length === 0) {
        const same = document.createElement("p");
        same.textContent = "Those two drafts match.";
        body.append(same);
      }
      for (const row of rows.slice(0, 80)) {
        const line = document.createElement("p");
        line.className = row.kind === "cut" ? "diff-cut" : "diff-add";
        line.textContent = row.text;
        body.append(line);
      }
    };
    const current = document.createElement("option");
    current.value = "current";
    current.textContent = "Current draft";
    newer.append(current);
    newer.value = "current";
    older.addEventListener("change", render);
    newer.addEventListener("change", render);
    modal.replaceChildren();
    const back = document.createElement("div");
    back.className = "modal-back";
    const panel = document.createElement("div");
    panel.className = "modal";
    const heading = document.createElement("h2");
    heading.textContent = "Compare drafts";
    const picks = document.createElement("div");
    picks.className = "inline";
    picks.append(older, newer);
    const body = document.createElement("div");
    body.className = "modal-body";
    render();
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => modal.replaceChildren());
    panel.append(heading, picks, body, close);
    back.append(panel);
    back.addEventListener("click", (event) => {
      if (event.target === back) modal.replaceChildren();
    });
    modal.append(back);
  };

  const tagSelection = (): void => {
    const selection = store.selection;
    if (selection?.type !== "paragraph" || selection.start === undefined || selection.end === undefined) {
      store.setStatus("Select words in a line, then tag them.");
      return;
    }
    const paragraph = store.script.paragraphs[selection.index];
    const text = paragraph ? paragraphText(paragraph).slice(selection.start, selection.end).trim() : "";
    if (!text) return;
    const span = sceneSpans(store.script).find((item) => selection.index >= item.start && selection.index < item.end);
    const sceneId = span ? (store.script.paragraphs[span.start]?.attributes.FolioId ?? "") : "";
    const department = window.prompt(`Department (${DEPARTMENTS.join(", ")})`, "props")?.trim().toLowerCase() ?? "";
    if (!DEPARTMENTS.includes(department as (typeof DEPARTMENTS)[number])) {
      store.setStatus("Pick a department such as props, cast, or wardrobe.");
      return;
    }
    store.transact(() => {
      ensureProduction(store.script).tags.push({
        id: `tag-${Date.now().toString(36)}`,
        sceneId,
        department: department as (typeof DEPARTMENTS)[number],
        text,
      });
    });
    store.setStatus(`Tagged “${text}” as ${department}`);
  };

  const commentSelection = (): void => {
    const selection = store.selection;
    if (selection?.type !== "paragraph") return;
    const note = window.prompt("Comment") ?? "";
    if (!note.trim()) return;
    const paragraph = store.script.paragraphs[selection.index];
    if (!paragraph) return;
    const text =
      selection.start !== undefined && selection.end !== undefined
        ? `${selection.start}-${selection.end}|${note.trim()}`
        : note.trim();
    store.transact(() => {
      paragraph.notes.push(text);
    });
  };

  const cycleStoryline = (): void => {
    const selection = store.selection;
    if (selection?.type !== "paragraph") return;
    const span = sceneSpans(store.script).find((item) => selection.index >= item.start && selection.index < item.end);
    const heading = span ? store.script.paragraphs[span.start] : undefined;
    if (!heading?.scene) return;
    const colors = ["", "#c6a36b", "#7ea2c4", "#7dba8a", "#d48b8b", "#b7a3c9"];
    const current = heading.scene.attributes.FolioStory ?? "";
    const next = colors[(colors.indexOf(current) + 1) % colors.length] ?? "";
    store.transact(() => {
      if (next) heading.scene!.attributes.FolioStory = next;
      else delete heading.scene!.attributes.FolioStory;
    });
  };

  let reading = false;
  const tableRead = (): void => {
    if (reading || speechSynthesis.speaking) {
      reading = false;
      speechSynthesis.cancel();
      store.setStatus("Table read stopped");
      return;
    }
    reading = true;
    const voices = speechSynthesis.getVoices();
    let index = 0;
    const step = (): void => {
      if (!reading) return;
      while (index < store.script.paragraphs.length) {
        const paragraph = store.script.paragraphs[index];
        index += 1;
        if (!paragraph || (paragraph.kind !== "dialogue" && paragraph.kind !== "action")) continue;
        const utter = new SpeechSynthesisUtterance(paragraphText(paragraph));
        if (paragraph.kind === "dialogue") {
          let cueName = "";
          for (let cursor = index - 2; cursor >= 0; cursor -= 1) {
            const cue = store.script.paragraphs[cursor];
            if (cue?.kind === "character") {
              cueName = paragraphText(cue);
              break;
            }
          }
          let saved = "";
          try {
            saved = (JSON.parse(localStorage.getItem("folio.voices") || "{}") as Record<string, string>)[cueName] ?? "";
          } catch {
            saved = "";
          }
          const voice = voices.find((item) => item.voiceURI === saved) ?? voices[cueName.length % Math.max(1, voices.length)];
          if (voice) utter.voice = voice;
        }
        utter.onend = step;
        speechSynthesis.speak(utter);
        store.setStatus("Table read");
        return;
      }
      reading = false;
      store.setStatus("Table read finished");
    };
    step();
  };

  let sprintTimer = 0;
  const startSprint = (): void => {
    window.clearInterval(sprintTimer);
    const end = Date.now() + 25 * 60 * 1000;
    store.setStatus("25-minute sprint started");
    sprintTimer = window.setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) {
        window.clearInterval(sprintTimer);
        store.setStatus("Sprint finished");
        return;
      }
      store.setStatus(`Sprint ${Math.ceil(left / 60000)} min left`);
    }, 15000);
  };

  const openPalette = (): void => {
    const commands: { label: string; run: () => void }[] = [
      ...VIEWS.map((view) => ({ label: `View ${view.label}`, run: () => store.setView(view.id) })),
      ...PRODUCTION.map((view) => ({ label: `View ${view.label}`, run: () => store.setView(view.id) })),
      { label: "Save", run: () => void saveFdx(false) },
      { label: "Check formatting", run: () => menus[0] && undefined },
      ...sceneSpans(store.script).map((span) => ({
        label: `Scene ${span.number || "—"} ${span.heading}`,
        run: () => store.reveal(span.start),
      })),
      ...characterNames(store.script).map((name) => ({
        label: `Character ${name}`,
        run: () => store.setView("lines"),
      })),
    ];
    commands.splice(commands.findIndex((item) => item.label === "Check formatting"), 1);
    modal.replaceChildren();
    const back = document.createElement("div");
    back.className = "modal-back";
    const panel = document.createElement("div");
    panel.className = "modal";
    const input = document.createElement("input");
    input.placeholder = "Go to a scene, view, or command";
    input.dataset.testid = "palette";
    const body = document.createElement("div");
    body.className = "modal-body";
    const render = (): void => {
      const needle = input.value.trim().toLowerCase();
      body.replaceChildren();
      for (const command of commands.filter((item) => item.label.toLowerCase().includes(needle)).slice(0, 12)) {
        const row = document.createElement("button");
        row.type = "button";
        row.textContent = command.label;
        row.addEventListener("click", () => {
          modal.replaceChildren();
          command.run();
        });
        body.append(row);
      }
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const first = body.querySelector("button");
        if (first instanceof HTMLButtonElement) first.click();
      }
    });
    panel.append(input, body);
    back.append(panel);
    back.addEventListener("click", (event) => {
      if (event.target === back) modal.replaceChildren();
    });
    modal.append(back);
    render();
    input.focus();
  };

  const openRecent = async (item: RecentFile): Promise<void> => {
    if (!confirmReplace(`Open ${item.name}? This replaces the open draft.`)) return;
    const bridge = nativeBridge();
    if (!bridge) {
      store.setStatus("Recent files open from the Folio app.");
      return;
    }
    try {
      const result = await bridge.postMessage({ action: "open-path", path: item.path });
      if (!result?.ok || !result.name || result.text === undefined) {
        store.setStatus(`Could not open ${item.path}`);
        return;
      }
      openText(result.name, result.text, result.path ?? item.path);
    } catch (error) {
      store.setStatus(error instanceof Error ? error.message : "Could not open that file.");
    }
  };

  const welcome = (): void => {
    if (store.fileName !== "Kitchen Letter.fdx" || store.filePath) return;
    modal.replaceChildren();
    const back = document.createElement("div");
    back.className = "modal-back";
    const panel = document.createElement("div");
    panel.className = "modal";
    const heading = document.createElement("h2");
    heading.textContent = "Folio";
    const body = document.createElement("div");
    body.className = "modal-body";
    const copy = document.createElement("p");
    copy.textContent = "Tab changes the line type. Shift+Tab then a number picks one. Enter starts the next element. Ctrl+K opens every command.";
    body.append(copy);
    for (const [label, run] of [
      ["New screenplay", newScript],
      ["Open", () => void openFile()],
      ["Sample", openSample],
      ["TV template", () => openTemplate("tv")],
    ] as const) {
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = label;
      row.addEventListener("click", () => {
        modal.replaceChildren();
        run();
      });
      body.append(row);
    }
    const recent = recentFiles();
    if (recent.length > 0) {
      const label = document.createElement("p");
      label.textContent = "Recent";
      body.append(label);
      for (const item of recent) {
        const row = document.createElement("button");
        row.type = "button";
        row.textContent = item.name;
        row.addEventListener("click", () => {
          modal.replaceChildren();
          void openRecent(item);
        });
        body.append(row);
      }
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Keep the sample";
    close.addEventListener("click", () => modal.replaceChildren());
    panel.append(heading, body, close);
    back.append(panel);
    modal.append(back);
  };

  const deleteBoardSelection = (): void => {
    if (store.selection?.type === "cards") {
      const ids = new Set(store.selection.ids);
      store.transact(() => {
        const board = store.script.board;
        if (!board) return;
        board.cards = board.cards.filter((card) => !ids.has(card.id));
        board.links = board.links.filter((link) => !ids.has(link.from) && !ids.has(link.to));
        store.selection = null;
      });
      return;
    }
    if (store.selection?.type === "link") {
      const chosen = store.selection;
      store.transact(() => {
        const board = store.script.board;
        if (!board) return;
        board.links = board.links.filter((link) => !(link.from === chosen.from && link.to === chosen.to));
        store.selection = null;
      });
    }
  };

  const findQuery = document.createElement("input");
  findQuery.type = "search";
  findQuery.placeholder = "Find";
  findQuery.dataset.testid = "find-query";
  const findReplace = document.createElement("input");
  findReplace.type = "text";
  findReplace.placeholder = "Replace";
  const findCount = document.createElement("span");
  findCount.className = "find-count";
  const refreshFind = (): void => {
    findHits = findInScript(store.script, findQuery.value);
    if (findAt >= findHits.length) findAt = 0;
    findCount.textContent = findHits.length === 0 ? "No matches" : `${findAt + 1} of ${findHits.length}`;
  };
  const revealHit = (): void => {
    const hit = findHits[findAt];
    if (!hit) return;
    if (store.view !== "script" && store.view !== "split") store.setView("script");
    store.selectParagraph(hit.index, { start: hit.start, end: hit.end });
    store.emit("find");
    findCount.textContent = `${findAt + 1} of ${findHits.length}`;
  };
  const stepFind = (delta: number): void => {
    refreshFind();
    if (findHits.length === 0) return;
    findAt = (findAt + delta + findHits.length) % findHits.length;
    revealHit();
  };
  findQuery.addEventListener("input", () => {
    findAt = 0;
    refreshFind();
    if (findHits.length > 0) revealHit();
  });
  findQuery.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stepFind(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  });

  // Closing the bar puts the caret on the current match, so typing carries on in the script.
  const closeFind = (): void => {
    findbar.hidden = true;
    app.classList.remove("find-open");
    const active = document.activeElement;
    if (active instanceof HTMLElement && findbar.contains(active)) active.blur();
    if (store.selection?.type === "paragraph" && store.selection.start !== undefined) store.emit("find");
  };

  const openFind = (): void => {
    findbar.hidden = false;
    app.classList.add("find-open");
    findQuery.focus();
    findQuery.select();
    refreshFind();
  };

  findbar.append(
    findQuery,
    toolButton("Previous", () => stepFind(-1)),
    toolButton("Next", () => stepFind(1), "find-next"),
    findReplace,
    toolButton("Replace", () => {
      const hit = findHits[findAt];
      if (!hit) return;
      store.transact(() => replaceHit(store.script, hit, findReplace.value));
      refreshFind();
      revealHit();
    }),
    toolButton("All", () => {
      if (!findQuery.value.trim() || findInScript(store.script, findQuery.value).length === 0) {
        store.setStatus("No matches");
        refreshFind();
        return;
      }
      let count = 0;
      store.transact(() => {
        count = replaceAll(store.script, findQuery.value, findReplace.value);
      });
      store.setStatus(`Replaced ${count}`);
      refreshFind();
    }),
    findCount,
    toolButton("Close", closeFind),
  );

  const openModal = (title: string, lines: string[]): void => {
    modal.replaceChildren();
    const back = document.createElement("div");
    back.className = "modal-back";
    const panel = document.createElement("div");
    panel.className = "modal";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const body = document.createElement("div");
    body.className = "modal-body";
    for (const line of lines) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      body.append(paragraph);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => modal.replaceChildren());
    back.addEventListener("click", (event) => {
      if (event.target === back) modal.replaceChildren();
    });
    panel.append(heading, body, close);
    back.append(panel);
    modal.append(back);
  };

  const showCheckpoints = (): void => {
    const snapshots = ensureProduction(store.script).snapshots;
    modal.replaceChildren();
    const back = document.createElement("div");
    back.className = "modal-back";
    const panel = document.createElement("div");
    panel.className = "modal";
    const heading = document.createElement("h2");
    heading.textContent = "Checkpoints";
    const body = document.createElement("div");
    body.className = "modal-body";
    if (snapshots.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No checkpoints yet. Save one from the File menu before a big rewrite.";
      body.append(empty);
    }
    for (const snapshot of snapshots) {
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = `${snapshot.name} · ${new Date(snapshot.savedAt).toLocaleString()}`;
      row.addEventListener("click", () => {
        if (!window.confirm(`Restore “${snapshot.name}”? The draft you have open is kept as a checkpoint.`)) return;
        takeSnapshot(store.script, "Before restore");
        const next = restoreSnapshot(store.script, snapshot.id);
        if (!next) return;
        store.replace(next, store.fileName);
        store.setStatus(`Restored ${snapshot.name}`);
        modal.replaceChildren();
      });
      body.append(row);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => modal.replaceChildren());
    back.addEventListener("click", (event) => {
      if (event.target === back) modal.replaceChildren();
    });
    panel.append(heading, body, close);
    back.append(panel);
    modal.append(back);
  };

  type Item =
    | { label: string; shortcut?: string; title?: string; mark?: () => boolean; run: () => void }
    | { label: string; items: Item[] | (() => Item[]) }
    | { separator: true };
  const menus: { label: string; items: Item[] }[] = [
    {
      label: "File",
      items: [
        { label: "New", shortcut: "Ctrl+N", run: newScript },
        { label: "Open…", shortcut: "Ctrl+O", run: openFile },
        {
          label: "Open Recent",
          items: () =>
            recentFiles().map((file) => ({
              label: file.name,
              title: file.path,
              run: () => void openRecent(file),
            })),
        },
        { label: "Open Sample", run: openSample },
        { separator: true },
        {
          label: "Save Checkpoint",
          run: () => {
            const name = window.prompt("Checkpoint name", "Checkpoint") ?? "";
            if (!name.trim()) return;
            store.transact(() => {
              takeSnapshot(store.script, name.trim());
            });
            store.setStatus(`Saved checkpoint “${name.trim()}”`);
          },
        },
        {
          label: "Restore Checkpoint",
          run: () => showCheckpoints(),
        },
        { separator: true },
        { label: "Save FDX", shortcut: "Ctrl+S", run: () => void saveFdx(false) },
        { label: "Save As…", run: () => void saveFdx(true) },
        { label: "Save folder for new scripts…", run: () => void chooseSaveFolder() },
        {
          label: "Export",
          items: [
            { label: "Fountain", run: () => exportAs("fountain") },
            { label: "Formatted text", run: () => exportAs("text") },
            { label: "RTF", run: () => exportAs("rtf") },
          ],
        },
        { label: "Export PDF", run: () => exportPdf() },
        { label: "Import PDF", run: () => importPdf() },
        { label: "Import Word", run: () => importDocx() },
        { separator: true },
        { label: "TV template", run: () => openTemplate("tv") },
        { label: "Multi-cam template", run: () => openTemplate("multicam") },
        { label: "Stage template", run: () => openTemplate("stage") },
        { label: "Compare with checkpoint", run: () => compareDraft() },
        { separator: true },
        { label: "Print", shortcut: "Ctrl+P", run: () => window.print() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", run: () => store.undo() },
        { label: "Redo", shortcut: "Ctrl+Shift+Z", run: () => store.redo() },
        { separator: true },
        { label: "Find", shortcut: "Ctrl+F", run: openFind },
      ],
    },
    {
      label: "View",
      items: [
        ...VIEWS.filter((view) => view.id !== "split").map((view) => ({ label: view.label, run: () => store.setView(view.id) })),
        { separator: true },
        ...PRODUCTION.map((view) => ({ label: view.label, run: () => store.setView(view.id) })),
        { separator: true },
        {
          label: "Scene Navigator",
          run: () => {
            store.showNav = !store.showNav;
            store.emit("chrome");
          },
        },
        {
          label: "Inspector",
          run: () => {
            store.showInspector = !store.showInspector;
            store.emit("chrome");
          },
        },
        {
          label: "Scene Numbers",
          mark: () => store.sceneNumbers,
          run: () => {
            store.sceneNumbers = !store.sceneNumbers;
            store.emit("chrome");
          },
        },
        {
          label: "Watermark",
          mark: () => store.watermark,
          run: () => {
            store.watermark = !store.watermark;
            store.emit("chrome");
          },
        },
        {
          label: "Scene beats",
          mark: () => store.showSceneBeat,
          run: () => {
            store.showSceneBeat = !store.showSceneBeat;
            store.emit("chrome");
          },
        },
        {
          label: "Focus",
          mark: () => store.focusMode,
          run: () => {
            store.focusMode = !store.focusMode;
            store.emit("chrome");
          },
        },
        {
          label: "Typewriter",
          mark: () => store.typewriter,
          run: () => {
            store.typewriter = !store.typewriter;
            store.emit("chrome");
          },
        },
        {
          label: "Light theme",
          mark: () => store.theme === "light",
          run: () => {
            store.theme = store.theme === "light" ? "dark" : "light";
            saveChrome(store.theme, store.zoom);
            store.emit("chrome");
          },
        },
        {
          label: "Sepia theme",
          mark: () => store.theme === "sepia",
          run: () => {
            store.theme = store.theme === "sepia" ? "dark" : "sepia";
            saveChrome(store.theme, store.zoom);
            store.emit("chrome");
          },
        },
        {
          label: "Zoom in",
          run: () => {
            store.zoom = Math.min(1.4, Math.round((store.zoom + 0.1) * 10) / 10);
            saveChrome(store.theme, store.zoom);
            store.emit("chrome");
          },
        },
        {
          label: "Zoom out",
          run: () => {
            store.zoom = Math.max(0.8, Math.round((store.zoom - 0.1) * 10) / 10);
            saveChrome(store.theme, store.zoom);
            store.emit("chrome");
          },
        },
      ],
    },
    {
      label: "Format",
      items: [
        ...kindOptions().map((option) => ({
          label: option.label,
          run: () => {
            if (store.selection?.type !== "paragraph") return;
            const index = store.selection.index;
            store.transact(() => {
              const paragraph = store.script.paragraphs[index];
              if (paragraph) applyKind(paragraph, option.kind);
              store.caret = { index, offset: 0 };
            });
          },
        })),
        { separator: true },
        { label: "Bold", shortcut: "Ctrl+B", run: () => editorStyle("bold") },
        { label: "Italic", shortcut: "Ctrl+I", run: () => editorStyle("italic") },
        { label: "Underline", shortcut: "Ctrl+U", run: () => editorStyle("underline") },
        { separator: true },
        {
          label: "Smart format",
          run: () => {
            let changed = 0;
            store.transact(() => {
              changed = smartFormat(store.script);
            });
            store.setStatus(changed === 0 ? "Smart format found nothing to change" : `Smart format updated ${changed} lines`);
          },
        },
        {
          label: "Tag selection",
          run: tagSelection,
        },
        {
          label: "Comment",
          run: commentSelection,
        },
        {
          label: "Storyline color",
          run: cycleStoryline,
        },
        {
          label: "Lock pages",
          run: () => {
            store.transact(() => lockPages(store.script));
            store.setStatus("Pages locked. New overflow prints as an A page.");
          },
        },
        {
          label: "Table read",
          run: tableRead,
        },
        {
          label: "25-minute sprint",
          run: startSprint,
        },
        {
          label: "Check formatting",
          run: () => {
            const issues = checkFormatting(store.script);
            modal.replaceChildren();
            const back = document.createElement("div");
            back.className = "modal-back";
            const panel = document.createElement("div");
            panel.className = "modal";
            const heading = document.createElement("h2");
            heading.textContent = "Check formatting";
            const body = document.createElement("div");
            body.className = "modal-body";
            if (issues.length === 0) {
              const clear = document.createElement("p");
              clear.textContent = "No broken cues, buried parentheticals, or lookalike names.";
              body.append(clear);
            }
            for (const issue of issues) {
              const jump = document.createElement("button");
              jump.type = "button";
              jump.className = "nav-add";
              jump.textContent = issue.message;
              jump.addEventListener("click", () => {
                modal.replaceChildren();
                store.setView("script");
                store.selectParagraph(issue.index);
              });
              body.append(jump);
            }
            const close = document.createElement("button");
            close.type = "button";
            close.textContent = "Close";
            close.addEventListener("click", () => modal.replaceChildren());
            back.addEventListener("click", (event) => {
              if (event.target === back) modal.replaceChildren();
            });
            panel.append(heading, body, close);
            back.append(panel);
            modal.append(back);
          },
        },
        {
          label: "Dual Dialogue",
          run: () => {
            if (store.selection?.type !== "paragraph") return;
            const index = store.selection.index;
            store.transact(() => {
              toggleDual(store.script, index);
            });
          },
        },
      ],
    },
    {
      label: "Production",
      items: [
        {
          label: "Renumber Scenes",
          run: () => {
            store.transact(() => renumberScenes(store.script));
            store.setStatus("Scene numbers updated");
          },
        },
        { separator: true },
        ...["blue", "pink", "yellow", "green", "gold"].map((color) => ({
          label: `Type in ${color}`,
          run: () => {
            store.revision = store.revision === color ? null : color;
            store.setStatus(store.revision ? `New typing is marked ${color}` : "Revision typing is off");
          },
        })),
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Keyboard",
          run: () =>
            openModal("Keyboard", [
              "Tab changes this line to the most likely other element. On dialogue, that is action.",
              "Shift+Tab opens the numbered types. Press 1 through 9, or Alt+number at any time.",
              "Enter starts the next element. Shift+Enter stays in the paragraph.",
              "An empty character or dialogue line becomes action.",
              "Names, sluglines, and transitions complete as you type. Enter accepts.",
              "Ctrl+B, Ctrl+I, and Ctrl+U set emphasis.",
              "On the board: hold Space and drag to pan. Scroll pans. Shift+scroll moves sideways. Ctrl+scroll zooms.",
              "A scene can hold several beat modules. They stay in the inspector while you write. Hide beat turns that pane off.",
            ]),
        },
        {
          label: "About Folio",
          run: () =>
            openModal("About Folio", [
              "Folio is a screenplay studio for Linux. It reads and writes FDX and Fountain.",
              "It is not Final Draft, Celtx, WriterDuet, Fade In, Story Architect, OpenDraft, or ScriptFlow.",
              "The element keys follow ordinary screenplay practice. The beat board is Folio's own freeform canvas.",
              "Story Architect and Fountain Mode are GPL, so their source is not included. OpenDraft is MIT and ScriptFlow is Apache-2.0; Folio reimplements the behavior instead of shipping their code.",
            ]),
        },
      ],
    },
  ];

  let openMenu: HTMLElement | null = null;
  const closeMenus = (): void => {
    menubar.querySelectorAll(".menu").forEach((menu) => menu.classList.remove("open"));
    menubar.querySelectorAll<HTMLElement>(".menu > .menu-list").forEach((list) => {
      list.hidden = true;
    });
    openMenu = null;
  };
  for (const menu of menus) {
    const wrap = document.createElement("div");
    wrap.className = "menu";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = menu.label;
    const list = document.createElement("div");
    list.className = "menu-list";
    list.hidden = true;
    const appendItems = (parent: HTMLElement, items: Item[]): void => {
      for (const item of items) {
        if ("separator" in item) {
          parent.append(document.createElement("hr"));
          continue;
        }
        if ("items" in item) {
          const sub = document.createElement("div");
          sub.className = "menu-sub";
          const row = document.createElement("button");
          row.type = "button";
          const label = document.createElement("span");
          label.textContent = item.label;
          const caret = document.createElement("span");
          caret.textContent = "›";
          row.append(label, caret);
          const child = document.createElement("div");
          child.className = "menu-list";
          const fill = (): void => {
            child.replaceChildren();
            const entries = typeof item.items === "function" ? item.items() : item.items;
            if (entries.length === 0) {
              const empty = document.createElement("button");
              empty.type = "button";
              empty.disabled = true;
              empty.textContent = "No recent scripts";
              child.append(empty);
              return;
            }
            appendItems(child, entries);
          };
          fill();
          (sub as HTMLElement & { refresh?: () => void }).refresh = fill;
          row.addEventListener("click", (event) => {
            event.stopPropagation();
            fill();
            sub.classList.toggle("open");
          });
          sub.append(row, child);
          parent.append(sub);
          continue;
        }
        const row = document.createElement("button");
        row.type = "button";
        const label = document.createElement("span");
        const paintItem = (): void => {
          const on = item.mark?.() ?? false;
          label.textContent = `${on ? "✓ " : ""}${item.label}`;
        };
        paintItem();
        (row as HTMLButtonElement & { paintItem?: () => void }).paintItem = paintItem;
        if (item.title) row.title = item.title;
        row.append(label);
        if (item.shortcut) {
          const shortcut = document.createElement("kbd");
          shortcut.textContent = item.shortcut;
          row.append(shortcut);
        }
        row.addEventListener("click", () => {
          closeMenus();
          item.run();
        });
        parent.append(row);
      }
    };
    appendItems(list, menu.items);
    const toggle = (): void => {
      const willOpen = openMenu !== wrap;
      list.querySelectorAll("button").forEach((button) => {
        (button as HTMLButtonElement & { paintItem?: () => void }).paintItem?.();
      });
      list.querySelectorAll(".menu-sub").forEach((node) => {
        (node as HTMLElement & { refresh?: () => void }).refresh?.();
      });
      closeMenus();
      if (!willOpen) return;
      wrap.classList.add("open");
      list.hidden = false;
      openMenu = wrap;
    };
    button.addEventListener("click", toggle);
    wrap.addEventListener("mouseenter", () => {
      if (openMenu) toggle();
    });
    wrap.append(button, list);
    menubar.append(wrap);
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && menubar.contains(event.target)) return;
    closeMenus();
  });

  const sep = (): HTMLElement => {
    const node = document.createElement("span");
    node.className = "sep";
    return node;
  };
  toolbar.append(
    toolButton("New", newScript, "new-script"),
    toolButton("Open", openFile, "open-script"),
    toolButton("Save", saveFdx, "save-script"),
    sep(),
    kindSelect,
    Object.assign(toolButton("B", () => editorStyle("bold"), "style-bold"), { title: "Bold (Ctrl+B)" }),
    Object.assign(toolButton("I", () => editorStyle("italic"), "style-italic"), { title: "Italic (Ctrl+I)" }),
    Object.assign(toolButton("U", () => editorStyle("underline"), "style-underline"), { title: "Underline (Ctrl+U)" }),
    sep(),
  );
  for (const view of VIEWS) {
    if (view.id === "split") continue;
    const button = toolButton(view.label, () => store.setView(view.id), view.test);
    button.dataset.view = view.id;
    toolbar.append(button);
  }
  const suite = document.createElement("select");
  suite.className = "kind";
  suite.dataset.testid = "suite";
  suite.setAttribute("aria-label", "Production");
  const suitePlaceholder = document.createElement("option");
  suitePlaceholder.value = "";
  suitePlaceholder.textContent = "Production";
  suite.append(suitePlaceholder);
  for (const view of PRODUCTION) {
    const option = document.createElement("option");
    option.value = view.id;
    option.textContent = view.label;
    suite.append(option);
  }
  suite.addEventListener("change", () => {
    if (!suite.value) return;
    store.setView(suite.value as ViewId);
  });
  toolbar.append(sep(), suite, sep(), toolButton("Find", openFind, "find-open"));

  mountNav(nav, store);
  mountInspector(inspector, store);

  const paintChrome = (): void => {
    app.classList.toggle("hide-nav", !store.showNav || store.focusMode);
    app.classList.toggle("hide-inspector", !store.showInspector || store.focusMode);
    document.documentElement.dataset.theme = store.theme;
    document.documentElement.style.setProperty("--page-zoom", String(store.zoom));
    const writing =
      store.view === "script" ||
      (store.view === "split" && (store.splitLeft === "script" || store.splitRight === "script"));
    kindSelect.hidden = !writing;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-writing]")) button.hidden = !writing;
    for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-view]")) {
      button.classList.toggle("active", button.dataset.view === store.view);
    }
    splitButton.setAttribute("aria-pressed", store.view === "split" ? "true" : "false");
    splitButton.classList.toggle("active", store.view === "split");
    if (document.activeElement !== suite) {
      suite.value = PRODUCTION.some((view) => view.id === store.view) ? store.view : "";
    }
    if (store.selection?.type === "paragraph" && document.activeElement !== kindSelect) {
      const kind = store.script.paragraphs[store.selection.index]?.kind;
      if (kind && [...kindSelect.options].some((option) => option.value === kind)) kindSelect.value = kind;
      const readout = kind ? kindLabel(kind) : "";
      kindSelect.title = readout;
    }
    const pages = layoutScript(store.script);
    const pageOf = paragraphPages(store.script);
    const selection = store.selection;
    const index = selection?.type === "paragraph" ? selection.index : -1;
    const span = [...sceneSpans(store.script)].reverse().find((scene) => index >= scene.start && index < scene.end);
    const title = scriptTitle(store.script) || "Untitled";
    const beats = store.script.board?.cards.length ?? 0;
    document.title = `${store.dirty ? "• " : ""}${title} — Folio`;
    status.textContent = [
      `Page ${pageOf[index] ?? 1} of ${Math.max(pages.length, 1)}`,
      span ? `Scene ${span.number || "—"}` : `${beats} beats`,
      span?.heading ?? "",
      store.filePath || (saveFolder() ? `New files: ${saveFolder()}` : ""),
      `${countWords(store.script)} words`,
      `${Math.max(0, countWords(store.script) - sessionWords)} this session`,
      store.revision ? `Revision ${store.revision}` : "",
      store.status,
    ]
      .filter(Boolean)
      .join("   ·   ");
  };

  let statusTimer = 0;
  let lastAuto = Date.now();
  const sessionWords = countWords(store.script);
  store.subscribe((event) => {
    if (event === "view") show();
    if (event === "text") {
      window.clearTimeout(statusTimer);
      statusTimer = window.setTimeout(() => paintChrome(), 200);
      if (Date.now() - lastAuto > 5 * 60 * 1000) {
        lastAuto = Date.now();
        takeSnapshot(store.script, "Auto");
      }
      return;
    }
    if (event === "view" || event === "chrome" || event === "script" || event === "selection") paintChrome();
  });
  status.textContent = `${countWords(store.script) - sessionWords} words this session`;

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && (key === "b" || key === "i" || key === "u")) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.dataset.testid === "script-desk") {
        event.preventDefault();
        editorStyle(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        return;
      }
    }
    if (mod && key === "s") {
      event.preventDefault();
      saveFdx();
      return;
    }
    if (mod && key === "o") {
      event.preventDefault();
      openFile();
      return;
    }
    if (mod && key === "n") {
      event.preventDefault();
      newScript();
      return;
    }
    if (mod && key === "k") {
      event.preventDefault();
      openPalette();
      return;
    }
    if (mod && key >= "1" && key <= "6") {
      event.preventDefault();
      const view = VIEWS.filter((item) => item.id !== "split")[Number(key) - 1];
      if (view) store.setView(view.id);
      return;
    }
    if (openMenu && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape")) {
      const buttons = [...openMenu.querySelectorAll<HTMLButtonElement>(".menu-list button")];
      if (event.key === "Escape") {
        closeMenus();
        return;
      }
      event.preventDefault();
      const current = buttons.findIndex((button) => button === document.activeElement);
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      buttons[(next + buttons.length) % buttons.length]?.focus();
      return;
    }
    if (mod && key === "f") {
      event.preventDefault();
      openFind();
      return;
    }
    if (mod && key === "p") {
      event.preventDefault();
      window.print();
      return;
    }
    if (mod && key === "z" && !event.shiftKey) {
      event.preventDefault();
      store.undo();
      return;
    }
    if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      store.redo();
      return;
    }
    if (event.key === "Escape") closeMenus();
    if ((event.key === "Delete" || event.key === "Backspace") && !typingTarget(event.target)) {
      if (store.selection?.type === "cards" || store.selection?.type === "link") {
        event.preventDefault();
        deleteBoardSelection();
      }
    }
  });

  show();
  paintChrome();
  const bridge = nativeBridge();
  const launch = (): void => welcome();
  if (bridge && recentFiles().length === 0) {
    void bridge.postMessage({ action: "last-open" }).then((result) => {
      if (result?.ok && result.path && result.name) rememberRecent(result.name, result.path);
      launch();
    });
  } else {
    launch();
  }
}

boot();
