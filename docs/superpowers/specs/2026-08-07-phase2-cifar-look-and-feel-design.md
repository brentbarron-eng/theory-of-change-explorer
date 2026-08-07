# Phase 2 · Cycle 1 — CIFAR Look & Feel + Pinned Ends — Design Spec

**Date:** 2026-08-07
**Status:** Approved design, ready for implementation planning
**Builds on:** the shipped v1 (see `2026-08-07-theory-of-change-viz-design.md`)

## Purpose

Restyle the working v1 Theory of Change Explorer into a polished, CIFAR-branded
dark visualization, pin the two ends of the flow into columns, add a
(disableable) reinforcement-loop callout, and put a cosmetic password gate in
front of it. This is the first of several phase-2 cycles; the remaining backlog
items (focus mode, node descriptions, softening orphan validation) are out of
scope here and get their own cycles.

The aesthetic goal, in the user's words: "look cool," even at the cost of being
slightly brand-divergent — use the CIFAR palette and typeface but push toward a
premium, glowy dark data-viz feel rather than strict brand-doc literalism.

## Scope (this cycle)

1. **CIFAR dark re-skin** — palette, typography, logo header, glassy panel, glows.
2. **Pinned ends** — activities pinned to a far-left column, ultimate outcomes to
   a far-right column; intermediates left organic (deliberately, to show complexity).
3. **Reinforcement-loop callout** — behind an on/off flag, on by default.
4. **Cosmetic password gate** — a "Dolly" splash before the viz.

Explicitly NOT in this cycle: focus mode, Notion `Text`→description wiring,
softening orphan validation, pinning/columning the intermediates.

## Brand Tokens (from the CIFAR Brand Style Guide 2026)

**Palette**
- CIFAR Red `#DA291C` (primary / hero accent, and the "peak/impact" color)
- Black `#000000`, White `#FFFFFF`
- Breakthrough Navy `#001E62` (dark-canvas tint / glow)
- Vision Blue `#92C1E9`
- Catalyst Yellow `#F8E59A`
- Foundation Grey `#D9D9D6`

**Typography**
- **Fira Sans** (CIFAR primary typeface; free/open, SIL OFL). **Self-hosted** —
  ship a small set of `.woff2` weights (400, 500, 700, 900) under
  `assets/fonts/` with an `@font-face` block. No CDN (keeps the site
  self-contained, matching how Cytoscape/dagre are vendored). Verdana is the
  system fallback in the stack.

**Logo**
- Use `CIFAR logo WHITE.png` (white wordmark) on the dark canvas, copied into a
  committed `assets/` folder. Rendered as an image only, never re-typeset.

## Visual Design

### Canvas & chrome (dark theme)
- Background: near-black navy blend — deep base (`~#05080f`→`#0a1020`) with a
  soft CIFAR-Navy radial glow and a faint CIFAR-Red glow in a lower corner, plus
  a subtle dotted grid overlay.
- Header bar: white CIFAR logo left, a thin CIFAR-Red accent line beneath the
  header, Fira Sans title ("Theory of Change Explorer"), restyled search box and
  reset control in the dark style.
- Side panel: right, dark "glass" (translucent + blur), Fira Sans, red type-badge
  for outcomes; keeps the v1 structure (name, type badge, "Contributed to by" /
  "Leads to" clickable lists).
- Legend bottom-left; column labels "ACTIVITIES" (left) and "ULTIMATE OUTCOMES"
  (right) aligned over the pinned columns. No middle label (the middle is
  intentionally not a column).

### Color encoding & trace interaction
- **Node fill = type:** activity = Vision Blue `#92C1E9`; intermediate =
  Foundation Grey `#D9D9D6` (rendered smaller / lower-emphasis so the ends lead);
  outcome = CIFAR Red `#DA291C` (largest, with a red glow).
- **Trace on selection uses RINGS/glows, not repainting** — each node keeps its
  type fill; a colored ring + glow shows its role: **selected = white**,
  **upstream ancestors = Vision Blue ring**, **downstream descendants = Catalyst
  Yellow ring**. Off-chain nodes dim. Highlighted edges glow blue (upstream) /
  yellow (downstream). This preserves each node's type identity while tracing.

