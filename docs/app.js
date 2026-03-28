/* Fermi Model Analytics Dashboard
 *
 * Loads docs/manifest.json (analytics) and docs/data/manifest.json (raw data).
 * Raw data files are fetched on demand from a configurable external URL
 * (GitHub Releases by default).
 */

const MANIFEST_URL = 'manifest.json';
const DATA_MANIFEST_URL = 'data/manifest.json';

const el = (id) => document.getElementById(id);

/* ── Helpers ────────────────────────────────────────────── */

function setStatus(target, msg, isError = false) {
  const s = typeof target === 'string' ? el(target) : target;
  if (!s) return;
  s.textContent = msg;
  s.style.color = isError ? '#ff8a8a' : '';
}

function basename(path) {
  return path.split('/').pop();
}

function prettyName(file) {
  return file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getPlotType(file) {
  const name = file.replace(/\.[^.]+$/, '');
  if (name.startsWith('overall_')) return 'overall';
  if (name.startsWith('global_')) return 'global';
  if (name.startsWith('acc_vs_temp_')) return 'accuracy vs temperature';
  if (name.startsWith('legend_')) return 'legend';
  return 'other';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else { field += c; }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

async function safeFetchText(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/* ── Enhanced Table Rendering ──────────────────────────── */

function renderTable(container, csvText, opts = {}) {
  const {
    maxRows = 100,
    searchText = '',
    page = 0,
    sortCol = -1,
    sortAsc = true,
    onSort = null,
    paginationEl = null,
  } = opts;

  if (!csvText || !csvText.trim()) {
    container.innerHTML = '<div class="muted" style="padding:8px 10px">(empty)</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return { totalRows: 0, totalPages: 0 };
  }

  let rows = parseCsv(csvText);
  if (!rows.length) {
    container.innerHTML = '<div class="muted" style="padding:8px 10px">(no rows)</div>';
    if (paginationEl) paginationEl.innerHTML = '';
    return { totalRows: 0, totalPages: 0 };
  }

  const head = rows[0];
  let body = rows.slice(1);

  // Search filter
  if (searchText.trim()) {
    const q = searchText.toLowerCase();
    body = body.filter(r => r.some(cell => String(cell).toLowerCase().includes(q)));
  }

  // Sort
  if (sortCol >= 0 && sortCol < head.length) {
    body.sort((a, b) => {
      let va = a[sortCol] ?? '';
      let vb = b[sortCol] ?? '';
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return sortAsc ? na - nb : nb - na;
      }
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  const totalRows = body.length;
  const pageSize = maxRows > 0 ? maxRows : totalRows;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const pageRows = body.slice(start, start + pageSize);

  let html = '<table><thead><tr>';
  for (let i = 0; i < head.length; i++) {
    const arrow = sortCol === i ? (sortAsc ? ' &#9650;' : ' &#9660;') : '';
    html += `<th class="sortable" data-col="${i}">${escapeHtml(head[i])}${arrow}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const r of pageRows) {
    html += '<tr>';
    for (let i = 0; i < head.length; i++) {
      html += `<td>${escapeHtml(r[i] ?? '')}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  if (totalRows > pageSize) {
    html += `<div class="muted table-footer">Showing ${start + 1}–${Math.min(start + pageSize, totalRows)} of ${totalRows} rows</div>`;
  }

  container.innerHTML = html;

  // Wire up sortable headers
  if (onSort) {
    container.querySelectorAll('th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col);
        onSort(col);
      });
    });
  }

  // Render pagination
  if (paginationEl && totalPages > 1) {
    let pHtml = '';
    pHtml += `<button class="pg-btn" data-page="${currentPage - 1}" ${currentPage === 0 ? 'disabled' : ''}>&#9664;</button>`;
    pHtml += `<span class="pg-info">${currentPage + 1} / ${totalPages}</span>`;
    pHtml += `<button class="pg-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>&#9654;</button>`;
    paginationEl.innerHTML = pHtml;
  } else if (paginationEl) {
    paginationEl.innerHTML = '';
  }

  return { totalRows, totalPages, currentPage };
}

/* ── Tab System ────────────────────────────────────────── */

function initTabs() {
  const tabs = document.querySelectorAll('#mainTabs .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = el(tab.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ── Manifest Data ─────────────────────────────────────── */

let manifest = null;
let dataManifest = null;

/* ── Analytics Tab ─────────────────────────────────────── */

function getSelectedModel() {
  return (manifest?.models || []).find(m => m.id === el('modelSelect').value) || null;
}

function getSelectedAgg(model) {
  if (!model) return null;
  return (model.aggs || []).find(a => a.id === el('aggSelect').value) || null;
}

function populateSelectors() {
  const modelSel = el('modelSelect');
  const aggSel = el('aggSelect');
  const prevModel = modelSel.value;
  const prevAgg = aggSel.value;

  modelSel.innerHTML = '';
  aggSel.innerHTML = '';

  const models = manifest?.models || [];
  if (!models.length) return;

  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label || m.id;
    modelSel.appendChild(opt);
  }
  modelSel.value = models.some(m => m.id === prevModel) ? prevModel : models[0].id;

  function rebuildAggs() {
    const model = getSelectedModel();
    aggSel.innerHTML = '';
    for (const a of (model?.aggs || [])) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.label || a.id;
      aggSel.appendChild(opt);
    }
    const aggs = model?.aggs || [];
    if (aggs.length) aggSel.value = aggs.some(a => a.id === prevAgg) ? prevAgg : aggs[0].id;
  }

  rebuildAggs();
  modelSel.onchange = async () => { rebuildAggs(); await refreshAnalytics(); };
  aggSel.onchange = () => refreshAnalytics();
}

function renderSelectionSummary(model, agg) {
  const wrap = el('selectionSummary');
  if (!model || !agg) { wrap.innerHTML = '<span class="muted">No run selected.</span>'; return; }
  const plotCount = (agg.plots || []).length;
  const fileCount = Object.keys(agg.files || {}).length;
  const topkCount = Object.keys(agg.histograms || {}).length;
  wrap.innerHTML = `
    <span class="pill"><strong>Model:</strong> ${escapeHtml(model.label || model.id)}</span>
    <span class="pill"><strong>Run:</strong> ${escapeHtml(agg.label || agg.id)}</span>
    <span class="pill">${plotCount} plot${plotCount !== 1 ? 's' : ''}</span>
    <span class="pill">${fileCount} file${fileCount !== 1 ? 's' : ''}</span>
    <span class="pill">${topkCount} histogram group${topkCount !== 1 ? 's' : ''}</span>
  `;
}

function renderDownloads(agg) {
  const wrap = el('downloads');
  wrap.innerHTML = '';
  if (!agg?.files || !Object.keys(agg.files).length) {
    wrap.innerHTML = '<span class="muted">No files found.</span>';
    return;
  }
  for (const k of Object.keys(agg.files).sort()) {
    const a = document.createElement('a');
    a.href = agg.files[k];
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.className = 'chip';
    a.textContent = k;
    wrap.appendChild(a);
  }
}

function refreshPlotTypeOptions(agg, selectEl) {
  const plots = (agg?.plots || []).slice();
  const types = [...new Set(plots.map(p => getPlotType(basename(p))))].sort();
  const current = selectEl.value;
  selectEl.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'all types';
  selectEl.appendChild(allOpt);
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    selectEl.appendChild(opt);
  }
  selectEl.value = types.includes(current) ? current : 'all';
}

function renderPlots(agg, galleryEl, selectEl, emptyEl) {
  galleryEl.innerHTML = '';
  if (emptyEl) emptyEl.textContent = '';
  const selectedType = selectEl?.value || 'all';
  const plots = (agg?.plots || []).filter(p => selectedType === 'all' || getPlotType(basename(p)) === selectedType);
  if (!plots.length) {
    if (emptyEl) emptyEl.textContent = 'No matching plots.';
    return;
  }
  for (const p of plots) {
    const div = document.createElement('div');
    div.className = 'thumb';
    const link = document.createElement('a');
    link.href = p; link.target = '_blank'; link.rel = 'noreferrer';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = p; img.alt = basename(p);
    link.appendChild(img);
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = prettyName(basename(p));
    div.appendChild(link);
    div.appendChild(cap);
    galleryEl.appendChild(div);
  }
}

async function renderMetrics(agg) {
  el('metricsOverall').innerHTML = '';
  el('metricsGlobal').innerHTML = '';
  el('methodRankings').textContent = '';
  el('runConfig').textContent = '';
  if (!agg) return;

  const [overallTxt, globalTxt, rankTxt, confTxt] = await Promise.all([
    agg.files?.['metrics_overall.csv'] ? safeFetchText(agg.files['metrics_overall.csv']) : null,
    agg.files?.['metrics_global.csv'] ? safeFetchText(agg.files['metrics_global.csv']) : null,
    agg.files?.['method_rankings.txt'] ? safeFetchText(agg.files['method_rankings.txt']) : null,
    agg.files?.['run_config.json'] ? safeFetchText(agg.files['run_config.json']) : null,
  ]);

  if (overallTxt) renderTable(el('metricsOverall'), overallTxt);
  else el('metricsOverall').innerHTML = '<div class="muted">(missing)</div>';

  if (globalTxt) renderTable(el('metricsGlobal'), globalTxt);
  else el('metricsGlobal').innerHTML = '<div class="muted">(missing)</div>';

  el('methodRankings').textContent = rankTxt ?? '(missing)';
  el('runConfig').textContent = confTxt ?? '(missing)';
}

async function refreshAnalytics() {
  const model = getSelectedModel();
  const agg = getSelectedAgg(model);
  if (!model || !agg) return;

  renderSelectionSummary(model, agg);
  refreshPlotTypeOptions(agg, el('plotTypeSelect'));
  renderPlots(agg, el('plots'), el('plotTypeSelect'), el('plotsEmpty'));
  renderDownloads(agg);
  await renderMetrics(agg);
}

/* ── Compare Tab ───────────────────────────────────────── */

function populateCompareSelectors() {
  const models = manifest?.models || [];
  for (const selId of ['cmpModelA', 'cmpModelB']) {
    const sel = el(selId);
    sel.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      sel.appendChild(opt);
    }
    if (models.length >= 2 && selId === 'cmpModelB') sel.value = models[1].id;
  }

  function rebuildAggFor(modelSelId, aggSelId) {
    const modelId = el(modelSelId).value;
    const model = models.find(m => m.id === modelId);
    const aggSel = el(aggSelId);
    aggSel.innerHTML = '';
    for (const a of (model?.aggs || [])) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.label || a.id;
      aggSel.appendChild(opt);
    }
  }

  rebuildAggFor('cmpModelA', 'cmpAggA');
  rebuildAggFor('cmpModelB', 'cmpAggB');

  el('cmpModelA').onchange = () => rebuildAggFor('cmpModelA', 'cmpAggA');
  el('cmpModelB').onchange = () => rebuildAggFor('cmpModelB', 'cmpAggB');
}

