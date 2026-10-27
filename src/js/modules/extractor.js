/**
 * Score Extractor & Normalizer Module
 * Traverses AstroDX cache schemas to detect and extract song play records,
 * normalizing titles, difficulties, types, and achievement percentages.
 */

import { getMaimaiDB, findOfficialSong, cleanSongTitle } from './converters.js';

/**
 * Cleans charter / folder prefixes and tags for DXRating song title matching.
 * Strips [DX], [STD], [ST], (ST), (STD), (DX), Utage tags, leading numbers, etc.
 */
export function sanitizeTitle(rawTitle) {
  if (!rawTitle) return '';
  let title = String(rawTitle).trim();

  // Unicode NFKC normalization
  if (typeof title.normalize === 'function') {
    title = title.normalize('NFKC');
  }

  title = title.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Strip charter/utage/genre bracket tags and prefixes/suffixes:
  // e.g. [DX], [STD], [音], [ST], [宴], [Utage], [13+?], (ST), (STD), (DX), (Deluxe), etc.
  title = title.replace(/^\[(DX|STD|音|ST|宴|Utage|\d+\+?|\w+)\]\s*/i, '');
  title = title.replace(/\s*\[(dx|std|音|st|宴|utage|1\d\+?|.*?)\]/gi, '');
  title = title.replace(/\s*\((dx|std|st|deluxe|standard)\)/gi, '');
  title = title.replace(/でらっくす譜面|でらっくす/g, '');

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
  // Standard names
  if (s === 'basic' || s === 'bas' || s === 'white' || s === 'easy') return 'basic';
  if (s === 'advanced' || s === 'adv' || s === 'green') return 'advanced';
  if (s === 'expert' || s === 'exp' || s === 'yellow') return 'expert';
  if (s === 'master' || s === 'mas' || s === 'red') return 'master';
  if (s === 'remaster' || s === 're:master' || s === 're_master' || s === 'purple' || s === '宴' || s === 'utage' || s === 'astral') return 'remaster';

  // AstroDX difficulty id mapping (1: Easy, 2: Basic, 3: Advanced, 4: Expert, 5: Master, 6: Re:Master, 7: Utage, 8: Astral)
  if (s === '5') return 'master';
  if (s === '4') return 'expert';
  if (s === '3') return 'advanced';
  if (s === '2') return 'basic';
  if (s === '1') return 'basic';
  if (s === '6' || s === '7' || s === '8') return 'remaster';
  if (s === '0') return 'basic'; // 0-indexed fallback
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
 * Utilizes explicit type, title/path hints ([ST], (ST), [STD], (STD)),
 * and maimai database sheet disambiguation (level/notes count matching).
 */
export function normalizeType(val, titleContext, chartMeta = {}) {
  if (val) {
    const s = String(val).toLowerCase().trim();
    if (s === 'std' || s === 'standard' || s === 'sd' || s === 'st') return 'std';
    if (s === 'dx' || s === 'deluxe') return 'dx';
  }

  // Check titleContext (which can be rawTitle, folder/path, etc.)
  if (titleContext) {
    const ctx = String(titleContext);
    if (/\[(std|st|standard)\]|\((std|st|standard)\)|\b(std|st|standard)\b/i.test(ctx)) {
      return 'std';
    }
    if (/\[(dx|deluxe)\]|\((dx|deluxe)\)|でらっくす|\b(dx|deluxe)\b/i.test(ctx)) {
      return 'dx';
    }
  }

  // Check chartMeta against official maimai database
  const db = getMaimaiDB();
  const songName = chartMeta.songTitle || (titleContext ? cleanSongTitle(titleContext) : null);
  if (songName && db && Object.keys(db).length > 0) {
    const song = findOfficialSong(songName, db);
    if (song && Array.isArray(song.sheets) && song.sheets.length > 0) {
      const types = new Set(song.sheets.map(s => s.type));
      if (types.has('std') && !types.has('dx')) return 'std';
      if (types.has('dx') && !types.has('std')) return 'dx';

      // Song has both DX and STD! Disambiguate by difficulty + level or note count
      const diff = chartMeta.diff || chartMeta.difficulty;
      const lvl = chartMeta.level ? String(chartMeta.level).trim() : null;
      const notes = chartMeta.notes || chartMeta.totalNotesCount || 0;

      if (diff) {
        const matchingSheets = song.sheets.filter(s => s.diff === diff);
        if (matchingSheets.length > 1) {
          if (lvl) {
            const exact = matchingSheets.find(s => s.level === lvl || s.intlLevel === lvl);
            if (exact) return exact.type;
          }
          if (notes > 0) {
            let bestSheet = null;
            let minDiff = 9999;
            for (const s of matchingSheets) {
              const d1 = Math.abs((s.notes || 0) - notes);
              const d2 = s.intlNotes ? Math.abs(s.intlNotes - notes) : d1;
              const d = Math.min(d1, d2);
              if (d < minDiff) {
                minDiff = d;
                bestSheet = s;
              }
            }
            if (bestSheet && minDiff <= 5) return bestSheet.type;
          }
        }
      }
    }
  }

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

  // Fast-path 1: DXRating JSON format array (each element has sheetId)
  if (Array.isArray(cacheData) && cacheData.length > 0 && cacheData[0] && cacheData[0].sheetId !== undefined) {
    for (let i = 0; i < cacheData.length; i++) {
      const item = cacheData[i];
      if (!item || typeof item !== 'object' || !item.sheetId) continue;
      const parts = String(item.sheetId).split('__dxrt__');
      const rawTitle = parts[0] || 'Unknown Track';
      const clean = options.cleanTitle ? sanitizeTitle(rawTitle) : rawTitle;
      let canonicalTitle = clean;
      if (options.cleanTitle) {
        const official = findOfficialSong(rawTitle) || findOfficialSong(clean);
        if (official && official.title) canonicalTitle = official.title;
      }
      const type = normalizeType(parts[1], rawTitle);
      const diff = normalizeDifficulty(parts[2]) || 'master';
      const normRate = normalizeAchievement(item.achievementRate !== undefined ? item.achievementRate : item.achievement);
      if (normRate <= 0) continue;

      let clearType = 0;
      if (item.comboFlag === 'ap') clearType = 5;
      else if (item.comboFlag === 'fc') clearType = 2;
      else if (normRate >= 80) clearType = 1;

      const sheetId = `${canonicalTitle}__dxrt__${type}__dxrt__${diff}`;
      const stats = {
        clearType,
        achievementRate: normRate,
        combo: item.comboFlag || null,
        isAllPerfect: item.comboFlag === 'ap',
        isFullCombo: item.comboFlag === 'fc' || item.comboFlag === 'ap'
      };

      records.push({
        sheetId,
        rawTitle,
        title: canonicalTitle,
        song_name: rawTitle,
        type,
        difficulty: diff,
        hasExplicitDifficulty: true,
        level: '',
        achievementRate: normRate,
        scoreKey: 'achievementRate',
        comboFlag: item.comboFlag || null,
        syncFlag: null,
        clearType,
        rawPath: [i],
        stats,
        originalNode: item
      });
      scannedChartsCount++;
    }
    return { records, scannedChartsCount };
  }

  // Fast-path 2: already exported simple JSON array (cache_decrypted.json format or decoded scores)
  if (Array.isArray(cacheData) && cacheData.length > 0 && (cacheData[0].song_name !== undefined || cacheData[0].songName !== undefined || cacheData[0].title !== undefined)) {
    for (let i = 0; i < cacheData.length; i++) {
      const item = cacheData[i];
      if (!item || typeof item !== 'object') continue;
      const rawTitle = item.song_name || item.songName || item.title || 'Unknown Track';
      const clean = options.cleanTitle ? sanitizeTitle(rawTitle) : rawTitle;
      let canonicalTitle = clean;
      if (options.cleanTitle) {
        const official = findOfficialSong(rawTitle) || findOfficialSong(clean);
        if (official && official.title) canonicalTitle = official.title;
      }
      const normRate = normalizeAchievement(item.achievement !== undefined ? item.achievement : (item.achievementRate !== undefined ? item.achievementRate : item.score));
      if (normRate <= 0) continue;

      const hasExplicitDifficulty = (item.difficulty !== undefined && item.difficulty !== null) ||
                                    (item.diff !== undefined && item.diff !== null) ||
                                    (item.alias !== undefined && item.alias !== null);
      const rawDiff = hasExplicitDifficulty ? normalizeDifficulty(item.difficulty || item.diff || item.alias) : null;
      const level = item.level !== undefined ? String(item.level) : '';
      const diff = rawDiff || inferDifficultyFromLevel(level);
      const rawStats = item.stats || item;
      const stats = { ...rawStats };
      delete stats.sync;
      delete stats.syncFlag;
      const type = normalizeType(item.type, rawTitle, {
        level,
        notes: stats.totalNotesCount,
        difficulty: diff,
        songTitle: canonicalTitle
      });
      const sheetId = `${canonicalTitle}__dxrt__${type}__dxrt__${diff}`;
      const clearType = stats.clearType !== undefined ? stats.clearType : (item.clearType !== undefined ? item.clearType : (normRate >= 80 ? 1 : 0));
      const comboFlag = item.comboFlag || (stats.isAllPerfect || clearType >= 4 ? 'ap' : (stats.isFullCombo || clearType >= 2 ? 'fc' : null));
      const syncFlag = null;

      records.push({
        sheetId,
        rawTitle,
        title: canonicalTitle,
        song_name: rawTitle,
        type,
        difficulty: diff,
        hasExplicitDifficulty,
        level,
        achievementRate: normRate,
        scoreKey: 'achievement',
        comboFlag,
        syncFlag: null,
        clearType,
        rawPath: [i],
        stats,
        originalNode: item
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

    // Detect path / folder clues
    let currentPath = context.pathName;
    const pathKey = lowerKeyMap['path'] || lowerKeyMap['folder'] || lowerKeyMap['directory'];
    if (pathKey && typeof node[pathKey] === 'string' && node[pathKey].trim()) {
      currentPath = node[pathKey].trim();
    }

    // Detect chart type clue at current level
    let currentType = context.type;
    const typeKey = lowerKeyMap['type'] || lowerKeyMap['charttype'] || lowerKeyMap['gametype'];
    if (typeKey && node[typeKey]) {
      currentType = normalizeType(node[typeKey], [currentTitle, currentPath].filter(Boolean).join(' '));
    }

    // Detect difficulty clue (supports alias, difficulty, diff, levelindex, id)
    let currentDiff = context.difficulty;
    if (node.id !== undefined && (node.stats !== undefined || node.hash !== undefined || node.CameFromSpace !== undefined || context.parentKey === 'difficulties' || !isNaN(context.parentKey))) {
      if (node.alias) currentDiff = normalizeDifficulty(node.alias);
      if (!currentDiff && node.id !== undefined) currentDiff = normalizeDifficulty(node.id);
    }
    const diffKey = lowerKeyMap['alias'] || lowerKeyMap['difficulty'] || lowerKeyMap['diff'] || lowerKeyMap['levelindex'] || lowerKeyMap['id'];
    if (!currentDiff && diffKey && node[diffKey] !== undefined) {
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

    // Detect sheetId format if present
    if (node.sheetId && typeof node.sheetId === 'string') {
      const parts = node.sheetId.split('__dxrt__');
      if (parts.length >= 3) {
        if (!currentTitle) currentTitle = parts[0];
        if (!currentType) currentType = normalizeType(parts[1], parts[0]);
        if (!currentDiff) currentDiff = normalizeDifficulty(parts[2]);
      }
    }

    if (hasScore) {
      scannedChartsCount++;
      const normRate = normalizeAchievement(rawScoreVal);

      if (normRate > 0) {
        // Determine best title
        let title = currentTitle || getBasename(currentPath) || getBasename(context.parentKey) || 'Unknown Track';
        const clean = options.cleanTitle ? sanitizeTitle(title) : title;
        let canonicalTitle = clean;
        if (options.cleanTitle) {
          const official = findOfficialSong(title) || findOfficialSong(clean);
          if (official && official.title) {
            canonicalTitle = official.title;
          }
        }

        const hasExplicitDifficulty = currentDiff !== null && currentDiff !== undefined;
        const diff = currentDiff || inferDifficultyFromLevel(currentLevel);
        const stats = node.stats || node;

        const titleContext = [title, currentPath, context.parentKey].filter(Boolean).join(' ');
        const type = currentType || normalizeType(
          node.type,
          titleContext,
          {
            level: currentLevel,
            notes: stats.totalNotesCount,
            difficulty: diff,
            songTitle: canonicalTitle
          }
        );

        // Unique sheetId for DXRating.net
        const sheetId = `${canonicalTitle}__dxrt__${type}__dxrt__${diff}`;
        const clearType = stats.clearType !== undefined ? stats.clearType : (node.clearType !== undefined ? node.clearType : (normRate >= 80 ? 1 : 0));
        const comboFlag = node.comboFlag || (stats.isAllPerfect || clearType >= 4 ? 'ap' : (stats.isFullCombo || clearType >= 2 ? 'fc' : null));
        const syncFlag = null;
        if (stats) {
          delete stats.sync;
          delete stats.syncFlag;
        }

        const diffId = node.id !== undefined ? node.id : (context.diffId !== undefined ? context.diffId : null);

        records.push({
          sheetId,
          rawTitle: title,
          title: canonicalTitle,
          type,
          difficulty: diff,
          diffId,
          hasExplicitDifficulty,
          level: currentLevel,
          achievementRate: normRate,
          scoreKey: scoreKey,
          comboFlag,
          syncFlag: null,
          clearType,
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
        let itemDiffId = context.diffId;
        if (item && typeof item === 'object') {
          if (item.id !== undefined) {
            itemDiffId = item.id;
          }
          const itemAlias = item.alias || item.difficulty || item.diff || item.id;
          if (itemAlias !== undefined && itemAlias !== null) {
            itemDiff = normalizeDifficulty(itemAlias);
          }
          if (item.value !== undefined) {
            itemLevel = String(item.value);
          } else if (item.level !== undefined) {
            itemLevel = String(item.level);
          }
        }
        traverse(item, {
          title: currentTitle,
          pathName: currentPath,
          type: currentType,
          difficulty: itemDiff,
          level: itemLevel,
          diffId: itemDiffId,
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

          const childDiffId = node.id !== undefined ? node.id : context.diffId;
          const childPath = (node[k] && typeof node[k] === 'object' && node[k].path) ? node[k].path : currentPath;

          traverse(node[k], {
            title: currentTitle || (isNaN(k) ? getBasename(k) : null),
            pathName: childPath,
            type: currentType,
            difficulty: childDiff,
            level: currentLevel,
            diffId: childDiffId,
            parentKey: k,
            path: [...context.path, k]
          });
        }
      }
    }
  }

  traverse(cacheData, {
    title: null,
    pathName: null,
    type: null,
    difficulty: null,
    level: '',
    parentKey: '',
    path: []
  });

  return { records, scannedChartsCount };
}
