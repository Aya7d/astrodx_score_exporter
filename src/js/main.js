/**
 * AstroDX Score Exporter, DXRating Converter & Device Migrator
 * Application Entry Point & Module Orchestrator
 */

import { decodeCacheFile, encodeCacheFile } from './modules/codec.js';
import { extractRecords, sanitizeTitle } from './modules/extractor.js';
import {
  exportDXRatingJSON,
  exportExcel,
  exportCSV,
  exportRawDecodedJSON,
  triggerDownload
} from './modules/exporters.js';
import { generatePCLinkAndQR } from './modules/cloud_share.js';
import { smartMergeCaches } from './modules/migrator.js';
import { createDemoCacheData } from './modules/demo_data.js';
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
  const btnLoadDemo = document.getElementById('btnLoadDemo');

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

  // 1-Click Demo Loader
  btnLoadDemo.addEventListener('click', (e) => {
    e.stopPropagation();
    try {
      const demoData = createDemoCacheData();
      // Compress with encodeCacheFile first so it passes through the real Deflate decoder
      const blob = encodeCacheFile(demoData);
      blob.arrayBuffer().then((buf) => {
        handleCacheBuffer(buf, 'demo_cache');
        showToast('Loaded demo AstroDX cache dataset!', 'success');
      });
    } catch (err) {
      console.error(err);
      showToast('Demo generation failed', 'error');
    }
  });

  // 1-Click Real Sample Loader
  const btnLoadRealSample = document.getElementById('btnLoadRealSample');
  if (btnLoadRealSample) {
    btnLoadRealSample.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        showToast('Decrypting real AstroDX sample cache...', 'info');
        const resp = await fetch('./data/samples/cache');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        handleCacheBuffer(buf, 'cache (Real 341 Scores)');
      } catch (err) {
        console.error(err);
        showToast('Failed to load sample: ' + err.message, 'error');
      }
    });
  }

  // Auto-load sample if ?sample=true or ?sample=1 in URL
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('sample') === 'true' || urlParams.get('sample') === '1') {
    fetch('./data/samples/cache')
      .then((r) => r.ok ? r.arrayBuffer() : null)
      .then((buf) => {
        if (buf) handleCacheBuffer(buf, 'cache (Real 341 Scores)');
      })
      .catch((err) => console.log('Auto sample load skipped:', err));
  }

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
  const btnLoadMergeDemo = document.getElementById('btnLoadMergeDemo');

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
      const status = document.getElementById('mergeOldStatus');
      status.textContent = `✓ ${name} loaded`;
      status.className = 'file-loaded-status has-file';
      mergeOldDropzone.classList.add('loaded');
      checkMergeReady();
      showToast('Old cache loaded successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to decode old cache', 'error');
    }
  });

  setupDropzone(mergeNewDropzone, mergeNewInput, (buf, name) => {
    try {
      state.mergeNewData = decodeCacheFile(buf);
      state.mergeNewName = name;
      const status = document.getElementById('mergeNewStatus');
      status.textContent = `✓ ${name} loaded`;
      status.className = 'file-loaded-status has-file';
      mergeNewDropzone.classList.add('loaded');
      checkMergeReady();
      showToast('New cache loaded successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to decode new cache', 'error');
    }
  });

  btnLoadMergeDemo.addEventListener('click', () => {
    // Create old demo data with scores
    const oldDemo = createDemoCacheData();
    // Create new demo data with fresh paths and 0 scores
    const newDemo = JSON.parse(JSON.stringify(oldDemo));
    for (const k of Object.keys(newDemo.scores)) {
      for (const diff of Object.keys(newDemo.scores[k].scores)) {
        newDemo.scores[k].scores[diff].achievement = 0;
        if (newDemo.scores[k].scores[diff].combo) newDemo.scores[k].scores[diff].combo = 0;
      }
    }

    state.mergeOldData = oldDemo;
    state.mergeOldName = 'demo_old_cache';
    const statusOld = document.getElementById('mergeOldStatus');
    statusOld.textContent = '✓ demo_old_cache (with scores)';
    statusOld.className = 'file-loaded-status has-file';
    mergeOldDropzone.classList.add('loaded');

    state.mergeNewData = newDemo;
    state.mergeNewName = 'demo_new_target_cache';
    const statusNew = document.getElementById('mergeNewStatus');
    statusNew.textContent = '✓ demo_new_target_cache (fresh scans)';
    statusNew.className = 'file-loaded-status has-file';
    mergeNewDropzone.classList.add('loaded');

    checkMergeReady();
    showToast('Loaded demo migration pair!', 'success');
  });

  btnRunMerge.addEventListener('click', () => {
    if (!state.mergeOldData || !state.mergeNewData) return;

    try {
      const { mergedData, stats } = smartMergeCaches(state.mergeOldData, state.mergeNewData);
      
      // Show report
      const reportBox = document.getElementById('mergeReportBox');
      document.getElementById('mergeMatchedCount').textContent = stats.matchedCount;
      document.getElementById('mergeUpdatedCount').textContent = stats.updatedCount;
      document.getElementById('mergeNewChartsCount').textContent = stats.newChartsCount;
      document.getElementById('mergeUnmatchedCount').textContent = stats.unmatchedCount;
      reportBox.hidden = false;

      // Compress and download merged cache
      const blob = encodeCacheFile(mergedData);
      triggerDownload(blob, 'cache', 'application/octet-stream');
      showToast(`Smart merge complete! Overwrote 0 scores with ${stats.updatedCount} high scores.`, 'success');
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

  btnSelectRepackJson.addEventListener('click', () => repackJsonInput.click());

  repackJsonInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          state.repackData = JSON.parse(ev.target.result);
          repackDropzone.classList.add('loaded');
          repackDropzone.querySelector('p').textContent = `✓ Selected: ${file.name}`;
          btnRunRepack.disabled = false;
          showToast('JSON validated successfully', 'success');
        } catch (err) {
          showToast('Invalid JSON file', 'error');
        }
      };
      reader.readAsText(file);
    }
  });

  btnRunRepack.addEventListener('click', () => {
    if (!state.repackData) return;
    try {
      const blob = encodeCacheFile(state.repackData);
      triggerDownload(blob, 'cache', 'application/octet-stream');
      showToast('Compressed and downloaded AstroDX "cache" binary!', 'success');
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

  // Online / Offline Status Badge
  function updateOnlineBadge() {
    const badge = document.getElementById('pwaStatusBadge');
    if (!badge) return;
    if (navigator.onLine) {
      badge.innerHTML = '<span class="status-dot"></span> Offline Ready';
      badge.className = 'badge badge-pwa';
    } else {
      badge.innerHTML = '<span class="status-dot" style="background:#ffb703; box-shadow:0 0 10px #ffb703;"></span> Offline Mode';
      badge.className = 'badge';
    }
  }
  window.addEventListener('online', updateOnlineBadge);
  window.addEventListener('offline', updateOnlineBadge);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
