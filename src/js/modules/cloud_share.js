/**
 * Cloud Share & QR Code Module
 * Manages export panels, cloud sharing (dpaste / bytebin) for JSON formats,
 * and dropdown-based downloads for DXRating.net, Cached JSON, Excel (.xlsx), and CSV (.csv).
 */

import { buildDXRatingJSON, triggerDownload, exportExcel, exportCSV } from './exporters.js';
import { convertToCachedScores } from './converters.js';

let activeFormat = 'dxrating'; // 'dxrating' | 'cached' | 'excel' | 'csv'

const formatCache = {
  dxrating: {
    type: 'cloud',
    url: null,
    jsonStr: null,
    filename: 'dxrating_import.json',
    title: 'DXRating.net Cloud Share Ready!',
    desc: 'Open this direct URL on your desktop browser to view and download your <code>dxrating_import.json</code> file:',
    instructTitle: 'DXRating.net Import Steps:',
    instructText: '1. Open DXRating.net &rarr; 2. Click "Import Scores" &rarr; 3. Choose the downloaded JSON!'
  },
  cached: {
    type: 'cloud',
    url: null,
    jsonStr: null,
    filename: 'cache_decrypted.json',
    title: 'Cached Scores JSON Cloud Share Ready!',
    desc: 'Open this direct URL on any browser to view and download your <code>cache_decrypted.json</code> file:',
    instructTitle: 'Cached Scores JSON Format:',
    instructText: 'Contains all played scores with full metadata, note counts, critical/perfect judgments, and DX rating values.'
  },
  excel: {
    type: 'file',
    filename: 'astrodx_scores.xlsx',
    title: 'Excel Spreadsheet Ready!',
    desc: 'Download your play records as an Excel spreadsheet (.xlsx workbook) with calculated grades, chart types, and sheet IDs:',
    instructTitle: 'Excel Workbook Features:',
    instructText: 'Formatted with separate columns for Song Title, Sheet ID, Difficulty, Type, Achievement Rate (%), and Letter Grades (SSS+, SSS, etc.).'
  },
  csv: {
    type: 'file',
    filename: 'astrodx_scores.csv',
    title: 'CSV File Ready!',
    desc: 'Download your play records as a UTF-8 BOM comma-separated values file for universal data analysis:',
    instructTitle: 'Universal UTF-8 CSV:',
    instructText: 'UTF-8 Byte Order Mark (BOM) prevents garbled Japanese & Unicode song titles when opened in Microsoft Excel and data tools.'
  }
};

/**
 * Resets cached payloads and generated cloud links (e.g. when a new cache file is ingested).
 */
export function resetShareCache() {
  formatCache.dxrating.url = null;
  formatCache.dxrating.jsonStr = null;
  formatCache.cached.url = null;
  formatCache.cached.jsonStr = null;
}

export function getActiveShareFormat() {
  return activeFormat;
}

export function setActiveShareFormat(format) {
  if (formatCache[format]) {
    activeFormat = format;
  }
}

/**
 * Updates the visual active (dark shaded) state on the 4 top toolbar buttons.
 */
export function updateTopButtonActiveState(format) {
  const btnDX = document.getElementById('btnGenerateDXRatingLink');
  const btnCached = document.getElementById('btnGenerateCachedLink');
  const btnExcel = document.getElementById('btnExportExcel');
  const btnCSV = document.getElementById('btnExportCSV');

  if (btnDX) btnDX.classList.toggle('active', format === 'dxrating');
  if (btnCached) btnCached.classList.toggle('active', format === 'cached');
  if (btnExcel) btnExcel.classList.toggle('active', format === 'excel');
  if (btnCSV) btnCSV.classList.toggle('active', format === 'csv');
}

/**
 * Builds the data payload string for JSON formats.
 */
export function buildPayload(records, format, options = {}) {
  if (format === 'cached') {
    const data = convertToCachedScores(records);
    return JSON.stringify(data, null, 2);
  }

  // Default: DXRating.net format
  const exportData = buildDXRatingJSON(records, options);
  return JSON.stringify(exportData, null, 2);
}

