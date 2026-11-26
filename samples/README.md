# samples/

- `demo-workspace/`: the built-in demo game. The app's tests depend on it, so leave it as it is. To experiment, use **Open demo**, then **Copy demo to folder…** in the app.
- Put your own design files in a folder here whenever you like (for example `samples/my-tcg/`), so they're easy to find and share in a Claude session.

## Getting your own TCG into the app

1. Make a folder for your games anywhere, e.g. `Documents/MyCardGames`. Open it with **Open a folder…** and click **+ New game** in the sidebar.
2. **Game settings** tab:
   - Set the card size, bleed and fields (cost, type, rarity…).
   - **Add icon files…** copies your SVG/PNG icons in. `fire.svg` becomes `[fire]`.
   - **Add font files…** copies your TTF/OTF fonts in.
   - Use **Artwork files** to add your frames and art.
3. **Cards** tab: **Import…** your spreadsheet (CSV or Excel). Column names are matched to field names, ignoring case.
4. **Templates** tab: add image layers for your frames (e.g. `frames/unit.png`) and position the text boxes on them.
5. **Save** (Ctrl+S).

Frames are easiest to work with as PNGs with transparency, made at the full card size **including bleed**. For a 63 × 88 mm card with 3 mm bleed at 300 DPI, that is 815 × 1110 px.

**Font licenses:** check that the license lets you embed the font in a PDF if you plan to print through a print shop.
