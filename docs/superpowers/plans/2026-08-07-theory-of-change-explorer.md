# Theory of Change Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static-site interactive visualization that lets people explore the organization's theory of change — clicking any node to trace what contributes to it (upstream) and what it leads to (downstream).

**Architecture:** A dependency-free static site (HTML/CSS/ES modules) renders a directed graph with Cytoscape.js and a dagre layered layout. Graph data lives in a bundled `data.json`, regenerated on demand by a Node script that pulls from Notion. Pure logic (validation, graph traversal, Notion transform) lives in importable ES modules with unit tests; the browser wiring is verified with manual QA checklists.

**Tech Stack:** Cytoscape.js + cytoscape-dagre + dagre (vendored, no CDN, no bundler); native browser ES modules; Node.js with the built-in `node:test` runner; `@notionhq/client` for the data-refresh script.

## Global Constraints

- Node.js >= 20 (dev environment is v24.19). Copy verbatim into `package.json` `engines`.
- `"type": "module"` in `package.json`; all JS files use ESM `import`/`export`.
- Pinned library versions: `cytoscape@^3.30.0`, `dagre@^0.8.5`, `cytoscape-dagre@^2.5.0`, `@notionhq/client@^2.2.15`, `dotenv@^16.4.5`.
- Browser libraries are **vendored** into `vendor/` — the deployed site loads no CDN and no `node_modules`.
- Node types are exactly `activity`, `intermediate`, `outcome`. Edges are directed **cause → effect** (`source` = cause, `target` = effect).
- Edge id convention: `` `${source}__${target}` `` (double underscore).
- Tests use the built-in runner only: `node --test`. No test framework dependency.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- The site is served over HTTP in dev (ES modules + `fetch('./data.json')` do not work from `file://`). Use `npx serve .`.

---

## File Structure

```
package.json              scripts, deps, engines
index.html                page shell: #cy container, side panel, search, legend, controls
style.css                 DOM styling (panel, search, legend, layout) — NOT graph node styling
src/graph-model.mjs       PURE: validateGraph, dataToElements, adjacency, directNeighbors, computeTrace
src/app.mjs               browser: fetch data.json, build cytoscape, wire interaction/search/panel
scripts/notion-transform.mjs  PURE: notionToGraph(pages, config) -> {nodes, edges}
scripts/build-data.mjs    I/O: query Notion -> notionToGraph -> validateGraph -> write data.json
scripts/validate-data.mjs CLI: load data.json -> validateGraph -> exit nonzero if invalid
data.json                 the graph (hand-authored sample first, later regenerated from Notion)
vendor/                   cytoscape.min.js, dagre.min.js, cytoscape-dagre.js (copied from node_modules)
test/graph-model.test.mjs
test/notion-transform.test.mjs
test/fixtures/            sample graphs + a synthetic Notion response
.env.example              NOTION_TOKEN + NOTION_DATABASE_ID template
README.md                 run, refresh-data, deploy, QA checklist
```

---

### Task 1: Pure graph model + validation

Establishes the shared, testable core every other task depends on. No browser, no Notion — just data-in/data-out functions and their tests.

**Files:**
- Create: `package.json`
- Create: `src/graph-model.mjs`
- Create: `test/graph-model.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `NODE_TYPES: string[]` — `['activity','intermediate','outcome']`
  - `validateGraph(data) -> { ok: boolean, errors: string[] }`
  - `adjacency(data) -> { parents: Map<string,string[]>, children: Map<string,string[]> }`
  - `directNeighbors(data, id) -> { parents: string[], children: string[] }`
  - `computeTrace(data, id) -> { ancestors: Set<string>, descendants: Set<string> }`
  - `dataToElements(data) -> Array<{ data: object, classes?: string }>` (Cytoscape element format)
  - `data` shape everywhere: `{ nodes: [{id,label,type,description?}], edges: [{source,target}] }`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "theory-of-change-explorer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test",
    "validate": "node scripts/validate-data.mjs",
    "build-data": "node scripts/build-data.mjs",
    "vendor": "node scripts/vendor.mjs",
    "serve": "npx serve ."
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/graph-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_TYPES, validateGraph, adjacency, directNeighbors, computeTrace, dataToElements,
} from '../src/graph-model.mjs';

const good = {
  nodes: [
    { id: 'a', label: 'Activity', type: 'activity' },
    { id: 'm', label: 'Middle', type: 'intermediate' },
    { id: 'o', label: 'Outcome', type: 'outcome' },
  ],
  edges: [ { source: 'a', target: 'm' }, { source: 'm', target: 'o' } ],
};

test('NODE_TYPES are the three known types', () => {
  assert.deepEqual(NODE_TYPES, ['activity', 'intermediate', 'outcome']);
});

test('valid graph passes', () => {
  const r = validateGraph(good);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.errors, []);
});

test('missing nodes/edges arrays fail', () => {
  assert.equal(validateGraph({}).ok, false);
  assert.equal(validateGraph(null).ok, false);
});

test('duplicate id fails', () => {
  const r = validateGraph({ nodes: [{id:'a',label:'x',type:'activity'},{id:'a',label:'y',type:'outcome'}], edges: [{source:'a',target:'a'}] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('duplicate node id: a')));
});

test('invalid type fails', () => {
  const r = validateGraph({ nodes: [{id:'a',label:'x',type:'banana'}], edges: [] });
  assert.ok(r.errors.some(e => e.includes('invalid type')));
});

test('edge referencing missing node fails', () => {
  const r = validateGraph({ nodes:[{id:'a',label:'x',type:'activity'}], edges:[{source:'a',target:'ghost'}] });
  assert.ok(r.errors.some(e => e.includes('edge target not found: ghost')));
});

test('cycle fails', () => {
  const r = validateGraph({
    nodes:[{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'intermediate'}],
    edges:[{source:'a',target:'b'},{source:'b',target:'a'}],
  });
  assert.ok(r.errors.some(e => e.includes('cycle')));
});

test('orphan node fails', () => {
  const r = validateGraph({
    nodes:[{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'outcome'},{id:'lonely',label:'l',type:'intermediate'}],
    edges:[{source:'a',target:'b'}],
  });
  assert.ok(r.errors.some(e => e.includes('orphan node (no edges): lonely')));
});

test('adjacency builds parents and children', () => {
  const { parents, children } = adjacency(good);
  assert.deepEqual(children.get('a'), ['m']);
  assert.deepEqual(parents.get('o'), ['m']);
});

test('directNeighbors returns immediate parents/children', () => {
  assert.deepEqual(directNeighbors(good, 'm'), { parents: ['a'], children: ['o'] });
});

test('computeTrace walks full upstream and downstream', () => {
  const { ancestors, descendants } = computeTrace(good, 'm');
  assert.deepEqual([...ancestors].sort(), ['a']);
  assert.deepEqual([...descendants].sort(), ['o']);
});

test('computeTrace follows cross-linked chains transitively', () => {
  const g = {
    nodes: ['a','b','c','d'].map(id => ({id,label:id,type:'intermediate'})),
    edges: [{source:'a',target:'b'},{source:'b',target:'c'},{source:'c',target:'d'}],
  };
  const { ancestors, descendants } = computeTrace(g, 'c');
  assert.deepEqual([...ancestors].sort(), ['a','b']);
  assert.deepEqual([...descendants].sort(), ['d']);
});

test('dataToElements emits nodes with type class and edges with __ id', () => {
  const els = dataToElements(good);
  const aNode = els.find(e => e.data.id === 'a');
  assert.equal(aNode.classes, 'activity');
  assert.ok(els.some(e => e.data.id === 'a__m' && e.data.source === 'a' && e.data.target === 'm'));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/graph-model.test.mjs`