async function runComparison() {
  const models = manifest?.models || [];
  const modelA = models.find(m => m.id === el('cmpModelA').value);
  const modelB = models.find(m => m.id === el('cmpModelB').value);
  const aggA = (modelA?.aggs || []).find(a => a.id === el('cmpAggA').value);
  const aggB = (modelB?.aggs || []).find(a => a.id === el('cmpAggB').value);

  el('cmpLabelA').textContent = `${modelA?.id || '?'} / ${aggA?.id || '?'}`;
  el('cmpLabelB').textContent = `${modelB?.id || '?'} / ${aggB?.id || '?'}`;

  const [oA, oB, gA, gB] = await Promise.all([
    aggA?.files?.['metrics_overall.csv'] ? safeFetchText(aggA.files['metrics_overall.csv']) : null,
    aggB?.files?.['metrics_overall.csv'] ? safeFetchText(aggB.files['metrics_overall.csv']) : null,
    aggA?.files?.['metrics_global.csv'] ? safeFetchText(aggA.files['metrics_global.csv']) : null,
    aggB?.files?.['metrics_global.csv'] ? safeFetchText(aggB.files['metrics_global.csv']) : null,
  ]);

  renderTable(el('cmpOverallA'), oA || '');
  renderTable(el('cmpOverallB'), oB || '');
  renderTable(el('cmpGlobalA'), gA || '');
  renderTable(el('cmpGlobalB'), gB || '');

  // Plots comparison
  const allTypes = new Set();
  for (const p of [...(aggA?.plots || []), ...(aggB?.plots || [])]) allTypes.add(getPlotType(basename(p)));
  refreshPlotTypeOptions(aggA, el('cmpPlotType'));
  // add types from B that A might not have
  const cmpSel = el('cmpPlotType');
  for (const t of allTypes) {
    if (![...cmpSel.options].some(o => o.value === t)) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      cmpSel.appendChild(opt);
    }
  }

  function renderCmpPlots() {
    renderPlots(aggA, el('cmpPlotsA'), el('cmpPlotType'));
    renderPlots(aggB, el('cmpPlotsB'), el('cmpPlotType'));
  }
  renderCmpPlots();
  cmpSel.onchange = renderCmpPlots;
}

