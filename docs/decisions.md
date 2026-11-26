# Design decisions

Choices made while building, especially the ones the owner may want to revisit. Newest at the bottom.

## Template coordinates include the bleed
Template positions are px at the game's design DPI, measured from the **top-left of the bleed area** (not the cut line). A 63×88 mm card with 3 mm bleed at 300 DPI is an 815×1110 px canvas. Frame art is usually drawn with bleed, so it lines up 1:1. The cut line and safe zone are shown as guides.

## Expressions are a small custom language, not JavaScript
`{cost + 1}`, `if(...)`, `contains(element, 'Fire')` and similar. It is parsed by our own code (`src/expr/expr.ts`) and never uses `eval`, so a template or CSV cell can't run code. Text equality (`==`) **ignores case**, because `rarity == 'rare'` should match "Rare". Text that looks like a number acts as a number.

## Keyword reminders only apply to "keyword lines"
A keyword gets reminder text only when its line consists of nothing but keywords separated by commas ("Swift, Shield 2"). This stops "Swift units you control…" in the middle of a sentence from getting a reminder. Each keyword can use `auto: "always" | "firstUse" | "never"`, and each text layer can force reminders on or off.

## Bold and italic markers need a partner
`*` and `_` only start bold or italic if a matching marker follows in the same paragraph. So `2 * 3` and `snake_case` stay literal. Use `\*` and `\_` to force a literal character.

## Placeholders show in the preview only
Missing or empty art draws a hatched "no image" box in the editor preview, but nothing in exports, so a half-finished set can still be test-printed. Unknown `[icons]` are drawn in red in both, and listed as warnings, because they are always mistakes.

## Rendering runs on the main thread
`renderCard` can draw to an `OffscreenCanvas`, but SVG icons need an `<img>` element, which Web Workers don't have. Exports render on the main thread in small batches, which is fast enough for sets of a few hundred cards.

## Own spreadsheet grid instead of a library
The card grid (`src/ui/grid/`) is our own component (about 500 lines) rather than a data-grid library. It needs field-aware editors (choice drop-downs, multi-choice checkboxes, multi-line rules text), validation markers and live preview. A library would need as much glue code, and the free ones lack some of these features. It handles Excel copy and paste, fill-down (Ctrl+D), multi-cell selection and undo.

## Own XLSX reader/writer instead of a library
`src/model/xlsx.ts` reads and writes the first sheet as text, using `fflate` for the zip part. The npm `xlsx` package (SheetJS) is outdated on npm and has a known security issue. The other options pull in several small, little-known dependencies. Card data is plain text, so a minimal implementation is enough.

## Sorting the grid doesn't change the file
Clicking a column header sorts the view only. "Keep this order" writes the order to `cards.csv`, which changes collector numbers (`card.number`).

## Saving
- Nothing is written until **Save** (Ctrl+S). The previous version of each file is kept as `<file>.bak`.
- If a file changed on disk since it was opened (e.g. edited in Excel), saving asks before overwriting.
- Deleting a template keeps its last content as `<file>.bak`.

## Browser tests use the installed Edge
`npm run e2e` drives the real app in Microsoft Edge via `playwright-core`, so no extra browser download is needed. The `?opfs` dev mode stores an editable demo copy in the browser's private storage, so the real save code is tested without a folder picker.

## CSV headers match fields ignoring case
A `cards.csv` with headers like `Name` or `Cost` is matched to the fields `name` and `cost` (by id or label). When saved, the headers are written as the field ids.

## Game settings edits are applied to the latest state
Edits in the Game settings tab go through `project.updateGameDef(game, fn)`, which applies the change to the current settings. Code that runs after a file upload can't overwrite an edit made just before it. This bug was found by the browser test and fixed.

## Print PDF details
- Cards stay upright and are centred on the page. Gap 0 means neighbouring cards share one cut line. When bleed is printed, cards are spaced so their bleeds don't overlap.
- Double-sided: after each front page comes a back page with the columns mirrored, for printers that flip on the long edge. The back offset setting corrects printers that shift one side.
- JPEG at 95% quality is the default image format (much smaller files). PNG is available.
- Browsers render in RGB. True CMYK output is not supported (see the open questions in CLAUDE.md).
- `pdf-lib` is loaded only when a PDF is made, which keeps the app quick to start.

