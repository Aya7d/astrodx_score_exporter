// Pure JS AES-256 (ECB Mode) with PKCS7 Padding
// Self-contained, zero-dependency, works in all browsers and Node.js

// Rijndael S-box and Inverse S-box
const SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = new Uint32Array([
    0x00000000, 0x01000000, 0x02000000, 0x04000000, 0x08000000,
    0x10000000, 0x20000000, 0x40000000, 0x80000000, 0x1b000000, 0x36000000
]);

// Galois Multiplication tables for MixColumns
function galoisMul(a, b) {
    let p = 0;
    for (let c = 0; c < 8; c++) {
        if (b & 1) p ^= a;
        const hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
    }
    return p;
}

// Precomputed multiplication tables for Decrypt MixColumns
const MUL_9 = new Uint8Array(256);
const MUL_11 = new Uint8Array(256);
const MUL_13 = new Uint8Array(256);
const MUL_14 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    MUL_9[i] = galoisMul(i, 9);
    MUL_11[i] = galoisMul(i, 11);
    MUL_13[i] = galoisMul(i, 13);
    MUL_14[i] = galoisMul(i, 14);
}

// Precomputed MixColumns tables for Encrypt
const MUL_2 = new Uint8Array(256);
const MUL_3 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    MUL_2[i] = galoisMul(i, 2);
    MUL_3[i] = galoisMul(i, 3);
}

function subWord(w) {
    return (SBOX[(w >>> 24) & 0xff] << 24) |
           (SBOX[(w >>> 16) & 0xff] << 16) |
           (SBOX[(w >>> 8) & 0xff] << 8) |
           SBOX[w & 0xff];
}

function rotWord(w) {
    return ((w << 8) | (w >>> 24)) >>> 0;
}

// Key expansion for AES-256 (Nk = 8, Nr = 14)
function keyExpansion256(keyBytes) {
    const w = new Uint32Array(60);
    for (let i = 0; i < 8; i++) {
        w[i] = ((keyBytes[4 * i] << 24) |
                (keyBytes[4 * i + 1] << 16) |
                (keyBytes[4 * i + 2] << 8) |
                keyBytes[4 * i + 3]) >>> 0;
    }
    for (let i = 8; i < 60; i++) {
        let temp = w[i - 1];
        if (i % 8 === 0) {
            temp = (subWord(rotWord(temp)) ^ RCON[i / 8]) >>> 0;
        } else if (i % 8 === 4) {
            temp = subWord(temp) >>> 0;
        }
        w[i] = (w[i - 8] ^ temp) >>> 0;
    }
    return w;
}

