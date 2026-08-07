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
const { ok, errors, warnings } = validateGraph(data);
if (!ok) {
  console.error('data.json INVALID:\n' + errors.map(e => ' - ' + e).join('\n'));
  process.exit(1);
}
if (warnings && warnings.length) {
  console.warn(warnings.map(w => '⚠ warning: ' + w).join('\n'));
}
console.log(`data.json valid: ${data.nodes.length} nodes, ${data.edges.length} edges`);