Expected: FAIL — cannot find module `../src/graph-model.mjs`.

- [ ] **Step 4: Implement `src/graph-model.mjs`**

```js
export const NODE_TYPES = ['activity', 'intermediate', 'outcome'];

export function validateGraph(data) {
  const errors = [];
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return { ok: false, errors: ['data must have `nodes` and `edges` arrays'] };
  }
  const ids = new Set();
  for (const n of data.nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') { errors.push(`node missing string id: ${JSON.stringify(n)}`); continue; }
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (typeof n.label !== 'string' || n.label === '') errors.push(`node ${n.id} missing label`);
    if (!NODE_TYPES.includes(n.type)) errors.push(`node ${n.id} has invalid type: ${n.type}`);
  }
  const connected = new Set();
  for (const e of data.edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') { errors.push(`edge missing source/target: ${JSON.stringify(e)}`); continue; }
    if (!ids.has(e.source)) errors.push(`edge source not found: ${e.source}`);
    if (!ids.has(e.target)) errors.push(`edge target not found: ${e.target}`);
    if (e.source === e.target) errors.push(`self-loop on ${e.source}`);
    connected.add(e.source); connected.add(e.target);
  }
  for (const id of ids) if (!connected.has(id)) errors.push(`orphan node (no edges): ${id}`);
  const cycle = findCycle(data);
  if (cycle) errors.push(`cycle detected: ${cycle.join(' -> ')}`);
  return { ok: errors.length === 0, errors };
}

function findCycle(data) {
  const children = new Map();
  for (const n of data.nodes) children.set(n.id, []);
  for (const e of data.edges) if (children.has(e.source) && children.has(e.target)) children.get(e.source).push(e.target);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...children.keys()].map(k => [k, WHITE]));
  const stack = [];
  let found = null;
  const dfs = (u) => {
    color.set(u, GRAY); stack.push(u);
    for (const v of children.get(u)) {
      if (color.get(v) === GRAY) { found = stack.slice(stack.indexOf(v)).concat(v); return true; }
      if (color.get(v) === WHITE && dfs(v)) return true;
    }
    stack.pop(); color.set(u, BLACK); return false;
  };
  for (const id of children.keys()) if (color.get(id) === WHITE && dfs(id)) return found;
  return null;
}

export function adjacency(data) {
  const parents = new Map(), children = new Map();
  for (const n of data.nodes) { parents.set(n.id, []); children.set(n.id, []); }
  for (const e of data.edges) {
    if (children.has(e.source)) children.get(e.source).push(e.target);
    if (parents.has(e.target)) parents.get(e.target).push(e.source);
  }
  return { parents, children };
}

export function directNeighbors(data, id) {
  const { parents, children } = adjacency(data);
  return { parents: parents.get(id) || [], children: children.get(id) || [] };
}

export function computeTrace(data, id) {
  const { parents, children } = adjacency(data);
  const walk = (map) => {
    const seen = new Set();
    const q = [...(map.get(id) || [])];
    while (q.length) {
      const x = q.shift();
      if (seen.has(x)) continue;
      seen.add(x);
      for (const y of (map.get(x) || [])) q.push(y);
    }
    return seen;
  };
  return { ancestors: walk(parents), descendants: walk(children) };
}

export function dataToElements(data) {
  const els = [];
  for (const n of data.nodes) els.push({ data: { id: n.id, label: n.label, type: n.type, description: n.description || '' }, classes: n.type });
  for (const e of data.edges) els.push({ data: { id: `${e.source}__${e.target}`, source: e.source, target: e.target } });
  return els;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/graph-model.test.mjs`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json src/graph-model.mjs test/graph-model.test.mjs
