# Existing card makers: research notes (2026-11-08)

The goal was to learn which features matter and how others structure templates. **No code is copied** (see the licensing rule in `CLAUDE.md`). Where a license is marked "confirmed", it was checked against the project's repository.

## Summary table

| Tool | Type | License | Key ideas we take |
|---|---|---|---|
| **Magic Set Editor 2** | Desktop (C++) | GPL-2.0 (confirmed, `COPYING` file) | Game, stylesheet and set kept separate; typed fields; keywords with parameters and reminder text; statistics dimensions; symbol fonts |
| **Card Conjurer** | Web (JS) | None found (no LICENSE file; the original creator received a cease-and-desist from Wizards of the Coast in 2022) | Stacked frame packs (base frame + add-ons such as crowns and stamps); per-symbol-set icon packs |
| **Squib** | Ruby DSL | MIT (confirmed) | YAML layouts with inheritance and merging; icons embedded in text by key (`:tool:`); CSV and XLSX input; PNG, PDF and SVG output |
| **Strange Eons 3** | Desktop (Java) | MIT (confirmed) | Plug-ins add whole new games; component types defined by a game plug-in |
| **nanDECK** | Windows, script + visual editor | Freeware, closed source | Linked spreadsheet data; front and back alignment for duplex printing; a virtual table for playtesting |
| **Component Studio** (The Game Crafter) | Web, paid | Closed | Layer types Text, Image, Box, Orb, Simple Table; layer groups; conditional rendering; game variables; enumeration; Google Sheets import; Tabletop Simulator export |
| **Dextrous** | Web, paid | Closed | WYSIWYG editor with data merge; print-and-play sheets; CMYK PDF with bleed and dielines; Tabletop Simulator and Screentop export |
| **Card Creatr Studio** | Desktop (Electron/Vue) | GPL-3.0 (reported by a third-party listing) | Built on web technology like ours; PDF and PNG export |

## Feature details worth copying (as ideas)

