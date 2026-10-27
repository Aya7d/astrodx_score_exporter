/**
 * Safe Device Migration & Smart Cache / JSON Merger Module
 * Strictly prevents score downgrades: for every chart, always retains the highest
 * achievement score and best completion stats across Old and New device datasets.
 * 
 * Supports:
 * - AstroDX Cache Binary (ReflektoneEncrypt AES-256 / Deflate)
 * - AstroDX Decoded JSON (cache_decrypted.json / level_metadata)
 * - DXRating.net JSON (example_dxrating_export.json format)
 */

import {
  extractRecords,
  sanitizeTitle,
  normalizeDifficulty,
  normalizeType,
  normalizeAchievement,
  inferDifficultyFromLevel
} from './extractor.js';

import {
  findOfficialSong,
  convertToDXRating
} from './converters.js';

/**
 * Resolves the better combo flag: 'ap' > 'fc' > null
 */
function getBestComboFlag(flagA, flagB) {
  const normA = flagA ? String(flagA).toLowerCase() : null;
  const normB = flagB ? String(flagB).toLowerCase() : null;
  if (normA === 'ap' || normB === 'ap') return 'ap';
  if (normA === 'fc' || normB === 'fc') return 'fc';
  return null;
}

/**
 * Resolves the better sync flag: 'fsd' > 'fs' > 'sync' > null
 */
function getBestSyncFlag(syncA, syncB) {
  const rank = { 'fsd': 3, 'fs': 2, 'sync': 1 };
  const rA = rank[String(syncA).toLowerCase()] || 0;
  const rB = rank[String(syncB).toLowerCase()] || 0;
  if (rA > rB) return syncA;
  if (rB > rA) return syncB;
  return syncA || syncB || null;
}

/**
 * Detects whether an AstroDX cache structure stores scores as integer (10000x)
 * or as float percentage (0 - 101.0000).
 */
function detectCacheScoreScale(cacheObj) {
  let hasIntegerScores = false;
  let hasFloatScores = false;

  function scan(node) {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const kLower = k.toLowerCase();
      if (['achievement', 'achievements', 'score', 'scores', 'achievementrate'].includes(kLower)) {
        if (typeof v === 'number') {
          if (v > 1000) hasIntegerScores = true;
          else if (v > 0 && v <= 101) hasFloatScores = true;
        }
      }
      if (typeof v === 'object') scan(v);
    }
  }

  scan(cacheObj);
  if (hasIntegerScores) return 'integer';
  if (hasFloatScores) return 'float';
  return 'integer'; // Default standard for AstroDX binary caches
}

/**
 * Builds the merged AstroDX Decoded JSON array format.
 */
export function buildMergedDecodedJSON(mergedRecords) {
  return mergedRecords.map(r => ({
    song_name: r.rawTitle || r.title,
    type: r.type,
    difficulty: r.difficulty,
    level: r.level || '',
    achievement: r.achievementRate,
    stats: {
      clearType: r.clearType || 0,
      achievementRate: r.achievementRate,
      dxScore: (r.stats && r.stats.dxScore) || 0,
      maxCombo: (r.stats && r.stats.maxCombo) || 0,
      combo: r.comboFlag || null,
      sync: r.syncFlag || null,
      isAllPerfect: r.comboFlag === 'ap',
      isFullCombo: r.comboFlag === 'fc' || r.comboFlag === 'ap',
      ...(r.stats && r.stats.criticalCount !== undefined ? {
        criticalCount: r.stats.criticalCount,
        perfectCount: r.stats.perfectCount,
        greatCount: r.stats.greatCount,
        goodCount: r.stats.goodCount,
        totalNotesCount: r.stats.totalNotesCount
      } : {})
    }
  }));
}

/**
 * Builds the merged DXRating format JSON array matching example_dxrating_export.json.
 */
export function buildMergedDXRatingJSON(mergedRecords, options = {}) {
  return convertToDXRating(mergedRecords, options);
}

