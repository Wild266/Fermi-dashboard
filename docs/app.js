/*
  LLN Dashboard (static)
  - Reads docs/data/manifest.json (optional)
  - Loads a CSV (responses.csv or responses_labeled.csv)
  - Shows a few summary stats + plots + a small data preview

  No build step. Designed for GitHub Pages.
*/

const MANIFEST_URL = "data/manifest.json";
const PREVIEW_LIMIT = 200;

let manifest = null;
let currentCsvText = null;
let currentCsvName = "data.csv";

let fullRows = [];          // normalized rows
let filteredRows = [];      // after filters
let availableColumns = [];  // columns in current file

let labelCol = null;        // chosen prediction column (k_labeler / k_regex / k_auto / k_human ...)
let truthCol = null;        // true_k if present

// ------------------------ DOM helpers ------------------------

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, kind = "info") {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.borderColor = kind === "error" ? "#a33" : "var(--border)";
}

function show(id, yes) {
  const el = $(id);
  if (!el) return;
  el.style.display = yes ? "" : "none";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delayMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delayMs);
  };
}

// ------------------------ manifest ------------------------

async function loadManifest() {
  try {
    const r = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    manifest = j;

    if (manifest && manifest.title) {
      const titleEl = $("pageTitle");
      if (titleEl) titleEl.textContent = manifest.title;
      document.title = manifest.title;
    }

    populateDatasetSelect();
    setStatus("Loaded manifest.json. Pick a dataset + file, then click Load.");
  } catch (e) {
    manifest = null;
    populateDatasetSelect();
    setStatus(
      "No manifest found (docs/data/manifest.json). You can still upload a CSV using the file picker.",
      "info"
    );
  }
}

function populateDatasetSelect() {
  const dsSel = $("datasetSelect");
  const fileSel = $("fileSelect");
  if (!dsSel || !fileSel) return;

  dsSel.innerHTML = "";
  fileSel.innerHTML = "";

  if (!manifest || !Array.isArray(manifest.datasets) || manifest.datasets.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no manifest / no datasets)";
    dsSel.appendChild(opt);

    const opt2 = document.createElement("option");
    opt2.value = "";
    opt2.textContent = "(upload CSV instead)";
    fileSel.appendChild(opt2);

    dsSel.disabled = true;
    fileSel.disabled = true;
    return;
  }

  dsSel.disabled = false;
  fileSel.disabled = false;

  manifest.datasets.forEach((ds, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = ds.label || ds.id || `dataset_${i}`;
    dsSel.appendChild(opt);
  });

  dsSel.addEventListener("change", () => {
    populateFileSelect(Number(dsSel.value));
  });

  populateFileSelect(0);
}

function populateFileSelect(datasetIndex) {
  const dsSel = $("datasetSelect");
  const fileSel = $("fileSelect");
  if (!dsSel || !fileSel) return;

  fileSel.innerHTML = "";

  const ds = manifest.datasets[datasetIndex];
  const files = (ds && Array.isArray(ds.files)) ? ds.files : [];

  if (files.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no files in this dataset)";
    fileSel.appendChild(opt);
    return;
  }

  files.forEach((f, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    const label = f.label || f.path || `file_${i}`;
    opt.textContent = label;
    fileSel.appendChild(opt);
  });
}

function getSelectedManifestPath() {
  if (!manifest || !Array.isArray(manifest.datasets)) return null;
  const dsSel = $("datasetSelect");
  const fileSel = $("fileSelect");
  if (!dsSel || !fileSel) return null;

  const dsIdx = Number(dsSel.value);
  const fIdx = Number(fileSel.value);
  const ds = manifest.datasets[dsIdx];
  if (!ds || !Array.isArray(ds.files) || !ds.files[fIdx]) return null;

  return ds.files[fIdx].path || null;
}

// ------------------------ CSV loading + normalization ------------------------

