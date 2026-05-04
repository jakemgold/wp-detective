#!/usr/bin/env node
/**
 * Renders the W-mark SVG variants to the PNG icon set the manifest expects.
 *
 *   icons/src/wmark.svg          → icon-{16,32,48,128}.png       (gray, brand identity / WP-but-logged-out)
 *   icons/src/wmark-active.svg   → icon-{16,32}-active.png       (blue, WP + logged in)
 *   icons/src/wmark-inactive.svg → icon-{16,32}-inactive.png     (gray + slash, not WP)
 *
 * Run with: node scripts/render-icons.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'icons', 'src');
const OUT = path.join(ROOT, 'icons');

const jobs = [
  { svg: 'wmark.svg',          sizes: [16, 32, 48, 128], suffix: '' },
  { svg: 'wmark-active.svg',   sizes: [16, 32],          suffix: '-active' },
  { svg: 'wmark-inactive.svg', sizes: [16, 32],          suffix: '-inactive' },
];

(async () => {
  for (const { svg, sizes, suffix } of jobs) {
    const buf = fs.readFileSync(path.join(SRC, svg));
    for (const size of sizes) {
      const out = path.join(OUT, `icon-${size}${suffix}.png`);
      await sharp(buf, { density: 384 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toFile(out);
      console.log('  →', path.relative(ROOT, out));
    }
  }
})();
