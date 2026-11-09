'use strict';
/* Number formatting shared by the popup (kept in step with src/core/verdict.js fmtNum). */

window.fmt = {
  num(v, f) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '–';
    if (f === 'res' || f === 'pct') return `${Math.round(v * 10) / 10}%`;
    if (f === 'mult') return `${Math.round(v * 1000) / 10}%`;
    if (f === 'dec') return (Math.round(v * 100) / 100).toString();
    const a = Math.abs(v);
    if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
    return Math.round(v).toLocaleString('en-US');
  },
  // "+12.3%" / "−4%" / "new"
  pct(p, diff) {
    if (p === null || p === undefined) return diff > 0 ? 'new' : '';
    const s = Math.abs(p) >= 100 ? Math.round(Math.abs(p)).toString() : Math.abs(p).toFixed(1).replace(/\.0$/, '');
    return `${p > 0 ? '+' : p < 0 ? '−' : ''}${s}%`;
  },
  // signed difference in the stat's own unit
  diff(d, f) {
    const sign = d > 0 ? '+' : d < 0 ? '−' : '';
    if (f === 'res' || f === 'pct') return `${sign}${Math.round(Math.abs(d) * 10) / 10}%`;
    if (f === 'mult') return `${sign}${Math.round(Math.abs(d) * 1000) / 10}%`;
    if (f === 'dec') return `${sign}${Math.round(Math.abs(d) * 100) / 100}`;
    return `${sign}${window.fmt.num(Math.abs(d), f)}`;
  },
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};
