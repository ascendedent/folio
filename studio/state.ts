import sampleFdx from "../fixtures/kitchen.fdx?raw";
import { emptyBoard } from "../src/fdx/board.js";
import { readFdx } from "../src/fdx/read.js";
import type { Script } from "../src/model.js";
import { prepareScript } from "../src/production.js";

export type ViewId =
  | "script"
  | "board"
  | "cards"
  | "outline"
  | "title"
  | "split"
  | "reports"
  | "breakdown"
  | "storyboard"
  | "budget"
  | "schedule"
  | "assembly"
  | "calls"
  | "shots"
  | "catalog"
  | "dood"
  | "lines";

export type Selection =
  | { type: "paragraph"; index: number; start?: number; end?: number }
  | { type: "cards"; ids: string[] }
  | { type: "link"; from: string; to: string }
  | null;

export type StoreEvent = "script" | "text" | "selection" | "view" | "chrome" | "find";

const STORAGE_KEY = "folio.studio.v1";

interface Draft {
  version: 1;
  fileName: string;
  script: Script;
  savedAt: number;
}

interface StoredDraft {
  version: 2;
  fileName: string;
  filePath: string;
  script: Script;
  assets: Record<string, string>;
  savedAt: number;
}

export interface Store {
  script: Script;
  fileName: string;
  /** Full path of the file this draft was opened from, when the app knows it. */
  filePath: string;
  dirty: boolean;
  view: ViewId;
  selection: Selection;
  sceneNumbers: boolean;
  watermark: boolean;
  showNav: boolean;
  showInspector: boolean;
  linking: boolean;
  linkFrom: string | null;
  snap: boolean;
  /** Scene beats stay in the inspector while the caret moves through the scene. */
  showSceneBeat: boolean;
  theme: "dark" | "light" | "sepia";
  zoom: number;
  focusMode: boolean;
  typewriter: boolean;
  splitLeft: ViewId;
  splitRight: ViewId;
  /** Left pane width as a percent of the split. */
  splitRatio: number;
  /** When set, newly typed characters carry this revision color. */
  revision: string | null;
  status: string;
  caret: { index: number; offset: number } | null;
  subscribe(listener: (event: StoreEvent) => void): () => void;
  emit(event: StoreEvent): void;
  beginBurst(): void;
  noteText(): void;
  finishGesture(changed: boolean): void;
  transact(change: () => void): void;
  undo(): void;
  redo(): void;
  replace(script: Script, fileName: string): void;
  setView(view: ViewId): void;
  selectParagraph(index: number, range?: { start: number; end: number }): void;
  reveal(index: number): void;
  takeCaret(): { index: number; offset: number } | null;
  setStatus(status: string): void;
  markSaved(status: string): void;
  /** Resolves after the saved draft, if there is one, has been read. */
  ready: Promise<void>;
}

function chromePref(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem("folio.chrome.v1");
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveChrome(theme: string, zoom: number, extra: Record<string, string> = {}): void {
  let prior: Record<string, string> = {};
  try {
    prior = JSON.parse(localStorage.getItem("folio.chrome.v1") || "{}") as Record<string, string>;
  } catch {
    prior = {};
  }
  localStorage.setItem("folio.chrome.v1", JSON.stringify({ ...prior, theme, zoom: String(zoom), ...extra }));
}

function revive(script: Script): Script {
  if (!script.board) script.board = emptyBoard();
  script.preserved ??= [];
  script.preservedContent ??= [];
  script.titlePage ??= [];
  script.paragraphs ??= [];
  prepareScript(script);
  return script;
}

function initial(): { script: Script; fileName: string; status: string; savedAt: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const draft = JSON.parse(raw) as Draft;
      if (draft.version === 1 && Array.isArray(draft.script?.paragraphs)) {
        return {
          script: revive(draft.script),
          fileName: draft.fileName || "Untitled.fdx",
          status: "Restored the draft saved in this browser",
          savedAt: draft.savedAt || 1,
        };
      }
    }
  } catch {
    // A broken draft falls through to the sample.
  }
  return {
    script: revive(readFdx(sampleFdx)),
    fileName: "Kitchen Letter.fdx",
    status: "Sample screenplay",
    savedAt: 0,
  };
}

