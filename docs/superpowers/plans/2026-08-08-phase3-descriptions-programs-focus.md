# Phase 3 (final) — Descriptions/Metrics, Program Filter, Focus Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-node description + success metric in the side panel, add a bottom program-filter (workstream visibility, propagated from activities), add a focus mode that isolates a selected node's chain, and soften orphan validation to a non-fatal warning.

**Architecture:** Same static site (vendored Cytoscape/dagre, ES modules). New pure logic (`computeNodePrograms`, extended `notionToGraph`, softened `validateGraph`) is unit-tested in the existing `node:test` suite; the browser wiring (panel line, filter checkboxes, focus toggle) is driven and verified through DOM interactions and manual QA. `data.json` is regenerated from the live Notion DB with the new fields.

**Tech Stack:** Cytoscape.js + cytoscape-dagre (vendored), native ES modules, `@notionhq/client` for the refresh, Node `node:test`, GitHub Pages.

## Global Constraints

- Static site, no runtime CDN; all asset paths relative. Existing CIFAR dark theme + Fira Sans stay as-is.
- **Node/npm are NOT on the Bash tool PATH.** Prepend `export PATH="/c/Program Files/nodejs:$PATH"` to every node/npm command.
- **`brand/` and `.env` stay gitignored** — never `git add brand/` or `.env`; stage files explicitly by path, never `git add -A`.
- Existing suite (currently 24 tests) must stay green. Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Node data shape after this cycle: `{ id, label, type, description?, metric?, programs? }` where `programs` is a `string[]`. Edges unchanged (`{source,target}`, id `` `${source}__${target}` ``).
- Notion property names (confirmed live 2026-08-08): `Name`, `Type` (Activity/Outcome/Intermediate), `How`/`Why`, `Description` (rich_text), `Metric` (rich_text), `Program` (multi_select).
- Program filter is **propagation** semantics; program-less nodes are labeled **"Out of Scope"**; default all boxes checked. Focus mode **ignores** the program filter while active.
- `.env` already holds a working `NOTION_TOKEN` + `NOTION_DATABASE_ID` (Task 3 uses them).

## File Structure

```
src/graph-model.mjs        + computeNodePrograms(data); orphan error -> warning; programs-array validation
scripts/notion-transform.mjs  extract Description/Metric/Program into node fields
data.json                  regenerated from live Notion (new fields)
index.html                 + panel metric block; + focus button; + bottom #filterbar
style.css                  + .metric, #focus-btn, #filterbar styles
src/app.mjs                metric in renderPanel; program filter (computeNodePrograms + checkboxes); focus mode; generalize pinEnds to a node subset
test/graph-model.test.mjs  + computeNodePrograms tests; + orphan-warning / programs-validation tests
test/notion-transform.test.mjs  + description/metric/programs extraction tests
test/fixtures/notion-pages.json  add the new properties to fixture pages
```

---

### Task 1: graph-model — program propagation + softened orphan validation

**Files:**
- Modify: `src/graph-model.mjs`
- Test: `test/graph-model.test.mjs`

