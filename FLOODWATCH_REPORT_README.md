# FLOODWATCH Report — README

## Generated files

- `FLOODWATCH_COMPLETE_PROJECT_REPORT.md` — the complete report, source of truth.
- `FLOODWATCH_COMPLETE_PROJECT_REPORT.pdf` — the same content, rendered to a 43-page PDF with 6 Mermaid diagrams baked in as images, page numbers, and print-friendly typography/tables.
- `FLOODWATCH_REPORT_README.md` — this file.

## How the report was generated

1. The Markdown report was written directly from a live inspection of this repository (see "Sources inspected" below) — no content was drafted from memory alone; specific numeric constants (drainage-graph thresholds, capacity multipliers, routing cost tiers, node/edge counts, dependency versions) were re-verified with `grep`/`python3 -m json.tool` against the actual source and data files immediately before writing.
2. The PDF was produced by rendering the Markdown to HTML in a headless Chrome instance (via the Chrome DevTools Protocol): `markdown-it` (CDN) converts the Markdown to HTML, `mermaid.js` (CDN) renders the six ` ```mermaid ` fenced code blocks to inline SVG, and Chrome's `Page.printToPDF` CDP command then exports the fully-rendered page (diagrams included) to PDF with automatic page numbering in the footer.
3. Two architecture/data-flow diagrams (System Architecture and Frontend Component/Data Flow) were originally drafted with many small side-by-side boxes inside Mermaid subgraphs, which rendered illegibly small on a portrait page; they were restructured into fewer, grouped, vertically-stacked boxes and re-verified visually (via CDP screenshot) before the PDF was finalized.

## Sources inspected

- Prior project audit/status reports at the repository root: `AUDIT_REPORT.md`, `FINAL_IMPLEMENTATION_REPORT.md`, `DRAINAGE_INVESTIGATION_REPORT.md`, `FLOODWATCH_V3_DESIGN_SPEC.md`, `GOVERNMENT_ROUTING_READINESS_REPORT.md`, `PERFORMANCE_REPORT.md`, `RAINFALL_AUTOMATION_ARCHITECTURE.md`, `RESILIENCE_REPORT.md`, `ROUTING_VALIDATION_REPORT.md`, `UX_INFORMATION_AUDIT.md`, `PHASE_DEM_SENTINEL_REPORT.md`, `MANUAL_ACTIONS_REQUIRED.md`.
- Python data pipeline: `data/scripts/process_dem.py`, `dem_source.py`, `export_terrain_rgb.py`, `build_drainage_graph.py`, `flood_propagation_engine.py`, `build_whatif_scenarios.py`, `prepare_frontend_data.py`, `download_osm.py`, plus `data/data_manifest.json` and `data/processed/**` status/output files (drainage graph node/edge counts, terrain-RGB manifests, flood-frame summaries).
- Frontend TypeScript source: `frontend/src/lib/routingEngine.ts`, `riskModel.ts`, `colorRamps.ts`, `timeline.ts`; `frontend/src/components/map/MapContainer.tsx`; `frontend/src/components/routing/RoutingPanel.tsx`; `frontend/src/components/simulation/WhatIfPanel.tsx`; `frontend/src/api/hooks/useFloodData.ts` and related hooks; `frontend/src/stores/*`; `frontend/package.json`; `requirements.txt`.
- Live verification performed in this and prior sessions: `npx tsc -b`, `npm run build`, `npm run lint`, `routing_selftest.mjs`, and headless-Chrome/CDP browser testing across both pilot zones, all 7 timesteps, routing, What-If, and 3D/satellite rendering, including the specific performance measurements quoted in §23 of the report.

## Known limitations of this report

- It reports the project's state as of the time of generation. Numbers such as performance measurements (§23) were taken under headless Chrome with software (swiftshader) WebGL rendering, not a real GPU — this is disclosed explicitly in the report itself, not hidden.
- It does not independently re-derive or re-verify every number ever produced by the project's own prior audit reports (e.g. exact byte counts from very early sessions); where this report cites such a report, it is citing that report's own stated finding, not re-computing it from scratch.
- Team/author information could not be found anywhere in the repository and is explicitly marked "Not specified in the repository" on the cover page rather than invented.

## How to regenerate / update the report

1. Edit `FLOODWATCH_COMPLETE_PROJECT_REPORT.md` directly — it is the single source of truth; the PDF is a rendered artifact of it.
2. To regenerate the PDF, you need: a Chromium/Chrome binary, Node.js with the `ws` package (`npm install ws` in a scratch directory), and network access to `cdn.jsdelivr.net` (for `markdown-it` and `mermaid.js`).
3. Launch Chrome headless with remote debugging enabled, e.g.:
   ```
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --headless=new --disable-gpu --no-sandbox \
     --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile-pdf &
   ```
4. Run a small Node script (via the Chrome DevTools Protocol) that: injects the Markdown text into an HTML template containing `markdown-it` + `mermaid.js` (see the `report_template.html` pattern used to produce this PDF), navigates Chrome to that file, waits for `mermaid.run()` to finish (poll for a `window.__mermaidDone` flag or for `.mermaid svg` elements to exist), and then calls the `Page.printToPDF` CDP command with `displayHeaderFooter: true` and a footer template containing `<span class="pageNumber"></span>` / `<span class="totalPages"></span>` for automatic page numbers.
5. If a diagram renders illegibly small (many nodes side-by-side inside Mermaid `subgraph` blocks tend to compress badly on a portrait page), restructure it into fewer, grouped, vertically-stacked nodes rather than shrinking the whole page further — that is the fix already applied twice in this report's own diagrams 2 and 6.
