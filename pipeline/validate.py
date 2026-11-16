"""Check config and snapshots before the site is built.

    python -m pipeline.validate            # errors fail, gaps are warnings
    python -m pipeline.validate --strict   # missing values fail too
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .compute import ROOT, baseline_release, load_config, load_snapshots

DIRECTIONS = {"lower_is_better", "higher_is_better", "target"}
MODES = {"percent", "absolute"}


def validate(root: Path = ROOT) -> tuple[list[str], list[str]]:
    """Return (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    config = load_config(root)

    for name in ("kpis", "variants", "releases"):
        ids = [x.get("id") for x in config[name]]
        if not ids:
            errors.append(f"config/{name}.yaml: no entries")
        for dup in sorted({i for i in ids if ids.count(i) > 1}, key=str):
            errors.append(f"config/{name}.yaml: duplicate id '{dup}'")

    for kpi in config["kpis"]:
        where = f"kpi '{kpi.get('id')}'"
        if kpi.get("direction") not in DIRECTIONS:
            errors.append(f"{where}: direction must be one of {sorted(DIRECTIONS)}")
        tol = kpi.get("tolerance") or {}
        if tol.get("mode") not in MODES:
            errors.append(f"{where}: tolerance.mode must be one of {sorted(MODES)}")
        warn, fail = tol.get("warn"), tol.get("fail")
        if not all(isinstance(x, (int, float)) for x in (warn, fail)) or warn < 0 or fail < warn:
            errors.append(f"{where}: tolerance needs numbers with 0 <= warn <= fail")
        limit = kpi.get("limit")
        if limit is not None and not (set(limit) <= {"max", "min"} and len(limit) == 1):
            errors.append(f"{where}: limit must be {{max: x}} or {{min: x}}")

    release_ids = [r["id"] for r in config["releases"]]
    variant_ids = {v["id"] for v in config["variants"]}
    kpi_ids = {k["id"] for k in config["kpis"]}

    if config["baseline"]["default"] not in release_ids:
        errors.append(f"config/baseline.yaml: default '{config['baseline']['default']}' is not a release")
    for variant, rel in config["baseline"]["variants"].items():
        if variant not in variant_ids:
            errors.append(f"config/baseline.yaml: unknown variant '{variant}'")
        if rel not in release_ids:
            errors.append(f"config/baseline.yaml: '{rel}' for {variant} is not a release")

    snaps = load_snapshots(root, config["releases"])
    for rid in release_ids:
        snap = snaps.get(rid)
        if snap is None:
            warnings.append(f"{rid}: no snapshot file in data/releases/")
            continue
        if snap.get("release") != rid:
            errors.append(f"{rid}: snapshot says release '{snap.get('release')}'")
        results = snap.get("results", {})
        for variant, kpis in results.items():
            if variant not in variant_ids:
                errors.append(f"{rid}: unknown variant '{variant}' in snapshot")
            for kpi, res in (kpis or {}).items():
                if kpi not in kpi_ids:
                    errors.append(f"{rid}/{variant}: unknown kpi '{kpi}' in snapshot")
                value = (res or {}).get("value")
                if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
                    errors.append(f"{rid}/{variant}/{kpi}: value {value!r} is not a number")
        for variant in sorted(variant_ids):
            for kpi in sorted(kpi_ids):
                if ((results.get(variant) or {}).get(kpi) or {}).get("value") is None:
                    msg = f"{rid}/{variant}/{kpi}: no value"
                    is_baseline = baseline_release(config, variant) == rid
                    (errors if is_baseline else warnings).append(msg + (" (baseline release)" if is_baseline else ""))
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = parser.parse_args()
    errors, warnings = validate()
    for w in warnings:
        print(f"WARNING {w}")
    for e in errors:
        print(f"ERROR   {e}")
    failed = bool(errors) or (args.strict and bool(warnings))
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
