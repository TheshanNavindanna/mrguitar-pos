// Instrument rentals — out, overdue tracking, return and charge.
import { state, on, dbPush, dbSet, dbDelete, stockDelta, inventoryList, itemById, isManager } from './store.js';
import {
  $, esc, money, num, int, r2, toast, openModal, confirmDialog,
  fmtDate, relDays, dateKey, startOfDay
} from './util.js';
import { pickCustomer } from './customers.js';

let filter = 'out';

const isOut = r => r.status === 'out';
const isOverdue = r => isOut(r) && r.dueAt && num(r.dueAt) < +startOfDay(Date.now());

export const outRentalsCount = () => state.rentals.filter(isOut).length;
export const overdueRentalsCount = () => state.rentals.filter(isOverdue).length;

/** Whole days out, minimum 1. */
export function rentalDays(rental, endTs = Date.now()) {
  const start = +startOfDay(num(rental.outAt) || endTs);
  const end = +startOfDay(endTs);
  return Math.max(1, Math.round((end - start) / 86400000));
}

export function rentalCharge(rental, endTs = Date.now()) {
  return r2(rentalDays(rental, endTs) * num(rental.rate));
}

function visible() {
  const list = state.rentals.slice().sort((a, b) => num(b.outAt) - num(a.outAt));
  if (filter === 'all') return list;
  if (filter === 'overdue') return list.filter(isOverdue);
  if (filter === 'returned') return list.filter(r => r.status === 'returned');
  return list.filter(isOut);
}

/* --------------------------------------------------------------- render */

function render() {
  const box = $('#rentals-list');
  if (!box) return;
  const list = visible();

  box.innerHTML = list.length
    ? list.map(r => {
        const overdue = isOverdue(r);
        const badge = r.status === 'returned'
          ? '<span class="badge badge--mute">Returned</span>'
          : overdue
            ? '<span class="badge badge--danger">Overdue</span>'
            : '<span class="badge badge--info">Out</span>';
        return `
        <button class="list__row" data-rental="${esc(r.id)}">
          <div class="list__main">
            <div class="list__title">${esc(r.itemName)}</div>
            <div class="list__sub">${esc(r.customerName || 'Walk-in')}${r.phone ? ' · ' + esc(r.phone) : ''}</div>
            <div class="tiny ${overdue ? 'text-red strong' : 'muted'}">
              Out ${fmtDate(r.outAt)}${r.dueAt ? ` · due ${fmtDate(r.dueAt)} (${relDays(r.dueAt)})` : ''}
            </div>
          </div>
          <div class="list__side">
            ${badge}
            <div class="tiny strong mt">${money(r.status === 'returned' ? num(r.charge) : rentalCharge(r))}</div>
          </div>
        </button>`;
      }).join('')
    : '<div class="empty"><span class="ico">🎸</span>Nothing here</div>';
}

/* ------------------------------------------------------------ rent out */

