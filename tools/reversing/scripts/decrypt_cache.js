const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const raw = fs.readFileSync('data/samples/cache', 'utf8').replace(/\s+/g, '');
const cipher = Buffer.from(raw, 'base64');
const key = Buffer.from('94625184621352165487465213218452', 'utf8');

console.log('Cipher len:', cipher.length, 'Key len:', key.length);

for (const algo of ['aes-256-ecb', 'aes-256-cbc']) {
    try {
        const decipher = crypto.createDecipheriv(algo, key, algo.includes('cbc') ? Buffer.alloc(16, 0) : null);
        decipher.setAutoPadding(true);
        const dec = Buffer.concat([decipher.update(cipher), decipher.final()]);
        console.log(`Successfully decrypted with ${algo} (PKCS7 auto-padding)! Decrypted len: ${dec.length}`);
        console.log('First 100 bytes (hex):', dec.subarray(0, 100).toString('hex'));
        console.log('First 100 bytes (utf8):', dec.subarray(0, 100).toString('utf8'));
        
        // Try parsing JSON directly
        try {
            const obj = JSON.parse(dec.toString('utf8'));
            console.log('JSON parse direct SUCCESS! Keys:', Object.keys(obj));
        } catch (e) {
            console.log('JSON direct failed:', e.message);
            // Try zlib
            try {
                const unz = zlib.inflateSync(dec);
                console.log('ZLIB SUCCESS! Uncompressed len:', unz.length);
                const obj = JSON.parse(unz.toString('utf8'));
                console.log('JSON parse after ZLIB SUCCESS! Keys:', Object.keys(obj));
            } catch (ez) {
                console.log('ZLIB failed:', ez.message);
                try {
                    const unzRaw = zlib.inflateRawSync(dec);
                    console.log('DEFLATE RAW SUCCESS! Uncompressed len:', unzRaw.length);
                    const obj = JSON.parse(unzRaw.toString('utf8'));
                    console.log('JSON parse after Deflate Raw SUCCESS! Keys:', Object.keys(obj));
                } catch (er) {
                    console.log('Deflate raw failed:', er.message);
                }
            }
        }
    } catch (e) {
        console.log(`${algo} error: ${e.message}`);
    }
}
