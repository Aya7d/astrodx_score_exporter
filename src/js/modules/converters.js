/**
 * Multi-Format Conversion Engine & Maimai DX Database Matcher
 * Converts AstroDX cache exports (both raw cache records and cache_decrypted.json format)
 * into official platform schemas, defaulting to DXRating.net import format (example_dxrating_export.json).
 *
 * Supports all maimai DX versions & regions (Global, International, Japan, and classic/legacy) with chart metadata & level overrides.
 */

import { inferDifficultyFromLevel, normalizeType } from './extractor.js';

// In-memory song database cache
let maimaiDatabase = null;
let dbLoadPromise = null;

// Common charter prefix/suffix patterns and Windows filesystem sanitize mappings
const KNOWN_ALIASES = {
  'refrain (for 7th heaven)': 'Ref:rain (for 7th Heaven)',
  'happppy song feat. kagamine len': 'Happppy song',
  'ref:rain': 'Ref:rain (for 7th Heaven)'
};

/**
 * Loads the compiled maimai DX song database (src/data/maimai_db.json).
 */
export async function loadMaimaiDB() {
  if (maimaiDatabase) return maimaiDatabase;
  if (dbLoadPromise) return dbLoadPromise;

  dbLoadPromise = (async () => {
    try {
      // Browser environment fetch
      if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
        const res = await fetch('./src/data/maimai_db.json');
        if (res.ok) {
          maimaiDatabase = await res.json();
          return maimaiDatabase;
        }
      }
    } catch (e) {
      console.warn('[Converters] Browser fetch for maimai_db.json failed:', e);
    }

    // Node.js fallback (for testing and CLI environments)
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const dbPath = path.resolve('src/data/maimai_db.json');
        if (fs.existsSync(dbPath)) {
          maimaiDatabase = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
          return maimaiDatabase;
        }
      } catch (err) {
        console.warn('[Converters] Node fs read for maimai_db.json failed:', err);
      }
    }

    maimaiDatabase = {};
    return maimaiDatabase;
  })();

  return dbLoadPromise;
}

/**
 * Returns currently loaded database (or empty object if not yet loaded).
 */
export function getMaimaiDB() {
  return maimaiDatabase || {};
}

/**
 * Manually injects database object (useful for tests or preloading).
 */
export function setMaimaiDB(db) {
  maimaiDatabase = db;
}

/**
 * Normalizes title string by stripping charter tags, utage markers, and Unicode quirks.
 */
export function cleanSongTitle(rawTitle) {
  if (!rawTitle) return '';
  let title = String(rawTitle).trim();

  // Unicode NFKC normalization (turns fullwidth characters and combined accents into standard forms)
  if (typeof title.normalize === 'function') {
    title = title.normalize('NFKC');
  }

  // Replace curly quotation marks and apostrophes
  title = title.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // Strip charter/utage/genre bracket tags: e.g. [DX], [STD], [音], [ST], [宴], [Utage], [13+?], etc.
  title = title.replace(/\[(dx|std|音|st|宴|utage|1\d\+?|.*?)\]/gi, '');
  title = title.replace(/\((dx|std|st|deluxe|standard)\)/gi, '');
  title = title.replace(/でらっくす譜面|でらっくす/g, '');

  // Strip leading track numbers: "01. ", "001 - ", etc.
  title = title.replace(/^\d+[\.\-_\s]+\s*/, '');

  return title.trim();
}

/**
 * Normalizes difficulty label into standard 5 maimai DX difficulties:
 * 'basic', 'advanced', 'expert', 'master', 'remaster'
 */
export function normalizeDifficultyName(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).toLowerCase().trim();
  if (s === '0' || s === 'basic' || s === 'bas' || s === 'easy' || s === 'white') return 'basic';
  if (s === '1' || s === 'advanced' || s === 'adv' || s === 'green') return 'advanced';
  if (s === '2' || s === 'expert' || s === 'exp' || s === 'yellow') return 'expert';
  if (s === '3' || s === 'master' || s === 'mas' || s === 'red') return 'master';
  if (s === '4' || s === 'remaster' || s === 're:master' || s === 're_master' || s === 'purple' || s === '宴' || s === 'utage') return 'remaster';
  return null;
}

