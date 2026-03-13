# Simple GitHub Pages dashboard (multi-model)

This is a **static** dashboard designed for **GitHub Pages**.

It lets you select:
- **Model** (e.g., `7B`, `14B`, `32B`)
- **Run** (e.g., `agg_v2`, `agg_weighted`)

…and view:
- all images in `plots/` as a thumbnail gallery
- quick previews of `metrics_overall.csv` and `metrics_global.csv`
- `method_rankings.txt` and `run_config.json`
- a histogram viewer for `histograms/<topk>/<kind>/<temp>/q_<n>.png`

## Expected folder layout

Put each model’s analytics folder under `docs/models/<MODEL>/<RUN>/`.

Example:

```
docs/
  index.html
  app.js
  style.css
  manifest.json
  models/
    7B/
      agg_v2/
        histograms/
        plots/
        metrics_global.csv
        metrics_overall.csv
        ...
      agg_weighted/
        ...
    14B/
      agg_v2/
        ...
    32B/
      agg_v2/
        ...
```

### Where your existing folders go

If you currently have a folder like:

```
agg_v2/
  histograms/
  plots/
  metrics_global.csv
  ...
```

Copy it into (for 7B):

```
docs/models/7B/agg_v2/
```

Do the same for 14B and 32B when you have them.

## Build / update the manifest

The dashboard is static, so it uses a manifest file (`docs/manifest.json`) listing what exists.

After copying data:

```bash
python tools/build_manifest.py
```

Commit + push.

## Enable GitHub Pages

- Repo **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main` (or your branch)
- Folder: `/docs`

Then open your Pages URL.