## Statistics colours
Charts use the validated reference palette from the data-viz guidelines (`src/ui/stats/stats.css`), with separate light and dark steps. If a field defines its own colours in game.json (e.g. elements), those are used for its values. Every chart has a Table view, because some light-mode colours are below 3:1 contrast.

## Firefox and Zen open folders through the local server
Only Chromium browsers have the File System Access API, and the owner's main browser is Zen (Firefox-based). The dev server that `start-cardinal.bat` already runs now also reads and writes files for the page (`server/fileBridge.ts`). It is still local only: it answers only on localhost, needs a random per-start token that other websites can't read, and keeps every path inside the opened folder. It gives the same safety as the Chrome path: atomic writes, `.bak` copies, and refusing to overwrite files changed by another program. Chrome and Edge keep using their own folder picker. Other options were rejected: read-only `<input webkitdirectory>` plus zip downloads would have meant no real saving, and browser-private storage (OPFS) would have kept files away from Excel and Explorer.

## Copying the demo never mixes into a folder that has files
If the chosen folder isn't empty, the demo goes into a new `Cardinal demo` subfolder. This rule came from a browser-test bug: a race in the folder picker sent a demo copy into a home folder. The picker now ignores slow, outdated folder listings, and its confirm button only works once the typed path has been opened.

## Playtest table
- One to four players at one screen ("hot seat"), one per edge of the table. Each has a hand, counters, and a deck and discard pile that lie on the table as movable piles, like Tabletop Simulator. More piles can be added: a shared deck (a market, a monster deck) or an empty pile (exile, set aside). The rules are pure functions in `src/playtest/table.ts`, so undo is a list of earlier states.
- Table positions are in table units, and the view scales the whole table to fit, so a game looks the same in any window size. `src/playtest/layout.ts` gives every seat its own frame (along the edge, towards the middle) so the deck spots, home strips and the next free spot for a played card are worked out once for all four seats.
- A card on the table faces the player it belongs to on the table (`side`), turned 0°, 90°, 180° or 270°. The hand, the zoom above it and the large preview are always upright, because they are for reading.
- Hidden information: only the hand of the player at the screen is drawn. Next turn (or *Show hand*) replaces the whole view with a hand-off screen until the next player presses a button, so nobody sees another hand while the screen changes owner. With several players the log never names a card that went from a hidden place to another hidden place. Face-down cards on the table show their face only in the preview of the player who controls them.
- A card taken from a face-down pile lands face down on the table, as in Tabletop Simulator, so drawing from a shared deck onto the table does not reveal it by accident.
- Play goes clockwise from the first player, as at a real table. Untap at the start of a turn only untaps that player's cards.
- Online play was not added: the app is local only, and the owner playtests with other people in person or at one screen.
- Shuffles use a seeded random generator (mulberry32), so tests are repeatable.
- Cards are drawn with the shared renderer at 360 px wide and cached until the card or template changes.
- Drag and drop uses pointer events rather than HTML drag-and-drop, which behaves differently in Firefox and Chrome.
- Decks are their own small JSON files (`decks/*.json`) and are saved when you click **Save deck**, separately from the project's Save button. A deck is an explicit, self-contained action, like an export.
- Game-specific settings (hand size, draw per turn, counters such as life) come from `game.json` → `playtest`, so nothing in `src/` assumes a particular game.

## UI follows the Laws of UX (lawsofux.com)
The changes and the law behind each:
- **Hick's law / choice overload:** the toolbar went from up to 8 buttons to a folder menu, **?** and **Save**. The Cards tab's Import/CSV/XLSX became one **Spreadsheet** menu.
- **Von Restorff:** only one primary (filled) button per screen: Save when there are changes, **Continue with…** or **Open a folder…** on the welcome screen, and the export button.
- **Fitts's law:** buttons are at least 30 px tall, welcome buttons 44 px, and layer-list and sidebar rows are taller. Counter +/− buttons are 34 px.
- **Serial position:** the tabs run from most used (Cards) to settings (last). Save is at the far right, the folder at the far left.
- **Proximity / common region:** the export "Save to" choice sits next to the export button. Playtest buttons are grouped in outlined regions (turn, deck, random), and the selected game is one bordered region in the sidebar.
- **Chunking / Miller's law:** Game settings has jump links to its 8 sections.
- **Doherty threshold:** a toast confirms every save, backup and copy within a moment. Playtest shows how many card pictures are still being drawn.
- **Goal-gradient / Zeigarnik:** the sidebar's getting-started checklist with a progress bar.
- **Paradox of the active user / Tesler's law:** help in context instead of a manual: a **?** shortcut sheet, tooltips on every toolbar button, key hints under the playtest zoom, and the welcome screen's "Which folder should I open?".
- **Postel's law:** the folder picker accepts pasted paths with quotes or forward slashes. The playtest settings accept anything and fall back to defaults.
- **Peak-end rule:** errors go in a banner that stays until dismissed. Successes are short toasts that don't block (no more alert boxes).
- **Accessibility:** visible keyboard focus. In dark mode, text on the accent colour is dark, because white text on that colour had too little contrast. Animations are turned off with "reduce motion".

