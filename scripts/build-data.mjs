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
