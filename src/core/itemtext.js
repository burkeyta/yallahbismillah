'use strict';

// Quick checks on what the game put on the clipboard, before asking Path of Building.

// The game's item copy starts with "Item Class:" (English client)
function isItemText(text) {
  return typeof text === 'string' && /^\s*Item Class:/.test(text) && text.includes('--------');
}

// name lines for the popup header while PoB is still working
function header(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const rarityLine = lines.find((l) => l.startsWith('Rarity:'));
  const rarity = rarityLine ? rarityLine.slice(7).trim() : '';
  const i = rarityLine ? lines.indexOf(rarityLine) : -1;
  const names = [];
  for (let j = i + 1; j < lines.length && lines[j] !== '--------'; j++) if (lines[j].trim()) names.push(lines[j].trim());
  return { rarity, name: names[0] || '', base: names[1] || '' };
}

// Things that can't be equipped: no point asking PoB about them
function notGear(text) {
  const m = String(text).match(/^\s*Item Class:\s*(.+)$/m);
  const cls = m ? m[1].trim() : '';
  if (/^(Stackable Currency|Map Fragments|Waystones|Tablet|Socketable|Omen|Divination Cards|Expedition Logbooks|Relics|Pinnacle Keys|Trial Coins|Uncut (Skill|Spirit|Support) Gems|Skill Gems|Support Gems)/i.test(cls)) return cls;
  return null;
}

module.exports = { isItemText, header, notGear };