## Horizontal cards are a template setting
"Vertical or horizontal" is decided per template (`orientation`), not per card or per set, because the layout is what differs. A set mixes them freely by giving cards different templates. The physical card size stays one per game; horizontal means the same card turned sideways. Print sheets keep one upright grid (sideways cards are rotated into it), so one cut pattern works for the whole sheet. That is how printers and Tabletop Simulator expect mixed decks.

## CMYK printing
- The browser can only draw RGB, so cards are rendered as usual and the pixels are converted. Everything on a print sheet is already a raster image, so nothing vector is lost.
- With the print shop's ICC profile the conversion follows that press. Without one, a standard formula is used, with an ink limit and black kept on the K plate. The formula is good enough for proofs and most digital print shops, but colours can differ from what the shop's own software would make.
- Cardinal reads ICC profiles itself (about 300 lines in `src/export/cmyk.ts`) instead of using a library. The free options are either GPL (LittleCMS ports) or large WebAssembly bundles. The reader is checked against Windows' own `RSWOP.icm` in the unit tests: inks decode to the expected SWOP colours, and colours survive a round trip as well as the profile's own tables allow.
- White is always bare paper, even when a profile would add a faint tint. A tint on every white area would print as visible dots.
- CMYK images are stored lossless (Flate), because a CMYK JPEG encoder isn't available in the browser. Files are bigger; that's the trade-off.
- It isn't full PDF/X: the output intent is there, but on sheets no trim boxes are set per card (a sheet holds many cards). The *one card per page* layout does set TrimBox and BleedBox (see below). Most shops accept this. If one insists on PDF/X-1a, their prepress can convert it.

## Saving is safe while you keep editing (November 2026)
Save writes the files that were unsaved when you clicked it, each with the latest content at the moment it is written. A change made while a save is running stays marked as unsaved, so the next Save writes it and the close-tab warning still fires. (Before, such a change could lose its "unsaved" mark and never be written.) The bookkeeping is in `src/ui/dirty.ts`.

## CSV files start with a BOM
Every CSV the app writes (`cards.csv` and CSV downloads) starts with a UTF-8 byte order mark. Without it, Excel on Windows reads the file in the old Windows code page, shows accented letters and symbols as garbage, and can save that garbage back. Other tools (git, text editors, Python) handle the BOM fine, and the app's own reader strips it. When the app loads a `cards.csv` that is not valid UTF-8 (usually Excel's plain "CSV"), it warns and leaves the file alone until you save; the import dialog reads such files as windows-1252 and says so.

## A dated backup before the first save of each session, never pruned
The `.bak` next to each file only holds the previous save, so saving a mistake twice lost the good version. Now the first save after opening a folder first copies every game, template and card file into `backups/<date>_<time>/`. That folder holds the files as they were before this session's edits. A failed backup doesn't block the save: the files are saved and the error banner says why the backup failed. Old backups are never deleted automatically: they are small text files (a few KB each), and deleting user files needs a question. Delete old ones by hand when you like.

## Asking before replacing an uploaded file
Adding icons, fonts, artwork or an ICC profile used to overwrite a file of the same name silently. Now the app lists the names that already exist and asks once. OK replaces them and keeps each old file as `<name>.bak`; Cancel keeps the existing files and copies only the new ones. Exports into `export/` still overwrite without asking, because they are generated files.

