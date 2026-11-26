# Cardinal – user guide

## Starting the app

There are two downloads; see `READ ME FIRST.txt` in the zip for the one extra click the first time.

- **Cardinal** opens in its own window, like any other app. Close the window to quit (if there are unsaved changes, you are asked first). Starting it again while it runs opens a second window. The window is drawn by Microsoft Edge (part of Windows) or by Chrome or Edge on a Mac or Linux; without either, Cardinal opens in your default browser. It has its own profile, so its remembered folders and settings are separate from your own browsing.
- **Cardinal Browser** opens in your default browser at http://localhost:4673, so you can use Firefox, Safari or Zen. A small window opens next to it: keep it open while you work and close it to stop. Starting it again while it runs opens another tab.

Working from the source code instead? Double-click **`start-cardinal.bat`** (Windows; the first run installs what it needs), or run `npm run dev`; the app is then at http://localhost:5173.

With Cardinal Browser, any modern browser works: **Chrome, Edge, Firefox, Safari or Zen**.
- In Chrome and Edge, **Open a folder…** shows your system's own folder picker.
- In Firefox, Safari and Zen it shows Cardinal's folder picker. Click through the folders, or paste a path (Windows Explorer's *Copy as path* works, quotes and all) and press Enter. On a Mac, external drives are under **Drives**. The Cardinal window reads and writes the files for the browser, so keep it open while you work.
- On a Mac, the shortcuts use **⌘** where this guide says Ctrl.

Press **?** at any time to see the keyboard shortcuts.

## Your files

Everything lives in a normal folder, the **workspace**, which you choose with **Open a folder…**. The next time, **Continue with “…”** opens it again:

```
MyCardGames/
  games/
    my-tcg/
      game.json          fields, card size, icons, keywords, fonts
      templates/*.json   how each kind of card looks
      sets/core/
        set.json         set name and code
        cards.csv        the cards (opens in Excel)
      assets/
        art/  frames/  icons/  fonts/
      export/            PDFs, images and TTS sheets the app creates
      decks/*.json       decks for the Playtest tab
  backups/               automatic backups and copies made by “Back up now”
```

- **Starting out:** click **Try the demo**, then **Copy demo to a folder…** to get an editable copy. If the folder you pick already has files in it, the demo goes into a new *Cardinal demo* folder inside it. Or open an empty folder and click **+ New game**.
- **Folder menu:** click the folder name at the top left to open another folder, reopen a recent one, back up or reload.
- **Getting started:** the sidebar shows a short checklist for the selected game (card size, frame artwork, 10 cards, a playtest, a print PDF). Click a step to go to the right tab; **Hide this list** removes it.
- **Saving:** nothing is written until you click **Save** or press **Ctrl+S**. Each saved file keeps its previous version as `<file>.bak`.
- **Automatic backups:** the first time you save after opening a folder, the app first copies all game, template and card files into `backups/<date>_<time>/`, so the files as they were before this session's changes are kept even if you save a mistake twice. The save message tells you the folder name that first time. Old backups are never deleted by the app (they are small text files); delete old `backups/` folders yourself when you like. If the backup fails (for example, the disk is full), your changes are still saved and a red message says why the backup failed.
- **Unsaved changes after a crash:** while you have unsaved changes, the app keeps a copy of them in the browser, about two seconds after your last edit. Your real files are not touched. If the browser crashes, the power goes off, or you close the tab without saving, then the next time you open the same folder a blue bar says *Unsaved changes from (time) were recovered*. **Restore** puts those changes back (still unsaved; press **Save** to write them). **Discard** throws them away. If one of those files was changed by another program in the meantime, the bar names it first, because restoring and saving would replace that change. The copy is removed after a successful save. (Chrome and Edge recognise a folder by its name, so two different folders with the same name share one recovery copy.)
- **Other programs:** you can edit `cards.csv` in Excel or a frame in Photoshop at the same time. When you switch back to the app, changed images update automatically. Choose **Reload from disk** in the folder menu to re-read the card data. If you save over a file that another program changed, the app asks first.
- **Back up now** (folder menu) copies all game, template and card files into `backups/<date>/`.

