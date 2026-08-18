// Inventory: items, stock movements, low-stock view, CSV in/out.
import {
  state, on, dbSet, dbDelete, dbPush, stockDelta,
  inventoryList, itemById, categoryNames, lowStockItems, isManager
} from './store.js';
import {
  $, esc, money, num, int, uid, toast, openModal, confirmDialog,
  debounce, toCSV, downloadCSV, parseCSV, readFileText, fmtDateTime
} from './util.js';

let search = '';
let filter = 'all';

const threshold = item =>
  item.reorderLevel === undefined || item.reorderLevel === '' || item.reorderLevel === null
    ? int(state.settings.lowStockThreshold, 3)
    : int(item.reorderLevel, 3);

export const isLow = item => item.trackStock !== false && int(item.stock, 0) <= threshold(item);

function visibleItems() {
  const term = search.trim().toLowerCase();
  return inventoryList().filter(i => {
    if (filter === 'low' && !isLow(i)) return false;
    if (filter === 'out' && int(i.stock, 0) > 0) return false;
    if (!term) return true;
    return String(i.name).toLowerCase().includes(term)
      || String(i.sku || '').toLowerCase().includes(term)
      || String(i.brand || '').toLowerCase().includes(term)
      || String(i.category || '').toLowerCase().includes(term);
  });
}

/* --------------------------------------------------------------- render */

function renderStats() {
  const box = $('#inv-stats');
  if (!box) return;
  const items = inventoryList();
  const stockValue = items.reduce((s, i) => s + num(i.buyPrice) * int(i.stock, 0), 0);
  const retailValue = items.reduce((s, i) => s + num(i.price) * int(i.stock, 0), 0);
  const low = lowStockItems().length;
  const out = items.filter(i => i.trackStock !== false && int(i.stock, 0) <= 0).length;

  box.innerHTML = `
    <div class="stat"><b>${items.length}</b><span>Items</span></div>
    <div class="stat stat--amber"><b>${money(stockValue, 0)}</b><span>Stock cost value</span></div>
    <div class="stat stat--green"><b>${money(retailValue, 0)}</b><span>Retail value</span></div>
    <div class="stat ${low ? 'stat--red' : ''}"><b>${low}</b><span>Low / ${out} out</span></div>`;
}

function render() {
  const box = $('#inv-list');
  if (!box) return;
  const items = visibleItems();

  box.innerHTML = items.length
    ? items.map(i => {
        const stock = int(i.stock, 0);
        const tracked = i.trackStock !== false;
        const badge = !tracked
          ? '<span class="badge badge--mute">Not tracked</span>'
          : stock <= 0
            ? '<span class="badge badge--danger">Out of stock</span>'
            : isLow(i)
              ? `<span class="badge badge--warn">Low · ${stock}</span>`
              : `<span class="badge badge--ok">${stock} in stock</span>`;
        const margin = num(i.price) - num(i.buyPrice);
        return `
        <button class="list__row" data-item="${esc(i.id)}">
          <div class="list__main">
            <div class="list__title">${esc(i.name)}</div>
            <div class="list__sub">${esc(i.sku || '')}${i.sku ? ' · ' : ''}${esc(i.category || 'Uncategorised')}${i.brand ? ' · ' + esc(i.brand) : ''}</div>
            <div class="tiny muted">Buy ${money(i.buyPrice)} → Sell ${money(i.price)} · margin ${money(margin)}</div>
          </div>
          <div class="list__side">${badge}</div>
        </button>`;
      }).join('')
    : `<div class="empty"><span class="ico">📦</span>
        ${search || filter !== 'all' ? 'Nothing matches this filter.' : 'No stock yet — add your first item.'}</div>`;

  renderStats();
}

/* -------------------------------------------------------------- editing */

