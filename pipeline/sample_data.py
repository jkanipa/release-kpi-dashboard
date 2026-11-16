"""Write illustrative snapshots to data/releases/ so the dashboard can be tried
before test.guide is connected. Every snapshot is marked source="sample".
The numbers are invented and repeatable (fixed random seed).

    python -m pipeline.sample_data
"""
from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RELEASES = [("R1.0", "2026-01-12"), ("R1.1", "2026-03-09"), ("R1.2", "2026-05-11"),
            ("R2.0", "2026-07-13"), ("R2.1", "2026-09-14"), ("R2.2", "2026-11-09")]
VARIANTS = ["variant_a", "variant_b", "variant_c", "variant_d"]

# kpi: (baseline value per variant, measurement scatter, decimals)
BASE = {
    "wltc_consumption": ([15.8, 16.9, 18.2, 19.4], 0.05, 1),
    "wltc_range": ([520, 486, 451, 412], 1.5, 0),
    "r179_c_factor": ([1.000, 1.000, 1.000, 1.000], 0.002, 3),
    "pass_by_noise": ([67.4, 67.9, 68.6, 68.9], 0.12, 1),
    "stationary_noise": ([71.0, 71.5, 72.2, 72.0], 0.25, 1),
    "r177_power": ([210.0, 250.0, 300.0, 300.0], 0.5, 1),
    "power_30min": ([95.0, 110.0, 140.0, 140.0], 0.25, 1),
    "mass_running_order": ([2105, 2180, 2260, 2310], 2.0, 0),
}
# Storylines: (kpi, variant) -> (first release index it starts after, change per release)
DRIFT = {
    ("wltc_consumption", "variant_a"): (2, 0.13),
    ("wltc_consumption", "variant_b"): (2, -0.17),
    ("wltc_range", "variant_a"): (2, -4.0),
    ("wltc_range", "variant_b"): (2, 5.0),
    ("pass_by_noise", "variant_b"): (1, 0.3),
    ("pass_by_noise", "variant_d"): (3, 0.6),
    ("r179_c_factor", "variant_a"): (2, 0.004),
    ("mass_running_order", "variant_c"): (3, 7.0),
    ("r177_power", "variant_c"): (4, -4.0),
}
SPIKE = {("power_30min", "variant_b", 3): -3.0}        # one-off, recovers next release
MISSING = {("r179_c_factor", "variant_c", 4)}
FAILED = {("stationary_noise", "variant_d", 5)}


def main() -> None:
    rng = random.Random(7)
    out = ROOT / "data" / "releases"
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    for r, (release, date) in enumerate(RELEASES):
        results: dict = {}
        for v, variant in enumerate(VARIANTS):
            results[variant] = {}
            for kpi, (bases, scatter, decimals) in BASE.items():
                noise = rng.gauss(0, scatter) if r else 0.0
                if (kpi, variant, r) in MISSING:
                    continue
                start, slope = DRIFT.get((kpi, variant), (0, 0.0))
                value = bases[v] + noise + slope * max(0, r - start) + SPIKE.get((kpi, variant, r), 0.0)
                value = round(value, decimals)
                results[variant][kpi] = {
                    "value": int(value) if decimals == 0 else value,
                    "verdict": "FAILED" if (kpi, variant, r) in FAILED else "PASSED",
                    "report_id": None,
                    "report_url": None,
                    "measured_at": f"{date}T08:00:00Z",
                }
        snapshot = {"release": release, "source": "sample", "fetched_at": f"{date}T09:00:00Z", "results": results}
        (out / f"{release}.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(RELEASES)} sample snapshots to {out}")


if __name__ == "__main__":
    main()
