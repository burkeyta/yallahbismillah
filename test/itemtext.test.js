'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isItemText, header, notGear } = require('../src/core/itemtext');

const ring = `Item Class: Rings
Rarity: Rare
Storm Loop
Sapphire Ring
--------
Requirements:
Level: 40
--------
Item Level: 75
--------
+24% to Cold Resistance (implicit)
--------
+52 to maximum Life
`;

test('recognises an item copied from the game', () => {
  assert.ok(isItemText(ring));
  assert.ok(!isItemText('just some text'));
});

test('reads the name lines', () => {
  assert.deepStrictEqual(header(ring), { rarity: 'Rare', name: 'Storm Loop', base: 'Sapphire Ring' });
});

test('currency is not gear', () => {
  assert.ok(notGear('Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------'));
  assert.strictEqual(notGear(ring), null);
});