function pack(script: Script): { script: Script; assets: Record<string, string> } {
  const copy = JSON.parse(JSON.stringify(script)) as Script;
  const assets: Record<string, string> = {};
  let count = 0;
  const take = (value: string | undefined): string => {
    if (!value || !value.startsWith("data:") || value.length < 2048) return value ?? "";
    const id = `a${count}`;
    count += 1;
    assets[id] = value;
    return `folio-asset:${id}`;
  };
  for (const frame of copy.production?.frames ?? []) {
    frame.sketch = take(frame.sketch);
    frame.image = take(frame.image);
  }
  for (const item of copy.production?.catalog ?? []) item.image = take(item.image);
  return { script: copy, assets };
}

function unpack(script: Script, assets: Record<string, string>): Script {
  const put = (value: string | undefined): string => {
    if (!value?.startsWith("folio-asset:")) return value ?? "";
    return assets[value.slice("folio-asset:".length)] ?? "";
  };
  for (const frame of script.production?.frames ?? []) {
    frame.sketch = put(frame.sketch);
    frame.image = put(frame.image);
  }
  for (const item of script.production?.catalog ?? []) item.image = put(item.image);
  return script;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("folio.studio", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the draft database."));
  });
}

async function readDraft(): Promise<StoredDraft | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get("current");
    request.onsuccess = () => {
      const value = request.result as StoredDraft | undefined;
      resolve(value?.version === 2 && Array.isArray(value.script?.paragraphs) ? value : null);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not read the draft."));
  });
}

async function writeDraft(draft: StoredDraft): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts", "readwrite").objectStore("drafts").put(draft, "current");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not write the draft."));
  });
}