export function newRental() {
  let customerId = null;
  let customerName = '';
  const rentables = inventoryList().filter(i => i.trackStock !== false);

  const m = openModal({
    title: 'Rent out an instrument',
    body: `
      <button class="btn btn--ghost btn--block mb" id="r-customer">👤 Choose customer</button>
      <div class="field-row">
        <label class="field"><span>Contact name *</span><input type="text" id="r-name"></label>
        <label class="field"><span>Phone</span><input type="tel" id="r-phone" inputmode="tel"></label>
      </div>

      <label class="field"><span>Item from inventory</span>
        <select id="r-item">
          <option value="">— not in inventory —</option>
          ${rentables.map(i => `<option value="${esc(i.id)}">${esc(i.name)} (${int(i.stock, 0)} in stock)</option>`).join('')}
        </select></label>

      <label class="field"><span>Item description *</span>
        <input type="text" id="r-itemname" placeholder="e.g. Fender Squier Strat + amp"></label>

      <div class="field-row">
        <label class="field"><span>Rate per day *</span>
          <input type="number" id="r-rate" step="any" inputmode="decimal"></label>
        <label class="field"><span>Deposit taken</span>
          <input type="number" id="r-deposit" step="any" inputmode="decimal"></label>
      </div>

      <div class="field-row">
        <label class="field"><span>Out on</span>
          <input type="date" id="r-out" value="${dateKey(Date.now())}"></label>
        <label class="field"><span>Due back</span>
          <input type="date" id="r-due"></label>
      </div>

      <label class="field"><span>ID / security taken</span>
        <input type="text" id="r-security" placeholder="NIC no, licence, etc."></label>
      <label class="field"><span>Note</span>
        <input type="text" id="r-note" placeholder="Condition on hand-over"></label>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn" data-ok>Rent out</button>`
  });

  m.root.querySelector('#r-customer').onclick = async () => {
    const c = await pickCustomer();
    if (c === undefined) return;
    customerId = c ? c.id : null;
    customerName = c ? c.name : '';
    m.root.querySelector('#r-customer').textContent = `👤 ${customerName || 'Walk-in'}`;
    if (c) {
      m.root.querySelector('#r-name').value = c.name;
      if (c.phone) m.root.querySelector('#r-phone').value = c.phone;
    }
  };

  m.root.querySelector('#r-item').onchange = e => {
    const it = itemById(e.target.value);
    if (it) {
      m.root.querySelector('#r-itemname').value = it.name;
      if (!num(m.root.querySelector('#r-rate').value)) {
        // A sensible starting point: ~2% of retail per day.
        m.root.querySelector('#r-rate').value = Math.round(num(it.price) * 0.02);
      }
    }
  };

  m.root.querySelector('[data-ok]').onclick = () => {
    const itemName = m.root.querySelector('#r-itemname').value.trim();
    const name = m.root.querySelector('#r-name').value.trim();
    const rate = num(m.root.querySelector('#r-rate').value, NaN);
    if (!itemName) return toast('Item description is required', 'error');
    if (!name) return toast('Contact name is required', 'error');
    if (!Number.isFinite(rate) || rate < 0) return toast('Enter a daily rate', 'error');

    const itemId = m.root.querySelector('#r-item').value || null;
    const outRaw = m.root.querySelector('#r-out').value;
    const dueRaw = m.root.querySelector('#r-due').value;

    if (itemId) {
      const it = itemById(itemId);
      if (int(it?.stock, 0) < 1) return toast('That item is out of stock', 'error');
      stockDelta(itemId, -1);
    }

    dbPush('rentals', {
      itemId,
      itemName,
      customerId,
      customerName: name,
      phone: m.root.querySelector('#r-phone').value.trim(),
      rate,
      deposit: num(m.root.querySelector('#r-deposit').value, 0),
      outAt: outRaw ? +new Date(outRaw) : Date.now(),
      dueAt: dueRaw ? +new Date(dueRaw) : null,
      security: m.root.querySelector('#r-security').value.trim(),
      note: m.root.querySelector('#r-note').value.trim(),
      status: 'out',
      timestamp: Date.now(),
      byName: state.profile?.name || ''
    });

    toast('Rental recorded', 'success');
    m.close();
  };
}

/* -------------------------------------------------------------- return */

