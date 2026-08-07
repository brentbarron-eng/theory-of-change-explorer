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
