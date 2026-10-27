# AstroDX Score Exporter, DXRating Converter & Device Migrator (PWA)

A zero-backend, client-side Progressive Web App (PWA) that decodes AstroDX (`>= v2.0.0.rc.7`) binary cache files, exports play records to DXRating.net, Excel, CSV, or raw JSON, transfers records wirelessly to your PC via QR code, and safely migrates scores between devices without data loss.

![AstroDX Exporter Icon](assets/icon.png)

---

## 🌟 Key Features

1. **AstroDX Multi-Format Cache Decoder**:
   * **AstroDX 2.2+ Encrypted Format**: Automatically decrypts modern AstroDX AES-256-ECB encrypted Base64 cache files (`ReflektoneEncrypt.Aes256`).
   * **Raw Deflate Codec**: Decodes legacy compressed binary `cache` files (`C# System.IO.Compression.DeflateStream`, window bits `-15`) using `pako.inflateRaw`.
   * **Legacy & Plain JSON**: Also supports zlib/gzip headers and direct UTF-8 JSON text.
   * **Safe Repacker**: Encrypts and repacks edited datasets back into genuine AstroDX encrypted Base64 files or raw Deflate binary named `cache`.

2. **One-Click Multi-Format Export**:
   * **DXRating.net JSON (`dxrating_import.json`)**: Formatted to the official gekichumai/dxrating schema (`sheetId: "<title>__dxrt__<type>__dxrt__<difficulty>"`), deduplicated with highest achievement rates.
   * **Excel Spreadsheet (`astrodx_scores.xlsx`)**: Clean, formatted spreadsheet with song titles, types, difficulties, percentages, and grades.
   * **CSV (`astrodx_scores.csv`)**: Pre-pended with UTF-8 BOM (`\uFEFF`) so Japanese/Chinese song titles display properly in Microsoft Excel.
   * **Raw Decoded JSON (`astrodx_cache_decoded.json`)**: Formatted JSON for deep inspection or manual edits.

3. **Instant Tablet-to-PC Wireless Transfer**:
   * Generate an instant cloud link and QR code via `dpaste.com` (with `bytebin` fallback).
   * Scan with your phone or open the link on your PC to download the JSON without cables or USB file transfers.

4. **Safe Device Migration (Smart Cache Merger)**:
   * **Problem**: Directly copying a `cache` file between devices wipes scores when song folder paths or chart hashes differ on the target device.
   * **Solution**: Smart Cache Merger takes your **Old Device cache** (with your high scores) and your **New Device cache** (freshly scanned after installing charts), matches records by **Normalized Song Title + Difficulty**, and ports your high scores into the target device's structure.

5. **Interactive Score Editor & Custom Score Adder**:
   * Filter and search through all played charts by title, difficulty (Basic, Advanced, Expert, Master, Re:Master), or type (DX, Standard).
   * Edit titles and achievement rates inline with live updates to in-memory exports.

6. **100% Offline PWA (Progressive Web App)**:
   * Works fully offline via Service Worker (`sw.js`).
   * Can be installed to your iPad, iPhone, Android, or desktop home screen ("Add to Home Screen").

---

## 📁 Where to Find Your `cache` File

### iOS / iPadOS (Safari / Files App)
* **Option A — ⚡ 1-Tap Shortcut (Zero-Browsing)**:
  1. Set up the 4-step **iOS Shortcut** (tap **"iOS 1-Tap Sync"** inside the app for instructions).
  2. Add it to your Home Screen.
  3. Tap the icon anytime: it automatically reads `AstroDX/cache`, encodes it, and opens the app with your scores parsed instantly!
* **Option B — Manual Selection**:
  1. Open the native **Files** app on your iPad or iPhone.
  2. Tap **Browse** &rarr; **On My iPad** (or **On My iPhone**).
  3. Open the **AstroDX** folder.
  4. Locate the file named `cache` (no file extension).
  5. Drag and drop it into this web app, or tap **Select Cache File**.

### Android
1. Open your preferred file explorer (e.g., **Files by Google**, **MT Manager**, or **ZArchiver**).
2. Navigate to:
   ```text
   Internal Storage/Android/data/com.Reflektone.AstroDX/files/cache
   ```
3. *Note for Android 11+:* If Android restricts access to `Android/data`, use **MT Manager**, connect via USB to a PC, or grant folder access via **Shizuku**.

---

## 🚀 Quick Start / Local Testing

Because this is a zero-backend web application, you can run it locally with any static HTTP server:

```powershell
# Using Python
python -m http.server 8000

# Or using Node.js npx serve / live-server
npx -y serve .
```

Then open `http://localhost:8000` in your browser.

> [!TIP]
> You can also test all features immediately without any files by clicking the **"Load Demo Cache"** button inside the app!

---

## 🏗️ Project Architecture & Modular Structure

This repository strictly separates concerns across functional modules:

```text
astrodx_score_exporter/
├── .agents/                        # Antigravity skill & workspace rules
│   ├── rules/                      # Contextual coding rules
│   └── skills/                     # Skill runbooks (modular-file-organization)
├── assets/                         # Visual assets, branding (icon.png) & Torus fonts
├── data/
│   └── samples/                    # Sample AstroDX binary cache datasets
├── docs/                           # Architecture specifications & implementation plans
│   ├── Details_design.txt
│   └── IMPLEMENTATION_PLAN.md
├── src/                            # Web application frontend
│   ├── css/                        # Clean white & grey modern stylesheets (Torus font)
│   │   └── style.css
│   └── js/                         # Modular ES6 JavaScript
│       ├── main.js                 # Application orchestrator
│       ├── vendor/                 # Offline dependencies (crypto-js.js)
│       └── modules/                # Specialized domain modules
│           ├── codec.js            # AES-256 and Deflate binary decoder/encoder
│           ├── extractor.js        # Score traversing & normalization
│           ├── exporters.js        # DXRating, Excel, CSV, JSON exporters
│           ├── cloud_share.js      # Ephemeral cloud upload & QR code generator
│           ├── migrator.js         # Safe cross-device cache merger
│           ├── demo_data.js        # Demo data generator
│           ├── grade.js            # maimai DX grade calculator
│           └── ui.js               # Dynamic UI & toast notifications
├── tools/
│   └── reversing/                  # Reverse engineering utilities & scripts
├── index.html                      # PWA web entry point
├── manifest.json                   # Web app manifest
├── sw.js                           # Offline service worker
└── README.md
```

---

## 🛠️ Technology Stack

* **Core**: Vanilla HTML5, CSS3, ES6+ JavaScript
* **Cryptography**: `crypto-js` (AES-256-ECB / PKCS7)
* **Compression**: `pako@2.1.0` (Raw Deflate / Inflate)
* **Spreadsheet**: SheetJS `xlsx@0.18.5`
* **QR Codes**: `qrcodejs@1.0.0`
* **Typography**: Google Fonts (`Outfit` & `Inter`)
* **PWA**: Service Worker (`sw.js`) & Web App Manifest (`manifest.json`)

---

## 📄 License & Disclaimer

* **Disclaimer**: This tool is an open-source utility and is not affiliated with, endorsed by, or connected to **Reflektone** (creators of AstroDX) or **SEGA** (creators of maimai DX).
* **License**: MIT
