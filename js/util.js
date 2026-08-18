// Small DOM / formatting / dialog helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape untrusted text before it goes anywhere near innerHTML. */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ---------------------------------------------------------------- numbers */

export const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Round to 2dp without float noise. */
export const r2 = n => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** 1234.5 -> "1,234.50" */
export function money(n, decimals = 2) {
  return r2(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/** Compact form for stat tiles. */
export function compact(n) {
  const v = num(n);
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e5) return (v / 1e3).toFixed(1) + 'K';
  return money(v);
}

/* ------------------------------------------------------------------ dates */

export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay = d => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/** YYYY-MM-DD in local time (not UTC — matters for a shop in +05:30). */
export function dateKey(d) {
  const x = new Date(d);
  const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const fmtDateTime = ts => (ts ? `${fmtDate(ts)} ${fmtTime(ts)}` : '—');

/** "in 2 days" / "3 days ago" */
export function relDays(ts) {
  if (!ts) return '';
  const days = Math.round((startOfDay(ts) - startOfDay(Date.now())) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** Resolve a range key into {from, to} epoch ms. */
export function rangeFor(key, customFrom, customTo) {
  const now = new Date();
  switch (key) {
    case 'today':
      return { from: +startOfDay(now), to: +endOfDay(now) };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: +startOfDay(y), to: +endOfDay(y) };
    }
    case 'week': {
      // Monday-start calendar week
      const d = new Date(now);
      const dow = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dow);
      return { from: +startOfDay(d), to: +endOfDay(now) };
    }
    case 'month':
      return { from: +startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: +endOfDay(now) };
    case 'lastmonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: +startOfDay(s), to: +endOfDay(e) };
    }
    case 'custom':
      return {
        from: customFrom ? +startOfDay(new Date(customFrom)) : 0,
        to: customTo ? +endOfDay(new Date(customTo)) : +endOfDay(now)
      };
    default:
      return { from: 0, to: Number.MAX_SAFE_INTEGER };
  }
}

/* ------------------------------------------------------------------ toast */

export function toast(message, type = 'info', ms = 2600) {
  const root = $('#toast-root');
  if (!root) return;
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.textContent = message;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 250);
  }, ms);
}

/* ----------------------------------------------------------------- modals */

let modalSeq = 0;

/**
 * Open a sheet/modal. `body` is trusted HTML built by the caller — escape your data.
 * Returns { close, root }.
 */
export function openModal({ title, body, footer = '', size = '', onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = `modal-${++modalSeq}`;
  wrap.innerHTML = `
    <div class="modal ${size ? 'modal--' + size : ''}" role="dialog" aria-modal="true">
      <div class="modal__head">
        <h3>${esc(title)}</h3>
        <button class="icon-btn" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal__body">${body}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
    </div>`;
  $('#modal-root').appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));

  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => {
    wrap.classList.remove('is-open');
    setTimeout(() => wrap.remove(), 220);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };

  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);

  // Only autofocus on desktop — on mobile it yanks the keyboard open over the sheet.
  const firstField = wrap.querySelector('input, select, textarea');
  if (firstField && window.matchMedia('(min-width: 900px)').matches) {
    setTimeout(() => firstField.focus(), 60);
  }
  return { close, root: wrap };
}

/** Promise<boolean> confirmation sheet. Replaces window.confirm. */
export function confirmDialog(message, { title = 'Please confirm', okText = 'Confirm', danger = true } = {}) {
  return new Promise(resolve => {
    let done = false;
    const settle = v => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title,
      body: `<p class="dialog-text">${esc(message)}</p>`,
      footer: `
        <button class="btn btn--ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : ''}" data-yes>${esc(okText)}</button>`,
      onClose: () => settle(false)
    });
    m.root.querySelector('[data-no]').onclick = () => { settle(false); m.close(); };
    m.root.querySelector('[data-yes]').onclick = () => { settle(true); m.close(); };
  });
}

/** Promise<string|null> single-value prompt sheet. Replaces window.prompt. */
export function promptDialog({ title, label, value = '', type = 'text', okText = 'Save', hint = '' }) {
  return new Promise(resolve => {
    let done = false;
    const settle = v => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title,
      body: `
        <label class="field">
          <span>${esc(label)}</span>
          <input type="${esc(type)}" id="prompt-input" value="${esc(value)}"
                 ${type === 'number' ? 'inputmode="decimal" step="any"' : ''}>
        </label>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}`,
      footer: `
        <button class="btn btn--ghost" data-no>Cancel</button>
        <button class="btn" data-yes>${esc(okText)}</button>`,
      onClose: () => settle(null)
    });
    const input = m.root.querySelector('#prompt-input');
    setTimeout(() => { input.focus(); input.select(); }, 80);
    const ok = () => { settle(input.value); m.close(); };
    m.root.querySelector('[data-no]').onclick = () => { settle(null); m.close(); };
    m.root.querySelector('[data-yes]').onclick = ok;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  });
}

/* -------------------------------------------------------------------- csv */

export function toCSV(rows, headers) {
  const cell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(h => cell(h.label)).join(',');
  const body = rows.map(row => headers.map(h => cell(h.get(row))).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadCSV(filename, csv) {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields and embedded commas). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Debounce for search boxes. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Read a File as text (CSV import). */
export const readFileText = file => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsText(file);
});
