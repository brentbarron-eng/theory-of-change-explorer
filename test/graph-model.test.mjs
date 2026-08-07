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
