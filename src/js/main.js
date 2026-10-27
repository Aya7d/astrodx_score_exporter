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
import { openExportPanel, generatePCLinkAndQR, downloadActiveShareItem, resetShareCache } from './modules/cloud_share.js';
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
import {
  saveUserCache,
  loadUserCache,
  clearUserCache,
  isRememberCacheEnabled,
  setRememberCacheEnabled,
  formatTimeAgo
} from './modules/storage.js';

// ============================================================================
// Application State
// ============================================================================
const state = {
  cacheData: null,             // In-memory decoded JSON object of the primary cache
  rawBuffer: null,             // Raw file buffer for persistent local storage
  savedTimestamp: null,        // Timestamp of saved cache
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

/**
 * Updates the remembered cache status banner at the top of the dropzone.
 */
function updateRememberedBanner(filename, scoreCount, timestamp) {
  const banner = document.getElementById('rememberedCacheBanner');
  if (!banner) return;
  if (!isRememberCacheEnabled() || !state.cacheData) {
    banner.hidden = true;
    return;
  }
  const nameEl = document.getElementById('rememberedFileName');
  const countEl = document.getElementById('rememberedScoreCount');
  const timeEl = document.getElementById('rememberedTimeText');

  if (nameEl) nameEl.textContent = filename || 'cache';
  if (countEl) countEl.textContent = `${scoreCount} Scores`;
  if (timeEl) timeEl.textContent = timestamp ? `Saved ${formatTimeAgo(timestamp)}` : 'Saved just now';
  banner.hidden = false;
}

// ============================================================================
// File Ingestion Handler
// ============================================================================
async function handleCacheBuffer(arrayBuffer, filename = 'cache', options = {}) {
  try {
    const decoded = decodeCacheFile(arrayBuffer);
    state.cacheData = decoded;
    state.rawBuffer = arrayBuffer;
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
    resetShareCache();

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

    // Save to browser IndexedDB if remember is enabled
    if (!options.isRestored && isRememberCacheEnabled()) {
      let fileType = 'cache_binary';
      if (Array.isArray(decoded) && decoded[0]?.sheetId !== undefined) {
        fileType = 'dxra';
      } else if (Array.isArray(decoded)) {
        fileType = 'decoded_json';
      }
      saveUserCache({
        buffer: arrayBuffer,
        filename,
        fileType,
        recordsCount: records.length,
        scannedCount: scannedChartsCount,
        cleanTitle
      }).catch((e) => console.warn('Could not save cache to storage:', e));
      state.savedTimestamp = Date.now();
    } else if (options.savedAt) {
      state.savedTimestamp = options.savedAt;
    }

    // Update Remembered Cache Banner
    updateRememberedBanner(filename, records.length, state.savedTimestamp);

    if (options.isRestored) {
      showToast(`Restored saved cache "${filename}" (${records.length} scores)`, 'info');
    } else {
      showToast(`Successfully decoded "${filename}" (${records.length} scores)`, 'success');
      document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
    }

    // If autoOpenQR is requested (e.g. from Upload DXRA button or DXRA file drop)
    if (options.autoOpenQR) {
      setTimeout(() => {
        openExportPanel('dxrating', state.extractedRecords, showToast, {
          server: state.serverRegion
        });
        document.getElementById('pcTransferPanel')?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
    }
  } catch (err) {
    console.error('Cache decode error:', err);
    showToast(err.message || 'Error decoding cache file', 'error');
  }
}

/**
 * Safely decodes base64 string or raw text payload from iOS Shortcut or Clipboard
 * and feeds it directly into handleCacheBuffer.
 */
export function processPayloadData(payloadStr, sourceName = 'iOS_1Tap_Sync') {
  if (!payloadStr || typeof payloadStr !== 'string') return;
  const trimmed = payloadStr.trim();
  if (!trimmed) return;

  // 1. If payload is direct JSON text (e.g. pasted decoded JSON)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const buf = new TextEncoder().encode(trimmed).buffer;
    handleCacheBuffer(buf, sourceName);
    return;
  }

  // 2. Base64 payload (Deflate binary or AES encrypted text)
  try {
    let cleanB64 = decodeURIComponent(trimmed).trim();
    if (cleanB64.includes(',')) cleanB64 = cleanB64.split(',')[1];
    cleanB64 = cleanB64.replace(/-/g, '+').replace(/_/g, '/');
    while (cleanB64.length % 4 !== 0) cleanB64 += '=';

    const binaryStr = atob(cleanB64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    handleCacheBuffer(bytes.buffer, sourceName);
  } catch (err) {
    // 3. Fallback: direct UTF-8 buffer if not base64
    try {
      const buf = new TextEncoder().encode(trimmed).buffer;
      handleCacheBuffer(buf, sourceName);
    } catch (err2) {
      showToast('Could not decode payload: ' + err.message, 'error');
    }
  }
}

/**
 * Shows the manual paste fallback modal when browser restricts direct clipboard access.
 */
export function showManualPasteModal() {
  const modal = document.getElementById('manualPasteModal');
  const input = document.getElementById('manualPasteInput');
  if (modal) {
    modal.hidden = false;
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 80);
    }
  }
}

/**
 * Attempts to read clipboard contents and process as cache payload.
 * If browser blocks auto-read (e.g. plain HTTP or Safari permissions),
 * gracefully opens the quick paste box so the user can paste with 1 tap.
 */
export async function attemptClipboardRead() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showManualPasteModal();
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      showToast('Clipboard is empty! Copy your cache or run the iOS Shortcut first.', 'warning');
      showManualPasteModal();
      return;
    }
    processPayloadData(text, 'iOS_Shortcut_Clipboard');
  } catch (err) {
    console.warn('Clipboard read error (falling back to paste box):', err);
    showManualPasteModal();
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
    const isDxra = name.toLowerCase().endsWith('.dxra') ||
                   name.toLowerCase().includes('dxrating') ||
                   name.toLowerCase().includes('decoded');
    handleCacheBuffer(buf, name, { autoOpenQR: isDxra });
  });

  // Bind Dedicated Upload DXRA / Decoded RA button & input
  const btnUploadDxra = document.getElementById('btnUploadDxra');
  const dxraFileInput = document.getElementById('dxraFileInput');
  if (btnUploadDxra && dxraFileInput) {
    btnUploadDxra.addEventListener('click', (e) => {
      e.stopPropagation();
      dxraFileInput.click();
    });
    setupDropzone(dropzone, dxraFileInput, (buf, name) => {
      handleCacheBuffer(buf, name, { autoOpenQR: true, source: 'dxra_button' });
    });
  }

  // Bind Remembered Cache Banner Actions
  const btnQuickQRFromBanner = document.getElementById('btnQuickQRFromBanner');
  if (btnQuickQRFromBanner) {
    btnQuickQRFromBanner.addEventListener('click', () => {
      if (!state.extractedRecords || state.extractedRecords.length === 0) {
        showToast('No scores available to share.', 'warning');
        return;
      }
      openExportPanel('dxrating', state.extractedRecords, showToast, {
        server: state.serverRegion
      });
      document.getElementById('pcTransferPanel')?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  const btnReplaceSavedCache = document.getElementById('btnReplaceSavedCache');
  if (btnReplaceSavedCache) {
    btnReplaceSavedCache.addEventListener('click', () => {
      cacheFileInput.click();
    });
  }

  const btnClearSavedCache = document.getElementById('btnClearSavedCache');
  if (btnClearSavedCache) {
    btnClearSavedCache.addEventListener('click', async () => {
      await clearUserCache();
      state.cacheData = null;
      state.rawBuffer = null;
      state.extractedRecords = [];
      state.scannedCount = 0;
      state.savedTimestamp = null;
      const banner = document.getElementById('rememberedCacheBanner');
      if (banner) banner.hidden = true;
      document.getElementById('resultsSection').hidden = true;
      document.getElementById('pcTransferPanel').hidden = true;
      resetShareCache();
      showToast('Saved cache cleared from this browser.', 'info');
    });
  }

  // Remember Cache toggle in settings bar
  const rememberCacheCheckbox = document.getElementById('rememberCacheCheckbox');
  if (rememberCacheCheckbox) {
    rememberCacheCheckbox.checked = isRememberCacheEnabled();
    rememberCacheCheckbox.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      setRememberCacheEnabled(enabled);
      if (enabled) {
        if (state.rawBuffer && state.cacheData) {
          await saveUserCache({
            buffer: state.rawBuffer,
            filename: state.originalFilename,
            recordsCount: state.extractedRecords.length,
            scannedCount: state.scannedCount,
            cleanTitle: document.getElementById('cleanTitleCheckbox').checked
          });
          state.savedTimestamp = Date.now();
          updateRememberedBanner(state.originalFilename, state.extractedRecords.length, state.savedTimestamp);
          showToast('Remember cache enabled: current cache saved.', 'success');
        } else {
          showToast('Remember cache enabled for future uploads.', 'info');
        }
      } else {
        await clearUserCache();
        const banner = document.getElementById('rememberedCacheBanner');
        if (banner) banner.hidden = true;
        showToast('Cache memory disabled. Saved data cleared.', 'info');
      }
    });
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
      const formatName = e.target.value === 'cached' ? 'Cached JSON' : 'DXRating.net JSON';
      showToast(`Conversion target format set to: ${formatName}`, 'info');

      if (state.extractedRecords.length > 0) {
        const db = getMaimaiDB();
        let matched = 0;
        state.extractedRecords.forEach((r) => {
          if (findOfficialSong(r.rawTitle || r.title, db)) matched++;
        });
        updateConversionStatus(matched, state.extractedRecords.length, state.serverRegion, state.conversionFormat);
      }

      const panel = document.getElementById('pcTransferPanel');
      if (panel && !panel.hidden && state.extractedRecords.length > 0) {
        generatePCLinkAndQR(state.extractedRecords, showToast, {
          format: state.conversionFormat,
          server: state.serverRegion
        });
      }
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
        updateConversionStatus(matched, state.extractedRecords.length, state.serverRegion, state.conversionFormat);
      }
      showToast(`Version / Server set to: ${e.target.selectedOptions[0].text}`, 'info');
    });
  }

  // 5. Exporters & Link Generation (UI opens dropdown panel with download button, no direct download)
  const btnDXLink = document.getElementById('btnGenerateDXRatingLink');
  if (btnDXLink) {
    btnDXLink.addEventListener('click', () => {
      openExportPanel('dxrating', state.extractedRecords, showToast, {
        server: state.serverRegion,
        triggerButton: btnDXLink
      });
    });
  }

  const btnCachedLink = document.getElementById('btnGenerateCachedLink');
  if (btnCachedLink) {
    btnCachedLink.addEventListener('click', () => {
      openExportPanel('cached', state.extractedRecords, showToast, {
        server: state.serverRegion,
        triggerButton: btnCachedLink
      });
    });
  }

  // In-Panel Download Button (Handles JSON, Excel, and CSV depending on active format)
  const btnDownloadPanel = document.getElementById('btnDownloadFromPanel');
  if (btnDownloadPanel) {
    btnDownloadPanel.addEventListener('click', () => {
      downloadActiveShareItem(state.extractedRecords, showToast);
    });
  }

  // In-Panel Format Switcher Pills
  const pillDX = document.getElementById('pillFormatDXRating');
  if (pillDX) {
    pillDX.addEventListener('click', () => {
      openExportPanel('dxrating', state.extractedRecords, showToast, {
        server: state.serverRegion
      });
    });
  }

  const pillCached = document.getElementById('pillFormatCached');
  if (pillCached) {
    pillCached.addEventListener('click', () => {
      openExportPanel('cached', state.extractedRecords, showToast, {
        server: state.serverRegion
      });
    });
  }

  // In-Panel Optional Full Cache Database Download
  const btnFullCachePanel = document.getElementById('btnDownloadFullCacheFromPanel');
  if (btnFullCachePanel) {
    btnFullCachePanel.addEventListener('click', () => {
      if (!state.cacheData) {
        showToast('No raw cache database loaded to export', 'error');
        return;
      }
      const jsonStr = stringifyAstroDXJson(state.cacheData, 2);
      triggerDownload(jsonStr, 'astrodx_cache_full.json', 'application/json');
      showToast('Exported full AstroDX cache database (all metadata & chart hashes preserved)', 'success');
    });
  }

  // Copy PC Share Link
  const btnCopyShareUrl = document.getElementById('btnCopyShareUrl');
  if (btnCopyShareUrl) {
    btnCopyShareUrl.addEventListener('click', () => {
      const input = document.getElementById('pcShareUrlInput');
      if (input && input.value && input.value.startsWith('http')) {
        navigator.clipboard.writeText(input.value).then(() => {
          showToast('Share link copied to clipboard!', 'success');
        }).catch(() => {
          input.select();
          document.execCommand('copy');
          showToast('Link copied to clipboard', 'success');
        });
      } else {
        showToast('No active link to copy', 'warning');
      }
    });
  }

  // Excel & CSV Exporters (Opens dropdown container with download button, no direct download)
  const btnExportExcel = document.getElementById('btnExportExcel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => {
      openExportPanel('excel', state.extractedRecords, showToast);
    });
  }

  const btnExportCSV = document.getElementById('btnExportCSV');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', () => {
      openExportPanel('csv', state.extractedRecords, showToast);
    });
  }

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

  // 7. iOS 1-Tap Shortcut Modal & Clipboard Listeners
  const iosShortcutModal = document.getElementById('iosShortcutModal');
  const btnIosShortcutModal = document.getElementById('btnIosShortcutModal');
  const btnIosGuideShortcut = document.getElementById('btnIosGuideShortcut');
  const btnCloseIosShortcutModal = document.getElementById('btnCloseIosShortcutModal');
  const btnDoneIosShortcut = document.getElementById('btnDoneIosShortcut');
  const btnCopyShortcutUrl = document.getElementById('btnCopyShortcutUrl');
  const shortcutTargetUrlPreview = document.getElementById('shortcutTargetUrlPreview');
  const btnPasteClipboard = document.getElementById('btnPasteClipboard');
  const btnTestClipboardModal = document.getElementById('btnTestClipboardModal');

  function openIosShortcutModal() {
    if (!iosShortcutModal) return;
    const cleanUrl = window.location.origin + window.location.pathname.replace(/\/+$/, '') + '/#b64=';
    if (shortcutTargetUrlPreview) {
      shortcutTargetUrlPreview.textContent = cleanUrl;
    }
    iosShortcutModal.hidden = false;
  }

  function closeIosShortcutModal() {
    if (iosShortcutModal) iosShortcutModal.hidden = true;
  }

  if (btnIosShortcutModal) btnIosShortcutModal.addEventListener('click', openIosShortcutModal);
  if (btnIosGuideShortcut) btnIosGuideShortcut.addEventListener('click', openIosShortcutModal);
  if (btnCloseIosShortcutModal) btnCloseIosShortcutModal.addEventListener('click', closeIosShortcutModal);
  if (btnDoneIosShortcut) btnDoneIosShortcut.addEventListener('click', closeIosShortcutModal);

  if (btnCopyShortcutUrl) {
    btnCopyShortcutUrl.addEventListener('click', async () => {
      const urlToCopy = window.location.origin + window.location.pathname.replace(/\/+$/, '') + '/#b64=';
      try {
        await navigator.clipboard.writeText(urlToCopy);
        showToast('Base URL copied to clipboard!', 'success');
      } catch (e) {
        showToast('Could not auto-copy, please copy manually', 'warning');
      }
    });
  }

  if (btnPasteClipboard) {
    btnPasteClipboard.addEventListener('click', () => attemptClipboardRead());
  }

  if (btnTestClipboardModal) {
    btnTestClipboardModal.addEventListener('click', () => {
      closeIosShortcutModal();
      attemptClipboardRead();
    });
  }

  // 8. Manual Paste Fallback Modal Listeners
  const manualPasteModal = document.getElementById('manualPasteModal');
  const manualPasteInput = document.getElementById('manualPasteInput');
  const btnCloseManualPasteModal = document.getElementById('btnCloseManualPasteModal');
  const btnCancelManualPaste = document.getElementById('btnCancelManualPaste');
  const btnSubmitManualPaste = document.getElementById('btnSubmitManualPaste');

  function closeManualPasteModal() {
    if (manualPasteModal) manualPasteModal.hidden = true;
  }

  if (btnCloseManualPasteModal) btnCloseManualPasteModal.addEventListener('click', closeManualPasteModal);
  if (btnCancelManualPaste) btnCancelManualPaste.addEventListener('click', closeManualPasteModal);

  function handleManualPasteContent() {
    if (!manualPasteInput) return;
    const text = manualPasteInput.value.trim();
    if (text.length > 30) {
      closeManualPasteModal();
      processPayloadData(text, 'Manual_Pasted_Cache');
      manualPasteInput.value = '';
    } else {
      showToast('Please paste valid AstroDX cache data', 'warning');
    }
  }

  if (btnSubmitManualPaste) {
    btnSubmitManualPaste.addEventListener('click', handleManualPasteContent);
  }

  if (manualPasteInput) {
    // Automatically trigger import as soon as user pastes into the box!
    manualPasteInput.addEventListener('paste', () => {
      setTimeout(() => {
        handleManualPasteContent();
      }, 50);
    });
    manualPasteInput.addEventListener('input', () => {
      if (manualPasteInput.value.trim().length > 100) {
        handleManualPasteContent();
      }
    });
  }

  // Global window paste listener: paste anywhere to import
  window.addEventListener('paste', (e) => {
    const active = document.activeElement;
    if (active && (active.id === 'tableSearchInput' || active.id === 'modalSongTitle' || active.id === 'modalAchievement')) {
      return;
    }
    const text = e.clipboardData?.getData('text');
    if (text && text.trim().length > 50) {
      closeManualPasteModal();
      processPayloadData(text, 'Direct_Window_Paste');
    }
  });

  // 9. Check for incoming iOS 1-Tap Shortcut payload via URL Hash
  const currentHash = window.location.hash;
  if (currentHash.startsWith('#b64=') || currentHash.startsWith('#cache_b64=')) {
    const prefix = currentHash.startsWith('#b64=') ? '#b64=' : '#cache_b64=';
    const b64Data = currentHash.slice(prefix.length);
    if (b64Data) {
      processPayloadData(b64Data, 'iOS_1Tap_Sync');
      // Clean hash from URL without reloading
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } else if (currentHash === '#clipboard' || currentHash === '#shortcut' || currentHash === '#ios_sync') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    attemptClipboardRead();
  }

  // 10. Android Native Capacitor 1-Click Detection & Sync
  const btnAndroidAutoExtract = document.getElementById('btnAndroidAutoExtract');
  const btnAndroidAppInfo = document.getElementById('btnAndroidAppInfo');

  const isAndroidApp = typeof window !== 'undefined' &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform();

  if (isAndroidApp) {
    const plugin = window.Capacitor?.Plugins?.AstroDXSync;
    if (plugin) {
      // 1. Listen for files shared to this app while running
      plugin.addListener('onFileReceived', (data) => {
        if (data && data.base64) {
          processPayloadData(data.base64, data.fileName || 'Shared_Cache');
          showToast('Cache received via Share!', 'success');
        }
      });

      // 2. Check for files received on cold-start launch via Share/Open With
      if (typeof plugin.getPendingSharedFile === 'function') {
        plugin.getPendingSharedFile().then((res) => {
          if (res && res.success && res.base64) {
            processPayloadData(res.base64, res.fileName || 'Shared_Cache');
            showToast('Cache loaded from Share!', 'success');
          }
        }).catch((e) => console.warn('Pending shared file check failed', e));
      }
    }

    if (btnAndroidAutoExtract) {
      // Temporarily hidden per user preference while manual upload is used
      btnAndroidAutoExtract.style.display = 'none';
      // Hide iOS shortcut button when inside Android native app
      const iosBtn = document.getElementById('btnIosShortcutModal');
      if (iosBtn) iosBtn.style.display = 'none';

      btnAndroidAutoExtract.addEventListener('click', async () => {
        if (!plugin) {
          showToast('AstroDX Native Plugin not found', 'error');
          return;
        }
        showToast('⚡ Auto-detecting AstroDX cache...', 'info');
        try {
          const res = await plugin.checkAndExtractCache();
          if (res && res.success && res.base64) {
            processPayloadData(res.base64, 'Android_Auto_Extract');
            showToast(`Extracted directly from ${res.path || 'storage'}!`, 'success');
          } else if (res && res.needsPermission) {
            showToast('Granting All Files Access in Settings...', 'warning');
            await plugin.requestAllFilesPermission();
          } else {
            showToast(res.message || 'Cache file not found in default paths', 'warning');
          }
        } catch (err) {
          showToast('Native extract error: ' + err.message, 'error');
        }
      });
    }
  }

  if (btnAndroidAppInfo) {
    btnAndroidAppInfo.addEventListener('click', () => {
      showToast('Install the AstroDX Exporter APK for instant 1-click extraction without folder browsing!', 'info');
    });
  }

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
      ? scoreDeltas.filter(d => 
          d.title.toLowerCase().includes(cleanFilter) || 
          d.difficulty.toLowerCase().includes(cleanFilter) ||
          (d.type && d.type.toLowerCase().includes(cleanFilter))
        )
      : scoreDeltas;

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No matching chart comparisons found</td></tr>';
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

      const type = (d.type || 'dx').toLowerCase();
      const typeBadge = `<span class="type-badge ${type === 'dx' ? 'type-dx' : ''}">${type.toUpperCase()}</span>`;

      tr.innerHTML = `
        <td><strong>${d.title}</strong></td>
        <td>${typeBadge}</td>
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

  // 8. Restore remembered user cache on initial page load if available
  if (isRememberCacheEnabled()) {
    loadUserCache().then((saved) => {
      if (saved && saved.buffer) {
        handleCacheBuffer(saved.buffer, saved.filename, {
          isRestored: true,
          savedAt: saved.savedAt
        });
      }
    }).catch((err) => {
      console.warn('Could not restore remembered cache:', err);
    });
  }

  // 9. PWA Service Worker Registration
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
