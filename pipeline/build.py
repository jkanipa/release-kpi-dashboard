"""Build the static site: copy site/ and write data/bundle.json next to it.

    python -m pipeline.build --out public
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from .compute import ROOT, build_bundle


def build(out: Path) -> dict:
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    bundle = build_bundle()
    (out / "data").mkdir(exist_ok=True)
    (out / "data" / "bundle.json").write_text(json.dumps(bundle, indent=1) + "\n")
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="public", help="output folder (default: public)")
    args = parser.parse_args()
    out = (ROOT / args.out).resolve()
    if ROOT not in out.parents:
        parser.error("--out must be a folder inside the project")
    bundle = build(out)
    counts: dict[str, int] = {}
    for cell in bundle["cells"]:
        counts[cell["status"]] = counts.get(cell["status"], 0) + 1
    print(f"Built {out} with {len(bundle['cells'])} cells: {counts}")


if __name__ == "__main__":
    main()
