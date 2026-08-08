import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_TYPES, validateGraph, adjacency, directNeighbors, computeTrace, dataToElements,
} from '../src/graph-model.mjs';
import { findLoopEdges } from '../src/graph-model.mjs';

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
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('edge target not found: ghost')));
});

test('cycle is a warning, not an error', () => {
  const r = validateGraph({
    nodes:[{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'intermediate'}],
    edges:[{source:'a',target:'b'},{source:'b',target:'a'}],
  });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(!r.errors.some(e => e.includes('cycle')));
  assert.ok(r.warnings.some(w => /cycle/.test(w)));
});

test('duplicate edge fails', () => {
  const r = validateGraph({
    nodes: [{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'outcome'}],
    edges: [{source:'a',target:'b'},{source:'a',target:'b'}],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('duplicate edge')));
});

test('orphan node is a warning, not an error', () => {
  const r = validateGraph({
    nodes:[{id:'a',label:'a',type:'activity'},{id:'b',label:'b',type:'outcome'},{id:'lonely',label:'l',type:'intermediate'}],
    edges:[{source:'a',target:'b'}],
  });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some(w => w.includes('orphan node (no edges): lonely')));
  assert.ok(!r.errors.some(e => e.includes('orphan')));
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

test('findLoopEdges detects the reinforcement loop in shipped data.json', () => {
  const data = JSON.parse(readFileSync(new URL('../data.json', import.meta.url), 'utf8'));
  const loops = findLoopEdges(data);
  assert.ok(loops.size >= 2, `expected the shipped data to contain a reinforcement loop, got ${loops.size} loop edges`);
});

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

test('validateGraph: non-array programs is an error', () => {
  const g = { nodes:[{id:'a',label:'a',type:'activity',programs:'P1'}], edges:[{source:'a',target:'a'}] };
  assert.ok(validateGraph(g).errors.some(e => e.includes('programs')));
});