### From Magic Set Editor
- **The "style triangle":** the *game* describes which fields a card has, the *stylesheet* describes how they look, and the *set* holds values. We use the same split: `game.json`, templates and `cards.csv`. This is the main thing that makes a tool work for many games.
- **Field properties:** `identifying` (this field is the card's name), whether the field appears in the card list and how wide its column is, a custom sort script, and colors per choice value for graphs and list rows.
- **Keywords:** `match: "Equip <param>cost</param>"` plus `reminder: "{param1}: Attach…"`. Keyword modes (core, expert, custom) control which keywords get reminder text automatically.
- **Statistics dimensions:** `numeric`, `bin size` ("1-5" buckets), `split list` (a multi-color card counts under each color), `groups` (fixed order, and empty values still shown), and colors per value.
- **Symbol fonts:** text codes are mapped to images, which is the same as our `[icon]` syntax.
- **Extras to consider later:** an "add cards" script for generating many cards at once, random booster packs, export templates (HTML spoiler lists), and word lists for autocompletion in text fields.

### From Card Conjurer
- Frames are built from **stacked pieces with masks** (base frame, then a legend crown, then a stamp) instead of one image per combination. Our image layers with `showIf`, plus groups with clip masks, cover this.
- Text regions are defined per frame, so switching frames moves the text boxes with them. This is the reason templates own their text layers.

### From Squib
- **Layout inheritance** (`extends`) with later definitions overriding earlier ones. We use the same idea for templates (`extends: "_base"`).
- **Icons embedded in text:** the key is a placeholder string, and each icon can have its own size and offset (`dx`, `dy`), plus an option to tint it with a single color. Add the per-icon `dx`/`dy`/scale/tint to our icon definitions.

### From Component Studio
- **Box and Orb** (rounded rectangle and ellipse) shape layers, so simple frames can be built without image files. This is good for early prototyping while the owner's art is unfinished.
- **Enumeration:** automatic collector numbers such as `001/120`.
- **Game variables:** game-wide values (e.g. a set code) that templates can use.

### From nanDECK and Dextrous
- **Duplex print alignment:** back pages are mirrored so that backs line up with fronts.
- **Print-and-play sheets** with crop marks, dielines and bleed.
- **Playtesting:** nanDECK's virtual table, and Tabletop Simulator or Screentop export. Tabletop Simulator export is in Phase 7; a built-in virtual table is out of scope.
- **CMYK:** Dextrous offers CMYK PDF. Browsers render in RGB, so true CMYK would need a separate conversion step. This is deferred, and RGB PDFs are fine for home and most print-on-demand printing.

## Gaps we can fill (from our own judgment, not measured)
- **Shaped (polygon) text boxes:** none of the tools reviewed advertise this. Most rely on rectangular boxes with shrink-to-fit.
- **Live preview while editing a spreadsheet cell, together with statistics** in one local tool.
- **Many games in one workspace** with shared fonts and icons.

## Sources
- MSE2 repository and docs: https://github.com/twanvl/MagicSetEditor2 (`doc/type/game.txt`, `field.txt`, `keyword.txt`, `statistics_dimension.txt`)
- Card Conjurer (maintained fork): https://github.com/Investigamer/cardconjurer
- Squib: https://github.com/andymeneely/squib, https://squib.readthedocs.io/en/latest/dsl/text.html
- Strange Eons: https://github.com/CGJennings/strange-eons, https://cgjennings.github.io/se3docs/
- nanDECK: https://alternativeto.net/software/nandeck/about, https://store.steampowered.com/app/3258490
- Component Studio: https://news.thegamecrafter.com/tagged/Component.Studio
- Dextrous: https://www.bgdf.com/forum/general/announcements-press-releases/dextrous-prototyping-platform
- Card Creatr Studio: https://github.com/sffc/card-creatr-studio

---

# Second round: what card makers do in late 2026 (2026-11-20)

Read from each tool's own pages where they loaded; Dextrous, Component Studio's home page and Tabletop Creator did not render for the fetch tool, so their entries rely on help articles, blog posts or a competitor's comparison (marked).

## What each tool offers now

- **nanDECK 1.29.1** (25 Oct 2026, freeware, Windows): links Excel, ODS, Google Sheets or CSV; script plus a visual editor with undo; HTML-styled text with fit-to-box; icons, QR codes, SVG, image effects; output to printer, PDF, PNG, multipage TIFF; fronts aligned with backs; templates for The Game Crafter, Printer's Studio and Artscow; direct Tabletop Simulator save-file export (1.29) and Screentop.gg images; a virtual table; a combinatorial engine and Monte Carlo simulator for deck odds. Sources: https://www.nandeck.com/, https://www.nandeck.com/features
- **Component Studio 2** (The Game Crafter, web): datasets (one row per component) with Google Sheets, CSV and folder-of-images import, find and replace, and *enumerations* (comma lists multiplied into many rows, e.g. 4 suits × 13 ranks); layers Box, Image, Note, Orb, Polygon, Table, Text, QR Code, each with conditional rendering; text with inline `<icon/>` images, icon scale, styles, template variables and `if` logic, fit-to-size (shrink only), **curved text**, drop shadow, glow, outline, blur; designer **overlays including colour-blind filters**; export to PNG zip (bleed, mask), print-and-play PDF (paper sizes, cut lines under/over with colour and width, margins, rotate backs 180°), direct upload to The Game Crafter, Tabletop Simulator sheets. Sources: https://help.component.studio/article/685-datasets, /556-layers, /687-designs, /566-enumeration, /535-text-layer, /580-cs2-export-design
- **Squib** (Ruby, MIT): text autoscale or ellipsize, embedded SVG/PNG icons in text with dx/dy, Pango markup; layouts in YAML with multiple `extends` and `+=` style arithmetic; `Qty` column explodes rows; cut and safe zones; `trim` on export; sprues (print templates such as A4 8-up, DriveThruCards 1-up); **build groups** (e.g. a black-and-white print-and-play build and a colour build from one script); `showcase` and `hand` preview renders. Sources: https://squib.readthedocs.io/en/latest/ (text_feature, layouts, bleed, build_groups, data)
- **Deckard** (Unity, MIT-0): CSV with a `Count` column; components that bind text, sprites, colours, visibility and repeat counts to columns; `<<icon>>` in text, tinted by default; exports single cards, print-and-play sheets (always with bleed) and sprite atlases for Screentop.gg / Tabletop Playground; components switched per export type. Source: https://github.com/jonagill/Deckard
- **Strange Eons 3** (Java, MIT): projects as folders; tag markup with **automatic typographic punctuation** (curly quotes, en/em dashes, ellipsis; `<no punctuation>` to turn off); **portrait panel to pan, zoom and rotate the art inside each card's frame**; **live spell checking** with a personal dictionary; export presets plus an HTML "Readme" gallery of the exported cards; ink-saver mode. Sources: https://se3docs.cgjennings.ca/um-gc-markup.html, um-gc-portraits.html, um-gc-spelling.html, um-gc-export.html
- **Magic Set Editor 2**: statistics window; export to an HTML spoiler page and to Apprentice / LackeyCCG; hunspell spell checking. Source: https://github.com/twanvl/MagicSetEditor2
- **Dextrous** (web, paid): drag-and-drop layouts applied to every card; shrink-to-fit text; Google Sheets CSV link; print-and-play PDF on Letter/A4/A3; PNG; Tabletop Simulator with hosted images; Screentop.gg; Dustin's Designer Den. Source: https://www.dextrous.com.au/blog/dextrous-the-online-card-game-maker. A competitor page also lists CMYK/bleed PDFs on paid plans and limited version history (https://shufflekit.com/vs/dextrous, unverified).
- **ShuffleKit** (web, from its own comparison page): AI card data and art, a multiplayer playtable, Google Sheets sync, versioned rules documents beside the cards, per-card snapshot rollback, The Game Crafter integration. Source: https://shufflekit.com/vs/dextrous

## Comparison with Cardinal

| Feature | Others | Cardinal before this round |
|---|---|---|
| Spreadsheet data, Excel round trip | all | yes (grid, CSV, XLSX, import preview) |
| Inline icons, aliases, per-icon size/offset/tint | CS, Squib, Deckard, nanDECK | yes |
| Shrink-to-fit text | all | yes, plus shaped (polygon) text boxes, which none of the others offer |
| Conditional layers, variables, expressions | CS, nanDECK, Deckard | yes |
| Keyword reminder text | MSE | yes |
| Statistics | MSE | yes, richer |
| Print PDF, bleed, crop marks, duplex, CMYK + ICC | CS, Dextrous, nanDECK | yes |
| Tabletop Simulator export | CS, nanDECK, Dextrous | yes (sheets) |
| Virtual table | nanDECK, ShuffleKit | yes (single player) |
| **Per-card art framing (pan/zoom inside the frame)** | Strange Eons | **no**: only a template-wide focus point |
| **Find and replace across cards** | CS | **no** |
| **Typographic punctuation** (curly quotes, dashes) | Strange Eons | **no** |
| **Spell checking in card text** | Strange Eons, MSE | **no** (turned off) |
| **Colour-blind preview** | CS | **no** |
| **Gallery / spoiler page of the set** | Strange Eons, MSE | **no** |
| **Deck odds (probability of drawing cards)** | nanDECK | **no** |
| Curved text, QR codes | CS, nanDECK | no |
| Enumerations (one row → many cards) | CS | no |
| Build variants (e.g. ink-saver print build) | Squib, Strange Eons | no |
| Direct upload to a print service | CS, nanDECK, ShuffleKit | no, and not possible offline |
| AI generation, multiplayer, cloud sync | ShuffleKit, Dextrous | no, by design (local only) |

## What we fill now, and why

The rows in bold are the ones that matter most for designing a TCG with hundreds of cards printed professionally: art framing per card, find and replace for rules wording changes, typographic punctuation and spelling for print-quality text, a colour-blind check for colour-coded cards, a gallery page to show playtesters, and deck odds to tune deck size and card counts.

Left for later (ask the owner): curved text (titles on round frames), enumerations (more useful for playing-card style decks than TCGs), QR codes, build variants. Not planned: print-service uploads, AI features and multiplayer, which need the network.
