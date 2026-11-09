'use strict';

// End-to-end check of the Path of Building engine, without Electron: starts pob/server.lua in
// PoB's LuaJIT (vendor/pob/runtime/pobhost.exe on Windows, or POB_LUAJIT elsewhere), makes a
// small build in code, checks one item and prints what the popup would show.
// Exits non-zero if anything is off. Used by CI on Windows.

const path = require('path');
const { createEngine } = require('../src/engine');
const { judgeAll } = require('../src/core/verdict');

const root = path.join(__dirname, '..');
const engine = createEngine({
  pobDir: path.join(root, 'vendor', 'pob'),
  serverLua: path.join(root, 'pob', 'server.lua'),
  log: (m) => console.log(m),
});

function fail(msg) { console.error(`SMOKE FAILED: ${msg}`); engine.stop(); process.exit(1); }

(async () => {
  const problem = engine.available();
  if (problem) fail(problem);
  const t0 = Date.now();
  const r = await engine.selftest();
  console.log(`selftest answered in ${Date.now() - t0} ms`);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) fail(r.error);
  if (!r.results || !r.results.length) fail('no slot results');
  const res = r.results.find((x) => x.slot === 'Body Armour');
  if (!res) fail('no Body Armour result');
  if (!(res.after.Life > res.before.Life)) fail(`life should go up: ${res.before.Life} -> ${res.after.Life}`);
  if (!(res.after.FireResist > res.before.FireResist)) fail('fire resistance should go up');
  if (!(r.summary && r.summary.stats && r.summary.stats.CombinedDPS > 0)) fail('the test build should have DPS');
  const j = judgeAll(r.results, r.item)[0];
  console.log('Popup would show:', JSON.stringify({ verdict: j.verdict, dps: j.dps, rows: j.rows.map((x) => `${x.label} ${x.from} -> ${x.to}`) }, null, 2));

  // and a second item through the normal eval path, timed: this is what each hotkey press costs
  const t1 = Date.now();
  const r2 = await engine.eval(`Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Item Level: 75
--------
+24% to Cold Resistance (implicit)
--------
+52 to maximum Life
+30% to Lightning Resistance
`);
  console.log(`ring check answered in ${Date.now() - t1} ms: ${JSON.stringify(r2.ok ? r2.results.map((x) => x.slot) : r2.error)}`);
  if (!r2.ok) fail(`ring: ${r2.error}`);
  // the real path: the build as a Path of Building code (what players paste), decoded and loaded
  const ex = await engine.exportXml();
  if (!ex.ok || !/<PathOfBuilding/.test(ex.xml || '')) fail('export failed');
  const code = require('zlib').deflateSync(Buffer.from(ex.xml)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const xml = await require('../src/core/buildcode').toXml(code);
  const t2 = Date.now();
  const lr = await engine.load(xml);
  console.log(`load from code answered in ${Date.now() - t2} ms: ${JSON.stringify(lr.ok ? lr.summary.mainSkill : lr.error)}`);
  if (!lr.ok) fail(`load: ${lr.error}`);
  const r3 = await engine.eval(`Item Class: Body Armours
Rarity: Magic
Vile Robe of the Whelpling
--------
Energy Shield: 30
--------
Item Level: 20
--------
+20 to maximum Life
`);
  if (!r3.ok) fail(`eval after load: ${r3.error}`);
  const j3 = judgeAll(r3.results, r3.item)[0];
  console.log(`after load: ${j3.slot} ${j3.verdict} ${j3.rows.map((x) => x.label).join(', ')}`);
  engine.stop();
  console.log('SMOKE OK');
  setTimeout(() => process.exit(0), 300);
})().catch((e) => fail(e.stack || e.message));
