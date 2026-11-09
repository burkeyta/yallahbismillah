'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { judge, judgeAll, dpsKey, fmtNum } = require('../src/core/verdict');

const base = { CombinedDPS: 100000, TotalEHP: 20000, Life: 3000, FireResist: 75, MissingFireResist: 0, ColdResist: 75, MissingColdResist: 0, Str: 100 };

test('DPS line shows from, to and percentage', () => {
  const j = judge({ slot: 'Gloves', before: base, after: { ...base, CombinedDPS: 118000 } });
  assert.strictEqual(j.dps.key, 'CombinedDPS');
  assert.strictEqual(j.dps.from, 100000);
  assert.strictEqual(j.dps.to, 118000);
  assert.strictEqual(j.dps.pct, 18);
  assert.strictEqual(j.verdict, 'upgrade');
});

test('a resistance falling below max is a warning and never an upgrade', () => {
  const j = judge({ slot: 'Boots', before: base, after: { ...base, CombinedDPS: 130000, FireResist: 40, MissingFireResist: 35 } });
  assert.match(j.warnings[0], /Fire resistance 75% → 40%/);
  assert.strictEqual(j.verdict, 'mixed');
});

test('less damage and less EHP is a downgrade', () => {
  const j = judge({ slot: 'Helmet', before: base, after: { ...base, CombinedDPS: 90000, TotalEHP: 18000, Life: 2700 } });
  assert.strictEqual(j.verdict, 'downgrade');
  assert.ok(j.rows.find((r) => r.key === 'Life' && r.diff === -300));
});

test('Full DPS is used when Path of Building adds skills up', () => {
  assert.strictEqual(dpsKey({ FullDPS: 5, CombinedDPS: 10 }, {}), 'FullDPS');
  assert.strictEqual(dpsKey({ CombinedDPS: 10, MinionDPS: 500 }, {}), 'MinionDPS');
});

test('unchanged numbers are not listed', () => {
  const j = judge({ slot: 'Belt', before: base, after: { ...base } });
  assert.strictEqual(j.rows.length, 0);
  assert.strictEqual(j.verdict, 'same');
});

test('attribute requirements not met are flagged', () => {
  const j = judge({ slot: 'Body Armour', before: base, after: { ...base, Life: 3100 } }, { req: { str: 150 } });
  assert.ok(j.warnings.some((w) => /Needs 150 Strength/.test(w)));
});

test('best slot comes first', () => {
  const all = judgeAll([
    { slot: 'Ring 1', before: base, after: { ...base, CombinedDPS: 101000 } },
    { slot: 'Ring 2', before: base, after: { ...base, CombinedDPS: 110000 } },
  ]);
  assert.strictEqual(all[0].slot, 'Ring 2');
});

test('number formatting', () => {
  assert.strictEqual(fmtNum(123456, 'int'), '123.5k');
  assert.strictEqual(fmtNum(2500000, 'int'), '2.50M');
  assert.strictEqual(fmtNum(74.99, 'res'), '75%');
});

test('a slot that keeps resistances capped beats a slightly better one that loses them', () => {
  const all = judgeAll([
    { slot: 'Ring 1', before: base, after: { ...base, CombinedDPS: 118000, FireResist: 50, MissingFireResist: 25 } },
    { slot: 'Ring 2', before: base, after: { ...base, CombinedDPS: 115000 } },
  ]);
  assert.strictEqual(all[0].slot, 'Ring 2');
});
