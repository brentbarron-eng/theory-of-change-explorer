# Scheduled Notion → data.json Refresh (GitHub Actions) — Design Spec

**Date:** 2026-08-09
**Status:** Approved design, ready for implementation planning
**Builds on:** the deployed static site (see prior specs)

## Purpose

Automate the manual `npm run build-data` + commit + push refresh so the live
site tracks the Notion database without anyone running commands. A daily
GitHub Actions cron re-exports the graph and commits the change; GitHub Pages
redeploys on the push.

## Behavior

A single workflow, `.github/workflows/refresh-data.yml`:

- **Triggers:**
  - `schedule`: daily at `10:00 UTC` (≈ 6am ET).
  - `workflow_dispatch`: a manual "Run workflow" button for on-demand refresh.
- **Job** (`ubuntu-latest`), permissions `contents: write`:
  1. `actions/checkout`.
  2. `actions/setup-node` with **Node 24** (matches the dev machine `v24.19` and
     `package.json` `engines: ">=20"`; Node 20 is end-of-life as of April 2026 so
     it is deliberately not used).
  3. `npm ci`.
  4. `npm run build-data`, with env `NOTION_TOKEN` and `NOTION_DATABASE_ID` read
     from GitHub repo **secrets**.
  5. If `data.json` changed, configure a bot git identity, commit just
     `data.json`, and push to `master`. If nothing changed, do nothing (no empty
     commit).
- The push to `master` triggers the existing branch-based Pages rebuild.

## Safety

- `build-data` validates before writing and **refuses to write / exits non-zero
  on a hard data error** (dangling edge, invalid type/programs), so a broken
  Notion state fails the run instead of committing bad data. Cycle and orphan
  conditions remain non-fatal warnings.
- The job only pushes when `data.json` actually differs (`git diff --quiet`),
  avoiding noise.
- Uses the built-in `GITHUB_TOKEN` (no extra PAT); `contents: write` is the only
  elevated permission.

## User-provided prerequisites (cannot be done by the assistant)

Handling API tokens is out of scope for the assistant, so the repo owner adds
two repository secrets (via `gh secret set` or GitHub → Settings → Secrets and
variables → Actions):

- `NOTION_TOKEN` — the Notion integration token (same value as local `.env`).
- `NOTION_DATABASE_ID` — the theory-of-change database id.

The exact `gh secret set` commands are provided at implementation time.

## Verification

There is no unit-testable logic here (a declarative workflow). Verification is a
**first-run check**:

- Validate the YAML parses / the workflow appears in the repo's Actions tab.
- Trigger it once manually (`workflow_dispatch`), confirm the run succeeds, that
  it either commits a `data.json` change or reports "no changes", and — the one
  unverified assumption — that the Action-authored push **does** trigger the
  Pages rebuild and the live site updates. If a `GITHUB_TOKEN` push does not
  trigger Pages, the fallback is to switch Pages to an Actions-based deploy;
  note this only if the first run shows Pages didn't rebuild.

## Out of Scope

Actions-based Pages deployment (only if the branch-push rebuild proves
unreliable), PR-based refresh (chosen against — auto-commit to master), and any
change to the app itself.