/* ── Raw Data Explorer Tab ─────────────────────────────── */

let rawState = { csvText: null, sortCol: -1, sortAsc: true, page: 0 };

function populateRawDataSelectors() {
  const sel = el('rawModelSelect');
  sel.innerHTML = '';
  const datasets = dataManifest?.raw_datasets || [];
  if (!datasets.length) {
    sel.innerHTML = '<option value="">(no raw data available)</option>';
    setStatus('rawDataStatus', 'No raw datasets found. Run: python tools/build_data_manifest.py');
    return;
  }
  for (const d of datasets) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.label || d.model;
    sel.appendChild(opt);
  }
  renderRawFileTree();
}

function renderRawFileTree() {
  const tree = el('rawFileTree');
  tree.innerHTML = '';
  const datasets = dataManifest?.raw_datasets || [];
  const dataset = datasets.find(d => d.id === el('rawModelSelect').value);
  if (!dataset || !dataset.files.length) {
    tree.innerHTML = '<div class="muted">(no files)</div>';
    return;
  }

  // Build a tree structure from flat paths
  const root = {};
  for (const f of dataset.files) {
    const parts = f.key.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = f;
  }

  // Flatten to render (just group by first subfolder level)
  const folders = {};
  for (const f of dataset.files) {
    const parts = f.key.split('/');
    // skip model prefix (e.g. "7B/")
    const subParts = parts.slice(1);
    const folder = subParts.length > 1 ? subParts.slice(0, -1).join('/') : '(root)';
    if (!folders[folder]) folders[folder] = [];
    folders[folder].push(f);
  }

  for (const [folder, files] of Object.entries(folders).sort((a, b) => a[0].localeCompare(b[0]))) {
    const groupEl = document.createElement('div');
    groupEl.className = 'file-group';
    const label = document.createElement('div');
    label.className = 'file-group-label';
    label.textContent = folder;
    label.addEventListener('click', () => groupEl.classList.toggle('collapsed'));
    groupEl.appendChild(label);

    for (const f of files) {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `<span class="file-icon">${f.type === 'json' ? '{}' : f.type === 'csv' ? ',' : '&para;'}</span>
        <span class="file-name">${escapeHtml(basename(f.key))}</span>
        <span class="file-size muted">${formatBytes(f.size_bytes)}</span>`;
      item.addEventListener('click', () => loadRawFile(f));
      groupEl.appendChild(item);
    }
    tree.appendChild(groupEl);
  }
}