/**
 * Finds the official song entry in the maimai database.
 */
export function findOfficialSong(rawName, db = maimaiDatabase) {
  if (!db || Object.keys(db).length === 0) return null;

  const cleaned = cleanSongTitle(rawName);
  const cleanLower = cleaned.toLowerCase();

  // 1. Direct match with alias table
  if (KNOWN_ALIASES[cleanLower] && db[KNOWN_ALIASES[cleanLower]]) {
    return { title: KNOWN_ALIASES[cleanLower], ...db[KNOWN_ALIASES[cleanLower]] };
  }

  // 2. Direct exact title match in database
  if (db[rawName]) {
    return { title: rawName, ...db[rawName] };
  }
  if (db[cleaned]) {
    return { title: cleaned, ...db[cleaned] };
  }

  // 3. Case-insensitive lookup across database keys
  for (const [title, entry] of Object.entries(db)) {
    const dbCleanLower = cleanSongTitle(title).toLowerCase();
    if (dbCleanLower === cleanLower) {
      return { title, ...entry };
    }
  }

  // 4. Try stripping all parentheses/brackets completely
  const stripped = rawName.replace(/\[.*?\]|\(.*?\)/g, '').trim();
  const strippedCleanLower = cleanSongTitle(stripped).toLowerCase();
  for (const [title, entry] of Object.entries(db)) {
    const dbCleanLower = cleanSongTitle(title).toLowerCase();
    if (dbCleanLower === strippedCleanLower) {
      return { title, ...entry };
    }
  }

  // 5. Fuzzy substring matching for titles with charter notes appended
  for (const [title, entry] of Object.entries(db)) {
    const dbCleanLower = cleanSongTitle(title).toLowerCase();
    if (dbCleanLower.length >= 4 && (cleanLower.includes(dbCleanLower) || dbCleanLower.includes(cleanLower))) {
      return { title, ...entry };
    }
  }

  return null;
}

/**
 * Matches a specific score record to the best chart sheet (std/dx and difficulty).
 */
