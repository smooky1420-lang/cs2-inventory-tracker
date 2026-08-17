import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

fs.mkdirSync('release', { recursive: true });
fs.rmSync('release/CS2InventoryTracker.exe', { force: true });

const result = spawnSync(
  process.execPath,
  ['node_modules/@yao-pkg/pkg/lib-es5/bin.js', '.', '--sea', '-t', 'node24-win-x64', '-o', 'release/CS2InventoryTracker.exe'],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
