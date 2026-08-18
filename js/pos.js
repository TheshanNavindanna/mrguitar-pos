// The register: item picking, cart maths, payment and checkout.
import {
  state, on, emit, dbPush, dbSet, dbDelete, stockDelta, nextInvoiceNo,
  inventoryList, itemById, categoryNames
} from './store.js';
import {
  $, $$, esc, money, num, int, r2, uid, toast, openModal, confirmDialog,
  promptDialog, debounce, fmtDateTime
} from './util.js';
import { showReceipt, printReceipt } from './receipt.js';
import { pickCustomer } from './customers.js';

/* ------------------------------------------------------------ cart state */

export const cart = {
  lines: [],              // {key,itemId,sku,name,qty,unitPrice,buyPrice,discount,trackStock}
  customerId: null,
  customerName: '',
  discountType: 'amount', // 'amount' | 'percent'
  discountValue: 0,
  note: ''
};

let activeCategory = 'all';
let searchTerm = '';

const CART_KEY = 'mrguitar.cart.v1';

function persistCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
}

function restoreCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (saved && Array.isArray(saved.lines)) Object.assign(cart, saved);
  } catch { /* ignore */ }
}

function resetCart() {
  cart.lines = [];
  cart.customerId = null;
  cart.customerName = '';
  cart.discountType = 'amount';
  cart.discountValue = 0;
  cart.note = '';
  persistCart();
  renderCart();
}

/* --------------------------------------------------------------- totals */

export function cartTotals() {
  const subtotal = r2(cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0));
  const itemDiscount = r2(cart.lines.reduce((sum, l) => sum + num(l.discount), 0));
  const afterLines = r2(subtotal - itemDiscount);

  let discount = cart.discountType === 'percent'
    ? r2(afterLines * num(cart.discountValue) / 100)
    : r2(num(cart.discountValue));
  discount = Math.min(Math.max(discount, 0), afterLines);

  const taxable = r2(afterLines - discount);
  const taxPercent = num(state.settings.taxPercent, 0);
  const tax = r2(taxable * taxPercent / 100);
  const total = r2(taxable + tax);
  const cost = r2(cart.lines.reduce((sum, l) => sum + l.qty * num(l.buyPrice), 0));

  return { subtotal, itemDiscount, discount, taxable, taxPercent, tax, total, cost, profit: r2(taxable - cost) };
}

const cartQty = () => cart.lines.reduce((n, l) => n + l.qty, 0);

/* ------------------------------------------------------------ item grid */

function availableStock(item) {
  const inCart = cart.lines
    .filter(l => l.itemId === item.id)
    .reduce((n, l) => n + l.qty, 0);
  return int(item.stock, 0) - inCart;
}

export function renderItems() {
  const box = $('#pos-items');
  if (!box) return;

  const term = searchTerm.trim().toLowerCase();
  const items = inventoryList().filter(i => {
    if (i.active === false) return false;
    if (activeCategory !== 'all' && i.category !== activeCategory) return false;
    if (!term) return true;
    return String(i.name).toLowerCase().includes(term)
      || String(i.sku || '').toLowerCase().includes(term)
      || String(i.brand || '').toLowerCase().includes(term);
  });

  if (!items.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <span class="ico">🔍</span>
      ${term ? 'No item matches that search.' : 'No items yet — add stock first.'}
      <div class="mt"><button class="btn btn--sm" data-quick-item>Add a quick / custom item</button></div>
    </div>`;
    return;
  }

  box.innerHTML = items.map(i => {
    const stock = int(i.stock, 0);
    const tracked = i.trackStock !== false;
    const low = tracked && stock <= int(i.reorderLevel ?? state.settings.lowStockThreshold, 3);
    return `
      <button class="pos-tile ${low ? 'is-low' : ''}" data-add="${esc(i.id)}" ${tracked && stock <= 0 ? 'disabled' : ''}>
        <h4>${esc(i.name)}</h4>
        <div class="price">${money(i.price)}</div>
        <div class="meta">
          <span>${esc(i.sku || i.category || '')}</span>
          <span>${tracked ? (stock <= 0 ? 'Out' : stock + ' left') : '∞'}</span>
        </div>
      </button>`;
  }).join('');
}

function renderCategories() {
  const box = $('#pos-categories');
  if (!box) return;
  const cats = categoryNames();
  box.innerHTML = [
    `<button class="chip ${activeCategory === 'all' ? 'is-active' : ''}" data-cat="all">All</button>`,
    ...cats.map(c => `<button class="chip ${activeCategory === c ? 'is-active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
  ].join('');
}

