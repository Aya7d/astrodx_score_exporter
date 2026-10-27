/**
 * AstroDX Score Exporter, DXRating Converter & Device Migrator
 * Application Entry Point & Module Orchestrator
 */

import { decodeCacheFile, encodeCacheFile, parseAstroDXJson, stringifyAstroDXJson } from './modules/codec.js';
import { extractRecords, sanitizeTitle } from './modules/extractor.js';
import {
  exportDXRatingJSON,
  exportExcel,
  exportCSV,
  exportRawDecodedJSON,
  exportDecodedJSON,
  triggerDownload
} from './modules/exporters.js';
import { generatePCLinkAndQR } from './modules/cloud_share.js';
import { smartMergeScores, smartMergeCaches } from './modules/migrator.js';
import {
  showToast,
  markEditsActive,
  updateSummaryStats,
  renderScoreTable,
  updateConversionStatus
} from './modules/ui.js';
import {
  loadMaimaiDB,
  findOfficialSong,
  getMaimaiDB,
  convertToDXRating
} from './modules/converters.js';

// ============================================================================
// Application State
// ============================================================================
const state = {
  cacheData: null,             // In-memory decoded JSON object of the primary cache
  extractedRecords: [],        // Array of normalized score objects
  originalFilename: 'cache',   // Source filename
  hasUnsavedEdits: false,      // Flag for in-memory modifications
  activeTab: 'viewExtract',    // Active navigation tab
  filterDiff: 'all',           // Table difficulty filter
  filterType: 'all',           // Table type filter (all, dx, std)
  searchQuery: '',             // Table search term
  scannedCount: 0,
  
  // Conversion state
  conversionFormat: 'dxrating', // Target format profile (Default: Option 1 DXRating)
  serverRegion: 'all',          // Server region matching mode ('all', 'intl', or 'jp')

  // Migration state
  mergeOldData: null,          // Old cache data object
  mergeOldName: '',
  mergeNewData: null,          // New cache data object
  mergeNewName: '',
  mergeMode: 'cache',          // Selected merge output format: 'cache', 'dxrating', or 'decoded'
  lastMergeResult: null,       // Stored result of last merge operation for direct re-downloads
  repackData: null             // Repack JSON data
};

