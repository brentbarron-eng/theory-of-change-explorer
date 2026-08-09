# Scheduled Notion Data-Refresh (GitHub Actions) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This is a small, mostly-declarative change; inline execution is appropriate.

**Goal:** A daily GitHub Actions cron (plus a manual button) that re-runs `npm run build-data` against Notion and auto-commits any `data.json` change to `master`, so the live site stays current without manual refreshes.

**Architecture:** One workflow file, `.github/workflows/refresh-data.yml`. It uses the built-in `GITHUB_TOKEN` (with `contents: write`) to push; Notion credentials come from repo secrets. `build-data`'s existing validation gates bad data. The push triggers the existing branch-based Pages rebuild.

**Tech Stack:** GitHub Actions, Node 24 (`setup-node`), the existing `npm run build-data` script.

## Global Constraints

- **Node 24** in CI (Node 20 is EOL as of April 2026; local dev is `v24.19`; `package.json` `engines` is `">=20"`).
- Credentials only via GitHub **secrets** `NOTION_TOKEN` / `NOTION_DATABASE_ID` — never hard-coded. The assistant does NOT set the token secret (handling API tokens is out of scope); the repo owner sets it.
- Node/npm not on the Bash PATH locally: prepend `export PATH="/c/Program Files/nodejs:$PATH"`; `gh` is at `/c/Program Files/GitHub CLI`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Auto-commit only when `data.json` actually changed (no empty commits).

---

### Task 1: Add the refresh workflow + README note

**Files:**
- Create: `.github/workflows/refresh-data.yml`
- Modify: `README.md` (document the automation + how to set secrets)

- [ ] **Step 1: Create `.github/workflows/refresh-data.yml`**

```yaml
name: Refresh data from Notion

on:
  schedule:
    - cron: '0 10 * * *'   # daily ~10:00 UTC (~6am ET)
  workflow_dispatch:        # manual "Run workflow" button

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - name: Regenerate data.json from Notion
        run: npm run build-data
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          NOTION_DATABASE_ID: ${{ secrets.NOTION_DATABASE_ID }}
      - name: Commit & push if data.json changed
        run: |
          if git diff --quiet -- data.json; then
            echo "No data.json changes — nothing to commit."
          else
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add data.json
            git commit -m "chore: auto-refresh data.json from Notion"
            git push
          fi
```

- [ ] **Step 2: Add a "Scheduled refresh" section to `README.md`**

Append under the data-refresh docs:

```markdown
## Automatic daily refresh (GitHub Actions)

`.github/workflows/refresh-data.yml` re-runs the Notion export daily (~6am ET)
and commits any `data.json` change to `master`, which redeploys Pages. You can
also trigger it on demand from the repo's **Actions → Refresh data from Notion →
Run workflow** button.

It needs two repository secrets (Settings → Secrets and variables → Actions, or
the `gh` CLI):

    gh secret set NOTION_TOKEN         # paste the Notion integration token
    gh secret set NOTION_DATABASE_ID   # the theory-of-change database id

The manual local refresh (`npm run build-data`) still works and is unaffected.
```

- [ ] **Step 3: Validate the YAML parses**

Run (Python is available and has PyYAML often; if not, skip and rely on GitHub's parse):
`python -c "import yaml; yaml.safe_load(open('.github/workflows/refresh-data.yml')); print('yaml ok')"`
Expected: `yaml ok` (or, if PyYAML is missing, note it and continue — GitHub validates on push).

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/refresh-data.yml README.md
git commit -m "$(printf 'feat: daily GitHub Actions cron to refresh data.json from Notion\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
git push
```

(Pushing the workflow to `master` is what registers it in the Actions tab.)

---

### Task 2: Set secrets and verify the first run

**Files:** none (configuration + verification).

- [ ] **Step 1: Repo owner sets the two secrets** (assistant provides the commands; the owner runs them so the token is never handled by the assistant):

```bash
gh secret set NOTION_TOKEN --repo brentbarron-eng/theory-of-change-explorer
gh secret set NOTION_DATABASE_ID --repo brentbarron-eng/theory-of-change-explorer
```

`gh secret set` prompts for the value interactively (or set the DB id inline:
`gh secret set NOTION_DATABASE_ID -b "3a56e263-2e0b-8026-b5ac-c8de2aa3948a" --repo …`).

- [ ] **Step 2: Trigger a manual run**

```bash
gh workflow run "Refresh data from Notion" --repo brentbarron-eng/theory-of-change-explorer
```

- [ ] **Step 3: Watch the run and confirm outcome**

```bash
gh run list --workflow "Refresh data from Notion" --repo brentbarron-eng/theory-of-change-explorer --limit 1
gh run watch <run-id> --repo brentbarron-eng/theory-of-change-explorer
```
Expected: the run succeeds; the "Commit & push" step either commits a `data.json`
change or prints "No data.json changes — nothing to commit."

- [ ] **Step 4: Confirm Pages redeployed (the one unverified assumption)**

If the run committed a change, confirm Pages rebuilt:
`gh api repos/brentbarron-eng/theory-of-change-explorer/pages/builds/latest --jq '{status,commit}'`
Expected: status `built` at the new commit. **If Pages did NOT rebuild from the
Action-authored push**, the fallback is to convert Pages to an Actions-based
deploy (`actions/deploy-pages`) — only pursue this if the branch-push rebuild
proves unreliable.

- [ ] **Step 5: Watch for churn (follow-up note, not a blocker)**

If daily runs start producing `data.json` commits even when nothing changed in
Notion, the cause is non-deterministic node/edge ordering from the Notion query.
Fix would be a deterministic sort (e.g. sort nodes by id, edges by
`source__target`) in `scripts/notion-transform.mjs`. Note it here; implement only
if churn actually appears.

---

## Self-Review (against the spec)

- Daily cron + manual dispatch, Node 24, secrets, `contents: write`, commit-only-on-change, Pages-via-push → Task 1 workflow + Task 2 verify.
- Assistant-doesn't-handle-token constraint → Task 2 Step 1 is owner-run.
- First-run Pages-trigger assumption → Task 2 Step 4 with a named fallback.
- No placeholders; the only deferred item (ordering churn) is explicitly conditional with its fix named. No cross-task type dependencies (declarative config).