/* ---------------------------------------------------------- cart adding */

export function addToCart(itemId, qty = 1) {
  const item = itemById(itemId);
  if (!item) return toast('Item not found', 'error');

  const tracked = item.trackStock !== false;
  if (tracked && availableStock(item) < qty) {
    return toast(`Only ${availableStock(item)} left in stock`, 'warn');
  }

  const existing = cart.lines.find(l => l.itemId === itemId && !l.priceOverridden);
  if (existing) existing.qty += qty;
  else {
    cart.lines.push({
      key: uid('ln'),
      itemId: item.id,
      sku: item.sku || '',
      name: item.name,
      qty,
      unitPrice: num(item.price),
      buyPrice: num(item.buyPrice),
      discount: 0,
      trackStock: tracked
    });
  }
  persistCart();
  renderCart();
  renderItems();
}

/** Non-inventory line: repair labour, a one-off accessory, a delivery charge. */
export function addCustomLine({ name, price, qty = 1, cost = 0 }) {
  cart.lines.push({
    key: uid('ln'),
    itemId: null,
    sku: '',
    name,
    qty,
    unitPrice: num(price),
    buyPrice: num(cost),
    discount: 0,
    trackStock: false,
    custom: true
  });
  persistCart();
  renderCart();
}

function setQty(key, qty) {
  const line = cart.lines.find(l => l.key === key);
  if (!line) return;
  const q = Math.max(0, int(qty, 0));
  if (q === 0) {
    cart.lines = cart.lines.filter(l => l.key !== key);
  } else {
    if (line.trackStock && line.itemId) {
      const item = itemById(line.itemId);
      const otherInCart = cart.lines
        .filter(l => l.itemId === line.itemId && l.key !== key)
        .reduce((n, l) => n + l.qty, 0);
      const max = int(item?.stock, 0) - otherInCart;
      if (q > max) {
        toast(`Only ${max} in stock`, 'warn');
        line.qty = Math.max(1, max);
        persistCart();
        renderCart();
        return;
      }
    }
    line.qty = q;
  }
  persistCart();
  renderCart();
  renderItems();
}

/* --------------------------------------------------------- cart render */

export function renderCart() {
  const box = $('#cart-lines');
  if (!box) return;

  if (!cart.lines.length) {
    box.innerHTML = `<div class="empty"><span class="ico">🛒</span>Cart is empty<br>
      <span class="tiny">Tap an item to add it</span></div>`;
  } else {
    box.innerHTML = cart.lines.map(l => `
      <div class="cart-line" data-line="${esc(l.key)}">
        <div class="cart-line__main">
          <div class="cart-line__name">${esc(l.name)}</div>
          <div class="cart-line__meta">
            ${money(l.unitPrice)} each
            ${l.discount > 0 ? `· <span class="text-red">-${money(l.discount)}</span>` : ''}
          </div>
          <div class="row mt">
            <div class="stepper">
              <button data-dec aria-label="Decrease">−</button>
              <input type="number" value="${l.qty}" min="0" inputmode="numeric" data-qty aria-label="Quantity">
              <button data-inc aria-label="Increase">+</button>
            </div>
            <button class="btn btn--ghost btn--sm" data-price>Price</button>
            <button class="btn btn--ghost btn--sm" data-linedisc>−%</button>
          </div>
        </div>
        <div class="cart-line__side">
          <div class="cart-line__total">${money(l.qty * l.unitPrice - num(l.discount))}</div>
          <button class="icon-btn text-red" data-remove aria-label="Remove" style="min-height:32px;min-width:32px">✕</button>
        </div>
      </div>`).join('');
  }

  const t = cartTotals();
  const cur = state.settings.currency || 'LKR';
  $('#cart-totals').innerHTML = `
    <div class="totals__row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    ${t.itemDiscount > 0 ? `<div class="totals__row text-red"><span>Item discounts</span><span>-${money(t.itemDiscount)}</span></div>` : ''}
    ${t.discount > 0 ? `<div class="totals__row text-red"><span>Discount${cart.discountType === 'percent' ? ` (${num(cart.discountValue)}%)` : ''}</span><span>-${money(t.discount)}</span></div>` : ''}
    ${t.tax > 0 ? `<div class="totals__row"><span>Tax (${t.taxPercent}%)</span><span>${money(t.tax)}</span></div>` : ''}
    <div class="totals__row totals__row--grand"><span>${esc(cur)}</span><span>${money(t.total)}</span></div>`;

  $('#cart-count').textContent = `${cartQty()} item${cartQty() === 1 ? '' : 's'}`;
  $('#cart-customer').textContent = cart.customerName ? `👤 ${cart.customerName}` : '👤 Walk-in customer';
  $('#cart-charge').disabled = !cart.lines.length;

  // Mobile sticky bar
  const bar = $('#cart-bar');
  const onPos = $('#sec-pos').classList.contains('is-active');
  bar.hidden = !(onPos && cart.lines.length);
  $('#cart-bar-total').textContent = `${cur} ${money(t.total)}`;
  $('#cart-bar-count').textContent = `${cartQty()} item${cartQty() === 1 ? '' : 's'}`;

  $('#held-count').textContent = Object.keys(state.held || {}).length;
  emit('cart', cart);
}

