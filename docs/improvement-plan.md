# Improvement plan (November 2026)

Source: a review of the original plan against the current code, plus a code read-through.
Tick items as they are finished. Work top to bottom; each item is independent and must leave
`npm test`, `npm run lint` and both e2e runs green.

Rules for all items (from CLAUDE.md): no new dependencies, no git commits, nothing game-specific
in `src/`, one renderer, never lose user data, no file-format change without a migration (none of
these items should need one). Before starting, copy the files you will touch to
`backups/2026-11-14-improvements/`. Record each decision the owner might question in
`docs/decisions.md`, and keep `docs/architecture.md` and `docs/user-guide.md` in step.

## A. Data safety

- [x] **A1. Save race loses the "unsaved" mark.** `save()` in `src/ui/store.ts` iterates the `dirty`
  map captured when Save was clicked and ends with `setDirty(failed)`, which replaces the whole map.
  An edit made while the save is in flight is then no longer marked dirty, so it is never written and
  the close-tab warning does not fire. Fix: use a functional `setDirty` that removes only the entries
  that were written and are still the same object (`markDirty` creates a new object per edit), and
  read the content to write from `wsRef.current` at the moment each file is written. Put the
  map arithmetic in a small pure function with a unit test.

- [x] **A2. Asset upload overwrites silently.** `src/ui/game/GameView.tsx` (around line 63) writes
  uploaded icons, fonts and artwork with `fs.writeBlob`, which has no `.bak` and no question.
  Uploading `fire.png` over an existing `fire.png` destroys the old one. Fix: check which names
  already exist and ask once ("Replace these N files?", listing them); skip them on Cancel. Check
  every other `writeBlob` caller that writes into `assets/` (e.g. ICC profiles in `ExportView.tsx`)
  and apply the same rule. Exports into `export/` stay as they are.

- [x] **A3. Excel-safe CSV.** `toCsv` in `src/model/csv.ts` writes no BOM, so Excel shows any
  non-ASCII character as garbage and can save that garbage back.
  - Write a UTF-8 BOM at the start of every CSV the app writes (`parseCsv` already strips it).
  - On load (`src/model/load.ts`): if `cards.csv` contains U+FFFD, add a warning issue saying the
    file is not UTF-8 (probably saved from Excel as plain "CSV"), that the original is untouched
    until Save, and to re-save it as "CSV UTF-8" or import the XLSX.
  - In `ImportDialog.tsx`: read CSV bytes; if they are not valid UTF-8
    (`new TextDecoder('utf-8', { fatal: true })` throws), decode as `windows-1252` and say so in the
    dialog.
  - Update tests that compare exact CSV text. The demo workspace must still load with zero issues.

- [x] **A4. Automatic dated backup.** Today each save overwrites the single `.bak`, so two saves of
  a mistake lose the good version. On the first save after a workspace is opened (once per open,
  per session), call the existing `backupWorkspace(fs)` *before* writing, so `backups/<stamp>/`
  holds the files as they were before this session's edits. A failed backup must not block the
  save: save anyway and show the reason in the error banner. No pruning (text files only, a few KB
  each; deleting user files needs a question). Mention the folder in the save toast the first time
  only.

- [x] **A5. Crash-recovery draft.** Nothing protects unsaved edits from a browser crash or power
  cut. Keep explicit Save (do not autosave into the real files).
  - About 2 s after the last edit, store a draft in IndexedDB (reuse the helper style in
    `src/fs/handleStore.ts`; one object store, one record per workspace): the dirty entries, the
    serialized text of each dirty file (same functions `save()` uses), the time, and for each file
    the on-disk text it was based on (or a hash of it).
  - Workspace identity: add a small `readonly key: string` to the `FileStore` interface. `ServerFs`
    uses its absolute root path; `BrowserFs` uses `browser:<folder name>`; the OPFS dev store gets a
    fixed key; `MemoryFs` and read-only stores never draft.
  - Clear the draft after a fully successful save and when the owner chooses Discard.
  - On open: if a draft exists for this key, show a banner (not a modal): "Unsaved changes from
    (time) were recovered: N files. **Restore** / **Discard**". Restore re-loads the workspace
    through a read overlay (a `FileStore` wrapper that returns the draft text for drafted paths) and
    marks those entries dirty, so the normal Save writes them. If a drafted file's on-disk text no
    longer matches its base, say so in the banner before restoring. Template deletions in the draft
    are re-applied as pending deletions.
  - Pure parts (build draft, overlay store, apply draft) get unit tests with `MemoryFs`. Add an e2e
    step in `?opfs&fresh` mode: edit a cell, reload without saving, Restore, check the cell, Save.

