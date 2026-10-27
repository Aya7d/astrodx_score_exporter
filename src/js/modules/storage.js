/**
 * Local Cache Storage Module (IndexedDB)
 * Allows the browser to securely remember the user's AstroDX cache, DXRA,
 * or decoded scores across sessions with zero external dependencies.
 */

const DB_NAME = 'astrodx_storage_db';
const DB_VERSION = 1;
const STORE_NAME = 'user_cache_store';
const RECORD_KEY = 'active_cache';
const PREF_KEY_REMEMBER = 'astrodx_pref_remember_cache';

let dbInstance = null;

/**
 * Initializes and opens the IndexedDB database.
 * Returns a Promise that resolves to the IDBDatabase instance.
 */
export function initDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('[Storage] IndexedDB not available in this environment.');
      return resolve(null);
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };

      request.onerror = (e) => {
        console.warn('[Storage] IndexedDB open error:', e.target.error);
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('[Storage] IndexedDB blocked.');
        resolve(null);
      };
    } catch (err) {
      console.warn('[Storage] IndexedDB initialization failed:', err);
      resolve(null);
    }
  });
}

/**
 * Checks whether the user preference for remembering cache is enabled.
 * Defaults to true.
 */
export function isRememberCacheEnabled() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(PREF_KEY_REMEMBER);
      return val !== 'false';
    }
  } catch (e) {
    // LocalStorage blocked
  }
  return true;
}

/**
 * Updates the user preference for remembering cache.
 */
export function setRememberCacheEnabled(enabled) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PREF_KEY_REMEMBER, enabled ? 'true' : 'false');
    }
  } catch (e) {
    // Ignore
  }
}

/**
 * Saves a user cache entry into IndexedDB.
 *
 * @param {Object} param0
 * @param {ArrayBuffer|Uint8Array} param0.buffer - Raw binary or text buffer of the file
 * @param {string} param0.filename - Original filename (e.g. 'cache', 'dxrating_import.json')
 * @param {string} [param0.fileType] - Detected type ('cache_binary', 'dxra', 'decoded_json')
 * @param {number} param0.recordsCount - Number of extracted scores
 * @param {number} param0.scannedCount - Number of total scanned charts
 * @param {boolean} [param0.cleanTitle] - Whether clean title was enabled
 */
export async function saveUserCache({ buffer, filename, fileType = 'cache_binary', recordsCount = 0, scannedCount = 0, cleanTitle = true }) {
  if (!isRememberCacheEnabled()) {
    return false;
  }

  const db = await initDB();
  if (!db) {
    console.warn('[Storage] Cannot save cache: IndexedDB unavailable.');
    return false;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // Ensure buffer is stored as ArrayBuffer
      let storedBuffer = buffer;
      if (buffer instanceof Uint8Array) {
        storedBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      }

      const item = {
        id: RECORD_KEY,
        buffer: storedBuffer,
        filename: filename || 'cache',
        fileType,
        recordsCount,
        scannedCount,
        cleanTitle,
        savedAt: Date.now()
      };

      const putReq = store.put(item);

      putReq.onsuccess = () => resolve(true);
      putReq.onerror = (e) => {
        console.warn('[Storage] Failed to put item:', e.target.error);
        resolve(false);
      };
    } catch (err) {
      console.warn('[Storage] saveUserCache error:', err);
      resolve(false);
    }
  });
}

/**
 * Loads the remembered cache entry from IndexedDB.
 *
 * @returns {Promise<Object|null>}
 */
export async function loadUserCache() {
  if (!isRememberCacheEnabled()) {
    return null;
  }

  const db = await initDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(RECORD_KEY);

      getReq.onsuccess = () => {
        const result = getReq.result;
        if (result && result.buffer) {
          resolve(result);
        } else {
          resolve(null);
        }
      };

      getReq.onerror = () => resolve(null);
    } catch (err) {
      console.warn('[Storage] loadUserCache error:', err);
      resolve(null);
    }
  });
}

/**
 * Deletes the remembered cache entry from IndexedDB.
 */
export async function clearUserCache() {
  const db = await initDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const delReq = store.delete(RECORD_KEY);

      delReq.onsuccess = () => resolve(true);
      delReq.onerror = () => resolve(false);
    } catch (err) {
      console.warn('[Storage] clearUserCache error:', err);
      resolve(false);
    }
  });
}

/**
 * Formats a timestamp into a human-friendly relative or calendar time string.
 */
export function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Just now';
  const diffMs = Date.now() - Number(timestamp);
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