/* ------------------------------------------------------------ discounts */

async function editLinePrice(key) {
  const line = cart.lines.find(l => l.key === key);
  if (!line) return;
  const v = await promptDialog({
    title: 'Change price',
    label: `Selling price for ${line.name}`,
    value: line.unitPrice,
    type: 'number',
    hint: 'Applies to this sale only. Inventory price is unchanged.'
  });
  if (v === null) return;
  const price = num(v, NaN);
  if (!Number.isFinite(price) || price < 0) return toast('Enter a valid price', 'error');
  line.unitPrice = r2(price);
  line.priceOverridden = true;
  persistCart();
  renderCart();
}

async function editLineDiscount(key) {
  const line = cart.lines.find(l => l.key === key);
  if (!line) return;
  const v = await promptDialog({
    title: 'Line discount',
    label: `Discount amount for ${line.name}`,
    value: line.discount || 0,
    type: 'number',
    hint: `Line total before discount: ${money(line.qty * line.unitPrice)}`
  });
  if (v === null) return;
  const d = Math.max(0, Math.min(num(v), line.qty * line.unitPrice));
  line.discount = r2(d);
  persistCart();
  renderCart();
}

function openCartDiscount() {
  const t = cartTotals();
  const m = openModal({
    title: 'Cart discount',
    size: 'narrow',
    body: `
      <div class="segmented mb">
        <button data-type="amount" class="${cart.discountType === 'amount' ? 'is-active' : ''}">Amount</button>
        <button data-type="percent" class="${cart.discountType === 'percent' ? 'is-active' : ''}">Percent</button>
      </div>
      <label class="field">
        <span id="disc-label">${cart.discountType === 'percent' ? 'Discount %' : 'Discount amount'}</span>
        <input type="number" id="disc-value" step="any" inputmode="decimal" value="${num(cart.discountValue) || ''}">
      </label>
      <div class="chips mb">
        ${[5, 10, 15, 20].map(p => `<button class="chip" data-pct="${p}">${p}%</button>`).join('')}
      </div>
      <p class="hint">Cart total before discount: ${money(t.subtotal - t.itemDiscount)}</p>`,
    footer: `
      <button class="btn btn--ghost" data-clear>Remove</button>
      <button class="btn" data-apply>Apply</button>`
  });

  let type = cart.discountType;
  m.root.querySelectorAll('[data-type]').forEach(b => {
    b.onclick = () => {
      type = b.dataset.type;
      m.root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('is-active', x === b));
      m.root.querySelector('#disc-label').textContent = type === 'percent' ? 'Discount %' : 'Discount amount';
    };
  });
  m.root.querySelectorAll('[data-pct]').forEach(b => {
    b.onclick = () => {
      type = 'percent';
      m.root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('is-active', x.dataset.type === 'percent'));
      m.root.querySelector('#disc-value').value = b.dataset.pct;
      m.root.querySelector('#disc-label').textContent = 'Discount %';
    };
  });
  m.root.querySelector('[data-clear]').onclick = () => {
    cart.discountValue = 0;
    persistCart(); renderCart(); m.close();
  };
  m.root.querySelector('[data-apply]').onclick = () => {
    cart.discountType = type;
    cart.discountValue = Math.max(0, num(m.root.querySelector('#disc-value').value));
    persistCart(); renderCart(); m.close();
  };
}