## B. Text layout

- [x] **B1. Keep a number with its icon.** `2[fire]` is already one unbreakable word, but
  `2 [fire]` can break between the number and the icon. In `toAtoms` (`src/render/textLayout.ts`),
  when a word that is only a number (optional sign, digits, optional decimal part, optional `x` or
  `×`) is followed by exactly one space atom and then a word whose first piece is an icon, join the
  three into one word with the space kept as a normal-width, non-stretching text piece. Only this
  direction (number then icon). Add tests in `textLayout.test.ts`, including justify (the glued
  space must not stretch) and a line too narrow for the glued word (falls back to the existing
  word-splitting). Add one line to the markup section of the user guide.

## C. Print shop export

The owner prints at a budget professional shop. Many card printers impose sheets themselves and
ask for one card per page at card size plus bleed.

- [x] **C1. "One card per page" PDF layout.** Add a layout choice to the PDF export: *Sheets*
  (today's behaviour) or *One card per page*. In the new mode the page is exactly the card plus
  bleed (or trim size when bleed is off), no margins, no crop marks; set the PDF TrimBox and
  BleedBox with pdf-lib so prepress software finds the cut line. Landscape cards are turned upright
  exactly as on sheets (`quarterTurn`), so every page has the same size. Quantities still apply
  (option stays). CMYK and the output intent work as they do now. Backs: *none*, *after each front*
  (front, back, front, back...), or *separate file* (`...-backs.pdf`, same page order). Keep the
  pure page arithmetic in `src/export/layout.ts` with unit tests.
- [x] **C2. "Print shop" preset.** One button in the PDF options that sets: one card per page,
  bleed on, 300 DPI, crop marks off, colour left as it is. It only fills in the options; the owner
  can still change them. One primary button per screen stays true (this is a secondary button).
- [x] **C3. User guide section "Sending cards to a print shop"**: the four questions to ask the
  shop (sheets or one card per page; bleed in mm; RGB or CMYK; their ICC profile if any), and the
  note that many digital shops prefer RGB and convert themselves.

## D. Tests

- [x] **D1. Golden-image tests.** `e2e/run.mjs` has no picture comparison, so a renderer change
  that moves a line break or an icon passes unnoticed. Render every demo card face with the shared
  renderer (the `?sheet` dev page, or a small dev-only hook next to it) at the design DPI and compare
  with reference PNGs in `e2e/golden/<edge|firefox>/` (references are per browser because font
  rasterisation differs). Do the pixel comparison inside the page with canvas `getImageData`, so no
  PNG library is needed. Fail when more than 0.5 % of pixels differ by more than 16 in any channel;
  on failure write the actual and a diff picture to `e2e/output/` (git-ignored) and name the card.
  `CM_UPDATE_GOLDEN=1 npm run e2e` rewrites the references. A missing reference is created and
  reported, not failed. Document the command in CLAUDE.md under Commands and Working conventions.
  Generate the references only after B1 is done, and look at a few of them (Read the PNG) to make
  sure they are real cards and not error cards.

## E. Efficiency

- [x] **E1. Reload only changed images on window focus.** `App.tsx` (around line 105) clears every
  cached image of every game and bumps the asset version whenever the window regains focus. Every
  preview re-renders and the Playtest tab redraws every card picture, even when nothing changed. Add
  `modified(path): Promise<number | null>` to `FileStore` (BrowserFs: `getFile().lastModified`;
  ServerFs: return the mtime from the bridge, e.g. in the `exists` answer; MemoryFs: a counter or
  null). `AssetStore` remembers the resolved file and its time for each cached image, including
  misses. A new `refreshChanged()` drops only entries whose time changed (or misses that now exist)
  and returns whether anything was dropped; the focus handler bumps the version only then. Unit test
  with `MemoryFs`; bridge test for the new answer.
- [x] **E2. `BrowserFs.exists` lists the whole folder.** It iterates every name in the parent
  directory for each call, and the asset loader calls it once or twice per image. Use
  `getFileHandle`, then `getDirectoryHandle`, and treat `NotFoundError` / `TypeMismatchError`
  accordingly. (On Windows this makes the lookup case-insensitive, which matches `ServerFs`.)

## F. Import

- [x] **F1. Show what an import changes.** The import dialog shows only counts. Extend the report
  from `importRows` (`src/model/cardOps.ts`) with a list of changes (card name or id, field, old
  value to new value; added and removed cards by name) and show it in a scrollable list in
  `ImportDialog.tsx`, capped at about 200 lines with "and N more". Unit test the report.

## Not in this plan

- Mask-image text regions: waiting for the owner to say whether their frames have curved text areas.
- Desktop `.exe` (Tauri), grid virtualisation, worker export: not needed at hundreds of cards.

## Done means

`npm test`, `npm run lint`, `npm run e2e` and `CM_BROWSER=firefox npm run e2e` all pass; the demo
workspace loads with zero issues; docs updated; boxes above ticked; anything skipped or changed
from this plan is written down at the bottom of this file under "Notes from implementation".

## Notes from implementation

All 13 items are done. Differences from the plan, and choices it left open:

- **Order:** D1 was done last (after E1, E2 and F1), so the golden references show the final renderer.
- **A1:** the `Dirty` type, `dirtyKey`, `gameKey` and the map arithmetic moved to `src/ui/dirty.ts` (`withDirty`, `afterSave`, `dirtyFile`); `store.ts` re-exports `gameKey`. `dirtyFile` is shared by Save and the recovery draft.
- **A2:** besides asking once, a replaced file's old content is kept as `<name>.bak` (writeBlob has no backup of its own). Shared helper: `src/ui/upload.ts`. For an ICC profile, Cancel keeps the existing profile and leaves the export options unchanged.
- **A4:** the backup is attempted once per open. If it fails, it is not retried on the next save in the same session (that would repeat the error on every save). An empty workspace (nothing to back up) doesn't mention a backup in the toast.
- **A5:**
  - Drafts use their own small IndexedDB database (`card-maker-drafts`), not the existing `card-maker` one, so the two modules never need a shared version upgrade.
  - The base text of each file is recorded as a hash while the workspace loads (`ReadRecorder`), not by reading the disk again when a draft is made. Re-reading would have updated the stores' "last seen" time and silently disabled the conflict check on Save.
  - `ServerFs.key` is the plain absolute path; `BrowserFs` takes the key as an optional constructor argument (default `browser:<name>`), which is how the OPFS dev store gets `opfs:dev`.
  - While a recovered draft waits for Restore or Discard, new edits don't overwrite it. Restore asks first if there are edits since opening. The draft is also deleted when the owner agrees to throw away unsaved changes (Reload, opening another folder), so the banner doesn't come back right after that.
  - The draft records the exact text Save would write, including deleted templates (`text: null`), new sets and new games; `DraftOverlay` makes new folders appear in listings.
- **C1:** the exporter also supports "separate file" for sheets, but the UI offers it only with one card per page, so the Sheets options look as before. Back offset is hidden and not used with one card per page. A card without a back gets a blank back page, so fronts and backs stay paired.
- **D1:**
  - **Threshold changed from 0.5 % to 0.05 %.** Measured in Edge: making the rules box 40 px narrower, so one word moves to the next line, changed 0.30 % (c004) and 0.48 % (c002) of the pixels. Both would have passed at 0.5 %, which defeats the item's purpose. Repeat runs in the same browser give 0 % difference. Recorded in `docs/decisions.md`.
  - Faces checked: every card's front, plus each back template once (all cards using a back template get the same back), so 15 references per browser. Rendered in export mode, with bleed, at the design DPI.
  - Render warnings are printed, not failed, because the demo has a deliberate `[firre]` typo.
  - The hook is `?sheet&golden` (DevSheet installs `window.cmGolden` from `src/ui/golden.ts`). `e2e/output/` was added to `.gitignore`. The references take about 10 MB (Edge) and 2.4 MB (Firefox).
- **E1 + E2:** done together, since both change `BrowserFs`. `BrowserFs.exists` also treats a `TypeError` (a name the browser rejects) as "doesn't exist", because the old name scan returned false for such names and image paths come from card data.
- **Extras:**
  - `e2e/run.mjs` gained a `CM_ONLY=<text>` filter.
  - New e2e tests: recovery + automatic backup, one-card-per-page PDF, import preview with a windows-1252 file, and golden images.
  - The existing "server folders" test now waits for the folder picker's first listing before typing a path. In one full Edge run it failed with the picker still showing the home folder (it passed on every rerun); the wait removes that race from the test.
