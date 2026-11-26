# Ideas: where Cardinal could go next (2026-11-20)

The research round (`docs/research.md`) closed the gaps with other card makers. This list is about things **none of them do**, chosen for this owner: a first TCG, a few hundred cards, physical playtests with friends, a budget professional print shop. Every idea stays local-only and game-agnostic, and reuses parts that already exist.

Effort: **S** about a session, **M** two or three, **L** more.

**Status (2026-11-20):** ideas 1 to 8 are built (see the user guide and `docs/architecture.md` section 14). Tier 3 is still open.

## Tier 1: build these first

### 1. Print preflight: catch print problems before the shop does  (M)
Budget shops print what they get; mistakes cost a reprint. A **Check for print** button lists problems per card, with a red overlay in the preview:
- **Low-resolution art:** the picture's real pixels compared with its printed size (layer box × card zoom × export DPI). Flag anything under 300 effective PPI. All the numbers are already known in `renderCard` (image size, rect, framing zoom).
- **Text too small to read:** the shrink-to-fit size after layout, converted to points at print size. Flag under 6 pt (the setting is per game). `layoutText` already returns `fontSize`.
- **Outside the safe zone:** text or icons drawn past the safe line. The layer boxes from `RenderResult.boxes` are enough.
- **Hairlines:** strokes thinner than about 0.25 pt at print size, which can vanish.
- **Colours the press can't print:** with the shop's ICC profile, convert each pixel to CMYK and back to Lab. Where the difference (ΔE) is large, the colour will print duller (bright RGB blues and greens are the usual victims). Shown as a "gamut warning" overlay. `cmyk.ts` already does the conversion to CMYK and reads Lab from the profile.
- **Rich black and ink limit:** areas over the shop's total-ink limit (also known from the converter).

Why it's new: the other tools tell you about bleed; none of them check the art, the text size and the colours against the actual press.

### 2. Changed-cards reprint: print only what changed since the last playtest  (M)
The owner playtests with paper. After every round of changes, reprinting the whole set wastes paper and money.
- **Tag a playtest:** "Playtest 3" stores a copy of the set's CSV and templates in `backups/playtest-3/` (plain files, like the existing backups).
- **Compare with a tag:** a list of the cards that changed (data and/or look), with old and new pictures side by side and the changed pixels highlighted. This reuses the golden-image comparison in `src/ui/golden.ts`.
- **Print only those**, as a sheet PDF with the usual options, ideally sized so they can be sleeved in front of the old cards.
- **Errata list:** the text changes as a one-page summary to hand to playtesters ("Ember Scout: cost 1 → 2").

Why it's new: design tools treat a set as one thing to export; physical iteration needs "what changed since we last played".

### 3. Playtest feedback from the gallery page  (M)
The gallery file already goes to playtesters. Let it collect their opinions, with no server:
- Each card in the gallery gets small buttons: *too strong*, *too weak*, *confusing*, *fun*, plus a note.
- Answers are kept in the playtester's browser. **Send feedback** downloads a small `feedback-<name>.json` (or copies a short code to paste into a chat).
- In Cardinal, **Import feedback** reads any number of those files. The Cards grid gets a feedback column and a heat map ("Tide Caller: 4 × too strong, 1 note"); Statistics can chart it.

Why it's new: tools either have no feedback loop or need an online service. This keeps the loop entirely in files.

## Tier 2: strong ideas, a bit more design needed

### 4. Balance lens: find over- and under-costed cards  (M)
The owner writes a **value formula** in game.json using the existing expression language, e.g. `attack + health * 0.8 + 1.5 * has(rules, 'Swift')`.
- The app fits the cost to that value across the set (least squares) and shows a scatter plot: each card is a dot, with the cost curve through them. Outliers are listed: "Cinder Hound is 1.3 below the curve".
- **Learn keyword worth from your own cards:** run the fit with one term per keyword and read off what the set implies each keyword costs. This is useful early, when the owner is still deciding what Shield is worth.

It's game-agnostic, because the owner defines the formula. It extends the Statistics tab.

### 5. Template torture test  (S)
Templates break on the extreme cards, not the typical ones. **Stress test** renders each template with:
- the longest name, the longest rules text and the widest numbers in the set;
- every combination of the choice fields its show-if rules use (e.g. element × rarity);
- empty optional fields.

It shows them as one grid, marking overflow and anything shrunk under the preflight size. It also lists show-if branches that no current card triggers ("the *Legendary* crown layer is never shown") and therefore have never been checked.

### 6. Rules-text linter: consistent wording across hundreds of cards  (M)
- **Near-duplicates:** the same idea phrased two ways ("deal 1 damage to each enemy" vs "deals 1 damage to all enemies"), found by comparing word n-grams across cards, with a suggestion to unify.
- **Keyword spelling and capitalisation:** a keyword used in lower case, or misspelled ("Sheild 2"), which then gets no reminder text.
- **References that point nowhere:** "search for a *Scout*" when no card has that subtype or name, found from the choice and text values in the set.
- **House style rules** in game.json (a pattern and its preferred wording), e.g. "enemy units" → "enemies".

### 7. Colour-identity check for colour-blind players  (S)
The preview filter needs someone to look. This checks automatically: for every pair of values a field gives colours to (elements, factions), it computes the colour difference under each colour-blindness simulation. It warns when two values become hard to tell apart ("Fire and Earth: ΔE 6 for deuteranopia"), and suggests adding an icon or a brightness difference. Uses `colors` in game.json and the matrices in `src/ui/vision.tsx`.

### 8. Print cost planner  (S)
Enter the shop's prices (per sheet or per card, cutting, sleeves) once per game. For any export the app shows sheets, cards per sheet, waste and total cost, and compares options: portrait or landscape, with or without bleed, A4 or A3, one card per page. With a budget shop, "A3 landscape saves 18 %" is a real decision.

## Tier 3: later or bigger

- **Second language edition (L):** translation columns (`rules@id`, `name@id`), a language switch in the preview and exports, and a fit report showing which cards overflow in the other language. Useful if an Indonesian edition is ever planned. Text fit is the classic pain of translating cards.
- **Auto-goldfish (L):** simulate thousands of opening hands with a resource rule written as an expression ("one resource per turn; a card is playable when cost <= turn"). Report how often each card is castable on curve, and the deck's average first play. This is harder to keep game-agnostic, so only once the owner's resource system is settled.
- **Card relationship map (M):** a graph of which cards mention which names, subtypes or keywords, for spotting orphan mechanics and combo clusters.
- **Booster packs (M):** rarity slots per pack, an opening simulator and the chance of opening a given card. Already listed as optional in CLAUDE.md.

## Suggested order

1. Print preflight: it saves money on the first real print order.
2. Template torture test: small, and protects every later print.
3. Changed-cards reprint: pays off from the second playtest round.
4. Playtest feedback from the gallery.
5. Balance lens, once the set has enough cards for the numbers to mean something (roughly 40+).

Rules for all of them stay as in CLAUDE.md: no network, nothing game-specific in `src/`, one renderer, user data in plain files, tests for logic and browser tests for UI.