/* ----------------------------------------------------------- hold/park */

async function holdCart() {
  if (!cart.lines.length) return toast('Cart is empty', 'warn');
  const label = await promptDialog({
    title: 'Park this sale',
    label: 'Reference (customer name or note)',
    value: cart.customerName || '',
    okText: 'Park'
  });
  if (label === null) return;
  dbPush('held', {
    label: label || 'Parked sale',
    timestamp: Date.now(),
    cart: JSON.parse(JSON.stringify(cart)),
    byUid: state.user?.uid || '',
    byName: state.profile?.name || ''
  });
  resetCart();
  toast('Sale parked', 'success');
}

function openHeldList() {
  const held = Object.values(state.held || {}).sort((a, b) => num(b.timestamp) - num(a.timestamp));
  const body = held.length
    ? `<div class="list">${held.map(h => `
        <div class="list__row" data-resume="${esc(h.id)}">
          <div class="list__main">
            <div class="list__title">${esc(h.label)}</div>
            <div class="list__sub">${fmtDateTime(h.timestamp)} · ${(h.cart?.lines || []).length} lines${h.byName ? ' · ' + esc(h.byName) : ''}</div>
          </div>
          <div class="list__side">
            <button class="btn btn--sm" data-resume-btn="${esc(h.id)}">Resume</button>
            <button class="icon-btn text-red" data-drop="${esc(h.id)}" style="min-height:32px;min-width:32px">✕</button>
          </div>
        </div>`).join('')}</div>`
    : '<div class="empty"><span class="ico">🅿️</span>No parked sales</div>';

  const m = openModal({ title: 'Parked sales', body });

  m.root.addEventListener('click', async e => {
    const drop = e.target.closest('[data-drop]');
    if (drop) {
      e.stopPropagation();
      if (await confirmDialog('Discard this parked sale?')) {
        dbDelete(`held/${drop.dataset.drop}`);
        m.close();
      }
      return;
    }
    const row = e.target.closest('[data-resume], [data-resume-btn]');
    if (!row) return;
    const id = row.dataset.resume || row.dataset.resumeBtn;
    const h = state.held[id];
    if (!h) return;
    if (cart.lines.length && !(await confirmDialog('Replace the current cart with the parked sale?', { okText: 'Replace', danger: false }))) return;
    Object.assign(cart, h.cart);
    dbDelete(`held/${id}`);
    persistCart();
    renderCart();
    renderItems();
    m.close();
    toast('Sale resumed', 'success');
  });
}

/* ------------------------------------------------------------- payment */

const METHODS = [
  { id: 'cash', label: 'Cash', ico: '💵' },
  { id: 'card', label: 'Card', ico: '💳' },
  { id: 'bank', label: 'Bank', ico: '🏦' },
  { id: 'credit', label: 'Credit', ico: '📄' }
];

