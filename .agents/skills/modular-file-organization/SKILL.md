---
name: modular-file-organization
description: >-
  Enforces clean modular architecture and organizes repository files, directories,
  and code into dedicated functional modules (e.g. web frontend, reversing tools,
  data samples, docs). Use whenever creating, refactoring, moving, or reviewing project files.
---

# Modular File & Component Organization Skill

This skill defines the architectural standards, directory conventions, and automated workflows for maintaining a modular codebase. All files and components in this project must adhere to strict functional separation of concerns.

---

## 1. Architectural Principles

1. **Separation of Concerns (SoC)**:
   - Never mix disparate domains (e.g., reverse engineering binaries, analysis scripts, web client assets, documentation, or test fixtures) in the repository root.
   - Each top-level folder must represent a single, well-defined domain with an explicit lifecycle.

2. **Single Responsibility per File**:
   - Limit file sizes and scope. Avoid monolithic scripts (> 500 lines).
   - Divide complex logic into focused, single-purpose ES6/Python modules (e.g., Codec, Extractor, Exporters, Cloud Share, Migrator, UI).

3. **Clean Root Directory**:
   - The repository root must strictly contain only:
     - Essential project entry points (e.g., `index.html`, `manifest.json`, `sw.js` for root PWA service worker scope).
     - Standard configuration and metadata (`README.md`, `.gitignore`, configuration files).
     - Customization directories (`.agents/`).

4. **Reference Integrity**:
   - Whenever any file is moved or renamed, all relative links, import statements, Service Worker cache manifests, PWA manifests, and documentation links must be updated and verified immediately.

---

## 2. Directory Hierarchy Standard

```text
astrodx_score_exporter/
├── .agents/                        # Antigravity agent configuration and intelligence
│   ├── rules/                      # Contextual rules (e.g., modular-file-organization.md)
│   └── skills/                     # Workspace skills
│       └── modular-file-organization/
│           └── SKILL.md
├── assets/                         # Static visual media & branding
│   └── icon.svg                    # Application icons and logos
├── data/                           # Datasets & fixtures
│   └── samples/                    # Realistic test files (e.g. sample AstroDX `cache` files)
├── docs/                           # Documentation, specifications, & design plans
│   ├── Details_design.txt          # Architectural & feature design notes
│   └── IMPLEMENTATION_PLAN.md      # Implementation roadmap & verification steps
├── src/                            # Web application frontend source code
│   ├── css/
│   │   └── style.css               # Modern glassmorphism UI styles
│   └── js/
│       ├── main.js                 # Application entry point & orchestration
│       └── modules/                # Specialized functional JS modules
│           ├── codec.js            # Deflate binary decoder / encoder
│           ├── extractor.js        # Score traversing, difficulty & title normalizers
│           ├── exporters.js        # DXRating JSON, Excel XLSX, CSV, Raw JSON exporters
│           ├── cloud_share.js      # Cloud upload (dpaste/bytebin) & QR code generator
│           ├── migrator.js         # Cross-device cache merger & score porter
│           ├── demo_data.js        # Realistic demo cache dataset generator
│           ├── grade.js            # Achievement to maimai DX grade mapper
│           └── ui.js               # DOM manipulation, toasts, modals, table renderers
├── tools/                          # Developer & research utilities
│   └── reversing/                  # Reverse engineering, IL2CPP tools & memory inspection
│       ├── dumper/                 # Il2CppDumper binaries & decompilation scripts
│       ├── dumps/                  # Extracted binary dumps (`global-metadata.dat`, `libil2cpp.so`)
│       └── scripts/                # Analysis scripts (`find_methods.py`, `inspect_method.py`)
├── index.html                      # PWA entry page
├── manifest.json                   # Web App Manifest
├── sw.js                           # Offline caching service worker
└── README.md                       # User guide & developer instructions
```

---

## 3. Workflow & Verification Steps

When adding new files or refactoring existing ones:

1. **Classify by Function & Domain**:
   - Frontend UI logic & styling &rarr; `src/` (`src/js/modules/`, `src/css/`)
   - Reversing / memory dumping tools &rarr; `tools/reversing/`
   - Static artwork / icons &rarr; `assets/`
   - Test data & cache examples &rarr; `data/samples/`
   - Design notes & architecture docs &rarr; `docs/`

2. **Verify Module Dependencies**:
   - Ensure ES modules use explicit relative import paths (e.g., `import { decodeCacheFile } from './modules/codec.js';`).
   - If a script requires external data, resolve paths relative to `__file__` or module URLs rather than hardcoding CWD.

3. **Verify Service Worker & Web App Paths**:
   - Check `sw.js` `ASSETS_TO_CACHE` list to match all moved assets.
   - Check `index.html` and `manifest.json` asset paths.
   - Test loading the page via local web server (`http://localhost:8088/`) to ensure no 404s or uncaught errors.