git commit -m "$(printf 'feat: pure graph model with validation and traversal\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Validation CLI + sample data.json

Gives us a runnable `data.json` (so the app can render before the Notion pipeline exists) and a CLI that fails loudly on bad data.

**Files:**
- Create: `data.json`
- Create: `scripts/validate-data.mjs`
- Create: `test/fixtures/invalid-graph.json`
- Modify: `test/graph-model.test.mjs` (add one CLI-behavior test that loads the shipped `data.json`)

**Interfaces:**
- Consumes: `validateGraph` from `src/graph-model.mjs`.
- Produces: `data.json` conforming to the data shape; `npm run validate` exits `0` on valid, `1` on invalid.

- [ ] **Step 1: Create the sample `data.json`**

This is representative placeholder content (an activities → intermediates → outcomes DAG with cross-links), replaced later by the Notion export. Create `data.json`:

```json
{
  "nodes": [
    { "id": "A1", "label": "Fund interdisciplinary research networks", "type": "activity" },
    { "id": "A2", "label": "Convene global experts", "type": "activity" },
    { "id": "A3", "label": "Support early-career researchers", "type": "activity" },
    { "id": "I1", "label": "New cross-disciplinary collaborations form", "type": "intermediate" },
    { "id": "I2", "label": "Researchers exchange knowledge", "type": "intermediate" },
    { "id": "I3", "label": "Early-career researchers gain mentorship", "type": "intermediate" },
    { "id": "I4", "label": "Novel research questions pursued", "type": "intermediate" },
    { "id": "I5", "label": "Research capacity strengthened", "type": "intermediate" },
    { "id": "I6", "label": "Diverse talent retained in Canada", "type": "intermediate" },
    { "id": "I7", "label": "High-impact discoveries published", "type": "intermediate" },
    { "id": "I8", "label": "Cross-sector partnerships built", "type": "intermediate" },
    { "id": "I9", "label": "Skilled workforce grows", "type": "intermediate" },
    { "id": "I10", "label": "Knowledge mobilized to decision-makers", "type": "intermediate" },
    { "id": "I11", "label": "New technologies & methods adopted", "type": "intermediate" },
    { "id": "I12", "label": "Talent drives innovation in industry", "type": "intermediate" },
    { "id": "I13", "label": "Evidence informs public policy", "type": "intermediate" },
    { "id": "I14", "label": "Companies & institutions innovate", "type": "intermediate" },
    { "id": "O1", "label": "Evidence-informed policy & practice", "type": "outcome" },
    { "id": "O2", "label": "Social & economic benefits to Canadians", "type": "outcome" }
  ],
  "edges": [
    { "source": "A1", "target": "I1" }, { "source": "A2", "target": "I1" },
    { "source": "A2", "target": "I2" }, { "source": "A3", "target": "I2" },
    { "source": "A3", "target": "I3" }, { "source": "I1", "target": "I4" },
    { "source": "I2", "target": "I5" }, { "source": "I3", "target": "I5" },
    { "source": "I3", "target": "I6" }, { "source": "I4", "target": "I7" },
    { "source": "I4", "target": "I8" }, { "source": "I5", "target": "I7" },
    { "source": "I5", "target": "I9" }, { "source": "I6", "target": "I9" },
    { "source": "I7", "target": "I10" }, { "source": "I8", "target": "I10" },
    { "source": "I7", "target": "I11" }, { "source": "I9", "target": "I12" },
    { "source": "I10", "target": "I13" }, { "source": "I11", "target": "I14" },
    { "source": "I12", "target": "I14" }, { "source": "I13", "target": "O1" },
    { "source": "I13", "target": "O2" }, { "source": "I14", "target": "O2" }
  ]
}
```

- [ ] **Step 2: Create an invalid fixture**

Create `test/fixtures/invalid-graph.json`:

```json
{ "nodes": [ { "id": "a", "label": "A", "type": "activity" } ], "edges": [ { "source": "a", "target": "missing" } ] }
```

- [ ] **Step 3: Write the failing test for the shipped data + CLI logic**

Append to `test/graph-model.test.mjs`:

```js
import { readFileSync } from 'node:fs';

test('shipped data.json is a valid graph', () => {
  const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
  const r = validateGraph(data);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('invalid fixture is rejected', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/invalid-graph.json', import.meta.url), 'utf8'));
  const r = validateGraph(data);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 4: Run tests to verify the new ones behave**

Run: `node --test test/graph-model.test.mjs`
Expected: PASS (the sample `data.json` from Step 1 is valid; the fixture is rejected). If "shipped data.json is a valid graph" fails, fix `data.json` until valid — do not weaken the test.

- [ ] **Step 5: Implement the CLI `scripts/validate-data.mjs`**

```js
import { readFileSync } from 'node:fs';
import { validateGraph } from '../src/graph-model.mjs';

