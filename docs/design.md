# Design language: "Proof Room"

Cardinal is where a card goes from idea to the print shop. The interface borrows from the place where that happens in real life, a print studio: **paper, ink, a cutting mat, crop marks and the slug line** printed at the edge of a proof sheet. It is a working tool, so the metaphor is only a voice: no fake leather, no skeuomorphic knobs, just the colours, type and marks of print production, used with discipline.

Sources the rules come from: Laws of UX (lawsofux.com), Nielsen's 10 heuristics and progressive disclosure (NN/g), NN/g on accelerators, and Apple's Human Interface Guidelines (sidebars, toolbars, split views, layout, typography, colour, feedback). Each rule below names the reason.

## 1. Principles

1. **The card is the hero.** Everything else steps back (HIG: deference; aesthetic-usability). Cards sit on a cutting mat with a real shadow; the chrome around them is quiet paper and ink.
2. **One accent per meaning** (HIG colour: "use each colour for one meaning").
   - **Ink** (near-black on paper, paper on dark) = *the* primary action: Save, Create PDF, Start game. One per screen (Von Restorff).
   - **Cyan** = interactive state: selection, focus, links, the active tab, toggles that are on.
   - **Magenta** = needs attention: print problems, warnings, unsaved marks, overflow. It is the proofreader's pen.
   - **Yellow** = highlight only (search hits, "cheapest"), never text.
   Colour is never the only signal: every state also has a shape, a word or an icon (lawsofux Von Restorff; HIG colour).
3. **Three toolbar areas, three groups at most** (HIG toolbars). Leading: where you are and what you are working on. Centre: the few frequent actions. Trailing: the primary action and a **More** menu for the rest (progressive disclosure, two levels at most).
4. **Every command is reachable without the mouse** (NN/g accelerators; HIG "make every toolbar item available as a command"). The **command bar** (Ctrl+K) lists every action of every tab, with its shortcut, searchable. Toolbars stay for recognition (Nielsen 6), the command bar is for speed (Nielsen 7).
5. **Status where it happens, interruptions only for data loss** (HIG feedback). Counts and states sit next to their thing (unsaved dot on the tab, problem count on the print-check chip); toasts confirm; dialogs only ask before something is lost.
6. **Numbers are measurements.** Sizes, counts, ids and expressions are set in a monospaced face with tabular figures, so columns line up and a value reads as data (Prägnanz, similarity).

## 2. Type

Bundled, never from a CDN: **IBM Plex** (OFL-1.1, via @fontsource), one family in three cuts (HIG: minimise typefaces).

| Role | Face | Size / weight |
|---|---|---|
| UI text, inputs | Plex Sans | 13 px / 400 (HIG macOS body 13 pt), 500 for emphasis |
| Slug labels: tabs, section heads, field labels in inspectors | Plex Sans Condensed, upper case, +0.06em tracking | 11 px / 600 |
| Titles (dialog, empty states) | Plex Sans | 17 px / 600 |
| Numbers, ids, mm, DPI, expressions, code | Plex Mono, tabular | 12 px / 400 |

Minimum size 11 px (HIG minimum 10 pt). No light weights (HIG).

## 3. Colour tokens

Light, "Paper":

| Token | Value | Use |
|---|---|---|
| `--bg` | `#eeeae1` | the desk behind everything |
| `--panel` | `#fbf9f4` | sheets: panels, toolbars, dialogs |
| `--panel-2` | `#f4f1e9` | recessed areas: inputs, table headers |
| `--text` | `#1e1c19` | ink |
| `--muted` | `#6c675d` | graphite (≥ 4.5:1 on panel) |
| `--border` | `#ddd6c8` | rules between things |
| `--accent` (cyan) | `#0a6f91` | interactive, selection, focus |
| `--accent-soft` | `#d9ecf2` | selected rows, active chips |
| `--attn` (magenta) | `#b0175a` | problems, unsaved |
| `--attn-soft` | `#f7e1ea` | |
| `--hi` (yellow) | `#f3cd3d` | highlight marks |
| `--mat` / `--mat-line` | `#c9d3c8` / `#b6c2b5` | cutting mat and its 10 mm grid |

Dark, "Darkroom": `--bg #121110`, `--panel #1b1a17`, `--panel-2 #232120`, `--text #ece7dc`, `--muted #a29c8f`, `--border #34312b`, `--accent #5cc3e4`, `--accent-soft #173642`, `--attn #f0679b`, `--attn-soft #3b1a28`, `--hi #e3bd2b`, `--mat #1c2622`, `--mat-line #26332d`.

Both are checked for 4.5:1 text contrast on `--panel`.

## 4. Shape, space, motion

