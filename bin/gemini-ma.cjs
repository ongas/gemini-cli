#!/usr/bin/env node

const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

const bundlePath = join(__dirname, '..', 'bundle', 'gemini.js');

if (!existsSync(bundlePath)) {
  console.error('Error: bundled CLI not found at %s', bundlePath);
  console.error('This repository requires a build step. To fix:');
  console.error('  1) From the project root run: npm ci && npm run bundle');
  console.error('  2) Or install a published package that includes the bundle, or run `npm link` from the project root after building.');
  process.exit(2);
}

const args = process.argv.slice(2);
const result = spawnSync(process.execPath, [bundlePath, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 0);
