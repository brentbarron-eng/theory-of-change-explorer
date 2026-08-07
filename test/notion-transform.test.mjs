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
