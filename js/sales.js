// Sales history, invoice detail, refunds and CSV export.
import {
  state, on, dbPush, dbSet, stockDelta, salesBetween, isManager
} from './store.js';
import {
  $, esc, money, num, int, r2, toast, openModal, confirmDialog,
  debounce, fmtDate, fmtDateTime, rangeFor, toCSV, downloadCSV
} from './util.js';
import { showReceipt, printReceipt } from './receipt.js';

let range = 'today';
let search = '';

const METHOD_LABEL = { cash: 'Cash', card: 'Card', bank: 'Bank', credit: 'Credit', cheque: 'Cheque' };

function currentSales() {
  const { from, to } = rangeFor(range);
  const term = search.trim().toLowerCase();
  return salesBetween(from, to).filter(s => {
    if (!term) return true;
    return String(s.invoiceNo || '').toLowerCase().includes(term)
      || String(s.customerName || '').toLowerCase().includes(term)
      || String(s.itemsText || '').toLowerCase().includes(term);
  });
}

/* --------------------------------------------------------------- render */

function renderStats(list) {
  const box = $('#sales-stats');
  if (!box) return;
  const active = list.filter(s => s.status !== 'refunded');
  const revenue = active.reduce((sum, s) => sum + num(s.total) - num(s.refundedAmount), 0);
  const profit = active.reduce((sum, s) => sum + num(s.profit) - num(s.refundedProfit), 0);
  const due = list.reduce((sum, s) => sum + num(s.due), 0);

  box.innerHTML = `
    <div class="stat stat--amber"><b>${money(revenue, 0)}</b><span>Revenue</span></div>
    <div class="stat stat--green"><b>${money(profit, 0)}</b><span>Profit</span></div>
    <div class="stat"><b>${list.length}</b><span>Sales</span></div>
    <div class="stat ${due > 0 ? 'stat--red' : ''}"><b>${money(due, 0)}</b><span>Unpaid</span></div>`;
}

function statusBadge(s) {
  if (s.status === 'refunded') return '<span class="badge badge--danger">Refunded</span>';
  if (s.status === 'partial-refund') return '<span class="badge badge--warn">Part refund</span>';
  if (num(s.due) > 0) return '<span class="badge badge--danger">Due ' + money(s.due) + '</span>';
  return '';
}

function render() {
  const box = $('#sales-list');
  if (!box) return;
  const list = currentSales();

  box.innerHTML = list.length
    ? list.map(s => `
        <button class="list__row" data-sale="${esc(s.id)}">
          <div class="list__main">
            <div class="list__title">${esc(s.invoiceNo || '—')} ${statusBadge(s)}</div>
            <div class="list__sub">${fmtDateTime(s.timestamp)}${s.customerName ? ' · ' + esc(s.customerName) : ''}</div>
            <div class="tiny muted">${esc(s.itemsText || '')}</div>
          </div>
          <div class="list__side">
            <div class="strong">${money(s.total)}</div>
            <div class="tiny muted">${(s.payments || []).map(p => METHOD_LABEL[p.method] || p.method).join(', ')}</div>
          </div>
        </button>`).join('')
    : '<div class="empty"><span class="ico">🧾</span>No sales in this period</div>';

  renderStats(list);
}

/* --------------------------------------------------------------- detail */