async function loadRawFile(fileEntry) {
  const baseUrl = dataManifest?.release_base_url;
  if (!baseUrl) {
    setStatus('rawDataStatus', 'No release_base_url in data manifest', true);
    return;
  }

  el('rawFileName').textContent = fileEntry.key;
  el('rawFileSize').textContent = formatBytes(fileEntry.size_bytes);
  el('rawDownloadBtn').style.display = 'inline-flex';
  el('rawDownloadBtn').onclick = () => {
    window.open(`${baseUrl}/${fileEntry.release_asset}`, '_blank');
  };

  setStatus('rawDataStatus', `Loading ${basename(fileEntry.key)}...`);

  const url = `${baseUrl}/${fileEntry.release_asset}`;
  const text = await safeFetchText(url);

  if (!text) {
    setStatus('rawDataStatus', `Failed to load: ${fileEntry.release_asset}. File may not be uploaded to the release yet.`, true);
    el('rawPreview').innerHTML = '<div class="muted" style="padding:10px">Could not fetch file. Make sure it has been uploaded to the GitHub Release.</div>';
    el('rawPreview').style.display = 'block';
    el('rawJsonPreview').style.display = 'none';
    el('rawTableControls').style.display = 'none';
    return;
  }

  setStatus('rawDataStatus', `Loaded ${basename(fileEntry.key)}`);

  if (fileEntry.type === 'json') {
    el('rawPreview').style.display = 'none';
    el('rawJsonPreview').style.display = 'block';
    el('rawTableControls').style.display = 'none';
    try {
      el('rawJsonPreview').textContent = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      el('rawJsonPreview').textContent = text;
    }
  } else {
    el('rawPreview').style.display = 'block';
    el('rawJsonPreview').style.display = 'none';
    el('rawTableControls').style.display = 'flex';
    rawState = { csvText: text, sortCol: -1, sortAsc: true, page: 0 };
    renderRawTable();
  }
}