function returnRental(r) {
  const suggested = rentalCharge(r);
  const m = openModal({
    title: `Return · ${r.itemName}`,
    size: 'narrow',
    body: `
      <p class="small muted mb">
        Out since ${fmtDate(r.outAt)} · ${rentalDays(r)} day${rentalDays(r) === 1 ? '' : 's'} × ${money(r.rate)}/day
      </p>
      <label class="field"><span>Rental charge</span>
        <input type="number" id="ret-charge" step="any" inputmode="decimal" value="${suggested}"></label>
      <label class="field"><span>Damage / late fee</span>
        <input type="number" id="ret-fee" step="any" inputmode="decimal" value="0"></label>
      ${num(r.deposit) > 0 ? `<p class="hint">Deposit held: ${money(r.deposit)} — refund it after settling the charge.</p>` : ''}
      <label class="field-check">
        <input type="checkbox" id="ret-charge-now" checked>
        <span>Add the charge to the register now</span></label>
      <label class="field"><span>Condition on return</span>
        <input type="text" id="ret-note" placeholder="optional"></label>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn btn--green" data-ok>Mark returned</button>`
  });

  m.root.querySelector('[data-ok]').onclick = async () => {
    const charge = num(m.root.querySelector('#ret-charge').value, 0);
    const fee = num(m.root.querySelector('#ret-fee').value, 0);
    const total = r2(charge + fee);

    dbSet(`rentals/${r.id}/status`, 'returned');
    dbSet(`rentals/${r.id}/returnedAt`, Date.now());
    dbSet(`rentals/${r.id}/charge`, total);
    dbSet(`rentals/${r.id}/days`, rentalDays(r));
    dbSet(`rentals/${r.id}/returnNote`, m.root.querySelector('#ret-note').value.trim());

    if (r.itemId) stockDelta(r.itemId, 1);

    if (m.root.querySelector('#ret-charge-now').checked && total > 0) {
      const { cart, addCustomLine, renderCart } = await import('./pos.js');
      addCustomLine({ name: `Rental — ${r.itemName} (${rentalDays(r)} days)`, price: charge });
      if (fee > 0) addCustomLine({ name: `Late / damage fee — ${r.itemName}`, price: fee });
      cart.customerId = r.customerId || null;
      cart.customerName = r.customerName || '';
      renderCart();
      document.querySelector('[data-tab="pos"]')?.click();
      toast('Rental charge added to cart', 'success');
    } else {
      toast('Rental closed', 'success');
    }
    m.close();
  };
}

/* -------------------------------------------------------------- detail */

function showRental(id) {
  const r = state.rentals.find(x => x.id === id);
  if (!r) return;
  const running = r.status === 'out' ? rentalCharge(r) : num(r.charge);

  const m = openModal({
    title: r.itemName,
    body: `
      <div class="card">
        <div class="small">
          <b>${esc(r.customerName || 'Walk-in')}</b>${r.phone ? ` · ${esc(r.phone)}` : ''}<br>
          Out ${fmtDate(r.outAt)}${r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ''}
          ${r.returnedAt ? `<br>Returned ${fmtDate(r.returnedAt)}` : ''}
          ${r.security ? `<br>Security: ${esc(r.security)}` : ''}
          ${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}
        </div>
      </div>
      <div class="totals">
        <div class="totals__row"><span>Daily rate</span><span>${money(r.rate)}</span></div>
        <div class="totals__row"><span>Days out</span><span>${r.status === 'returned' ? int(r.days, rentalDays(r, r.returnedAt)) : rentalDays(r)}</span></div>
        ${num(r.deposit) ? `<div class="totals__row"><span>Deposit held</span><span>${money(r.deposit)}</span></div>` : ''}
        <div class="totals__row totals__row--grand"><span>${r.status === 'returned' ? 'Charged' : 'Running total'}</span><span>${money(running)}</span></div>
      </div>`,
    footer: `
      ${r.phone ? `<a class="btn btn--ghost" href="tel:${esc(r.phone)}">Call</a>` : ''}
      ${isManager() ? '<button class="btn btn--ghost btn--danger" data-del>Delete</button>' : ''}
      ${r.status === 'out' ? '<button class="btn btn--green" data-return>Mark returned</button>' : ''}`
  });

  const ret = m.root.querySelector('[data-return]');
  if (ret) ret.onclick = () => { m.close(); returnRental(r); };

  const del = m.root.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (await confirmDialog('Delete this rental record?')) {
      if (r.status === 'out' && r.itemId) stockDelta(r.itemId, 1);
      dbDelete(`rentals/${r.id}`);
      toast('Rental deleted', 'info');
      m.close();
    }
  };
}

/* --------------------------------------------------------------- mount */

export function mountRentals() {
  $('#rental-add').onclick = newRental;

  $('#rentals-filter').addEventListener('click', e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    filter = b.dataset.status;
    $('#rentals-filter').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    render();
  });

  $('#rentals-list').addEventListener('click', e => {
    const b = e.target.closest('[data-rental]');
    if (b) showRental(b.dataset.rental);
  });

  on('rentals', render);
  render();
}