function parseCsvText(csvText) {
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        if (results.errors && results.errors.length) {
          // Many CSVs still parse fine with minor errors; we warn but continue.
          console.warn("PapaParse errors", results.errors);
        }
        resolve({
          rows: results.data || [],
          fields: (results.meta && results.meta.fields) ? results.meta.fields : [],
        });
      },
      error: (err) => reject(err),
    });
  });
}

function toNumberOrNull(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;
  // Treat literal "none" / "NA" etc as null
  if (s.toLowerCase() === "none" || s.toLowerCase() === "na" || s.toLowerCase() === "nan") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeRows(rows) {
  // Convert a few known numeric columns to numbers (where possible).
  // Keep everything else as strings.
  const numericCols = new Set([
    "row_id",
    "q_index",
    "sample_id",
    "sample_id_orig",
    "attempt_id",
    "n_attempts_total",
    "temperature",
    "true_k",
    "k_auto",
    "k_human",
    "k_regex",
    "k_labeler",
  ]);

  return rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (numericCols.has(k)) {
        out[k] = toNumberOrNull(v);
      } else {
        // keep as string, but normalize null-ish
        if (v === null || v === undefined) out[k] = "";
        else out[k] = String(v);
      }
    }
    return out;
  });
}

function pickLabelColumn(fields, rows) {
  const candidates = [
    "k_labeler",
    "k_regex",
    "k_auto",
    "k_human",
    "k_auto_extracted",
  ];
  for (const c of candidates) {
    if (!fields.includes(c)) continue;
    // ensure it has at least one numeric
    let ok = false;
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i][c];
      if (typeof v === "number" && Number.isFinite(v)) { ok = true; break; }
    }
    if (ok) return c;
  }
  return null;
}

function hasNumericColumn(fields, rows, col) {
  if (!fields.includes(col)) return false;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][col];
    if (typeof v === "number" && Number.isFinite(v)) return true;
  }
  return false;
}

async function loadCsvFromUrl(path) {
  setStatus(`Fetching ${path} ...`);
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to fetch ${path} (HTTP ${r.status})`);
  const txt = await r.text();
  currentCsvText = txt;
  currentCsvName = path.split("/").slice(-1)[0] || "data.csv";
  await loadCsvText(txt);
}

async function loadCsvText(csvText) {
  setStatus("Parsing CSV ...");
  const parsed = await parseCsvText(csvText);
  const rows = normalizeRows(parsed.rows);

  fullRows = rows;
  availableColumns = parsed.fields || Object.keys(rows[0] || {});

  labelCol = pickLabelColumn(availableColumns, fullRows);
  truthCol = hasNumericColumn(availableColumns, fullRows, "true_k") ? "true_k" : null;

  // Update UI sections
  show("summary", true);
  show("filters", true);
  show("plots", true);
  show("preview", true);

  // Setup filters
  setupModelFilter(fullRows);

  // Reset question filter
  const qf = $("filterInput");
  if (qf) qf.value = "";

  // Download link
  updateDownloadLink();

  // Render everything
  applyFilters();
  setStatus(`Loaded ${fullRows.length.toLocaleString()} rows (${currentCsvName}).`);
}

// ------------------------ filters ------------------------

function uniqueValues(rows, col) {
  const s = new Set();
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    const vs = String(v).trim();
    if (!vs) continue;
    s.add(vs);
  }
  return Array.from(s);
}

function setupModelFilter(rows) {
  const wrap = $("modelFilter");
  if (!wrap) return;

  wrap.innerHTML = "";

  const kinds = uniqueValues(rows, "model_kind");
  const kindsSorted = kinds.sort();

  if (kindsSorted.length === 0) {
    wrap.innerHTML = `<span class="muted">(no model_kind column)</span>`;
    return;
  }

  for (const k of kindsSorted) {
    const id = `mk_${k.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const label = document.createElement("label");
    label.setAttribute("for", id);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.value = k;
    cb.checked = true;
    cb.addEventListener("change", () => applyFilters());

    const span = document.createElement("span");
    span.textContent = k;

    label.appendChild(cb);
    label.appendChild(span);
    wrap.appendChild(label);
  }
}