## A recovery draft instead of autosave
Save stays explicit: the real files only change when you save, so a half-finished edit never lands in a file that Excel or git is also looking at. To survive a browser crash or power cut, the app keeps a **draft** in the browser's IndexedDB about 2 seconds after the last edit. It holds the exact text each unsaved file would get on Save, plus a fingerprint of each file as it was on disk. On the next open of the same folder a banner (not a modal, so you can look around first) offers **Restore** or **Discard**. Restore loads the workspace as if the drafted files were saved and marks them unsaved, so the normal Save writes them, with its usual backups. If a drafted file changed on disk in the meantime, the banner says so before you restore. The draft is deleted after a successful save, on Discard, and when you agree to throw away unsaved changes (Reload, opening another folder). While a recovered draft waits for an answer, new edits don't replace it.
- A workspace is recognised by `FileStore.key`: the full path for folders opened through the local server (Firefox, Zen), but only the folder **name** in Chrome and Edge, which don't reveal paths. Two different folders with the same name share one draft there; the "changed on disk" check catches most mix-ups. The built-in demo never keeps a draft.

## Numbers stay with the icon after them
In card text, `2 [fire]` never breaks between the number and the icon, the same as `2[fire]`. Only a plain number (optional sign, decimals, a trailing `x` or `×`) followed by one space and an icon is glued, and only in that direction. The space keeps its normal width, so justified text doesn't stretch it. If a line is too narrow even for the glued pair, it is split like any long word.

## One card per page for print shops
Many card printers arrange (impose) the sheets themselves and want one card per page. The PDF export has a *Layout* choice: *Sheets* (as before) or *One card per page*, where every page is exactly the card plus bleed, with no margins or crop marks, and the PDF's TrimBox and BleedBox mark the cut line for the shop's software. Sideways cards are turned upright exactly as on sheets, so every page has the same size. Backs can come after each front or in a separate `…-backs.pdf` in the same order (the shop decides which). A card without a back still gets a blank back page, so fronts and backs stay paired. The **Print shop preset** button only fills in the options (one card per page, bleed, 300 DPI, no crop marks); colour is left alone, because many digital shops prefer RGB and convert it themselves.

## Golden-image tests
`npm run e2e` renders every demo card front, and each back template once, with the shared renderer at the design DPI and compares them with reference PNGs in `e2e/golden/<edge|firefox>/`. References are per browser because each browser rasterises fonts slightly differently. The comparison runs inside the page with canvas `getImageData`, so no image library is needed. A pixel differs when any channel is off by more than 16; a card fails when more than **0.05 %** of its pixels differ. The improvement plan suggested 0.5 %, but a measurement showed that one word moving to the next line changes only 0.3–0.5 % of a card's pixels, so 0.5 % would have missed exactly the changes the test is meant to catch. The same browser on the same machine draws identical pixels each run, so 0.05 % (about 450 pixels) leaves enough room for noise. After a browser update or an intended rendering change, look at the pictures in `e2e/output/` and run `CM_UPDATE_GOLDEN=1 npm run e2e` to accept the new look. The references take about 10 MB (Edge) and 2.5 MB (Firefox).

## Images reload only when their file changed
When the app window regains focus, it used to forget every cached image and redraw every preview and every playtest card, even when nothing had changed. Now each cached image remembers which file it came from and that file's modification time (also for images that were missing). On focus only the images whose file changed, appeared, or now resolves to a different file are reloaded, and the views redraw only if one was. The file stores got a small `modified(path)` call for this; the local server reports the time with its `exists` answer.

## Print sheets can be landscape
Sheet PDFs have a page orientation: *Best fit* (default), *Portrait* or *Landscape*. Best fit tries both and keeps the one that holds more cards, portrait on a tie. Poker cards (63 × 88 mm) with 3 mm bleed fit 6 on portrait A4 but 8 on landscape; without bleed portrait wins (9 vs 8). The cards themselves stay upright on the page as before. Double-sided printing still mirrors the columns, which means "turn the sheet over sideways". For a portrait page that is the printer's *flip on long edge*; for a landscape page it is *flip on short edge*, so the option text names the right edge for the chosen orientation. The pure choice is `orientPage` in `src/export/layout.ts`.