function renderRawTable() {
  if (!rawState.csvText) return;
  const pageSize = parseInt(el('rawPageSize').value) || 0;
  const search = el('rawSearch').value;

  const result = renderTable(el('rawPreview'), rawState.csvText, {
    maxRows: pageSize,
    searchText: search,
    page: rawState.page,
    sortCol: rawState.sortCol,
    sortAsc: rawState.sortAsc,
    paginationEl: el('rawPagination'),
    onSort: (col) => {
      if (rawState.sortCol === col) rawState.sortAsc = !rawState.sortAsc;
      else { rawState.sortCol = col; rawState.sortAsc = true; }
      rawState.page = 0;
      renderRawTable();
    },
  });

  // Wire pagination buttons
  el('rawPagination').querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      rawState.page = parseInt(btn.dataset.page);
      renderRawTable();
    });
  });
}

/* ── LLN Dataset Tab ───────────────────────────────────── */

let llnState = { csvText: null, sortCol: -1, sortAsc: true, page: 0 };

function populateLlnSelectors() {
  const datasetSel = el('llnDatasetSelect');
  const fileSel = el('llnFileSelect');
  datasetSel.innerHTML = '';
  fileSel.innerHTML = '';

  const datasets = dataManifest?.datasets || [];
  if (!datasets.length) {
    datasetSel.innerHTML = '<option value="">(no datasets)</option>';
    return;
  }

  // Deduplicate by id
  const seen = new Set();
  const unique = datasets.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });

  for (const d of unique) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.label || d.id;
    datasetSel.appendChild(opt);
  }

  function rebuildFiles() {
    const dataset = unique.find(d => d.id === datasetSel.value);
    fileSel.innerHTML = '';
    for (const f of (dataset?.files || [])) {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = f.label || basename(f.path);
      fileSel.appendChild(opt);
    }
    loadLlnFile();
  }

  datasetSel.value = unique[0].id;
  rebuildFiles();
  datasetSel.onchange = rebuildFiles;
  fileSel.onchange = loadLlnFile;
}

async function loadLlnFile() {
  const meta = el('llnMeta');
  const preview = el('llnPreview');
  const path = el('llnFileSelect').value;
  if (!path) { meta.textContent = 'Select a file'; preview.innerHTML = ''; return; }

  meta.textContent = `Loading ${basename(path)}...`;
  const text = await safeFetchText(path);
  if (!text) {
    meta.textContent = `Could not load ${path}`;
    preview.innerHTML = '';
    return;
  }

  meta.textContent = `${basename(path)}`;
  llnState = { csvText: text, sortCol: -1, sortAsc: true, page: 0 };
  renderLlnTable();
}

function renderLlnTable() {
  if (!llnState.csvText) return;
  const pageSize = parseInt(el('llnPageSize').value) || 0;
  const search = el('llnSearch').value;

  renderTable(el('llnPreview'), llnState.csvText, {
    maxRows: pageSize,
    searchText: search,
    page: llnState.page,
    sortCol: llnState.sortCol,
    sortAsc: llnState.sortAsc,
    paginationEl: el('llnPagination'),
    onSort: (col) => {
      if (llnState.sortCol === col) llnState.sortAsc = !llnState.sortAsc;
      else { llnState.sortCol = col; llnState.sortAsc = true; }
      llnState.page = 0;
      renderLlnTable();
    },
  });

  el('llnPagination').querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      llnState.page = parseInt(btn.dataset.page);
      renderLlnTable();
    });
  });
}