function decryptBlock(input, inOff, output, outOff, roundKeys) {
    // Initial round key
    let s0 = input[inOff] ^ ((roundKeys[56] >>> 24) & 0xff);
    let s1 = input[inOff + 1] ^ ((roundKeys[56] >>> 16) & 0xff);
    let s2 = input[inOff + 2] ^ ((roundKeys[56] >>> 8) & 0xff);
    let s3 = input[inOff + 3] ^ (roundKeys[56] & 0xff);

    let s4 = input[inOff + 4] ^ ((roundKeys[57] >>> 24) & 0xff);
    let s5 = input[inOff + 5] ^ ((roundKeys[57] >>> 16) & 0xff);
    let s6 = input[inOff + 6] ^ ((roundKeys[57] >>> 8) & 0xff);
    let s7 = input[inOff + 7] ^ (roundKeys[57] & 0xff);

    let s8 = input[inOff + 8] ^ ((roundKeys[58] >>> 24) & 0xff);
    let s9 = input[inOff + 9] ^ ((roundKeys[58] >>> 16) & 0xff);
    let s10 = input[inOff + 10] ^ ((roundKeys[58] >>> 8) & 0xff);
    let s11 = input[inOff + 11] ^ (roundKeys[58] & 0xff);

    let s12 = input[inOff + 12] ^ ((roundKeys[59] >>> 24) & 0xff);
    let s13 = input[inOff + 13] ^ ((roundKeys[59] >>> 16) & 0xff);
    let s14 = input[inOff + 14] ^ ((roundKeys[59] >>> 8) & 0xff);
    let s15 = input[inOff + 15] ^ (roundKeys[59] & 0xff);

    // 13 inverse rounds
    for (let round = 13; round > 0; round--) {
        // InvShiftRows + InvSubBytes
        const t0 = INV_SBOX[s0];
        const t1 = INV_SBOX[s13];
        const t2 = INV_SBOX[s10];
        const t3 = INV_SBOX[s7];

        const t4 = INV_SBOX[s4];
        const t5 = INV_SBOX[s1];
        const t6 = INV_SBOX[s14];
        const t7 = INV_SBOX[s11];

        const t8 = INV_SBOX[s8];
        const t9 = INV_SBOX[s5];
        const t10 = INV_SBOX[s2];
        const t11 = INV_SBOX[s15];

        const t12 = INV_SBOX[s12];
        const t13 = INV_SBOX[s9];
        const t14 = INV_SBOX[s6];
        const t15 = INV_SBOX[s3];

        // InvMixColumns
        const k0 = roundKeys[round * 4];
        const k1 = roundKeys[round * 4 + 1];
        const k2 = roundKeys[round * 4 + 2];
        const k3 = roundKeys[round * 4 + 3];

        s0 = MUL_14[t0] ^ MUL_11[t1] ^ MUL_13[t2] ^ MUL_9[t3] ^ ((k0 >>> 24) & 0xff);
        s1 = MUL_9[t0] ^ MUL_14[t1] ^ MUL_11[t2] ^ MUL_13[t3] ^ ((k0 >>> 16) & 0xff);
        s2 = MUL_13[t0] ^ MUL_9[t1] ^ MUL_14[t2] ^ MUL_11[t3] ^ ((k0 >>> 8) & 0xff);
        s3 = MUL_11[t0] ^ MUL_13[t1] ^ MUL_9[t2] ^ MUL_14[t3] ^ (k0 & 0xff);

        s4 = MUL_14[t4] ^ MUL_11[t5] ^ MUL_13[t6] ^ MUL_9[t7] ^ ((k1 >>> 24) & 0xff);
        s5 = MUL_9[t4] ^ MUL_14[t5] ^ MUL_11[t6] ^ MUL_13[t7] ^ ((k1 >>> 16) & 0xff);
        s6 = MUL_13[t4] ^ MUL_9[t5] ^ MUL_14[t6] ^ MUL_11[t7] ^ ((k1 >>> 8) & 0xff);
        s7 = MUL_11[t4] ^ MUL_13[t5] ^ MUL_9[t6] ^ MUL_14[t7] ^ (k1 & 0xff);

        s8 = MUL_14[t8] ^ MUL_11[t9] ^ MUL_13[t10] ^ MUL_9[t11] ^ ((k2 >>> 24) & 0xff);
        s9 = MUL_9[t8] ^ MUL_14[t9] ^ MUL_11[t10] ^ MUL_13[t11] ^ ((k2 >>> 16) & 0xff);
        s10 = MUL_13[t8] ^ MUL_9[t9] ^ MUL_14[t10] ^ MUL_11[t11] ^ ((k2 >>> 8) & 0xff);
        s11 = MUL_11[t8] ^ MUL_13[t9] ^ MUL_9[t10] ^ MUL_14[t11] ^ (k2 & 0xff);

        s12 = MUL_14[t12] ^ MUL_11[t13] ^ MUL_13[t14] ^ MUL_9[t15] ^ ((k3 >>> 24) & 0xff);
        s13 = MUL_9[t12] ^ MUL_14[t13] ^ MUL_11[t14] ^ MUL_13[t15] ^ ((k3 >>> 16) & 0xff);
        s14 = MUL_13[t12] ^ MUL_9[t13] ^ MUL_14[t14] ^ MUL_11[t15] ^ ((k3 >>> 8) & 0xff);
        s15 = MUL_11[t12] ^ MUL_13[t13] ^ MUL_9[t14] ^ MUL_14[t15] ^ (k3 & 0xff);
    }

    // Final round (no InvMixColumns)
    const k0 = roundKeys[0];
    const k1 = roundKeys[1];
    const k2 = roundKeys[2];
    const k3 = roundKeys[3];

    output[outOff] = INV_SBOX[s0] ^ ((k0 >>> 24) & 0xff);
    output[outOff + 1] = INV_SBOX[s13] ^ ((k0 >>> 16) & 0xff);
    output[outOff + 2] = INV_SBOX[s10] ^ ((k0 >>> 8) & 0xff);
    output[outOff + 3] = INV_SBOX[s7] ^ (k0 & 0xff);

    output[outOff + 4] = INV_SBOX[s4] ^ ((k1 >>> 24) & 0xff);
    output[outOff + 5] = INV_SBOX[s1] ^ ((k1 >>> 16) & 0xff);
    output[outOff + 6] = INV_SBOX[s14] ^ ((k1 >>> 8) & 0xff);
    output[outOff + 7] = INV_SBOX[s11] ^ (k1 & 0xff);

    output[outOff + 8] = INV_SBOX[s8] ^ ((k2 >>> 24) & 0xff);
    output[outOff + 9] = INV_SBOX[s5] ^ ((k2 >>> 16) & 0xff);
    output[outOff + 10] = INV_SBOX[s2] ^ ((k2 >>> 8) & 0xff);
    output[outOff + 11] = INV_SBOX[s15] ^ (k2 & 0xff);

    output[outOff + 12] = INV_SBOX[s12] ^ ((k3 >>> 24) & 0xff);
    output[outOff + 13] = INV_SBOX[s9] ^ ((k3 >>> 16) & 0xff);
    output[outOff + 14] = INV_SBOX[s6] ^ ((k3 >>> 8) & 0xff);
    output[outOff + 15] = INV_SBOX[s3] ^ (k3 & 0xff);
}

