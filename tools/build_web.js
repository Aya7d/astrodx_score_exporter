/**
 * Copies frontend web assets into www/ directory for Capacitor Android packaging.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outDir = path.resolve(rootDir, 'www');

// Clean output directory
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Items to package for Capacitor
const itemsToCopy = [
  'index.html',
  'manifest.json',
  'favicon.ico',
  'assets',
  'src'
];

for (const item of itemsToCopy) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(outDir, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`[Build] Copied ${item} -> www/${item}`);
  }
}

console.log('[Build] Finished preparing www/ web assets for Capacitor.');