- 4 px grid. Controls 30 px tall (Fitts: generous targets), 8 px between related controls, 16 px between groups.
- Corners: 4 px on controls, 6 px on sheets. Cards keep their own corner radius from the game.
- Elevation is only for things that float: menus, dialogs, the card on the mat. Panels are flat, separated by 1 px rules (HIG split views: thin dividers).
- Motion 120 ms ease-out for state changes, none for layout; all off with "reduce motion".

## 5. Signature elements

- **Cutting mat** behind every card stage (Cards preview, Templates canvas, stress test, playtest table): a soft green-grey surface with a 10 mm grid drawn to the card's real scale, so size reads at a glance.
- **Crop marks** instead of a dashed trim rectangle: short L-marks at the four corners show the cut line; the safe zone is a faint dotted line inside. The bleed area beyond is dimmed slightly when shown.
- **The mark** (`LogoMark`, colours `--logo-card` and `--logo-paper`): a tilted red playing card with a thin printed border and a cardinal cut out of it, crest, beak and tail emphasised. It is in the slug bar, on the welcome screen, as the page icon, in the README and as the Windows program icon. The master drawing is `docs/images/cardinal.svg`.
- **Registration mark** (⌖ circle with cross) as the icon of the print check.
- **Slug bar** at the top: `Cardinal · workspace / game / set`, set in condensed caps like the info line printed on a proof's margin.
- **Index tabs** for the modes: condensed caps, an ink underline for the current one, the unsaved dot in magenta.

## 6. Layout: the Workbench

```
┌ slug bar: ⌖ CARDINAL  workspace ▾ / game / set          [Search actions… Ctrl K] [?] [Save] ┐
├rail┬ library ┬ toolbar: filter · count        + Card  Duplicate  Delete   ↶ ↷   More ▾ ────────┤
│ ▣  │ games   ├ card list ─┬──────────── stage: the card on the mat ───────────┬ inspector ─────┤
│ ▤  │  sets   │ ▸ Ember    │ [front|back]          bleed  guides  ⌖ print check │ CARD    c001  │
│ ▶  │         │   Cinder   │                ┌───────────┐                       │ NAME  [     ] │
│ ▥  │ getting │   Flame    │                │   EMBER   │                       │ COST  [ 1  ]  │
│ ⎙  │ started │   …        │                │   SCOUT   │                       │ RULES [     ] │
│ ⚙  │         │            │                └───────────┘                       │ …             │
│    │         ├────────────┴──── ▾ SHEET (drawer: every card as a spreadsheet) ─┴───────────────┤
│    │         │ id    name           cost  element  rarity  rules …                            │
└────┴─────────┴── status line: GAME · SET · 14 cards · All saved              Ctrl K · ? ───────┘
```

- **Rail** (leading edge, always visible): the six modes as icon + short label, Alt+1…6. The current mode has an ink bar. It replaces the row of tabs, which gives the card more height (HIG sidebars and tab bars: top-level navigation in one fixed place).
- **Library** (games and sets, getting-started checklist, load issues): can be hidden (Ctrl+\, or **Hide sets** at the bottom of the rail) and resized.
- **Cards mode is a workbench** (HIG split view: list · detail · inspector): the card list (with small pictures, arrow keys), the selected card large on the cutting mat in the middle, its fields in the inspector on the right. The spreadsheet is a **drawer** at the bottom for bulk work (paste from Excel, fill down, sorting); drag its header to resize, double-click or Ctrl+J to open or close. All four views show the same selection.
- **Status line** (bottom): game, set, number of cards, save state; quiet, always in the same place (HIG feedback: status shown passively, next to the work).
- Every panel keeps its resizable width (or height) in this browser.

## 7. Per screen

- **Cards:** the workbench above. Toolbar: leading = filter and count; centre = [+ Card, Duplicate, Delete] [Undo, Redo]; trailing = **More ▾** (Find and replace…, Wording check…, Set name and code…, spreadsheet import and downloads). Stage toolbar: face switch (segmented), view chips (bleed, guides, print check with its count), colour vision. The inspector saves a text field when you leave it (or Enter / Ctrl+Enter), so one edit is one undo step.
- **Templates:** leading = template name; centre = faces (segmented) and sample card; trailing = zoom, Stress test, undo/redo.
- **Playtest:** leading = deck picker; centre = Edit deck / New deck; trailing = **More ▾** (Playtest rounds…, Feedback…) and **Start game** in ink.
- **Export:** the four kinds as a segmented list on the left (what), options in the middle (how), the ink button at the end of the options (go). Print check and print cost become collapsible sections of the same column.
- **Statistics and Settings:** sheets on the desk, section heads as slug labels, jump links stay.

## 8. Voice

Short, plain, print-shop words: *bleed*, *crop marks*, *proof*, *reprint*. Sentence case in text; condensed caps only for slug labels and tabs. No exclamation marks.