export function showSale(id) {
  const s = state.sales.find(x => x.id === id);
  if (!s) return;

  const lines = (s.lines || []).map(l => `
    <tr>
      <td>${esc(l.name)}<br><span class="tiny muted">${l.qty} × ${money(l.unitPrice)}${l.returnedQty ? ` · <span class="text-red">${l.returnedQty} returned</span>` : ''}</span></td>
      <td class="right nowrap">${money(l.lineTotal)}</td>
    </tr>`).join('');

  const payments = (s.payments || []).map(p =>
    `<div class="totals__row"><span>${esc(METHOD_LABEL[p.method] || p.method)}${p.ref ? ` (${esc(p.ref)})` : ''}</span><span>${money(p.amount)}</span></div>`
  ).join('');

  const canRefund = isManager() && s.status !== 'refunded';

  const m = openModal({
    title: `Invoice ${s.invoiceNo || ''}`,
    body: `
      <div class="small muted mb">
        ${fmtDateTime(s.timestamp)}<br>
        Served by ${esc(s.cashierName || s.cashierEmail || '—')}
        ${s.customerName ? `<br>Customer: ${esc(s.customerName)}` : ''}
      </div>
      ${s.status !== 'completed' ? `<div class="alert" style="background:var(--primary-soft);color:var(--primary-dark)">
        ${s.status === 'refunded' ? 'This sale was fully refunded.' : 'This sale was partially refunded.'}
        ${num(s.refundedAmount) ? ` Refunded: ${money(s.refundedAmount)}` : ''}</div>` : ''}

      <div class="table-wrap mb"><table><tbody>${lines}</tbody></table></div>

      <div class="totals">
        <div class="totals__row"><span>Subtotal</span><span>${money(s.subtotal)}</span></div>
        ${num(s.itemDiscount) > 0 ? `<div class="totals__row"><span>Item discounts</span><span>-${money(s.itemDiscount)}</span></div>` : ''}
        ${num(s.discount) > 0 ? `<div class="totals__row"><span>Discount</span><span>-${money(s.discount)}</span></div>` : ''}
        ${num(s.tax) > 0 ? `<div class="totals__row"><span>Tax (${s.taxPercent}%)</span><span>${money(s.tax)}</span></div>` : ''}
        <div class="totals__row totals__row--grand"><span>Total</span><span>${money(s.total)}</span></div>
      </div>

      <h4 class="mt mb">Payment</h4>
      ${payments}
      ${num(s.change) > 0 ? `<div class="totals__row"><span>Change given</span><span>${money(s.change)}</span></div>` : ''}
      ${num(s.due) > 0 ? `<div class="totals__row text-red"><span><b>Outstanding</b></span><span><b>${money(s.due)}</b></span></div>` : ''}

      ${isManager() ? `<div class="totals mt">
        <div class="totals__row muted"><span>Cost</span><span>${money(s.cost)}</span></div>
        <div class="totals__row text-green"><span>Profit</span><span>${money(num(s.profit) - num(s.refundedProfit))}</span></div>
      </div>` : ''}

      ${s.note ? `<p class="small muted mt">Note: ${esc(s.note)}</p>` : ''}`,
    footer: `
      ${canRefund ? '<button class="btn btn--ghost btn--danger" data-refund>Refund</button>' : ''}
      ${num(s.due) > 0 && isManager() ? '<button class="btn btn--green" data-settle>Settle</button>' : ''}
      <button class="btn" data-receipt>Receipt</button>`
  });

  m.root.querySelector('[data-receipt]').onclick = () => showReceipt(s);
  const refundBtn = m.root.querySelector('[data-refund]');
  if (refundBtn) refundBtn.onclick = () => { m.close(); openRefund(s); };
  const settleBtn = m.root.querySelector('[data-settle]');
  if (settleBtn) settleBtn.onclick = () => { m.close(); settleDue(s); };
}

/* ---------------------------------------------------------------- due */

function settleDue(sale) {
  const m = openModal({
    title: `Settle ${sale.invoiceNo}`,
    size: 'narrow',
    body: `
      <p class="mb">Outstanding: <b>${money(sale.due)}</b></p>
      <label class="field"><span>Amount received</span>
        <input type="number" id="settle-amt" step="any" inputmode="decimal" value="${num(sale.due)}"></label>
      <label class="field"><span>Method</span>
        <select id="settle-method">
          <option value="cash">Cash</option><option value="card">Card</option>
          <option value="bank">Bank transfer</option><option value="cheque">Cheque</option>
        </select></label>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn btn--green" data-ok>Record payment</button>`
  });

  m.root.querySelector('[data-ok]').onclick = () => {
    const amt = num(m.root.querySelector('#settle-amt').value);
    if (amt <= 0) return toast('Enter an amount', 'error');
    const method = m.root.querySelector('#settle-method').value;
    const payments = [...(sale.payments || []).filter(p => p.method !== 'credit')];
    const remaining = r2(num(sale.due) - amt);

    payments.push({ method, amount: r2(Math.min(amt, num(sale.due))), ref: 'settlement', at: Date.now() });
    if (remaining > 0) payments.push({ method: 'credit', amount: remaining, ref: '' });

    dbSet(`sales/${sale.id}/payments`, payments);
    dbSet(`sales/${sale.id}/paid`, r2(num(sale.paid) + amt));
    dbSet(`sales/${sale.id}/due`, Math.max(0, remaining));
    toast(remaining > 0 ? `Recorded. ${money(remaining)} still due` : 'Invoice settled', 'success');
    m.close();
  };
}

