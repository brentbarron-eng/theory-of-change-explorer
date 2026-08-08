// NOTE: property names/values confirmed against the live Notion DB as of 2026-08-07
// (Type options are Activity/Outcome/Intermediate; How=upstream, Why=downstream).
// Property names may still drift if the DB schema changes later.
export const DEFAULT_CONFIG = {
  titleProp: 'Name',
  typeProp: 'Type',
  activityValue: 'Activity',
  outcomeValue: 'Outcome',
  upstreamRelation: 'How',    // points to causes of this node
  downstreamRelation: 'Why',  // points to effects of this node
  descriptionProp: 'Description',
  metricProp: 'Metric',
  programProp: 'Program',
};

export function notionToGraph(pages, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ids = new Set(pages.map(p => p.id));
  const nodes = pages.map(p => {
    const node = { id: p.id, label: plainTitle(p, cfg.titleProp), type: typeOf(p, cfg) };
    const description = plainRich(p, cfg.descriptionProp);
    const metric = plainRich(p, cfg.metricProp);
    const programs = multiSelectNames(p, cfg.programProp);
    if (description) node.description = description;
    if (metric) node.metric = metric;
    if (programs.length) node.programs = programs;
    return node;
  });
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

function plainRich(p, prop) {
  return (p.properties?.[prop]?.rich_text || []).map(x => x.plain_text).join('').trim();
}

function multiSelectNames(p, prop) {
  return (p.properties?.[prop]?.multi_select || []).map(o => o.name);
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
