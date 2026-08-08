# Phase 3 (final cycle) — Descriptions/Metrics, Program Filter, Focus Mode — Design Spec

**Date:** 2026-08-08
**Status:** Approved design, ready for implementation planning
**Builds on:** v1 (`2026-08-07-theory-of-change-viz-design.md`) and phase-2 cycle-1 (`2026-08-07-phase2-cifar-look-and-feel-design.md`)

## Purpose

The final planned cycle. Surface richer per-node content (description + success metric) in the side panel, let viewers filter the graph by program/workstream, add a focus mode to isolate a single node's causal chain, and soften orphan validation for completeness.

## Scope

1. **Node descriptions + metrics** in the side panel.
2. **Program filter** — bottom checkbox strip to show/hide nodes by workstream (propagated from activities).
3. **Focus mode** — isolate the selected node's chain.
4. **Orphan handling** — orphan nodes become a non-fatal validation warning.

Nothing further is planned after this cycle.

## Notion schema (confirmed live 2026-08-08)

Relevant properties: `Name` (title), `Type` (select: Activity/Outcome/Intermediate), `How`/`Why` (relations), and the fields this cycle consumes:
- **`Description`** (rich_text) — explanatory blurb. Currently 0 nodes filled (panel line shows only when present).
- **`Metric`** (rich_text) — how success is measured at this node. ~3 filled.
- **`Program`** (multi_select) — workstream(s). 6 options: *Canada CIFAR AI Chairs, AI Communications, Next Gen, Applied AI Research, CAISI, AI Policy*. ~10 nodes (the activities) tagged.

Program values are read dynamically from the data — adding/removing a workstream in Notion needs no code change.

## Data pipeline

Extend `scripts/notion-transform.mjs` (`notionToGraph`) so each node also carries, when present:
- `description: string` (from `Description` rich_text, joined plain text)
- `metric: string` (from `Metric` rich_text)
- `programs: string[]` (from `Program` multi_select option names; omitted or `[]` when none)

`data.json` node shape becomes `{ id, label, type, description?, metric?, programs? }`. Edges unchanged.

`validateGraph` changes:
- If a node has `programs`, it must be an array of strings (else an error).
- **Orphan nodes → `warnings`, not `errors`** (same non-fatal pattern as cycles). A build with only orphan/cycle warnings still writes `data.json` and exits 0. Orphans then render as disconnected nodes.

## Side panel

Below the type badge, in order, each shown only when non-empty:
- **Description** — the blurb.
- **"How we measure success"** — a labeled line showing `metric`.

Then the existing "Contributed to by" / "Leads to" lists. With today's data (Description empty, Metric sparse) most panels look unchanged until Notion is populated.

## Program filter

**Program membership (pure helper `computeNodePrograms(data) -> Map<string, Set<string>>`):**
- An activity's program set = its own `programs`.
- Every other node's program set = the **union of programs of all activities that can reach it** (propagate downstream through the DAG).
- A node reachable from no program-tagged activity has an empty set → treated as **"Out of Scope"**.

**UI:** a checkbox strip along the **bottom** of the screen, one box per program present in the data, plus an **"Out of Scope"** box iff any node is program-less. Boxes are derived dynamically and **all checked by default** (full graph).

**Behavior:** a node is visible iff its program set intersects the checked set (an empty-set node matches the "Out of Scope" box). An edge is visible iff both endpoints are visible. Toggling a box updates visibility and **re-fits the view to what's visible, preserving node positions** (no re-layout). Unchecking all but one workstream isolates that workstream's chain end-to-end; a node shared across workstreams stays visible while any of its workstreams is checked.

## Focus mode

A **"Focus"** control, enabled once a node is selected. On activate: hide everything except the selected node's ancestors + descendants (its full chain), re-lay-out just that chain (dagre `LR` + the existing pinned-ends pass), and fit. An **"Exit focus"** affordance restores the full graph (re-run the standard layout + pinned ends).

- **Focus ignores the program filter:** while focused, the selected node's entire chain is shown regardless of the workstream checkboxes; exiting focus re-applies the current filter.
- Clicking a node in the panel's lists while focused re-focuses on that node.

## Testing

- **Automated (TDD, pure logic):**
  - `computeNodePrograms` — activities carry their own programs; a downstream node inherits the union of its reaching activities' programs; a node reachable from two differently-tagged activities gets both; a node reachable from none has an empty set. Handles the cross-linked DAG.
  - `notionToGraph` — new fixture nodes carry `description`/`metric`/`programs`; `Program` multi_select parses to a string array; missing fields omit cleanly.
  - `validateGraph` — orphan yields `ok:true` with an orphan `warning` (no longer an error); a non-array `programs` yields an error; the shipped `data.json` still validates.
- **Manual QA (browser):** description/metric render in the panel when present; program checkboxes show/hide the right chains with OR semantics and "Out of Scope"; focus isolates + re-lays-out the chain and exits cleanly; focus overrides filter; no console errors; deployed live check.

## Out of Scope

No further cycles planned. Not included: pinning/columning intermediates, richer loop visualization (the callout remains flag-off), multiple theories of change, in-app editing, live Notion sync, accounts.