/**
 * Uploads payload string to dpaste / bytebin and returns shareable raw URL.
 */
async function uploadToCloud(jsonStr) {
  let shareUrl = null;

  // Service 1: dpaste.com/api/v2/
  try {
    const params = new URLSearchParams();
    params.append('content', jsonStr);
    params.append('syntax', 'json');
    params.append('expiry_days', '1');

    const response = await fetch('https://dpaste.com/api/v2/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (response.ok) {
      const rawUrl = (await response.text()).trim();
      if (rawUrl.startsWith('http')) {
        shareUrl = rawUrl.endsWith('.txt') ? rawUrl : `${rawUrl}.txt`;
      }
    }
  } catch (e) {
    console.warn('dpaste.com upload failed, attempting bytebin fallback...', e);
  }

  // Service 2 Fallback: bytebin.lucko.me/post
  if (!shareUrl) {
    try {
      const response = await fetch('https://bytebin.lucko.me/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.key) {
          shareUrl = `https://bytebin.lucko.me/${data.key}`;
        }
      }
    } catch (e2) {
      console.warn('bytebin fallback failed:', e2);
    }
  }

  return shareUrl;
}

/**
 * Opens or updates the export dropdown panel for any format:
 * dxrating, cached, excel, or csv.
 */
export async function openExportPanel(format, records, onToast, options = {}) {
  if (!records || records.length === 0) {
    if (onToast) onToast('No score records to export. Please load an AstroDX cache file first.', 'error');
    return;
  }

  activeFormat = format;
  updateTopButtonActiveState(format);

  if (format === 'excel' || format === 'csv') {
    renderSharePanel(null, format, records);
    return;
  }

  // Cloud formats: 'dxrating' or 'cached'
  const targetBtn = options.triggerButton || 
    (format === 'cached' ? document.getElementById('btnGenerateCachedLink') : document.getElementById('btnGenerateDXRatingLink'));

  let originalText = '';
  if (targetBtn) {
    originalText = targetBtn.innerHTML;
    targetBtn.innerHTML = '<span>Uploading to Cloud...</span>';
    targetBtn.disabled = true;
  }

  const info = formatCache[format];
  const jsonStr = buildPayload(records, format, options);
  info.jsonStr = jsonStr;

  let shareUrl = info.url;
  if (!shareUrl) {
    shareUrl = await uploadToCloud(jsonStr);
    if (shareUrl) {
      info.url = shareUrl;
    }
  }

  if (targetBtn) {
    targetBtn.innerHTML = originalText;
    targetBtn.disabled = false;
  }

  if (!shareUrl) {
    if (onToast) onToast('Cloud sharing service temporarily unavailable. You can still download the JSON directly below.', 'error');
  }

  renderSharePanel(shareUrl, format, records);

  if (onToast) {
    const formatName = format === 'cached' ? 'Cached JSON' : 'DXRating.net';
    onToast(`${formatName} Share Link & QR generated successfully!`, 'success');
  }
}

/**
 * Backward compatibility alias for openExportPanel.
 */
export async function generatePCLinkAndQR(records, onToast, options = {}) {
  const format = options.format || activeFormat || 'dxrating';
  return openExportPanel(format, records, onToast, options);
}

/**
 * Renders the panel details for the requested format.
 */
