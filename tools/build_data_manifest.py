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

The manifest records every file with its relative path, size, type, and
GitHub Release asset_id so the dashboard can fetch files via the GitHub API
(which supports CORS, unlike direct release download URLs).

Usage:
    python tools/build_data_manifest.py [--data-dir Data] [--release-tag data-v1]

After uploading files to a release, run with --fetch-asset-ids to automatically
look up each asset's ID via the GitHub API (requires `gh` CLI):

    python tools/build_data_manifest.py --release-tag data-v1 --fetch-asset-ids
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional


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
            asset_name = full_key.replace("/", "--")
            entries.append({
                "key": full_key,
                "asset_name": asset_name,
                "size_bytes": fpath.stat().st_size,
                "type": fpath.suffix.lower().lstrip("."),
            })
    return entries


def fetch_release_assets(tag: str) -> Dict[str, int]:
    """Use `gh` CLI to fetch asset name -> asset_id mapping for a release."""
    try:
        result = subprocess.run(
            ["gh", "release", "view", tag, "-R", REPO, "--json", "assets"],
            capture_output=True, text=True, check=True,
        )
        data = json.loads(result.stdout)
        return {a["name"]: a["id"] for a in data.get("assets", [])}
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Warning: could not fetch release assets: {e}")
        return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build data manifest for the dashboard")
    parser.add_argument("--data-dir", default="Data",
                        help="Path to local Data directory (default: Data)")
    parser.add_argument("--release-tag", default="data-v1",
                        help="GitHub Release tag (default: data-v1)")
    parser.add_argument("--fetch-asset-ids", action="store_true",
                        help="Look up asset IDs from the release via gh CLI")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    data_dir = Path(args.data_dir)
    if not data_dir.is_absolute():
        data_dir = repo_root / data_dir

    docs_data = repo_root / "docs" / "data"
    docs_data.mkdir(parents=True, exist_ok=True)

    # Optionally fetch asset IDs from existing release
    asset_ids: Dict[str, int] = {}
    if args.fetch_asset_ids:
        print(f"Fetching asset IDs from release '{args.release_tag}'...")
        asset_ids = fetch_release_assets(args.release_tag)
        print(f"  Found {len(asset_ids)} assets in release")

    # ----- scan model data folders -----
    model_datasets = []
    if data_dir.exists():
        for model_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
            model_name = model_dir.name
            files = scan_dir(model_dir, prefix=model_name)
            # Attach asset_ids if available
            for f in files:
                aid = asset_ids.get(f["asset_name"])
                if aid:
                    f["asset_id"] = aid
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
                "path": f"data/{fpath.name}",
            })

    # ----- assemble manifest -----
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo": REPO,
        "release_tag": args.release_tag,
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

    total_files = sum(len(d["files"]) for d in model_datasets)
    with_ids = sum(1 for d in model_datasets for f in d["files"] if "asset_id" in f)
    print(f"Total raw files: {total_files} ({with_ids} with asset_id)")

    if total_files and not with_ids:
        print(f"\n{'='*60}")
        print("NEXT STEPS:")
        print(f"{'='*60}")
        print(f"1. Upload files to the release:")
        print(f"   python tools/upload_data_release.py --data-dir {args.data_dir} --tag {args.release_tag}")
        print(f"2. Re-run this script with --fetch-asset-ids to get asset IDs:")
        print(f"   python tools/build_data_manifest.py --release-tag {args.release_tag} --fetch-asset-ids")
        print(f"3. Commit and push docs/data/manifest.json")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
