from pathlib import Path

import yaml

from pipeline.compute import ROOT, load_config
from pipeline.fetch_testguide import as_mapping, extract_results, to_number

TG = yaml.safe_load((ROOT / "config" / "testguide.yaml").read_text())
CONFIG = load_config()


def execution(testcase, variant, key, value, when, release="R2.1", verdict="PASSED", report_id=1):
    """One record in the shape config/testguide.yaml currently assumes."""
    return {
        "testCaseName": testcase,
        "verdict": verdict,
        "executionTime": when,
        "reportId": report_id,
        "attributes": [{"key": "Release", "value": release}, {"key": "Variant", "value": variant}],
        "parameters": {key: value},
        "constants": [],
    }


def test_maps_executions_to_variants_and_kpis():
    results = extract_results(
        [
            execution("WLTC_Consumption", "VAR_A", "consumption_kwh_100km", "16,2", "2026-11-09T08:00:00Z", report_id=42),
            execution("PassByNoise", "VAR_B", "lurban_dba", 69.1, "2026-11-09T08:00:00Z"),
        ],
        TG, CONFIG, "R2.1", "https://tg.example.com/",
    )
    assert results["variant_a"]["wltc_consumption"]["value"] == 16.2
    assert results["variant_a"]["wltc_consumption"]["report_url"] == "https://tg.example.com/report/42"
    assert results["variant_b"]["pass_by_noise"]["value"] == 69.1
    assert results["variant_c"] == {}


def test_latest_execution_wins_and_other_releases_are_ignored():
    results = extract_results(
        [
            execution("R177_Power", "VAR_A", "net_power_kw", 209, "2026-11-09T10:00:00Z"),
            execution("R177_Power", "VAR_A", "net_power_kw", 205, "2026-11-08T10:00:00Z"),
            execution("R177_Power", "VAR_A", "net_power_kw", 999, "2026-11-10T10:00:00Z", release="R2.0"),
        ],
        TG, CONFIG, "R2.1",
    )
    assert results["variant_a"]["r177_power"]["value"] == 209
    assert results["variant_a"]["r177_power"]["report_url"] is None


def test_unknown_variant_testcase_and_non_numeric_values_are_skipped():
    results = extract_results(
        [
            execution("R177_Power", "VAR_X", "net_power_kw", 209, "t"),
            execution("SomethingElse", "VAR_A", "net_power_kw", 209, "t"),
            execution("R177_Power", "VAR_A", "net_power_kw", "n/a", "t"),
        ],
        TG, CONFIG, "R2.1",
    )
    assert all(v == {} for v in results.values())


def test_helpers():
    assert as_mapping([{"name": "a", "value": 1}, {"key": "b", "value": 2}]) == {"a": 1, "b": 2}
    assert as_mapping(None) == {}
    assert to_number(True) is None and to_number(" 1.5 ") == 1.5