function encryptBlock(input, inOff, output, outOff, roundKeys) {
    let s0 = input[inOff] ^ ((roundKeys[0] >>> 24) & 0xff);
    let s1 = input[inOff + 1] ^ ((roundKeys[0] >>> 16) & 0xff);
    let s2 = input[inOff + 2] ^ ((roundKeys[0] >>> 8) & 0xff);
    let s3 = input[inOff + 3] ^ (roundKeys[0] & 0xff);

    let s4 = input[inOff + 4] ^ ((roundKeys[1] >>> 24) & 0xff);
    let s5 = input[inOff + 5] ^ ((roundKeys[1] >>> 16) & 0xff);
    let s6 = input[inOff + 6] ^ ((roundKeys[1] >>> 8) & 0xff);
    let s7 = input[inOff + 7] ^ (roundKeys[1] & 0xff);

    let s8 = input[inOff + 8] ^ ((roundKeys[2] >>> 24) & 0xff);
    let s9 = input[inOff + 9] ^ ((roundKeys[2] >>> 16) & 0xff);
    let s10 = input[inOff + 10] ^ ((roundKeys[2] >>> 8) & 0xff);
    let s11 = input[inOff + 11] ^ (roundKeys[2] & 0xff);

    let s12 = input[inOff + 12] ^ ((roundKeys[3] >>> 24) & 0xff);
    let s13 = input[inOff + 13] ^ ((roundKeys[3] >>> 16) & 0xff);
    let s14 = input[inOff + 14] ^ ((roundKeys[3] >>> 8) & 0xff);
    let s15 = input[inOff + 15] ^ (roundKeys[3] & 0xff);

    for (let round = 1; round < 14; round++) {
        const t0 = SBOX[s0];
        const t1 = SBOX[s5];
        const t2 = SBOX[s10];
        const t3 = SBOX[s15];

        const t4 = SBOX[s4];
        const t5 = SBOX[s9];
        const t6 = SBOX[s14];
        const t7 = SBOX[s3];

        const t8 = SBOX[s8];
        const t9 = SBOX[s13];
        const t10 = SBOX[s2];
        const t11 = SBOX[s7];

        const t12 = SBOX[s12];
        const t13 = SBOX[s1];
        const t14 = SBOX[s6];
        const t15 = SBOX[s11];

        const k0 = roundKeys[round * 4];
        const k1 = roundKeys[round * 4 + 1];
        const k2 = roundKeys[round * 4 + 2];
        const k3 = roundKeys[round * 4 + 3];

        s0 = MUL_2[t0] ^ MUL_3[t1] ^ t2 ^ t3 ^ ((k0 >>> 24) & 0xff);
        s1 = t0 ^ MUL_2[t1] ^ MUL_3[t2] ^ t3 ^ ((k0 >>> 16) & 0xff);
        s2 = t0 ^ t1 ^ MUL_2[t2] ^ MUL_3[t3] ^ ((k0 >>> 8) & 0xff);
        s3 = MUL_3[t0] ^ t1 ^ t2 ^ MUL_2[t3] ^ (k0 & 0xff);

        s4 = MUL_2[t4] ^ MUL_3[t5] ^ t6 ^ t7 ^ ((k1 >>> 24) & 0xff);
        s5 = t4 ^ MUL_2[t5] ^ MUL_3[t6] ^ t7 ^ ((k1 >>> 16) & 0xff);
        s6 = t4 ^ t5 ^ MUL_2[t6] ^ MUL_3[t7] ^ ((k1 >>> 8) & 0xff);
        s7 = MUL_3[t4] ^ t5 ^ t6 ^ MUL_2[t7] ^ (k1 & 0xff);

        s8 = MUL_2[t8] ^ MUL_3[t9] ^ t10 ^ t11 ^ ((k2 >>> 24) & 0xff);
        s9 = t8 ^ MUL_2[t9] ^ MUL_3[t10] ^ t11 ^ ((k2 >>> 16) & 0xff);
        s10 = t8 ^ t9 ^ MUL_2[t10] ^ MUL_3[t11] ^ ((k2 >>> 8) & 0xff);
        s11 = MUL_3[t8] ^ t9 ^ t10 ^ MUL_2[t11] ^ (k2 & 0xff);

        s12 = MUL_2[t12] ^ MUL_3[t13] ^ t14 ^ t15 ^ ((k3 >>> 24) & 0xff);
        s13 = t12 ^ MUL_2[t13] ^ MUL_3[t14] ^ t15 ^ ((k3 >>> 16) & 0xff);
        s14 = t12 ^ t13 ^ MUL_2[t14] ^ MUL_3[t15] ^ ((k3 >>> 8) & 0xff);
        s15 = MUL_3[t12] ^ t13 ^ t14 ^ MUL_2[t15] ^ (k3 & 0xff);
    }

    const k0 = roundKeys[56];
    const k1 = roundKeys[57];
    const k2 = roundKeys[58];
    const k3 = roundKeys[59];

    output[outOff] = SBOX[s0] ^ ((k0 >>> 24) & 0xff);
    output[outOff + 1] = SBOX[s5] ^ ((k0 >>> 16) & 0xff);
    output[outOff + 2] = SBOX[s10] ^ ((k0 >>> 8) & 0xff);
    output[outOff + 3] = SBOX[s15] ^ (k0 & 0xff);

    output[outOff + 4] = SBOX[s4] ^ ((k1 >>> 24) & 0xff);
    output[outOff + 5] = SBOX[s9] ^ ((k1 >>> 16) & 0xff);
    output[outOff + 6] = SBOX[s14] ^ ((k1 >>> 8) & 0xff);
    output[outOff + 7] = SBOX[s3] ^ (k1 & 0xff);

    output[outOff + 8] = SBOX[s8] ^ ((k2 >>> 24) & 0xff);
    output[outOff + 9] = SBOX[s13] ^ ((k2 >>> 16) & 0xff);
    output[outOff + 10] = SBOX[s2] ^ ((k2 >>> 8) & 0xff);
    output[outOff + 11] = SBOX[s7] ^ (k2 & 0xff);

    output[outOff + 12] = SBOX[s12] ^ ((k3 >>> 24) & 0xff);
    output[outOff + 13] = SBOX[s1] ^ ((k3 >>> 16) & 0xff);
    output[outOff + 14] = SBOX[s6] ^ ((k3 >>> 8) & 0xff);
    output[outOff + 15] = SBOX[s11] ^ (k3 & 0xff);
}

