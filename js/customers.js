// Customer records + the picker used by the register.
import { state, on, dbPush, dbSet, dbDelete, customerById } from './store.js';
import {
  $, esc, money, num, toast, openModal, confirmDialog, debounce, fmtDate, uid
} from './util.js';

let search = '';

export const customerList = () =>
  Object.values(state.customers || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));

const matches = (c, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return String(c.name || '').toLowerCase().includes(t)
    || String(c.phone || '').toLowerCase().includes(t)
    || String(c.email || '').toLowerCase().includes(t);
};

/* ------------------------------------------------------------- history */

export function customerStats(customerId) {
  const sales = state.sales.filter(s => s.customerId === customerId && s.status !== 'refunded');
  const spent = sales.reduce((sum, s) => sum + num(s.total), 0);
  const due = state.sales
    .filter(s => s.customerId === customerId)
    .reduce((sum, s) => sum + num(s.due), 0);
  return { count: sales.length, spent, due, last: sales.length ? Math.max(...sales.map(s => num(s.timestamp))) : 0 };
}

/* -------------------------------------------------------------- picker */

/**
 * Resolve to a customer object, `null` for walk-in, or `undefined` if cancelled.
 */
export function pickCustomer() {
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (!settled) { settled = true; resolve(v); } };

    const m = openModal({
      title: 'Choose customer',
      body: `
        <div class="search-wrap mb">
          <input type="search" id="pick-search" placeholder="Search name or phone…" autocomplete="off">
        </div>
        <button class="btn btn--ghost btn--block mb" data-walkin>👤 Walk-in customer</button>
        <div class="list" id="pick-list"></div>`,
      footer: `<button class="btn btn--ghost" data-close>Cancel</button>
               <button class="btn" data-new>+ New customer</button>`,
      onClose: () => done(undefined)
    });

    const render = (term = '') => {
      const list = customerList().filter(c => matches(c, term));
      m.root.querySelector('#pick-list').innerHTML = list.length
        ? list.map(c => `
            <button class="list__row" data-pick="${esc(c.id)}">
              <div class="list__main">
                <div class="list__title">${esc(c.name)}</div>
                <div class="list__sub">${esc(c.phone || 'no phone')}</div>
              </div>
            </button>`).join('')
        : '<div class="empty">No customer found</div>';
    };
    render();

    m.root.querySelector('#pick-search').addEventListener('input', debounce(e => render(e.target.value), 120));
    m.root.querySelector('[data-walkin]').onclick = () => { done(null); m.close(); };
    m.root.querySelector('[data-new]').onclick = async () => {
      const created = await editCustomer(null, { silent: true });
      if (created) { done(created); m.close(); }
    };
    m.root.querySelector('#pick-list').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      done(customerById(b.dataset.pick));
      m.close();
    });
  });
}

/* ------------------------------------------------------------- editing */

export function editCustomer(id, { silent = false } = {}) {
  return new Promise(resolve => {
    const c = id ? customerById(id) : null;
    const m = openModal({
      title: c ? 'Edit customer' : 'New customer',
      size: 'narrow',
      body: `
        <label class="field"><span>Name *</span>
          <input type="text" id="c-name" value="${esc(c?.name || '')}" placeholder="Customer name"></label>
        <label class="field"><span>Phone</span>
          <input type="tel" id="c-phone" inputmode="tel" value="${esc(c?.phone || '')}" placeholder="07X XXX XXXX"></label>
        <label class="field"><span>Email</span>
          <input type="email" id="c-email" inputmode="email" value="${esc(c?.email || '')}"></label>
        <label class="field"><span>Address</span>
          <input type="text" id="c-address" value="${esc(c?.address || '')}"></label>
        <label class="field"><span>Note</span>
          <textarea id="c-note" placeholder="Preferred brand, instrument owned, etc.">${esc(c?.note || '')}</textarea></label>`,
      footer: `
        ${c ? '<button class="btn btn--ghost btn--danger" data-del>Delete</button>' : ''}
        <button class="btn" data-save>Save</button>`,
      onClose: () => resolve(null)
    });

    m.root.querySelector('[data-save]').onclick = () => {
      const name = m.root.querySelector('#c-name').value.trim();
      if (!name) return toast('Customer name is required', 'error');
      const payload = {
        name,
        phone: m.root.querySelector('#c-phone').value.trim(),
        email: m.root.querySelector('#c-email').value.trim(),
        address: m.root.querySelector('#c-address').value.trim(),
        note: m.root.querySelector('#c-note').value.trim(),
        updatedAt: Date.now()
      };
      let record;
      if (c) {
        record = { ...c, ...payload };
        dbSet(`customers/${c.id}`, record);
      } else {
        const newId = uid('cus');
        record = { ...payload, id: newId, createdAt: Date.now() };
        dbSet(`customers/${newId}`, record);
        state.customers[newId] = record; // optimistic so the picker sees it offline
      }
      if (!silent) toast('Customer saved', 'success');
      resolve(record);
      m.close();
    };

    const del = m.root.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (await confirmDialog(`Delete ${c.name}? Their past sales stay in the records.`)) {
        dbDelete(`customers/${c.id}`);
        toast('Customer deleted', 'info');
        resolve(null);
        m.close();
      }
    };
  });
}

