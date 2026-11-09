'use strict';

// Reads whatever the player pastes as their build and returns Path of Building's XML:
//   - a pobb.in link (https://pobb.in/AbC123)      -> fetched from pobb.in, then decoded
//   - a Path of Building export code (eNrtW...)    -> base64url + zlib, decoded locally
//   - the XML itself (<PathOfBuilding2>...)         -> used as it is

const zlib = require('zlib');

function decodeCode(code) {
  const clean = String(code).trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/=]+$/.test(clean)) throw new Error('This is not a Path of Building code.');
  let xml;
  try {
    xml = zlib.inflateSync(Buffer.from(clean, 'base64')).toString('utf8');
  } catch {
    throw new Error('This Path of Building code could not be decoded. Copy it again with Export → Copy.');
  }
  checkXml(xml);
  return xml;
}

function checkXml(xml) {
  if (!/<PathOfBuilding/i.test(xml)) throw new Error('This does not look like a Path of Building build.');
  return xml;
}

function pobbinId(text) {
  const m = String(text).trim().match(/^(?:https?:\/\/)?(?:www\.)?pobb\.in\/(?:u\/[^/]+\/)?([A-Za-z0-9_-]+)\/?(?:raw)?$/i);
  return m ? m[1] : null;
}

// fetchText(url) -> Promise<string>; passed in so tests need no network
async function toXml(input, fetchText) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Paste a pobb.in link or a Path of Building code.');
  if (text.startsWith('<')) return checkXml(text);
  const id = pobbinId(text);
  if (id) {
    if (!fetchText) throw new Error('Cannot fetch pobb.in links here.');
    let code;
    try {
      code = await fetchText(`https://pobb.in/${id}/raw`);
    } catch (e) {
      throw new Error(`pobb.in did not answer: ${e.message}`);
    }
    return decodeCode(code);
  }
  if (/^https?:\/\//i.test(text)) throw new Error('Only pobb.in links are supported. In Path of Building use Export → Generate code, or copy the code itself.');
  return decodeCode(text);
}

module.exports = { toXml, decodeCode, pobbinId };
