# Simple GitHub Pages Dashboard (LLN / Fermi outputs)

This is a **static** dashboard you can host on **GitHub Pages**.

It can load:
- `responses.csv` (from `fermi_collect_vllm_multi_bt*.py`)
- `responses_labeled.csv` (from `label_k_vllm*.py`)

…and show a few basic plots + a small data preview.

## Quick start

1) Copy the `docs/` folder into your repo.

2) Put your CSVs under `docs/data/`.

Example layout (recommended):

```
docs/
  index.html
  app.js
  style.css
  data/
    manifest.json
    topk_none/
      temp_0_1/
        responses_labeled.csv
      temp_0_4/
        responses_labeled.csv
      temp_0_7/
        responses_labeled.csv
    topk_40/
      temp_0_1/
        responses_labeled.csv
      ...
```

3) Edit `docs/data/manifest.json` to point at your real files.

4) Commit + push.

5) In GitHub:
- **Settings → Pages**
- Source: **Deploy from a branch**
- Branch: `main` (or your branch) / Folder: **`/docs`**

Then open the Pages URL.

## Notes

- If you don’t want to commit big CSVs, you can still use the dashboard by uploading a CSV in the browser.
- The dashboard auto-detects a label column in this order:
  `k_labeler`, `k_regex`, `k_auto`, `k_human`.
- Accuracy + error plots require both a label column and `true_k`.