/* -------------------------------------------------------------- detail */

export function showCustomer(id) {
  const c = customerById(id);
  if (!c) return;
  const stats = customerStats(id);
  const history = state.sales
    .filter(s => s.customerId === id)
    .sort((a, b) => num(b.timestamp) - num(a.timestamp))
    .slice(0, 30);

  const m = openModal({
    title: c.name,
    body: `
      <div class="stats">
        <div class="stat stat--amber"><b>${money(stats.spent)}</b><span>Total spent</span></div>
        <div class="stat"><b>${stats.count}</b><span>Purchases</span></div>
        <div class="stat ${stats.due > 0 ? 'stat--red' : ''}"><b>${money(stats.due)}</b><span>Outstanding</span></div>
        <div class="stat"><b>${stats.last ? fmtDate(stats.last) : '—'}</b><span>Last visit</span></div>
      </div>
      <div class="card">
        <div class="small">${c.phone ? `📞 ${esc(c.phone)}<br>` : ''}
        ${c.email ? `✉️ ${esc(c.email)}<br>` : ''}
        ${c.address ? `📍 ${esc(c.address)}<br>` : ''}
        ${c.note ? `<span class="muted">${esc(c.note)}</span>` : ''}</div>
      </div>
      <h4 class="mb">Purchase history</h4>
      <div class="list">
        ${history.length ? history.map(s => `
          <div class="list__row" style="cursor:default">
            <div class="list__main">
              <div class="list__title">${esc(s.invoiceNo || '—')}</div>
              <div class="list__sub">${fmtDate(s.timestamp)} · ${esc(s.itemsText || '')}</div>
            </div>
            <div class="list__side">
              <div class="strong">${money(s.total)}</div>
              ${num(s.due) > 0 ? `<span class="badge badge--danger">Due ${money(s.due)}</span>` : ''}
            </div>
          </div>`).join('') : '<div class="empty">No purchases yet</div>'}
      </div>`,
    footer: `
      ${c.phone ? `<a class="btn btn--ghost" href="tel:${esc(c.phone)}">Call</a>` : ''}
      <button class="btn" data-edit>Edit</button>`
  });
  m.root.querySelector('[data-edit]').onclick = () => { m.close(); editCustomer(id); };
}

/* --------------------------------------------------------------- mount */

function render() {
  const box = $('#cust-list');
  if (!box) return;
  const list = customerList().filter(c => matches(c, search));
  box.innerHTML = list.length
    ? list.map(c => {
        const s = customerStats(c.id);
        return `
        <button class="list__row" data-cust="${esc(c.id)}">
          <div class="list__main">
            <div class="list__title">${esc(c.name)}</div>
            <div class="list__sub">${esc(c.phone || 'no phone')} · ${s.count} purchase${s.count === 1 ? '' : 's'}</div>
          </div>
          <div class="list__side">
            <div class="strong">${money(s.spent)}</div>
            ${s.due > 0 ? `<span class="badge badge--danger">Due</span>` : ''}
          </div>
        </button>`;
      }).join('')
    : '<div class="empty"><span class="ico">👥</span>No customers yet</div>';
}

export function mountCustomers() {
  $('#cust-add').onclick = () => editCustomer(null);
  $('#cust-search').addEventListener('input', debounce(e => { search = e.target.value; render(); }, 150));
  $('#cust-list').addEventListener('click', e => {
    const b = e.target.closest('[data-cust]');
    if (b) showCustomer(b.dataset.cust);
  });
  on('customers', render);
  on('sales', render);
  render();
}
