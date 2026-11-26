# Architecture and file formats

This is the design target. Phase 0 implements the skeleton, and later phases fill it in. If the code and this document disagree, update this document in the same change.

## 1. Workspace layout (user data, outside the app folder)

```
MyCardGames/                     ← workspace, opened with "Open folder"
  workspace.json                 ← list of games, UI preferences
  library/                       ← shared by every game
    fonts/  icons/
  games/
    ember-tcg/                   ← one game
      game.json                  ← fields, card size, icons, keywords, stats
      templates/
        _base.json               ← shared layers (other templates extend it)
        unit.json
        spell.json
        back.json
      sets/
        core/
          set.json               ← set name, code, symbol, numbering rules
          cards.csv              ← the card data (one row per card)
      assets/
        frames/  art/  icons/  fonts/  symbols/
      export/                    ← generated output; safe to delete
```

A single game folder (with `game.json` at its root) can also be opened directly; it then acts as a workspace containing one game. `workspace.json` is optional.

Icons and fonts are looked up in the game's `assets/` folder first and then in `library/`. A game folder can be copied to another workspace and still work, except for the library assets it uses.

## 2. `game.json`

```jsonc
{
  "formatVersion": 1,
  "name": "Ember TCG",
  "card": {
    "widthMm": 63, "heightMm": 88,       // trim size
    "bleedMm": 3, "safeMm": 3,
    "dpi": 300,                          // design resolution; template units are px at this DPI
    "cornerRadiusMm": 3                  // preview and cut guides only
  },
  "fields": [
    { "id": "name",    "type": "text",   "identifying": true },
    { "id": "template","type": "choice", "source": "templates" },
    { "id": "cost",    "type": "number", "min": 0, "stats": { "bin": 1 } },
    { "id": "element", "type": "multi",  "choices": ["Fire","Water","Earth"],
      "colors": { "Fire": "#d33" } },
    { "id": "rarity",  "type": "choice", "choices": ["Common","Uncommon","Rare"] },
    { "id": "rules",   "type": "richtext" },
    { "id": "art",     "type": "image" },
    { "id": "count",   "type": "number", "default": 1, "role": "quantity" },
    { "id": "power",   "type": "number", "computed": "{cost} * 2" }   // optional computed field
  ],
  "icons": {
    "fire":  { "file": "icons/fire.svg" },
    "aliases": { "f": "fire" }
  },
  "keywords": [
    { "name": "Shield", "match": "Shield {n:number}",
      "reminder": "(Prevent the next {n} damage.)", "auto": "firstUse" }
  ],
  "statistics": [
    { "field": "cost", "numeric": true, "bin": 1 },
    { "field": "element", "splitList": true, "order": ["Fire","Water","Earth"] }
  ]
}
```

Field types: `text`, `richtext` (markup and icons), `number`, `boolean`, `choice`, `multi` (stored as `"Fire, Water"` in CSV), `image` (file name in an assets folder), `color`.

## 3. Templates

```jsonc
{
  "formatVersion": 1,
  "id": "unit",
  "extends": "_base",                 // inherit layers; override by layer id
  "faces": {
    "front": { "layers": [ /* ordered, bottom first */ ] },
    "back":  { "useTemplate": "back" }
  }
}
```

Layer types (full definitions: `src/model/types.ts`):

| Type | Properties |
|---|---|
| `image` | `src` (path in assets, may contain `{expressions}`), `rect`, `fit` (cover/contain/stretch), `focus` [x, y] 0..1, `radius` |
| `text` | `text` (with `{expressions}`; markup applies), `rect` **or** `polygon`, `font` {family, size, weight, style}, `color`, `align` (left/center/right/justify), `valign`, `lineHeight`, `paragraphSpacing`, `shrink` {min}, `letterSpacing`, `stroke` {color, width}, `shadow` {color, blur, dx, dy}, `iconScale`, `transform` (uppercase/lowercase), `reminders` (auto/all/none) |
| `shape` | `shape` (rect/roundrect/ellipse/polygon), `rect` or `points`, `radius`, `fill` (colour text or {type: linear/radial, angle, stops}), `stroke` |
| `icons` | `icons` (expression giving a comma list) or `repeat` {icon, count}, `rect`, `size`, `gap`, `direction` (row/column), `align` (start/center/end) |
| `group` | `layers`, `offset` [x, y], `clip` {shape, rect/points, radius} |