export function createStore(): Store {
  const loaded = initial();
  let burst: string | null = null;
  let burstTimer = 0;
  let saveTimer = 0;
  const undo: string[] = [];
  const redo: string[] = [];
  const listeners = new Set<(event: StoreEvent) => void>();

  const store: Store = {
    script: loaded.script,
    fileName: loaded.fileName,
    filePath: "",
    dirty: false,
    view: "script",
    selection: {
      type: "paragraph",
      index: Math.max(0, loaded.script.paragraphs.findIndex((paragraph) => paragraph.kind === "scene-heading")),
    },
    sceneNumbers: true,
    watermark: false,
    showNav: true,
    showInspector: true,
    linking: false,
    linkFrom: null,
    snap: true,
    showSceneBeat: true,
    theme: chromePref("theme", "dark") as "dark" | "light" | "sepia",
    zoom: Number(chromePref("zoom", "1")) || 1,
    focusMode: false,
    typewriter: false,
    splitLeft: (chromePref("splitLeft", "script") || "script") as ViewId,
    splitRight: (chromePref("splitRight", "board") || "board") as ViewId,
    splitRatio: Math.min(82, Math.max(18, Number(chromePref("splitRatio", "58")) || 58)),
    revision: null,
    status: loaded.status,
    caret: {
      index: Math.max(0, loaded.script.paragraphs.findIndex((paragraph) => paragraph.kind === "scene-heading")),
      offset: 0,
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    beginBurst() {
      if (burst === null) burst = JSON.stringify(store.script);
    },
    noteText() {
      store.dirty = true;
      scheduleSave();
      window.clearTimeout(burstTimer);
      burstTimer = window.setTimeout(commitBurst, 700);
      store.emit("text");
    },
    finishGesture(changed) {
      if (!changed) {
        if (burst !== null && burst === JSON.stringify(store.script)) burst = null;
        return;
      }
      store.noteText();
    },
    transact(change) {
      commitBurst();
      undo.push(JSON.stringify(store.script));
      if (undo.length > 80) undo.shift();
      redo.length = 0;
      change();
      prepareScript(store.script);
      store.dirty = true;
      scheduleSave();
      store.emit("script");
    },
    undo() {
      if (burst !== null) {
        redo.push(JSON.stringify(store.script));
        store.script = JSON.parse(burst) as Script;
        burst = null;
        window.clearTimeout(burstTimer);
        store.dirty = true;
        scheduleSave();
        store.emit("script");
        return;
      }
      const previous = undo.pop();
      if (!previous) return;
      redo.push(JSON.stringify(store.script));
      store.script = JSON.parse(previous) as Script;
      store.dirty = true;
      scheduleSave();
      store.emit("script");
    },
    redo() {
      commitBurst();
      const next = redo.pop();
      if (!next) return;
      undo.push(JSON.stringify(store.script));
      store.script = JSON.parse(next) as Script;
      store.dirty = true;
      scheduleSave();
      store.emit("script");
    },
    replace(script, fileName) {
      commitBurst();
      undo.length = 0;
      redo.length = 0;
      store.script = revive(script);
      store.fileName = fileName;
      store.dirty = false;
      store.selection = { type: "paragraph", index: 0 };
      store.caret = { index: 0, offset: 0 };
      store.linking = false;
      store.linkFrom = null;
      scheduleSave();
      store.emit("script");
      store.emit("chrome");
    },
    setView(view) {
      if (store.view === view) return;
      store.view = view;
      store.emit("view");
      store.emit("chrome");
    },
    selectParagraph(index, range) {
      store.selection = range ? { type: "paragraph", index, start: range.start, end: range.end } : { type: "paragraph", index };
      store.emit("selection");
    },
    reveal(index) {
      store.selection = { type: "paragraph", index };
      store.caret = { index, offset: 0 };
      if (store.view !== "script" && store.view !== "split") store.view = "script";
      store.emit("view");
      store.emit("script");
    },
    takeCaret() {
      const caret = store.caret;
      store.caret = null;
      return caret;
    },
    setStatus(status) {
      store.status = status;
      store.emit("chrome");
    },
    markSaved(status) {
      store.dirty = false;
      store.status = status;
      scheduleSave();
      store.emit("chrome");
    },
    ready: Promise.resolve(),
  };
  store.ready = hydrate();

  function commitBurst(): void {
    if (burst === null) return;
    undo.push(burst);
    if (undo.length > 80) undo.shift();
    redo.length = 0;
    burst = null;
    window.clearTimeout(burstTimer);
  }

  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void persist();
    }, 400);
  }

  async function hydrate(): Promise<void> {
    try {
      const stored = await readDraft();
      const local = loaded.savedAt;
      if (stored && stored.savedAt >= local) {
        store.script = revive(unpack(stored.script, stored.assets));
        store.fileName = stored.fileName || store.fileName;
        store.filePath = stored.filePath || "";
        store.status = stored.filePath
          ? `Restored ${stored.fileName}`
          : "Restored the draft saved on this computer";
        return;
      }
      if (local > 0) void persist();
    } catch {
      store.status = "Could not read the saved draft.";
    }
  }

  async function persist(): Promise<void> {
    const savedAt = Date.now();
    const packed = pack(store.script);
    const draft: StoredDraft = {
      version: 2,
      fileName: store.fileName,
      filePath: store.filePath,
      script: packed.script,
      assets: packed.assets,
      savedAt,
    };
    try {
      await writeDraft(draft);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, fileName: store.fileName, savedAt, idb: true }));
    } catch {
      store.status = "Autosave failed. Download a copy before you close this window.";
      store.emit("chrome");
    }
  }

  window.addEventListener("beforeunload", (event) => {
    void persist();
    if (!store.dirty) return;
    event.preventDefault();
  });

  return store;
}