const path = new URL('../data.json', import.meta.url);
let data;
try {
  data = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`Could not read/parse data.json: ${err.message}`);
  process.exit(1);
}
const { ok, errors } = validateGraph(data);
if (!ok) {
  console.error('data.json INVALID:\n' + errors.map(e => ' - ' + e).join('\n'));
  process.exit(1);
}
console.log(`data.json valid: ${data.nodes.length} nodes, ${data.edges.length} edges`);
```

- [ ] **Step 6: Run the CLI both ways to verify exit codes**

Run: `npm run validate`
Expected: prints "data.json valid: 19 nodes, 24 edges", exit code 0.

Run: `node -e "import('./src/graph-model.mjs').then(m=>{const d=require('fs').readFileSync('./test/fixtures/invalid-graph.json','utf8');process.exit(m.validateGraph(JSON.parse(d)).ok?0:1)})"` — or simply trust the unit test above.
Expected: the unit test already proves the invalid fixture is rejected; no action needed if it passed.

- [ ] **Step 7: Commit**

```bash
git add data.json scripts/validate-data.mjs test/fixtures/invalid-graph.json test/graph-model.test.mjs
git commit -m "$(printf 'feat: sample data.json and validation CLI\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Static page + Cytoscape overview render

Renders the graph left-to-right with type colors and the "overview" label discipline (labels only on activities + outcomes). No selection behavior yet.

**Files:**
- Create: `scripts/vendor.mjs`
- Create: `index.html`
- Create: `style.css`
- Create: `src/app.mjs`
- Create: `vendor/` (populated by the vendor script)
- Modify: `package.json` (add devDependencies)

**Interfaces:**
- Consumes: `dataToElements` from `src/graph-model.mjs`; global `window.cytoscape`, `window.cytoscapeDagre` from vendored scripts.
- Produces: a running page; `window.__cy` (the Cytoscape instance) exposed for manual QA and Task 4.

- [ ] **Step 1: Add devDependencies and install**

Edit `package.json` to add:

```json
"devDependencies": {
  "cytoscape": "^3.30.0",
  "dagre": "^0.8.5",
  "cytoscape-dagre": "^2.5.0",
  "@notionhq/client": "^2.2.15",
  "dotenv": "^16.4.5"
}
```

Run: `npm install`
Expected: `node_modules/` created (already gitignored).

- [ ] **Step 2: Create the vendor-copy script `scripts/vendor.mjs`**

```js
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('../vendor/', import.meta.url), { recursive: true });
const copies = [
  ['../node_modules/cytoscape/dist/cytoscape.min.js', '../vendor/cytoscape.min.js'],
  ['../node_modules/dagre/dist/dagre.min.js', '../vendor/dagre.min.js'],
  ['../node_modules/cytoscape-dagre/cytoscape-dagre.js', '../vendor/cytoscape-dagre.js'],
];
for (const [from, to] of copies) {
  copyFileSync(new URL(from, import.meta.url), new URL(to, import.meta.url));
  console.log(`vendored ${to.split('/').pop()}`);
}
```

Run: `npm run vendor`
Expected: three files appear in `vendor/`. If a source path 404s, run `ls node_modules/cytoscape-dagre` etc. and correct the path to the shipped UMD build.

- [ ] **Step 3: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Theory of Change Explorer</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header id="topbar">
    <h1>Theory of Change</h1>
    <input id="search" list="node-list" placeholder="Search for a node…" autocomplete="off">
    <datalist id="node-list"></datalist>
    <button id="reset" type="button">Reset view</button>
  </header>

  <div id="cy"></div>

  <aside id="panel" hidden>
    <button id="panel-close" type="button" aria-label="Close">&times;</button>
    <h2 id="p-name"></h2>
    <span id="p-badge" class="badge"></span>
    <p id="p-desc" class="desc"></p>
    <h3 class="sec">Contributed to by</h3>
    <div id="p-parents"></div>
    <h3 class="sec">Leads to</h3>
    <div id="p-children"></div>
  </aside>

  <div id="legend">
    <div><span class="dot activity"></span> Activity</div>
    <div><span class="dot intermediate"></span> Intermediate effect</div>
    <div><span class="dot outcome"></span> Ultimate outcome</div>
  </div>

  <script src="vendor/cytoscape.min.js"></script>
  <script src="vendor/dagre.min.js"></script>
  <script src="vendor/cytoscape-dagre.js"></script>
  <script type="module" src="src/app.mjs"></script>
</body>
</html>
```

- [ ] **Step 4: Create `style.css`**

```css
:root { --bg:#0e1116; --panel:#141a22; --border:#2b3644; --text:#e6edf3; --muted:#7d8ea3;
  --activity:#4ade80; --intermediate:#60a5fa; --outcome:#c084fc; --up:#2dd4bf; --down:#fbbf24; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text);
  font-family:-apple-system,Segoe UI,Roboto,sans-serif; }
#topbar { position:fixed; top:0; left:0; right:0; height:56px; display:flex; align-items:center;
  gap:14px; padding:0 16px; background:rgba(14,17,22,.9); border-bottom:1px solid var(--border); z-index:10; }
#topbar h1 { font-size:15px; margin:0; font-weight:600; }
#search { flex:0 1 320px; background:#1c2430; border:1px solid var(--border); color:var(--text);
  padding:8px 12px; border-radius:8px; font-size:13px; }
#reset { margin-left:auto; background:#1c2430; border:1px solid var(--border); color:#cbd5e1;
  padding:8px 12px; border-radius:8px; font-size:13px; cursor:pointer; }
