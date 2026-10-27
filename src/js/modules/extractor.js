/**
 * Score Extractor & Normalizer Module
 * Traverses AstroDX cache schemas to detect and extract song play records,
 * normalizing titles, difficulties, types, and achievement percentages.
 */

/**
 * Cleans charter / folder prefixes for DXRating song title matching.
 */
export function sanitizeTitle(rawTitle) {
  if (!rawTitle) return '';
  let title = String(rawTitle).trim();
  // Strip common charter prefixes: [DX], [STD], [宴], [Utage], [14+], etc.
  title = title.replace(/^\[(DX|STD|宴|Utage|\d+\+?|\w+)\]\s*/i, '');
  // Strip leading track numbers: e.g. "01. ", "001 - ", "1 "
  title = title.replace(/^\d+[\.\-_\s]+\s*/, '');
  return title.trim();
}

/**
 * Maps difficulty keys/values to standard AstroDX/DXRating difficulties:
 * basic, advanced, expert, master, remaster
 */
export function normalizeDifficulty(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).toLowerCase().trim();
  if (s === '0' || s === 'basic' || s === 'bas' || s === 'white' || s === 'easy') return 'basic';
  if (s === '1' || s === 'advanced' || s === 'adv' || s === 'green') return 'advanced';
  if (s === '2' || s === 'expert' || s === 'exp' || s === 'yellow') return 'expert';
  if (s === '3' || s === 'master' || s === 'mas' || s === 'red') return 'master';
  if (s === '4' || s === 'remaster' || s === 're:master' || s === 're_master' || s === 'purple' || s === '宴' || s === 'utage') return 'remaster';
  return null;
}

/**
 * Fallback difficulty inference based on typical maimai rating level brackets.
 */
export function inferDifficultyFromLevel(level) {
  if (!level) return 'master';
  const cleanLvl = String(level).replace('+', '').trim();
  const num = parseFloat(cleanLvl);
  if (isNaN(num)) return 'master';
  if (num <= 5) return 'basic';
  if (num <= 8) return 'advanced';
  if (num <= 12) return 'expert';
  return 'master';
}

/**
 * Normalizes chart type: 'std' or 'dx'
 */
export function normalizeType(val, titleContext) {
  if (val) {
    const s = String(val).toLowerCase().trim();
    if (s === 'std' || s === 'standard' || s === 'sd') return 'std';
    if (s === 'dx' || s === 'deluxe') return 'dx';
  }
  // Check if title has [STD] or [DX]
  if (titleContext && /\[std\]/i.test(titleContext)) return 'std';
  return 'dx'; // AstroDX / maimai DX default
}

/**
 * Normalizes achievement rate to percentage (0 - 101.0000)
 */
export function normalizeAchievement(rawVal) {
  if (typeof rawVal !== 'number' && typeof rawVal !== 'string') return 0;
  let num = parseFloat(rawVal);
  if (isNaN(num) || num <= 0) return 0;

  // If stored as integer representation (e.g. 1005123 = 100.5123%)
  if (num > 1000) {
    num = num / 10000;
  } 
  // If stored as ratio (e.g. 1.005123 or 0.9950)
  else if (num <= 1.01) {
    num = num * 100;
  }

  // Cap at maimai DX theoretical maximum: 101.0000%
  if (num > 101.0) num = 101.0;

  return Math.round(num * 10000) / 10000;
}

/**
 * Recursively traverses cacheData to extract all played records.
 */