/**
 * Deeply updates target cache object with merged high scores without altering
 * target device folder paths or internal structure.
 */
function buildMergedCacheBinaryObject(sourceNew, sourceOld, mergedRecords) {
  // If target source is not an object or is null, create a clean object
  if (!sourceNew || typeof sourceNew !== 'object') {
    return { version: '2.0.0', scores: {} };
  }

  const mergedData = JSON.parse(JSON.stringify(sourceNew));
  const detectedScale = detectCacheScoreScale(sourceNew) === 'integer' || detectCacheScoreScale(sourceOld) === 'integer'
    ? 'integer'
    : 'float';

  // Index merged records for fast tree lookup
  const recordMap = new Map();
  for (const r of mergedRecords) {
    const key = `${r.title.toLowerCase()}__${r.type}__${r.difficulty}`;
    const altKey = `${r.title.toLowerCase()}__${r.difficulty}`;
    recordMap.set(key, r);
    if (!recordMap.has(altKey)) recordMap.set(altKey, r);

    if (r.diffId !== undefined && r.diffId !== null) {
      const idKey = `${r.title.toLowerCase()}__id__${r.diffId}`;
      recordMap.set(idKey, r);
    }

    const officialSong = findOfficialSong(r.rawTitle || r.title);
    if (officialSong) {
      const offKey = `${officialSong.title.toLowerCase()}__${r.type}__${r.difficulty}`;
      if (!recordMap.has(offKey)) recordMap.set(offKey, r);
      if (r.diffId !== undefined && r.diffId !== null) {
        const offIdKey = `${officialSong.title.toLowerCase()}__id__${r.diffId}`;
        if (!recordMap.has(offIdKey)) recordMap.set(offIdKey, r);
      }
    }
  }

  // Dedicated high-precision merger for AstroDX LevelMetadata schemas
  if (mergedData && mergedData.level_metadata && typeof mergedData.level_metadata === 'object') {
    for (const [songKey, songNode] of Object.entries(mergedData.level_metadata)) {
      if (!songNode || typeof songNode !== 'object') continue;
      const rawTitle = songNode.title || songKey;
      const clean = sanitizeTitle(rawTitle);

      const diffList = songNode.difficulties;
      if (Array.isArray(diffList)) {
        for (const diffNode of diffList) {
          if (!diffNode || typeof diffNode !== 'object') continue;
          const diff = (diffNode.alias && normalizeDifficulty(diffNode.alias)) || 
                       normalizeDifficulty(diffNode.id) || 
                       inferDifficultyFromLevel(diffNode.value);
          const type = normalizeType(null, rawTitle);

          const idKey = diffNode.id !== undefined && diffNode.id !== null ? `${clean.toLowerCase()}__id__${diffNode.id}` : null;
          const key = `${clean.toLowerCase()}__${type}__${diff}`;
          const altKey = `${clean.toLowerCase()}__${diff}`;
          const officialSong = findOfficialSong(rawTitle);
          const offKey = officialSong ? `${officialSong.title.toLowerCase()}__${type}__${diff}` : null;
          const offIdKey = officialSong && diffNode.id !== undefined && diffNode.id !== null ? `${officialSong.title.toLowerCase()}__id__${diffNode.id}` : null;

          let mergedRec = (idKey && recordMap.get(idKey)) || (offIdKey && recordMap.get(offIdKey));
          if (!mergedRec) {
            const fallback = recordMap.get(key) || (offKey && recordMap.get(offKey)) || recordMap.get(altKey);
            if (fallback && (fallback.diffId === undefined || fallback.diffId === null || fallback.diffId === diffNode.id)) {
              mergedRec = fallback;
            }
          }
          if (mergedRec && diffNode.stats && typeof diffNode.stats === 'object') {
            const currentRate = normalizeAchievement(diffNode.stats.achievementRate || 0);
            if (mergedRec.achievementRate >= currentRate) {
              diffNode.stats.achievementRate = mergedRec.achievementRate;
              if (mergedRec.clearType !== undefined) {
                diffNode.stats.clearType = Math.max(diffNode.stats.clearType || 0, mergedRec.clearType);
              }
              if (mergedRec.stats?.dxScore !== undefined) {
                diffNode.stats.dxScore = Math.max(diffNode.stats.dxScore || 0, mergedRec.stats.dxScore);
              }
              if (mergedRec.stats?.maxCombo !== undefined) {
                diffNode.stats.maxCombo = Math.max(diffNode.stats.maxCombo || 0, mergedRec.stats.maxCombo);
              }
              if (mergedRec.stats?.clearedPlays !== undefined) {
                diffNode.stats.clearedPlays = Math.max(diffNode.stats.clearedPlays || 0, mergedRec.stats.clearedPlays);
              }
              if (mergedRec.stats?.completePlays !== undefined) {
                diffNode.stats.completePlays = Math.max(diffNode.stats.completePlays || 0, mergedRec.stats.completePlays);
              }
              if (mergedRec.stats?.totalNotesCount !== undefined) {
                diffNode.stats.totalNotesCount = mergedRec.stats.totalNotesCount;
              }
              if (mergedRec.stats?.criticalCount !== undefined) {
                diffNode.stats.criticalCount = mergedRec.stats.criticalCount;
                diffNode.stats.perfectCount = mergedRec.stats.perfectCount;
                diffNode.stats.greatCount = mergedRec.stats.greatCount;
                diffNode.stats.goodCount = mergedRec.stats.goodCount;
              }
            }
          }
        }
      }
    }
    return mergedData;
  }

  function traverseAndMerge(node, context) {
    if (!node || typeof node !== 'object') return;

    const keys = Object.keys(node);
    const lowerKeyMap = {};
    for (const k of keys) lowerKeyMap[k.toLowerCase()] = k;

    let currentTitle = context.title;
    const titleKey = lowerKeyMap['title'] || lowerKeyMap['name'] || lowerKeyMap['songname'] || lowerKeyMap['song_name'];
    if (titleKey && typeof node[titleKey] === 'string' && node[titleKey].trim()) {
      currentTitle = node[titleKey].trim();
    }

    let currentType = context.type;
    const typeKey = lowerKeyMap['type'] || lowerKeyMap['charttype'];
    if (typeKey && node[typeKey]) {
      currentType = normalizeType(node[typeKey], currentTitle);
    }

    let currentDiff = context.difficulty;
    const diffKey = lowerKeyMap['alias'] || lowerKeyMap['difficulty'] || lowerKeyMap['diff'] || lowerKeyMap['levelindex'];
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
      const title = currentTitle || context.parentKey || '';
      const clean = sanitizeTitle(title);
      const diff = currentDiff || 'master';
      const type = currentType || 'dx';

      const key = `${clean.toLowerCase()}__${type}__${diff}`;
      const altKey = `${clean.toLowerCase()}__${diff}`;
      const officialSong = findOfficialSong(title);
      const offKey = officialSong ? `${officialSong.title.toLowerCase()}__${type}__${diff}` : null;

      const mergedRec = recordMap.get(key) || (offKey && recordMap.get(offKey)) || recordMap.get(altKey);

      if (mergedRec) {
        const currentVal = node[scoreKey];
        const currentRate = normalizeAchievement(currentVal);

        // Always apply the highest score (Strict Zero Downgrade)
        if (mergedRec.achievementRate >= currentRate) {
          // Format value matching the target scale
          if (typeof currentVal === 'number' && currentVal > 1000) {
            node[scoreKey] = Math.round(mergedRec.achievementRate * 10000);
          } else if (typeof currentVal === 'number' && currentVal > 0 && currentVal <= 1.01) {
            node[scoreKey] = mergedRec.achievementRate / 100;
          } else if (typeof currentVal === 'number' && currentVal > 1.01 && currentVal <= 101.0) {
            node[scoreKey] = mergedRec.achievementRate;
          } else {
            // When target value was 0, use detected cache scale
            if (detectedScale === 'integer') {
              node[scoreKey] = Math.round(mergedRec.achievementRate * 10000);
            } else {
              node[scoreKey] = mergedRec.achievementRate;
            }
          }

          // Update detailed attributes
          if (mergedRec.clearType !== undefined) {
            node.clearType = Math.max(node.clearType || 0, mergedRec.clearType);
          }
          if (mergedRec.stats?.dxScore !== undefined) {
            node.dxScore = Math.max(node.dxScore || 0, mergedRec.stats.dxScore);
          }
          if (mergedRec.stats?.maxCombo !== undefined) {
            node.maxCombo = Math.max(node.maxCombo || 0, mergedRec.stats.maxCombo);
          }
          if (mergedRec.comboFlag === 'ap') {
            node.isAllPerfect = true;
            node.isFullCombo = true;
          } else if (mergedRec.comboFlag === 'fc') {
            node.isFullCombo = true;
          }

          // If child stats object exists (AstroDX 2.2+ metadata format)
          if (node.stats && typeof node.stats === 'object') {
            node.stats.achievementRate = mergedRec.achievementRate;
            node.stats.clearType = Math.max(node.stats.clearType || 0, mergedRec.clearType || 0);
            if (mergedRec.stats?.dxScore) {
              node.stats.dxScore = Math.max(node.stats.dxScore || 0, mergedRec.stats.dxScore);
            }
            if (mergedRec.stats?.maxCombo) {
              node.stats.maxCombo = Math.max(node.stats.maxCombo || 0, mergedRec.stats.maxCombo);
            }
            if (mergedRec.stats?.criticalCount !== undefined) {
              node.stats.criticalCount = mergedRec.stats.criticalCount;
              node.stats.perfectCount = mergedRec.stats.perfectCount;
              node.stats.greatCount = mergedRec.stats.greatCount;
              node.stats.goodCount = mergedRec.stats.goodCount;
              if (mergedRec.stats.totalNotesCount) node.stats.totalNotesCount = mergedRec.stats.totalNotesCount;
            }
          }
        }
      }
    }

    // Recurse children
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        let itemDiff = currentDiff;
        if (item && typeof item === 'object') {
          const itemAlias = item.alias || item.difficulty || item.diff || item.id;
          if (itemAlias !== undefined && itemAlias !== null) {
            itemDiff = normalizeDifficulty(itemAlias);
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
          if (['0', '1', '2', '3', '4', 'basic', 'advanced', 'expert', 'master', 'remaster', 're:master'].includes(kLower)) {
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

  return mergedData;
}

/**
 * Universal Smart Merge Engine
 * Extracts and compares records from Old and New sources.
 * Strictly avoids score downgrades by always picking the maximum achievement and best stats.
 * Generates all 3 formats: Cache Binary, Decoded JSON, and DXRating JSON.
 *
 * @param {*} sourceOld - Old device cache binary data, decoded JSON, or DXRating JSON
 * @param {*} sourceNew - New device cache binary data, decoded JSON, or DXRating JSON
 * @param {Object} options - { server: 'intl' | 'jp', cleanTitle: true }
 */
export function smartMergeScores(sourceOld, sourceNew, options = {}) {
  // 1. Extract all records from both sources
  const { records: oldRecords } = extractRecords(sourceOld, { cleanTitle: true });
  const { records: newRecords } = extractRecords(sourceNew, { cleanTitle: true });

  // Map to index old records by multiple keys
  const oldMap = new Map();
  for (const r of oldRecords) {
    const key = `${r.title.toLowerCase()}__${r.type}__${r.difficulty}`;
    const altKey = `${r.title.toLowerCase()}__${r.difficulty}`;
    const officialSong = findOfficialSong(r.rawTitle || r.title);
    const offKey = officialSong ? `${officialSong.title.toLowerCase()}__${r.type}__${r.difficulty}` : null;

    const existing = oldMap.get(key);
    if (!existing || r.achievementRate > existing.achievementRate) {
      oldMap.set(key, r);
      if (altKey && (!oldMap.has(altKey) || r.achievementRate > oldMap.get(altKey).achievementRate)) {
        oldMap.set(altKey, r);
      }
      if (offKey && (!oldMap.has(offKey) || r.achievementRate > oldMap.get(offKey).achievementRate)) {
        oldMap.set(offKey, r);
      }
    }
  }

  // Map to index new records by multiple keys
  const newMap = new Map();
  for (const r of newRecords) {
    const key = `${r.title.toLowerCase()}__${r.type}__${r.difficulty}`;
    const altKey = `${r.title.toLowerCase()}__${r.difficulty}`;
    const officialSong = findOfficialSong(r.rawTitle || r.title);
    const offKey = officialSong ? `${officialSong.title.toLowerCase()}__${r.type}__${r.difficulty}` : null;

    const existing = newMap.get(key);
    if (!existing || r.achievementRate > existing.achievementRate) {
      newMap.set(key, r);
      if (altKey && (!newMap.has(altKey) || r.achievementRate > newMap.get(altKey).achievementRate)) {
        newMap.set(altKey, r);
      }
      if (offKey && (!newMap.has(offKey) || r.achievementRate > newMap.get(offKey).achievementRate)) {
        newMap.set(offKey, r);
      }
    }
  }

  // 2. Collect all unique canonical charts
  const canonicalChartMap = new Map();
  for (const r of [...oldRecords, ...newRecords]) {
    const key = `${r.title.toLowerCase()}__${r.type}__${r.difficulty}`;
    if (!canonicalChartMap.has(key)) {
      canonicalChartMap.set(key, {
        key,
        title: r.title,
        rawTitle: r.rawTitle || r.title,
        type: r.type,
        difficulty: r.difficulty,
        level: r.level || ''
      });
    }
  }

  const mergedRecords = [];
  const scoreDeltas = [];

  let matchedCount = 0;
  let updatedFromOld = 0;
  let keptNewHigh = 0;
  let equalCount = 0;
  let oldOnlyCount = 0;
  let newOnlyCount = 0;

  for (const [key, meta] of canonicalChartMap.entries()) {
    const altKey = `${meta.title.toLowerCase()}__${meta.difficulty}`;
    const officialSong = findOfficialSong(meta.rawTitle || meta.title);
    const offKey = officialSong ? `${officialSong.title.toLowerCase()}__${meta.type}__${meta.difficulty}` : null;

    const rOld = oldMap.get(key) || (offKey && oldMap.get(offKey)) || oldMap.get(altKey);
    const rNew = newMap.get(key) || (offKey && newMap.get(offKey)) || newMap.get(altKey);

    if (rOld && rNew) {
      matchedCount++;
      const oldRate = rOld.achievementRate;
      const newRate = rNew.achievementRate;

      // STRICT ZERO DOWNGRADE RULE: ALWAYS TAKE THE HIGHEST
      const bestRate = Math.max(oldRate, newRate);

      let status = 'equal';
      if (oldRate > newRate) {
        status = 'updated_from_old';
        updatedFromOld++;
      } else if (newRate > oldRate) {
        status = 'kept_new_high';
        keptNewHigh++;
      } else {
        equalCount++;
      }

      const bestCombo = getBestComboFlag(rOld.comboFlag, rNew.comboFlag);
      const bestSync = getBestSyncFlag(rOld.syncFlag, rNew.syncFlag);
      const bestClearType = Math.max(rOld.clearType || 0, rNew.clearType || 0);
      const bestDxScore = Math.max(
        (rOld.stats && rOld.stats.dxScore) || (rOld.originalNode && rOld.originalNode.dxScore) || 0,
        (rNew.stats && rNew.stats.dxScore) || (rNew.originalNode && rNew.originalNode.dxScore) || 0
      );
      const bestMaxCombo = Math.max(
        (rOld.stats && rOld.stats.maxCombo) || (rOld.originalNode && rOld.originalNode.maxCombo) || 0,
        (rNew.stats && rNew.stats.maxCombo) || (rNew.originalNode && rNew.originalNode.maxCombo) || 0
      );

      // Dominant record gives judgments & metadata
      const dominantRec = (oldRate >= newRate) ? rOld : rNew;
      const mergedStats = {
        ...(dominantRec.stats || {}),
        achievementRate: bestRate,
        clearType: bestClearType,
        dxScore: bestDxScore,
        maxCombo: bestMaxCombo,
        combo: bestCombo,
        sync: bestSync,
        isAllPerfect: bestCombo === 'ap',
        isFullCombo: bestCombo === 'fc' || bestCombo === 'ap'
      };

      const finalRec = {
        sheetId: `${meta.title}__dxrt__${meta.type}__dxrt__${meta.difficulty}`,
        rawTitle: meta.rawTitle,
        title: meta.title,
        song_name: meta.rawTitle,
        type: meta.type,
        difficulty: meta.difficulty,
        hasExplicitDifficulty: true,
        level: meta.level || dominantRec.level || '',
        achievementRate: bestRate,
        scoreKey: dominantRec.scoreKey || 'achievementRate',
        comboFlag: bestCombo,
        syncFlag: bestSync,
        clearType: bestClearType,
        stats: mergedStats,
        originalNode: dominantRec.originalNode
      };

      mergedRecords.push(finalRec);
      scoreDeltas.push({
        title: meta.title,
        difficulty: meta.difficulty,
        type: meta.type,
        oldScore: oldRate,
        newScore: newRate,
        mergedScore: bestRate,
        status,
        comboFlag: bestCombo
      });

    } else if (rOld && !rNew) {
      oldOnlyCount++;
      mergedRecords.push(rOld);
      scoreDeltas.push({
        title: meta.title,
        difficulty: meta.difficulty,
        type: meta.type,
        oldScore: rOld.achievementRate,
        newScore: null,
        mergedScore: rOld.achievementRate,
        status: 'old_only',
        comboFlag: rOld.comboFlag
      });
    } else if (!rOld && rNew) {
      newOnlyCount++;
      mergedRecords.push(rNew);
      scoreDeltas.push({
        title: meta.title,
        difficulty: meta.difficulty,
        type: meta.type,
        oldScore: null,
        newScore: rNew.achievementRate,
        mergedScore: rNew.achievementRate,
        status: 'new_only',
        comboFlag: rNew.comboFlag
      });
    }
  }

  // 3. Build merged outputs
  const mergedData = buildMergedCacheBinaryObject(sourceNew, sourceOld, mergedRecords);
  const mergedDecodedJson = buildMergedDecodedJSON(mergedRecords);
  const mergedDXRating = buildMergedDXRatingJSON(mergedRecords, options);

  const stats = {
    totalOld: oldRecords.length,
    totalNew: newRecords.length,
    matchedCount,
    updatedCount: updatedFromOld,
    updatedFromOld,
    keptNewHigh,
    equalCount,
    preventedDowngrades: updatedFromOld + keptNewHigh,
    newChartsCount: newRecords.length,
    oldOnlyCount,
    newOnlyCount,
    unmatchedCount: oldOnlyCount,
    totalMerged: mergedRecords.length,
    scoreDeltas
  };

  return {
    mergedData,
    mergedDecodedJson,
    mergedDXRating,
    mergedRecords,
    stats
  };
}

/**
 * Backwards-compatible alias for existing code
 */
export function smartMergeCaches(oldCacheData, newCacheData, options = {}) {
  return smartMergeScores(oldCacheData, newCacheData, options);
}