#reset:hover { background:#243044; }
#cy { position:fixed; top:56px; left:0; right:0; bottom:0; }
#legend { position:fixed; left:14px; bottom:14px; background:rgba(20,26,34,.75); border:1px solid var(--border);
  border-radius:10px; padding:10px 12px; font-size:12px; z-index:10; }
#legend div { display:flex; align-items:center; gap:8px; margin:3px 0; }
.dot { width:11px; height:11px; border-radius:50%; display:inline-block; }
.dot.activity { background:var(--activity); }
.dot.intermediate { background:var(--intermediate); }
.dot.outcome { background:var(--outcome); }
#panel { position:fixed; top:56px; right:0; bottom:0; width:320px; background:var(--panel);
  border-left:1px solid var(--border); padding:22px; overflow-y:auto; z-index:10; }
#panel[hidden] { display:none; }
#panel-close { position:absolute; top:14px; right:16px; background:none; border:none; color:var(--muted);
  font-size:22px; cursor:pointer; }
#p-name { font-size:17px; margin:0 24px 8px 0; }
.badge { display:inline-block; font-size:11px; padding:3px 9px; border-radius:20px; font-weight:600; }
.desc { color:#c8d3df; font-size:13px; line-height:1.5; }
.sec { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:18px 0 6px; }
.lnk { display:block; padding:8px 10px; margin:5px 0; background:#1a222e; border:1px solid #29323f;
  border-radius:7px; font-size:13px; cursor:pointer; line-height:1.35; }
.lnk:hover { background:#243044; }
.lnk.up { border-left:3px solid var(--up); }
.lnk.down { border-left:3px solid var(--down); }
.none { font-size:12px; color:var(--muted); font-style:italic; }
```

- [ ] **Step 5: Create `src/app.mjs` (overview render only)**

```js
import { dataToElements } from './graph-model.mjs';

const cytoscape = window.cytoscape;
try { cytoscape.use(window.cytoscapeDagre); } catch { /* already registered */ }

const C = { activity: '#4ade80', intermediate: '#60a5fa', outcome: '#c084fc', up: '#2dd4bf', down: '#fbbf24' };

const STYLE = [
  { selector: 'node', style: {
      'background-color': C.intermediate, 'label': 'data(label)', 'color': '#e6edf3',
      'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 130, 'text-valign': 'top',
      'text-margin-y': -4, 'text-opacity': 0, 'width': 18, 'height': 18, 'border-width': 0 } },
  { selector: 'node.activity', style: { 'background-color': C.activity } },
  { selector: 'node.intermediate', style: { 'background-color': C.intermediate } },
  { selector: 'node.outcome', style: { 'background-color': C.outcome, 'width': 26, 'height': 26 } },
  { selector: 'node.anchor', style: { 'text-opacity': 1 } },
  { selector: 'edge', style: {
      'width': 1, 'line-color': '#7d8ea3', 'opacity': 0.18, 'curve-style': 'bezier',
      'target-arrow-shape': 'triangle', 'target-arrow-color': '#7d8ea3', 'arrow-scale': 0.7 } },
  // selection states (used in Task 4)
  { selector: '.dim', style: { 'opacity': 0.10, 'text-opacity': 0 } },
  { selector: 'node.lit-sel', style: { 'text-opacity': 1, 'border-width': 3, 'border-color': '#fff', 'opacity': 1 } },
  { selector: 'node.lit-up', style: { 'text-opacity': 1, 'border-width': 2.5, 'border-color': C.up, 'opacity': 1 } },
  { selector: 'node.lit-down', style: { 'text-opacity': 1, 'border-width': 2.5, 'border-color': C.down, 'opacity': 1 } },
  { selector: 'edge.e-up', style: { 'line-color': C.up, 'target-arrow-color': C.up, 'opacity': 0.9, 'width': 2 } },
  { selector: 'edge.e-down', style: { 'line-color': C.down, 'target-arrow-color': C.down, 'opacity': 0.9, 'width': 2 } },
];

const res = await fetch('./data.json');
const data = await res.json();

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: dataToElements(data),
  style: STYLE,
  layout: { name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 90, edgeSep: 10 },
  wheelSensitivity: 0.2,
});
cy.nodes('.activity, .outcome').addClass('anchor');
cy.fit(undefined, 40);

window.__cy = cy;      // for manual QA + Task 4
window.__data = data;
```

- [ ] **Step 6: Manual QA**

Run: `npm run serve` then open the printed `http://localhost:3000`.
Verify ALL of:
- [ ] Graph renders left→right: green activity nodes on the left, purple outcome nodes on the right, blue intermediates between.
- [ ] Only activity and outcome nodes show labels; intermediates are unlabeled dots.
- [ ] Ultimate-outcome nodes are visibly larger than the rest.
- [ ] Edges have arrowheads pointing cause→effect (left→right).
- [ ] Pan (drag) and zoom (scroll) work; "Reset view" is present (wired in Task 4).
- [ ] Browser console shows no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json index.html style.css src/app.mjs scripts/vendor.mjs vendor/
git commit -m "$(printf 'feat: static page rendering the graph overview with cytoscape+dagre\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Selection, trace highlighting, side panel, search

Adds the core interaction: click a node → dim the rest, light upstream teal and downstream amber, reveal labels along the path, and populate the panel. Plus search-to-jump and reset.

**Files:**
- Modify: `src/app.mjs`

**Interfaces:**
- Consumes: `computeTrace`, `directNeighbors` from `src/graph-model.mjs`; the `cy` instance and `data` from Task 3.
- Produces: `selectNode(id)` and `clearSelection()` behaviors, exposed as `window.__select` for QA.

