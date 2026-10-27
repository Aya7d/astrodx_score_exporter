/**
 * UI Controller & Rendering Module
 * Manages toast notifications, summary stat cards, score table rendering,
 * and inline row modifications.
 */

import { calculateGrade } from './grade.js';
import { deriveComboFlag, deriveSyncFlag } from './converters.js';

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else {
    iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function markEditsActive(state) {
  state.hasUnsavedEdits = true;
  const indicator = document.getElementById('tableEditedIndicator');
  if (indicator) indicator.hidden = false;
}

export function updateSummaryStats(records, scannedCount) {
  const statTotalCharts = document.getElementById('statTotalCharts');
  const statPlayedScores = document.getElementById('statPlayedScores');
  const statHighestScore = document.getElementById('statHighestScore');
  const statHighestGrade = document.getElementById('statHighestGrade');
  const statHighestSong = document.getElementById('statHighestSong');
  const statAverageScore = document.getElementById('statAverageScore');
  const statUniqueSongs = document.getElementById('statUniqueSongs');

  if (!statTotalCharts) return;

  statTotalCharts.textContent = scannedCount.toLocaleString();
  statPlayedScores.textContent = records.length.toLocaleString();

  if (records.length === 0) {
    statHighestScore.textContent = '0.0000%';
    statHighestGrade.textContent = '-';
    statHighestSong.textContent = '-';
    statAverageScore.textContent = '0.0000%';
    statUniqueSongs.textContent = '0 Unique Songs';
    return;
  }

  let highest = records[0];
  let totalScore = 0;
  const uniqueTitles = new Set();

  for (const r of records) {
    if (r.achievementRate > highest.achievementRate) {
      highest = r;
    }
    totalScore += r.achievementRate;
    uniqueTitles.add(r.title);
  }

  const avg = totalScore / records.length;
  const grade = calculateGrade(highest.achievementRate);

  statHighestScore.textContent = `${highest.achievementRate.toFixed(4)}%`;
  statHighestGrade.textContent = grade.text;
  statHighestGrade.className = `grade-badge ${grade.className}`;
  statHighestSong.textContent = `${highest.title} [${highest.difficulty.toUpperCase()}]`;
  statHighestSong.title = statHighestSong.textContent;

  statAverageScore.textContent = `${avg.toFixed(4)}%`;
  statUniqueSongs.textContent = `${uniqueTitles.size} Unique Songs`;
}

export function renderScoreTable(state, onTableChange) {
  const tbody = document.getElementById('scoreTableBody');
  const countLabel = document.getElementById('tableShowingCount');
  const emptyState = document.getElementById('tableEmptyState');
  if (!tbody) return;

  tbody.innerHTML = '';

  const query = state.searchQuery.toLowerCase().trim();
  const diffFilter = state.filterDiff;
  const typeFilter = state.filterType;

  const filtered = state.extractedRecords.filter((rec) => {
    if (diffFilter !== 'all' && rec.difficulty !== diffFilter) return false;
    if (typeFilter !== 'all' && rec.type !== typeFilter) return false;
    if (query && !rec.title.toLowerCase().includes(query) && !rec.sheetId.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });

  countLabel.textContent = `Showing ${filtered.length} of ${state.extractedRecords.length} scores`;

  if (filtered.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  filtered.forEach((rec, index) => {
    const tr = document.createElement('tr');
    const grade = calculateGrade(rec.achievementRate);

    const stats = rec.stats || (rec.originalNode && rec.originalNode.stats ? rec.originalNode.stats : rec.originalNode) || {};
    const clearType = stats.clearType !== undefined ? stats.clearType : 
                      (rec.clearType !== undefined ? rec.clearType : 
                      (rec.originalNode && rec.originalNode.clearType !== undefined ? rec.originalNode.clearType : 0));
    const combo = deriveComboFlag(clearType, stats);
    const sync = deriveSyncFlag(clearType, stats);

    let flagsHtml = '';
    if (combo === 'ap') {
      flagsHtml += '<span class="badge-flag badge-ap" title="All Perfect">AP</span> ';
    } else if (combo === 'fc') {
      flagsHtml += '<span class="badge-flag badge-fc" title="Full Combo">FC</span> ';
    }
    if (sync === 'sync') {
      flagsHtml += '<span class="badge-flag badge-sync" title="Sync Clear">SYNC</span>';
    }
    if (!flagsHtml) {
      flagsHtml = '<span style="color: var(--text-dim); font-size: 0.8125rem;">—</span>';
    }

    tr.innerHTML = `
      <td style="color: var(--text-dim); font-size: 0.8125rem;">${index + 1}</td>
      <td>
        <input type="text" class="inline-input title-input" value="${escapeHtml(rec.title)}" aria-label="Song title" data-index="${rec._id}">
      </td>
      <td>
        <span class="type-badge ${rec.type === 'dx' ? 'type-dx' : ''}">${rec.type.toUpperCase()}</span>
      </td>
      <td>
        <span class="diff-badge diff-${rec.difficulty}">${rec.difficulty}</span>
      </td>
      <td>
        <div class="achievement-cell">
          <input type="number" step="0.0001" min="0" max="101" class="inline-input achievement-input" value="${rec.achievementRate.toFixed(4)}" aria-label="Achievement percentage" data-index="${rec._id}"><span class="achievement-unit">%</span>
        </div>
      </td>
      <td>
        <span class="grade-badge ${grade.className}">${grade.text}</span>
      </td>
      <td>
        ${flagsHtml}
      </td>
      <td>
        <button type="button" class="btn-icon-danger btn-delete-row" data-index="${rec._id}" title="Remove record">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // Attach inline listeners
  tbody.querySelectorAll('.title-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.index, 10);
      const record = state.extractedRecords.find((r) => r._id === id);
      if (record) {
        record.title = e.target.value.trim();
        record.sheetId = `${record.title}__dxrt__${record.type}__dxrt__${record.difficulty}`;
        markEditsActive(state);
      }
    });
  });

  tbody.querySelectorAll('.achievement-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.index, 10);
      const record = state.extractedRecords.find((r) => r._id === id);
      if (record) {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          record.achievementRate = Math.round(Math.min(101.0, val) * 10000) / 10000;
          e.target.value = record.achievementRate.toFixed(4);
          markEditsActive(state);
          renderScoreTable(state, onTableChange);
          updateSummaryStats(state.extractedRecords, state.scannedCount || state.extractedRecords.length);
        }
      }
    });
  });

  tbody.querySelectorAll('.btn-delete-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.index, 10);
      state.extractedRecords = state.extractedRecords.filter((r) => r._id !== id);
      markEditsActive(state);
      renderScoreTable(state, onTableChange);
      updateSummaryStats(state.extractedRecords, state.scannedCount || state.extractedRecords.length);
      showToast('Record removed', 'info');
      if (onTableChange) onTableChange();
    });
  });
}

export function updateConversionStatus(matchedCount, totalCount, server = 'all', format = 'dxrating') {
  const banner = document.getElementById('conversionStatusBanner');
  const text = document.getElementById('conversionStatusText');
  if (!banner || !text) return;

  let serverName = 'All Versions (Global / 全版本)';
  if (server === 'jp') serverName = 'Japan ver. (日本版)';
  else if (server === 'intl') serverName = 'International ver. (海外版)';

  const unmatchedCount = Math.max(0, totalCount - matchedCount);
  let detailText = '';
  if (unmatchedCount > 0) {
    detailText = `(${matchedCount} matched to official ${serverName} charts, ${unmatchedCount} custom/community charts included)`;
  } else {
    detailText = `(100% matched to official ${serverName} charts)`;
  }

  const formatName = format === 'cached' ? 'Cached JSON format' : 'DXRating format';
  text.innerHTML = `<strong>Auto-converted to ${formatName}:</strong> All ${totalCount} / ${totalCount} charts converted ${detailText}.`;
}