**Interfaces:**
- Consumes: `data` `{nodes:[{id,label,type,programs?}], edges}`; existing `adjacency`.
- Produces: `computeNodePrograms(data) -> Map<string, Set<string>>` — each node id mapped to its program set (activities' own programs, propagated to all descendants; empty set if reachable from no tagged activity). `validateGraph`: orphan nodes now push to `warnings` not `errors`; a node whose `programs` is present but not a string array pushes an error.

- [ ] **Step 1: Write the failing tests**

Append to `test/graph-model.test.mjs`:

```js
import { computeNodePrograms } from '../src/graph-model.mjs';

test('computeNodePrograms: activity carries its own programs', () => {
  const g = { nodes:[{id:'a',label:'a',type:'activity',programs:['P1']}], edges:[] };
  assert.deepEqual([...computeNodePrograms(g).get('a')], ['P1']);
});

test('computeNodePrograms: descendants inherit the reaching activity programs', () => {
  const g = {
    nodes:[{id:'a',label:'a',type:'activity',programs:['P1']},{id:'m',label:'m',type:'intermediate'},{id:'o',label:'o',type:'outcome'}],
    edges:[{source:'a',target:'m'},{source:'m',target:'o'}],
  };
  const r = computeNodePrograms(g);
  assert.deepEqual([...r.get('m')], ['P1']);
  assert.deepEqual([...r.get('o')], ['P1']);
});

test('computeNodePrograms: a node reached by two programs gets the union', () => {
  const g = {
    nodes:[
      {id:'a1',label:'a1',type:'activity',programs:['P1']},
      {id:'a2',label:'a2',type:'activity',programs:['P2']},
      {id:'m',label:'m',type:'intermediate'},
    ],
    edges:[{source:'a1',target:'m'},{source:'a2',target:'m'}],
  };
  assert.deepEqual([...computeNodePrograms(g).get('m')].sort(), ['P1','P2']);
});

test('computeNodePrograms: node reachable from no tagged activity is empty (Out of Scope)', () => {
  const g = {
    nodes:[{id:'a',label:'a',type:'activity'},{id:'m',label:'m',type:'intermediate'}],
    edges:[{source:'a',target:'m'}],
  };
  const r = computeNodePrograms(g);
  assert.equal(r.get('a').size, 0);
  assert.equal(r.get('m').size, 0);
});

test('validateGraph: orphan node is a warning, not an error', () => {
  const g = {
    nodes:[{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'outcome'},{id:'lonely',label:'l',type:'intermediate'}],
    edges:[{source:'a',target:'b'}],
  };
  const r = validateGraph(g);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some(w => w.includes('orphan')));
  assert.ok(!r.errors.some(e => e.includes('orphan')));
});

test('validateGraph: non-array programs is an error', () => {
  const g = { nodes:[{id:'a',label:'a',type:'activity',programs:'P1'}], edges:[{source:'a',target:'a'}] };
  assert.ok(validateGraph(g).errors.some(e => e.includes('programs')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/graph-model.test.mjs`
Expected: FAIL — `computeNodePrograms` not exported; orphan still an error; no programs check.

- [ ] **Step 3: Implement in `src/graph-model.mjs`**

In `validateGraph`, add a programs check inside the node loop (right after the `type` check on line 15):

```js
    if (n.programs !== undefined && (!Array.isArray(n.programs) || n.programs.some(p => typeof p !== 'string')))
      errors.push(`node ${n.id} has invalid programs (must be a string array)`);
```

Change the orphan line (currently line 29) from an error to a warning:

```js
  for (const id of ids) if (!connected.has(id)) warnings.push(`orphan node (no edges): ${id}`);
```

Add the exported helper (e.g. after `computeTrace`):

```js
export function computeNodePrograms(data) {
  const { children } = adjacency(data);
  const result = new Map(data.nodes.map(n => [n.id, new Set()]));
  for (const n of data.nodes) {
    if (n.type !== 'activity' || !Array.isArray(n.programs) || n.programs.length === 0) continue;
    const stack = [n.id];
    const seen = new Set();
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      const set = result.get(x);
      if (set) for (const p of n.programs) set.add(p);
      for (const c of (children.get(x) || [])) stack.push(c);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS — all green (30 total: 24 existing + 6 new). If the existing `'orphan node fails'` test from an earlier cycle now conflicts (it asserted `ok:false` on an orphan), UPDATE that test to the new behavior (orphan → `ok:true` with a warning) — do not keep two contradictory orphan tests. Note the change in your report.

- [ ] **Step 5: Commit**

```bash
git add src/graph-model.mjs test/graph-model.test.mjs
git commit -m "$(printf 'feat: node-program propagation; soften orphan to warning; validate programs\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: notion-transform — extract Description / Metric / Program

**Files:**
- Modify: `scripts/notion-transform.mjs`
- Modify: `test/fixtures/notion-pages.json`
- Test: `test/notion-transform.test.mjs`

**Interfaces:**
- Consumes: Notion page objects.
- Produces: `notionToGraph` nodes now include `description` (from `Description` rich_text), `metric` (from `Metric` rich_text), and `programs` (from `Program` multi_select names) — each omitted when empty. `DEFAULT_CONFIG` gains `descriptionProp:'Description'`, `metricProp:'Metric'`, `programProp:'Program'`.

- [ ] **Step 1: Extend the fixture**

In `test/fixtures/notion-pages.json`, add these properties to the `p-mid` page's `properties` object (a middle node), so a node exercises all three fields:

```json
    "Description": { "rich_text": [ { "plain_text": "Collaboration description." } ] },
    "Metric": { "rich_text": [ { "plain_text": "# of joint projects" } ] },
    "Program": { "multi_select": [ { "name": "AI Policy" }, { "name": "CAISI" } ] }
```

(Leave the other fixture pages without these properties so the "omitted when empty" case is covered.)

- [ ] **Step 2: Write the failing tests**

Append to `test/notion-transform.test.mjs`:

```js
test('notionToGraph extracts description, metric, and programs', () => {
  const { nodes } = notionToGraph(pages);
  const mid = nodes.find(n => n.id === 'p-mid');
  assert.equal(mid.description, 'Collaboration description.');
  assert.equal(mid.metric, '# of joint projects');
  assert.deepEqual(mid.programs, ['AI Policy', 'CAISI']);
});

test('notionToGraph omits empty description/metric/programs', () => {
  const { nodes } = notionToGraph(pages);
  const act = nodes.find(n => n.id === 'p-act');
  assert.equal('description' in act, false);
  assert.equal('metric' in act, false);
  assert.equal('programs' in act, false);
});
```

(`pages` and `notionToGraph` are already imported at the top of this test file.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/notion-transform.test.mjs`
Expected: FAIL — fields not extracted yet.

- [ ] **Step 4: Implement in `scripts/notion-transform.mjs`**

Add to `DEFAULT_CONFIG`:

```js
  descriptionProp: 'Description',
  metricProp: 'Metric',
  programProp: 'Program',
```

Replace the `nodes` mapping (currently lines 16–20) with:

```js
  const nodes = pages.map(p => {
    const node = { id: p.id, label: plainTitle(p, cfg.titleProp), type: typeOf(p, cfg) };
    const description = plainRich(p, cfg.descriptionProp);
    const metric = plainRich(p, cfg.metricProp);
    const programs = multiSelectNames(p, cfg.programProp);
    if (description) node.description = description;
    if (metric) node.metric = metric;
    if (programs.length) node.programs = programs;
    return node;
  });
```

Add these helpers (next to `plainTitle`):

```js
function plainRich(p, prop) {
  return (p.properties?.[prop]?.rich_text || []).map(x => x.plain_text).join('').trim();
}

function multiSelectNames(p, prop) {
  return (p.properties?.[prop]?.multi_select || []).map(o => o.name);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS — all green (32 total: 30 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add scripts/notion-transform.mjs test/notion-transform.test.mjs test/fixtures/notion-pages.json
git commit -m "$(printf 'feat: extract Description/Metric/Program from Notion into node fields\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Regenerate `data.json` from the live Notion DB

**Files:**
- Modify: `data.json` (regenerated)

**Interfaces:**
- Consumes: `.env` (`NOTION_TOKEN`, `NOTION_DATABASE_ID`), the Task 2 transform, the Task 1 validator.
- Produces: `data.json` carrying `programs` (on activities), `metric` (~3 nodes), and any `description`, plus whatever orphan/cycle warnings the data has (non-fatal).

- [ ] **Step 1: Regenerate**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run build-data`
Expected: prints node/edge counts and "Wrote data.json"; any orphan/cycle warnings are printed but do NOT block the write (Task 1 softened them). If it exits non-zero, read the printed errors — a real error (dangling edge, bad type) must be fixed in Notion, not worked around.

- [ ] **Step 2: Sanity-check the output**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run validate` (expect valid, warnings allowed), then:
```bash
node -e "const d=require('fs').readFileSync('./data.json','utf8');const g=JSON.parse(d);console.log('nodes',g.nodes.length,'with programs',g.nodes.filter(n=>n.programs).length,'with metric',g.nodes.filter(n=>n.metric).length)"
```
Expected: ~37 nodes, ~10 with `programs`, ~3 with `metric`. Then confirm the unit suite still passes: `node --test` (32).

- [ ] **Step 3: Commit**

```bash
git add data.json
git commit -m "$(printf 'chore: regenerate data.json with programs/metric/description fields\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

(Do NOT stage `.env` — confirm `git status --short` shows only `data.json`.)

---

### Task 4: Side panel — success metric line

Description already renders in the panel (`#p-desc`). This adds the metric line.

**Files:**
- Modify: `index.html` (add metric block to the panel)
- Modify: `src/app.mjs` (`renderPanel`)
- Modify: `style.css` (metric styling)

**Interfaces:**
- Consumes: `n.metric` on the selected node.
- Produces: `#p-metric` block, shown only when the node has a metric.

- [ ] **Step 1: Add the metric block to `index.html`**

In `#panel`, immediately after `<p id="p-desc" class="desc"></p>` (line 40), add:

```html
    <div id="p-metric" class="metric" hidden>
      <div class="metric-label">How we measure success</div>
      <div id="p-metric-text"></div>
    </div>
```

- [ ] **Step 2: Populate it in `renderPanel` (`src/app.mjs`)**

Immediately after the description lines (currently lines 122–124: `const desc = …; desc.textContent …; desc.hidden …;`), add:

```js
  const metricBox = document.getElementById('p-metric');
  document.getElementById('p-metric-text').textContent = n.metric || '';
  metricBox.hidden = !n.metric;
```

- [ ] **Step 3: Style it in `style.css`**

Append:

```css
.metric{margin:14px 0 4px}
.metric[hidden]{display:none}
.metric-label{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--yellow);font-weight:700;margin-bottom:4px}
#p-metric-text{font-size:13px;color:#c8d3df;line-height:1.5}
```

- [ ] **Step 4: Manual QA (DOM-driven)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm run serve`, open `http://localhost:3000`, unlock with `Dolly`. In the search box type the label of a node that has a metric (find one first: `node -e "const g=require('fs').readFileSync('./data.json','utf8');JSON.parse(g).nodes.filter(n=>n.metric).forEach(n=>console.log(n.label))"`), select it, and verify:
- [ ] The "How we measure success" label + metric text appear in the panel.
- [ ] Select a node WITHOUT a metric → the metric block is hidden (not an empty labeled box).
- [ ] No console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.mjs style.css
git commit -m "$(printf 'feat: show success metric in the side panel\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Program filter (bottom checkbox strip)

**Files:**
- Modify: `index.html` (add `#filterbar`)
- Modify: `style.css` (filter bar styling)
- Modify: `src/app.mjs` (import `computeNodePrograms`; build checkboxes; `applyFilter`)

**Interfaces:**
- Consumes: `computeNodePrograms(data)` from Task 1; the built `cy`.
- Produces: `applyFilter()` and a module-level `programFilter` state (`Set` of checked program names, incl. the `'Out of Scope'` sentinel). `applyFilter` is called by Task 6's focus-exit.

- [ ] **Step 1: Add the filter bar markup to `index.html`**

After the `#legend` block (after line 54), add:

```html
  <div id="filterbar">
    <span class="filter-title">PROGRAMS</span>
    <div id="filter-boxes"></div>
  </div>
```

- [ ] **Step 2: Style it in `style.css`**

Append:

```css
#filterbar{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9;display:flex;align-items:center;
  gap:12px;max-width:70vw;background:rgba(8,12,22,.78);border:1px solid var(--line);border-radius:12px;padding:9px 15px}
#filterbar .filter-title{font-size:10.5px;letter-spacing:.14em;color:var(--muted);font-weight:700}
#filter-boxes{display:flex;flex-wrap:wrap;gap:6px 14px}
#filter-boxes label{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#cdd7ee;cursor:pointer;white-space:nowrap}
#filter-boxes input{accent-color:var(--red);cursor:pointer}
```

- [ ] **Step 3: Wire the filter in `src/app.mjs`**

Add `computeNodePrograms` to the import on line 1:

```js
import { dataToElements, computeTrace, directNeighbors, findLoopEdges, computeNodePrograms } from './graph-model.mjs';
```

After the graph is built and `pinEnds(cy)` has run (after line 91, inside the try, before `cy.fit`), add:

```js
  const OUT_OF_SCOPE = 'Out of Scope';
  const nodePrograms = computeNodePrograms(data); // Map<id, Set<program>>
  const programList = [...new Set([...nodePrograms.values()].flatMap(s => [...s]))].sort();
  const hasOutOfScope = [...nodePrograms.values()].some(s => s.size === 0);
  const filterOptions = hasOutOfScope ? [...programList, OUT_OF_SCOPE] : programList;
  const programFilter = new Set(filterOptions); // all checked by default

  function nodeVisibleUnderFilter(id) {
    const set = nodePrograms.get(id) || new Set();
    if (set.size === 0) return programFilter.has(OUT_OF_SCOPE);
    for (const p of set) if (programFilter.has(p)) return true;
    return false;
  }
  function applyFilter() {
    cy.batch(() => {
      cy.nodes().forEach(n => n.style('display', nodeVisibleUnderFilter(n.id()) ? 'element' : 'none'));
      cy.edges().forEach(e => {
        const vis = nodeVisibleUnderFilter(e.source().id()) && nodeVisibleUnderFilter(e.target().id());
        e.style('display', vis ? 'element' : 'none');
      });
    });
    cy.fit(cy.elements(':visible'), 40);
  }

  // build checkboxes
  const boxes = document.getElementById('filter-boxes');
  for (const opt of filterOptions) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.value = opt;
    cb.addEventListener('change', () => {
      if (cb.checked) programFilter.add(opt); else programFilter.delete(opt);
      applyFilter();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(opt));
    boxes.appendChild(label);
  }
```

Expose `applyFilter` and `nodePrograms` to the module scope so Task 6 can call them — since everything is in one module, define the functions with `function`/`const` at a scope Task 6's code (appended later in the same file) can see. If they end up inside the `try` block and Task 6's focus code is outside it, hoist `applyFilter`, `nodePrograms`, `nodeVisibleUnderFilter`, `programFilter`, and `OUT_OF_SCOPE` to just above the `try` (declare with `let`, assign inside the try) so the focus code can reference them. Prefer this hoisting to avoid scope errors.

- [ ] **Step 4: Manual QA (DOM-driven)**

Run: `npm run serve`, unlock, and:
- [ ] The bottom bar shows a checkbox per program (6) plus "Out of Scope" if present, all checked.
- [ ] Unchecking a workstream visibly removes that chain (fewer nodes); re-checking restores. Unchecking all but one isolates that workstream.
- [ ] No console errors on toggle.
(Correctness of *which* nodes belong to each program is covered by the `computeNodePrograms` unit tests; this QA confirms the wiring runs and hides/re-fits.)

- [ ] **Step 5: Commit**

```bash
git add index.html style.css src/app.mjs
git commit -m "$(printf 'feat: program/workstream filter checkboxes with propagation\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Focus mode

**Files:**
- Modify: `index.html` (focus button in the panel)
- Modify: `style.css` (button styling)
- Modify: `src/app.mjs` (focus/unfocus; generalize `pinEnds`)

**Interfaces:**
- Consumes: `computeTrace`, `pinEnds`, `applyFilter` (Task 5), the current selection.
- Produces: `focusOn(id)` / `exitFocus()`; a `focused` flag. `pinEnds` is generalized to accept an optional node collection.

- [ ] **Step 1: Generalize `pinEnds` to a node subset (`src/app.mjs`)**

Change the `pinEnds` signature (line 34) and its internal node queries so it can operate on a subset. Replace the function with:

```js
function pinEnds(cy, nodes = cy.nodes()) {
  const xs = nodes.map(n => n.position('x'));
  const ys = nodes.map(n => n.position('y'));
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
  spread(nodes.filter('.activity'), leftX);
  spread(nodes.filter('.outcome'), rightX);
}
```

The existing call `pinEnds(cy)` (line 91) still works (defaults to all nodes).

- [ ] **Step 2: Add the focus button to `index.html`**

In `#panel`, right after the `#p-badge` span (line 39), add:

```html
    <button id="focus-btn" type="button">Focus</button>
```

- [ ] **Step 3: Style it in `style.css`**

Append:

```css
#focus-btn{margin:12px 0 4px;background:var(--red);color:#fff;border:none;border-radius:8px;
  padding:8px 14px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer;letter-spacing:.02em}
#focus-btn:hover{background:#f0392b}
```

- [ ] **Step 4: Implement focus/unfocus in `src/app.mjs`**

At the end of the file, append:

```js
// ---------- Focus mode (isolate the selected node's chain; ignores the program filter) ----------
let focused = false;
let focusedId = null;

function focusOn(id) {
  const { ancestors, descendants } = computeTrace(data, id);
  const chain = new Set([id, ...ancestors, ...descendants]);
  cy.batch(() => {
    cy.nodes().forEach(n => n.style('display', chain.has(n.id()) ? 'element' : 'none'));
    cy.edges().forEach(e => {
      const vis = chain.has(e.source().id()) && chain.has(e.target().id());
      e.style('display', vis ? 'element' : 'none');
    });
  });
  const visible = cy.nodes(':visible');
  visible.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 90, edgeSep: 10 }).run();
  pinEnds(cy, visible);
  cy.fit(cy.elements(':visible'), 40);
  focused = true; focusedId = id;
  document.getElementById('focus-btn').textContent = 'Exit focus';
}

function exitFocus() {
  focused = false; focusedId = null;
  cy.nodes().layout({ name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 90, edgeSep: 10 }).run();
  pinEnds(cy);
  applyFilter();            // restore the program filter's visibility
  cy.fit(cy.elements(':visible'), 40);
  document.getElementById('focus-btn').textContent = 'Focus';
}

document.getElementById('focus-btn').onclick = () => { if (focused) exitFocus(); else if (focusedId !== null || panelHasSelection()) focusOn(currentSelectionId()); };
```

That last wiring needs the current selection id. The simplest robust approach: track the selected id in a module variable. Add `let currentId = null;` near the top (above the `try`), set `currentId = id;` as the first line inside `selectNode` (after line 138's `function selectNode(id) {`), and have the button use it:

```js
document.getElementById('focus-btn').onclick = () => {
  if (focused) { exitFocus(); return; }
  if (currentId) focusOn(currentId);
};
```

(Remove the `panelHasSelection()`/`currentSelectionId()` placeholder — use `currentId`.) Finally, make selecting a node while focused re-focus: at the END of `selectNode` (after the `cy.animate` line 158), add:

```js
  if (focused) focusOn(id);
```

- [ ] **Step 5: Manual QA (DOM-driven)**

Run: `npm run serve`, unlock. Use the search box to select a middle node, then:
- [ ] The panel shows a "Focus" button. Click it → button reads "Exit focus"; the view isolates that node's chain (far fewer nodes, re-laid-out left→right). No console errors.
- [ ] Click a node in the panel's "Leads to" list while focused → it re-focuses on that node (button still "Exit focus"). No console errors.
- [ ] Click "Exit focus" → full graph returns, the current program-filter state is re-applied, button reads "Focus". No console errors.
- [ ] With a workstream unchecked, enter focus on a node whose chain includes filtered-out nodes → the whole chain shows (focus ignores the filter); exit → filter re-applies.

- [ ] **Step 6: Confirm the suite still passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test`
Expected: PASS (32 — focus mode adds no unit tests; it's browser wiring).

- [ ] **Step 7: Commit**

```bash
git add index.html style.css src/app.mjs
git commit -m "$(printf 'feat: focus mode to isolate a selected node chain\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Deploy to GitHub Pages

**Files:** none (deploy only; performed during finishing-a-development-branch).

- [ ] **Step 1: Final full-suite + tree check**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --test` (expect 32) then `git status --short` — confirm nothing under `brand/` or `.env` is staged.

- [ ] **Step 2: Merge to `master` and push** (this is the finishing step; `git push` triggers the Pages rebuild).

- [ ] **Step 3: Verify the live site** at `https://brentbarron-eng.github.io/theory-of-change-explorer/` (fresh tab): unlock with `Dolly`; confirm the program checkboxes appear and toggle, focus mode isolates/exits, a metric-bearing node shows its metric line, real data renders, no console errors.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- Data pipeline (Description/Metric/Program → data.json; orphan→warning; programs validation) → Tasks 1 (validation + propagation), 2 (extraction), 3 (regenerate).
- Side panel description + metric → Task 4 (description already wired from a prior cycle; metric added here).
- Program filter (propagation via `computeNodePrograms`, bottom checkboxes, "Out of Scope", OR semantics, hide + re-fit, all-checked default) → Tasks 1 + 5.
- Focus mode (isolate chain, re-layout, exit restores, ignores filter, re-focus from panel) → Task 6.
- Testing: TDD for `computeNodePrograms`, orphan-warning, programs-validation, and the transform extraction; DOM-driven manual QA for panel/filter/focus → embedded per task. Deploy verification → Task 7.

**Placeholder scan:** No TBD/vague steps; every code step has real code. The one deliberately-parameterized value — which node to search for in Task 4 QA — comes with the exact `node -e` command to discover it.

**Type consistency:** `computeNodePrograms(data) -> Map<id, Set<string>>` is defined in Task 1 and consumed in Task 5; the `'Out of Scope'` sentinel is introduced once (Task 5). `pinEnds` is generalized in Task 6 with a default arg so the Task-5-era `pinEnds(cy)` call still type-checks. `applyFilter`/`programFilter`/`nodePrograms` are defined in Task 5 and reused by Task 6's `exitFocus`; the plan explicitly calls for hoisting them above the `try` so Task 6's appended code can reference them. `currentId` is introduced in Task 6 and set at the top of `selectNode`. Node field names (`description`/`metric`/`programs`) match across the transform (Task 2), validator (Task 1), and panel (Task 4).

**Cross-task ordering note:** Tasks 1 and 2 must land before Task 3 (regeneration uses the new transform and the softened validator). Task 5 must land before Task 6 (focus's `exitFocus` calls `applyFilter`). The task order above respects this.
