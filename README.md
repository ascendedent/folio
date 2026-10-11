# Folio

Folio is a Linux screenplay studio. It reads and writes the files Final Draft uses, and it is not Final Draft and not affiliated with Cast & Crew or Final Draft, Inc.

A screenplay is a list of typed elements (scene heading, action, character, dialogue, and the rest). FDX, Fountain, and formatted text are views of that list. The studio is the writing surface: a Courier page, a scene navigator, index cards, an outline, and a freeform beat board. Anything in an FDX file that Folio does not understand yet is kept and written back.

Final Draft beat boards are read from `DisplayBoard Type="Beat"` and `ListItem Type="Beat"`. Saving that file writes those elements back. A board created in Folio is stored as Folio's own `BeatBoard` markup. Unknown board XML is still preserved when it does not match either shape. On import, a card grows to fit its text. If the visible text is only a fragment of a longer hidden beat, the longer text is kept.

## What works

- FDX (`.fdx`, `.fdxt`) read and write: elements, title page, dual dialogue, scene numbers, emphasis, script notes, scene-card summaries, character arcs, outline elements, and unknown paragraph types.
- Beat extraction from those known structures, plus any preserved `Beat`, `Card`, `Lane`, or `StructurePoint` element (position, color, and flow lines when the file has those attributes).
- Fountain read and write, including title page, dual dialogue, sections, synopses, notes, and emphasis.
- Formatted text: Courier 12, US screenplay indents, 54 body lines to a page, scene headings and character cues kept with the line that follows them. This is the “Text with Layout” export.
- RTF of that same layout.
- `folio preview` writes one HTML file with the pages and the beats beside them.

Fountain cannot store a beat board’s x/y positions. Export `.fdx` when the board has to survive.

## Studio

```bash
npm install
npm run studio
```

Opens at `http://127.0.0.1:4730`. The sample is the kitchen letter, with two beat cards already on the board. A draft is kept on this computer. Autosave waits a moment, stores pictures outside the script text, and says so if the save fails. Courier Prime is included, so the page does not depend on a network font.

On a Mac, `mac/build.sh` compiles the same studio into `Folio.app` and signs it with the Apple Development identity already on that Mac. The app lives in `~/Applications`.

On this Fedora machine, `linux/install.sh` installs a Folio window into the application menu. It does not start the dev server.

`npm run mcp` speaks Model Context Protocol on stdin. It holds one script. `load_script` reads a file and `write_fdx` writes it back with `writeFdx`. Each desk job is its own tool, including `read_paragraphs`, `set_paragraph_text`, `read_beats`, `rename_character`, and the production upserts. `lock_pages` and `replace_all` stay in the library and are not tools.

- Script: Enter starts the next element (dialogue continues into a character cue on the same page). A speech that crosses a page shows (MORE) and the name again as (CONT'D). Format → Check formatting catches a missing cue, a parenthetical buried in dialogue, a long action block, and lookalike names. Tab retypes the current line as the most likely other element (dialogue becomes action). Shift+Tab opens the numbered types, then 1–9 assigns one. Alt+number does that any time. Names, sluglines, and transitions complete from the script. New typing can carry a revision color from the Production menu.
- Beat board: free canvas. Drag, resize, snap, marquee-select, link, align, and distribute. Hold Space and drag to pan. Scroll pans, Shift+scroll moves sideways, and Ctrl+scroll zooms. Send cards into the script as outline elements, or pull scenes and outline beats onto the board. A card whose title matches a scene heading links to that scene, and a scene can hold several modules. The inspector keeps those beats up while you write, and the left navigator pops that scene's beat cards up at the bottom whenever the caret is inside the scene. Hide beat turns both off. New beat module starts another card on the current scene.
- Index cards are the same beat modules as the board, grouped under each scene. Editing a title or a body in either view updates the other, including the board beside the page. A scene with no beat yet still edits its summary, and New beat module copies that summary onto the board. Outline lanes, the title page, find and replace, and scene, cast, and location reports.
- The split icon on the top bar opens two panes side by side. Each pane chooses its own view: script, beat board, cards, outline, title page, dialogue, reports, or a production view. Drag the divider to resize. Double-click it to swap sides. Press the icon again to close the split. The choice is remembered.
- Production, linked by a stable scene id: breakdown, storyboard (draw or upload a still), shot list, catalog, budget top sheet, schedule, call sheets with sides, a day-out-of-days grid, and an assembly cut. A catalog rate can be dropped onto the budget; the day count includes hold days. Renaming a character or a location updates the script. Omit grays the scene on the page. Checkpoints keep a rewrite from eating the previous draft.
- File: open and save `.fdx`, export Fountain, formatted text, and RTF. Production data is stored in a `FolioProduction` element so a Folio save keeps it. Final Draft does not define that element.

The writing keys follow the same screenplay practice as Final Draft, Fade In, WriterDuet, and Fountain Mode. The freeform board takes the canvas habits of a planning wall (drag, zoom, connect, align), in the spirit of ScriptFlow and OpenDraft's cards. Story Architect and Fountain Mode are GPL, so their source is not in this repository. OpenDraft is MIT and ScriptFlow is Apache-2.0; Folio's studio is written for this project rather than copied from theirs.

## Commands

```bash
npm install
npm test
npm run studio
npm run folio -- inspect fixtures/kitchen.fdx
npm run folio -- beats fixtures/kitchen.fdx
npm run folio -- export fixtures/kitchen.fdx --to fountain
npm run folio -- export fixtures/kitchen.fountain --to text --out /tmp/kitchen.txt
npm run folio -- export fixtures/kitchen.fountain --to rtf --out /tmp/kitchen.rtf
npm run folio -- preview fixtures/kitchen.fdx --open
```

`text` and `formatted` are the same export. Drop a real Final Draft file in `inbox/` (that folder is gitignored) and run `folio beats` on it.

## Still to build for a full carry-over

- Pagination that matches Final Draft’s mores, continueds, and Loose / Tight line counts, then locked pages and A-pages. The studio already breaks the page with the same 54-line layout used for formatted text.
- Revision mode that marks only the new keystrokes, omitted scenes, and tags. A paragraph can be marked with a revision color now.
- A beat-board schema that matches a real Final Draft 12/13 file. Drop one you wrote into `inbox/`. The probe in `fixtures/kitchen.fdx` is Folio's canvas, and the reader still keeps unknown board XML.
- Spell check beyond the browser, PDF, call-sheet PDF, and a native Linux package (Tauri or GTK).
- A locked revision mode that marks only new keystrokes, and mores / continueds that match a production draft exactly.

Final Draft’s collaboration service is not part of the file format. Fountain in git is the local substitute.

## Layout

`src/model.ts` is the screenplay. `src/fdx` and `src/fountain` convert it. `src/text/layout.ts` is the only paginator, and both formatted text and RTF use it. `src/cli.ts` is the command.
