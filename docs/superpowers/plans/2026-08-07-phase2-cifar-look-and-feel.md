# Phase 2 · Cycle 1 — CIFAR Look & Feel + Pinned Ends — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the working v1 Theory of Change Explorer into a polished CIFAR-branded dark visualization, pin activities/outcomes to end columns (organic middle), add a flag-toggleable reinforcement-loop callout, and put a cosmetic "Dolly" password splash in front of it.

**Architecture:** Same static site (HTML/CSS/ES modules + vendored Cytoscape/dagre). The re-skin is CSS + the Cytoscape `STYLE` array; layout stays dagre with a post-layout repositioning pass that snaps the two end groups into columns; loop detection is a new pure helper in `graph-model.mjs`; the gate is a client-side overlay. Fira Sans is self-hosted (no CDN) alongside the vendored libraries.

**Tech Stack:** Cytoscape.js + cytoscape-dagre (vendored), native browser ES modules, self-hosted Fira Sans via `@fontsource/fira-sans`, Node.js `node:test` runner, GitHub Pages hosting.

## Global Constraints

- Static site, **no runtime CDN**: Fira Sans is self-hosted under `assets/fonts/` (matching how Cytoscape/dagre are vendored). All asset paths stay relative (site is served from a GitHub Pages subpath).
- **CIFAR palette (exact hex):** Red `#DA291C`, Navy `#001E62`, Vision Blue `#92C1E9`, Catalyst Yellow `#F8E59A`, Foundation Grey `#D9D9D6`, Black `#000000`, White `#FFFFFF`.
- **Node fill = type:** activity = `#92C1E9`, intermediate = `#D9D9D6`, outcome = `#DA291C`.
- **Trace = rings (keep type fill):** selected ring = `#FFFFFF`, upstream ring = `#92C1E9`, downstream ring = `#F8E59A`. Highlighted edges: upstream `#92C1E9`, downstream `#F8E59A`.
- **Fonts:** Fira Sans, weights 400/500/700/900, self-hosted `.woff2`; CSS stack `'Fira Sans', Verdana, sans-serif`.
- **Loop callout** lives behind a single `const SHOW_LOOPS = true;` in `src/app.mjs` — flipping to `false` reverts to plain edges.
- **Gate:** password is the exact string `Dolly`; it is a COSMETIC gate, NOT security. Never label it authentication in code/comments/UI. Session remembered via `sessionStorage` key `toc_unlocked`.
- **`brand/` is gitignored** (contains the internal style-guide PDF). Only the specific served files are committed under `assets/`. Never `git add brand/`.
- Node/npm are NOT on the Bash tool PATH; prepend `export PATH="/c/Program Files/nodejs:$PATH"` to every node/npm command. Git identity is configured.
- Existing test suite (currently 20 tests) must stay green. Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

```
src/graph-model.mjs   + findLoopEdges(data) -> Set<edgeId>   (new pure helper)
src/app.mjs           STYLE recolor to CIFAR; ring-based trace colors; post-layout pinEnds();
                      loop-edge class behind SHOW_LOOPS; gate wiring; transparent cy background
index.html            header logo + column labels; gate overlay markup; legend text
style.css             full CIFAR dark re-skin: tokens, header, glass panel, legend, gate,
                      @font-face for Fira Sans, dark canvas backdrop behind #cy
assets/               (committed) cifar-logo-white.png + fonts/*.woff2
scripts/copy-assets.mjs  (new) copies logo from brand/ + Fira Sans woff2 from node_modules into assets/
package.json          + devDependency @fontsource/fira-sans; + "assets" script
test/graph-model.test.mjs  + tests for findLoopEdges
```

---

### Task 1: `findLoopEdges` pure helper

Detects every edge that lies on a cycle, so the loop callout can style them. Pure and unit-tested.

**Files:**
- Modify: `src/graph-model.mjs`
- Test: `test/graph-model.test.mjs`

**Interfaces:**
- Consumes: the `data` shape `{ nodes:[{id,label,type}], edges:[{source,target}] }`.
- Produces: `findLoopEdges(data) -> Set<string>` — set of edge ids `` `${source}__${target}` `` for every edge whose target can reach its source (i.e. the edge is part of at least one cycle).

