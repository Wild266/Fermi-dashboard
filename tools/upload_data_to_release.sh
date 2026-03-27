#!/usr/bin/env bash
#
# Upload large data files to a GitHub Release so they can be served
# to the dashboard without being committed to the repo.
#
# Prerequisites:
#   - gh CLI installed and authenticated (https://cli.github.com)
#   - Data files in a local folder (e.g., ./Data/7B/, ./Data/14B/, ./Data/32B/)
#
# Usage:
#   ./tools/upload_data_to_release.sh <DATA_DIR>
#
# Example:
#   ./tools/upload_data_to_release.sh ./Data
#
# This will:
#   1. Create a release tagged "data-v1" if it doesn't exist
#   2. Upload every .csv and .json file found under <DATA_DIR>
#   3. Print the download URLs for each uploaded file
#
# After uploading, update docs/data/manifest.json with the correct
# filenames and URLs.

set -euo pipefail

REPO="wild266/fermi-dashboard"
TAG="data-v1"
RELEASE_TITLE="Raw Data Files"
RELEASE_BODY="Large CSV/JSON datasets for the Fermi dashboard. These files are loaded on demand by the Raw Data Explorer tab."

DATA_DIR="${1:?Usage: $0 <DATA_DIR>}"

if ! command -v gh &> /dev/null; then
  echo "Error: 'gh' CLI is required. Install from https://cli.github.com"
  exit 1
fi

# Create the release if it doesn't exist yet
if ! gh release view "$TAG" --repo "$REPO" &> /dev/null; then
  echo "Creating release $TAG..."
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "$RELEASE_TITLE" \
    --notes "$RELEASE_BODY" \
    --latest=false
  echo "Release $TAG created."
else
  echo "Release $TAG already exists."
fi

# Find and upload all CSV and JSON files
echo ""
echo "Uploading files from $DATA_DIR..."
echo ""

find "$DATA_DIR" -type f \( -name "*.csv" -o -name "*.json" \) | sort | while read -r filepath; do
  filename=$(basename "$filepath")
  # Prefix with parent folder name for uniqueness (e.g., 7B_rawdata.csv)
  parent=$(basename "$(dirname "$filepath")")
  prefixed="${parent}_${filename}"

  echo "  Uploading: $filepath -> $prefixed"
  gh release upload "$TAG" "$filepath#$prefixed" --repo "$REPO" --clobber 2>/dev/null || \
    gh release upload "$TAG" "$filepath" --repo "$REPO" --clobber

  echo "  URL: https://github.com/$REPO/releases/download/$TAG/$prefixed"
  echo ""
done

echo "Done! Update docs/data/manifest.json with the URLs above."
echo ""
echo "Example manifest entry:"
echo '  {'
echo '    "model": "7B",'
echo '    "label": "7B - My Dataset",'
echo '    "filename": "7B_mydata.csv",'
echo '    "format": "csv",'
echo "    \"url\": \"https://github.com/$REPO/releases/download/$TAG/7B_mydata.csv\""
echo '  }'
