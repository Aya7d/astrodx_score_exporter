/**
 * Cloud Share & QR Code Module
 * Uploads formatted DXRating scores to ephemeral cloud storage (dpaste / bytebin)
 * and renders short URLs with scan-ready QR codes for instant PC transfer.
 */

import { buildDXRatingJSON } from './exporters.js';

export async function generatePCLinkAndQR(records, onToast, options = {}) {
  if (!records || records.length === 0) {
    if (onToast) onToast('No score records to share', 'error');
    return;
  }

  const exportData = buildDXRatingJSON(records, options);
  const jsonStr = JSON.stringify(exportData, null, 2);

  const btn = document.getElementById('btnGeneratePCLink');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>Uploading to Cloud...</span>';
  btn.disabled = true;

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
        // Append .txt so visiting returns raw JSON directly
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

  btn.innerHTML = originalText;
  btn.disabled = false;

  if (!shareUrl) {
    if (onToast) onToast('Cloud sharing service temporarily unavailable. Please use file download.', 'error');
    return;
  }

  // Display URL and QR Code
  const panel = document.getElementById('pcTransferPanel');
  const input = document.getElementById('pcShareUrlInput');
  const openBtn = document.getElementById('btnOpenShareUrl');
  const qrContainer = document.getElementById('qrcodeContainer');

  input.value = shareUrl;
  openBtn.href = shareUrl;
  panel.hidden = false;

  // Render QR Code
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

  panel.scrollIntoView({ behavior: 'smooth' });
  if (onToast) onToast('PC Share Link & QR generated successfully!', 'success');
}