- [ ] **Step 1: Write the failing tests**

Append to `test/graph-model.test.mjs`:

```js
import { findLoopEdges } from '../src/graph-model.mjs';

test('findLoopEdges returns empty set for an acyclic graph', () => {
  const g = {
    nodes: [{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'intermediate'},{id:'c',label:'c',type:'outcome'}],
    edges: [{source:'a',target:'b'},{source:'b',target:'c'}],
  };
  assert.equal(findLoopEdges(g).size, 0);
});

test('findLoopEdges flags both edges of a 2-node cycle', () => {
  const g = {
    nodes: [{id:'a',label:'a',type:'intermediate'},{id:'b',label:'b',type:'intermediate'}],
    edges: [{source:'a',target:'b'},{source:'b',target:'a'}],
  };
  const loops = findLoopEdges(g);
  assert.ok(loops.has('a__b'));
  assert.ok(loops.has('b__a'));
  assert.equal(loops.size, 2);
});

test('findLoopEdges flags only the cycle edges in a mixed graph', () => {
  // a -> b -> c -> b (b<->c cycle), plus a->b entering it and c->d leaving it
  const g = {
    nodes: ['a','b','c','d'].map(id => ({id,label:id,type:'intermediate'})),
    edges: [{source:'a',target:'b'},{source:'b',target:'c'},{source:'c',target:'b'},{source:'c',target:'d'}],
  };
  const loops = findLoopEdges(g);
  assert.deepEqual([...loops].sort(), ['b__c','c__b']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/graph-model.test.mjs`
Expected: FAIL — `findLoopEdges` is not exported.

- [ ] **Step 3: Implement `findLoopEdges` in `src/graph-model.mjs`**

Add this exported function (an edge `u->v` is on a cycle iff `v` can reach `u`):

