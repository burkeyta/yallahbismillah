'use strict';

// Turns Path of Building's before/after numbers for one slot into what the popup shows:
// the damage line, the changed stats, warnings, and an overall verdict.
//
//   judge({ slot, replacing, before, after }, item) -> {
//     slot, replacing, verdict: 'upgrade'|'downgrade'|'mixed'|'same',
//     dps: { key, label, from, to, diff, pct } | null,
//     rows: [ { key, label, from, to, diff, pct, good, fmt } ],
//     warnings: [ string ], score
//   }

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// which damage number the build is judged on: Full DPS if PoB adds skills up, else minion
// DPS for minion builds, else the main skill's combined DPS
function dpsKey(before, after) {
  if (n(before.FullDPS) > 0 || n(after.FullDPS) > 0) return 'FullDPS';
  const own = Math.max(n(before.CombinedDPS), n(before.TotalDPS));
  if (n(before.MinionDPS) > own) return 'MinionDPS';
  if (n(before.CombinedDPS) > 0 || n(after.CombinedDPS) > 0) return 'CombinedDPS';
  return 'TotalDPS';
}

const DPS_LABEL = { FullDPS: 'Full DPS', MinionDPS: 'Minion DPS', CombinedDPS: 'DPS', TotalDPS: 'DPS' };

// stats listed under the damage line, in order. fmt: 'int' | 'dec' | 'pct' | 'mult'
const STATS = [
  { key: 'AverageHit', label: 'Average hit', fmt: 'int', offence: true },
  { key: 'Speed', label: 'Attack/cast rate', fmt: 'dec', offence: true },
  { key: 'CritChance', label: 'Crit chance', fmt: 'pct', offence: true },
  { key: 'HitChance', label: 'Hit chance', fmt: 'pct', offence: true },
  { key: 'TotalEHP', label: 'Effective HP', fmt: 'int' },
  { key: 'Life', label: 'Life', fmt: 'int' },
  { key: 'EnergyShield', label: 'Energy shield', fmt: 'int' },
  { key: 'Mana', label: 'Mana', fmt: 'int' },
  { key: 'Spirit', label: 'Spirit', fmt: 'int' },
  { key: 'Armour', label: 'Armour', fmt: 'int' },
  { key: 'Evasion', label: 'Evasion', fmt: 'int' },
  { key: 'BlockChance', label: 'Block chance', fmt: 'pct' },
  { key: 'MovementSpeedMod', label: 'Movement speed', fmt: 'mult' },
  { key: 'FireResist', label: 'Fire res', fmt: 'res', res: 'Fire' },
  { key: 'ColdResist', label: 'Cold res', fmt: 'res', res: 'Cold' },
  { key: 'LightningResist', label: 'Lightning res', fmt: 'res', res: 'Lightning' },
  { key: 'ChaosResist', label: 'Chaos res', fmt: 'res', res: 'Chaos' },
  { key: 'Str', label: 'Strength', fmt: 'int' },
  { key: 'Dex', label: 'Dexterity', fmt: 'int' },
  { key: 'Int', label: 'Intelligence', fmt: 'int' },
];

function change(from, to) {
  const diff = to - from;
  const pct = from !== 0 ? (diff / Math.abs(from)) * 100 : (to !== 0 ? Infinity : 0);
  return { from, to, diff, pct: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null };
}

// a change too small to show (rounding noise)
function negligible(c, fmt) {
  if (c.diff === 0) return true;
  if (fmt === 'res' || fmt === 'pct') return Math.abs(c.diff) < 0.05;
  if (fmt === 'mult') return Math.abs(c.diff) < 0.0005;
  if (c.pct !== null && Math.abs(c.pct) < 0.05 && Math.abs(c.diff) < 1) return true;
  return false;
}

function judge(result, item) {
  const before = result.before || {};
  const after = result.after || {};
  const key = dpsKey(before, after);
  const dpsFrom = n(before[key]);
  const dpsTo = n(after[key]);
  const dps = dpsFrom > 0 || dpsTo > 0 ? { key, label: DPS_LABEL[key], ...change(dpsFrom, dpsTo) } : null;

  const rows = [];
  for (const s of STATS) {
    // the main skill's hit/speed only matter when the damage line is that skill
    if (s.offence && (key === 'FullDPS' || key === 'MinionDPS')) continue;
    const c = change(n(before[s.key]), n(after[s.key]));
    if (negligible(c, s.fmt)) continue;
    rows.push({ key: s.key, label: s.label, fmt: s.fmt, good: c.diff > 0, ...c });
  }

  const warnings = [];
  // resistances: falling below the maximum is what hurts
  for (const el of ['Fire', 'Cold', 'Lightning', 'Chaos']) {
    const missB = n(before[`Missing${el}Resist`]);
    const missA = n(after[`Missing${el}Resist`]);
    if (missA > missB && missA > 0) {
      warnings.push(`${el} resistance ${fmtNum(n(before[`${el}Resist`]), 'res')} → ${fmtNum(n(after[`${el}Resist`]), 'res')} (${fmtNum(missA, 'res')} below max)`);
    }
  }
  if (n(after.SpiritUnreserved) < 0 && n(after.SpiritUnreserved) < n(before.SpiritUnreserved)) {
    warnings.push(`Not enough Spirit: ${fmtNum(-n(after.SpiritUnreserved), 'int')} short for your reservations`);
  }
  if (item && item.req) {
    for (const [k, label] of [['str', 'Str'], ['dex', 'Dex'], ['int', 'Int']]) {
      const need = n(item.req[k]);
      const have = n(after[label]);
      if (need > 0 && have > 0 && have < need) warnings.push(`Needs ${need} ${label === 'Str' ? 'Strength' : label === 'Dex' ? 'Dexterity' : 'Intelligence'} (you'd have ${Math.floor(have)})`);
    }
  }

  // overall: damage and effective HP are what matter; a lost resistance is never an upgrade
  const dpsPct = dps && dps.pct !== null ? dps.pct : (dps && dps.diff > 0 ? 100 : 0);
  const ehp = change(n(before.TotalEHP), n(after.TotalEHP));
  const ehpPct = ehp.pct || 0;
  // a warning (lost resistance, short of Spirit, can't wear it) outweighs a modest gain
  const score = dpsPct + ehpPct * 0.5 - warnings.length * 25;
  let verdict;
  if (Math.abs(dpsPct) < 0.5 && Math.abs(ehpPct) < 0.5 && !rows.length) verdict = 'same';
  else if (dpsPct >= -0.5 && ehpPct >= -0.5 && (dpsPct > 0.5 || ehpPct > 0.5 || rows.some((r) => r.good))) verdict = 'upgrade';
  else if (dpsPct <= 0.5 && ehpPct <= 0.5) verdict = 'downgrade';
  else verdict = 'mixed';
  if (verdict === 'upgrade' && warnings.length) verdict = 'mixed';

  return { slot: result.slot, replacing: result.replacing || null, verdict, dps, rows, warnings, score };
}

// best slot first (e.g. which ring it should replace)
function judgeAll(results, item) {
  return (results || []).map((r) => judge(r, item)).sort((a, b) => b.score - a.score);
}

function fmtNum(v, fmt) {
  if (fmt === 'res' || fmt === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (fmt === 'mult') return `${Math.round(v * 1000) / 10}%`;
  if (fmt === 'dec') return (Math.round(v * 100) / 100).toString();
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return Math.round(v).toLocaleString('en-US');
}

module.exports = { judge, judgeAll, dpsKey, fmtNum, change };