## Finding your way around

- The **top bar** shows where you are: workspace, game and set. **Search actions…** (or **Ctrl+K**) lists every action of the tab you are in plus the ones that work everywhere (switch tab, save, open a folder, go to a set). Type a few letters, e.g. `wor` for *Wording check*, and press Enter.
- The **rail** on the far left switches between the six modes (Cards, Templates, Playtest, Stats, Export, Settings); **Alt+1 … Alt+6** do the same. Next to it, the **library** lists your games and sets; **Hide sets** at the bottom of the rail (or **Ctrl+\**) hides it for more room.
- The **status line** at the bottom shows the game, set, number of cards and whether everything is saved.
- Each toolbar has the common actions in view and the rest under **More ▾**.
- Cards sit on a **cutting mat** with a 10 mm grid at the card's real scale. With *guides* on, **crop marks** show where the card is cut, the bleed outside them is dimmed, and the dotted line is the safe zone.
- **Esc** closes any dialog.

## Cards tab

The Cards tab is a **workbench** with four views of the same cards:

- **Card list** (left): every card with a small picture. Click one, or use the arrow keys.
- **Stage** (middle): the selected card large on the cutting mat, with front/back, bleed, guides, print check and colour vision above it. Drag the art to frame it, scroll to zoom.
- **Inspector** (right): every field of the selected card as a form, with the right control for each kind of field (lists, checkboxes for multi-choice, yes/no). Text is saved when you leave the field or press Enter (Ctrl+Enter in rules text); Esc undoes your typing.
- **Sheet** (bottom drawer): all cards as a spreadsheet for bulk work: pasting from Excel, fill down, sorting. Drag its header to make it taller or shorter; double-click the header, click **Sheet** or press **Ctrl+J** to open or close it.

Ctrl+Z / Ctrl+Y undo and redo anywhere in the workbench (inside a text field they undo your typing first). The sheet works as follows:

**Panel widths:** drag the thin line at the edge of the sidebar, the card preview, the template list, the layer panel or the playtest side panel to make it wider or narrower. Double-click the line to reset it; with the line focused (Tab), the arrow keys move it. Widths are remembered in this browser.

| Action | How |
|---|---|
| Edit a cell | Start typing, or double-click, Enter or F2 |
| Finish / cancel | Enter (moves down), Tab (moves right) / Esc |
| New line in rules text | Shift+Enter or Alt+Enter |
| Select several cells | Drag, or Shift+click / Shift+arrows |
| Copy / paste with Excel | Ctrl+C / Ctrl+V (pasting past the last row adds cards) |
| Clear cells | Delete |
| Fill down | Ctrl+D |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Sort | Click a column header (again to reverse, a third time to clear). **Keep this order** writes the order to the file. |
| Filter | Type words to match any cell, or an expression starting with `=`, e.g. `= cost >= 3 and rarity == 'Rare'` |
| Find and replace | **More → Find and replace…**, or Ctrl+H: change a word in every card at once (all fields or one, match case, whole words, only the filtered cards). One Ctrl+Z undoes it. |

Cells with a problem (not a number, not one of the choices, unknown template) get a red corner. Hover to see why. **More** has the spreadsheet import and downloads (CSV, Excel), the wording check, and **Set name and code…** to rename the set.

**Framing a card's art:** when a template shows a picture from an image field (for example `art/{art}`), each card can move and zoom its own picture inside the art box. In the preview, **drag** the picture to move it, **scroll** over it to zoom, and **double-click** to go back to the template's framing. The framing is saved in an extra column of `cards.csv` named after the field, e.g. `art.frame` with `1.2 0.5 0.35` (zoom, then the focus point across and down, from 0 to 1). Ctrl+Z undoes it.

**Print check in the preview:** tick *print check* above the preview to mark this card's print problems on it (see *Print check* under the Export tab). A number next to the box shows how many there are.