function getActiveModelKinds() {
  const wrap = $("modelFilter");
  if (!wrap) return null;
  const cbs = wrap.querySelectorAll("input[type=checkbox]");
  if (!cbs || cbs.length === 0) return null;

  const active = [];
  cbs.forEach((cb) => {
    if (cb.checked) active.push(cb.value);
  });
  return active;
}

const applyFilters = debounce(() => {
  if (!Array.isArray(fullRows) || fullRows.length === 0) return;

  const activeKinds = getActiveModelKinds();
  const qSub = ($("filterInput") && $("filterInput").value) ? $("filterInput").value.trim().toLowerCase() : "";

  filteredRows = fullRows.filter((r) => {
    if (activeKinds && activeKinds.length) {
      const mk = (r.model_kind ?? "").toString();
      if (mk && !activeKinds.includes(mk)) return false;
    }
    if (qSub) {
      const q = (r.question ?? "").toString().toLowerCase();
      if (!q.includes(qSub)) return false;
    }
    return true;
  });

  updateSummary(filteredRows);
  updatePlots(filteredRows);
  renderPreviewTable(filteredRows);
}, 120);

// ------------------------ summary ------------------------

function updateSummary(rows) {
  const el = $("summary");
  if (!el) return;

  const total = rows.length;
  const qIdxPresent = availableColumns.includes("q_index");
  const uniqueQ = qIdxPresent ? new Set(rows.map(r => r.q_index).filter(v => typeof v === "number" && Number.isFinite(v))).size : null;

  const kinds = uniqueValues(rows, "model_kind");

  // label/truth availability
  const haveLabel = !!labelCol;
  const haveTruth = !!truthCol;

  let nLabel = 0;
  if (haveLabel) {
    for (const r of rows) {
      const v = r[labelCol];
      if (typeof v === "number" && Number.isFinite(v)) nLabel++;
    }
  }

  let nTruth = 0;
  if (haveTruth) {
    for (const r of rows) {
      const v = r[truthCol];
      if (typeof v === "number" && Number.isFinite(v)) nTruth++;
    }
  }

  const byKind = {};
  for (const r of rows) {
    const k = (r.model_kind ?? "(missing)").toString() || "(missing)";
    byKind[k] = (byKind[k] || 0) + 1;
  }

  const parts = [];
  parts.push(`<div class="muted">File: <code>${escapeHtml(currentCsvName)}</code></div>`);
  parts.push(`<div style="margin-top:8px;">` +
    `<strong>${total.toLocaleString()}</strong> rows` +
    (uniqueQ !== null ? ` • <strong>${uniqueQ.toLocaleString()}</strong> unique questions (q_index)` : "") +
    `</div>`);

  parts.push(`<div class="muted" style="margin-top:8px;">` +
    `Columns: ${availableColumns.length} • ` +
    `Label column: <code>${haveLabel ? escapeHtml(labelCol) : "(none found)"}</code>` +
    ` • Truth column: <code>${haveTruth ? escapeHtml(truthCol) : "(missing)"}</code>` +
    `</div>`);

  if (haveLabel) {
    parts.push(`<div class="muted">Rows with label: ${nLabel.toLocaleString()} / ${total.toLocaleString()}</div>`);
  }
  if (haveTruth) {
    parts.push(`<div class="muted">Rows with true_k: ${nTruth.toLocaleString()} / ${total.toLocaleString()}</div>`);
  }

  const kindLines = Object.entries(byKind)
    .sort((a,b) => b[1]-a[1])
    .map(([k, v]) => `<code>${escapeHtml(k)}</code>: ${v.toLocaleString()}`)
    .join(" • ");
  parts.push(`<div style="margin-top:10px;">${kindLines}</div>`);

  el.innerHTML = parts.join("\n");

  const plotKTitle = $("plotKTitle");
  if (plotKTitle) {
    plotKTitle.textContent = haveLabel ? `${labelCol} distribution` : "k distribution";
  }
}