- [ ] **Step 1: Add imports and selection logic to `src/app.mjs`**

Change the import line at the top to:

```js
import { dataToElements, computeTrace, directNeighbors } from './graph-model.mjs';
```

Append below the `window.__data = data;` line:

```js
// ---------- Panel ----------
const TYPE_NAME = { activity: 'Activity', intermediate: 'Intermediate effect', outcome: 'Ultimate outcome' };
const byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
const panel = document.getElementById('panel');

function makeLink(id, dir) {
  const el = document.createElement('div');
  el.className = 'lnk ' + dir;
  el.textContent = byId[id].label;
  el.onclick = () => selectNode(id);
  return el;
}

function renderPanel(id) {
  const n = byId[id];
  document.getElementById('p-name').textContent = n.label;
  const badge = document.getElementById('p-badge');
  badge.textContent = TYPE_NAME[n.type];
  badge.style.background = C[n.type] + '33';
  badge.style.color = C[n.type];
  const desc = document.getElementById('p-desc');
  desc.textContent = n.description || '';
  desc.hidden = !n.description;
  const { parents, children } = directNeighbors(data, id);
  const pp = document.getElementById('p-parents');
  const pc = document.getElementById('p-children');
  pp.replaceChildren();
  pc.replaceChildren();
  if (!parents.length) pp.innerHTML = '<div class="none">Starting activity — nothing upstream.</div>';
  parents.forEach(pid => pp.appendChild(makeLink(pid, 'up')));
  if (!children.length) pc.innerHTML = '<div class="none">Ultimate outcome — nothing downstream.</div>';
  children.forEach(cid => pc.appendChild(makeLink(cid, 'down')));
  panel.hidden = false;
}

// ---------- Selection ----------
function selectNode(id) {
  const { ancestors, descendants } = computeTrace(data, id);
  const up = new Set([id, ...ancestors]);
  const down = new Set([id, ...descendants]);
  cy.batch(() => {
    cy.elements().addClass('dim').removeClass('lit-sel lit-up lit-down e-up e-down');
    cy.nodes().forEach(n => {
      const nid = n.id();
      if (nid === id) n.removeClass('dim').addClass('lit-sel');
      else if (ancestors.has(nid)) n.removeClass('dim').addClass('lit-up');
      else if (descendants.has(nid)) n.removeClass('dim').addClass('lit-down');
    });
    cy.edges().forEach(e => {
      const s = e.source().id(), t = e.target().id();
      if (up.has(s) && up.has(t)) e.removeClass('dim').addClass('e-up');
      else if (down.has(s) && down.has(t)) e.removeClass('dim').addClass('e-down');
    });
  });
  renderPanel(id);
  const node = cy.getElementById(id);
  cy.animate({ center: { eles: node } }, { duration: 250 });
}

function clearSelection() {
  cy.elements().removeClass('dim lit-sel lit-up lit-down e-up e-down');
  panel.hidden = true;
}

cy.on('tap', 'node', (e) => selectNode(e.target.id()));
cy.on('tap', (e) => { if (e.target === cy) clearSelection(); });
document.getElementById('panel-close').onclick = clearSelection;
document.getElementById('reset').onclick = () => { clearSelection(); cy.animate({ fit: { padding: 40 } }, { duration: 250 }); };

// ---------- Search ----------
const list = document.getElementById('node-list');
data.nodes.slice().sort((a, b) => a.label.localeCompare(b.label)).forEach(n => {
  const opt = document.createElement('option');
  opt.value = n.label;
  list.appendChild(opt);
});
const labelToId = Object.fromEntries(data.nodes.map(n => [n.label, n.id]));
const search = document.getElementById('search');
function trySearch() {
  const id = labelToId[search.value];
  if (id) { selectNode(id); search.blur(); }
}
search.addEventListener('change', trySearch);
search.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySearch(); });

window.__select = selectNode;
```

- [ ] **Step 2: Manual QA**

Run: `npm run serve` and reload `http://localhost:3000`.
Verify ALL of:
- [ ] Clicking "Skilled workforce grows" (or any intermediate) dims everything else, lights its upstream chain teal back to the activities, its downstream chain amber forward to the outcomes, and reveals labels only along that path.
- [ ] The side panel opens showing the node name, a colored type badge, a "Contributed to by" list (direct parents) and a "Leads to" list (direct children).
- [ ] Clicking an entry in either list re-selects that node and re-traces.
- [ ] Selecting an activity shows "Starting activity — nothing upstream."; selecting an ultimate outcome shows "Ultimate outcome — nothing downstream."
- [ ] Typing in the search box offers autocomplete of node names; picking one selects and centers that node.
- [ ] Clicking empty canvas, the panel-close button, and "Reset view" all return to the clean overview.
- [ ] Console shows no errors.

- [ ] **Step 3: Verify pure logic still passes**

Run: `node --test`
Expected: PASS (Task 1/2 tests unaffected — `computeTrace`/`directNeighbors` are exercised by the same tests).

- [ ] **Step 4: Commit**