**More → Wording check…** checks the rules text of every card in the game: keywords spelled wrong (“Sheild 2” gets no reminder text), keywords written in a different case at the start of a line, the same effect worded two ways (“deal 2 damage to each enemy unit” and “deals 1 damage to all enemy units”), double spaces, and your own house style rules. Click a card name to go to it. House style rules go in game.json: `"style": [{ "find": "enemy units", "use": "enemies" }]`.

**Colour-blind check:** the drop-down above the preview shows the card as people with protanopia, deuteranopia or tritanopia see it, or in greyscale. Use it to check that cards which differ only by colour (elements, factions) can still be told apart. It changes the preview only, never exports.

**Spelling:** names, rules and other text fields use your browser's spell checker while you edit a cell. Right-click a word to correct it or add it to the browser's dictionary.

**Importing:** before you click **Import**, the dialog lists what would change: each changed cell as *card · field: old → new*, plus the cards that would be added or removed (the first 200 lines, then a count). Nothing is written to disk until you save, and Ctrl+Z undoes an import.

**Excel and special characters:** the app saves `cards.csv` as UTF-8 with a marker at the start (a "BOM") that tells Excel so, so letters like é, ü or — open correctly in Excel. If you save the file from Excel, choose **CSV UTF-8**, not plain *CSV*: plain CSV uses an older Windows encoding. When the app finds such a file, it shows a warning in the sidebar (the file on disk is not changed until you save); re-save it from Excel as *CSV UTF-8*, or import the .xlsx instead. The import dialog reads plain-CSV files from Excel correctly and tells you it did.

## Card text

