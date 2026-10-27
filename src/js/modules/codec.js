/**
 * Binary Cache Codec Module
 * Handles AstroDX AES-256-ECB encrypted Base64 cache files (ReflektoneEncrypt),
 * raw Deflate (C# System.IO.Compression.DeflateStream), zlib/gzip,
 * and JSON decoding and encoding for AstroDX cache files.
 */

// AstroDX AES-256 static encryption key recovered from ReflektoneEncrypt..cctor
export const ASTRODX_AES_KEY_STRING = '94625184621352165487465213218452';

/**
 * Helper to safely resolve CryptoJS in browser globals or module contexts
 */
function getCryptoJS() {
  if (typeof window !== 'undefined' && window.CryptoJS && window.CryptoJS.AES) return window.CryptoJS;
  if (typeof globalThis !== 'undefined' && globalThis.CryptoJS && globalThis.CryptoJS.AES) return globalThis.CryptoJS;
  if (typeof CryptoJS !== 'undefined' && CryptoJS.AES) return CryptoJS;
  return null;
}

/**
 * Decodes an AstroDX cache binary buffer or string into a JavaScript object.
 * Strategies tested in order:
 * 1. AstroDX AES-256-ECB encrypted Base64 string (AstroDX 2.2+ default)
 * 2. pako.inflateRaw (C# System.IO.Compression.DeflateStream)
 * 3. pako.inflate (Standard zlib / gzip with header)
 * 4. Plain UTF-8 JSON text
 */
export function decodeCacheFile(inputBuffer) {
  let uint8Array;
  if (typeof inputBuffer === 'string') {
    uint8Array = new TextEncoder().encode(inputBuffer);
  } else if (inputBuffer instanceof Uint8Array) {
    uint8Array = inputBuffer;
  } else if (inputBuffer && inputBuffer.buffer instanceof ArrayBuffer) {
    uint8Array = new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset || 0, inputBuffer.byteLength);
  } else if (inputBuffer instanceof ArrayBuffer) {
    uint8Array = new Uint8Array(inputBuffer);
  } else {
    throw new Error('Invalid input format provided to decodeCacheFile');
  }

  // Strategy 1: AstroDX AES-256-ECB Encrypted Base64 (AstroDX 2.2+)
  try {
    const rawText = new TextDecoder('utf-8').decode(uint8Array);
    // Strip BOM and any non-base64 characters
    let cleanBase64 = rawText.replace(/^\uFEFF/, '').replace(/[^A-Za-z0-9+/=]/g, '');
    while (cleanBase64.length % 4 !== 0) {
      cleanBase64 += '=';
    }

    if (cleanBase64.length >= 32) {
      const cryptoLib = getCryptoJS();
      if (cryptoLib && cryptoLib.AES) {
        const key = cryptoLib.enc.Utf8.parse(ASTRODX_AES_KEY_STRING);
        const decrypted = cryptoLib.AES.decrypt(cleanBase64, key, {
          mode: cryptoLib.mode.ECB,
          padding: cryptoLib.pad.Pkcs7
        });
        const decryptedStr = decrypted.toString(cryptoLib.enc.Utf8);
        if (decryptedStr && (decryptedStr.startsWith('{') || decryptedStr.startsWith('['))) {
          return JSON.parse(decryptedStr);
        }
      } else {
        console.warn('[Codec] CryptoJS AES not yet loaded on window/globalThis.');
      }
    }
  } catch (eAes) {
    console.warn('[Codec] Strategy 1 (AES-256-ECB) attempted and bypassed:', eAes);
  }

  // Strategy 2: pako.inflateRaw (Matches C# System.IO.Compression.DeflateStream)
  try {
    if (typeof pako !== 'undefined' && pako.inflateRaw) {
      const decompressedStr = pako.inflateRaw(uint8Array, { to: 'string' });
      return JSON.parse(decompressedStr);
    }
  } catch (e1) {
    // Continue to next fallback
  }

  // Strategy 3: pako.inflate (Standard zlib / gzip with header)
  try {
    if (typeof pako !== 'undefined' && pako.inflate) {
      const decompressedStr = pako.inflate(uint8Array, { to: 'string' });
      return JSON.parse(decompressedStr);
    }
  } catch (e2) {
    // Continue to next fallback
  }

  // Strategy 4: Plain UTF-8 JSON text (e.g. if user uploads already decoded cache)
  try {
    const text = new TextDecoder('utf-8').decode(uint8Array);
    return JSON.parse(text);
  } catch (e3) {
    throw new Error('Failed to decode cache file. The file is neither valid AstroDX encrypted cache, Deflate binary, nor readable JSON.');
  }
}

/**
 * Compresses/Encrypts a JavaScript object into a Blob named 'cache'.
 * Supports 'encrypted' (AstroDX 2.2+ default), 'deflate' (raw Deflate), and 'json'.
 */
export function encodeCacheFile(jsonObject, options = { format: 'encrypted' }) {
  const format = options && options.format ? options.format : 'encrypted';
  const jsonStr = JSON.stringify(jsonObject);

  if (format === 'encrypted') {
    const cryptoLib = getCryptoJS();
    if (!cryptoLib || !cryptoLib.AES) {
      throw new Error('CryptoJS AES library is not loaded.');
    }
    const key = cryptoLib.enc.Utf8.parse(ASTRODX_AES_KEY_STRING);
    const encryptedBase64 = cryptoLib.AES.encrypt(jsonStr, key, {
      mode: cryptoLib.mode.ECB,
      padding: cryptoLib.pad.Pkcs7
    }).toString();
    return new Blob([encryptedBase64], { type: 'text/plain;charset=utf-8' });
  }

  if (format === 'deflate') {
    if (typeof pako === 'undefined' || !pako.deflateRaw) {
      throw new Error('Pako compression library is not loaded.');
    }
    const utf8Bytes = new TextEncoder().encode(jsonStr);
    const compressed = pako.deflateRaw(utf8Bytes, { level: 6 });
    return new Blob([compressed], { type: 'application/octet-stream' });
  }

  // Raw JSON
  return new Blob([JSON.stringify(jsonObject, null, 2)], { type: 'application/json;charset=utf-8' });
}