export function findBestSheet(song, record, options = {}) {
  const sheets = song && song.sheets ? song.sheets : [];
  if (sheets.length === 0) return null;

  const server = options.server || 'all';
  const targetLevel = String(record.level || record.diffLevel || '').trim();
  const stats = record.stats || (record.originalNode && record.originalNode.stats ? record.originalNode.stats : record.originalNode) || {};
  const targetNotes = stats.totalNotesCount || record.totalNotesCount || 0;

  const nameHint = String(record.song_name || record.rawTitle || record.title || '');
  const isStdHint = /\[(std|st|standard)\]|\((std|st|standard)\)|\b(std|st|standard)\b/i.test(nameHint);
  const isDxHint = /\[(dx|deluxe)\]|\((dx|deluxe)\)|でらっくす|\b(dx|deluxe)\b/i.test(nameHint);

  const hasExplicitDiff = record.hasExplicitDifficulty !== false && record.hasExplicitDifficulty !== undefined;
  const diffHint = hasExplicitDiff ? normalizeDifficultyName(record.difficulty || record.diffName || record.alias) : null;

  let bestSheet = null;
  let maxScore = -999;

  for (const sheet of sheets) {
    let score = 0;
    const sType = sheet.type; // 'std' or 'dx'
    const sDiff = sheet.diff; // 'basic', 'advanced', 'expert', 'master', 'remaster'
    const sLevel = String(sheet.level || '').trim();
    const sNotes = sheet.notes || 0;
    const sIntlLevel = sheet.intlLevel ? String(sheet.intlLevel).trim() : sLevel;
    const sIntlNotes = sheet.intlNotes ? sheet.intlNotes : sNotes;

    // 1. Difficulty hint match (highest confidence if explicitly provided)
    if (diffHint) {
      if (diffHint === sDiff) {
        score += 100;
      } else {
        score -= 50;
      }
    }

    // 2. Exact level match
    if (targetLevel) {
      if (server === 'intl') {
        if (targetLevel === sIntlLevel) score += 50;
        else if (targetLevel.replace('+', '') === sIntlLevel.replace('+', '')) score += 20;
      } else if (server === 'jp') {
        if (targetLevel === sLevel) score += 50;
        else if (targetLevel.replace('+', '') === sLevel.replace('+', '')) score += 20;
      } else {
        // 'all' / global: matches if either matches!
        if (targetLevel === sLevel || targetLevel === sIntlLevel) score += 50;
        else if (targetLevel.replace('+', '') === sLevel.replace('+', '') || targetLevel.replace('+', '') === sIntlLevel.replace('+', '')) score += 20;
      }
    }

    // 3. Chart type hint match
    if (isStdHint && sType === 'std') score += 35;
    else if (isDxHint && sType === 'dx') score += 35;
    else if (record.type === sType) score += 10;

    // 4. Note count proximity
    if (targetNotes > 0) {
      let minDiff;
      if (server === 'intl') {
        minDiff = Math.abs(targetNotes - sIntlNotes);
      } else if (server === 'jp') {
        minDiff = Math.abs(targetNotes - sNotes);
      } else {
        minDiff = Math.min(
          Math.abs(targetNotes - sNotes),
          Math.abs(targetNotes - sIntlNotes)
        );
      }

      if (minDiff === 0) score += 40;
      else if (minDiff <= 5) score += 30;
      else if (minDiff <= 20) score += 15;
      else if (minDiff > 100) score -= 30;
    }

    // 5. Region availability priority if a specific server was selected
    if (server === 'intl' && sheet.inIntl) score += 5;
    else if (server === 'jp' && sheet.inJp) score += 5;

    if (score > maxScore) {
      maxScore = score;
      bestSheet = sheet;
    }
  }

  return bestSheet;
}

/**
 * Extracts comboFlag ('ap', 'fc', or null) from clearType and note counts.
 * Matches official example_dxrating_export.json conventions.
 */
export function deriveComboFlag(clearType, stats = {}) {
  // ClearType enum mapping in AstroDX:
  // 5: AP/AP+, 4: FC+, 3: FC, 2: Clear, 1: Failed, 0: None
  const ct = Number(clearType);
  if (ct >= 5) return 'ap';
  if (ct === 4 || ct === 3) return 'fc';

  // Fallback to note judgments if clearType was 0 or not set
  const total = stats.totalNotesCount || 0;
  if (total > 0) {
    const crit = stats.criticalCount || 0;
    const perf = stats.perfectCount || 0;
    const grt = stats.greatCount || 0;
    const gd = stats.goodCount || 0;
    const miss = total - (crit + perf + grt + gd);

    if (miss === 0) {
      if (grt === 0 && gd === 0) return 'ap';
      return 'fc';
    }
  }

  return null;
}

/**
 * Extracts syncFlag ('sync', 'fs', or null) for DXRating export.
 */
export function deriveSyncFlag(clearType, stats = {}, options = {}) {
  if (options.defaultSyncFlag !== undefined) {
    return options.defaultSyncFlag;
  }
  const ct = Number(clearType);
  // In example_dxrating_export.json, cleared plays (clearType >= 2) usually mark 'sync'
  if (ct >= 2) return 'sync';
  return null;
}

/**
 * Converts records into DXRating format matching example_dxrating_export.json.
 *
 * @param {Array} records - Array of played records (either from extractor.js or cache_decrypted.json)
 * @param {Object} options - { server: 'intl' | 'jp', defaultSyncFlag, cleanTitle }
 * @returns {Array} Converted deduplicated records in DXRating schema
 */