export function extractRecords(cacheData, options = { cleanTitle: true }) {
  const records = [];
  let scannedChartsCount = 0;

  // Fast-path: already exported simple JSON array (cache_decrypted.json format)
  if (Array.isArray(cacheData) && cacheData.length > 0 && (cacheData[0].song_name !== undefined || cacheData[0].songName !== undefined)) {
    for (let i = 0; i < cacheData.length; i++) {
      const item = cacheData[i];
      if (!item || typeof item !== 'object') continue;
      const rawTitle = item.song_name || item.songName || item.title || 'Unknown Track';
      const clean = options.cleanTitle ? sanitizeTitle(rawTitle) : rawTitle;
      const normRate = normalizeAchievement(item.achievement !== undefined ? item.achievement : item.achievementRate);
      if (normRate <= 0) continue;

      const hasExplicitDifficulty = (item.difficulty !== undefined && item.difficulty !== null) ||
                                    (item.diff !== undefined && item.diff !== null) ||
                                    (item.alias !== undefined && item.alias !== null);
      const rawDiff = hasExplicitDifficulty ? normalizeDifficulty(item.difficulty || item.diff || item.alias) : null;
      const level = item.level !== undefined ? String(item.level) : '';
      const diff = rawDiff || inferDifficultyFromLevel(level);
      const type = normalizeType(item.type, rawTitle);
      const sheetId = `${clean}__dxrt__${type}__dxrt__${diff}`;
      const stats = item.stats || item;

      records.push({
        sheetId,
        rawTitle,
        title: clean,
        song_name: rawTitle,
        type,
        difficulty: diff,
        hasExplicitDifficulty,
        level,
        achievementRate: normRate,
        scoreKey: 'achievement',
        rawPath: [i],
        stats,
        originalNode: stats
      });
      scannedChartsCount++;
    }
    return { records, scannedChartsCount };
  }

  function getBasename(pathStr) {
    if (!pathStr) return '';
    const parts = String(pathStr).replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function traverse(node, context) {
    if (!node || typeof node !== 'object') return;

    // Check if current node is a score/chart record
    const keys = Object.keys(node);
    const lowerKeyMap = {};
    for (const k of keys) {
      lowerKeyMap[k.toLowerCase()] = k;
    }

    // Detect song title clues at current level
    let currentTitle = context.title;
    const titleKey = lowerKeyMap['title'] || lowerKeyMap['name'] || lowerKeyMap['songname'] || lowerKeyMap['song_name'] || lowerKeyMap['musicname'];
    if (titleKey && typeof node[titleKey] === 'string' && node[titleKey].trim()) {
      currentTitle = node[titleKey].trim();
    }

    // Detect chart type
    let currentType = context.type;
    const typeKey = lowerKeyMap['type'] || lowerKeyMap['charttype'] || lowerKeyMap['gametype'];
    if (typeKey && node[typeKey]) {
      currentType = normalizeType(node[typeKey], currentTitle);
    }

    // Detect difficulty clue (supports difficulty, diff, levelindex, alias)
    let currentDiff = context.difficulty;
    const diffKey = lowerKeyMap['alias'] || lowerKeyMap['difficulty'] || lowerKeyMap['diff'] || lowerKeyMap['levelindex'];
    if (diffKey && node[diffKey] !== undefined) {
      currentDiff = normalizeDifficulty(node[diffKey]);
    }

    // Detect level value (e.g. "13", "13+", "14")
    let currentLevel = context.level || '';
    const levelKey = lowerKeyMap['value'] || lowerKeyMap['level'] || lowerKeyMap['diffvalue'];
    if (levelKey && node[levelKey] !== undefined && typeof node[levelKey] !== 'object') {
      currentLevel = String(node[levelKey]);
    }

    // Check for score/achievement value
    const scoreKey = lowerKeyMap['achievement'] || 
                     lowerKeyMap['achievements'] || 
                     lowerKeyMap['achievementrate'] || 
                     lowerKeyMap['score'] || 
                     lowerKeyMap['bestscore'] || 
                     lowerKeyMap['scores'] || 
                     lowerKeyMap['rate'];

    let hasScore = false;
    let rawScoreVal = 0;

    if (scoreKey && (typeof node[scoreKey] === 'number' || typeof node[scoreKey] === 'string')) {
      rawScoreVal = node[scoreKey];
      hasScore = true;
    }

    if (hasScore) {
      scannedChartsCount++;
      const normRate = normalizeAchievement(rawScoreVal);

      if (normRate > 0) {
        // Determine best title
        let title = currentTitle || getBasename(context.parentKey) || 'Unknown Track';
        const clean = options.cleanTitle ? sanitizeTitle(title) : title;
        const hasExplicitDifficulty = currentDiff !== null && currentDiff !== undefined;
        const diff = currentDiff || inferDifficultyFromLevel(currentLevel);
        const type = currentType || normalizeType(null, title);

        // Unique sheetId for DXRating.net
        const sheetId = `${clean}__dxrt__${type}__dxrt__${diff}`;
        const stats = node.stats || node;

        records.push({
          sheetId,
          rawTitle: title,
          title: clean,
          type,
          difficulty: diff,
          hasExplicitDifficulty,
          level: currentLevel,
          achievementRate: normRate,
          scoreKey: scoreKey,
          rawPath: [...context.path],
          stats,
          originalNode: node
        });
      }
    }

    // Traverse children
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const item = node[i];
        let itemDiff = currentDiff;
        let itemLevel = currentLevel;
        if (item && typeof item === 'object') {
          const itemAlias = item.alias || item.difficulty || item.diff;
          if (itemAlias !== undefined) {
            itemDiff = normalizeDifficulty(itemAlias);
          } else if (i <= 4 && !itemDiff) {
            itemDiff = normalizeDifficulty(i);
          }
          if (item.value !== undefined) {
            itemLevel = String(item.value);
          } else if (item.level !== undefined) {
            itemLevel = String(item.level);
          }
        }
        traverse(item, {
          title: currentTitle,
          type: currentType,
          difficulty: itemDiff,
          level: itemLevel,
          parentKey: String(i),
          path: [...context.path, i]
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

          traverse(node[k], {
            title: currentTitle || (isNaN(k) ? getBasename(k) : null),
            type: currentType,
            difficulty: childDiff,
            level: currentLevel,
            parentKey: k,
            path: [...context.path, k]
          });
        }
      }
    }
  }

  traverse(cacheData, {
    title: null,
    type: null,
    difficulty: null,
    level: '',
    parentKey: '',
    path: []
  });

  return { records, scannedChartsCount };
}