### Loop callout (flagged)
- A `SHOW_LOOPS` flag (default `true`, a single easily-commented line/constant).
- When on: edges that participate in a cycle are styled distinctly (e.g. CIFAR
  Red, dashed/curved) and/or loop nodes get a small `↺` marker, so a reinforcement
  loop reads as intentional rather than looking like a mistake.
- When off: loops render as ordinary edges (v1 behavior).
- Loop membership is computed by a pure helper in `graph-model.mjs` (below).

### Pinned ends (layout)
- Keep Cytoscape + dagre (`rankDir: 'LR'`) for the organic middle.
- After the dagre layout runs, **reposition only the two end groups**: set every
  `activity` node's x to a fixed left margin and every `outcome` node's x to a
  fixed right margin, spreading each group vertically to avoid overlap; leave all
  intermediate positions as dagre placed them; then `fit`. (Activities are
  sources so dagre already places them leftmost; the meaningful override is
  forcing every outcome to the far right regardless of its chain length.)
- This yields "clear starts on the left → tangled middle → impact on the right."

### Password gate (cosmetic — NOT security)
- A full-screen splash over the app: dark canvas, glass card, white CIFAR logo,
  title, a password input + red "Enter" button, subtle footer.
- Correct password (`Dolly`) hides the splash and reveals the graph; a wrong
  entry gives a brief shake + "incorrect" message. A `sessionStorage` flag
  avoids re-prompting on reload within the same browser session.
- **This is explicitly cosmetic.** The site is public; `data.json`, the code, and
  the password string are all publicly readable. The gate only hides the
  *rendered UI* from casual visitors and protects nothing. This limitation is
  understood and accepted (see the decision record in the conversation). Do not
  represent it as authentication anywhere in code comments or UI.

## Code / Structure

- `index.html` — add the gate overlay markup and the header logo + column labels.
- `style.css` — the bulk of the re-skin: CIFAR dark tokens, header, glass panel,
  legend, gate card, `@font-face` for Fira Sans.
- `src/app.mjs` — recolor the Cytoscape `STYLE` to the CIFAR palette; switch trace
  to ring/glow classes; add the post-layout pinned-ends repositioning; apply loop
  edge/node styling behind `SHOW_LOOPS`; wire the gate (check password, reveal
  app, sessionStorage). Uses the new `findLoopEdges` helper.
- `src/graph-model.mjs` — add a pure `findLoopEdges(data) -> Set<string>`
  returning the set of edge ids (`${source}__${target}`) that lie on a cycle.
  Reuses the existing cycle-detection machinery. Pure and unit-testable.
- `assets/` (committed) — `cifar-logo-white.png` and `fonts/` (Fira Sans woff2).
- `brand/` — **gitignored.** Contains the internal style-guide PDF and source
  logos; must not be published to the public repo. Only the specific assets we
  serve are copied into `assets/`.

## Testing

- **Automated (pure logic):**
  - `findLoopEdges` — a graph with a known 2-node cycle returns exactly those two
    edge ids; an acyclic graph returns an empty set; the real reinforcement loop
    (reputation ↔ chairs) is detected.
  - If the pinned-ends x-assignment is extracted as a pure helper (given node
    type + a left/right x → chosen x), unit-test that activities get leftX and
    outcomes get rightX.
- **Manual QA checklist:**
  - Gate: correct password reveals the graph; wrong password is rejected; reload
    within session skips the gate.
  - Re-skin renders (logo, fonts, palette, glows) with no console errors.
  - Trace rings: selecting a node rings ancestors blue / descendants yellow /
    self white, keeping type fills; off-chain dims.
  - Pinned ends: all activities sit in the left column, all outcomes in the right
    column, intermediates organic between.
  - Loop callout visible with `SHOW_LOOPS = true`; flipping it off reverts to
    plain edges.
- Deployment unchanged: static site, `git push` → GitHub Pages rebuilds.

## Out of Scope / Future (unchanged from v1 backlog)

Focus mode; Notion `Text`→description in the panel; softening orphan validation
from error to warning; pinning/columning intermediates (deliberately rejected —
the organic middle is a feature). Loop *callout* is in scope here (flagged);
richer loop visualization can still evolve later.