export function convertToDXRating(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const db = getMaimaiDB();
  const map = new Map();

  for (const item of records) {
    const rawName = item.song_name || item.rawTitle || item.title || 'Unknown Track';
    const clean = cleanSongTitle(rawName);

    // Normalize achievement percentage
    let rawRate = item.achievement !== undefined ? item.achievement : item.achievementRate;
    if (typeof rawRate !== 'number') {
      rawRate = parseFloat(rawRate) || 0;
    }
    // Cap at 101.0000%
    if (rawRate > 101.0) rawRate = 101.0;
    const achRate = Math.round(rawRate * 10000) / 10000;
    if (achRate <= 0) continue;

    const stats = item.stats || 
                  (item.originalNode && item.originalNode.stats ? item.originalNode.stats : item.originalNode) || 
                  {};
    const clearType = stats.clearType !== undefined ? stats.clearType : 
                      (item.clearType !== undefined ? item.clearType : 
                      (item.originalNode && item.originalNode.clearType !== undefined ? item.originalNode.clearType : 0));

    const comboFlag = deriveComboFlag(clearType, stats);
    const syncFlag = deriveSyncFlag(clearType, stats, options);

    // SheetId matching against official database
    let sheetId = null;
    const officialSong = findOfficialSong(rawName, db);

    if (officialSong) {
      const bestSheet = findBestSheet(officialSong, item, options);
      if (bestSheet) {
        sheetId = `${officialSong.title}__dxrt__${bestSheet.type}__dxrt__${bestSheet.diff}`;
      } else {
        const fallbackDiff = normalizeDifficultyName(item.difficulty) || inferDifficultyFromLevel(item.level) || 'master';
        const fallbackType = normalizeType(item.type, rawName, { level: item.level, difficulty: fallbackDiff, songTitle: officialSong.title });
        sheetId = `${officialSong.title}__dxrt__${fallbackType}__dxrt__${fallbackDiff}`;
      }
    } else {
      // Unmatched or community custom chart: preserve clean title and chart clues
      const fallbackDiff = normalizeDifficultyName(item.difficulty) || inferDifficultyFromLevel(item.level) || 'master';
      const fallbackType = normalizeType(item.type, rawName, { level: item.level, difficulty: fallbackDiff, songTitle: clean });
      sheetId = `${clean}__dxrt__${fallbackType}__dxrt__${fallbackDiff}`;
    }

    // Deduplicate by sheetId: retain highest achievement rate and best comboFlag
    const existing = map.get(sheetId);
    if (!existing) {
      map.set(sheetId, {
        sheetId,
        achievementRate: achRate,
        comboFlag,
        syncFlag
      });
    } else {
      let bestCombo = existing.comboFlag;
      if (comboFlag === 'ap') bestCombo = 'ap';
      else if (comboFlag === 'fc' && bestCombo !== 'ap') bestCombo = 'fc';

      map.set(sheetId, {
        sheetId,
        achievementRate: Math.max(existing.achievementRate, achRate),
        comboFlag: bestCombo,
        syncFlag: existing.syncFlag || syncFlag
      });
    }
  }

  return Array.from(map.values());
}

// ============================================================================
// Extensible Converter Registry
// ============================================================================

const CONVERTER_REGISTRY = {
  dxrating: {
    id: 'dxrating',
    name: 'DXRating.net Format',
    description: 'Official JSON format matching dxrating.net import specifications',
    extension: 'json',
    mimeType: 'application/json',
    filename: 'dxrating_import.json',
    convert: convertToDXRating
  }
};

/**
 * Registers a new converter profile for future export targets.
 */
export function registerConverter(id, config) {
  if (!id || typeof config !== 'object' || typeof config.convert !== 'function') {
    throw new Error('Invalid converter configuration');
  }
  CONVERTER_REGISTRY[id] = { id, ...config };
}

/**
 * Returns a specific converter by ID.
 */
export function getConverter(id) {
  return CONVERTER_REGISTRY[id] || CONVERTER_REGISTRY['dxrating'];
}

/**
 * Returns all registered converter profiles.
 */
export function getAllConverters() {
  return Object.values(CONVERTER_REGISTRY);
}

/**
 * Universal record converter function.
 */
export function convertRecords(records, formatId = 'dxrating', options = {}) {
  const converter = getConverter(formatId);
  return converter.convert(records, options);
}