/* ------------------------------------------------------------- refunds */

export function openRefund(sale) {
  const lines = (sale.lines || []).map((l, idx) => ({
    ...l,
    idx,
    remaining: int(l.qty, 0) - int(l.returnedQty, 0)
  })).filter(l => l.remaining > 0);

  if (!lines.length) return toast('Everything on this invoice is already refunded', 'warn');

  const m = openModal({
    title: `Refund ${sale.invoiceNo}`,
    body: `
      <p class="small muted mb">Choose what is coming back. Stock is returned unless you untick it.</p>
      <div id="refund-lines">
        ${lines.map(l => `
          <div class="cart-line" data-idx="${l.idx}">
            <div class="cart-line__main">
              <div class="cart-line__name">${esc(l.name)}</div>
              <div class="cart-line__meta">${money(l.unitPrice)} each · ${l.remaining} refundable</div>
              <div class="row mt">
                <div class="stepper">
                  <button data-dec>−</button>
                  <input type="number" data-qty value="0" min="0" max="${l.remaining}" inputmode="numeric">
                  <button data-inc>+</button>
                </div>
                <button class="btn btn--ghost btn--sm" data-all>All</button>
              </div>
            </div>
            <div class="cart-line__side"><span class="cart-line__total" data-amt>0.00</span></div>
          </div>`).join('')}
      </div>

      <label class="field-check mt">
        <input type="checkbox" id="refund-restock" checked>
        <span>Return items to stock</span></label>

      <label class="field"><span>Reason</span>
        <select id="refund-reason">
          <option value="faulty">Faulty / damaged</option>
          <option value="wrong-item">Wrong item</option>
          <option value="changed-mind">Customer changed mind</option>
          <option value="other">Other</option>
        </select></label>
      <label class="field"><span>Note</span>
        <input type="text" id="refund-note" placeholder="optional"></label>

      <div class="change-box" id="refund-total">Refund: 0.00</div>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn btn--danger" data-ok>Process refund</button>`
  });

  const box = m.root.querySelector('#refund-lines');

  const lineOf = idx => lines.find(l => l.idx === int(idx));

  function refresh() {
    let total = 0;
    box.querySelectorAll('[data-idx]').forEach(row => {
      const l = lineOf(row.dataset.idx);
      const input = row.querySelector('[data-qty]');
      let q = Math.max(0, Math.min(int(input.value, 0), l.remaining));
      input.value = q;
      // Refund the discounted unit value so a discounted sale refunds fairly.
      const unitNet = num(l.lineTotal) / Math.max(1, int(l.qty, 1));
      const amt = r2(unitNet * q);
      row.querySelector('[data-amt]').textContent = money(amt);
      total += amt;
    });
    m.root.querySelector('#refund-total').textContent = `Refund: ${money(total)}`;
    return r2(total);
  }

  box.addEventListener('click', e => {
    const row = e.target.closest('[data-idx]');
    if (!row) return;
    const input = row.querySelector('[data-qty]');
    const l = lineOf(row.dataset.idx);
    if (e.target.closest('[data-inc]')) input.value = int(input.value, 0) + 1;
    else if (e.target.closest('[data-dec]')) input.value = int(input.value, 0) - 1;
    else if (e.target.closest('[data-all]')) input.value = l.remaining;
    else return;
    refresh();
  });
  box.addEventListener('input', refresh);

  m.root.querySelector('[data-ok]').onclick = async () => {
    const amount = refresh();
    if (amount <= 0) return toast('Set a quantity to refund', 'error');
    if (!(await confirmDialog(`Refund ${money(amount)} to the customer?`, { okText: 'Refund' }))) return;

    const restock = m.root.querySelector('#refund-restock').checked;
    const returnedLines = [];
    let refundedCost = 0;

    // idx (position in sale.lines) -> qty being returned now
    const qtyByIdx = new Map();
    box.querySelectorAll('[data-idx]').forEach(row => {
      const q = int(row.querySelector('[data-qty]').value, 0);
      if (q > 0) qtyByIdx.set(int(row.dataset.idx), q);
    });

    qtyByIdx.forEach((q, idx) => {
      const l = sale.lines[idx];
      const unitNet = num(l.lineTotal) / Math.max(1, int(l.qty, 1));
      returnedLines.push({
        itemId: l.itemId || null,
        name: l.name,
        qty: q,
        unitPrice: num(l.unitPrice),
        amount: r2(unitNet * q),
        buyPrice: num(l.buyPrice)
      });
      refundedCost += num(l.buyPrice) * q;
      if (restock && l.itemId && l.trackStock !== false) stockDelta(l.itemId, q);
    });

    // Update the original invoice.
    const updatedLines = (sale.lines || []).map((l, idx) => {
      const q = qtyByIdx.get(idx) || 0;
      return q > 0 ? { ...l, returnedQty: int(l.returnedQty, 0) + q } : l;
    });

    const fullyReturned = updatedLines.every(l => int(l.returnedQty, 0) >= int(l.qty, 0));
    const refundedAmount = r2(num(sale.refundedAmount) + amount);
    const refundedProfit = r2(num(sale.refundedProfit) + (amount - refundedCost));

    dbSet(`sales/${sale.id}/lines`, updatedLines);
    dbSet(`sales/${sale.id}/status`, fullyReturned ? 'refunded' : 'partial-refund');
    dbSet(`sales/${sale.id}/refundedAmount`, refundedAmount);
    dbSet(`sales/${sale.id}/refundedProfit`, refundedProfit);

    dbPush('returns', {
      saleId: sale.id,
      invoiceNo: sale.invoiceNo,
      timestamp: Date.now(),
      lines: returnedLines,
      amount,
      cost: r2(refundedCost),
      restocked: restock,
      reason: m.root.querySelector('#refund-reason').value,
      note: m.root.querySelector('#refund-note').value.trim(),
      byUid: state.user?.uid || '',
      byName: state.profile?.name || ''
    });

    toast(`Refunded ${money(amount)}`, 'success');
    m.close();
  };

  refresh();
}