Every layer has `id`, `name`, `showIf` (expression), `opacity`, `blend` (canvas composite mode), `rotate` (degrees), `locked`, `hidden`.

**Inheritance** (`extends`): the child's entries in `layers` are applied to the parent's resolved layers in order. An entry whose `id` exists overrides properties (objects such as `font` merge; arrays such as `rect` replace; `null` deletes). A new `id` adds a layer at the end, or `after` / `before` another id. `remove: true` drops an inherited layer. This works inside groups too. See `src/model/resolve.ts`; the editor writes the smallest possible override (`src/model/templateOps.ts`).

**Colours** in `fill`, `color` and `stroke.color` may contain expressions, e.g. `"{color.element}"` or `"{if(rarity == 'Rare', '#e9b949', '#444')}"`.

**Expressions:** a small safe language (`src/expr/expr.ts`). Field references, `card.number`, `set.code`, `var.x`, `color.field`, arithmetic, comparisons (`==` ignores case), `and/or/not`, and functions `if, has, field, lower, upper, trim, len, count, contains, item, number, round, floor, ceil, abs, min, max, pad, repeat, replace`. They are parsed once and evaluated per card. Errors become render warnings; they never crash a render.

## 4. Card data: `cards.csv`

- UTF-8 CSV with a header row. The app writes it with a UTF-8 BOM and CRLF line endings, so Excel reads it correctly; the reader accepts it with or without the BOM. A file that isn't valid UTF-8 loads with a warning (`NOT_UTF8_WARNING` in `src/model/load.ts`). The column names are field ids, and unknown columns are kept and ignored.
- Reserved columns: `id` (stable, auto-generated if missing), `template`, `count` (quantity) if the game marks a field with `role: quantity`.
- Framing columns: `<image field>.frame`, e.g. `art.frame` = `1.2 0.5 0.35` (zoom, focus x, focus y; `src/model/framing.ts`). An image layer gets per-card framing when its `src` references exactly one image field; the value replaces the layer's `focus` and multiplies its cover/contain scale. Empty = the template's framing. These columns are not reported as unknown on load.
- XLSX is import/export only; CSV stays the saved format because it diffs well in git.

## 5. Renderer pipeline (`src/render/`)

```
card row + game + template
  → resolve template (inheritance, face)
  → evaluate expressions & showIf per layer
  → load assets (cached: images, FontFace)
  → draw layers to a canvas at the requested DPI
       text layer: parse markup → tokens (words, icons, styles)
                   → line breaker (rect or polygon widths per line)
                   → auto-shrink loop → draw
  → canvas (preview) | PNG blob | PDF page image
```

