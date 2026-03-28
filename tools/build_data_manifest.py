#!/usr/bin/env python3
"""Scans a local Data/ directory and builds docs/data/manifest.json.

Expected layout (flexible — any nesting of CSV/JSON files is supported):

  Data/
    7B/
      some_folder/file.csv
      another.json
    14B/
      ...
    32B/
      ...

Also includes the LLN_Dataset.csv already in docs/data/.

The manifest records every file with its relative path, size, and type so the
dashboard can display a file tree and lazy‑load individual files on demand from
a configurable external host (e.g. GitHub Releases).

Usage:
    python tools/build_data_manifest.py [--data-dir Data] [--release-tag data-v1]
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List


SUPPORTED_EXTS = {".csv", ".json", ".txt", ".tsv"}

REPO = "Wild266/Fermi-dashboard"


def scan_dir(root: Path, prefix: str = "") -> List[Dict]:
    """Recursively scan *root* and return a list of file entries."""
    entries: List[Dict] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fname in sorted(filenames):
            fpath = Path(dirpath) / fname
            if fpath.suffix.lower() not in SUPPORTED_EXTS:
                continue
            rel = fpath.relative_to(root).as_posix()
            full_key = f"{prefix}/{rel}" if prefix else rel
            entries.append({
                "key": full_key,               # display / lookup key
                "release_asset": full_key.replace("/", "--"),  # flat name in GH Release
                "size_bytes": fpath.stat().st_size,
                "type": fpath.suffix.lower().lstrip("."),
            })
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description="Build data manifest for the dashboard")
    parser.add_argument("--data-dir", default="Data",
                        help="Path to local Data directory (default: Data)")
    parser.add_argument("--release-tag", default="data-v1",
                        help="GitHub Release tag to use for download URLs (default: data-v1)")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    data_dir = Path(args.data_dir)
    if not data_dir.is_absolute():
        data_dir = repo_root / data_dir

    docs_data = repo_root / "docs" / "data"
    docs_data.mkdir(parents=True, exist_ok=True)

    release_base = f"https://github.com/{REPO}/releases/download/{args.release_tag}"

    # ----- scan model data folders -----
    model_datasets = []
    if data_dir.exists():
        for model_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
            model_name = model_dir.name
            files = scan_dir(model_dir, prefix=model_name)
            if files:
                model_datasets.append({
                    "id": f"raw_{model_name.lower()}",
                    "label": f"{model_name} Raw Data",
                    "model": model_name,
                    "files": files,
                })
        print(f"Scanned {data_dir}: found {len(model_datasets)} model dataset(s)")
    else:
        print(f"Warning: {data_dir} not found — skipping raw data scan")

    # ----- include docs/data files (LLN dataset etc.) -----
    builtin_files = []
    for fpath in sorted(docs_data.iterdir()):
        if fpath.is_file() and fpath.suffix.lower() in SUPPORTED_EXTS and fpath.name != "manifest.json":
            builtin_files.append({
                "label": fpath.name,
                "path": f"data/{fpath.name}",  # relative to docs/
            })

    # ----- assemble manifest -----
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release_base_url": release_base,
        "title": "Fermi Dashboard Data",
        "datasets": [
            {
                "id": "lln_dataset",
                "label": "LLN Dataset CSV",
                "files": builtin_files,
            }
        ],
        "raw_datasets": model_datasets,
    }

    out = docs_data / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {out}")
    print(f"\nRelease base URL: {release_base}")
    print(f"Total raw files: {sum(len(d['files']) for d in model_datasets)}")

    # ----- print upload instructions -----
    total_files = sum(len(d["files"]) for d in model_datasets)
    if total_files:
        print(f"\n{'='*60}")
        print("NEXT STEPS — Upload files to GitHub Releases:")
        print(f"{'='*60}")
        print(f"1. Create a release with tag: {args.release_tag}")
        print(f"   gh release create {args.release_tag} --title 'Raw Data' --notes 'Model data files'")
        print(f"2. Upload files (use the helper script):")
        print(f"   python tools/upload_data_release.py --data-dir {args.data_dir} --tag {args.release_tag}")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
