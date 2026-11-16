"""Load config and release snapshots, compare every value with its baseline."""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FAILING_VERDICTS = {"FAILED", "ERROR"}
EPS = 1e-9

STATUSES = ("ok", "warn", "deviated", "improved", "missing", "failed_test", "no_baseline")


def _yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def load_config(root: Path = ROOT) -> dict:
    cfg = root / "config"
    baseline = _yaml(cfg / "baseline.yaml")
    releases = _yaml(cfg / "releases.yaml").get("releases", [])
    for r in releases:
        r["date"] = str(r.get("date", ""))
    return {
        "kpis": _yaml(cfg / "kpis.yaml").get("kpis", []),
        "variants": _yaml(cfg / "variants.yaml").get("variants", []),
        "releases": releases,
        "baseline": {"default": baseline.get("default"), "variants": baseline.get("variants") or {}},
    }


def load_snapshots(root: Path, releases: list[dict]) -> dict[str, dict]:
    snaps = {}
    for r in releases:
        path = root / "data" / "releases" / f"{r['id']}.json"
        if path.exists():
            snaps[r["id"]] = json.loads(path.read_text())
    return snaps


def baseline_release(config: dict, variant_id: str) -> str | None:
    return config["baseline"]["variants"].get(variant_id, config["baseline"]["default"])


def classify(kpi: dict, value: float | None, baseline: float | None, verdict: str | None = None) -> dict:
    """Compare one value with its baseline. Returns status, deltas and limit margin."""
    out = {"status": "ok", "delta_abs": None, "delta_pct": None, "limit_margin": None, "limit_violated": False}
    if value is None:
        out["status"] = "missing"
        return out

    limit = kpi.get("limit") or {}
    if "max" in limit:
        out["limit_margin"] = limit["max"] - value
    elif "min" in limit:
        out["limit_margin"] = value - limit["min"]
    if out["limit_margin"] is not None and out["limit_margin"] < -EPS:
        out["limit_violated"] = True

    if baseline is not None:
        out["delta_abs"] = value - baseline
        out["delta_pct"] = (value - baseline) / baseline * 100 if baseline else None

    if verdict and verdict.upper() in FAILING_VERDICTS:
        out["status"] = "failed_test"
        return out
    if out["limit_violated"]:
        out["status"] = "deviated"
        return out
    if baseline is None:
        out["status"] = "no_baseline"
        return out

    tol = kpi["tolerance"]
    dev = out["delta_abs"] if tol["mode"] == "absolute" else out["delta_pct"]
    if dev is None:  # percent tolerance against a zero baseline
        out["status"] = "ok" if abs(out["delta_abs"]) <= EPS else "deviated"
        return out
    size = abs(dev)
    direction = kpi["direction"]
    good = (direction == "lower_is_better" and dev < 0) or (direction == "higher_is_better" and dev > 0)
    if size <= tol["warn"] + EPS:
        out["status"] = "ok"
    elif good:
        out["status"] = "improved"
    elif size <= tol["fail"] + EPS:
        out["status"] = "warn"
    else:
        out["status"] = "deviated"
    return out


def _commit() -> str:
    sha = os.environ.get("CI_COMMIT_SHORT_SHA")
    if sha:
        return sha
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return "uncommitted"


def build_bundle(root: Path = ROOT) -> dict:
    """Everything the dashboard needs, as one JSON-serialisable dict."""
    config = load_config(root)
    snaps = load_snapshots(root, config["releases"])

    def result(release: str | None, variant: str, kpi: str) -> dict:
        return ((snaps.get(release) or {}).get("results", {}).get(variant, {}) or {}).get(kpi) or {}

    cells = []
    for release in config["releases"]:
        for variant in config["variants"]:
            base_rel = baseline_release(config, variant["id"])
            for kpi in config["kpis"]:
                res = result(release["id"], variant["id"], kpi["id"])
                base = result(base_rel, variant["id"], kpi["id"]).get("value")
                cell = classify(kpi, res.get("value"), base, res.get("verdict"))
                cell.update(
                    release=release["id"],
                    variant=variant["id"],
                    kpi=kpi["id"],
                    value=res.get("value"),
                    baseline=base,
                    baseline_release=base_rel,
                    verdict=res.get("verdict"),
                    report_url=res.get("report_url"),
                    measured_at=res.get("measured_at"),
                )
                cells.append(cell)

    fetched = [s.get("fetched_at") for s in snaps.values() if s.get("fetched_at")]
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": _commit(),
        "data_as_of": max(fetched) if fetched else None,
        "sample_data": any(s.get("source") == "sample" for s in snaps.values()),
        "kpis": [{k: v for k, v in kpi.items() if k != "source"} for kpi in config["kpis"]],
        "variants": [{"id": v["id"], "name": v["name"]} for v in config["variants"]],
        "releases": [{"id": r["id"], "date": r["date"], "frozen": bool(r.get("frozen"))} for r in config["releases"]],
        "baseline": config["baseline"],
        "cells": cells,
    }
