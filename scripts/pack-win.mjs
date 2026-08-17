import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseDir = 'release';
const bundleDir = path.join(releaseDir, 'CS2InventoryTracker');
const exeName = 'CS2InventoryTracker.exe';
const zipName = 'CS2InventoryTracker-windows.zip';

fs.mkdirSync(releaseDir, { recursive: true });
fs.rmSync(path.join(releaseDir, exeName), { force: true });
fs.rmSync(path.join(releaseDir, zipName), { force: true });
fs.rmSync(bundleDir, { recursive: true, force: true });
fs.mkdirSync(bundleDir, { recursive: true });

const pkg = spawnSync(
  process.execPath,
  ['node_modules/@yao-pkg/pkg/lib-es5/bin.js', '.', '--sea', '-t', 'node24-win-x64', '-o', path.join(bundleDir, exeName)],
  { stdio: 'inherit' },
);
if (pkg.status !== 0) process.exit(pkg.status ?? 1);

fs.copyFileSync('.env.example', path.join(bundleDir, 'config.env'));
fs.copyFileSync('scripts/release-readme.txt', path.join(bundleDir, 'README.txt'));

const zip = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${bundleDir}' -DestinationPath '${path.join(releaseDir, zipName)}' -Force`],
  { stdio: 'inherit' },
);
if (zip.status !== 0) process.exit(zip.status ?? 1);

console.log(`\nRelease folder: ${bundleDir}`);
console.log(`Release zip:    ${path.join(releaseDir, zipName)}`);
