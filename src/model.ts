export type ElementKind =
  | "scene-heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "shot"
  | "general"
  | "cast-list"
  | "singing"
  | "new-act"
  | "end-of-act"
  | "sequence"
  | "outline-1"
  | "outline-2"
  | "outline-3"
  | "outline-4"
  | "outline-body"
  | "summary"
  | "centered"
  | "lyric"
  | "section"
  | "synopsis"
  | "note"
  | "page-break"
  | "unknown";

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  revisionId?: string;
}

export interface PreservedElement {
  name: string;
  xml: string;
}

/** Index-card and character-arc data stored on a scene heading. */
export interface SceneInfo {
  summary: string;
  arcCharacters: string[];
  length?: string;
  page?: string;
  title?: string;
  attributes: Record<string, string>;
  preserved: PreservedElement[];
}

export interface Paragraph {
  kind: ElementKind;
  /** Original FDX Type attribute. Unknown types stay intact on write. */
  fdxType: string;
  runs: TextRun[];
  sceneNumber?: string;
  alignment?: "Left" | "Center" | "Right";
  startsNewPage?: boolean;
  /** Paragraphs that share a number were one DualDialogue block. */
  dualGroup?: number;
  /** Outline / section depth. 1 is an act-level heading. */
  level?: number;
  scene?: SceneInfo;
  notes: string[];
  attributes: Record<string, string>;
  preserved: PreservedElement[];
}

export interface TitleField {
  type: string;
  text: string;
}

import type { Production } from "./production.js";

/** A freeform beat-board card. Positions are Folio's canvas, kept through FDX. */
export interface BoardCard {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /**
   * Scene heading this module belongs to (`FolioId`). Several cards may share one scene.
   * Empty string means the writer unlinked it and auto-link should leave it alone.
   */
  sceneId?: string;
  attributes: Record<string, string>;
  preserved: PreservedElement[];
}

export interface BoardLink {
  from: string;
  to: string;
}

export interface Board {
  cards: BoardCard[];
  links: BoardLink[];
  attributes: Record<string, string>;
  /**
   * final-draft: the canvas came from DisplayBoard Type="Beat" plus ListItem beats.
   * Writing that board emits Final Draft's elements again.
   */
  origin?: "final-draft";
  /** Children of the board element that are not cards. */
  preserved: PreservedElement[];
}

export interface Script {
  version: string;
  documentType: string;
  template: string;
  titlePage: TitleField[];
  paragraphs: Paragraph[];
  /**
   * Freeform beat board. Lifted out of a preserved BeatBoard element on read
   * and written back as one. This is Folio's canvas markup, not a claim about
   * Final Draft's unpublished board schema.
   */
  board?: Board;
  /**
   * Breakdown, storyboard, budget, schedule, and assembly linked to scene ids.
   * Written as a FolioProduction element. Final Draft does not define this.
   */
  production?: Production;
  /** Root elements other than Content, TitlePage, the board, and Folio production. */
  preserved: PreservedElement[];
  /** Content children other than Paragraph and DualDialogue. */
  preservedContent: PreservedElement[];
}

export const FDX_KIND: Record<string, ElementKind> = {
  "Scene Heading": "scene-heading",
  Action: "action",
  Character: "character",
  Parenthetical: "parenthetical",
  Dialogue: "dialogue",
  Transition: "transition",
  Shot: "shot",
  General: "general",
  "Cast List": "cast-list",
  Singing: "singing",
  "New Act": "new-act",
  "End of Act": "end-of-act",
  Sequence: "sequence",
  "Outline 1": "outline-1",
  "Outline 2": "outline-2",
  "Outline 3": "outline-3",
  "Outline 4": "outline-4",
  "Outline Body": "outline-body",
  Summary: "summary",
};

export const KIND_FDX: Record<ElementKind, string> = {
  "scene-heading": "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  shot: "Shot",
  general: "General",
  "cast-list": "Cast List",
  singing: "Singing",
  "new-act": "New Act",
  "end-of-act": "End of Act",
  sequence: "Sequence",
  "outline-1": "Outline 1",
  "outline-2": "Outline 2",
  "outline-3": "Outline 3",
  "outline-4": "Outline 4",
  "outline-body": "Outline Body",
  summary: "Summary",
  centered: "Action",
  lyric: "Singing",
  section: "Outline 1",
  synopsis: "Outline Body",
  note: "General",
  "page-break": "Action",
  unknown: "General",
};

export function kindFromFdx(type: string): ElementKind {
  return FDX_KIND[type] ?? "unknown";
}

export function paragraphText(paragraph: Paragraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

export function scriptTitle(script: Script): string {
  const title = script.titlePage.find((field) => field.type.toLowerCase() === "title");
  return title?.text.trim() ?? "";
}

export function emptyScene(): SceneInfo {
  return { summary: "", arcCharacters: [], attributes: {}, preserved: [] };
}