// ------------------------ plotting ------------------------

function countByValue(rows, col) {
  const map = new Map();
  for (const r of rows) {
    const v = r[col];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const key = v;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const xs = Array.from(map.keys()).sort((a,b) => a-b);
  const ys = xs.map(x => map.get(x));
  return { xs, ys };
}

function updatePlots(rows) {
  // k distribution
  if (!labelCol) {
    Plotly.purge("plotK");
    Plotly.newPlot("plotK", [], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      annotations: [{
        text: "No numeric k column found (k_labeler/k_regex/k_auto/k_human).",
        x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false,
        font: { color: "#a0a4b0" }
      }]
    }, { displayModeBar: false });
  } else {
    const { xs, ys } = countByValue(rows, labelCol);
    Plotly.newPlot("plotK", [{
      x: xs,
      y: ys,
      type: "bar",
      hovertemplate: "k=%{x}<br>count=%{y}<extra></extra>",
    }], {
      margin: { t: 10, r: 10, b: 40, l: 50 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: { title: labelCol },
      yaxis: { title: "count" },
      font: { color: "#e8e8ea" },
    }, { displayModeBar: false });
  }

  // accuracy by model kind
  const accNote = $("plotAccNote");
  const errNote = $("plotErrNote");

  if (!labelCol || !truthCol) {
    Plotly.purge("plotAcc");
    Plotly.newPlot("plotAcc", [], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      annotations: [{
        text: "Accuracy needs both a label column and true_k.",
        x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false,
        font: { color: "#a0a4b0" }
      }]
    }, { displayModeBar: false });

    Plotly.purge("plotErr");
    Plotly.newPlot("plotErr", [], {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      annotations: [{
        text: "Error plot needs both a label column and true_k.",
        x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false,
        font: { color: "#a0a4b0" }
      }]
    }, { displayModeBar: false });

    if (accNote) accNote.textContent = "";
    if (errNote) errNote.textContent = "";
    return;
  }

  // Compute acc per model_kind
  const byKind = new Map();
  for (const r of rows) {
    const mk = (r.model_kind ?? "(missing)").toString() || "(missing)";
    const pred = r[labelCol];
    const truth = r[truthCol];
    if (typeof pred !== "number" || !Number.isFinite(pred)) continue;
    if (typeof truth !== "number" || !Number.isFinite(truth)) continue;

    if (!byKind.has(mk)) byKind.set(mk, { correct: 0, total: 0 });
    const obj = byKind.get(mk);
    obj.total += 1;
    if (pred === truth) obj.correct += 1;
  }

  const kinds = Array.from(byKind.keys()).sort();
  const acc = kinds.map(k => {
    const o = byKind.get(k);
    return o.total ? o.correct / o.total : 0;
  });
  const n = kinds.map(k => byKind.get(k).total);

  Plotly.newPlot("plotAcc", [{
    x: kinds,
    y: acc,
    type: "bar",
    hovertemplate: "%{x}<br>accuracy=%{y:.3f}<br>n=%{customdata}<extra></extra>",
    customdata: n,
  }], {
    margin: { t: 10, r: 10, b: 80, l: 50 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    yaxis: { title: "accuracy", range: [0, 1] },
    xaxis: { tickangle: -25 },
    font: { color: "#e8e8ea" },
  }, { displayModeBar: false });

  if (accNote) {
    const total = n.reduce((a,b) => a+b, 0);
    accNote.textContent = total ? `Accuracy computed on ${total.toLocaleString()} rows with both ${labelCol} and true_k.` : "";
  }

  // Error distribution
  const errMap = new Map();
  let errN = 0;
  for (const r of rows) {
    const pred = r[labelCol];
    const truth = r[truthCol];
    if (typeof pred !== "number" || !Number.isFinite(pred)) continue;
    if (typeof truth !== "number" || !Number.isFinite(truth)) continue;
    const d = pred - truth;
    errMap.set(d, (errMap.get(d) || 0) + 1);
    errN += 1;
  }

  const dx = Array.from(errMap.keys()).sort((a,b) => a-b);
  const dy = dx.map(k => errMap.get(k));

  Plotly.newPlot("plotErr", [{
    x: dx,
    y: dy,
    type: "bar",
    hovertemplate: "Δ=%{x}<br>count=%{y}<extra></extra>",
  }], {
    margin: { t: 10, r: 10, b: 40, l: 50 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    xaxis: { title: `${labelCol} - true_k` },
    yaxis: { title: "count" },
    font: { color: "#e8e8ea" },
  }, { displayModeBar: false });

  if (errNote) {
    errNote.textContent = errN ? `Error computed on ${errN.toLocaleString()} rows with both ${labelCol} and true_k.` : "";
  }
}

// ------------------------ preview table ------------------------

function shorten(s, n = 140) {
  const t = (s ?? "").toString();
  if (t.length <= n) return t;
  return t.slice(0, n) + "…";
}

function renderPreviewTable(rows) {
  const wrap = $("tableWrap");
  if (!wrap) return;

  const take = rows.slice(0, PREVIEW_LIMIT);

  // columns: a small, useful subset
  const colsPreferred = [
    "q_index",
    "model_kind",
    "temperature",
    "sample_id",
    "attempt_id",
    "n_attempts_total",
    "true_k",
  ];
  if (labelCol) colsPreferred.push(labelCol);
  if (availableColumns.includes("k_labeler_source")) colsPreferred.push("k_labeler_source");
  colsPreferred.push("question");
  colsPreferred.push("raw_response");

  // keep only columns that exist
  const cols = colsPreferred.filter((c, i) => colsPreferred.indexOf(c) === i && availableColumns.includes(c));

  if (take.length === 0) {
    wrap.innerHTML = `<div class="muted">No rows match the current filters.</div>`;
    return;
  }

  const th = cols.map(c => `<th>${escapeHtml(c)}</th>`).join("");

  const body = take.map((r) => {
    const tds = cols.map((c) => {
      const v = r[c];
      if (c === "question" || c === "raw_response") {
        const full = (v ?? "").toString();
        const prev = shorten(full, c === "question" ? 160 : 220);
        return `<td class="details"><details><summary>${escapeHtml(prev || "(empty)")}</summary><pre>${escapeHtml(full)}</pre></details></td>`;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        return `<td>${escapeHtml(v)}</td>`;
      }
      return `<td>${escapeHtml(v ?? "")}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("\n");

  wrap.innerHTML = `
    <table>
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function updateDownloadLink() {
  const a = $("downloadLink");
  if (!a) return;

  if (!currentCsvText) {
    a.href = "#";
    a.download = "data.csv";
    return;
  }

  const blob = new Blob([currentCsvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = currentCsvName || "data.csv";
}

// ------------------------ wire up UI ------------------------

function wireUi() {
  const loadBtn = $("loadBtn");
  if (loadBtn) {
    loadBtn.addEventListener("click", async () => {
      try {
        const path = getSelectedManifestPath();
        if (!path) {
          setStatus("No file selected (or no manifest). Upload a CSV instead.", "error");
          return;
        }
        await loadCsvFromUrl(path);
      } catch (e) {
        console.error(e);
        setStatus(String(e), "error");
      }
    });
  }

  const fileInput = $("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try {
        setStatus(`Reading ${file.name} ...`);
        const txt = await file.text();
        currentCsvText = txt;
        currentCsvName = file.name;
        await loadCsvText(txt);
      } catch (e) {
        console.error(e);
        setStatus(String(e), "error");
      }
    });
  }

  const filterInput = $("filterInput");
  if (filterInput) {
    filterInput.addEventListener("input", () => applyFilters());
  }

  const previewCount = $("previewCount");
  if (previewCount) previewCount.textContent = String(PREVIEW_LIMIT);
}

// ------------------------ init ------------------------

(async function init() {
  wireUi();
  await loadManifest();
})();
