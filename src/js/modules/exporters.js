/**
 * Multi-Format Exporters Module
 * Handles file generation and browser downloads for DXRating.net JSON,
 * Microsoft Excel (.xlsx), UTF-8 CSV, and Raw Decoded JSON.
 */

import { calculateGrade } from './grade.js';
import { convertToDXRating, convertRecords, getConverter } from './converters.js';

/**
 * Prepares deduplicated DXRating.net import JSON array matching example_dxrating_export.json.
 */
export function buildDXRatingJSON(records, options = {}) {
  return convertToDXRating(records, options);
}

/**
 * Helper to download data as a browser file.
 */
export function triggerDownload(blobOrString, filename, mimeType = 'application/json') {
  let blob;
  if (blobOrString instanceof Blob) {
    if (filename === 'cache' && blobOrString.type !== 'application/octet-stream') {
      blob = new Blob([blobOrString], { type: 'application/octet-stream' });
    } else {
      blob = blobOrString;
    }
  } else {
    blob = new Blob([blobOrString], { type: filename === 'cache' ? 'application/octet-stream' : mimeType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

/**
 * Download DXRating.net JSON (example_dxrating_export.json format)
 */
export function exportDXRatingJSON(records, onToast, options = {}) {
  const data = buildDXRatingJSON(records, options);
  const jsonStr = JSON.stringify(data, null, 2);
  triggerDownload(jsonStr, 'dxrating_import.json', 'application/json');
  if (onToast) onToast(`Exported all ${data.length} records to dxrating_import.json`, 'success');
}

/**
 * Generic exporter for any registered converter format.
 */
export function exportConvertedFormat(records, formatId = 'dxrating', onToast, options = {}) {
  const converter = getConverter(formatId);
  const data = converter.convert(records, options);
  const jsonStr = JSON.stringify(data, null, 2);
  triggerDownload(jsonStr, converter.filename, converter.mimeType);
  if (onToast) onToast(`Exported ${data.length} records to ${converter.filename}`, 'success');
}

/**
 * Download Excel (.xlsx) using SheetJS
 */
export function exportExcel(records, onToast) {
  if (typeof XLSX === 'undefined') {
    if (onToast) onToast('SheetJS library not loaded', 'error');
    return;
  }

  const rows = records.map((r, idx) => {
    const grade = calculateGrade(r.achievementRate);
    return {
      '#': idx + 1,
      'Sheet ID': r.sheetId,
      'Song Title': r.title,
      'Chart Type': r.type.toUpperCase(),
      'Difficulty': r.difficulty.toUpperCase(),
      'Achievement Rate (%)': r.achievementRate,
      'Grade': grade.text
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'AstroDX Scores');
  XLSX.writeFile(workbook, 'astrodx_scores.xlsx');
  if (onToast) onToast('Downloaded astrodx_scores.xlsx', 'success');
}

/**
 * Download CSV with UTF-8 BOM for Microsoft Excel compatibility
 */
export function exportCSV(records, onToast) {
  const headers = ['#', 'Sheet ID', 'Song Title', 'Chart Type', 'Difficulty', 'Achievement Rate (%)', 'Grade'];
  const rows = records.map((r, idx) => {
    const grade = calculateGrade(r.achievementRate);
    const escape = (val) => `"${String(val).replace(/"/g, '""')}"`;
    return [
      idx + 1,
      escape(r.sheetId),
      escape(r.title),
      r.type.toUpperCase(),
      r.difficulty.toUpperCase(),
      r.achievementRate.toFixed(4),
      grade.text
    ].join(',');
  });

  // \uFEFF is the UTF-8 Byte Order Mark for Excel
  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  triggerDownload(csvContent, 'astrodx_scores.csv', 'text/csv;charset=utf-8;');
  if (onToast) onToast('Downloaded astrodx_scores.csv', 'success');
}

/**
 * Download Decoded JSON containing ONLY played songs:
 * song_name, level, achievement, and stats.
 */
export function exportRawDecodedJSON(records, onToast) {
  if (!records || records.length === 0) {
    if (onToast) onToast('No played scores to export', 'error');
    return;
  }

  // Format only played songs with exact requested keys:
  // song_name, level, achievement, and stats (wiping out any sync fields)
  const playedOnly = records.map((r) => {
    const rawStats = (r.originalNode && r.originalNode.stats) ? r.originalNode.stats : (r.originalNode || {});
    const stats = { ...rawStats };
    delete stats.sync;
    delete stats.syncFlag;
    return {
      song_name: r.rawTitle || r.title,
      level: r.level || '',
      achievement: r.achievementRate,
      stats
    };
  });

  const jsonStr = JSON.stringify(playedOnly, null, 2);
  triggerDownload(jsonStr, 'cache_decrypted.json', 'application/json');
  if (onToast) onToast(`Exported ${playedOnly.length} played scores to cache_decrypted.json`, 'success');
}

/**
 * Exports arbitrary object or array as astrodx_cache_decoded.json
 */
export function exportDecodedJSON(data, onToast, filename = 'astrodx_cache_decoded.json') {
  if (!data) {
    if (onToast) onToast('No data to export', 'error');
    return;
  }
  const jsonStr = JSON.stringify(data, null, 2);
  triggerDownload(jsonStr, filename, 'application/json');
  if (onToast) onToast(`Exported ${filename} successfully`, 'success');
}

