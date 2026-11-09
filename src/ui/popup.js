'use strict';
/* global fmt */

const card = document.getElementById('card');
const VERDICT = { upgrade: 'UPGRADE', downgrade: 'DOWNGRADE', mixed: 'MIXED', same: 'NO CHANGE' };
let current = null;
let selected = 0;

function rarityClass(r) {
  const x = String(r || '').toLowerCase();
  return x === 'unique' || x === 'relic' ? 'r-unique' : x === 'rare' ? 'r-rare' : x === 'magic' ? 'r-magic' : 'r-normal';
}

function head(p) {
  const h = p.head || {};
  const item = p.item || {};
  const name = item.title || item.name || h.name || '';
  const base = item.baseName || h.base || '';
  const rar = item.rarity || h.rarity;
  return `<div class="card-head"><span class="close" id="x">×</span>
    <div class="item-name ${rarityClass(rar)}">${fmt.esc(name)}</div>
    ${base && base !== name ? `<div class="item-base">${fmt.esc(base)}</div>` : ''}</div>`;
}

function slotLine(j) {
  const rep = j.replacing;
  if (j.slot === 'Flask' || j.slot === 'Charm') return `${j.slot}: having it active`;
  return rep ? `${fmt.esc(j.slot)}: replacing <span class="${rarityClass(rep.rarity)}">${fmt.esc(rep.title || rep.name)}</span>` : `${fmt.esc(j.slot)}: empty slot`;
}

function resultHtml(p) {
  const all = p.judged || [];
  const j = all[selected] || all[0];
  let h = head(p);
  h += `<div class="verdict v-${j.verdict}">${VERDICT[j.verdict]}</div>`;
  h += `<div class="slot-line">${slotLine(j)}</div>`;
  if (j.dps) {
    const cls = j.dps.diff > 0 ? 'good' : j.dps.diff < 0 ? 'bad' : '';
    h += `<div class="dps"><span class="label">${fmt.esc(j.dps.label)}${p.skill && j.dps.key !== 'FullDPS' ? ` (${fmt.esc(p.skill)})` : ''}</span>
      <span class="vals">${fmt.num(j.dps.from)} → ${fmt.num(j.dps.to)}</span>
      <span class="pct ${cls}">${j.dps.diff === 0 ? '±0%' : fmt.pct(j.dps.pct, j.dps.diff)}</span></div>`;
  }
  if (j.warnings.length) h += `<div class="warnings">${j.warnings.map((w) => `<div>${fmt.esc(w)}</div>`).join('')}</div>`;
  if (j.rows.length) {
    h += '<table class="stats">';
    for (const r of j.rows) {
      const cls = r.good ? 'good' : 'bad';
      const pct = r.fmt === 'int' || r.fmt === 'dec' ? fmt.pct(r.pct, r.diff) : fmt.diff(r.diff, r.fmt);
      h += `<tr><td class="l">${fmt.esc(r.label)}</td><td class="v">${fmt.num(r.from, r.fmt)} → ${fmt.num(r.to, r.fmt)}</td><td class="d ${cls}">${pct}</td></tr>`;
    }
    h += '</table>';
  } else if (!j.dps || j.dps.diff === 0) {
    h += '<div class="msg"><div class="msg-text">No change to your stats.</div></div>';
  }
  if (all.length > 1) {
    h += '<div class="others">';
    all.forEach((o, i) => {
      if (i === selected) return;
      const d = o.dps ? fmt.pct(o.dps.pct, o.dps.diff) : '';
      h += `<div class="o" data-i="${i}"><span>In ${fmt.esc(o.slot)}${o.replacing ? ' (instead of ' + fmt.esc(o.replacing.title || o.replacing.name) + ')' : ''}</span><span class="v-${o.verdict}">${d || VERDICT[o.verdict]}</span></div>`;
    });
    h += '</div>';
  }
  h += '<div class="foot">Path of Building · Esc or move the mouse away to close</div>';
  return h;
}

function render() {
  const p = current;
  if (!p) return;
  let h;
  if (p.kind === 'loading') {
    h = head(p) + '<div class="msg"><span class="spinner"></span>Path of Building is checking it…</div>';
  } else if (p.kind === 'result') {
    h = resultHtml(p);
  } else {
    h = head(p) + `<div class="msg"><div class="msg-title">${fmt.esc(p.title || '')}</div><div class="msg-text">${fmt.esc(p.text || '')}</div>
      ${p.kind === 'nobuild' ? '<div class="mt6"><span class="link" id="open">Open settings</span></div>' : ''}</div>`;
  }
  card.innerHTML = h;
  const x = document.getElementById('x'); if (x) x.onclick = () => window.api.close();
  const o = document.getElementById('open'); if (o) o.onclick = () => window.api.openSettings();
  card.querySelectorAll('.o[data-i]').forEach((el) => { el.onclick = () => { selected = Number(el.dataset.i); render(); }; });
  requestAnimationFrame(() => {
    const r = card.getBoundingClientRect();
    window.api.resize(Math.ceil(r.width) + 2, Math.ceil(r.height) + 2);
  });
}

window.api.onShow((p) => { current = p; selected = 0; render(); });