```bash
git add src/app.mjs
git commit -m "$(printf 'feat: node selection, upstream/downstream tracing, side panel, search\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: Notion → data.json pipeline

Replaces the hand-authored `data.json` with a repeatable export from the real Notion database. The transform is a pure, tested function; the I/O wrapper handles Notion paging and writes the file.

**Files:**
- Create: `scripts/notion-transform.mjs`
- Create: `scripts/build-data.mjs`
- Create: `.env.example`
- Create: `test/fixtures/notion-pages.json`
- Create: `test/notion-transform.test.mjs`

**Interfaces:**
- Consumes: `validateGraph` from `src/graph-model.mjs`; `@notionhq/client`; `dotenv`.
- Produces:
  - `DEFAULT_CONFIG` object (property-name mapping).
  - `notionToGraph(pages, config?) -> { nodes: [{id,label,type}], edges: [{source,target}] }`
  - `npm run build-data` writes a validated `data.json`.

- [ ] **Step 1: Confirm the real Notion schema BEFORE coding the config**

The exact property names and the mechanism marking activity/outcome must be confirmed against the real database — do not assume. Retrieve the schema:

```bash
node -e "import('dotenv/config').then(async()=>{const {Client}=await import('@notionhq/client');const n=new Client({auth:process.env.NOTION_TOKEN});const db=await n.databases.retrieve({database_id:process.env.NOTION_DATABASE_ID});console.log(JSON.stringify(Object.fromEntries(Object.entries(db.properties).map(([k,v])=>[k,v.type])),null,2));})"
```

Record: the title property name, the property that marks type (and whether it is a `select`, `status`, or `checkbox`, plus the exact activity/outcome value labels), and the exact **How** and **Why** relation property names. Fill these into `DEFAULT_CONFIG` in Step 3. If type is marked by two checkboxes rather than one select, adjust `typeOf` in Step 3 accordingly (a version handling checkboxes is given inline there).

- [ ] **Step 2: Create the synthetic Notion fixture**

This mirrors the Notion API page shape. Create `test/fixtures/notion-pages.json`:

```json
[
  { "id": "p-act", "properties": {
    "Name": { "title": [ { "plain_text": "Fund networks" } ] },
    "Type": { "select": { "name": "Activity" } },
    "How":  { "relation": [] },
    "Why":  { "relation": [ { "id": "p-mid" } ] } } },
  { "id": "p-mid", "properties": {
    "Name": { "title": [ { "plain_text": "Collaborations form" } ] },
    "Type": { "select": null },
    "How":  { "relation": [ { "id": "p-act" } ] },
    "Why":  { "relation": [ { "id": "p-out" } ] } } },
  { "id": "p-out", "properties": {
    "Name": { "title": [ { "plain_text": "Benefits to Canadians" } ] },
    "Type": { "select": { "name": "Ultimate outcome" } },
    "How":  { "relation": [ { "id": "p-mid" }, { "id": "p-ghost" } ] },
    "Why":  { "relation": [] } } }
]
```

(`p-ghost` is intentionally a relation to a page NOT in the set — the transform must drop that dangling edge.)

- [ ] **Step 3: Write the failing test**

Create `test/notion-transform.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notionToGraph } from '../scripts/notion-transform.mjs';
import { validateGraph } from '../src/graph-model.mjs';

const pages = JSON.parse(readFileSync(new URL('./fixtures/notion-pages.json', import.meta.url), 'utf8'));

test('maps titles and types', () => {
  const { nodes } = notionToGraph(pages);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  assert.equal(byId['p-act'].label, 'Fund networks');
  assert.equal(byId['p-act'].type, 'activity');
  assert.equal(byId['p-mid'].type, 'intermediate');
  assert.equal(byId['p-out'].type, 'outcome');
});

test('builds cause->effect edges from How and Why, deduped', () => {
  const { edges } = notionToGraph(pages);
  const keys = edges.map(e => `${e.source}__${e.target}`).sort();
  // Why: act->mid, mid->out ; How: mid->act? no — How on mid points to act meaning act->mid (dup), out<-mid means mid->out (dup)
  assert.deepEqual(keys, ['p-act__p-mid', 'p-mid__p-out']);
});

test('drops edges referencing pages outside the set', () => {
  const { edges } = notionToGraph(pages);
  assert.ok(!edges.some(e => e.source === 'p-ghost' || e.target === 'p-ghost'));
});

