'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '–');

function show(state) {
  const { settings, buildStatus, summary, version, engineProblem } = state;
  $('hk').textContent = settings.hotkey;
  if (document.activeElement !== $('hotkey')) $('hotkey').value = settings.hotkey;
  $('adv').checked = !!settings.advancedCopy;
  if (!$('build').value && settings.buildSource) $('build').value = settings.buildSource;
  $('ver').textContent = version;
  $('dir').textContent = state.dataDir || '';
  $('status').className = `status ${buildStatus.state}`;
  $('status').textContent = buildStatus.message;
  $('load').disabled = buildStatus.state === 'loading';
  $('problem').hidden = !engineProblem;
  $('problem').textContent = engineProblem ? `Path of Building is not available: ${engineProblem}` : '';
  if (summary && buildStatus.state !== 'loading') {
    const s = summary.stats || {};
    const dps = s.FullDPS > 0 ? ['Full DPS', s.FullDPS] : s.MinionDPS > (s.CombinedDPS || 0) ? ['Minion DPS', s.MinionDPS] : ['DPS', s.CombinedDPS || s.TotalDPS];
    const rows = [
      ['Character', `${summary.ascendancy || summary.className || '?'} · level ${summary.level || '?'}`],
      ['Main skill', summary.mainSkill || '–'],
      [dps[0], num(dps[1])],
      ['Life / ES', `${num(s.Life)} / ${num(s.EnergyShield)}`],
      ['Effective HP', num(s.TotalEHP)],
      ['Resistances', `${num(s.FireResist)}% / ${num(s.ColdResist)}% / ${num(s.LightningResist)}% / ${num(s.ChaosResist)}%`],
    ];
    $('summary').innerHTML = rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('');
    $('summary').hidden = false;
  } else {
    $('summary').hidden = true;
  }
}

$('load').onclick = async () => { $('load').disabled = true; show(await window.api.getState()); await window.api.loadBuild($('build').value); };
$('saveHotkey').onclick = async () => {
  const r = await window.api.setSettings({ hotkey: $('hotkey').value.trim() || 'F2' });
  $('hkmsg').textContent = r.ok ? 'Saved.' : 'That key could not be used (taken by another app?).';
  show(r.state);
};
$('adv').onchange = async () => show((await window.api.setSettings({ advancedCopy: $('adv').checked })).state);
$('check').onclick = async () => {
  const r = await window.api.checkText($('item').value);
  $('checkmsg').textContent = r.ok ? 'See the popup next to your mouse.' : r.error;
};
$('log').onclick = () => window.api.openLog();

window.api.onState(show);
window.api.getState().then(show);
