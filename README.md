# Theory of Change Explorer

Interactive visualization of the organization's theory of change: click any node
to trace what contributes to it (upstream) and what it leads to (downstream).
Static site — no server or database at runtime.

## Run locally

    npm install
    npm run vendor      # copies cytoscape/dagre into vendor/ (first time only)
    npm run serve       # serves at http://localhost:3000

The site must be served over HTTP (ES modules + fetch don't work from file://).

## Refresh the data from Notion

1. Create a Notion integration and copy its token: https://www.notion.so/my-integrations
2. Share the theory-of-change database with that integration.
3. Copy `.env.example` to `.env` and fill in `NOTION_TOKEN` and `NOTION_DATABASE_ID`.
4. Run:

        npm run build-data   # queries Notion, validates, rewrites data.json
        npm run validate     # optional re-check

Commit the regenerated `data.json`. The node types come from the `Type` property
(Activity / Ultimate outcome; everything else is intermediate) and edges come from
the How/Why relations. Property names live in `DEFAULT_CONFIG` in
`scripts/notion-transform.mjs`.

**Before the first real export**, verify these assumptions against the actual
Notion database — the property names in `DEFAULT_CONFIG` (`Name`, `Type`,
`How`, `Why`, and the `Activity` / `Ultimate outcome` type values) are current
best guesses, not confirmed against the live schema. If the How/Why relations
turn out to point the opposite way in your database, the resulting edges will
trace backwards; swap `upstreamRelation` and `downstreamRelation` in
`DEFAULT_CONFIG` (or adjust `scripts/notion-transform.mjs` directly) and re-run
`npm run build-data` until a known activity-to-outcome chain traces correctly.

## Deploy

The deployable site is the repository root (index.html, style.css, src/, vendor/,
data.json). It is fully static. Any static host works:

- Netlify / Cloudflare Pages: connect the repo (no build command; publish directory = root)
  or drag-and-drop the folder.
- GitHub Pages: serve the repo root.

`node_modules/` and `.env` are gitignored and never deployed.

## Tests

    npm test    # runs node --test over test/

Pure logic (graph validation, traversal, Notion transform) is unit-tested.
Browser interaction is verified with the manual QA checklist below.

## Manual QA checklist

- Overview: activities left (green), outcomes right (purple), intermediates between (blue);
  only activities/outcomes labelled; outcomes larger.
- Click a node: rest dims, upstream lights teal, downstream lights amber, path labels appear.
- Side panel: name, type badge, description (if any), clickable "Contributed to by" / "Leads to".
- Search: autocompletes node names and jumps to the selected node.
- Empty-canvas click / close button / Reset view all return to overview.