```js
export function findLoopEdges(data) {
  const children = new Map();
  for (const n of data.nodes) children.set(n.id, []);
  for (const e of data.edges) if (children.has(e.source) && children.has(e.target)) children.get(e.source).push(e.target);
  const canReach = (from, target) => {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
      const x = stack.pop();
      if (x === target) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const c of (children.get(x) || [])) stack.push(c);
    }
    return false;
  };
  const loops = new Set();
  for (const e of data.edges) {
    if (!children.has(e.source) || !children.has(e.target)) continue;
    if (canReach(e.target, e.source)) loops.add(`${e.source}__${e.target}`);
  }
  return loops;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS — all tests green (23 total: 20 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/graph-model.mjs test/graph-model.test.mjs
git commit -m "$(printf 'feat: findLoopEdges helper for reinforcement-loop callout\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Self-host assets (CIFAR logo + Fira Sans)

Get the logo and Fira Sans woff2 files into a committed `assets/` folder, plus a script to regenerate them.

**Files:**
- Modify: `package.json`
- Create: `scripts/copy-assets.mjs`
- Create: `assets/cifar-logo-white.png`, `assets/fonts/*.woff2` (produced by the script)

**Interfaces:**
- Consumes: `brand/CIFAR logo WHITE.png` (present locally, gitignored) and `@fontsource/fira-sans` (npm).
- Produces: committed files under `assets/` referenced by `style.css` and `index.html`.

- [ ] **Step 1: Add the font dependency and an `assets` script to `package.json`**

Add to `devDependencies`: `"@fontsource/fira-sans": "^5.0.0"`. Add to `scripts`: `"assets": "node scripts/copy-assets.mjs"`.

Then run: `export PATH="/c/Program Files/nodejs:$PATH"; npm install`

- [ ] **Step 2: Create `scripts/copy-assets.mjs`**

```js
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('../assets/fonts/', import.meta.url), { recursive: true });

// Logo (source lives in gitignored brand/; output assets/ is committed)
copyFileSync(
  new URL('../brand/CIFAR logo WHITE.png', import.meta.url),
  new URL('../assets/cifar-logo-white.png', import.meta.url),
);

// Fira Sans latin woff2, weights 400/500/700/900
for (const w of [400, 500, 700, 900]) {
  copyFileSync(
    new URL(`../node_modules/@fontsource/fira-sans/files/fira-sans-latin-${w}-normal.woff2`, import.meta.url),
    new URL(`../assets/fonts/fira-sans-${w}.woff2`, import.meta.url),
  );
}
console.log('assets copied: logo + Fira Sans 400/500/700/900');
```

- [ ] **Step 3: Run the script and verify outputs exist**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run assets && ls -l assets assets/fonts`
Expected: `assets/cifar-logo-white.png` and four `assets/fonts/fira-sans-*.woff2` files, all non-empty. If a `@fontsource` path 404s, run `ls node_modules/@fontsource/fira-sans/files | grep latin | grep normal` and correct the filenames in the script to the actual ones.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/copy-assets.mjs assets/
git commit -m "$(printf 'chore: self-host CIFAR logo and Fira Sans under assets/\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

(Do NOT `git add brand/` — it is gitignored and contains the internal style guide.)

---

### Task 3: DOM re-skin — `index.html` + `style.css`

The CIFAR dark theme for everything outside the Cytoscape canvas: header with logo, dark backdrop behind `#cy`, glass panel, legend, column labels, Fira Sans. (Gate markup comes in Task 6; Cytoscape node/edge colors in Task 4.)

**Files:**
- Modify: `index.html`
- Modify: `style.css` (full rewrite of the visual layer)

**Interfaces:**
- Consumes: `assets/cifar-logo-white.png`, `assets/fonts/*.woff2` (Task 2).
- Produces: the DOM ids the existing `app.mjs` already uses (`#topbar`, `#search`, `#reset`, `#cy`, `#panel`, `#p-name`, `#p-badge`, `#p-desc`, `#p-parents`, `#p-children`, `#legend`, `#node-list`) — do not rename them. Adds `.col-label` elements and updates legend swatch classes.

- [ ] **Step 1: Update `index.html` header and legend**

Replace the `<header id="topbar">…</header>` block with (adds the logo and a title wrapper; keeps `#search`/`#reset`):

```html
  <header id="topbar">
    <img id="brandlogo" src="assets/cifar-logo-white.png" alt="CIFAR">
    <span class="divider"></span>
    <h1>Theory of Change <b>Explorer</b></h1>
    <input id="search" list="node-list" placeholder="Search for a node…" autocomplete="off">
    <datalist id="node-list"></datalist>
    <button id="reset" type="button">Reset view</button>
  </header>
  <div id="topaccent"></div>
  <div class="col-label col-left">ACTIVITIES</div>
  <div class="col-label col-right">ULTIMATE OUTCOMES</div>
```

And update the legend labels/classes to the new palette (text unchanged, classes reused):

```html
  <div id="legend">
    <div><span class="dot activity"></span> Activity</div>
    <div><span class="dot intermediate"></span> Intermediate effect</div>
    <div><span class="dot outcome"></span> Ultimate outcome</div>
    <div class="sep"></div>
    <div><span class="swatch up"></span> upstream</div>
    <div><span class="swatch down"></span> downstream</div>
  </div>
```

- [ ] **Step 2: Rewrite `style.css` to the CIFAR dark theme**

Replace the entire file with:

```css
@font-face { font-family:'Fira Sans'; font-weight:400; font-display:swap; src:url('assets/fonts/fira-sans-400.woff2') format('woff2'); }
@font-face { font-family:'Fira Sans'; font-weight:500; font-display:swap; src:url('assets/fonts/fira-sans-500.woff2') format('woff2'); }
@font-face { font-family:'Fira Sans'; font-weight:700; font-display:swap; src:url('assets/fonts/fira-sans-700.woff2') format('woff2'); }
@font-face { font-family:'Fira Sans'; font-weight:900; font-display:swap; src:url('assets/fonts/fira-sans-900.woff2') format('woff2'); }

:root{
  --red:#DA291C; --navy:#001E62; --blue:#92C1E9; --yellow:#F8E59A; --grey:#D9D9D6;
  --bg0:#05080f; --bg1:#0a1020; --panel:rgba(12,18,32,.82); --line:#26324a; --text:#e8eefc; --muted:#8595b3;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg0);color:var(--text);
  font-family:'Fira Sans',Verdana,sans-serif;overflow:hidden}

/* dark backdrop shows through the transparent Cytoscape canvas */
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(1200px 700px at 68% 42%, rgba(0,30,98,.42), transparent 60%),
    radial-gradient(700px 500px at 12% 92%, rgba(218,41,28,.10), transparent 60%),
    linear-gradient(180deg,var(--bg1),var(--bg0));}
