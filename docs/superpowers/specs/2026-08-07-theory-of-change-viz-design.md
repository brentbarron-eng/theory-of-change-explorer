# Theory of Change Explorer — Design Spec

**Date:** 2026-08-07
**Status:** Approved design, ready for implementation planning

## Purpose

An interactive web visualization that lets people explore the organization's
theory of change for its research programming: the chain of effects that runs
from each program activity, through several stages of intermediate effects, to
ultimate outcomes such as "social and economic benefits to Canadians."

The primary use is **self-serve exploration** — a colleague opens a public link
and, on their own, selects any node to see what contributes to it and what it
leads to. A secondary benefit is presentation ("wow") value, but legibility and
solo discoverability always win over visual flash.

The tool exists to do what a static Gephi export cannot: make the directional,
causal story legible and let users trace chains interactively.

## Data

- Source of truth: a Notion database where each node is a page, with **How** and
  **Why** relation properties linking nodes. These relations give the graph its
  direction.
- The graph is a **directed acyclic graph (DAG)**, not clean layers. The longest
  chain is roughly 7 stages, but chains vary in length and nodes cross-link
  between chains (a node can be, say, 4th in one chain and 2nd in another).
- Expected scale at maturity: ~50 nodes.
- Node types today: **activity** and **ultimate outcome** are explicitly marked
  in Notion. Everything else is treated as **intermediate**. More attributes
  (descriptions, categories) may be added later.

## Key Decisions

1. **2D layered flow, not 3D.** A 3D "sphere" layout was prototyped and rejected —
   occlusion and moving labels made it illegible. Legibility comes from
   *interaction* (focus-driven highlighting), not a third dimension.
2. **Static site, no backend.** Hosted as plain static files on the open web
   (e.g. Netlify, Cloudflare Pages, GitHub Pages). Graph data is a JSON file
   bundled with the page.
3. **Static data export, not live Notion.** A theory of change changes rarely, so
   `data.json` is regenerated on demand by a script and committed. The live site
   has no runtime dependency on Notion.
4. **Cytoscape.js** as the graph engine, with a **dagre** (or elk) layout add-on
   for automatic layered arrangement. Chosen over React Flow (needs a build
   toolchain and manual auto-layout) and hand-rolled D3 (most code and bugs).
   Cytoscape's built-in `.predecessors()` / `.successors()` map directly onto the
   "contributes to / leads to" traversal.

## Architecture

All runtime files are static:

```
index.html      the page
app.js          loads data.json, builds the graph, handles interaction
style.css       styling + side panel
data.json       the theory of change (nodes + edges), exported from Notion
vendor/         cytoscape.js + cytoscape-dagre, vendored locally (no CDN)
```

Two separate concerns that never meet at runtime:

- **Runtime** — the static site above. Loads `data.json` on page load. Zero
  external dependencies (libraries are vendored, not loaded from a CDN), so a
  network hiccup or CSP cannot break it.
- **Data refresh** — a script (below) that regenerates `data.json` from Notion,
  run occasionally by hand.

## Data Model

`data.json`:

```json
{
  "nodes": [
    { "id": "…", "label": "…", "type": "activity|intermediate|outcome", "description": "…(optional)" }
  ],
  "edges": [
    { "source": "cause-node-id", "target": "effect-node-id" }
  ]
}
```

- Edges are directed **cause → effect** (activity → … → outcome).
- `type` is `activity` or `outcome` where marked in Notion, else `intermediate`.
- `description` is optional. If present it shows in the side panel; if absent,
  nothing breaks. Adding descriptions later needs no code change.

## Notion → data.json Pipeline

A small Node script using the Notion API (with a generated integration token):

- Each Notion page → one node.
- Activity/outcome markers → `type`; everything else → `intermediate`.
- The **How/Why** relations → edges.
- **Direction mapping to confirm against real data at build time:** working
  assumption is **How = what contributes to this node (upstream)** and
  **Why = what this node leads to (downstream)**. Only one direction is needed to
  build edges; the build picks the canonical direction and de-duplicates.
- Output is written to `data.json` and committed.
- Fallback if API access is awkward: export the Notion DB to CSV and run a small
  parser instead.

## Layout & Visual Encoding

- **dagre layout, left → right.** Activities pinned left, ultimate outcomes right,
  intermediates arranged by causal depth in between. Positions are computed, never
  placed by hand.
- **Color by type:** activity = green, intermediate = blue, outcome = purple.
  Ultimate outcomes are styled slightly larger/bolder as the visual destination.
- **Directed, gently curved edges** with subtle arrowheads.

## Interaction Model (core)

- **Overview state:** nodes colored by type, edges faint, labels shown only on
  activities and ultimate outcomes. The canvas reads as *shape*, not a wall of
  text — this is what keeps ~50 nodes legible.
- **Hover:** reveal that node's label + a tooltip.
- **Click a node:** dim everything except its chain —
  **teal = contributes to it (all upstream ancestors)**,
  **amber = it leads to (all downstream descendants)** — reveal labels along the
  lit path, and open the side panel.
- **Search box:** type to find and jump to any node by name. Essential for
  self-serve discovery at 50 nodes.
- **Click empty space:** return to overview. Plus reset/fit controls (Cytoscape
  provides pan/zoom for free).

## Side Panel

On selection, shows:

- Node **name**
- **Type badge**
- **Description** (if present)
- **"Contributed to by"** — direct parents, each clickable
- **"Leads to"** — direct children, each clickable

Clicking an entry selects that node, so a user can walk the chain node by node
without hunting on the canvas.

## Testing

- **Data validation (automated), run on every `data.json` build:**
  - no edge references a missing node,
  - the graph has no cycles (must remain a DAG),
  - every node has a valid `type`,
  - no orphan nodes (every node connected).
  Catches Notion data problems before they reach the site.
- **App (manual QA checklist):** selection traces the correct upstream/downstream
  set; search jumps to the right node; overview restores on background click;
  labels appear/hide as specified. Automated UI tests are intentionally light —
  this is a visualization.

## Out of Scope for v1

- **Focus mode** (deferred fast-follow). Future intent: when enabled, non-chain
  nodes disappear entirely and the selected node's ancestors + descendants
  re-lay-out for maximum legibility. Cheap to add later because the
  ancestor/descendant traversal already exists in v1.
- In-app editing of the graph.
- Live Notion sync.
- Accounts / logins.
- Multiple theories of change.
- Mobile-gesture optimization (the site will function on mobile but is not
  optimized for it).

## Reference

- Rejected 3D prototype and the 2D interaction prototype live under
  `.superpowers/brainstorm/` (companion session artifacts). The production build
  reuses none of that throwaway code; it demonstrated the interaction and settled
  the 2D-vs-3D decision only.