export function openPayment() {
  if (!cart.lines.length) return toast('Cart is empty', 'warn');
  const t = cartTotals();
  const cur = state.settings.currency || 'LKR';

  let method = 'cash';
  let tendered = t.total;
  const splits = [];

  const rounded = n => Math.ceil(n / 100) * 100;
  const quick = [...new Set([t.total, rounded(t.total), rounded(t.total) + 500, rounded(t.total) + 1000, 5000])]
    .filter(v => v >= t.total).slice(0, 4);

  const m = openModal({
    title: `Take payment · ${cur} ${money(t.total)}`,
    size: 'narrow',
    body: `
      <div class="pay-methods" id="pm">
        ${METHODS.map(p => `
          <button class="pay-method ${p.id === 'cash' ? 'is-active' : ''}" data-m="${p.id}">
            <span class="ico">${p.ico}</span><span>${p.label}</span>
          </button>`).join('')}
      </div>

      <div id="pay-cash">
        <div class="cash-quick">
          ${quick.map(v => `<button class="btn btn--ghost btn--sm" data-cash="${v}">${money(v, 0)}</button>`).join('')}
        </div>
        <label class="field">
          <span>Amount received</span>
          <input type="number" id="pay-tendered" step="any" inputmode="decimal" value="${t.total}">
        </label>
      </div>

      <div id="pay-ref-wrap" hidden>
        <label class="field">
          <span id="pay-ref-label">Reference</span>
          <input type="text" id="pay-ref" placeholder="Last 4 digits / slip no">
        </label>
      </div>

      <div class="change-box" id="pay-change">Change: ${money(0)}</div>

      <div id="split-list"></div>
      <button class="btn btn--ghost btn--block btn--sm mb" id="split-add">+ Split payment</button>

      <label class="field">
        <span>Note (optional)</span>
        <input type="text" id="pay-note" placeholder="e.g. delivery on Friday">
      </label>`,
    footer: `
      <button class="btn btn--ghost" data-close>Cancel</button>
      <button class="btn btn--green btn--lg" id="pay-complete">Complete sale</button>`
  });

  const $t = m.root.querySelector('#pay-tendered');
  const $change = m.root.querySelector('#pay-change');
  const $refWrap = m.root.querySelector('#pay-ref-wrap');
  const $cashBlock = m.root.querySelector('#pay-cash');

  const splitTotal = () => splits.reduce((s, p) => s + num(p.amount), 0);

  function refresh() {
    const paidNow = method === 'credit' ? 0 : num($t.value);
    const paid = r2(paidNow + splitTotal());
    const diff = r2(paid - t.total);

    if (method === 'credit') {
      $change.textContent = `Customer owes ${cur} ${money(t.total - splitTotal())}`;
      $change.classList.add('is-short');
    } else if (diff >= 0) {
      $change.textContent = `Change: ${cur} ${money(diff)}`;
      $change.classList.remove('is-short');
    } else {
      $change.textContent = `Short by ${cur} ${money(-diff)}`;
      $change.classList.add('is-short');
    }

    m.root.querySelector('#split-list').innerHTML = splits.length
      ? `<div class="mb">${splits.map((p, i) => `
          <div class="row mb">
            <span class="grow small">${esc(METHODS.find(x => x.id === p.method)?.label || p.method)}</span>
            <span class="strong">${money(p.amount)}</span>
            <button class="icon-btn text-red" data-unsplit="${i}" style="min-height:32px;min-width:32px">✕</button>
          </div>`).join('')}</div>`
      : '';
  }

  m.root.querySelector('#pm').addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    method = b.dataset.m;
    m.root.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('is-active', x === b));
    $cashBlock.hidden = method === 'credit';
    $refWrap.hidden = !(method === 'card' || method === 'bank');
    m.root.querySelector('#pay-ref-label').textContent = method === 'card' ? 'Card reference' : 'Bank slip / reference';
    if (method !== 'cash') $t.value = r2(t.total - splitTotal());
    refresh();
  });

  m.root.addEventListener('click', e => {
    const cashBtn = e.target.closest('[data-cash]');
    if (cashBtn) { $t.value = cashBtn.dataset.cash; refresh(); }
    const un = e.target.closest('[data-unsplit]');
    if (un) { splits.splice(int(un.dataset.unsplit), 1); refresh(); }
  });

  $t.addEventListener('input', refresh);

  m.root.querySelector('#split-add').onclick = async () => {
    const amount = await promptDialog({
      title: 'Split payment',
      label: `Amount paid by ${METHODS.find(x => x.id === method)?.label}`,
      value: r2(t.total - splitTotal()),
      type: 'number'
    });
    if (amount === null) return;
    const amt = num(amount);
    if (amt <= 0) return;
    splits.push({ method, amount: r2(amt), ref: m.root.querySelector('#pay-ref').value.trim() });
    $t.value = r2(Math.max(0, t.total - splitTotal()));
    refresh();
  };

  m.root.querySelector('#pay-complete').onclick = async () => {
    const btn = m.root.querySelector('#pay-complete');
    const payments = [...splits];
    const ref = m.root.querySelector('#pay-ref').value.trim();

    if (method === 'credit') {
      const owing = r2(t.total - splitTotal());
      if (owing > 0) payments.push({ method: 'credit', amount: owing, ref: '' });
      if (!cart.customerId) {
        return toast('Pick a customer before selling on credit', 'warn');
      }
    } else {
      const tenderedNow = num($t.value);
      const stillDue = r2(t.total - splitTotal());
      if (tenderedNow < stillDue - 0.009) return toast('Amount received is less than the total', 'error');
      payments.push({ method, amount: stillDue, ref });
      tendered = tenderedNow;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const sale = await completeSale({
        payments,
        change: method === 'credit' ? 0 : r2(num($t.value) - r2(t.total - splitTotal())),
        note: m.root.querySelector('#pay-note').value.trim()
      });
      m.close();
      showReceipt(sale);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Complete sale';
      toast('Could not save the sale: ' + (err?.message || 'unknown error'), 'error');
    }
  };

  refresh();
}