body::after{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.32;
  background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:26px 26px;}

#topbar{position:fixed;top:0;left:0;right:0;height:60px;display:flex;align-items:center;gap:16px;
  padding:0 20px;z-index:10;background:linear-gradient(180deg,rgba(5,8,15,.92),rgba(5,8,15,.35))}
#brandlogo{height:24px}
#topbar .divider{width:1px;height:24px;background:var(--line)}
#topbar h1{font-size:15px;font-weight:500;letter-spacing:.03em;margin:0;color:#fff;white-space:nowrap}
#topbar h1 b{color:var(--red);font-weight:700}
#search{margin-left:auto;flex:0 1 300px;background:rgba(255,255,255,.05);border:1px solid var(--line);
  color:var(--text);padding:9px 13px;border-radius:9px;font-size:13px;font-family:inherit}
#search:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(146,193,233,.16)}
#reset{background:rgba(255,255,255,.05);border:1px solid var(--line);color:#cdd7ee;
  padding:9px 13px;border-radius:9px;font-size:13px;font-family:inherit;cursor:pointer}
#reset:hover{background:rgba(255,255,255,.10)}
#topaccent{position:fixed;top:60px;left:0;right:0;height:2px;z-index:10;
  background:linear-gradient(90deg,var(--red),transparent 42%)}

.col-label{position:fixed;top:74px;z-index:6;font-size:11px;font-weight:700;letter-spacing:.16em;color:var(--muted)}
.col-left{left:26px} .col-right{right:346px;color:#ff6a5c}

#cy{position:fixed;top:62px;left:0;right:0;bottom:0;z-index:1;background:transparent}

#panel{position:fixed;top:60px;right:0;bottom:0;width:320px;z-index:9;background:var(--panel);
  backdrop-filter:blur(10px);border-left:1px solid var(--line);padding:24px 22px;overflow-y:auto}