## Exports default to 600 DPI
The PDF and PNG exports and the print-shop preset now default to 600 DPI. The game's design DPI is unchanged; it only sets the units templates are measured in. Reasoning, checked against published sources:
- 300 PPI comes from 20/20 acuity (1 arcminute) at about 30 cm. Sharper eyes resolve about 0.5 arcminute, which is about 600 PPI at 30 cm, so "above about 460 is invisible" is a fair middle value for close viewing, not a hard limit.
- For photos and painted art, extra pixels stop helping at about twice the press's halftone screen (1.5–2 × LPI, about 300 PPI at 150 LPI).
- Cardinal draws text, icons and frame lines into the picture instead of sending them as vector text, which a press would print at its full device resolution. Sharp edges are where 300 PPI can show, so 600 is the sensible default for this app.
- Cost: four times the pixels. Exports take longer and PDFs get bigger (lossless CMYK about four times). 300 stays available for proofs.

Saved export options from before this change that still say 300 (the old default) move to 600 once; any other saved value is kept.

## Side panels are resizable
The sidebar, the Cards preview, the template list, the template layer panel and the playtest side panel each have a drag handle (`src/ui/ResizeHandle.tsx`). Widths are kept in the browser's localStorage like the export options, because they are a per-screen preference, not project data. Each panel has a minimum and maximum width, and the middle area always keeps at least 320 px. The handle also works with the keyboard (arrows, Shift for bigger steps, Home or Enter to reset) and resets on double-click.

## Menus are placed against the window
The Cards tab's **Spreadsheet** menu was clipped on its left side, because the grid panel hides overflowing content. `MenuButton` now positions its menu with `position: fixed`, lines its right edge up with the button when there is room, and otherwise moves it so it stays at least 8 px inside the window (`menuPosition`, unit-tested). It closes when the window is resized or scrolled, since it no longer moves with the page.

## Second research round: which gaps were filled
See the comparison in `docs/research.md`. Built: per-card art framing, find and replace, typographic punctuation, spell checking, a colour-blind preview, a gallery page export and draw odds. Left for the owner to decide: curved text, enumerations, QR codes, build variants. Not planned because they need the network: print-service uploads, AI generation, multiplayer.

## Art framing lives in the card data, next to the image
A card's zoom and focus are stored in `cards.csv` as `<field>.frame` (three numbers in one cell), because the framing belongs to that card's picture, not to the template, and must survive copying the set or editing it in Excel. One cell instead of three columns keeps the spreadsheet narrow. The template still decides the box, fit and default focus; an empty cell means "as the template says", so templates can change without touching cards. Which field a picture comes from is found from the layer's `src` (exactly one image field referenced), so existing templates work without changes. Dragging moves the picture with the mouse, the wheel zooms in steps of 10 %, double-click resets, and each gesture is one undo step.

## Typographic punctuation is a game setting, applied at render time
Curly quotes and dashes are applied when the card is drawn, not written into the cells, so `cards.csv` stays plain ASCII-friendly for Excel and search, and the setting can be turned off at any time. It is per game because some games want straight quotes (e.g. for inch marks). New games turn it on; existing games, including the demo, keep it off so their look does not change without asking.

## Spell checking uses the browser's checker
The browser already has a spell checker with a personal dictionary in the user's language. It is turned on for text and rules cells while editing (and off for numbers, file names and expressions). A built-in dictionary would add megabytes and still not know the game's own words.

## Colour-blind preview is a display filter, not a second renderer
The filter is applied with CSS to the preview canvas, so the shared renderer and all exports stay untouched (WYSIWYG still holds for what is printed). The matrices are the published Machado, Oliveira and Fernandes (2009) model at full severity, plus a greyscale view for brightness contrast.

## Gallery page is one self-contained HTML file
Pictures are embedded as JPEG data URLs, and the CSS and search script are inline, so the file can be sent by chat or e-mail and opened anywhere without Cardinal or a network. The cost is size: about 30 KB per card at 400 px for the demo’s simple cards (measured), more with detailed art, which is still fine for a set of a few hundred cards.

## Draw odds are exact, not simulated
The hypergeometric formula gives the exact chance of drawing at least k of K cards in n draws from N, instantly and with no randomness, so the numbers do not jump around while the deck changes. It ignores mulligans and card effects that search or draw extra cards; the Playtest table is there for those.

## Grid: clicking a half-hidden cell selects that cell
Found while testing art framing: clicking a cell that was partly hidden at the grid's edge scrolled the grid under the still mouse, the browser then reported the pointer over the neighbouring cell, and the selection jumped there. The grid now extends a drag selection only when the mouse has really moved since it was pressed.

## Ideas round: eight new tools (see docs/ideas.md)
Built: print check, template stress test, playtest snapshots with changed-cards reprint, gallery feedback, balance lens, wording check, colour check, print cost planner. Tested on the demo workspace; each has unit tests and a browser test.

