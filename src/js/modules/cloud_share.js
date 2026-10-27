/**
 * Cloud Share & QR Code Module
 * Uploads formatted DXRating or Cached scores to ephemeral cloud storage (dpaste / bytebin)
 * and renders short URLs with scan-ready QR codes and in-panel download options.
 */

import { buildDXRatingJSON, triggerDownload } from './exporters.js';
import { convertToCachedScores } from './converters.js';

let activeFormat = 'dxrating'; // 'dxrating' | 'cached'

const formatCache = {
  dxrating: {
    url: null,
    jsonStr: null,
    filename: 'dxrating_import.json',
    title: 'DXRating.net Cloud Share Ready!',
    desc: 'Open this direct URL on your desktop browser to view and download your <code>dxrating_import.json</code> file:',
    instructTitle: 'DXRating.net Import Steps:',
    instructText: '1. Open DXRating.net &rarr; 2. Click "Import Scores" &rarr; 3. Choose the downloaded JSON!'
  },
  cached: {
    url: null,
    jsonStr: null,
    filename: 'cache_decrypted.json',
    title: 'Cached Scores JSON Cloud Share Ready!',
    desc: 'Open this direct URL to view and download your <code>cache_decrypted.json</code> (or feed directly to Acid Bot <code>/topadx</code>):',
    instructTitle: 'Cached JSON / Acid Bot Usage:',
    instructText: 'In Telegram, send /topadx &lt;url&gt; or upload the downloaded cache_decrypted.json directly to generate your B50 card!'
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
 * Builds the data payload string for the requested format.
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
 * Generates cloud link & QR, renders dropdown panel, and configures the in-panel download button.
 */
export async function generatePCLinkAndQR(records, onToast, options = {}) {
  if (!records || records.length === 0) {
    if (onToast) onToast('No score records to share. Please load an AstroDX cache file first.', 'error');
    return;
  }

  const format = options.format || activeFormat || 'dxrating';
  activeFormat = format;

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

  // Update dropdown panel UI
  renderSharePanel(shareUrl, format);

  if (onToast) {
    const formatName = format === 'cached' ? 'Cached JSON' : 'DXRating.net';
    onToast(`${formatName} Share Link & QR generated successfully!`, 'success');
  }
}

/**
 * Renders panel details with given URL and format.
 */
export function renderSharePanel(shareUrl, format) {
  const panel = document.getElementById('pcTransferPanel');
  if (!panel) return;

  const info = formatCache[format] || formatCache['dxrating'];
  activeFormat = format;

  const input = document.getElementById('pcShareUrlInput');
  const openBtn = document.getElementById('btnOpenShareUrl');
  const qrContainer = document.getElementById('qrcodeContainer');
  const titleEl = document.getElementById('pcTransferTitle');
  const descEl = document.getElementById('pcTransferDesc');
  const downloadText = document.getElementById('downloadBtnText');
  const instructTitle = document.getElementById('instructionTitle');
  const instructText = document.getElementById('instructionText');

  if (titleEl) titleEl.textContent = info.title;
  if (descEl) descEl.innerHTML = info.desc;
  if (instructTitle) instructTitle.textContent = info.instructTitle;
  if (instructText) instructText.innerHTML = info.instructText;
  if (downloadText) downloadText.textContent = `Download ${info.filename}`;

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

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Downloads the active JSON format directly from the panel.
 */
export function downloadActiveShareJSON(onToast) {
  const info = formatCache[activeFormat] || formatCache['dxrating'];
  if (!info.jsonStr) {
    if (onToast) onToast('Please generate the link first or load scores', 'error');
    return;
  }
  triggerDownload(info.jsonStr, info.filename, 'application/json');
  if (onToast) onToast(`Downloaded ${info.filename}`, 'success');
}