#panel[hidden]{display:none}
#panel-close{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer}
#panel-close:hover{color:#fff}
#p-name{font-size:19px;font-weight:700;line-height:1.2;margin:2px 30px 12px 0}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;padding:5px 11px;border-radius:20px}
.desc{color:#c8d3df;font-size:13px;line-height:1.5}
.desc[hidden]{display:none}
.sec{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:20px 0 6px}
.lnk{display:block;padding:9px 11px;margin:5px 0;background:rgba(255,255,255,.04);border:1px solid var(--line);
  border-radius:8px;font-size:13px;line-height:1.35;cursor:pointer}
.lnk:hover{background:rgba(255,255,255,.09)}
.lnk.up{border-left:3px solid var(--blue)} .lnk.down{border-left:3px solid var(--yellow)}
.none{font-size:12px;color:var(--muted);font-style:italic}

#legend{position:fixed;left:22px;bottom:18px;z-index:9;display:flex;gap:14px;align-items:center;
  background:rgba(8,12,22,.72);border:1px solid var(--line);border-radius:12px;padding:10px 15px;font-size:12px;color:#cdd7ee}
#legend .dot{width:11px;height:11px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:middle}
#legend .swatch{width:20px;height:4px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle}
#legend .dot.activity{background:var(--blue)} #legend .dot.intermediate{background:var(--grey)} #legend .dot.outcome{background:var(--red)}
#legend .swatch.up{background:var(--blue)} #legend .swatch.down{background:var(--yellow)}
#legend .sep{width:1px;height:18px;background:var(--line)}
```

- [ ] **Step 3: Manual QA**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve` and open `http://localhost:3000`.
Verify (the graph nodes are still v1 colors until Task 4 — that's expected here):
- [ ] White CIFAR logo + "Theory of Change **Explorer**" title (Explorer in red) in the header, with the thin red accent line under it.
- [ ] Dark navy backdrop with the soft glow + dot grid visible behind the graph.
- [ ] Fira Sans is actually loading (labels/headings are Fira Sans, not a system serif — check the Network tab shows the woff2 files 200).
- [ ] "ACTIVITIES" label top-left, "ULTIMATE OUTCOMES" label top-right.
- [ ] Panel and legend are dark/glassy; legend swatches show blue/grey/red + upstream/downstream.
- [ ] No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "$(printf 'feat: CIFAR dark re-skin of page chrome (header, panel, legend, backdrop)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Cytoscape re-skin — CIFAR palette + ring-based trace

Recolor the graph nodes/edges to the CIFAR palette and set the trace ring colors. The trace already uses border rings (v1 `lit-up`/`lit-down` set `border-color` without changing fill) — this task recolors them and makes the Cytoscape canvas transparent so the CSS backdrop shows through.

**Files:**
- Modify: `src/app.mjs` (the `C` palette object lines 6, the `STYLE` array lines 8–27, and the `cytoscape({...})` init lines 35–41)

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged public behavior; only visuals change. `renderPanel` reads `C[n.type]` for the badge (line 68–69) — keep `C` keyed by `activity`/`intermediate`/`outcome`.

- [ ] **Step 1: Replace the `C` palette and `STYLE` array in `src/app.mjs`**

Replace lines 6–27 with:

```js
const C = { activity: '#92C1E9', intermediate: '#D9D9D6', outcome: '#DA291C', up: '#92C1E9', down: '#F8E59A' };

const STYLE = [
  { selector: 'node', style: {
      'background-color': C.intermediate, 'label': 'data(label)', 'color': '#e8eefc',
      'font-family': 'Fira Sans, Verdana, sans-serif', 'font-size': 11, 'text-wrap': 'wrap',
      'text-max-width': 130, 'text-valign': 'top', 'text-margin-y': -4, 'text-opacity': 0,
      'width': 16, 'height': 16, 'border-width': 0 } },
  { selector: 'node.activity', style: { 'background-color': C.activity, 'width': 20, 'height': 20 } },
  { selector: 'node.intermediate', style: { 'background-color': C.intermediate, 'width': 14, 'height': 14 } },
  { selector: 'node.outcome', style: { 'background-color': C.outcome, 'width': 30, 'height': 30 } },
  { selector: 'node.anchor', style: { 'text-opacity': 1 } },
  { selector: 'edge', style: {
      'width': 1, 'line-color': '#5a6b8c', 'opacity': 0.20, 'curve-style': 'bezier',
      'target-arrow-shape': 'triangle', 'target-arrow-color': '#5a6b8c', 'arrow-scale': 0.7 } },
  { selector: '.dim', style: { 'opacity': 0.08, 'text-opacity': 0 } },
  { selector: 'node.lit-sel', style: { 'text-opacity': 1, 'border-width': 3, 'border-color': '#ffffff', 'opacity': 1 } },
  { selector: 'node.lit-up', style: { 'text-opacity': 1, 'border-width': 3, 'border-color': C.up, 'opacity': 1 } },
  { selector: 'node.lit-down', style: { 'text-opacity': 1, 'border-width': 3, 'border-color': C.down, 'opacity': 1 } },
  { selector: 'edge.e-up', style: { 'line-color': C.up, 'target-arrow-color': C.up, 'opacity': 0.95, 'width': 2 } },
  { selector: 'edge.e-down', style: { 'line-color': C.down, 'target-arrow-color': C.down, 'opacity': 0.95, 'width': 2 } },
];
```

- [ ] **Step 2: Make the Cytoscape canvas transparent so the CSS backdrop shows**

In the `cytoscape({...})` init object (currently lines 35–41), do NOT set a background there (Cytoscape's container is transparent by default and `#cy { background: transparent }` from Task 3 lets the `body::before` gradient show). Confirm no opaque background is introduced. No code change is required beyond Step 1 if the container stays transparent — verify in QA.

- [ ] **Step 3: Manual QA**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve` and reload `http://localhost:3000`.
- [ ] Activities render Vision Blue, intermediates Foundation Grey (smaller), outcomes CIFAR Red (largest).
- [ ] The dark CSS backdrop shows through behind the nodes (canvas is transparent, not a flat block color).
- [ ] Click a node: it keeps its type fill and gains a **white** ring; upstream nodes gain **blue** rings, downstream **yellow** rings; off-chain nodes dim; edges light blue upstream / yellow downstream. The badge in the panel matches the node's type color.
- [ ] No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.mjs
git commit -m "$(printf 'feat: recolor graph to CIFAR palette with ring-based trace\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Pinned-end columns

After dagre lays out the graph, snap all activities to a far-left x and all outcomes to a far-right x (spreading each group vertically); leave intermediates where dagre put them.

**Files:**
- Modify: `src/app.mjs` (the graph-build block, currently lines 35–43)

**Interfaces:**
- Consumes: the initialized `cy` instance with `.activity`/`.outcome` classes already applied.
- Produces: `pinEnds(cy)` called once after layout, before `cy.fit`.

- [ ] **Step 1: Add `pinEnds` and call it after layout**

Change the graph-build block so the dagre layout runs explicitly, then `pinEnds(cy)` runs, then fit. Replace the current `cy = cytoscape({... layout: {...} ...}); cy.nodes('.activity, .outcome').addClass('anchor'); cy.fit(undefined, 40);` sequence with:

```js
  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: dataToElements(data),
    style: STYLE,
    layout: { name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 90, edgeSep: 10 },
    wheelSensitivity: 0.2,
  });
  cy.nodes('.activity, .outcome').addClass('anchor');
  pinEnds(cy);
  cy.fit(undefined, 40);
```

And define `pinEnds` (place it above the try block, after `STYLE`):

```js
function pinEnds(cy) {
  const xs = cy.nodes().map(n => n.position('x'));
  const ys = cy.nodes().map(n => n.position('y'));
  const leftX = Math.min(...xs), rightX = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const spread = (group, x) => {
    const sorted = group.sort((a, b) => a.position('y') - b.position('y'));
    const n = sorted.length;
    sorted.forEach((node, i) => {
      const y = n <= 1 ? (top + bottom) / 2 : top + (bottom - top) * (i / (n - 1));
      node.position({ x, y });
    });
  };
  spread(cy.nodes('.activity'), leftX);
  spread(cy.nodes('.outcome'), rightX);
}
```

Note: `cy.nodes().map(...)` returns a plain array of the callback results; `group.sort(...)` on a Cytoscape collection returns a sorted collection and `.forEach` iterates it. `dagre`'s layout runs synchronously during `cytoscape({...})` init, so positions are available immediately.

- [ ] **Step 2: Manual QA**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve` and reload.
- [ ] All activity nodes sit in a single vertical column on the far left; all outcome nodes in a single column on the far right.
- [ ] Intermediate nodes remain organically placed in between (NOT columned).
- [ ] Nodes within each end column are spread vertically without overlapping.
- [ ] Selecting/tracing still works; "Reset view" still fits the whole graph.
- [ ] No console errors.

- [ ] **Step 3: Confirm the unit suite is unaffected**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS (unchanged — this task is layout-only).

- [ ] **Step 4: Commit**

```bash
git add src/app.mjs
git commit -m "$(printf 'feat: pin activities and outcomes into end columns\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Reinforcement-loop callout (flagged)

Style edges that lie on a cycle distinctly, behind a `SHOW_LOOPS` flag.

**Files:**
- Modify: `src/app.mjs` (import `findLoopEdges`; add `SHOW_LOOPS`; add a `.loop` edge style; apply the class after build)

**Interfaces:**
- Consumes: `findLoopEdges(data) -> Set<string>` from Task 1; edge ids are `` `${source}__${target}` `` (matches `dataToElements`).

- [ ] **Step 1: Import `findLoopEdges` and add the flag + style**

Change the import line (currently line 1) to:

```js
import { dataToElements, computeTrace, directNeighbors, findLoopEdges } from './graph-model.mjs';
```

Add near the top (after the import), the flag with an honest comment:

```js
// Reinforcement-loop callout. Set to false to render loop edges as ordinary edges.
const SHOW_LOOPS = true;
```

Add a `.loop` edge entry to the `STYLE` array (after the base `edge` selector, before the `.dim` rule):

```js
  { selector: 'edge.loop', style: { 'line-color': '#DA291C', 'line-style': 'dashed', 'target-arrow-color': '#DA291C', 'opacity': 0.75, 'width': 2 } },
```

- [ ] **Step 2: Apply the loop class after the graph is built**

Immediately after `pinEnds(cy);` (and before `cy.fit`), add:

```js
  if (SHOW_LOOPS) {
    for (const key of findLoopEdges(data)) cy.getElementById(key).addClass('loop');
  }
```

- [ ] **Step 3: Manual QA**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve` and reload.
- [ ] The reinforcement loop ("Improve Canada's AI reputation" ↔ "Recruit and retain Canada CIFAR AI Chairs") shows as two dashed red edges.
- [ ] Temporarily set `SHOW_LOOPS = false`, reload: those edges render like all others. Set it back to `true`.
- [ ] Selecting a node still dims/traces correctly (loop edges obey dim when off the selected chain).
- [ ] No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/app.mjs
git commit -m "$(printf 'feat: reinforcement-loop edge callout behind SHOW_LOOPS flag\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Cosmetic "Dolly" gate

A full-screen splash requiring the password before the viz is shown. Cosmetic only.

**Files:**
- Modify: `index.html` (gate overlay markup), `style.css` (gate styles), `src/app.mjs` (gate wiring)

**Interfaces:**
- Consumes: `assets/cifar-logo-white.png`.
- Produces: gate overlay removed/hidden on success; `sessionStorage['toc_unlocked'] = '1'` remembers within the session.

- [ ] **Step 1: Add the gate markup to `index.html`**

Immediately after `<body>` (before `#topbar`), add:

```html
  <div id="gate">
    <div class="gate-card">
      <img src="assets/cifar-logo-white.png" alt="CIFAR">
      <h1>Theory of Change <b>Explorer</b></h1>
      <p>Enter the password to view</p>
      <div class="gate-field">
        <input id="gate-input" type="password" placeholder="Password" autocomplete="off">
        <button id="gate-enter" type="button">Enter</button>
      </div>
      <div id="gate-msg" class="gate-msg"></div>
    </div>
  </div>
```

- [ ] **Step 2: Add gate styles to `style.css`**

Append:

```css
#gate{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(1100px 700px at 50% 38%, rgba(0,30,98,.5), transparent 60%),
    radial-gradient(600px 500px at 50% 108%, rgba(218,41,28,.12), transparent 60%),
    linear-gradient(180deg,var(--bg1),var(--bg0));transition:opacity .4s ease}
#gate.hidden{opacity:0;pointer-events:none}
.gate-card{width:400px;max-width:90vw;text-align:center;background:rgba(10,15,28,.72);backdrop-filter:blur(14px);
  border:1px solid var(--line);border-radius:18px;padding:44px 40px 34px;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.gate-card img{height:28px;margin-bottom:24px}
.gate-card h1{font-size:20px;font-weight:500;margin:0 0 6px} .gate-card h1 b{color:var(--red);font-weight:700}
.gate-card p{font-size:13px;color:var(--muted);margin:0 0 24px}
.gate-field{display:flex;gap:10px}
#gate-input{flex:1;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:10px;
  padding:13px 15px;color:#fff;font-size:14px;font-family:inherit;outline:none}
#gate-input:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(146,193,233,.18)}
#gate-enter{background:var(--red);color:#fff;border:none;border-radius:10px;padding:0 22px;font-size:14px;
  font-weight:700;font-family:inherit;cursor:pointer}
#gate-enter:hover{background:#f0392b}
.gate-msg{margin-top:16px;font-size:12px;color:#ff6a5c;min-height:16px}
@keyframes gate-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
.gate-card.shake{animation:gate-shake .45s}
```

- [ ] **Step 3: Wire the gate in `src/app.mjs`**

At the very end of the file, append:

```js
// ---------- Cosmetic password gate (NOT security: the site is public) ----------
const GATE_PASSWORD = 'Dolly';
(function initGate() {
  const gate = document.getElementById('gate');
  if (!gate) return;
  if (sessionStorage.getItem('toc_unlocked') === '1') { gate.remove(); return; }
  const input = document.getElementById('gate-input');
  const card = gate.querySelector('.gate-card');
  const msg = document.getElementById('gate-msg');
  const submit = () => {
    if (input.value === GATE_PASSWORD) {
      sessionStorage.setItem('toc_unlocked', '1');
      gate.classList.add('hidden');
      setTimeout(() => gate.remove(), 450);
    } else {
      msg.textContent = 'Incorrect password';
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 500);
      input.select();
    }
  };
  document.getElementById('gate-enter').onclick = submit;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
})();
```

- [ ] **Step 4: Manual QA**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve` and open `http://localhost:3000` in a fresh tab (or clear sessionStorage).
- [ ] The gate splash covers the app on load, styled in the CIFAR dark theme with the logo.
- [ ] Wrong password → red "Incorrect password" + shake; the graph stays hidden.
- [ ] `Dolly` → gate fades out and removes, revealing the graph.
- [ ] Reload the tab → no gate (sessionStorage remembers). Open a brand-new tab → gate appears again.
- [ ] No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html style.css src/app.mjs
git commit -m "$(printf 'feat: cosmetic Dolly password gate splash\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: Deploy to GitHub Pages

Ship the cycle live and verify on the real URL.

**Files:** none (deploy only).

**Interfaces:**
- Consumes: the pushed `master` branch; the existing `origin` remote and Pages config from v1.

- [ ] **Step 1: Final full-suite + working-tree check**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS (23 tests). Then `git status --short` — confirm no stray files (especially nothing under `brand/`).

- [ ] **Step 2: Push**

```bash
git push
```

GitHub Pages auto-rebuilds from `master` (config unchanged from v1).

- [ ] **Step 3: Verify the live site**

Wait ~1–2 minutes, then load `https://brentbarron-eng.github.io/theory-of-change-explorer/` in a fresh tab and confirm:
- [ ] The "Dolly" gate appears; entering `Dolly` reveals the CIFAR-dark graph.
- [ ] Real data renders (36 nodes), pinned end columns, loop callout, fonts + logo load over HTTPS, no console errors.

There is no commit in this task (nothing to commit); it is the deploy + live verification gate.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- CIFAR dark re-skin (palette, Fira Sans self-hosted, logo header, glassy panel, glows/backdrop) → Tasks 2 (assets), 3 (chrome), 4 (graph colors + transparent canvas backdrop).
- Color encoding + ring-based trace → Task 4 (constraints copied verbatim into the `STYLE`/`C` values).
- Pinned ends, organic middle → Task 5.
- Loop callout behind `SHOW_LOOPS` → Tasks 1 (detection, TDD) + 6 (styling/flag).
- Cosmetic gate ("Dolly", sessionStorage, not-security) → Task 7, with the honest comment mandated by the spec.
- `brand/` gitignored, only `assets/` committed → enforced in Task 2 (and already committed to `.gitignore`).
- Testing: pure `findLoopEdges` TDD (Task 1); manual QA checklists for all visual/UI tasks; deploy verification (Task 8). Matches the spec's "automated tests light for visuals" stance.
- Deployment unchanged → Task 8.

**Placeholder scan:** No TBD/TODO/vague-instruction placeholders; every code step has real code and every QA step lists concrete checks.

**Type consistency:** `findLoopEdges` signature + `${source}__${target}` edge-id convention is identical in Tasks 1 and 6 and matches `dataToElements`. The `C` object stays keyed by `activity`/`intermediate`/`outcome` (+`up`/`down`) so `renderPanel`'s `C[n.type]` badge lookup keeps working after the recolor. DOM ids used by `app.mjs` are preserved in the `index.html` changes (Task 3). `pinEnds`/`SHOW_LOOPS`/`GATE_PASSWORD` are each defined once in the task that introduces them.

**Note on glows:** the "glow" from the mockups is provided by the CSS backdrop behind the transparent Cytoscape canvas (Tasks 3–4), not by per-node canvas glows (Cytoscape's canvas renderer has no reliable glow primitive). This is intentional and keeps the premium feel without fighting the renderer.
