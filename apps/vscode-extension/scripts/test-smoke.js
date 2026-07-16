const fs = require('node:fs');
const path = require('node:path');

const distFile = path.resolve(__dirname, '../dist/extension.js');

if (!fs.existsSync(distFile)) {
  console.error('Smoke test failed: dist/extension.js does not exist.');
  process.exit(1);
}

console.log('Smoke test passed: extension build output exists.');