/* ------------------------------------------------------------ checkout */

export async function completeSale({ payments, change, note }) {
  const t = cartTotals();
  const invoiceNo = await nextInvoiceNo();
  const now = Date.now();

  const lines = cart.lines.map(l => ({
    itemId: l.itemId || null,
    sku: l.sku || '',
    name: l.name,
    qty: l.qty,
    unitPrice: r2(l.unitPrice),
    buyPrice: r2(l.buyPrice),
    discount: r2(l.discount),
    lineTotal: r2(l.qty * l.unitPrice - num(l.discount)),
    trackStock: l.trackStock !== false
  }));

  const paidNonCredit = r2(payments.filter(p => p.method !== 'credit').reduce((s, p) => s + num(p.amount), 0));
  const due = r2(Math.max(0, t.total - paidNonCredit));

  const sale = dbPush('sales', {
    invoiceNo,
    timestamp: now,
    dateKey: new Date(now).toISOString().slice(0, 10),
    cashierUid: state.user?.uid || '',
    cashierEmail: state.user?.email || '',
    cashierName: state.profile?.name || state.user?.email || '',
    customerId: cart.customerId || null,
    customerName: cart.customerName || '',
    lines,
    itemsText: lines.map(l => `${l.name} (x${l.qty})`).join(', '),
    subtotal: t.subtotal,
    itemDiscount: t.itemDiscount,
    discount: t.discount,
    discountType: cart.discountType,
    discountValue: num(cart.discountValue),
    taxPercent: t.taxPercent,
    tax: t.tax,
    total: t.total,
    cost: t.cost,
    profit: r2(t.taxable - t.cost),
    payments,
    paid: paidNonCredit,
    due,
    change: r2(change || 0),
    status: 'completed',
    note: note || '',
    // kept for compatibility with the original dashboard fields
    revenue: t.total,
    items: lines.map(l => `${l.name} (x${l.qty})`).join(', ')
  });

  // Stock moves are transactions so two tills can't overwrite each other.
  lines.forEach(l => {
    if (l.itemId && l.trackStock) stockDelta(l.itemId, -l.qty);
  });

  if (cart.customerId) {
    dbSet(`customers/${cart.customerId}/lastPurchaseAt`, now);
  }

  resetCart();
  toast(`Sale ${invoiceNo} saved`, 'success');
  return sale;
}

/* --------------------------------------------------------- quick item */

