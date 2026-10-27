# Modular File & Component Organization Rule

Always organize all files, directories, and code based on distinct function, domain module, and separation of concerns.

## Directory Standards
- `src/`: Web application frontend source files (`src/css/` for stylesheets, `src/js/modules/` for discrete ES modules, `src/js/main.js` as the entry orchestrator).
- `assets/`: Static branding, logos, icons (`assets/icon.svg`).
- `docs/`: Design documentation, specifications, implementation plans, and architecture notes.
- `tools/reversing/`: Reverse engineering tools, IL2CPP dumpers, decompilers, binary dumps (`dumps/`), and analysis scripts (`scripts/`).
- `data/samples/`: Sample cache files, test inputs, and mock payloads.
- Root directory: Keep minimal with only entry points required for root scope (`index.html`, `manifest.json`, `sw.js`), configuration (`.gitignore`), and `README.md`.

## Code Modularity
- Avoid monolithic scripts exceeding 500 lines. Split business logic, UI manipulation, data models, and external integrations into focused, testable modules.
- Ensure import paths, HTML script tags, Service Worker cache manifests, and documentation links remain intact and functional after any file restructuring.
