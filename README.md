# Release KPI dashboard

Shows certification KPIs (WLTC consumption, UN R179 C-factor, pass-by noise, UN R177 power, …) for every release and vehicle variant, and flags where they drift from a frozen baseline release.

```
test.guide ──► pipeline/fetch_testguide.py ──► data/releases/<release>.json  (committed)
                                                        │
              config/*.yaml ────────────────────────────┤
                                                        ▼
                                  pipeline/build.py ──► public/  ──► GitLab Pages
```

The Git repo is the record: each release's values are a committed JSON file, and the site is rebuilt from them on every pipeline.

## Status

| Part | State |
|---|---|
| Deviation logic, validation, site, CI file | Working, tested with sample data |
| Data in `data/releases/` | **Illustrative sample data**, not real results |
| test.guide fetch | **Not verified against a real server.** Endpoint, auth and field names in `config/testguide.yaml` are placeholders |
| KPI units, tolerances, limits | Placeholders to confirm with KPI owners |

## Views

| View | Shows |
|---|---|
| Release | Headline for one release, what got worse since the previous one, a worst-first "needs attention" list, and every KPI grouped by `group` with value, change and trend |
| All releases | Status heatmap of every KPI and variant across all releases |
| KPI detail | One chart per variant with baseline, tolerance band, deviation threshold and limit, plus the values table |
| Compare | Two releases side by side, optionally only where the status changed |
| Details | Every result as a filterable table with CSV download |

The selected release, KPI and filters are part of the page address, so a copied link opens the same view. The site has no external dependencies and a print stylesheet for release reviews.

## Run it locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -q
.venv/bin/python -m pipeline.validate
.venv/bin/python -m pipeline.build --out public
.venv/bin/python -m http.server 8765 --directory public --bind 127.0.0.1
```

Then open http://localhost:8765.

## How a value is judged

`delta = value − baseline`, as a percentage or in the KPI's unit depending on `tolerance.mode`.

| Status | Rule |
|---|---|
| Within tolerance | `|delta| ≤ warn` |
| Improved | beyond `warn` in the good direction (`lower_is_better` / `higher_is_better` only) |
| Warning | `warn < |delta| ≤ fail` |
| Deviated | `|delta| > fail`, or outside the KPI's `limit` |
| Test failed | test.guide verdict is FAILED or ERROR |
| Missing / No baseline | no value for the release / for the baseline release |

## Everyday changes

- **New release:** add a line to `config/releases.yaml` with `frozen: false`. The next fetch fills it. Set `frozen: true` once the release is final so it is never overwritten.
- **New KPI:** add an entry to `config/kpis.yaml` (name, unit, direction, tolerance, test.guide source). No code change.
- **New variant:** add it to `config/variants.yaml` with its test.guide value.
- **Re-baseline:** edit `config/baseline.yaml` (globally or per variant) through a merge request.

## Connecting test.guide

1. On your server open Help contents → REST API and correct `config/testguide.yaml`: the executions endpoint, how the token is passed, the request filter, and the field names in a response record.
2. Set `source` for each KPI in `config/kpis.yaml` (test case name, and which parameter holds the number), and `testguide_value` for each variant and release.
3. Save one real API response to a file and check the mapping without touching the repo:
   ```bash
   .venv/bin/python -m pipeline.fetch_testguide --release R2.1 --from-file response.json --dry-run
   ```
4. Run it live with `TESTGUIDE_URL` and `TESTGUIDE_TOKEN` set in your shell. Never commit the token.
5. Delete the sample snapshots (`data/releases/*.json`) and `pipeline/sample_data.py` once real data is in.

## Deploying on GitLab

1. Create the project on GitLab and push this repo.
2. Settings → CI/CD → Variables: add `TESTGUIDE_URL`, `TESTGUIDE_TOKEN`, `PUSH_TOKEN` (project access token, Developer, `write_repository`), all masked and protected.
3. Settings → General → Visibility: set Pages to **Only project members**.
4. Build → Pipeline schedules: add a nightly schedule on the default branch. To fetch by hand, run a pipeline with variable `FETCH=1`.
5. Make sure the runner can reach the test.guide server.
6. Fill in `CODEOWNERS` and require code-owner approval on the default branch.
7. Give viewers the Guest or Reporter role. The site URL is under Deploy → Pages.

After the first deploy, open the Pages URL once as a member and once logged out to confirm access control works.
