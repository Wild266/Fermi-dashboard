#!/usr/bin/env python3
"""build_manifest.py

Optional helper.

Scans docs/data/*/temp_*/ for:
  - responses_labeled.csv (preferred)
  - responses.csv (fallback)

Writes docs/data/manifest.json.

Usage:
  python tools/build_manifest.py

Run from your repo root.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


def temp_label_from_dirname(name: str) -> str:
    # temp_0_1 -> T=0.1
    m = re.match(r"^temp_(\d+)_(\d+)$", name)
    if not m:
        return name
    a, b = m.group(1), m.group(2)
    try:
        t = float(f"{int(a)}.{b}")
        return f"T={t:g} ({name})"
    except Exception:
        return name


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    docs = root / "docs"
    data_dir = docs / "data"

    if not data_dir.exists():
        raise SystemExit(f"Missing {data_dir}. Did you copy the docs/ folder?")

    datasets = []
    for ds_dir in sorted([p for p in data_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]):
        files = []
        for tdir in sorted([p for p in ds_dir.glob("temp_*") if p.is_dir()]):
            cand = tdir / "responses_labeled.csv"
            if not cand.exists():
                cand = tdir / "responses.csv"
            if not cand.exists():
                continue
            rel = cand.relative_to(docs).as_posix()
            files.append({
                "label": temp_label_from_dirname(tdir.name),
                "path": rel,
            })

        if files:
            datasets.append({
                "id": ds_dir.name,
                "label": ds_dir.name,
                "files": files,
            })

    manifest = {
        "title": "LLN Dashboard",
        "datasets": datasets,
    }

    out_path = data_dir / "manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote: {out_path}")
    print(f"Datasets: {len(datasets)}")


if __name__ == "__main__":
    main()