/* ------------------------------------------------------------- export */

function exportSales() {
  const list = currentSales();
  if (!list.length) return toast('Nothing to export', 'warn');
  const csv = toCSV(list, [
    { label: 'Invoice', get: s => s.invoiceNo },
    { label: 'Date', get: s => fmtDate(s.timestamp) },
    { label: 'Time', get: s => new Date(num(s.timestamp)).toLocaleTimeString() },
    { label: 'Customer', get: s => s.customerName || 'Walk-in' },
    { label: 'Items', get: s => s.itemsText },
    { label: 'Subtotal', get: s => num(s.subtotal) },
    { label: 'Discount', get: s => num(s.discount) + num(s.itemDiscount) },
    { label: 'Tax', get: s => num(s.tax) },
    { label: 'Total', get: s => num(s.total) },
    { label: 'Cost', get: s => num(s.cost) },
    { label: 'Profit', get: s => num(s.profit) - num(s.refundedProfit) },
    { label: 'Paid', get: s => num(s.paid) },
    { label: 'Due', get: s => num(s.due) },
    { label: 'Methods', get: s => (s.payments || []).map(p => p.method).join(' + ') },
    { label: 'Cashier', get: s => s.cashierName || s.cashierEmail },
    { label: 'Status', get: s => s.status }
  ]);
  downloadCSV(`mrguitar-sales-${range}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  toast('Sales exported', 'success');
}

/* -------------------------------------------------------------- mount */

export function mountSales() {
  $('#sales-range').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    $('#sales-range').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    render();
  });

  $('#sales-search').addEventListener('input', debounce(e => { search = e.target.value; render(); }, 150));
  $('#sales-export').onclick = exportSales;

  $('#sales-list').addEventListener('click', e => {
    const b = e.target.closest('[data-sale]');
    if (b) showSale(b.dataset.sale);
  });

  on('sales', render);
  render();
}
