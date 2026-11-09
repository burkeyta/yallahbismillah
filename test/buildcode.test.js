'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { toXml, pobbinId } = require('../src/core/buildcode');

const xml = '<?xml version="1.0"?><PathOfBuilding2><Build level="90"/></PathOfBuilding2>';
const code = zlib.deflateSync(Buffer.from(xml)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

test('decodes a Path of Building code', async () => {
  assert.strictEqual(await toXml(code), xml);
});

test('accepts the XML itself', async () => {
  assert.strictEqual(await toXml(xml), xml);
});

test('fetches pobb.in links', async () => {
  let asked = null;
  const out = await toXml('https://pobb.in/AbC_12-x', async (url) => { asked = url; return code; });
  assert.strictEqual(asked, 'https://pobb.in/AbC_12-x/raw');
  assert.strictEqual(out, xml);
});

test('recognises pobb.in link forms', () => {
  assert.strictEqual(pobbinId('pobb.in/xyz'), 'xyz');
  assert.strictEqual(pobbinId('https://pobb.in/xyz/raw'), 'xyz');
  assert.strictEqual(pobbinId('https://example.com/xyz'), null);
});

test('rejects garbage with a readable message', async () => {
  await assert.rejects(toXml('hello world!'), /not a Path of Building code/);
  await assert.rejects(toXml('https://example.com/a'), /Only pobb.in links/);
});