/* ── Histogram Tab ─────────────────────────────────────── */

let histState = { topk: null, kind: null, temp: null, q: 0, minQ: 0, maxQ: 0, ext: 'png' };

function _setOptions(selectEl, items, placeholder = '(none)') {
  selectEl.innerHTML = '';
  if (!items.length) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder;
    selectEl.appendChild(opt);
    return;
  }
  for (const it of items) {
    const opt = document.createElement('option');
    opt.value = it; opt.textContent = it;
    selectEl.appendChild(opt);
  }
}

function populateHistModelSelectors() {
  const models = manifest?.models || [];
  const sel = el('histModel');
  sel.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.label || m.id;
    sel.appendChild(opt);
  }
  rebuildHistAggs();
}

function rebuildHistAggs() {
  const models = manifest?.models || [];
  const model = models.find(m => m.id === el('histModel').value);
  const aggSel = el('histAgg');
  aggSel.innerHTML = '';
  for (const a of (model?.aggs || [])) {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.label || a.id;
    aggSel.appendChild(opt);
  }
  refreshHistogramControls();
}

function getHistAgg() {
  const models = manifest?.models || [];
  const model = models.find(m => m.id === el('histModel').value);
  return (model?.aggs || []).find(a => a.id === el('histAgg').value) || null;
}

function refreshHistogramControls() {
  const agg = getHistAgg();
  const hist = agg?.histograms || {};
  const topks = Object.keys(hist).sort();
  _setOptions(el('histTopk'), topks, '(no histograms)');
  histState.topk = topks[0] || null;
  el('histTopk').value = histState.topk || '';

  const kinds = histState.topk ? Object.keys(hist[histState.topk] || {}).sort() : [];
  _setOptions(el('histKind'), kinds);
  histState.kind = kinds[0] || null;
  el('histKind').value = histState.kind || '';

  const temps = (histState.topk && histState.kind)
    ? Object.keys((hist[histState.topk] || {})[histState.kind] || {}).sort() : [];
  _setOptions(el('histTemp'), temps);
  histState.temp = temps[0] || null;
  el('histTemp').value = histState.temp || '';

  syncHistogramRange(agg);
  updateHistogramImage(agg);
}

function syncHistogramRange(agg) {
  const hist = agg?.histograms || {};
  const info = (histState.topk && histState.kind && histState.temp)
    ? (((hist[histState.topk] || {})[histState.kind] || {})[histState.temp] || null) : null;

  if (!info) { histState.minQ = 0; histState.maxQ = 0; histState.ext = 'png'; return; }

  histState.minQ = Number(info.min_q ?? 0);
  histState.maxQ = Number(info.max_q ?? 0);
  histState.ext = info.ext || 'png';

  const qEl = el('histQ');
  let q = Number(qEl.value || 0);
  if (isNaN(q)) q = histState.minQ;
  q = Math.max(histState.minQ, Math.min(histState.maxQ, q));
  qEl.value = String(q);
  histState.q = q;

  el('histRange').textContent = info ? `q range: ${histState.minQ}..${histState.maxQ}` : '';
}

function updateHistogramImage(agg) {
  const empty = el('histEmpty');
  const img = el('histImg');
  const link = el('histLink');
  empty.textContent = '';

  if (!agg || !histState.topk || !histState.kind || !histState.temp) {
    img.style.display = 'none'; link.href = '#';
    empty.textContent = 'No histograms available.';
    return;
  }

  const q = Number(el('histQ').value || 0);
  histState.q = q;
  const path = `${agg.base_path}/histograms/${histState.topk}/${histState.kind}/${histState.temp}/q_${q}.${histState.ext}`;
  img.style.display = 'block';
  img.src = path; img.alt = `q_${q}.${histState.ext}`;
  link.href = path;
  img.onerror = () => { img.style.display = 'none'; empty.textContent = `Missing image: q_${q}.${histState.ext}`; };
}

