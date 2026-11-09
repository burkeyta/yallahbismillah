'use strict';

// Compiles the two small Windows helpers in native/ with MinGW:
//   native/pobhost.c   -> vendor/pob/runtime/pobhost.exe  (next to PoB's lua51.dll)
//   native/keyhelper.c -> vendor/bin/keyhelper.exe
// Works on Windows (gcc from MinGW in PATH) and on Linux (x86_64-w64-mingw32-gcc).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cc = process.env.CC || (process.platform === 'win32' ? 'gcc' : 'x86_64-w64-mingw32-gcc');
const jobs = [
  ['native/pobhost.c', 'vendor/pob/runtime/pobhost.exe'],
  ['native/keyhelper.c', 'vendor/bin/keyhelper.exe'],
];
for (const [src, out] of jobs) {
  fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
  const args = ['-O2', '-Wall', '-municode', '-static', '-s', '-o', path.join(root, out), path.join(root, src)];
  console.log(`${cc} ${args.join(' ')}`);
  execFileSync(cc, args, { stdio: 'inherit' });
}
console.log('Native helpers built.');
