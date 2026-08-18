// Shop expenses — the other half of "am I actually making money".
import { state, on, dbPush, dbSet, dbDelete, isManager } from './store.js';
import {
  $, esc, money, num, toast, openModal, confirmDialog,
  fmtDate, dateKey, rangeFor, toCSV, downloadCSV
} from './util.js';

let range = 'month';

export const EXPENSE_CATEGORIES = [
  'Stock purchase', 'Rent', 'Electricity & water', 'Salaries', 'Transport',
  'Repairs & tools', 'Marketing', 'Bank & fees', 'Other'
];

function visible() {
  const { from, to } = rangeFor(range);
  return state.expenses
    .filter(e => num(e.timestamp) >= from && num(e.timestamp) <= to)
    .sort((a, b) => num(b.timestamp) - num(a.timestamp));
}

/* --------------------------------------------------------------- render */

function render() {
  const box = $('#exp-list');
  if (!box) return;
  const list = visible();
  const total = list.reduce((s, e) => s + num(e.amount), 0);

  const byCat = new Map();
  list.forEach(e => byCat.set(e.category, num(byCat.get(e.category)) + num(e.amount)));
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

  $('#exp-stats').innerHTML = `
    <div class="stat stat--red"><b>${money(total, 0)}</b><span>Total spent</span></div>
    <div class="stat"><b>${list.length}</b><span>Entries</span></div>
    <div class="stat"><b>${top ? esc(top[0]) : '—'}</b><span>Biggest category</span></div>
    <div class="stat"><b>${top ? money(top[1], 0) : '0'}</b><span>Spent there</span></div>`;

  box.innerHTML = list.length
    ? list.map(e => `
        <button class="list__row" data-exp="${esc(e.id)}">
          <div class="list__main">
            <div class="list__title">${esc(e.description || e.category)}</div>
            <div class="list__sub">${esc(e.category)} · ${fmtDate(e.timestamp)}${e.byName ? ' · ' + esc(e.byName) : ''}</div>
          </div>
          <div class="list__side"><div class="strong text-red">-${money(e.amount)}</div></div>
        </button>`).join('')
    : '<div class="empty"><span class="ico">🧮</span>No expenses recorded</div>';
}

/* -------------------------------------------------------------- editing */

export function editExpense(id) {
  const e = id ? state.expenses.find(x => x.id === id) : null;

  const m = openModal({
    title: e ? 'Edit expense' : 'New expense',
    size: 'narrow',
    body: `
      <label class="field"><span>Amount *</span>
        <input type="number" id="e-amount" step="any" inputmode="decimal" value="${esc(e?.amount ?? '')}"></label>
      <label class="field"><span>Category</span>
        <select id="e-category">
          ${EXPENSE_CATEGORIES.map(c => `<option ${e?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select></label>
      <label class="field"><span>Description</span>
        <input type="text" id="e-desc" value="${esc(e?.description || '')}" placeholder="Supplier, bill number…"></label>
      <label class="field"><span>Date</span>
        <input type="date" id="e-date" value="${dateKey(e?.timestamp || Date.now())}"></label>
      <label class="field"><span>Paid by</span>
        <select id="e-method">
          <option value="cash" ${e?.method === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="bank" ${e?.method === 'bank' ? 'selected' : ''}>Bank</option>
          <option value="card" ${e?.method === 'card' ? 'selected' : ''}>Card</option>
        </select></label>`,
    footer: `
      ${e ? '<button class="btn btn--ghost btn--danger" data-del>Delete</button>' : ''}
      <button class="btn" data-save>Save</button>`
  });

  m.root.querySelector('[data-save]').onclick = () => {
    const amount = num(m.root.querySelector('#e-amount').value, NaN);
    if (!Number.isFinite(amount) || amount <= 0) return toast('Enter a valid amount', 'error');
    const dateRaw = m.root.querySelector('#e-date').value;
    const payload = {
      amount,
      category: m.root.querySelector('#e-category').value,
      description: m.root.querySelector('#e-desc').value.trim(),
      method: m.root.querySelector('#e-method').value,
      timestamp: dateRaw ? +new Date(dateRaw) : Date.now(),
      byUid: state.user?.uid || '',
      byName: state.profile?.name || ''
    };
    if (e) dbSet(`expenses/${e.id}`, { ...e, ...payload, updatedAt: Date.now() });
    else dbPush('expenses', payload);
    toast('Expense saved', 'success');
    m.close();
  };

  const del = m.root.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (await confirmDialog('Delete this expense?')) {
      dbDelete(`expenses/${e.id}`);
      toast('Expense deleted', 'info');
      m.close();
    }
  };
}

/* --------------------------------------------------------------- mount */

export function mountExpenses() {
  $('#exp-add').onclick = () => editExpense(null);

  $('#exp-range').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    $('#exp-range').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    render();
  });

  $('#exp-list').addEventListener('click', e => {
    const b = e.target.closest('[data-exp]');
    if (b) editExpense(b.dataset.exp);
  });

  on('expenses', render);
  render();
}