Rules:
- Everything is resolution-independent. Template units are px at the game's design DPI and are scaled to the output DPI.
- The renderer reports warnings (missing image, unknown icon, text overflow) as data. The UI shows them, and export lists them.
- Asset changes on disk are picked up when the app window regains focus, so the owner can edit a frame in an image editor and see it update. `AssetStore` remembers the file and modification time (`FileStore.modified`) behind each cached image, including misses; `refreshChanged()` drops only entries whose file changed, appeared or now resolves elsewhere, and the views redraw only when something was dropped.
- Number + icon: in `toAtoms` (`textLayout.ts`), a number word followed by one space and a word starting with an icon becomes one unbreakable word (the space is a normal-width text piece, so justify doesn't stretch it).

## 6. Source layout

```
src/
  expr/        expression parser + evaluator
  markup/      card-text markup → tokens; keyword reminder text
  model/       types, load/save, validation, migrations, template inheritance,
               card/template/game operations, statistics, CSV, XLSX
  render/      text layout (pure), asset loading, canvas drawing (no React)
  export/      page/sheet layout (pure), PNG / PDF / Tabletop Simulator exporters
  fs/          FileStore interface: BrowserFs (real folder via the File System
               Access API), ServerFs (real folder via the local server, for
               Firefox/Zen), MemoryFs (tests, demo), backup, copy,
               handleStore + draftStore (IndexedDB: last folder, recovery drafts)
  playtest/    playtest table rules (pure: players, hands, piles on the table,
               draw, shuffle, undo-friendly state), table geometry per seat
               (layout.ts) and deck files
  ui/          React: App + store (project state, dirty tracking, save),
               dirty.ts (which files need saving, pure), draft.ts (recovery
               drafts, pure), upload.ts (asset upload with replace question),
               golden.ts + DevSheet (dev-only golden-image hook),
               CardsView + grid/, editor/ (templates), stats/, export/, game/,
               playtest/, FolderPicker, toasts, GettingStarted, ShortcutHelp
server/        fileBridge.ts: reads/writes files for browsers without the File
               System Access API (a Vite dev-server plugin, and used by app.ts);
               app.ts + main.ts: the downloadable program (serves the built
               page with a fresh bridge token, opens the browser)
scripts/       package.mjs (standalone program + zip per system), smoke.mjs
e2e/run.mjs    browser tests (npm run e2e, needs npm run dev; CM_BROWSER=firefox
               or webkit runs them in Playwright's Firefox or WebKit)
samples/demo-workspace/   built-in development fixture (bundled into the app)
```

## 7. File access in browsers without the File System Access API

Chrome and Edge open folders directly (`BrowserFs`). Firefox, Zen and Safari can't, so the local server (the downloadable program, or the dev server) also serves a small file API (`server/fileBridge.ts`) and the app uses `ServerFs`:

- `GET /__card-maker/places`, `browse?dir=` and `POST mkdir?dir=&name=`: the folder picker.
- `GET exists | list | read ?root=&path=` (`exists` answers `{ exists, mtime }`; `mtime` is the file's modification time in ms, or null for folders and missing files), `PUT write?root=&path=&expect=<mtime>` (`&force=1` to overwrite anyway, `&plain=1` for exports), `POST remove`: the FileStore operations. `write` is atomic (temp file + rename) and copies the old file to `.bak`. It answers 409 when the file's modification time differs from `expect` (changed by another program).
- Every request must carry the header `x-card-maker-token`. The token is random per server start and is put into the page as `<meta name="card-maker-bridge">`. Requests must also be addressed to localhost. Paths are resolved inside `root`; anything that escapes it is refused.
- The token is added when the page is served, never at build time: the Vite plugin runs only in the dev server (`apply: 'serve'`), and the program's server (`server/app.ts`) puts a fresh token into `index.html` on every start. A static copy of `dist/` served some other way has no token, so it falls back to Chrome/Edge-only folder access.
- `GET /__card-maker/hello` (no token, says only `{ app: 'card-maker' }`) lets a second start of the program find the one already running and just open the browser.

## 8. Playtest decks: `decks/<id>.json`

```json
{ "formatVersion": 1, "name": "Fire aggro", "cards": [{ "card": "core/c001", "count": 3 }] }
```

`card` is `<set folder>/<card id>`. Unknown cards are skipped with a warning. Game settings for the table live in `game.json`:

```json
"playtest": { "handSize": 5, "drawPerTurn": 1, "counters": [{ "name": "Life", "start": 20 }] }
```

## 9. Card shape and CMYK printing

- `TemplateDef.orientation`: `"portrait"` (default) or `"landscape"`. It is inherited through `extends`; a face with `useTemplate` uses that template's shape (`isFaceLandscape` in `src/model/resolve.ts`). `templateSize(game, landscape)` and `outputSize(..., landscape)` swap width and height; `renderCard` works it out itself and reports `landscape` in its result. Print and TTS exporters turn landscape faces upright with `quarterTurn` (fronts clockwise, backs counter-clockwise for long-edge duplex).
- `src/export/cmyk.ts` converts RGBA pixels to CMYK. `simpleConverter` uses a formula with black generation and an ink limit. `iccConverter` reads an ICC v2/v4 CMYK output profile (`mft1`, `mft2`, `mBA ` tables with `curv`/`para` curves; Lab or XYZ PCS): sRGB → XYZ D50 → Lab → the profile's B2A table, sampled on a 33³ grid and interpolated. Neutral greys can be forced onto K, and white is always bare paper. In the PDF, card images are DeviceCMYK Flate streams, crop marks are K-only, and a profile is embedded as a `GTS_PDFX` output intent.

## 10. The FileStore interface (`src/fs/types.ts`)

Every store implements `name`, `writable`, `exists`, `readText`, `readBlob`, `writeText` (atomic, `.bak`, conflict check), `writeBlob` (no backup), `remove` (keeps `.bak`), `list`, and since November 2026:

- `key: string` identifies the workspace between sessions for the recovery draft. `ServerFs`: the folder's absolute path. `BrowserFs`: `browser:<folder name>` (the browser doesn't reveal paths); the `?opfs` dev store uses `opfs:dev`. `MemoryFs` (demo, tests): `''`, which means "never keep a draft".
- `modified(path): Promise<number | null>` returns a number that changes when the file changes, or null when there is no such file. `BrowserFs`: `File.lastModified`. `ServerFs`: the `mtime` from the bridge's `exists` answer. `MemoryFs`: a per-file write counter.
- `BrowserFs.exists` asks for the entry by name (`getFileHandle`, then `getDirectoryHandle`) instead of listing the parent folder. Missing names, type mismatches and names the browser rejects all count as "doesn't exist".

The recovery code wraps stores in two small read helpers (`src/ui/draft.ts`): `ReadRecorder` passes everything through and records a hash of each text file read, and `DraftOverlay` is a read-only view with the draft's text in place of the drafted files (new files and folders appear, deleted templates disappear).

## 11. Saving, backups and recovery drafts

- **Dirty tracking** (`src/ui/dirty.ts`): a map of unsaved entries (`template`, `templateDelete`, `cards`, `set`, `game`). Every edit stores a new entry object. Save writes a snapshot of the map, reading each file's content from the latest workspace as it goes, then removes only entries that are still the very same object (`afterSave`), so edits made during a save stay unsaved. `dirtyFile(game, entry)` gives the path and text to write; Save and the draft both use it.
- **Automatic backup:** the first save after a workspace is opened calls `backupWorkspace(fs)` (all JSON/CSV into `backups/<date>_<time>/`) before writing. A failure is reported in the error banner, and the save goes ahead.
- **Recovery draft** (`src/ui/draft.ts`, stored by `src/fs/draftStore.ts`): an IndexedDB database `card-maker-drafts`, object store `drafts`, one record per `FileStore.key`:

  ```jsonc
  { "formatVersion": 1, "key": "C:\Games\MyCardGames", "savedAt": 1763100000000,
    "dirty": [ { "kind": "cards", "game": "games/ember", "set": "core" } ],
    "files": [ { "path": "games/ember/sets/core/cards.csv", "text": "…", "base": "1234:9f3a…" } ] }
  ```

  `text` is what Save would write (null for a deleted template). `base` is a hash (`hashText`, length + FNV-1a) of the file as it was read from disk or last saved; the store records these hashes while loading, through `ReadRecorder`. The draft is written about 2 s after the last edit, deleted after a fully successful save, on Discard, and when the owner agrees to throw away unsaved changes. On open, a found draft is offered in a banner; `changedOnDisk` lists drafted files whose disk text no longer matches `base`. Restore loads the workspace through `DraftOverlay` (which still reads each real file, so the store's conflict check stays correct) and marks the draft's entries unsaved.

## 12. Golden-image tests

`e2e/run.mjs` opens `?sheet&golden` (dev only). `DevSheet` then installs `window.cmGolden` (`src/ui/golden.ts`), which renders demo faces with the shared renderer (export mode, with bleed, at the design DPI) and compares them with a reference PNG inside the page using canvas `getImageData`. Faces checked: every card's front, and each back template once. References live in `e2e/golden/<edge|firefox>/`, named like `c001-front.png` and `back-back.png`. A pixel differs when a channel is off by more than 16 (`CHANNEL_TOLERANCE`); a face fails above 0.05 % differing pixels (`MAX_DIFF_RATIO`). Failures write `<name>.actual.png` and `<name>.diff.png` to `e2e/output/<browser>/` (git-ignored). A missing reference is created and reported; `CM_UPDATE_GOLDEN=1` rewrites all of them.

## 13. Second research round (2026-11-20)

- `game.json` → `text.smartPunctuation` (boolean, optional): the renderer runs `smartPunctuation` (`src/markup/typography.ts`) on text layers after keyword reminders and before markup parsing. New games turn it on; existing games keep it off until ticked in Game settings.
- `RenderResult.boxes[].frame` (`FrameBox`): for framable pictures, the field, the current zoom and focus, and the slack (box size minus drawn picture size). `CardPreview` uses it to turn a drag into a focus change (`focus += dx / slack`) and the wheel into a zoom step, keeps the change as a draft while the pointer moves, and commits once on release (wheel: after 400 ms) through `CardsView.setFraming`, so one gesture is one undo step.
- `src/ui/vision.tsx`: SVG `feColorMatrix` filters (Machado et al. 2009, severity 1) applied with CSS `filter` to the preview canvas only.
- `src/model/findReplace.ts`: pure find and replace over the game's non-computed fields; the dialog commits all changed cards at once.
- `src/export/gallery.ts`: renders card fronts with the shared renderer, embeds them as JPEG data URLs in one HTML page (`galleryHtml`, unit-tested) with inline CSS and script and no network access.
- `src/playtest/odds.ts`: exact hypergeometric odds (`atLeast`, `cardsSeen`), shown by `DeckOdds` in the deck editor.

## 14. Ideas round (2026-11-20): checks and playtest tools

- **Print check** (`src/render/preflight.ts`): `renderCard` now reports, per layer box, a `check` (`LayerCheck`: layer type, where ink landed, text size after shrink and as designed, overflow, picture pixel size and drawn size, outline width). `checkFace` turns those into `PrintIssue`s using `printRules(game)` (game.json `print`). Group offsets are applied to `check.ink` like to the box itself. Colours: `iccGamutDelta` in `cmyk.ts` round-trips sRGB through the profile's B2A and A2B tables (relative colorimetric) on a 17³ grid and measures the CIE94-weighted chroma/hue shift (lightness left out, small allowance for very dark colours); `gamutMask` applies it per pixel with `GAMUT_THRESHOLD` 8. UI: `ui/export/PrintCheck.tsx` (renders at 100 DPI) and the preview's *print check* toggle.
- **Stress test** (`src/model/stress.ts`): `stressCards` builds made-up cards (longest values, empty fields, combinations of the choice/multi/boolean fields any layer mentions, capped at 36); `neverShown` evaluates each layer's show-if against the real cards. UI: `ui/editor/StressTest.tsx`, which only flags overflow and text that shrank below the minimum (`designSize` vs `fontSize`).
- **Playtest snapshots** (`src/model/playtestTags.ts`): `playtests/<slug>/` inside the game folder holds `tag.json` (`formatVersion`, name, date) and copies of game.json, templates and each set's cards.csv and set.json. `loadTag` opens it through `SubFs` (`src/fs/subFs.ts`, a read-only view of a sub-folder) with the normal loader. `changedSince` = `diffCards` (values per card id) plus cards whose resolved template faces or drawing settings changed. The Export tab's *Cards from* offers `tag:<slug>`.
- **Feedback** (`src/model/feedback.ts`): gallery pages made with `feedback: true` carry vote buttons and a note per card (kept in the playtester's localStorage) and save `{ formatVersion: 1, kind: "card-maker-feedback", game, gallery, reviewer, date, cards: { "<set>/<card id>": { votes, note } } }`. Files are kept as they are in `<game>/feedback/`; `summarizeFeedback` keeps each reviewer's newest file and sums per card.
- **Balance** (`src/model/balance.ts`): least squares with ridge 0.1 on the non-intercept terms (normal equations, Gaussian elimination). Terms: other number fields, keywords (number parameter or 1), templates other than the most common; or one term from game.json `balance.value`. `balance.cost` names the cost field. UI: `ui/stats/BalanceView.tsx`.
- **Wording check** (`src/model/lint.ts`): keyword typos (edit distance 1, or 2 for names of 8+ letters), keyword case at a line or sentence start, near-duplicate sentences (word-level edit distance with plurals counting half, similarity ≥ 0.75, sentences of 4+ words, numbers as #), house style rules from game.json `style`, spacing. UI: `ui/grid/WordingDialog.tsx`.
- **Colour check** (`src/model/colourVision.ts`, shared with the preview filter): `colourClashes` simulates each field colour pair per vision type and reports CIE76 ΔE under 20.
- **Print cost** (`src/export/cost.ts`): `costOptions` uses `pageLayout`/`orientPage` for each priced paper size and orientation, plus card-by-card printing. Prices are kept in localStorage per game (`ui/export/CostPlanner.tsx`).

New optional game.json keys (no format change, all optional): `print`, `balance`, `style`.

## 15. UI structure (design language, command bar)

- `src/ui/theme.css` (loaded last by `main.tsx`) holds the design tokens (`--bg`, `--panel`, `--panel-2`, `--text`, `--muted`, `--border`, `--accent`, `--attn`, `--hi`, `--mat`…), fonts, base controls, the slug bar, index tabs, chips, segmented controls, menus, sheets, the cutting mat and crop-mark styles, and the command bar. Older sheets keep layout rules only; see `docs/design.md`.
- `src/ui/commands.tsx`: `CommandProvider` (in `main.tsx`), `useCommands(scope, commands, active)` for views to register their actions while visible, `CommandBar` (Ctrl+K) and `matchScore` (fuzzy ranking, unit-tested). App registers the global commands (tabs, file actions, sets).
- `src/ui/useEscape.ts`: closes the top-most dialog with Escape regardless of focus.
- `src/ui/RegMark.tsx`: the registration-mark icon.
- `MenuButton` items can be actions (with a shortcut hint), headings or separators.
- The mat's grid scale comes from a CSS variable `--mm` set on the stage by `CardPreview` and `TemplateCanvas` (displayed px per mm, from a ResizeObserver).

## 16. The Cards workbench

- `CardsView` lays out `src/ui/workbench/CardList.tsx` (list with thumbnails from `useCardImages(..., { widthPx: 72, backs: false })`), `CardPreview` as the stage (`.wb-stage`; the card fits the stage via a size container query and `--ar`), `src/ui/workbench/CardInspector.tsx` (a form per field type; text commits on blur/Enter) and the sheet drawer (`CardGrid`). Undo/redo/find/sheet shortcuts are handled once on the workbench root.
- Panel sizes: `card-list` and `card-inspector` widths via `usePanelWidth`; the sheet's open state and height in localStorage `card-maker:sheet`.
- `App` renders the mode rail (`.rail`, buttons keep the `tab` class and role) with `RailIcon.tsx`, the library sidebar, and the status line (`.status-line`).

## 15. The downloadable program

`npm run package` turns the app into one program per system with Node's *single executable applications*: `scripts/package.mjs` bundles `server/main.ts` into one CommonJS file with rolldown, embeds every file of `dist/` as an asset, runs `node --build-sea`, and on a Mac signs the result ad hoc (`codesign --sign -`), which Apple silicon requires. The zip holds the program, `READ ME FIRST.txt` (first-start steps for that system), `LICENSE.txt` and `THIRD-PARTY LICENSES.txt` (Node.js and every runtime dependency, collected from `node_modules`).

On Windows the script first copies Node, gives the copy the program icon (`icons/cardinal.ico`) and the name, description and version shown in Explorer (`rcedit`), and builds from that copy (`executable` in the config), so the app's embedded data is never rewritten afterwards. `scripts/icons.mjs` draws `icons/cardinal.ico` (16 to 256 px) and `icons/cardinal-256.png` from `docs/images/cardinal.svg` with the installed Edge; the results are kept in the repository so release builds need no browser. Mac and Linux programs are plain executables, which carry no icon.

Each system gets two programs from the same code, told apart by the embedded asset `launch.json` (`{ "mode": "app" | "browser" }`; `--app` and `--browser` override it):

- **app** (the "Cardinal" download): `server/launch.ts` finds Edge, Chrome or Brave (Edge is part of Windows) and opens the page with `--app=<url>` and its own `--user-data-dir` (`%LOCALAPPDATA%\Cardinal\browser`, `~/Library/Application Support/Cardinal/browser`, `~/.config/cardinal/browser`). Without one it opens the default browser. Every page served by the program keeps an EventSource connection to `/__card-maker/session` (the page reads its address from `<meta name="card-maker-session">`); when the last one has been closed for 8 seconds the program quits. If no window connects within 25 seconds, the default browser is tried; after 2 minutes the program gives up with a message. On Windows this program has no console window (its PE header says "GUI"), so messages are shown in a dialog and also written to `cardinal.log` next to the profile. On a Mac it is wrapped in `Cardinal.app` (`Info.plist` with `LSUIElement`, so only the window shows; icon `icons/cardinal.icns`), signed ad hoc as a whole.
- **browser** (the "Cardinal Browser" download): opens the default browser and runs until its console window is closed.

`server/main.ts` serves on `localhost:4673`. The port is fixed because the browser keeps recent folders, recovery drafts and settings per address; if it is busy, the next nine ports are tried and the user is told. Outside the program (`npm run app`) the same server reads `dist/` from disk.