function openQuickItem() {
  const m = openModal({
    title: 'Quick / custom item',
    size: 'narrow',
    body: `
      <label class="field"><span>Description</span>
        <input type="text" id="q-name" placeholder="e.g. Fret polish, string change"></label>
      <div class="field-row">
        <label class="field"><span>Price</span>
          <input type="number" id="q-price" step="any" inputmode="decimal"></label>
        <label class="field"><span>Qty</span>
          <input type="number" id="q-qty" value="1" inputmode="numeric"></label>
      </div>
      <label class="field"><span>Cost to shop (optional)</span>
        <input type="number" id="q-cost" step="any" inputmode="decimal" placeholder="0"></label>
      <p class="hint">Not tracked in inventory — use for labour, one-off items or charges.</p>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn" data-ok>Add to cart</button>`
  });
  m.root.querySelector('[data-ok]').onclick = () => {
    const name = m.root.querySelector('#q-name').value.trim();
    const price = num(m.root.querySelector('#q-price').value, NaN);
    if (!name || !Number.isFinite(price)) return toast('Enter a description and price', 'error');
    addCustomLine({
      name,
      price,
      qty: Math.max(1, int(m.root.querySelector('#q-qty').value, 1)),
      cost: num(m.root.querySelector('#q-cost').value, 0)
    });
    m.close();
  };
}

/* --------------------------------------------------------------- mount */

export function mountPOS() {
  restoreCart();

  const search = $('#pos-search');
  search.addEventListener('input', debounce(e => {
    searchTerm = e.target.value;
    renderItems();
  }, 120));

  // Barcode scanners type fast then press Enter — treat an exact SKU hit as "add".
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const code = search.value.trim();
    if (!code) return;
    const hit = inventoryList().find(i =>
      String(i.sku || '').toLowerCase() === code.toLowerCase() ||
      String(i.barcode || '').toLowerCase() === code.toLowerCase());
    if (hit) {
      addToCart(hit.id);
      search.value = '';
      searchTerm = '';
      renderItems();
    } else {
      const matches = inventoryList().filter(i => String(i.name).toLowerCase().includes(code.toLowerCase()));
      if (matches.length === 1) {
        addToCart(matches[0].id);
        search.value = '';
        searchTerm = '';
        renderItems();
      } else {
        toast('No exact match — pick from the list', 'warn');
      }
    }
  });

  $('#pos-scan').onclick = () => {
    search.focus();
    toast('Scan now — the scanner types into the search box', 'info');
  };

  $('#pos-categories').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    activeCategory = b.dataset.cat;
    renderCategories();
    renderItems();
  });

  $('#pos-items').addEventListener('click', e => {
    if (e.target.closest('[data-quick-item]')) return openQuickItem();
    const b = e.target.closest('[data-add]');
    if (b && !b.disabled) addToCart(b.dataset.add);
  });

  $('#cart-lines').addEventListener('click', e => {
    const row = e.target.closest('[data-line]');
    if (!row) return;
    const key = row.dataset.line;
    const line = cart.lines.find(l => l.key === key);
    if (!line) return;
    if (e.target.closest('[data-inc]')) setQty(key, line.qty + 1);
    else if (e.target.closest('[data-dec]')) setQty(key, line.qty - 1);
    else if (e.target.closest('[data-remove]')) setQty(key, 0);
    else if (e.target.closest('[data-price]')) editLinePrice(key);
    else if (e.target.closest('[data-linedisc]')) editLineDiscount(key);
  });

  $('#cart-lines').addEventListener('change', e => {
    const input = e.target.closest('[data-qty]');
    if (!input) return;
    setQty(e.target.closest('[data-line]').dataset.line, input.value);
  });

  $('#cart-clear').onclick = async () => {
    if (!cart.lines.length) return;
    if (await confirmDialog('Clear the whole cart?')) resetCart();
  };
  $('#cart-hold').onclick = holdCart;
  $('#cart-held').onclick = openHeldList;
  $('#cart-discount').onclick = openCartDiscount;
  $('#cart-charge').onclick = openPayment;
  $('#cart-bar-charge').onclick = openPayment;
  $('#cart-bar-view').onclick = () => {
    document.querySelector('.pos-layout__cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  $('#cart-customer').onclick = async () => {
    const c = await pickCustomer();
    if (c === undefined) return;
    cart.customerId = c ? c.id : null;
    cart.customerName = c ? c.name : '';
    persistCart();
    renderCart();
  };

  on('inventory', () => { renderCategories(); renderItems(); });
  on('categories', renderCategories);
  on('held', renderCart);
  on('settings', renderCart);

  renderCategories();
  renderItems();
  renderCart();
}
