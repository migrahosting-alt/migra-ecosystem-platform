# MigraHosting Corporate Portfolio

This folder contains a print-ready and web-ready corporate capability deck for MigraHosting and the wider MigraTeck ecosystem.

## Files

- `index.html` - main editable source for the deck
- `styles.css` - screen and shared visual styling
- `print.css` - print layout for A4 landscape PDF export
- `export-pdf.sh` - one-command PDF export using Playwright via `npx`
- `layout-manifest.json` - page map for structured editing
- `ASSET_SOURCES.md` - asset provenance and upgrade notes

## Recommended Workflow

1. Open `index.html` in a browser for the web version.
2. Run `bash export-pdf.sh` to generate `MigraHosting-Corporate-Portfolio.pdf`.
3. Edit copy, page order, or sections directly in `index.html`.
4. Adjust layout or theme in `styles.css` and print behavior in `print.css`.

## PDF Export

- Default output: `MigraHosting-Corporate-Portfolio.pdf` in this folder
- Custom output: `bash export-pdf.sh /absolute/path/to/output.pdf`
- Export engine: temporary `playwright` package via `npx`, with Chromium rendering and print backgrounds enabled

## Notes

- The current package uses verified real brand assets available from the repo and live MigraHosting site.
- Some product visuals are intentionally represented as editable diagrammatic layouts instead of stale screenshots.
- The layout is built to be straightforward to port into Figma or InDesign if a design team wants a native design-file version later.