test('output validates as a graph', () => {
  const r = validateGraph(notionToGraph(pages));
  assert.equal(r.ok, true, r.errors.join('; '));
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/notion-transform.test.mjs`
Expected: FAIL — cannot find module `../scripts/notion-transform.mjs`.

- [ ] **Step 5: Implement `scripts/notion-transform.mjs`**

Use the property names confirmed in Step 1. Defaults below assume a single `Type` select and relations named `How`/`Why`:

```js
export const DEFAULT_CONFIG = {
  titleProp: 'Name',
  typeProp: 'Type',
  activityValue: 'Activity',
  outcomeValue: 'Ultimate outcome',
  upstreamRelation: 'How',    // points to causes of this node
  downstreamRelation: 'Why',  // points to effects of this node
};

export function notionToGraph(pages, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ids = new Set(pages.map(p => p.id));
  const nodes = pages.map(p => ({
    id: p.id,
    label: plainTitle(p, cfg.titleProp),
    type: typeOf(p, cfg),
  }));
  const seen = new Set();
  const edges = [];
  const add = (s, t) => {
    if (s === t || !ids.has(s) || !ids.has(t)) return;
    const k = `${s}__${t}`;
    if (!seen.has(k)) { seen.add(k); edges.push({ source: s, target: t }); }
  };
  for (const p of pages) {
    for (const r of relIds(p, cfg.downstreamRelation)) add(p.id, r); // p leads to r
    for (const r of relIds(p, cfg.upstreamRelation)) add(r, p.id);   // r leads to p
  }
  return { nodes, edges };
}

function plainTitle(p, prop) {
  const t = p.properties?.[prop]?.title || [];
  return t.map(x => x.plain_text).join('').trim();
}

function typeOf(p, cfg) {
  // Single-select version (default). If the real DB uses two checkboxes named
  // e.g. "Activity" and "Ultimate outcome", replace the body with:
  //   if (p.properties?.['Activity']?.checkbox) return 'activity';
  //   if (p.properties?.['Ultimate outcome']?.checkbox) return 'outcome';
  //   return 'intermediate';
  const v = p.properties?.[cfg.typeProp]?.select?.name;
  if (v === cfg.activityValue) return 'activity';
  if (v === cfg.outcomeValue) return 'outcome';
  return 'intermediate';
}

function relIds(p, prop) {
  return (p.properties?.[prop]?.relation || []).map(r => r.id);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/notion-transform.test.mjs`
Expected: PASS — all four tests green.

- [ ] **Step 7: Create `.env.example`**

```
# Notion integration token (https://www.notion.so/my-integrations) — share the DB with the integration
NOTION_TOKEN=secret_xxx
# The theory-of-change database id (from the DB URL)
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 8: Implement `scripts/build-data.mjs`**

```js
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { Client } from '@notionhq/client';
import { notionToGraph } from './notion-transform.mjs';
import { validateGraph } from '../src/graph-model.mjs';

const token = process.env.NOTION_TOKEN;
const dbId = process.env.NOTION_DATABASE_ID;
if (!token || !dbId) {
  console.error('Set NOTION_TOKEN and NOTION_DATABASE_ID in .env (see .env.example).');
  process.exit(1);
}

const notion = new Client({ auth: token });
const pages = [];
let cursor;
do {
  const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor });
  pages.push(...res.results);
  cursor = res.has_more ? res.next_cursor : undefined;
} while (cursor);

const graph = notionToGraph(pages);
const { ok, errors } = validateGraph(graph);
if (!ok) {
  console.error('Generated graph is INVALID — not writing data.json:\n' + errors.map(e => ' - ' + e).join('\n'));
  process.exit(1);
}
writeFileSync(new URL('../data.json', import.meta.url), JSON.stringify(graph, null, 2) + '\n');
console.log(`Wrote data.json: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
```

- [ ] **Step 9: Run against the real database and sanity-check**

Copy `.env.example` to `.env`, fill in real values, then:

Run: `npm run build-data`
Expected: prints node/edge counts and rewrites `data.json`. Then:

Run: `npm run validate`
Expected: "data.json valid".

Run: `npm run serve` and reload — verify the real graph renders, activities/outcomes are correctly typed, and a spot-checked chain traces sensibly (this is where the How/Why direction assumption is confirmed against reality; if directions look reversed, swap `upstreamRelation`/`downstreamRelation` in `DEFAULT_CONFIG` and re-run).

- [ ] **Step 10: Commit**

```bash
git add scripts/notion-transform.mjs scripts/build-data.mjs .env.example test/fixtures/notion-pages.json test/notion-transform.test.mjs data.json
git commit -m "$(printf 'feat: notion export pipeline generating data.json\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: README + deployment

Documents how to run, refresh data, and deploy, and consolidates the manual QA checklist. Self-contained docs deliverable.

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above (npm scripts, env vars).
- Produces: nothing code depends on.

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Verify the documented commands actually work**

Run each documented command once (`npm install`, `npm run vendor`, `npm test`, `npm run serve`) and confirm the README matches reality. Fix any drift in the README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(printf 'docs: readme with run, data-refresh, deploy, and QA checklist\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- Static site, no backend → Tasks 3/6 (vendored libs, static root, static-host deploy).
- Data model (`nodes`/`edges`, cause→effect, optional description) → Task 1 (`dataToElements`, validation), Task 4 (description in panel).
- Notion → data.json pipeline, How/Why → edges, type from markers, direction to confirm → Task 5 (schema-confirm step, both-relations edge build, direction-swap note).
- dagre left→right, color by type, outcomes emphasized, directed curved edges → Task 3 STYLE + layout.
- Interaction: overview label discipline, hover, click trace (teal up / amber down), search, background reset → Tasks 3 (overview labels) and 4 (trace/search/reset). Note: hover-to-reveal-label was specified; it is folded into the always-on anchor labels + selection labels. If per-node hover labels are still wanted, that is a small additive tweak, not a structural gap.
- Side panel: name, type badge, description, clickable parents/children → Task 4.
- Testing: data validation automated + manual app QA → Tasks 1/2 (automated) and Tasks 3/4/6 (checklists).
- Out of scope (focus mode etc.) → not implemented, by design; focus mode's traversal dependency (`computeTrace`) already exists for the future fast-follow.

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders. The one genuinely deferred unknown — exact Notion property names — is handled by an explicit schema-introspection step (Task 5, Step 1) before the config is written, not left vague.

**Type consistency:** `data` shape, `computeTrace`/`directNeighbors`/`dataToElements`/`validateGraph` signatures, the `__`-joined edge id, and the class names (`activity`/`intermediate`/`outcome`, `dim`, `lit-sel`/`lit-up`/`lit-down`, `e-up`/`e-down`, `anchor`) are used identically across Tasks 1, 3, and 4. `notionToGraph` output feeds `validateGraph` unchanged.
