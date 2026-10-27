# Implementation Plan: AstroDX Cache Exporter, DXRating Converter & Device Migrator (PWA)

## 1. Project Overview & Objective
Build a zero-backend, installable Progressive Web App (PWA) that runs directly on iOS/iPadOS (Safari), Android (Chrome), and Desktop browsers. 

### Core Problems Solved
1. **Decode AstroDX Cache**: AstroDX (`>= v2.0.0.rc.7`) stores player scores and chart metadata in a single `cache` file compressed with raw Deflate (`C# System.IO.Compression.DeflateStream`, window bits `-15`). Users cannot directly read or export this file.
2. **One-Click Multi-Format Export & PC Transfer**: Users on phones or tablets need a single click to extract their play records into **DXRating.net JSON**, **Excel (`.xlsx`)**, **CSV (`.csv`)**, and **Raw Decoded JSON**, plus an instant **Cloud Share Link + QR Code** to open and download the JSON on their PC without connecting cables.
3. **Safe Device Migration Without Data Loss**: Copying the `cache` file directly between devices wipes scores when folder paths or chart hashes differ on the target device. This tool must provide a **Smart Cache Migrator** that merges scores from an old `cache` file into a newly generated `cache` file from the target device, then re-compresses it into a valid raw Deflate `cache` binary.

---

## 2. Technical Stack & Libraries
To keep deployment zero-config (works by opening `index.html` or hosting on GitHub Pages / Vercel), use Vanilla HTML5, CSS3, and ES6+ JavaScript with CDN libraries:

* **Compression / Decompression**: `pako@2.1.0` (`https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js`)
  * Primary: `pako.inflateRaw(uint8Array)` and `pako.deflateRaw(uint8Array)` (matches C# `DeflateStream` raw deflate without zlib header).
  * Fallbacks: `pako.inflate(uint8Array)` (zlib/gzip header) and plain UTF-8 `JSON.parse`.
* **Excel (`.xlsx`) Generation**: SheetJS `xlsx@0.18.5` (`https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js`)
* **QR Code Generation**: `qrcodejs@1.0.0` (`https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js`)
* **PWA Support**: Web App Manifest (`manifest.json`) + Service Worker (`sw.js`) so the user can tap **"Add to Home Screen"** on iPadOS/iOS and Android to run it like a native tablet app.

---

## 3. Target Directory Structure
Create the following files in the project root:

```text
astrodx-exporter/
├── index.html          # Main UI with 2 tabs: "Extract & Share to PC" and "Device Migration"
├── style.css           # Clean, dark-mode responsive tablet/desktop UI
├── app.js              # Core Deflate codec, score parser, exporters, PC link generator, and cache merger
├── manifest.json       # PWA manifest for installing on iOS/Android home screen
├── sw.js               # Offline caching service worker
└── README.md           # User guide for Android, iOS, and PC usage