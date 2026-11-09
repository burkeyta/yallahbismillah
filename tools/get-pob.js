'use strict';

// Fetches Path of Building (PoE2) at the version pinned in package.json ("pob.ref") into
// vendor/pob, keeping only what the headless calculations need:
//   vendor/pob/src/**/*.lua|json      PoB's program and data (no images, no Export scripts)
//   vendor/pob/runtime/lua/**         PoB's pure-Lua libraries (dkjson, xml, sha1, base64…)
//   vendor/pob/runtime/lua51.dll      PoB's own LuaJIT (newer syntax than stock LuaJIT)
//   vendor/pob/runtime/lua-utf8.dll   the one native module PoB's code requires
//   vendor/pob/LICENSE.md
// Usage: node tools/get-pob.js [--force]

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { repo, ref } = pkg.pob;
const dest = path.join(root, 'vendor', 'pob');
const stamp = path.join(dest, '.ref');
const force = process.argv.includes('--force');

if (!force && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === ref) {
  console.log(`Path of Building ${ref} already in vendor/pob`);
  process.exit(0);
}

const tmp = path.join(root, 'vendor', '.pob-clone');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Cloning ${repo} at ${ref}…`);
execFileSync('git', ['clone', '--depth', '1', '--branch', ref, '--filter=blob:none', `https://github.com/${repo}.git`, tmp], { stdio: 'inherit' });

const keep = (rel) => {
  const p = rel.split(path.sep).join('/');
  if (p.startsWith('src/')) return !p.startsWith('src/Export/') && /\.(lua|json)$/.test(p);
  if (p.startsWith('runtime/lua/')) return true;
  return ['runtime/lua51.dll', 'runtime/lua-utf8.dll', 'LICENSE.md', 'manifest.xml'].includes(p);
};

// keep the pobhost.exe / keyhelper builds that may already be there
const preserve = ['runtime/pobhost.exe'];
const saved = {};
for (const p of preserve) { const f = path.join(dest, p); if (fs.existsSync(f)) saved[p] = fs.readFileSync(f); }

fs.rmSync(dest, { recursive: true, force: true });
let count = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(tmp, full);
    if (e.isDirectory()) { walk(full); continue; }
    if (!keep(rel)) continue;
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(full, out);
    count++;
  }
})(tmp);
for (const [p, data] of Object.entries(saved)) { fs.mkdirSync(path.dirname(path.join(dest, p)), { recursive: true }); fs.writeFileSync(path.join(dest, p), data); }
fs.rmSync(tmp, { recursive: true, force: true });

for (const must of ['src/HeadlessWrapper.lua', 'runtime/lua51.dll', 'runtime/lua-utf8.dll', 'runtime/lua/dkjson.lua']) {
  if (!fs.existsSync(path.join(dest, must))) { console.error(`Missing after copy: ${must}`); process.exit(1); }
}
fs.writeFileSync(stamp, ref + '\n');
console.log(`Copied ${count} files of Path of Building ${ref} to vendor/pob`);