## Print check reads what the renderer did, it doesn't draw again
The renderer already knows every layer's final text size, where text landed, the picture's pixel size and drawn size, and outline widths. It reports these facts per layer box, and the print check is a pure function over them. So the check always matches what is printed, with no second drawing path (WYSIWYG rule).

## Print check limits
300 PPI for art (150 counts as a problem, not just a warning), 6 pt for text, 0.25 pt for lines: common print-shop guidance. They can be changed per game (`print` in game.json). Text that is small by design (e.g. a collector line) is reported once by the print check, but the stress test ignores it and only flags text that had to shrink, because that is the part the card's content causes.

## Out-of-gamut colours: chroma and hue only, CIE94-weighted, threshold 8
A plain colour difference flagged nearly every dark area (a dark navy card back came out 97 % "out of gamut") because presses print the darkest screen colours lighter; that is expected and not what makes a print disappointing. Leaving lightness out and weighting with CIE94 matches what people notice: lost colourfulness and hue shifts. Measured with Windows' SWOP profile, greys, skin tones and the demo's gold and red stay under 6, while screen blue (17.5), cyan, magenta and pure green (8.9) go over; 8 separates them. Very dark colours get a small allowance because the profile tables are least exact there (a dark grey moves about 6). The check needs the shop's ICC profile; the built-in conversion has no gamut to compare against.

## Playtest snapshots are plain copies inside the game folder
`playtests/<name>/` holds copies of the data files, so a snapshot can be opened, diffed in git or deleted by hand like anything else. Art and fonts are not copied (large, rarely changed), so "what changed" means data and templates. "Looks different" is decided by comparing each card's resolved template and the drawing settings, not by drawing, so the Export tab's *Changed since* filter is instant.

## Feedback travels as files, not through a server
The gallery page keeps votes in the playtester's browser and saves a small JSON file when they press Send. The owner adds the files in Cardinal, which keeps them in `feedback/`. No account, no network, works by chat or e-mail. A newer file from the same name replaces the older one, so people can update their opinion.

## Balance lens is a guide, with ridge regularisation
With a few dozen cards and several terms, plain least squares gives wild numbers. A small ridge penalty (0.1) keeps "what is a keyword worth" sensible. The text says clearly that the model can't read what card text does; listed cards are worth a look, not wrong. Spells or other cards whose value is mostly in text will always stand out; filtering by template compares like with like.

## Wording check: conservative on purpose
Only clear cases are reported: keyword misspellings within one or two letters (keywords of 5+ letters), keyword case only at a line or sentence start (so "a swift unit" in normal English is fine), near-identical sentences of 4+ words, double spaces. A tool that cries wolf on hundreds of cards gets ignored.

## Colour check threshold
Pairs with a colour difference (CIE76) under 20 after simulation are listed. 20 is roughly where two colours on a small icon or a thin frame stop being obvious at arm's length; the demo's elements show the common case: all three have almost the same brightness, so they vanish in greyscale.

## Print prices stay in the browser
Shop prices are a per-person setting that changes with the shop, not part of the game design, so they are kept like the export options (localStorage per game), not in game.json.

