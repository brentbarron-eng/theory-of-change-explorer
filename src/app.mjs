import { dataToElements, computeTrace, directNeighbors } from './graph-model.mjs';

const cytoscape = window.cytoscape;
try { cytoscape.use(window.cytoscapeDagre); } catch { /* already registered */ }

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

let data, cy;
try {
  const res = await fetch('./data.json');
  if (!res.ok) throw new Error(`failed to fetch data.json: ${res.status}`);
  data = await res.json();

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
} catch (err) {
  console.error(err);
  document.getElementById('cy').textContent = 'Could not load data.json — see console.';
  throw err;
}

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
