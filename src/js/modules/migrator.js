/**
 * Safe Device Migration & Smart Cache Merger Module
 * Ports scores and high records from an old device's cache into a newly generated
 * target device cache schema based on normalized song titles and difficulties.
 */

import {
  extractRecords,
  sanitizeTitle,
  normalizeDifficulty,
  normalizeType,
  normalizeAchievement
} from './extractor.js';

export function smartMergeCaches(oldCacheData, newCacheData) {
  // 1. Extract all records from old cache
  const { records: oldRecords } = extractRecords(oldCacheData, { cleanTitle: true });
  
  // Index old records by: `${cleanTitle.toLowerCase()}__${type}__${difficulty}`
  const oldScoreMap = new Map();
  for (const r of oldRecords) {
    const key = `${r.title.toLowerCase()}__${r.type}__${r.difficulty}`;
    const existing = oldScoreMap.get(key);
    if (!existing || r.achievementRate > existing.achievementRate) {
      oldScoreMap.set(key, r);
    }
  }

  // 2. Clone newCacheData deeply
  const mergedData = JSON.parse(JSON.stringify(newCacheData));

  let matchedCount = 0;
  let updatedCount = 0;
  let newChartsCount = 0;
  const matchedOldKeys = new Set();

  // 3. Traverse new cache and port scores
  function traverseAndMerge(node, context) {
    if (!node || typeof node !== 'object') return;

    const keys = Object.keys(node);
    const lowerKeyMap = {};
    for (const k of keys) lowerKeyMap[k.toLowerCase()] = k;

    let currentTitle = context.title;
    const titleKey = lowerKeyMap['title'] || lowerKeyMap['name'] || lowerKeyMap['songname'];
    if (titleKey && typeof node[titleKey] === 'string' && node[titleKey].trim()) {
      currentTitle = node[titleKey].trim();
    }

    let currentType = context.type;
    const typeKey = lowerKeyMap['type'] || lowerKeyMap['charttype'];
    if (typeKey && node[typeKey]) {
      currentType = normalizeType(node[typeKey], currentTitle);
    }

    let currentDiff = context.difficulty;
    const diffKey = lowerKeyMap['alias'] || lowerKeyMap['difficulty'] || lowerKeyMap['diff'];
    if (diffKey && node[diffKey] !== undefined) {
      currentDiff = normalizeDifficulty(node[diffKey]);
    }

    const scoreKey = lowerKeyMap['achievement'] || 
                     lowerKeyMap['achievements'] || 
                     lowerKeyMap['achievementrate'] || 
                     lowerKeyMap['score'] || 
                     lowerKeyMap['bestscore'] || 
                     lowerKeyMap['scores'] || 
                     lowerKeyMap['rate'];

    if (scoreKey && (typeof node[scoreKey] === 'number' || typeof node[scoreKey] === 'string')) {
      newChartsCount++;
      const title = currentTitle || context.parentKey || '';
      const clean = sanitizeTitle(title);
      const diff = currentDiff || 'master';
      const type = currentType || 'dx';
      const lookupKey = `${clean.toLowerCase()}__${type}__${diff}`;

      if (oldScoreMap.has(lookupKey)) {
        matchedCount++;
        matchedOldKeys.add(lookupKey);
        const oldRecord = oldScoreMap.get(lookupKey);

        // Get existing new rate
        const existingNewRate = normalizeAchievement(node[scoreKey]);

        // If old score is higher, port it over
        if (oldRecord.achievementRate > existingNewRate) {
          updatedCount++;

          // Preserve the original format of the target node
          const originalVal = node[scoreKey];
          if (typeof originalVal === 'number' && originalVal > 1000) {
            node[scoreKey] = Math.round(oldRecord.achievementRate * 10000);
          } else if (typeof originalVal === 'number' && originalVal <= 1.01 && originalVal > 0) {
            node[scoreKey] = oldRecord.achievementRate / 100;
          } else {
            node[scoreKey] = oldRecord.achievementRate;
          }

          // Also copy detailed AstroDX stats (clearType, dxScore, plays, note counts)
          if (oldRecord.originalNode) {
            for (const attr of [
              'clearType', 'dxScore', 'clearedPlays', 'completePlays',
              'goodCount', 'greatCount', 'perfectCount', 'criticalCount', 'maxCombo',
              'Combo', 'combo', 'Sync', 'sync', 'IsAllPerfect', 'isAllPerfect', 'IsFullCombo', 'isFullCombo'
            ]) {
              if (oldRecord.originalNode[attr] !== undefined) {
                node[attr] = oldRecord.originalNode[attr];
              }
            }
          }
        }
      }
    }

    // Recurse
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        let itemDiff = currentDiff;
        if (item && typeof item === 'object') {
          const itemAlias = item.alias || item.difficulty || item.diff;
          if (itemAlias !== undefined) {
            itemDiff = normalizeDifficulty(itemAlias);
          } else if (i <= 4 && !itemDiff) {
            itemDiff = normalizeDifficulty(i);
          }
        }
        traverseAndMerge(item, {
          title: currentTitle,
          type: currentType,
          difficulty: itemDiff,
          parentKey: String(i)
        });
      }
    } else {
      for (const k of keys) {
        if (typeof node[k] === 'object' && node[k] !== null) {
          let childDiff = currentDiff;
          const kLower = k.toLowerCase();
          if (['0', '1', '2', '3', '4', 'basic', 'advanced', 'expert', 'master', 'remaster'].includes(kLower)) {
            childDiff = normalizeDifficulty(kLower);
          }
          traverseAndMerge(node[k], {
            title: currentTitle || (isNaN(k) ? k : null),
            type: currentType,
            difficulty: childDiff,
            parentKey: k
          });
        }
      }
    }
  }

  traverseAndMerge(mergedData, {
    title: null,
    type: null,
    difficulty: null,
    parentKey: ''
  });

  const unmatchedCount = oldScoreMap.size - matchedOldKeys.size;

  return {
    mergedData,
    stats: {
      matchedCount,
      updatedCount,
      newChartsCount,
      unmatchedCount: Math.max(0, unmatchedCount)
    }
  };
}