## UI pass 2: a design language of its own ("Proof Room")
The full spec is `docs/design.md`. The short version and the reasons:
- **Why a theme at all:** the old look (system font, default indigo, a box around everything) was the generic look of countless web apps. A tool for making printed cards can borrow the visual language of print production instead: paper and ink colours, a cutting mat under the cards, crop marks, condensed caps like the slug line on a proof. It is a voice, not a costume: no textures, no fake materials.
- **Colours have one meaning each** (Apple HIG colour): ink is the single primary action (Save, Create PDF, Start game), cyan is interactive state, magenta is "needs attention" (the proofreader's pen), yellow only highlights. States always also have a shape or word, never colour alone (lawsofux Von Restorff).
- **Bundled IBM Plex** (OFL-1.1, via @fontsource): one family in three cuts keeps type consistent (HIG: few typefaces). Plex Mono for every number, id and expression makes values line up and read as data. OFL is the standard permissive font licence; fonts are bundled, never fetched.
- **Toolbars in three areas, rare actions under More** (HIG toolbars; NN/g progressive disclosure, two levels at most): the Cards toolbar went from two wrapped rows of eleven controls to one row; set name and code moved into **More → Set name and code…**, because renaming a set is rare.
- **Command bar (Ctrl+K)**: every toolbar action is also a searchable command with its shortcut (HIG: "make every toolbar item available as a command"; NN/g accelerators; Nielsen 7). Views register their commands only while their tab is shown, so the list stays short (Hick). Ctrl+F stays the browser's find: common shortcuts are not overridden.
- **Hideable sidebar** (HIG sidebars: let people hide it; Ctrl+\ and a button at the leading edge), and **Alt+1…6** for the tabs.
- **Crop marks instead of a dashed box, and a millimetre mat** (Jakob's law for print people: these are the marks they know; Prägnanz). The mat's grid is set from the card's real size, so 10 mm on the mat is 10 mm on the card.
- **The playtest table stays green felt**: it is where games are played, not where cards are cut, and its hint text is designed for the dark felt.
- **Escape closes every dialog, wherever the focus is** (Nielsen 3, user control and freedom). Found while testing the command bar: a dialog opened from the bar kept the focus outside itself and ignored Escape.
- **Single-series charts are drawn in ink**, like a printed chart; charts split by a field keep the validated categorical palette.

## Layout: the Workbench
Chosen by the owner from three options (workbench, contact sheet, rail + status line). The Cards tab used to be a spreadsheet with a preview on the side, which made the spreadsheet the main thing and the card a thumbnail. Now the card is in the middle, large, on the mat, with the list of cards on the left and the selected card's fields in an inspector on the right (HIG split view: list, detail, inspector). The spreadsheet is still there, as a drawer at the bottom, because bulk work (pasting from Excel, fill down, sorting) is what it is best at; it can be opened and closed with Ctrl+J and resized. All four views share one selection.

The six modes moved from a row of tabs into a rail on the left, which gives the card the height the tab row used, and keeps the modes in one fixed place (serial position, Jakob's law for anyone who knows Figma, VS Code or Photoshop). A status line at the bottom shows the game, set, card count and save state.

The inspector saves text fields when you leave them (or Enter, Ctrl+Enter in rules text), not on every key, so one edit is one undo step, the same as editing a cell in the sheet. Ctrl+Z and Ctrl+Y now work anywhere in the workbench, except inside a text field while typing, where the field's own undo comes first.

Card list thumbnails are drawn by the shared renderer at 72 px wide (fronts only), in the background, and cached like the playtest pictures.

## Clean code pass: comments, dead code, lazy tabs
Comments explain *why* (a browser quirk, a file format, a safety rule, where a number comes from), never *what* the next line does or how the code got that way; names do that job. Section dividers, restated names and notes about earlier changes were removed (about 1,020 comments down to about 290). Unused helpers were deleted.

The Templates, Playtest, Statistics, Export and Settings tabs are loaded on first use (React `lazy`), and fetched in the background 1.5 s after startup so the first switch is still instant. The startup bundle went from 604 kB to 447 kB (197 kB → 150 kB gzipped). Browser storage reads and writes (panel sizes, remembered options) go through one helper, `src/ui/stored.ts`.

## Test print sheet, demo art, card list order
**Test print sheet** (Export → Print PDF): one page to have the shop print before a big order, because budget shops differ in scaling, cutting accuracy and colour. It uses the same renderer for the card (WYSIWYG), and draws only measuring aids around it in vector: rulers, cut and safe lines, crop marks, swatches, text and line samples. Process-ink swatches are always DeviceCMYK so the shop's press shows its real inks; the game's own colours follow the chosen colour mode. It is portrait whatever the sheet orientation is, so the layout stays the same on every test.

**Demo art:** the demo cards now have simple SVG pictures made for the demo, so framing, the print check, galleries and screenshots show realistic cards. Mudslinger keeps an empty art cell so the "no art" placeholder is still tested. The golden images were rewritten in both browsers.

**Card list thumbnails** render the rows on screen first (IntersectionObserver), then the rest in list order, so a set of hundreds of cards fills the visible part of the list right away.

**Playtest hand:** the hand fans out and overlaps just enough to fit instead of scrolling; pointing at a card shows it large above the hand.

**Flaky browser tests, causes found:** (1) in development, React's StrictMode runs start-up effects twice, so `?opfs&fresh` opened the workspace twice and an edit made in between was replaced; start-up now runs once. (2) The recovery test slept a fixed 2.8 s instead of waiting for the draft to be stored; it now polls IndexedDB. (3) Background preloading of tabs logged an error when the page was left mid-download; failed preloads are now silent (the tab loads again when opened). The recovery draft is also written at once when the page is hidden (another tab, minimised window); writing it while the page unloads was tried and does not finish in time, so it isn't done.

## Publishing: a standalone program per system
For a public release, the app has to start without installing Node.js or downloading packages. Each release is one program per system (Windows, Mac Apple silicon, Linux; Intel Macs were dropped for 0.1.0 because the program Node builds there crashes at startup) made with Node's built-in *single executable applications*: Node plus the server plus the built page in one file, about 35 MB zipped. Other options were rejected: requiring Node.js and `npm install` (a 130 MB download and a developer tool for every user); Tauri or Electron (a Rust toolchain or a much bigger download, and a second runtime to maintain); hosting the page on a website (breaks *local only*, and Firefox and Safari couldn't open real folders).

The programs aren't signed with a paid certificate (Apple Developer ID or a Windows code-signing certificate), so the first start needs one extra click, explained in `READ ME FIRST.txt` and the README. Mac programs get an ad-hoc signature, without which Apple silicon refuses to run them at all.

The program uses a fixed port (4673) because the browser keeps recent folders and recovery drafts per address. Internal ids (`card-maker:` storage keys, the `/__card-maker/` bridge, the `card-maker-feedback` file kind) stay as they are whatever the app is called, so settings and files keep working.

Mac support also meant: shortcut labels show ⌘ on a Mac (`keys()`), Alt+1…6 uses the physical key (Option+1 types "¡" on a Mac), and the folder picker lists iCloud Drive and external drives. Safari's engine is tested with Playwright's WebKit; on Windows it can't write browser-private storage, so the tests that use it are skipped there.

Running the browser tests in WebKit found four bugs that could also happen in other browsers with fast hands, because WebKit re-renders a little later after an event:
- Dragging a template layer could make one undo step per mouse movement, and the end of the drag could jump back a few movements. The "drag started" mark and the last position sent are now kept in refs, which update at once, instead of React state.
- A key pressed right after pointing at a playtest card could act on the card pointed at before. The pointed-at card is now kept in a ref for the keys.
- Escape pressed as soon as a dialog appeared could miss it: dialogs now register for Escape before the browser paints them (`useLayoutEffect`).
- Exports failed in browsers without `OffscreenCanvas` (Safari before 16.4), because of an `instanceof OffscreenCanvas` check; it now checks for the method instead.

## The name: Cardinal
The app is called **Cardinal**, with "Cardinal: Card Maker" as its full title (page title, README, GitHub description) so that people searching for a card maker find it. It is short, a pun on *card*, and fits the four cardinal seats at the playtest table. A web search found no other card-design tool with that name. The mark is a red playing card, tilted, with a thin printed border and a cardinal cut out of it: the card ties the bird to the *card* in the name. The bird is streamlined to its crest, beak and long swept tail, so it still reads at 16 px. A full-colour bird on its own (red, black mask, orange beak) was tried first but said nothing about cards; birds breaking out of a card, perched on one, or carrying one lost their card at small sizes. Internal ids keep `card-maker` (see *Publishing* above), and the GitHub repository and download zips use `cardinal`.

## Cardinal opens in its own window
The main download opens Cardinal as an app: its own window with no tabs or address bar, its own taskbar icon, no console window, and it quits when the window closes. The window is a browser "app window" (`--app`) of the Edge already in Windows, or of Chrome or Edge on a Mac or Linux. This kept the download at 35 MB and the code shared with the browser version. Rejected: Electron (100 to 120 MB per system, and a whole browser to keep patched in every release) and Tauri (needs Rust, and the file server would have to be rewritten; on a Mac its web view is Safari's engine anyway).

- The window uses its own browser profile, so it opens even while the user's own Edge or Chrome is running, never mixes with their tabs, and keeps Cardinal's remembered folders and settings in one place.
- The program knows a window is open from a long-lived connection (EventSource) from each page, not from timers in the page, which browsers slow down in background windows. A reload reconnects within the 8-second grace period. Closing a window with unsaved changes still asks first (`beforeunload`).
- A second "Cardinal Browser" download keeps the old way for people who want their own browser, such as Firefox, Safari or Zen. Both are built from the same code; only the embedded `launch.json` differs.
