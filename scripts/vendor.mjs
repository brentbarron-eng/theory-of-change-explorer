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
