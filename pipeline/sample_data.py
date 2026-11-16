"""Write illustrative snapshots to data/releases/ so the dashboard can be tried
before test.guide is connected. Every snapshot is marked source="sample".

    python -m pipeline.sample_data
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RELEASES = ["R1.0", "R1.1", "R1.2", "R2.0", "R2.1"]
DATES = ["2026-03-02", "2026-05-04", "2026-07-06", "2026-09-07", "2026-11-09"]
VARIANTS = ["variant_a", "variant_b", "variant_c"]
VALUES = {
    "wltc_consumption": [[15.8, 15.8, 15.9, 16.0, 16.2], [16.9, 16.9, 16.8, 16.5, 16.4], [18.2, 18.3, 18.3, 18.4, 18.3]],
    "r179_c_factor": [[1.000, 1.002, 1.004, 1.012, 1.013], [1.000, 0.999, 1.001, 1.003, 1.002], [1.000, 1.001, 1.000, None, 1.004]],
    "pass_by_noise": [[67.4, 67.5, 67.4, 67.6, 67.5], [67.9, 68.0, 68.3, 68.6, 69.1], [68.6, 68.6, 68.5, 68.7, 68.6]],
    "r177_power": [[210, 210, 211, 210, 209], [250, 250, 249, 251, 250], [300, 301, 300, 296, 297]],
}


def main() -> None:
    out = ROOT / "data" / "releases"
    out.mkdir(parents=True, exist_ok=True)
    for r, release in enumerate(RELEASES):
        results: dict = {}
        for v, variant in enumerate(VARIANTS):
            results[variant] = {}
            for kpi, table in VALUES.items():
                value = table[v][r]
                if value is None:
                    continue
                results[variant][kpi] = {
                    "value": value,
                    "verdict": "PASSED",
                    "report_id": None,
                    "report_url": None,
                    "measured_at": f"{DATES[r]}T08:00:00Z",
                }
        snapshot = {"release": release, "source": "sample", "fetched_at": f"{DATES[r]}T09:00:00Z", "results": results}
        (out / f"{release}.json").write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(RELEASES)} sample snapshots to {out}")


if __name__ == "__main__":
    main()
