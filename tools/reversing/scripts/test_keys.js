const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

// 1. Read string literals from global-metadata.dat
const metaBuf = fs.readFileSync('tools/reversing/dumps/global-metadata.dat');
const strLiteralOff = 380;
const strLiteralCount = 17323;
const strLiteralDataOff = 69672;

const literals = [];
for (let i = 0; i < strLiteralCount - 1; i++) {
    const off1 = metaBuf.readUInt32LE(strLiteralOff + i * 4);
    const off2 = metaBuf.readUInt32LE(strLiteralOff + (i + 1) * 4);
    if (off2 >= off1 && off2 - off1 <= 1024) {
        const slice = metaBuf.subarray(strLiteralDataOff + off1, strLiteralDataOff + off2);
        literals.push(slice);
    }
}
console.log(`Extracted ${literals.length} string literals.`);

// 2. Read cache file
const rawCache = fs.readFileSync('data/samples/cache', 'utf8').replace(/\s+/g, '');
const cacheBytes = Buffer.from(rawCache, 'base64');
console.log(`Cache decoded bytes: ${cacheBytes.length}`);

// We need more blocks for inflate to be confident
const sampleCipher = cacheBytes.subarray(0, 4096);

function tryDecrypt(cipher, key, iv = null, algo = 'aes-256-ecb') {
    try {
        const decipher = crypto.createDecipheriv(algo, key, iv);
        decipher.setAutoPadding(false);
        const dec = Buffer.concat([decipher.update(cipher), decipher.final()]);
        return dec;
    } catch (e) {
        return null;
    }
}

function checkDecrypted(dec) {
    if (!dec || dec.length < 32) return false;
    
    // Check direct JSON
    const s = dec.toString('utf8');
    if (s.startsWith('{"') || s.startsWith('[{')) {
        return 'JSON: ' + s.slice(0, 100);
    }
    
    // Check zlib
    try {
        const unz = zlib.inflateSync(dec);
        const us = unz.toString('utf8');
        if (unz.length > 50 && (us.includes('{') || us.includes('hash') || us.includes('version'))) {
            return 'ZLIB: ' + us.slice(0, 100);
        }
    } catch (e) {}
    
    try {
        const unz = zlib.inflateRawSync(dec);
        const us = unz.toString('utf8');
        if (unz.length > 50 && (us.includes('{') || us.includes('hash') || us.includes('version'))) {
            return 'DEFLATE_RAW: ' + us.slice(0, 100);
        }
    } catch (e) {}
    
    return false;
}

console.log(`Scanning string literals...`);
for (let i = 0; i < literals.length; i++) {
    const item = literals[i];
    const s = item.toString('utf8');
    
    const tests = [];
    if (item.length === 16) {
        tests.push({ key: item, algo: 'aes-128-ecb', iv: null, name: `raw-16-ecb(${s})` });
        tests.push({ key: item, algo: 'aes-128-cbc', iv: Buffer.alloc(16, 0), name: `raw-16-cbc-0(${s})` });
    }
    if (item.length === 32) {
        tests.push({ key: item, algo: 'aes-256-ecb', iv: null, name: `raw-32-ecb(${s})` });
        tests.push({ key: item, algo: 'aes-256-cbc', iv: Buffer.alloc(16, 0), name: `raw-32-cbc-0(${s})` });
    }
    if (item.length > 0 && item.length < 32) {
        const padded32 = Buffer.alloc(32, 0);
        item.copy(padded32, 0, 0, item.length);
        tests.push({ key: padded32, algo: 'aes-256-ecb', iv: null, name: `pad32-ecb(${s})` });
    }
    
    const sha = crypto.createHash('sha256').update(item).digest();
    tests.push({ key: sha, algo: 'aes-256-ecb', iv: null, name: `sha256-ecb(${s})` });
    tests.push({ key: sha, algo: 'aes-256-cbc', iv: Buffer.alloc(16, 0), name: `sha256-cbc-0(${s})` });
    
    const md5 = crypto.createHash('md5').update(item).digest();
    tests.push({ key: md5, algo: 'aes-128-ecb', iv: null, name: `md5-ecb(${s})` });
    
    for (const t of tests) {
        const dec = tryDecrypt(sampleCipher, t.key, t.iv, t.algo);
        const hit = checkDecrypted(dec);
        if (hit) {
            console.log(`\n================ SUCCESS ================`);
            console.log(`Matched with ${t.name}`);
            console.log(`Result: ${hit}`);
            process.exit(0);
        }
    }
}

console.log('No matches in string literals.');