export function editItem(id) {
  const it = id ? itemById(id) : null;
  const cats = categoryNames();

  const m = openModal({
    title: it ? 'Edit item' : 'New item',
    body: `
      <label class="field"><span>Item name *</span>
        <input type="text" id="i-name" value="${esc(it?.name || '')}" placeholder="e.g. Yamaha F310 Acoustic"></label>

      <div class="field-row">
        <label class="field"><span>SKU / barcode</span>
          <input type="text" id="i-sku" value="${esc(it?.sku || '')}" placeholder="scan or type"></label>
        <label class="field"><span>Brand</span>
          <input type="text" id="i-brand" value="${esc(it?.brand || '')}"></label>
      </div>

      <label class="field"><span>Category</span>
        <select id="i-category">
          ${cats.map(c => `<option ${it?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          ${it?.category && !cats.includes(it.category) ? `<option selected>${esc(it.category)}</option>` : ''}
        </select></label>

      <div class="field-row">
        <label class="field"><span>Buying price (cost)</span>
          <input type="number" id="i-buy" step="any" inputmode="decimal" value="${esc(it?.buyPrice ?? '')}"></label>
        <label class="field"><span>Selling price *</span>
          <input type="number" id="i-price" step="any" inputmode="decimal" value="${esc(it?.price ?? '')}"></label>
      </div>

      <div class="field-row">
        <label class="field"><span>${it ? 'Current stock' : 'Opening stock'}</span>
          <input type="number" id="i-stock" inputmode="numeric" value="${esc(it?.stock ?? 0)}" ${it ? 'disabled' : ''}></label>
        <label class="field"><span>Low stock alert at</span>
          <input type="number" id="i-reorder" inputmode="numeric" value="${esc(it?.reorderLevel ?? '')}"
                 placeholder="${int(state.settings.lowStockThreshold, 3)}"></label>
      </div>
      ${it ? '<p class="hint">Use “Adjust stock” to change quantity — that keeps an audit trail.</p>' : ''}

      <label class="field-check">
        <input type="checkbox" id="i-track" ${it?.trackStock === false ? '' : 'checked'}>
        <span>Track stock quantity for this item</span></label>
      <label class="field-check">
        <input type="checkbox" id="i-active" ${it?.active === false ? '' : 'checked'}>
        <span>Show in the register</span></label>

      <label class="field"><span>Note</span>
        <input type="text" id="i-note" value="${esc(it?.note || '')}" placeholder="Serial no, condition, supplier…"></label>`,
    footer: `
      ${it ? '<button class="btn btn--ghost" data-adjust>Adjust stock</button>' : ''}
      ${it && isManager() ? '<button class="btn btn--danger" data-del>Delete</button>' : ''}
      <button class="btn" data-save>Save</button>`
  });

  m.root.querySelector('[data-save]').onclick = () => {
    const name = m.root.querySelector('#i-name').value.trim();
    const price = num(m.root.querySelector('#i-price').value, NaN);
    if (!name) return toast('Item name is required', 'error');
    if (!Number.isFinite(price)) return toast('Selling price is required', 'error');

    const reorderRaw = m.root.querySelector('#i-reorder').value.trim();
    const itemId = it ? it.id : uid('item');
    const record = {
      id: itemId,
      name,
      sku: m.root.querySelector('#i-sku').value.trim(),
      brand: m.root.querySelector('#i-brand').value.trim(),
      category: m.root.querySelector('#i-category').value,
      buyPrice: num(m.root.querySelector('#i-buy').value, 0),
      price,
      stock: it ? int(it.stock, 0) : int(m.root.querySelector('#i-stock').value, 0),
      reorderLevel: reorderRaw === '' ? null : int(reorderRaw, 0),
      trackStock: m.root.querySelector('#i-track').checked,
      active: m.root.querySelector('#i-active').checked,
      note: m.root.querySelector('#i-note').value.trim(),
      updatedAt: Date.now(),
      createdAt: it?.createdAt || Date.now()
    };

    dbSet(`inventory/${itemId}`, record);
    state.inventory[itemId] = record; // optimistic for offline
    if (!it && record.stock) {
      logMove(itemId, record.stock, 'opening', 'Opening stock');
    }
    toast('Item saved', 'success');
    m.close();
    render();
  };

  const adjBtn = m.root.querySelector('[data-adjust]');
  if (adjBtn) adjBtn.onclick = () => { m.close(); adjustStock(it.id); };

  const delBtn = m.root.querySelector('[data-del]');
  if (delBtn) delBtn.onclick = async () => {
    if (await confirmDialog(`Delete "${it.name}"? Past sales keep their record.`)) {
      dbDelete(`inventory/${it.id}`);
      delete state.inventory[it.id];
      toast('Item deleted', 'info');
      m.close();
      render();
    }
  };
}

function logMove(itemId, delta, type, note) {
  dbPush('stockmoves', {
    itemId,
    itemName: itemById(itemId)?.name || '',
    delta,
    type,
    note: note || '',
    timestamp: Date.now(),
    byUid: state.user?.uid || '',
    byName: state.profile?.name || ''
  });
}

export function adjustStock(id) {
  const it = itemById(id);
  if (!it) return;

  const m = openModal({
    title: `Adjust stock · ${it.name}`,
    size: 'narrow',
    body: `
      <p class="mb small">Current stock: <b>${int(it.stock, 0)}</b></p>
      <div class="segmented mb" id="adj-mode">
        <button data-mode="add" class="is-active">Add stock</button>
        <button data-mode="remove">Remove</button>
        <button data-mode="set">Set exact</button>
      </div>
      <label class="field"><span>Quantity</span>
        <input type="number" id="adj-qty" inputmode="numeric" value="1"></label>
      <label class="field" id="adj-cost-field"><span>Unit cost (updates buying price)</span>
        <input type="number" id="adj-cost" step="any" inputmode="decimal" value="${esc(it.buyPrice ?? '')}"></label>
      <label class="field"><span>Reason</span>
        <select id="adj-reason">
          <option value="purchase">Purchase / restock</option>
          <option value="return">Customer return</option>
          <option value="damage">Damaged / written off</option>
          <option value="correction">Stock count correction</option>
          <option value="other">Other</option>
        </select></label>
      <label class="field"><span>Note</span>
        <input type="text" id="adj-note" placeholder="Supplier, invoice no…"></label>`,
    footer: `<button class="btn btn--ghost" data-close>Cancel</button>
             <button class="btn" data-ok>Apply</button>`
  });

  let mode = 'add';
  m.root.querySelector('#adj-mode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    mode = b.dataset.mode;
    m.root.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('is-active', x === b));
    m.root.querySelector('#adj-cost-field').hidden = mode !== 'add';
  });

  m.root.querySelector('[data-ok]').onclick = () => {
    const qty = int(m.root.querySelector('#adj-qty').value, 0);
    if (qty <= 0 && mode !== 'set') return toast('Enter a quantity', 'error');

    const current = int(it.stock, 0);
    const delta = mode === 'add' ? qty : mode === 'remove' ? -qty : int(m.root.querySelector('#adj-qty').value, 0) - current;
    if (delta === 0) { m.close(); return; }

    stockDelta(it.id, delta);
    state.inventory[it.id] = { ...it, stock: current + delta };

    if (mode === 'add') {
      const cost = num(m.root.querySelector('#adj-cost').value, NaN);
      if (Number.isFinite(cost) && cost !== num(it.buyPrice)) {
        dbSet(`inventory/${it.id}/buyPrice`, cost);
        state.inventory[it.id].buyPrice = cost;
      }
    }

    logMove(it.id, delta, m.root.querySelector('#adj-reason').value, m.root.querySelector('#adj-note').value.trim());
    toast(`Stock ${delta > 0 ? '+' : ''}${delta} → ${current + delta}`, 'success');
    m.close();
    render();
  };
}

/* ------------------------------------------------------------------ CSV */

const CSV_HEADERS = [
  { label: 'name', get: i => i.name },
  { label: 'sku', get: i => i.sku || '' },
  { label: 'brand', get: i => i.brand || '' },
  { label: 'category', get: i => i.category || '' },
  { label: 'buyPrice', get: i => num(i.buyPrice) },
  { label: 'price', get: i => num(i.price) },
  { label: 'stock', get: i => int(i.stock, 0) },
  { label: 'reorderLevel', get: i => i.reorderLevel ?? '' },
  { label: 'note', get: i => i.note || '' }
];

function exportInventory() {
  const csv = toCSV(inventoryList(), CSV_HEADERS);
  downloadCSV(`mrguitar-inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  toast('Inventory exported', 'success');
}

function importInventory() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let rows;
    try {
      rows = parseCSV(await readFileText(file));
    } catch {
      return toast('Could not read that file', 'error');
    }
    if (rows.length < 2) return toast('CSV looks empty', 'error');

    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = key => head.indexOf(key.toLowerCase());
    const iName = col('name');
    if (iName < 0) return toast('CSV needs a "name" column', 'error');

    const bySku = new Map(inventoryList().filter(i => i.sku).map(i => [String(i.sku).toLowerCase(), i]));
    const byName = new Map(inventoryList().map(i => [String(i.name).toLowerCase(), i]));

    let created = 0, updated = 0;
    rows.slice(1).forEach(r => {
      const cell = key => { const c = col(key); return c >= 0 ? String(r[c] ?? '').trim() : ''; };
      const name = String(r[iName] ?? '').trim();
      if (!name) return;

      const sku = cell('sku');
      const existing = (sku && bySku.get(sku.toLowerCase())) || byName.get(name.toLowerCase());
      const id = existing ? existing.id : uid('item');
      const record = {
        id,
        name,
        sku,
        brand: cell('brand'),
        category: cell('category') || existing?.category || 'Accessories',
        buyPrice: num(cell('buyprice'), existing ? num(existing.buyPrice) : 0),
        price: num(cell('price'), existing ? num(existing.price) : 0),
        stock: cell('stock') === '' ? int(existing?.stock, 0) : int(cell('stock'), 0),
        reorderLevel: cell('reorderlevel') === '' ? (existing?.reorderLevel ?? null) : int(cell('reorderlevel'), 0),
        trackStock: existing?.trackStock !== false,
        active: existing?.active !== false,
        note: cell('note') || existing?.note || '',
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now()
      };
      dbSet(`inventory/${id}`, record);
      state.inventory[id] = record;
      existing ? updated++ : created++;
    });

    toast(`Imported: ${created} new, ${updated} updated`, 'success', 4000);
    render();
  };
  input.click();
}

/* ------------------------------------------------------------ low stock */

export function showLowStock() {
  const items = lowStockItems();
  openModal({
    title: `Low stock (${items.length})`,
    body: items.length
      ? `<div class="list">${items.map(i => `
          <div class="list__row" style="cursor:default">
            <div class="list__main">
              <div class="list__title">${esc(i.name)}</div>
              <div class="list__sub">${esc(i.category || '')} · alert at ${threshold(i)}</div>
            </div>
            <div class="list__side">
              <span class="badge ${int(i.stock, 0) <= 0 ? 'badge--danger' : 'badge--warn'}">${int(i.stock, 0)} left</span>
            </div>
          </div>`).join('')}</div>`
      : '<div class="empty"><span class="ico">✅</span>Everything is well stocked</div>'
  });
}

/* --------------------------------------------------------------- mount */

export function mountInventory() {
  $('#inv-add').onclick = () => editItem(null);
  $('#inv-export').onclick = exportInventory;
  $('#inv-import').onclick = importInventory;

  $('#inv-search').addEventListener('input', debounce(e => { search = e.target.value; render(); }, 150));

  $('#inv-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    filter = b.dataset.filter;
    $('#inv-filters').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    render();
  });

  $('#inv-list').addEventListener('click', e => {
    const b = e.target.closest('[data-item]');
    if (b) editItem(b.dataset.item);
  });

  on('inventory', render);
  on('settings', render);
  render();
}