function hookHistogramEvents() {
  el('histModel').addEventListener('change', rebuildHistAggs);
  el('histAgg').addEventListener('change', refreshHistogramControls);

  el('histTopk').addEventListener('change', () => {
    const agg = getHistAgg();
    histState.topk = el('histTopk').value;
    const hist = agg?.histograms || {};
    const kinds = histState.topk ? Object.keys(hist[histState.topk] || {}).sort() : [];
    _setOptions(el('histKind'), kinds);
    histState.kind = kinds[0] || null;
    el('histKind').value = histState.kind || '';
    const temps = (histState.topk && histState.kind)
      ? Object.keys((hist[histState.topk] || {})[histState.kind] || {}).sort() : [];
    _setOptions(el('histTemp'), temps);
    histState.temp = temps[0] || null;
    el('histTemp').value = histState.temp || '';
    syncHistogramRange(agg); updateHistogramImage(agg);
  });

  el('histKind').addEventListener('change', () => {
    const agg = getHistAgg();
    histState.kind = el('histKind').value;
    const hist = agg?.histograms || {};
    const temps = (histState.topk && histState.kind)
      ? Object.keys((hist[histState.topk] || {})[histState.kind] || {}).sort() : [];
    _setOptions(el('histTemp'), temps);
    histState.temp = temps[0] || null;
    el('histTemp').value = histState.temp || '';
    syncHistogramRange(agg); updateHistogramImage(agg);
  });

  el('histTemp').addEventListener('change', () => {
    const agg = getHistAgg();
    histState.temp = el('histTemp').value;
    syncHistogramRange(agg); updateHistogramImage(agg);
  });

  el('histQ').addEventListener('change', () => {
    const agg = getHistAgg();
    syncHistogramRange(agg); updateHistogramImage(agg);
  });

  el('prevQ').addEventListener('click', () => {
    const qEl = el('histQ');
    qEl.value = String(Math.max(histState.minQ, Number(qEl.value || 0) - 1));
    updateHistogramImage(getHistAgg());
  });

  el('nextQ').addEventListener('click', () => {
    const qEl = el('histQ');
    qEl.value = String(Math.min(histState.maxQ, Number(qEl.value || 0) + 1));
    updateHistogramImage(getHistAgg());
  });
}

/* ── Init ──────────────────────────────────────────────── */

async function loadManifest() {
  try {
    const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    manifest = await r.json();
    const ts = manifest.generated_at ? new Date(manifest.generated_at).toLocaleString() : '';
    el('manifestMeta').textContent = ts ? `manifest: ${ts}` : '';
  } catch (e) {
    console.error(e);
    manifest = { models: [] };
  }

  populateSelectors();
  populateCompareSelectors();
  populateHistModelSelectors();
  await refreshAnalytics();
}

async function loadDataManifest() {
  try {
    const r = await fetch(DATA_MANIFEST_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    dataManifest = await r.json();
  } catch {
    dataManifest = { datasets: [], raw_datasets: [] };
  }

  populateLlnSelectors();
  populateRawDataSelectors();
}

initTabs();

// Wire up raw data controls
el('rawModelSelect').addEventListener('change', renderRawFileTree);
el('rawSearch').addEventListener('input', () => { rawState.page = 0; renderRawTable(); });
el('rawPageSize').addEventListener('change', () => { rawState.page = 0; renderRawTable(); });

// Wire up LLN controls
el('llnSearch').addEventListener('input', () => { llnState.page = 0; renderLlnTable(); });
el('llnPageSize').addEventListener('change', () => { llnState.page = 0; renderLlnTable(); });

// Wire up plot type filter
el('plotTypeSelect').addEventListener('change', () => {
  const model = getSelectedModel();
  const agg = getSelectedAgg(model);
  renderPlots(agg, el('plots'), el('plotTypeSelect'), el('plotsEmpty'));
});

// Wire up compare
el('cmpBtn').addEventListener('click', runComparison);

// Wire up reload
el('reloadBtn').addEventListener('click', async () => {
  await Promise.all([loadManifest(), loadDataManifest()]);
});

hookHistogramEvents();
loadManifest();
loadDataManifest();