| You type | You get |
|---|---|
| `[fire]` | the *fire* icon (case doesn't matter; aliases like `[f]` work) |
| `2 [fire]` | a number and the icon right after it always stay on the same line (also `-1`, `0.5`, `3x`, `2×`) |
| `[firre]` | red text, a typo warning |
| `[[` | a literal `[` |
| `*bold*` `_italic_` | **bold**, *italic* |
| `\*` `\_` | a literal `*` or `_` |
| a line break | a new paragraph |

**Typographic punctuation** (Game settings → Card text, on for new games): straight quotes become curly quotes (“this”, it’s), `--` an en dash, `---` an em dash and `...` an ellipsis on the card. Your cells keep what you typed. Icon codes like `[fire]` are not changed.

**Keywords** (set up under Game settings) add reminder text when a line contains only keywords, e.g. `Swift, Shield 2` → *Swift, Shield 2 (Attack at once.) (Prevent the next 2 damage.)*. A keyword in the middle of a sentence is left alone.

## Templates tab

Each card's `template` column picks a template. A template is a stack of **layers**:

- **Text:** fixed text or fields, e.g. `{name}` or `ATK {attack}`. You can set the font, size, colour, alignment, outline, shadow and *shrink to fit*. Switch **Text area** to *shape* to draw a polygon that the text wraps inside.
- **Image:** a file from `assets/`, e.g. `frames/{rarity}.png` or `art/{art}`, with cover, contain or stretch.
- **Shape:** a rectangle, rounded rectangle, ellipse or polygon, filled with a colour or a gradient.

**Stress test** (template toolbar) draws the template with made-up worst cases: every field at the longest value used in the game, each text field at its longest on its own, all optional fields empty, and every combination of the choices the template changes with (e.g. each element × each rarity). Cards whose text overflows or has to shrink below the print check's minimum get a red border. It also lists layers that no real card shows yet (their show-if rule is never true), so you know they have never been looked at. Nothing is saved.
- **Icon row:** a list of icons (`{element}`), or one icon repeated (`[gem] × {cost}`).
- **Group:** layers that move together, optionally clipped to a shape.

On the card: click to select a layer, drag to move it, and drag the handles to resize. Shift keeps the axis or the aspect ratio. Alt turns off snapping to the guides. The arrow keys nudge (Shift moves 10 px). On polygons, drag the points, double-click an edge to add a point, and Alt+click a point to remove it.

- **Show if** hides a layer unless a condition holds, e.g. `rarity == 'Rare'`. Layers hidden on the sample card are shown faded in the list.
- **Inheritance:** set *Extends* to build on another template. Inherited layers are marked; anything you change is stored as an override (shown in blue with a ↺ reset button). Tick *Base only* for templates that cards shouldn't use directly.
- **Faces:** `front`, `back` or anything else. A face can use another template, e.g. every card's back uses `back`.
- **Sample** picks which card to preview the template with.
- The cyan line is the **cut line**. The pink dashed line is the **safe zone**: keep text inside it.

### Expressions

Anything in `{…}` and every *Show if* is an expression:

| | |
|---|---|
| Fields | `name`, `cost`, `field('my-field')` for ids with `-` |
| Card / set | `card.number`, `card.total`, `card.id`, `set.name`, `set.code`, `game.name`, `template.name` |
| Game | `var.edition` (Game settings → Variables), `color.element` (the colour set for the card's element) |
| Maths | `+ - * / %`, `round()`, `floor()`, `ceil()`, `min()`, `max()`, `abs()` |
| Compare | `== != < <= > >=` (`==` ignores case), `and or not` |
| Text | `'text' + name`, `upper()`, `lower()`, `trim()`, `len()`, `replace(text, find, with)`, `pad(card.number, 3)` → `007`, `repeat('★', cost)` |
| Lists | `contains(element, 'Fire')`, `count(element)`, `item(element, 1)`, `has(flavor)` |
| Choice | `if(condition, then, else)` |

## Statistics tab

The tab shows totals, averages, a curve for each number field, and counts for each choice field. Cards with several values (e.g. *Fire, Water*) count under each value. Use **Split by** to see a curve broken down by another field. Switch between **Cards** and **Copies** (copies uses the quantity field). Every chart has a **Table** view. You can filter like on the Cards tab.

**Balance: is each card priced right?** (below the charts) works out what each card's cost “should” be and lists the cards furthest from it, with a chart of expected against actual cost.
- *Learn from my cards* (the default) uses the other number fields (e.g. attack, health), each keyword (its number counts, so *Shield 2* counts 2) and the kind of card (template). It shows what each of them is worth in cost, based on your own cards: useful while you are still deciding what a keyword should cost.
- *My value formula* uses your own expression, e.g. `attack + health * 0.8 + if(contains(rules, 'Swift'), 1, 0)`. **Save formula** keeps it in game.json (`balance.value`).
- It needs a few more cards than things it looks at, and it can't read what card text does. Treat a listed card as “have a look”, not “wrong”. Filter (e.g. `= template == 'unit'`) to compare like with like.

## Export tab

Choose the cards (all sets, one set, or a filter). Then choose one of these:

- **Print PDF:** sheets of cards with crop marks, or one card per page for a print shop. Settings:
  - **Layout:** *Sheets* puts as many cards as fit on each page, with crop marks, for printing at home. *One card per page* makes every page exactly the card plus its bleed, with no margins or crop marks, for print shops that arrange the sheets themselves (see *Sending cards to a print shop* below). **Print shop preset** sets one card per page, bleed on, 600 DPI and no crop marks in one click; colour stays as you set it, and you can still change anything afterwards.
  - **Page size, orientation, margin and gap** (sheets only): with gap 0, neighbouring cards share one cut line. *Best fit* turns the page to landscape when that holds more cards (for poker-size cards with bleed on A4: 8 instead of 6); the line next to it shows the count for the other way. You can also force *Portrait* or *Landscape*.
  - **Print bleed:** prints the bleed area around each card.
  - **Quantities:** prints as many copies as each card's count.
  - **Double-sided:** adds a back page after each front page, mirrored so the sheet turns over sideways: print portrait pages with *flip on long edge* and landscape pages with *flip on short edge* (the option shows which). If your printer shifts one side, use *Back offset* to correct it. With one card per page, backs come *after each front* (front, back, front, back…) or *in a separate file* (`…-backs.pdf`, in the same order as the fronts); ask your shop which they want.
  - **Colour:** *RGB* for home and office printers. *CMYK* for a professional print shop:
    - **Built-in** conversion needs nothing extra. Set the **ink limit** your shop asks for (often 300%, or 260% for uncoated paper).
    - **Add print shop profile…** takes the `.icc` / `.icm` file your shop gives you (e.g. FOGRA39, GRACoL, SWOP). This gives the most accurate colours. The file is copied into the game's `assets/profiles/` folder and embedded in the PDF, so the shop knows which press it was made for. *Perceptual* suits art; *relative colorimetric* keeps in-range colours exact.
    - **Black text and greys on black ink only** (on by default) keeps small text sharp.
    - CMYK images are lossless, so the files are bigger (about 1–2 MB per card at 300 DPI, roughly four times that at 600). The preview on screen stays RGB; ask the shop for a printed proof if colours matter.
  - **Quality (DPI):** 600 by default. Card text is drawn into the picture, so a higher resolution keeps small text and thin lines sharp; photos and painted art gain nothing above about 300. Use 300 for quick proofs or if a file gets too big.
  - **Printing:** print at **100% / actual size**.
- **Images:** one PNG per card at any DPI, named by a pattern such as `{pad(card.number, 3)} {name}`.
- **Tabletop Simulator:** deck sheets (up to 10 × 7) plus `back.png` and a README with the import settings.
- **Gallery page:** one `.html` file with a picture of every chosen card, its details, a search box and click-to-enlarge. The pictures are inside the file, so you can send it to playtesters and it opens in any browser, also on a phone, without Cardinal. About 30 KB per card at 400 px for simple cards (the demo set of 14 cards is 0.4 MB); cards with detailed art are larger.

**Print cost** (under the PDF options): enter your print shop's prices once (per A4 or A3 sheet, extra for the back side, cutting per sheet, per card for card-by-card printing, fixed costs per order; kept in this browser). The table compares every paper size and orientation for the cards you chose, with the number of sheets, empty slots, total and price per card, and marks the cheapest. It uses the copies, backs, bleed and margin you set.

**Print check** (below the export options) checks the chosen cards before you pay for printing:
- **Art with too few pixels** for its printed size (under 300 PPI; under 150 is marked as a problem). SVG pictures are always sharp and are skipped.
- **Text too small to read:** text that is, or shrinks to, under 6 pt.
- **Text that doesn't fit** in its box even at the smallest allowed size.
- **Text or icons outside the safe zone**, where cutting can clip them.
- **Very thin outlines** (under 0.25 pt).
- **Colours the press can't print** — only when *Colour* is CMYK with your print shop's profile. Each card with more than 0.5 % of such colours gets a small picture with them painted magenta; they will print duller. Typical culprits are bright screen blues, cyans, magentas and pure greens.
The limits can be changed per game in game.json: `"print": { "minPpi": 300, "minTextPt": 6, "minLinePt": 0.25 }`.

**Cards from → Changed since …** picks only the cards that changed since a playtest snapshot (see *Playtest rounds*), so you reprint just those.

**Save to** (next to the button) picks the game's `export/` folder or your Downloads (several files come as one zip). The result lists any warnings (missing images, text that doesn't fit, unknown icons).

## Sending cards to a print shop

Before you export, ask the shop four questions:

1. **Sheets or one card per page?** Many card printers arrange (impose) the sheets themselves and want one card per page. Use **Print shop preset** (or *Layout: One card per page*) for that. Each page is then the card plus bleed, and the PDF marks the cut line (its *TrimBox*), so the shop's software knows where to cut. Some shops want their own sheet template instead; then use *Sheets* with their page size.
2. **How much bleed, in mm?** Usually 2–3 mm. The bleed is set for the whole game under **Game settings → Bleed / safe (mm)**. Templates should extend frame art and backgrounds into it.
3. **RGB or CMYK?** Many digital print shops prefer **RGB** and convert to their press themselves, which often gives better colours than converting at home. Only choose CMYK if they ask for it.
4. **Do they have an ICC profile?** If they want CMYK, ask for their profile (`.icc` or `.icm`) and add it under *Colour → CMYK → Add print shop profile…*. It is embedded in the PDF so they know which press it was made for.

Also check how the shop wants **backs** (after each front, or a separate file) and whether they count **quantities** themselves (then turn *Use quantities* off and tell them the counts).

**Order a test print first.** Under *Print PDF*, **Test print sheet** makes one page with your current page size, DPI and colour settings:

- a 100 mm ruler (and a shorter vertical one): if it doesn't measure exactly that on paper, the page was scaled; print at 100% / "actual size";
- the first card at real size with its bleed, the cut line (magenta) and the safe zone (dashed cyan), plus crop marks;
- colour swatches: your game's own colours, then cyan, magenta, yellow and black at 100 / 50 / 20 %, rich black and greys;
- text from 5 to 10 pt and lines from 0.1 to 1 pt, with your print check minimums marked.

Have the shop print and cut one of these on the paper you plan to use before ordering hundreds of cards.

## Playtest tab

Try your cards out on a virtual table, alone ("goldfishing") or with up to four players taking turns at the same screen.

1. Choose the number of **players** (1 to 4). For each one, pick a name, a **seat** (south, west, north or east: the bottom, left, top or right edge of the table) and a **deck**, then press **Start game**. Every deck is shuffled and everyone draws an opening hand.
   - Every set is available as a deck that uses each card's count.
   - **Edit…** changes a player's deck; **New deck…** builds one: search, click a card to add a copy, **−** to remove one. Decks are saved as `decks/<name>.json` in the game folder. In the read-only demo they last until you close the page.
   - Play goes clockwise round the table, starting with the first player in the list. Players and decks are remembered in this browser.
2. **Taking turns with several players:** only the hand of the player whose turn it is is on screen. **Next turn** hides every card and shows *Pass the screen to …*; the next player presses **Show <name>'s hand** when the others have looked away. That player then untaps their cards and draws. To let another player look at their hand during your turn (to answer an attack, say), press **Show hand** on their panel.
3. The table:
   - Each player has a coloured strip along their edge with their **deck** and **discard pile**. Cards on the table turn to face the player who played them (upside down for the player at the top, sideways for the left and right). Your hand and the large preview always stay upright.
   - **Drag** cards between your hand, the table and the piles. Drop a card where you want it on the table, or between cards in your hand. Drop it on another player's panel to give it to them.
   - **Piles lie on the table** and can be moved: drag a pile by its name tag, or hold **Shift** and drag it. Dragging the pile itself takes its top card (a card taken from a face-down pile stays face down; press **F** to turn it over).
   - Click your deck to draw. Click a face-up pile, such as a discard pile, to look through it.
   - **Right-click the table** for **Put a deck here…** (a shared deck, like a market or a monster deck, shuffled face down and owned by nobody) or **New empty pile here**. *More* in the toolbar has the same.
   - **Right-click a pile** to draw, deal one card to each player, look through it, shuffle it, reveal the top card, mill, turn the whole pile over, shuffle it into a deck, turn it to face a player, rename it or remove it when empty.
   - **Right-click a card** to tap it, flip it, put counters on it, give it to another player, turn it to face another player (for example when they take control of it), start a new pile with it, or send it to the top or bottom of its owner's deck.
   - **Double-click** a card in your hand to play it; double-click a card on the table to tap (turn) it.
   - The hand fans out so every card fits; point at a card to see it large above the hand. **−**, **Fit** and **+** at the corner of the table zoom in and out.
4. Each player's panel next to their edge shows their hand size and counters (e.g. Life). The toolbar has **Next turn**, **Draw**, **Shuffle**, **Mulligan**, **Untap all** (your own cards), a **d6** and a **coin**; they act for the player whose hand is on screen.
5. Point at a card to see it large on the right. You can see the faces of your own face-down cards there; other players' face-down cards show their back. With several players, the log underneath says *drew a card* instead of naming it. **Ctrl+Z** undoes anything, including a restart.
6. **Players and decks…** goes back to the setup and keeps the game; **Back to the game** returns to it.

**More → Playtest rounds…**: when you print cards for a playtest, take a **snapshot** (e.g. “Friday”). Save first: the snapshot copies the saved files into `playtests/<name>/` in the game folder. Later, the same dialog shows every card that changed since a snapshot: new, removed, changed text (old → new), or a new look because its template or the game's drawing settings changed. Before and after pictures are side by side. **Copy list of changes** or **Download list** gives a short text to hand to playtesters. To print only these cards, choose *Changed since …* under *Cards from* in the Export tab. Art files are not part of snapshots, so a changed picture file alone doesn't count as a change.

**More → Feedback…**: playtester ratings from the gallery page. In the Export tab, a gallery made with *Let playtesters rate cards* has buttons under every card (*Fun*, *Too strong*, *Too weak*, *Confusing*) and a note box. Playtesters type their name and press **Send feedback**, which saves a small `feedback-<name>-<date>.json` file for them to send you. Add those files here (they are kept in the game's `feedback/` folder). The table lists every rated card with the number of votes and the notes; a vote is orange when at least half of the people who rated that card chose it. A newer file from the same person replaces their older one.

**Draw odds** (in the deck editor, under the card list): type which cards count, the same way as the Cards tab filter (a name, a word, or an expression such as `= cost <= 2`), and how many you need. The table shows the chance of having them by turns 1 to 6, using the game's hand size and draws per turn. Tick or untick *going first* (no draw on turn 1). The odds are exact for a shuffled deck without mulligans.

Keys: **D** draw, **S** shuffle, **N** next turn, **U** untap all. For the card under the pointer: **T** tap, **F** flip, **P** play, **H** to hand, **X** discard, **+**/**−** counters.

## Horizontal cards

A set can mix vertical and horizontal cards (for example locations or battlefields). Horizontal is a property of the **template**: in the Templates tab, choose **Card shape → Horizontal (landscape)**. The card is the same size, turned sideways, so the canvas becomes e.g. 88 × 63 mm. Templates that extend it are horizontal too, unless they say otherwise.

- Switching a template's shape keeps its layers where they are, so move them to fit the new shape.
- The back keeps its own shape. A shared card back stays upright, which is how a physical sideways card looks from behind.
- **Exports:** PNG images come out sideways. On print sheets and Tabletop Simulator sheets, horizontal cards are turned upright so every card is cut on the same grid. On double-sided sheets the backs are turned the other way, so they line up after a long-edge flip.
- **Playtest:** horizontal cards show sideways.

## Game settings tab

- **Card size:** use a preset or custom size, plus bleed, safe zone, DPI and corner radius. If you change the DPI, the app offers to scale all templates to match.
- **Colour check:** for fields with a colour per value (e.g. elements), lists pairs that look alike for people with red-, green- or blue-blindness, or in greyscale, with swatches as they see them. A difference under 20 is hard to see on a small icon. Fix it by making one colour clearly lighter or darker, or by always showing an icon or word next to the colour.
- **Fields:**
  - **Types:** text, rules text (*richtext*), number, yes/no, choice, multi-choice, image or colour.
  - **Choices:** list the allowed values, with a colour for each.
  - **Values:** a default value, and min/max for numbers.
  - **Roles:** mark one field as the card name and one as the quantity (copies).
  - **Computed fields:** e.g. `attack + health`.
- **Icons:** **Add icon files…** copies SVGs or PNGs into `assets/icons` and names each icon after its file. Aliases look like `f=fire, w=water`.
- **Keywords:** the name, the pattern (`Shield {n:number}`), the reminder text (`(Prevent the next {n} damage.)`) and *when* to add it (always, first use only, never).
- **Fonts:** **Add font files…** copies TTF, OTF or WOFF files and guesses the family, weight and italic. Use the family name in text layers.
- **Artwork files:** add art and frame images.
- **Adding a file that already exists** (icons, fonts, artwork, or a print shop profile on the Export tab): the app lists the files that already exist and asks once whether to replace them. **OK** replaces them and keeps each old one as `<file>.bak`; **Cancel** keeps the existing files and copies only the new ones.
- **Playtest table:** the opening hand size, cards drawn each turn, and counters such as life (name and starting value).
- **Variables:** game-wide values for `{var.name}`.

The buttons at the top of the tab jump to each section.

## Several games

A workspace can hold any number of games: click **+ New game** in the sidebar. Each game has its own fields, templates, icons and card size, so a second TCG with completely different cards works the same way. A folder that contains `game.json` directly can also be opened on its own.
