#!/usr/bin/env python3
"""Upload files from a local Data/ directory to a GitHub Release.

Requires the `gh` CLI to be installed and authenticated.

Usage:
    python tools/upload_data_release.py --data-dir Data --tag data-v1

This will:
  1. Create the release if it doesn't exist.
  2. Upload each CSV/JSON/TXT/TSV file as a release asset with a flat name
     (slashes replaced with --), e.g. 7B/results/output.csv -> 7B--results--output.csv
  3. Skip files that are already uploaded (by name match).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SUPPORTED_EXTS = {".csv", ".json", ".txt", ".tsv"}
REPO = "Wild266/Fermi-dashboard"


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload data files to a GitHub Release")
    parser.add_argument("--data-dir", default="Data",
                        help="Path to local Data directory (default: Data)")
    parser.add_argument("--tag", default="data-v1",
                        help="Release tag (default: data-v1)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be uploaded without uploading")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    data_dir = Path(args.data_dir)
    if not data_dir.is_absolute():
        data_dir = repo_root / data_dir

    if not data_dir.exists():
        print(f"Error: {data_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    # Collect files
    files_to_upload: list[tuple[str, Path]] = []
    for dirpath, dirnames, filenames in os.walk(data_dir):
        dirnames.sort()
        for fname in sorted(filenames):
            fpath = Path(dirpath) / fname
            if fpath.suffix.lower() not in SUPPORTED_EXTS:
                continue
            rel = fpath.relative_to(data_dir).as_posix()
            asset_name = rel.replace("/", "--")
            files_to_upload.append((asset_name, fpath))

    if not files_to_upload:
        print("No supported files found to upload.")
        sys.exit(0)

    print(f"Found {len(files_to_upload)} files to upload")
    total_size = sum(f.stat().st_size for _, f in files_to_upload)
    print(f"Total size: {total_size / 1024 / 1024:.1f} MB")

    if args.dry_run:
        print("\nDry run — files that would be uploaded:")
        for asset_name, fpath in files_to_upload:
            size = fpath.stat().st_size
            print(f"  {asset_name}  ({size / 1024:.1f} KB)")
        return

    # Ensure release exists
    print(f"\nEnsuring release '{args.tag}' exists...")
    result = run(["gh", "release", "view", args.tag, "-R", REPO], check=False)
    if result.returncode != 0:
        print(f"Creating release '{args.tag}'...")
        run(["gh", "release", "create", args.tag,
             "-R", REPO,
             "--title", f"Raw Data ({args.tag})",
             "--notes", "Model raw data files for the Fermi Dashboard.\nThese are loaded on-demand by the dashboard."])

    # Get existing assets
    result = run(["gh", "release", "view", args.tag, "-R", REPO, "--json", "assets"], check=False)
    existing_assets = set()
    if result.returncode == 0:
        try:
            assets = json.loads(result.stdout).get("assets", [])
            existing_assets = {a["name"] for a in assets}
        except (json.JSONDecodeError, KeyError):
            pass

    # Upload files — gh uses the local filename as the asset name,
    # so we create a temp symlink/copy with the prefixed name.
    uploaded = 0
    skipped = 0
    failed = 0
    tmpdir = tempfile.mkdtemp(prefix="fermi_upload_")

    try:
        for asset_name, fpath in files_to_upload:
            if asset_name in existing_assets:
                print(f"  SKIP (exists): {asset_name}")
                skipped += 1
                continue

            size_kb = fpath.stat().st_size / 1024
            print(f"  Uploading: {asset_name} ({size_kb:.1f} KB)")

            # Create a symlink (or copy on Windows) with the target name
            link_path = Path(tmpdir) / asset_name
            try:
                os.symlink(fpath.resolve(), link_path)
            except OSError:
                shutil.copy2(fpath, link_path)

            result = run([
                "gh", "release", "upload", args.tag,
                str(link_path),
                "--clobber",
                "-R", REPO,
            ], check=False)

            # Clean up the temp link
            link_path.unlink(missing_ok=True)

            if result.returncode == 0:
                uploaded += 1
            else:
                print(f"    FAILED: {result.stderr.strip()}")
                failed += 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print(f"\nDone: {uploaded} uploaded, {skipped} skipped, {failed} failed")
    print(f"Release URL: https://github.com/{REPO}/releases/tag/{args.tag}")


if __name__ == "__main__":
    main()
