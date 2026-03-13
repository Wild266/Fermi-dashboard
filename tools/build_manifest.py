#!/usr/bin/env python3
"""Builds docs/manifest.json by scanning docs/models/*/*

Expected layout:

  docs/models/7B/agg_v2/<analytics files>
  docs/models/7B/agg_weighted/<analytics files>
  docs/models/14B/agg_v2/...
  docs/models/32B/agg_v2/...

Each <analytics files> folder may contain:
  - plots/*.png (and other image files)
  - plots/legend_methods.pdf, plots/method_styles.json, ...
  - histograms/<topk>/<kind>/<temp>/q_<n>.png
  - metrics_*.csv, per_group_predictions.csv
  - method_rankings.txt
  - run_config.json

This script creates a small manifest so the static dashboard can render without a server.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
HIST_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

KNOWN_ROOT_FILES = [
    "method_rankings.txt",
    "metrics_by_group.csv",
    "metrics_by_temp_kind.csv",
    "metrics_global.csv",
    "metrics_overall.csv",
    "per_group_predictions.csv",
    "run_config.json",
]

KNOWN_PLOTS_FILES = [
    "legend_methods.pdf",
    "legend_methods.png",
    "method_styles.json",
]

Q_RE = re.compile(r"^q_(\d+)(\.[A-Za-z0-9]+)$")


def _rel_posix(path: Path, docs_dir: Path) -> str:
    return path.relative_to(docs_dir).as_posix()


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    docs_dir = repo_root / "docs"
    models_dir = docs_dir / "models"

    if not docs_dir.exists():
        raise SystemExit(f"Missing docs/ at {docs_dir}")
    if not models_dir.exists():
        raise SystemExit(f"Missing docs/models/ at {models_dir}")

    manifest: Dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "models": [],
    }

    for model_dir in sorted([p for p in models_dir.iterdir() if p.is_dir()]):
        # Skip placeholder-only dirs with no agg folders.
        aggs: List[Dict] = []

        for agg_dir in sorted([p for p in model_dir.iterdir() if p.is_dir()]):
            # Common names: agg_v2, agg_weighted
            if not (agg_dir.name.startswith("agg") or agg_dir.name.startswith("run")):
                continue

            base_path = _rel_posix(agg_dir, docs_dir)

            # Plots: show only image files as thumbnails
            plots: List[str] = []
            plots_dir = agg_dir / "plots"
            if plots_dir.exists() and plots_dir.is_dir():
                for f in sorted([p for p in plots_dir.iterdir() if p.is_file()]):
                    if f.suffix.lower() in IMAGE_EXTS:
                        plots.append(_rel_posix(f, docs_dir))

            # Files: metrics + a few known plot assets
            files: Dict[str, str] = {}
            for name in KNOWN_ROOT_FILES:
                p = agg_dir / name
                if p.exists() and p.is_file():
                    files[name] = _rel_posix(p, docs_dir)

            if plots_dir.exists() and plots_dir.is_dir():
                for name in KNOWN_PLOTS_FILES:
                    p = plots_dir / name
                    if p.exists() and p.is_file():
                        files[f"plots/{name}"] = _rel_posix(p, docs_dir)

            # Histograms: store only min/max q per temp folder to keep manifest small
            histograms: Dict = {}
            hist_dir = agg_dir / "histograms"
            if hist_dir.exists() and hist_dir.is_dir():
                for topk_dir in sorted([p for p in hist_dir.iterdir() if p.is_dir()]):
                    topk_name = topk_dir.name
                    histograms[topk_name] = {}
                    for kind_dir in sorted([p for p in topk_dir.iterdir() if p.is_dir()]):
                        kind_name = kind_dir.name
                        histograms[topk_name][kind_name] = {}
                        for temp_dir in sorted([p for p in kind_dir.iterdir() if p.is_dir()]):
                            temp_name = temp_dir.name

                            qs: List[int] = []
                            ext: Optional[str] = None
                            for f in temp_dir.iterdir():
                                if not f.is_file():
                                    continue
                                if f.suffix.lower() not in HIST_EXTS:
                                    continue
                                m = Q_RE.match(f.name)
                                if not m:
                                    continue
                                q = int(m.group(1))
                                qs.append(q)
                                # Keep the most common ext; if mixed, first wins.
                                if ext is None:
                                    ext = f.suffix.lower().lstrip(".")

                            if qs:
                                histograms[topk_name][kind_name][temp_name] = {
                                    "min_q": int(min(qs)),
                                    "max_q": int(max(qs)),
                                    "ext": ext or "png",
                                }

            # Only include agg if it has something useful
            if plots or files or histograms:
                aggs.append(
                    {
                        "id": agg_dir.name,
                        "label": agg_dir.name,
                        "base_path": base_path,
                        "plots": plots,
                        "files": files,
                        "histograms": histograms,
                    }
                )

        if aggs:
            manifest["models"].append(
                {
                    "id": model_dir.name,
                    "label": model_dir.name,
                    "aggs": aggs,
                }
            )

    out_path = docs_dir / "manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2, sort_keys=False), encoding="utf-8")
    print(f"Wrote {out_path} with {len(manifest['models'])} models")


if __name__ == "__main__":
    main()