// ============================================================================
// File Ingestion Handler
// ============================================================================
async function handleCacheBuffer(arrayBuffer, filename = 'cache') {
  try {
    const decoded = decodeCacheFile(arrayBuffer);
    state.cacheData = decoded;
    state.originalFilename = filename;
    state.hasUnsavedEdits = false;
    document.getElementById('tableEditedIndicator').hidden = true;

    const cleanTitle = document.getElementById('cleanTitleCheckbox').checked;
    const { records, scannedChartsCount } = extractRecords(decoded, { cleanTitle });

    // Assign unique local IDs for table tracking
    records.forEach((r, idx) => { r._id = idx + 1; });
    state.extractedRecords = records;
    state.scannedCount = scannedChartsCount;

    // Show results
    document.getElementById('resultsSection').hidden = false;
    document.getElementById('pcTransferPanel').hidden = true;

    updateSummaryStats(records, scannedChartsCount);
    renderScoreTable(state, () => {});

    // Compute matching against official database
    await loadMaimaiDB();
    const db = getMaimaiDB();
    let matched = 0;
    records.forEach((r) => {
      if (findOfficialSong(r.rawTitle || r.title, db)) matched++;
    });
    updateConversionStatus(matched, records.length, state.serverRegion);

    showToast(`Successfully decoded "${filename}" (${records.length} scores)`, 'success');
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('Cache decode error:', err);
    showToast(err.message || 'Error decoding cache file', 'error');
  }
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================
function initApp() {
  // Pre-load official maimai DX song database in background
  loadMaimaiDB().catch((err) => console.warn('Maimai DB background preload error:', err));

  // 1. Navigation Tabs
  const tabBtnExtract = document.getElementById('tabBtnExtract');
  const tabBtnMigrate = document.getElementById('tabBtnMigrate');
  const viewExtract = document.getElementById('viewExtract');
  const viewMigrate = document.getElementById('viewMigrate');

  function switchTab(target) {
    if (target === 'viewExtract') {
      tabBtnExtract.classList.add('active');
      tabBtnMigrate.classList.remove('active');
      viewExtract.classList.add('active');
      viewMigrate.classList.remove('active');
    } else {
      tabBtnMigrate.classList.add('active');
      tabBtnExtract.classList.remove('active');
      viewMigrate.classList.add('active');
      viewExtract.classList.remove('active');
    }
    state.activeTab = target;
  }

  tabBtnExtract.addEventListener('click', () => switchTab('viewExtract'));
  tabBtnMigrate.addEventListener('click', () => switchTab('viewMigrate'));

  // 2. Cache Location Guide Collapsible
  const toggleGuideBtn = document.getElementById('toggleGuideBtn');
  const guidePanel = document.getElementById('guidePanel');
  const tabGuideIos = document.getElementById('tabGuideIos');
  const tabGuideAndroid = document.getElementById('tabGuideAndroid');
  const guideIos = document.getElementById('guideIos');
  const guideAndroid = document.getElementById('guideAndroid');

  toggleGuideBtn.addEventListener('click', () => {
    const isHidden = guidePanel.hidden;
    guidePanel.hidden = !isHidden;
    toggleGuideBtn.setAttribute('aria-expanded', String(isHidden));
  });

  tabGuideIos.addEventListener('click', () => {
    tabGuideIos.classList.add('active');
    tabGuideAndroid.classList.remove('active');
    guideIos.classList.add('active');
    guideAndroid.classList.remove('active');
  });

  tabGuideAndroid.addEventListener('click', () => {
    tabGuideAndroid.classList.add('active');
    tabGuideIos.classList.remove('active');
    guideAndroid.classList.add('active');
    guideIos.classList.remove('active');
  });

  // 3. Extract Dropzone & File Input
  const dropzone = document.getElementById('extractDropzone');
  const cacheFileInput = document.getElementById('cacheFileInput');
  const btnSelectFile = document.getElementById('btnSelectFile');

  // Prevent browser from navigating away if a user drops a file anywhere on the window
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
    }, false);
    document.addEventListener(type, (e) => {
      e.preventDefault();
    }, false);
  });

  btnSelectFile.addEventListener('click', (e) => {
    e.stopPropagation();
    cacheFileInput.click();
  });

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('.dropzone-actions') || e.target.closest('button')) return;
    cacheFileInput.click();
  });

  /**
   * Reusable robust dropzone and file input binder
   */
  function setupDropzone(dropzoneEl, inputEl, onBuffer) {
    let dragCounter = 0;

    dropzoneEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      dropzoneEl.classList.add('dragover');
    });

    dropzoneEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      dropzoneEl.classList.add('dragover');
    });

    dropzoneEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        dropzoneEl.classList.remove('dragover');
      }
    });

    dropzoneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      dropzoneEl.classList.remove('dragover');

      const file = e.dataTransfer?.files?.[0];
      if (file) {
        readFile(file);
      }
    });

    inputEl.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        readFile(file);
        inputEl.value = '';
      }
    });

    function readFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        onBuffer(e.target.result, file.name);
      };
      reader.onerror = () => showToast(`Failed to read "${file.name}"`, 'error');
      reader.readAsArrayBuffer(file);
    }
  }

  // Bind Main Extract Dropzone
  setupDropzone(dropzone, cacheFileInput, (buf, name) => {
    handleCacheBuffer(buf, name);
  });

  // Prefix sanitizer toggle
  const cleanTitleCheckbox = document.getElementById('cleanTitleCheckbox');
  cleanTitleCheckbox.addEventListener('change', () => {
    if (state.cacheData) {
      const cleanTitle = cleanTitleCheckbox.checked;
      const { records, scannedChartsCount } = extractRecords(state.cacheData, { cleanTitle });
      records.forEach((r, idx) => { r._id = idx + 1; });
      state.extractedRecords = records;
      updateSummaryStats(records, scannedChartsCount);
      renderScoreTable(state, () => {});
      showToast(`Titles updated (${cleanTitle ? 'prefixes cleaned' : 'raw titles'})`, 'info');
    }
  });

  // 4. Conversion Format & Region Controls
  const conversionFormatSelect = document.getElementById('conversionFormatSelect');
  const serverRegionSelect = document.getElementById('serverRegionSelect');
  if (conversionFormatSelect) {
    conversionFormatSelect.addEventListener('change', (e) => {
      state.conversionFormat = e.target.value;
      showToast(`Conversion target format set to: ${e.target.selectedOptions[0].text}`, 'info');
    });
  }
  if (serverRegionSelect) {
    serverRegionSelect.addEventListener('change', (e) => {
      state.serverRegion = e.target.value;
      if (state.extractedRecords.length > 0) {
        const db = getMaimaiDB();
        let matched = 0;
        state.extractedRecords.forEach((r) => {
          if (findOfficialSong(r.rawTitle || r.title, db)) matched++;
        });
        updateConversionStatus(matched, state.extractedRecords.length, state.serverRegion);
      }
      showToast(`Version / Server set to: ${e.target.selectedOptions[0].text}`, 'info');
    });
  }

  // 5. Exporters
  document.getElementById('btnExportDXRating').addEventListener('click', () => {
    exportDXRatingJSON(state.extractedRecords, showToast, { server: state.serverRegion });
  });

  document.getElementById('btnGeneratePCLink').addEventListener('click', () => {
    generatePCLinkAndQR(state.extractedRecords, showToast, { server: state.serverRegion });
  });

  document.getElementById('btnExportExcel').addEventListener('click', () => {
    exportExcel(state.extractedRecords, showToast);
  });

  document.getElementById('btnExportCSV').addEventListener('click', () => {
    exportCSV(state.extractedRecords, showToast);
  });

  document.getElementById('btnExportRawJSON').addEventListener('click', () => {
    exportRawDecodedJSON(state.extractedRecords, showToast);
  });

  const btnExportFullJSON = document.getElementById('btnExportFullJSON');
  if (btnExportFullJSON) {
    btnExportFullJSON.addEventListener('click', () => {
      if (!state.cacheData) {
        showToast('No cache data loaded to export', 'error');
        return;
      }
      const jsonStr = stringifyAstroDXJson(state.cacheData, 2);
      triggerDownload(jsonStr, 'astrodx_cache_full.json', 'application/json');
      showToast('Exported full AstroDX cache database (all metadata & chart hashes preserved)', 'success');
    });
  }

  // Copy PC Share Link
  document.getElementById('btnCopyShareUrl').addEventListener('click', () => {
    const input = document.getElementById('pcShareUrlInput');
    if (input.value) {
      navigator.clipboard.writeText(input.value).then(() => {
        showToast('Share link copied to clipboard!', 'success');
      }).catch(() => {
        input.select();
        document.execCommand('copy');
        showToast('Link copied to clipboard', 'success');
      });
    }
  });

  // 5. Table Search & Filters
  const searchInput = document.getElementById('scoreTableSearch');
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      renderScoreTable(state, () => {});
    }, 150);
  });

  // Difficulty Pills
  document.querySelectorAll('#diffFilters .pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#diffFilters .pill').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      state.filterDiff = btn.dataset.diff;
      renderScoreTable(state, () => {});
    });
  });

  // Type Pills
  document.querySelectorAll('#typeFilters .pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#typeFilters .pill').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      state.filterType = btn.dataset.type;
      renderScoreTable(state, () => {});
    });
  });

  // 6. Custom Score Modal
  const addScoreModal = document.getElementById('addScoreModal');
  const btnAddScoreModalBtn = document.getElementById('btnAddScoreModalBtn');
  const btnCloseAddScoreModal = document.getElementById('btnCloseAddScoreModal');
  const btnCancelAddScore = document.getElementById('btnCancelAddScore');
  const addScoreForm = document.getElementById('addScoreForm');

  btnAddScoreModalBtn.addEventListener('click', () => {
    addScoreModal.hidden = false;
    document.getElementById('modalSongTitle').focus();
  });

  [btnCloseAddScoreModal, btnCancelAddScore].forEach((b) => {
    b.addEventListener('click', () => { addScoreModal.hidden = true; });
  });

  addScoreForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('modalSongTitle').value.trim();
    const type = document.getElementById('modalSongType').value;
    const difficulty = document.getElementById('modalDifficulty').value;
    const achievementRate = parseFloat(document.getElementById('modalAchievement').value);

    if (!title || isNaN(achievementRate)) {
      showToast('Please provide valid title and achievement', 'error');
      return;
    }

    const cleanTitle = document.getElementById('cleanTitleCheckbox').checked ? sanitizeTitle(title) : title;
    const sheetId = `${cleanTitle}__dxrt__${type}__dxrt__${difficulty}`;

    const newRecord = {
      _id: Date.now(),
      sheetId,
      rawTitle: title,
      title: cleanTitle,
      type,
      difficulty,
      achievementRate: Math.round(Math.min(101.0, achievementRate) * 10000) / 10000
    };

    state.extractedRecords.unshift(newRecord);
    markEditsActive(state);
    renderScoreTable(state, () => {});
    updateSummaryStats(state.extractedRecords, (state.scannedCount || 0) + 1);

    addScoreModal.hidden = true;
    addScoreForm.reset();
    showToast(`Added custom score for "${cleanTitle}"`, 'success');
  });

  // ============================================================================
  // Tab 2: Migration & Repacker Listeners
  // ============================================================================
  const mergeOldDropzone = document.getElementById('mergeOldDropzone');
  const mergeNewDropzone = document.getElementById('mergeNewDropzone');
  const mergeOldInput = document.getElementById('mergeOldInput');
  const mergeNewInput = document.getElementById('mergeNewInput');
  const btnSelectOldCache = document.getElementById('btnSelectOldCache');
  const btnSelectNewCache = document.getElementById('btnSelectNewCache');
  const btnRunMerge = document.getElementById('btnRunMerge');
  const btnRunMergeText = document.getElementById('btnRunMergeText');

  // Format selection pills
  const pillModeCache = document.getElementById('pillModeCache');
  const pillModeDXRating = document.getElementById('pillModeDXRating');
  const pillModeDecoded = document.getElementById('pillModeDecoded');
  const modePills = [pillModeCache, pillModeDXRating, pillModeDecoded];

  function updateMergeMode(mode) {
    state.mergeMode = mode;
    modePills.forEach(pill => {
      if (pill) pill.classList.toggle('active', pill.dataset.mode === mode);
    });

    if (btnRunMergeText) {
      if (mode === 'cache') {
        btnRunMergeText.textContent = 'Smart Merge & Download Safe "cache" Binary';
      } else if (mode === 'dxrating') {
        btnRunMergeText.textContent = 'Smart Merge & Download DXRating JSON';
      } else if (mode === 'decoded') {
        btnRunMergeText.textContent = 'Smart Merge & Download Decoded JSON';
      }
    }
  }

  modePills.forEach(pill => {
    if (pill) {
      pill.addEventListener('click', () => {
        updateMergeMode(pill.dataset.mode);
      });
    }
  });

  btnSelectOldCache.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeOldInput.click();
  });
  btnSelectNewCache.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeNewInput.click();
  });

  function checkMergeReady() {
    btnRunMerge.disabled = !(state.mergeOldData && state.mergeNewData);
  }

  setupDropzone(mergeOldDropzone, mergeOldInput, (buf, name) => {
    try {
      state.mergeOldData = decodeCacheFile(buf);
      state.mergeOldName = name;
      const { records } = extractRecords(state.mergeOldData);
      const status = document.getElementById('mergeOldStatus');
      status.textContent = `✓ ${name} (${records.length} scores detected)`;
      status.className = 'file-loaded-status has-file';
      mergeOldDropzone.classList.add('loaded');
      checkMergeReady();
      showToast(`Old device file loaded (${records.length} charts found)`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to decode old device file', 'error');
    }
  });

  setupDropzone(mergeNewDropzone, mergeNewInput, (buf, name) => {
    try {
      state.mergeNewData = decodeCacheFile(buf);
      state.mergeNewName = name;
      const { records } = extractRecords(state.mergeNewData);
      const status = document.getElementById('mergeNewStatus');
      status.textContent = `✓ ${name} (${records.length} scores detected)`;
      status.className = 'file-loaded-status has-file';
      mergeNewDropzone.classList.add('loaded');
      checkMergeReady();
      showToast(`New device file loaded (${records.length} charts found)`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to decode new device file', 'error');
    }
  });

  // Render score comparison log table
  function renderMergeLogTable(scoreDeltas, filterTerm = '') {
    const tbody = document.getElementById('mergeLogTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const cleanFilter = filterTerm.trim().toLowerCase();
    const filtered = cleanFilter
      ? scoreDeltas.filter(d => d.title.toLowerCase().includes(cleanFilter) || d.difficulty.toLowerCase().includes(cleanFilter))
      : scoreDeltas;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No matching chart comparisons found</td></tr>';
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(d => {
      const tr = document.createElement('tr');

      const oldText = d.oldScore !== null ? `${d.oldScore.toFixed(4)}%` : '<span class="text-dim">-</span>';
      const newText = d.newScore !== null ? `${d.newScore.toFixed(4)}%` : '<span class="text-dim">-</span>';
      const mergedText = `<strong>${d.mergedScore.toFixed(4)}%</strong>`;

      let badgeHtml = '';
      if (d.status === 'updated_from_old') {
        badgeHtml = '<span class="status-badge-tag updated">🛡️ Preserved Old High</span>';
      } else if (d.status === 'kept_new_high') {
        badgeHtml = '<span class="status-badge-tag kept">⚡ Preserved New High</span>';
      } else if (d.status === 'equal') {
        badgeHtml = '<span class="status-badge-tag equal">✓ Identical High</span>';
      } else if (d.status === 'old_only') {
        badgeHtml = '<span class="status-badge-tag single">➕ Old Device Only</span>';
      } else {
        badgeHtml = '<span class="status-badge-tag single">➕ New Device Only</span>';
      }

      tr.innerHTML = `
        <td><strong>${d.title}</strong></td>
        <td><span class="diff-badge diff-${d.difficulty}">${d.difficulty.toUpperCase()}</span></td>
        <td>${oldText}</td>
        <td>${newText}</td>
        <td>${mergedText}</td>
        <td>${badgeHtml}</td>
      `;
      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
  }

  // Setup comparison log search filter
  const mergeLogSearch = document.getElementById('mergeLogSearch');
  if (mergeLogSearch) {
    mergeLogSearch.addEventListener('input', (e) => {
      if (state.lastMergeResult && state.lastMergeResult.stats) {
        renderMergeLogTable(state.lastMergeResult.stats.scoreDeltas, e.target.value);
      }
    });
  }

  // Direct download buttons in the summary banner
  const btnDownloadMergedCache = document.getElementById('btnDownloadMergedCache');
  const btnDownloadMergedDXRating = document.getElementById('btnDownloadMergedDXRating');
  const btnDownloadMergedDecoded = document.getElementById('btnDownloadMergedDecoded');

  if (btnDownloadMergedCache) {
    btnDownloadMergedCache.addEventListener('click', () => {
      if (!state.lastMergeResult) return;
      const blob = encodeCacheFile(state.lastMergeResult.mergedData, { format: 'deflate' });
      triggerDownload(blob, 'cache', 'application/octet-stream');
      showToast('Downloaded safe raw Deflate binary "cache" for AstroDX', 'success');
    });
  }

  if (btnDownloadMergedDXRating) {
    btnDownloadMergedDXRating.addEventListener('click', () => {
      if (!state.lastMergeResult) return;
      const jsonStr = JSON.stringify(state.lastMergeResult.mergedDXRating, null, 2);
      triggerDownload(jsonStr, 'dxrating_import.json', 'application/json');
      showToast(`Exported ${state.lastMergeResult.mergedDXRating.length} records to dxrating_import.json`, 'success');
    });
  }

  if (btnDownloadMergedDecoded) {
    btnDownloadMergedDecoded.addEventListener('click', () => {
      if (!state.lastMergeResult) return;
      exportDecodedJSON(state.lastMergeResult.mergedDecodedJson, showToast);
    });
  }

  btnRunMerge.addEventListener('click', () => {
    if (!state.mergeOldData || !state.mergeNewData) return;

    try {
      const result = smartMergeScores(state.mergeOldData, state.mergeNewData, { server: state.serverRegion });
      state.lastMergeResult = result;
      const { stats } = result;

      // Update report stats
      const reportBox = document.getElementById('mergeReportBox');
      document.getElementById('mergeMatchedCount').textContent = stats.matchedCount;
      document.getElementById('mergeUpdatedCount').textContent = stats.updatedFromOld;
      document.getElementById('mergeKeptCount').textContent = stats.keptNewHigh;
      document.getElementById('mergePreventedCount').textContent = stats.preventedDowngrades;
      document.getElementById('mergeTotalCount').textContent = stats.totalMerged;

      const badgeCount = document.getElementById('mergeLogCountBadge');
      if (badgeCount) badgeCount.textContent = `${stats.totalMerged} charts`;

      // Render table
      renderMergeLogTable(stats.scoreDeltas, '');
      reportBox.hidden = false;

      // Automatically download chosen merge format
      if (state.mergeMode === 'dxrating') {
        const jsonStr = JSON.stringify(result.mergedDXRating, null, 2);
        triggerDownload(jsonStr, 'dxrating_import.json', 'application/json');
        showToast(`Smart merge complete! Exported ${result.mergedDXRating.length} records to dxrating_import.json with zero downgrades.`, 'success');
      } else if (state.mergeMode === 'decoded') {
        exportDecodedJSON(result.mergedDecodedJson, showToast);
      } else {
        const blob = encodeCacheFile(result.mergedData, { format: 'deflate' });
        triggerDownload(blob, 'cache', 'application/octet-stream');
        showToast(`Smart merge complete! Overwrote lower scores with ${stats.updatedFromOld} high scores (Zero Downgrades).`, 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('Merge failed: ' + err.message, 'error');
    }
  });

  // 7. Repacker Mode
  const repackDropzone = document.getElementById('repackDropzone');
  const repackJsonInput = document.getElementById('repackJsonInput');
  const btnSelectRepackJson = document.getElementById('btnSelectRepackJson');
  const btnRunRepack = document.getElementById('btnRunRepack');

  btnSelectRepackJson.addEventListener('click', (e) => {
    e.stopPropagation();
    repackJsonInput.click();
  });

  setupDropzone(repackDropzone, repackJsonInput, (buf, name) => {
    try {
      const text = new TextDecoder('utf-8').decode(buf);
      const parsed = parseAstroDXJson(text);
      if (Array.isArray(parsed)) {
        state.repackData = null;
        repackDropzone.classList.remove('loaded');
        repackDropzone.querySelector('p').innerHTML = `⚠️ <strong>"${name}" is a summary list, not a full AstroDX cache database!</strong><br><small style="color:var(--text-muted)">AstroDX requires an object with <code>level_metadata</code> and chart hashes. Please use the Full Cache Database JSON or Smart Merge.</small>`;
        btnRunRepack.disabled = true;
        showToast('Cannot repack summary list. AstroDX requires a full cache database with level_metadata.', 'error');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || !parsed.level_metadata) {
        state.repackData = null;
        repackDropzone.classList.remove('loaded');
        repackDropzone.querySelector('p').textContent = `⚠️ Invalid format: Missing "level_metadata" in "${name}".`;
        btnRunRepack.disabled = true;
        showToast('Invalid AstroDX cache JSON: missing level_metadata', 'error');
        return;
      }
      state.repackData = parsed;
      const songCount = Object.keys(parsed.level_metadata).length;
      repackDropzone.classList.add('loaded');
      repackDropzone.querySelector('p').textContent = `✓ Valid AstroDX Cache Database: ${songCount} songs loaded from ${name}`;
      btnRunRepack.disabled = false;
      showToast(`Valid AstroDX cache loaded (${songCount} songs)`, 'success');
    } catch (err) {
      showToast('Invalid JSON file: ' + err.message, 'error');
    }
  });

  btnRunRepack.addEventListener('click', () => {
    if (!state.repackData) return;
    try {
      const blob = encodeCacheFile(state.repackData, { format: 'deflate' });
      triggerDownload(blob, 'cache', 'application/octet-stream');
      showToast('Compressed and downloaded AstroDX raw Deflate "cache" binary!', 'success');
    } catch (err) {
      showToast('Repack error: ' + err.message, 'error');
    }
  });

  // 8. PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('AstroDX Service Worker registered:', reg.scope);
      }).catch((err) => {
        console.log('Service Worker registration skipped:', err);
      });
    });
  }

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