export function renderSharePanel(shareUrl, format, records = []) {
  const panel = document.getElementById('pcTransferPanel');
  if (!panel) return;

  const info = formatCache[format] || formatCache['dxrating'];
  activeFormat = format;
  updateTopButtonActiveState(format);

  const input = document.getElementById('pcShareUrlInput');
  const copyBtn = document.getElementById('btnCopyShareUrl');
  const openBtn = document.getElementById('btnOpenShareUrl');
  const qrContainer = document.getElementById('qrcodeContainer');
  const fileIconContainer = document.getElementById('fileIconContainer');
  const qrCaption = document.getElementById('qrCaptionText');
  const titleEl = document.getElementById('pcTransferTitle');
  const descEl = document.getElementById('pcTransferDesc');
  const downloadText = document.getElementById('downloadBtnText');
  const instructTitle = document.getElementById('instructionTitle');
  const instructText = document.getElementById('instructionText');
  const formatSwitcher = document.getElementById('panelFormatSwitcher');
  const extraActions = document.getElementById('panelExtraActions');

  if (titleEl) titleEl.textContent = info.title;
  if (descEl) descEl.innerHTML = info.desc;
  if (instructTitle) instructTitle.textContent = info.instructTitle;
  if (instructText) instructText.innerHTML = info.instructText;
  if (downloadText) downloadText.textContent = `Download ${info.filename}`;

  if (info.type === 'file') {
    // Excel or CSV: No QR code, No web link
    if (input) input.style.display = 'none';
    if (copyBtn) copyBtn.style.display = 'none';
    if (openBtn) openBtn.style.display = 'none';
    if (formatSwitcher) formatSwitcher.style.display = 'none';
    if (extraActions) extraActions.style.display = 'none';

    if (qrContainer) qrContainer.style.display = 'none';
    if (fileIconContainer) {
      fileIconContainer.style.display = 'flex';
      if (format === 'excel') {
        fileIconContainer.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="8" y1="13" x2="16" y2="13"></line>
            <line x1="8" y1="17" x2="16" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span style="font-size:0.8125rem; font-weight:700; color:#10b981;">.XLSX</span>
        `;
        if (qrCaption) qrCaption.textContent = 'Excel Spreadsheet';
      } else {
        fileIconContainer.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="2" y1="10" x2="22" y2="10"></line>
          </svg>
          <span style="font-size:0.8125rem; font-weight:700; color:#0284c7;">.CSV (UTF-8)</span>
        `;
        if (qrCaption) qrCaption.textContent = 'UTF-8 BOM CSV';
      }
    }
  } else {
    // Cloud format: DXRating or Cached JSON
    if (input) input.style.display = 'block';
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    if (formatSwitcher) formatSwitcher.style.display = 'inline-flex';
    if (extraActions) extraActions.style.display = 'flex';

    if (fileIconContainer) fileIconContainer.style.display = 'none';
    if (qrContainer) qrContainer.style.display = 'inline-block';
    if (qrCaption) qrCaption.textContent = 'Scan with phone or PC camera';

    if (shareUrl) {
      if (input) input.value = shareUrl;
      if (openBtn) {
        openBtn.href = shareUrl;
        openBtn.style.display = 'inline-flex';
      }

      // Render QR Code
      if (qrContainer) {
        qrContainer.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
          new QRCode(qrContainer, {
            text: shareUrl,
            width: 160,
            height: 160,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      }
    } else {
      if (input) input.value = 'Cloud upload offline (Use download button below)';
      if (openBtn) openBtn.style.display = 'none';
      if (qrContainer) {
        qrContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:160px;width:160px;font-size:0.8rem;color:#64748b;text-align:center;padding:12px;">Direct Download Ready</div>';
      }
    }

    // Update pills inside the panel
    const pillDX = document.getElementById('pillFormatDXRating');
    const pillCached = document.getElementById('pillFormatCached');
    if (pillDX) pillDX.classList.toggle('active', format === 'dxrating');
    if (pillCached) pillCached.classList.toggle('active', format === 'cached');
  }

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Downloads the active item (JSON, Excel, or CSV) directly from the panel.
 */
export function downloadActiveShareItem(records, onToast) {
  if (activeFormat === 'excel') {
    exportExcel(records, onToast);
    return;
  }
  if (activeFormat === 'csv') {
    exportCSV(records, onToast);
    return;
  }

  const info = formatCache[activeFormat] || formatCache['dxrating'];
  if (!info.jsonStr) {
    if (onToast) onToast('Please generate the link first or load scores', 'error');
    return;
  }
  triggerDownload(info.jsonStr, info.filename, 'application/json');
  if (onToast) onToast(`Downloaded ${info.filename}`, 'success');
}

/**
 * Backward compatibility alias for downloadActiveShareItem.
 */
export function downloadActiveShareJSON(onToast) {
  downloadActiveShareItem([], onToast);
}
