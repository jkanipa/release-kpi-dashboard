"""Pull KPI values from test.guide into data/releases/<release>.json.

    export TESTGUIDE_URL=https://testguide.example.com
    export TESTGUIDE_TOKEN=...            # never commit this
    python -m pipeline.fetch_testguide                 # all non-frozen releases
    python -m pipeline.fetch_testguide --release R2.1  # one release, even if frozen
    python -m pipeline.fetch_testguide --release R2.1 --from-file export.json --dry-run

NOT YET VERIFIED AGAINST A REAL SERVER. The endpoint, authentication and field
names all come from config/testguide.yaml, whose defaults are placeholders.
Use --from-file with a saved API response to check the mapping first.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

from .compute import ROOT, load_config


def dig(record, path: str):
    """Follow a dotted path through nested dicts; '' returns the record."""
    for part in [p for p in path.split(".") if p]:
        if not isinstance(record, dict):
            return None
        record = record.get(part)
    return record


def as_mapping(raw) -> dict:
    """Accept {'k': v}, [{'key': k, 'value': v}] or [{'name': k, 'value': v}]."""
    if isinstance(raw, dict):
        return raw
    out = {}
    for item in raw or []:
        if isinstance(item, dict):
            key = item.get("key", item.get("name"))
            if key is not None:
                out[key] = item.get("value")
    return out


def to_number(raw) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return raw
    try:
        return float(str(raw).strip().replace(",", "."))
    except ValueError:
        return None


def extract_results(executions: list[dict], tg: dict, config: dict, release_value: str, base_url: str = "") -> dict:
    """Map raw execution records to {variant_id: {kpi_id: result}} for one release.

    If several executions match a KPI, the most recently executed one wins.
    """
    f = tg["fields"]
    variant_by_value = {str(v["testguide_value"]): v["id"] for v in config["variants"]}
    kpi_by_testcase = {k["source"]["testcase"]: k for k in config["kpis"]}
    results: dict = {v["id"]: {} for v in config["variants"]}

    for ex in executions:
        tags = {**as_mapping(dig(ex, f["constants"])), **as_mapping(dig(ex, f["attributes"]))}
        if str(tags.get(tg["release_key"])) != str(release_value):
            continue
        variant = variant_by_value.get(str(tags.get(tg["variant_key"])))
        kpi = kpi_by_testcase.get(dig(ex, f["testcase_name"]))
        if variant is None or kpi is None:
            continue
        value = to_number(as_mapping(dig(ex, f[kpi["source"]["value_from"]])).get(kpi["source"]["key"]))
        if value is None:
            continue
        executed_at = dig(ex, f["executed_at"])
        previous = results[variant].get(kpi["id"])
        if previous and str(previous["measured_at"] or "") >= str(executed_at or ""):
            continue
        report_id = dig(ex, f["report_id"])
        results[variant][kpi["id"]] = {
            "value": value,
            "verdict": dig(ex, f["verdict"]),
            "report_id": report_id,
            "report_url": tg["report_url_template"].format(base_url=base_url.rstrip("/"), report_id=report_id) if report_id is not None and base_url else None,
            "measured_at": executed_at,
        }
    return results


def _fill(template, release: str):
    if isinstance(template, str):
        return template.replace("{release}", release)
    if isinstance(template, list):
        return [_fill(x, release) for x in template]
    if isinstance(template, dict):
        return {k: _fill(v, release) for k, v in template.items()}
    return template


def fetch_executions(tg: dict, base_url: str, token: str, release_value: str) -> list[dict]:
    import requests

    api = tg["api"]
    url = base_url.rstrip("/") + api["executions_path"]
    params = {api["project_id_param"]: api["project_id"]}
    headers = {"Accept": "application/json"}
    if api["auth"]["in"] == "header":
        headers[api["auth"]["name"]] = token
    else:
        params[api["auth"]["name"]] = token
    body = _fill(copy.deepcopy(api.get("filter_template") or {}), release_value)

    items: list[dict] = []
    offset = 0
    while True:
        if api.get("page_param"):
            params[api["page_param"]] = offset
            params[api["limit_param"]] = api["page_size"]
        if api["method"].upper() == "POST":
            resp = requests.post(url, params=params, headers=headers, json=body, timeout=60)
        else:
            resp = requests.get(url, params=params, headers=headers, timeout=60)
        if resp.status_code >= 400:
            # Never echo resp.url: it can contain the token.
            raise SystemExit(f"test.guide returned HTTP {resp.status_code} for {api['executions_path']}")
        page = dig(resp.json(), tg["response"]["items_path"]) or []
        items.extend(page)
        if not api.get("page_param") or len(page) < api["page_size"]:
            return items
        offset += len(page)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--release", help="fetch only this release id (also if frozen)")
    parser.add_argument("--from-file", type=Path, help="read executions from a saved JSON response instead of the server")
    parser.add_argument("--dry-run", action="store_true", help="print the snapshot instead of writing it")
    args = parser.parse_args()

    config = load_config()
    tg = yaml.safe_load((ROOT / "config" / "testguide.yaml").read_text())
    releases = [r for r in config["releases"] if (r["id"] == args.release if args.release else not r.get("frozen"))]
    if not releases:
        print("Nothing to fetch: no matching non-frozen release.")
        return 0

    base_url = os.environ.get("TESTGUIDE_URL", "")
    token = os.environ.get("TESTGUIDE_TOKEN", "")
    if not args.from_file and not (base_url and token):
        print("Set TESTGUIDE_URL and TESTGUIDE_TOKEN, or use --from-file.", file=sys.stderr)
        return 2

    expected = len(config["variants"]) * len(config["kpis"])
    for release in releases:
        value = str(release.get("testguide_value", release["id"]))
        if args.from_file:
            executions = dig(json.loads(args.from_file.read_text()), tg["response"]["items_path"]) or []
        else:
            executions = fetch_executions(tg, base_url, token, value)
        results = extract_results(executions, tg, config, value, base_url)
        found = sum(len(v) for v in results.values())
        snapshot = {
            "release": release["id"],
            "source": "test.guide",
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "results": results,
        }
        print(f"{release['id']}: {len(executions)} executions read, {found}/{expected} KPI values found")
        if args.dry_run:
            print(json.dumps(snapshot, indent=2))
        else:
            (ROOT / "data" / "releases" / f"{release['id']}.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
