export const NODE_TYPES = ['activity', 'intermediate', 'outcome'];

export function validateGraph(data) {
  const errors = [];
  const warnings = [];
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return { ok: false, errors: ['data must have `nodes` and `edges` arrays'], warnings };
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
  const edgeKeys = new Set();
  for (const e of data.edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') { errors.push(`edge missing source/target: ${JSON.stringify(e)}`); continue; }
    if (!ids.has(e.source)) errors.push(`edge source not found: ${e.source}`);
    if (!ids.has(e.target)) errors.push(`edge target not found: ${e.target}`);
    if (e.source === e.target) errors.push(`self-loop on ${e.source}`);
    const key = `${e.source}__${e.target}`;
    if (edgeKeys.has(key)) errors.push(`duplicate edge: ${e.source} -> ${e.target}`);
    edgeKeys.add(key);
    connected.add(e.source); connected.add(e.target);
  }
  for (const id of ids) if (!connected.has(id)) errors.push(`orphan node (no edges): ${id}`);
  const cycle = findCycle(data);
  if (cycle) warnings.push(`cycle detected: ${cycle.join(' -> ')}`);
  return { ok: errors.length === 0, errors, warnings };
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