/**
 * Decrypt AES-256-ECB with PKCS7 unpadding.
 * @param {Uint8Array} cipherBytes 
 * @param {Uint8Array} keyBytes 32 bytes
 * @returns {Uint8Array} plaintext bytes
 */
function decryptAes256Ecb(cipherBytes, keyBytes) {
    if (cipherBytes.length % 16 !== 0) {
        throw new Error('Ciphertext length must be a multiple of 16 bytes');
    }
    const roundKeys = keyExpansion256(keyBytes);
    const plain = new Uint8Array(cipherBytes.length);
    for (let i = 0; i < cipherBytes.length; i += 16) {
        decryptBlock(cipherBytes, i, plain, i, roundKeys);
    }
    // Remove PKCS7 padding
    const padLen = plain[plain.length - 1];
    if (padLen < 1 || padLen > 16) {
        throw new Error('Invalid PKCS7 padding');
    }
    for (let i = plain.length - padLen; i < plain.length; i++) {
        if (plain[i] !== padLen) {
            throw new Error('Invalid PKCS7 padding bytes');
        }
    }
    return plain.subarray(0, plain.length - padLen);
}

/**
 * Encrypt AES-256-ECB with PKCS7 padding.
 * @param {Uint8Array} plainBytes 
 * @param {Uint8Array} keyBytes 32 bytes
 * @returns {Uint8Array} ciphertext bytes
 */
function encryptAes256Ecb(plainBytes, keyBytes) {
    const padLen = 16 - (plainBytes.length % 16);
    const padded = new Uint8Array(plainBytes.length + padLen);
    padded.set(plainBytes);
    padded.fill(padLen, plainBytes.length);

    const roundKeys = keyExpansion256(keyBytes);
    const cipher = new Uint8Array(padded.length);
    for (let i = 0; i < padded.length; i += 16) {
        encryptBlock(padded, i, cipher, i, roundKeys);
    }
    return cipher;
}

if (typeof module !== 'undefined') {
    module.exports = { decryptAes256Ecb, encryptAes256Ecb };
}
