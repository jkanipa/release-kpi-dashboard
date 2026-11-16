import pytest

from pipeline.compute import build_bundle, classify
from pipeline.validate import validate

PCT_LOW = {"direction": "lower_is_better", "tolerance": {"mode": "percent", "warn": 1.0, "fail": 2.0}}
PCT_HIGH = {"direction": "higher_is_better", "tolerance": {"mode": "percent", "warn": 1.0, "fail": 2.0}}
PCT_TARGET = {"direction": "target", "tolerance": {"mode": "percent", "warn": 1.0, "fail": 2.0}}
ABS_LOW = {"direction": "lower_is_better", "tolerance": {"mode": "absolute", "warn": 0.5, "fail": 1.0}, "limit": {"max": 70.0}}


@pytest.mark.parametrize(
    "kpi, value, baseline, expected",
    [
        (PCT_LOW, 100.0, 100.0, "ok"),
        (PCT_LOW, 101.0, 100.0, "ok"),          # exactly on the warn edge
        (PCT_LOW, 101.5, 100.0, "warn"),
        (PCT_LOW, 102.0, 100.0, "warn"),        # exactly on the fail edge
        (PCT_LOW, 102.5, 100.0, "deviated"),
        (PCT_LOW, 97.0, 100.0, "improved"),
        (PCT_LOW, 99.5, 100.0, "ok"),
        (PCT_HIGH, 103.0, 100.0, "improved"),
        (PCT_HIGH, 97.0, 100.0, "deviated"),
        (PCT_TARGET, 103.0, 100.0, "deviated"),
        (PCT_TARGET, 97.0, 100.0, "deviated"),
        (PCT_TARGET, 98.5, 100.0, "warn"),
        (ABS_LOW, 67.9, 67.4, "ok"),            # +0.5 dB, float noise must not flip it
        (ABS_LOW, 68.3, 67.4, "warn"),
        (ABS_LOW, 69.1, 67.9, "deviated"),
        (ABS_LOW, 66.0, 67.4, "improved"),
        (ABS_LOW, 70.5, 70.4, "deviated"),      # inside tolerance but over the limit
        (PCT_LOW, None, 100.0, "missing"),
        (PCT_LOW, 100.0, None, "no_baseline"),
    ],
)
def test_classify_status(kpi, value, baseline, expected):
    assert classify(kpi, value, baseline)["status"] == expected


def test_failed_verdict_wins():
    assert classify(PCT_LOW, 100.0, 100.0, "FAILED")["status"] == "failed_test"
    assert classify(PCT_LOW, 100.0, 100.0, "PASSED")["status"] == "ok"


def test_deltas_and_limit_margin():
    out = classify(ABS_LOW, 69.1, 67.9)
    assert out["delta_abs"] == pytest.approx(1.2)
    assert out["delta_pct"] == pytest.approx(1.2 / 67.9 * 100)
    assert out["limit_margin"] == pytest.approx(0.9)
    assert out["limit_violated"] is False
    assert classify(ABS_LOW, 70.5, 70.4)["limit_violated"] is True


def test_zero_baseline_does_not_crash():
    assert classify(PCT_TARGET, 0.0, 0.0)["status"] == "ok"
    assert classify(PCT_TARGET, 0.1, 0.0)["status"] == "deviated"


def test_repo_config_and_data_are_valid():
    errors, _ = validate()
    assert errors == []


def test_bundle_covers_every_cell():
    bundle = build_bundle()
    expected = len(bundle["releases"]) * len(bundle["variants"]) * len(bundle["kpis"])
    assert len(bundle["cells"]) == expected
    assert all("source" not in k for k in bundle["kpis"])
    for cell in bundle["cells"]:
        if cell["release"] == cell["baseline_release"] and cell["value"] is not None:
            assert cell["status"] == "ok" and cell["delta_abs"] == 0
