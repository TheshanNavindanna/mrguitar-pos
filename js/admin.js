// Staff accounts, shop settings, categories, backup.
import {
  state, on, dbSet, dbDelete, dbPush, isAdmin, isManager,
  DEFAULT_SETTINGS, pendingCount, flushOutbox
} from './store.js';
import {
  $, esc, num, int, uid, toast, openModal, confirmDialog, promptDialog,
  fmtDate, downloadCSV
} from './util.js';

const ROLES = [
  { id: 'staff', label: 'Staff', hint: 'Sell, add stock, log repairs' },
  { id: 'manager', label: 'Manager', hint: 'Also sees profit, refunds and expenses' },
  { id: 'admin', label: 'Admin', hint: 'Full access including staff accounts' }
];

/* --------------------------------------------------------------- users */

function renderUsers() {
  const box = $('#admin-users');
  if (!box) return;
  if (!isAdmin()) {
    box.innerHTML = '<div class="empty">Only an admin can manage staff accounts.</div>';
    return;
  }

  const users = Object.entries(state.users || {})
    .map(([uidKey, u]) => ({ ...u, uid: uidKey }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
      return String(a.name || a.email).localeCompare(String(b.name || b.email));
    });

  box.innerHTML = users.length
    ? users.map(u => {
        const badge = u.status === 'approved'
          ? '<span class="badge badge--ok">Approved</span>'
          : u.status === 'blocked'
            ? '<span class="badge badge--danger">Blocked</span>'
            : '<span class="badge badge--warn">Pending</span>';
        const isSelf = u.uid === state.user?.uid;
        return `
        <div class="list__row" style="cursor:default; align-items:flex-start">
          <div class="list__main">
            <div class="list__title">${esc(u.name || u.email)} ${isSelf ? '<span class="badge badge--mute">You</span>' : ''}</div>
            <div class="list__sub">${esc(u.email)}</div>
            <div class="tiny muted">${esc(ROLES.find(r => r.id === u.role)?.label || u.role || 'staff')}${u.createdAt ? ' · joined ' + fmtDate(u.createdAt) : ''}</div>
            <div class="row row--wrap mt">
              ${u.status !== 'approved' ? `<button class="btn btn--green btn--sm" data-approve="${esc(u.uid)}">Approve</button>` : ''}
              ${!isSelf ? `<button class="btn btn--ghost btn--sm" data-role="${esc(u.uid)}">Role</button>` : ''}
              ${!isSelf && u.status === 'approved' ? `<button class="btn btn--ghost btn--sm" data-block="${esc(u.uid)}">Block</button>` : ''}
              ${!isSelf && u.status === 'blocked' ? `<button class="btn btn--ghost btn--sm" data-unblock="${esc(u.uid)}">Unblock</button>` : ''}
              ${!isSelf ? `<button class="btn btn--ghost btn--sm text-red" data-remove="${esc(u.uid)}">Remove</button>` : ''}
            </div>
          </div>
          <div class="list__side">${badge}</div>
        </div>`;
      }).join('')
    : '<div class="empty">No staff accounts yet</div>';
}

function pickRole(targetUid) {
  const u = state.users[targetUid];
  if (!u) return;
  const m = openModal({
    title: `Role · ${u.name || u.email}`,
    size: 'narrow',
    body: `<div class="list">${ROLES.map(r => `
      <button class="list__row" data-pick="${r.id}">
        <div class="list__main">
          <div class="list__title">${esc(r.label)}</div>
          <div class="list__sub">${esc(r.hint)}</div>
        </div>
        <div class="list__side">${u.role === r.id ? '✓' : ''}</div>
      </button>`).join('')}</div>`
  });
  m.root.addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    dbSet(`users/${targetUid}/role`, b.dataset.pick);
    toast('Role updated', 'success');
    m.close();
  });
}

function mountUsers() {
  const box = $('#admin-users');
  box.addEventListener('click', async e => {
    const approve = e.target.closest('[data-approve]');
    if (approve) {
      dbSet(`users/${approve.dataset.approve}/status`, 'approved');
      return toast('Staff member approved', 'success');
    }
    const role = e.target.closest('[data-role]');
    if (role) return pickRole(role.dataset.role);

    const block = e.target.closest('[data-block]');
    if (block) {
      if (await confirmDialog('Block this account? They will be signed out and cannot log back in.')) {
        dbSet(`users/${block.dataset.block}/status`, 'blocked');
        toast('Account blocked', 'info');
      }
      return;
    }
    const unblock = e.target.closest('[data-unblock]');
    if (unblock) {
      dbSet(`users/${unblock.dataset.unblock}/status`, 'approved');
      return toast('Account unblocked', 'success');
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const ok = await confirmDialog(
        'Remove this profile? The login itself still exists in Firebase Authentication — delete it there too, otherwise they can sign up again as a pending user.',
        { okText: 'Remove profile' }
      );
      if (ok) {
        dbDelete(`users/${remove.dataset.remove}`);
        toast('Profile removed', 'info');
      }
    }
  });
  on('users', renderUsers);
  on('auth', renderUsers);
  renderUsers();
}

/* ------------------------------------------------------------ settings */

// How each setting is edited and read back. Anything not listed is a plain text field.
const FIELD_KIND = {
  taxPercent: 'number',
  lowStockThreshold: 'int',
  receiptShowSku: 'bool',
  receiptShowCashier: 'bool',
  receiptShowCustomer: 'bool',
  receiptShowSavings: 'bool',
  whatsappEnabled: 'bool',
  receiptHeaderNote: 'textarea',
  whatsappTemplate: 'textarea',
  receiptLogo: 'skip'          // handled separately by the logo picker
};

let pendingLogo = null;        // data: URI staged by the logo picker, saved on Save

function renderSettings() {
  const box = $('#settings-form');
  if (!box) return;
  const s = state.settings;
  const editable = isAdmin();
  const dis = editable ? '' : 'disabled';
  pendingLogo = s.receiptLogo || '';

  const check = (key, label) => `
    <label class="field-check">
      <input type="checkbox" id="s-${key}" ${s[key] !== false ? 'checked' : ''} ${dis}>
      <span>${esc(label)}</span></label>`;

  box.innerHTML = `
    <h4 class="mb">Shop</h4>
    <div class="field-row">
      <label class="field"><span>Shop name</span>
        <input type="text" id="s-shopName" value="${esc(s.shopName)}" ${dis}></label>
      <label class="field"><span>Branch</span>
        <input type="text" id="s-branch" value="${esc(s.branch)}" ${dis}></label>
    </div>
    <label class="field"><span>Address</span>
      <input type="text" id="s-address" value="${esc(s.address)}" ${dis}></label>
    <div class="field-row">
      <label class="field"><span>Phone</span>
        <input type="tel" id="s-phone" value="${esc(s.phone)}" ${dis}></label>
      <label class="field"><span>Currency</span>
        <input type="text" id="s-currency" value="${esc(s.currency)}" ${dis}></label>
    </div>
    <div class="field-row--3 field-row">
      <label class="field"><span>Tax %</span>
        <input type="number" id="s-taxPercent" step="any" inputmode="decimal" value="${esc(s.taxPercent)}" ${dis}></label>
      <label class="field"><span>Low stock at</span>
        <input type="number" id="s-lowStockThreshold" inputmode="numeric" value="${esc(s.lowStockThreshold)}" ${dis}></label>
      <label class="field"><span>Invoice prefix</span>
        <input type="text" id="s-invoicePrefix" value="${esc(s.invoicePrefix)}" ${dis}></label>
    </div>

    <h4 class="mb mt">Receipt template</h4>
    <div class="field-row">
      <label class="field"><span>Paper size</span>
        <select id="s-receiptWidth" ${dis}>
          <option value="80mm" ${s.receiptWidth === '80mm' ? 'selected' : ''}>80mm thermal</option>
          <option value="a5" ${s.receiptWidth === 'a5' ? 'selected' : ''}>A5 / A4 paper</option>
        </select></label>
      <label class="field"><span>Layout</span>
        <select id="s-receiptLayout" ${dis}>
          <option value="classic" ${s.receiptLayout === 'classic' ? 'selected' : ''}>Classic</option>
          <option value="compact" ${s.receiptLayout === 'compact' ? 'selected' : ''}>Compact (one line per item)</option>
          <option value="detailed" ${s.receiptLayout === 'detailed' ? 'selected' : ''}>Detailed (SKU + line totals)</option>
        </select></label>
    </div>

    <div class="field">
      <span>Logo</span>
      <div class="row row--wrap">
        <img id="logo-preview" class="logo-preview" src="${esc(s.receiptLogo || '')}" alt=""
             ${s.receiptLogo ? '' : 'hidden'}>
        <button class="btn btn--ghost btn--sm" id="logo-pick" ${dis}>Choose image</button>
        <button class="btn btn--ghost btn--sm text-red" id="logo-clear" ${s.receiptLogo ? '' : 'hidden'} ${dis}>Remove</button>
      </div>
      <p class="hint">Shrunk to 240px wide and stored with your settings. Keep it simple — thermal printers are black and white.</p>
    </div>

    <label class="field"><span>Extra header lines</span>
      <textarea id="s-receiptHeaderNote" rows="2" placeholder="VAT no, tagline… one per line" ${dis}>${esc(s.receiptHeaderNote)}</textarea></label>

    ${check('receiptShowSku', 'Show SKU next to each item')}
    ${check('receiptShowCashier', 'Show who served the customer')}
    ${check('receiptShowCustomer', 'Show the customer name')}
    ${check('receiptShowSavings', 'Show a “you saved” line when discounted')}

    <label class="field"><span>Receipt footer</span>
      <input type="text" id="s-receiptFooter" value="${esc(s.receiptFooter)}" ${dis}></label>

    <div class="row">
      <button class="btn btn--ghost btn--sm" id="s-preview">Preview receipt</button>
    </div>

    <h4 class="mb mt">WhatsApp receipts</h4>
    ${check('whatsappEnabled', 'Ask for a WhatsApp number at checkout')}
    <label class="field"><span>How the receipt is sent</span>
      <select id="s-whatsappMode" ${dis}>
        <option value="text" ${s.whatsappMode === 'text' ? 'selected' : ''}>Message only — free</option>
        <option value="share" ${s.whatsappMode === 'share' ? 'selected' : ''}>Message + attach PDF from the share sheet — free</option>
        <option value="link" ${s.whatsappMode === 'link' ? 'selected' : ''}>Message + PDF download link — needs Firebase Storage (Blaze plan)</option>
      </select></label>
    <p class="hint" id="wa-mode-hint"></p>
    <label class="field"><span>Country code</span>
      <input type="text" id="s-countryCode" value="${esc(s.countryCode)}" ${dis} placeholder="94"></label>
    <label class="field"><span>Message template</span>
      <textarea id="s-whatsappTemplate" rows="8" ${dis}>${esc(s.whatsappTemplate)}</textarea></label>
    <p class="hint">Placeholders: {shop} {branch} {customer} {invoice} {date} {items} {total} {currency} {paid} {due} {method} {phone} {link} {footer}</p>

    ${editable
      ? '<button class="btn btn--block mt" id="s-save">Save settings</button>'
      : '<p class="hint">Only an admin can change shop settings.</p>'}`;

  wireLogoPicker(editable);
  wirePreview();
  wireWhatsAppMode();

  const saveBtn = $('#s-save');
  if (saveBtn) saveBtn.onclick = () => {
    const next = { ...DEFAULT_SETTINGS };
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      const kind = FIELD_KIND[key] || 'text';
      if (kind === 'skip') return;
      const field = document.getElementById(`s-${key}`);
      if (!field) return;
      next[key] = kind === 'number' ? num(field.value, 0)
        : kind === 'int' ? int(field.value, 3)
        : kind === 'bool' ? !!field.checked
        : kind === 'textarea' ? field.value
        : field.value.trim();
    });
    next.receiptLogo = pendingLogo || '';
    dbSet('settings', next);
    state.settings = next;
    toast('Settings saved', 'success');
  };
}

/* ------------------------------------------------------- whatsapp mode */

const MODE_HINT = {
  text: 'WhatsApp opens on the customer’s number with the receipt written out as a message. Nothing to set up, no cost.',
  share: 'WhatsApp opens on the number with the message, then "Send PDF" on the receipt hands the actual PDF file to WhatsApp through your phone’s share sheet — you tap the customer there. Free. Works on Android and iPhone; on a desktop the PDF is saved instead so you can attach it yourself.',
  link: 'The PDF is uploaded and its link goes in the message, so the customer taps once. Firebase Storage now requires the Blaze billing plan — the usage itself is inside the free allowance for receipt-sized files, but Google needs a card on file.'
};

function wireWhatsAppMode() {
  const select = $('#s-whatsappMode');
  const hint = $('#wa-mode-hint');
  if (!select || !hint) return;
  const update = () => { hint.textContent = MODE_HINT[select.value] || ''; };
  select.onchange = update;
  update();
}

/* --------------------------------------------------------------- logo */

/** Downscale to 240px wide so the logo stays small enough to live in settings. */
function shrinkImage(file, maxWidth = 240) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function wireLogoPicker(editable) {
  const pick = $('#logo-pick');
  const clear = $('#logo-clear');
  const preview = $('#logo-preview');
  if (!pick || !editable) return;

  pick.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) return toast('Pick an image under 4MB', 'error');
      try {
        const dataUri = await shrinkImage(file);
        if (dataUri.length > 120000) return toast('That image is too detailed — try a simpler logo', 'error');
        pendingLogo = dataUri;
        preview.src = dataUri;
        preview.hidden = false;
        clear.hidden = false;
        toast('Logo ready — press Save settings', 'info');
      } catch {
        toast('Could not read that image', 'error');
      }
    };
    input.click();
  };

  clear.onclick = () => {
    pendingLogo = '';
    preview.hidden = true;
    clear.hidden = true;
    toast('Logo removed — press Save settings', 'info');
  };
}

/* ------------------------------------------------------------ preview */

/** Show the template against a fake sale so changes can be judged before saving. */
function wirePreview() {
  const btn = $('#s-preview');
  if (!btn) return;
  btn.onclick = async () => {
    // Apply the unsaved form values so the preview reflects what is on screen.
    const draft = { ...state.settings };
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      const kind = FIELD_KIND[key] || 'text';
      if (kind === 'skip') return;
      const field = document.getElementById(`s-${key}`);
      if (!field) return;
      draft[key] = kind === 'number' ? num(field.value, 0)
        : kind === 'int' ? int(field.value, 3)
        : kind === 'bool' ? !!field.checked
        : field.value;
    });
    draft.receiptLogo = pendingLogo || '';

    const saved = state.settings;
    state.settings = draft;
    try {
      const { receiptHTML } = await import('./receipt.js');
      openModal({
        title: 'Receipt preview',
        size: 'narrow',
        body: `<div class="receipt-preview">${receiptHTML(SAMPLE_SALE)}</div>`,
        onClose: () => { state.settings = saved; }
      });
    } catch {
      state.settings = saved;
      toast('Could not build the preview', 'error');
    }
  };
}

const SAMPLE_SALE = {
  invoiceNo: 'MG-00042',
  timestamp: Date.now(),
  cashierName: 'Sample Staff',
  customerName: 'Nimal Silva',
  lines: [
    { name: 'Yamaha F310 Acoustic', sku: 'YF310', qty: 1, unitPrice: 32000, buyPrice: 20000, discount: 2000, lineTotal: 30000 },
    { name: 'Ernie Ball Slinky Strings', sku: 'EB2221', qty: 2, unitPrice: 2200, buyPrice: 1200, discount: 0, lineTotal: 4400 }
  ],
  subtotal: 36400,
  itemDiscount: 2000,
  discount: 400,
  taxPercent: 0,
  tax: 0,
  total: 34000,
  payments: [{ method: 'cash', amount: 34000 }],
  change: 1000,
  due: 0,
  status: 'completed',
  note: ''
};

/* ---------------------------------------------------------- categories */

function renderCategories() {
  const box = $('#cat-list');
  if (!box) return;
  const cats = Object.values(state.categories || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  box.innerHTML = cats.length
    ? cats.map(c => `
        <div class="list__row" style="cursor:default">
          <div class="list__main"><div class="list__title">${esc(c.name)}</div></div>
          <div class="list__side">
            <button class="icon-btn text-red" data-delcat="${esc(c.id)}" style="min-height:32px;min-width:32px">✕</button>
          </div>
        </div>`).join('')
    : `<div class="empty">Using the default categories.<br>
        <span class="tiny">Add one to start your own list.</span></div>`;
}

function mountCategories() {
  $('#cat-add').onclick = async () => {
    const name = await promptDialog({ title: 'New category', label: 'Category name', okText: 'Add' });
    if (!name || !name.trim()) return;
    // Seed the defaults first so adding one category doesn't wipe the rest.
    if (!Object.keys(state.categories || {}).length) {
      ['Guitars', 'Accessories', 'Strings', 'Repair Parts', 'Amps & Pedals', 'Rentals'].forEach(n => {
        const id = uid('cat');
        dbSet(`categories/${id}`, { id, name: n });
      });
    }
    const id = uid('cat');
    dbSet(`categories/${id}`, { id, name: name.trim() });
    toast('Category added', 'success');
  };

  $('#cat-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-delcat]');
    if (!b) return;
    if (await confirmDialog('Delete this category? Items keep their current category name.')) {
      dbDelete(`categories/${b.dataset.delcat}`);
    }
  });

  on('categories', renderCategories);
  renderCategories();
}

/* -------------------------------------------------------------- reset */

/**
 * Opening-day reset. Clears the trading records but never touches staff
 * accounts, shop settings or the admin bootstrap flag — losing those would lock
 * everyone out of the app.
 */
const RESET_TARGETS = [
  {
    key: 'inventory',
    label: 'Products & stock',
    hint: 'Every item, with its prices and quantities',
    paths: ['inventory', 'stockmoves'],
    count: () => Object.keys(state.inventory || {}).length
  },
  {
    key: 'sales',
    label: 'Sales, invoices & refunds',
    hint: 'All till history, and the invoice number restarts at 1',
    paths: ['sales', 'returns', 'counters/invoice', 'held'],
    count: () => state.sales.length
  },
  {
    key: 'customers',
    label: 'Customers',
    hint: 'Customer records and their purchase links',
    paths: ['customers'],
    count: () => Object.keys(state.customers || {}).length
  },
  {
    key: 'repairs',
    label: 'Repair jobs',
    hint: 'Every job card',
    paths: ['repairs'],
    count: () => state.repairs.length
  },
  {
    key: 'rentals',
    label: 'Rentals',
    hint: 'Rental records, out and returned',
    paths: ['rentals'],
    count: () => state.rentals.length
  },
  {
    key: 'expenses',
    label: 'Expenses',
    hint: 'Expense log used by the profit report',
    paths: ['expenses'],
    count: () => state.expenses.length
  }
];

const CONFIRM_WORD = 'RESET';

function openReset() {
  if (!isAdmin()) return toast('Only an admin can reset the shop data', 'error');

  const m = openModal({
    title: 'Start fresh for business',
    body: `
      <p class="small mb">Tick what should be wiped. Your staff accounts, roles and
      shop settings are always kept, so nobody gets locked out.</p>

      <div id="reset-list">
        ${RESET_TARGETS.map(t => `
          <label class="field-check" style="align-items:flex-start">
            <input type="checkbox" data-target="${esc(t.key)}" checked>
            <span>
              <b>${esc(t.label)}</b>
              <span class="badge badge--mute">${t.count()}</span><br>
              <span class="tiny muted">${esc(t.hint)}</span>
            </span>
          </label>`).join('')}
      </div>

      <hr class="mt mb" style="border:0;border-top:1px solid var(--border)">

      <label class="field-check">
        <input type="checkbox" id="reset-backup" checked>
        <span>Download a backup first (strongly recommended)</span></label>

      <div class="alert mt">
        This permanently deletes the selected records from the cloud, on every
        device. It cannot be undone.
      </div>

      <label class="field"><span>Type ${CONFIRM_WORD} to confirm</span>
        <input type="text" id="reset-word" autocomplete="off" autocapitalize="characters" placeholder="${CONFIRM_WORD}"></label>

      <p class="hint" id="reset-status"></p>`,
    footer: `
      <button class="btn btn--ghost" data-close>Cancel</button>
      <button class="btn btn--danger" id="reset-go" disabled>Erase &amp; start fresh</button>`
  });

  const word = m.root.querySelector('#reset-word');
  const go = m.root.querySelector('#reset-go');
  const status = m.root.querySelector('#reset-status');

  word.addEventListener('input', () => {
    go.disabled = word.value.trim().toUpperCase() !== CONFIRM_WORD;
  });

  go.onclick = async () => {
    const chosen = RESET_TARGETS.filter(t =>
      m.root.querySelector(`[data-target="${t.key}"]`)?.checked);
    if (!chosen.length) return toast('Nothing selected', 'warn');

    if (!state.online) {
      return toast('You need an internet connection to reset', 'error');
    }

    go.disabled = true;
    go.textContent = 'Erasing…';

    try {
      if (m.root.querySelector('#reset-backup').checked) {
        status.textContent = 'Saving a backup…';
        backup();
        await new Promise(r => setTimeout(r, 700));
      }

      // Direct writes, not the offline queue: this must be online and must
      // surface a real error rather than being retried in the background.
      const { R, set } = await import('./firebase.js');
      const paths = chosen.flatMap(t => t.paths);
      const failed = [];

      for (const path of paths) {
        status.textContent = `Clearing ${path}…`;
        try {
          await set(R(path), null);
        } catch (err) {
          console.error('Reset failed for', path, err);
          failed.push(`${path} (${err?.code || err?.message || 'error'})`);
        }
      }

      if (failed.length) {
        status.textContent = '';
        go.disabled = false;
        go.textContent = 'Erase & start fresh';
        return openModal({
          title: 'Some records could not be cleared',
          size: 'narrow',
          body: `
            <p class="small mb">These paths were refused by the database rules:</p>
            <ul class="small">${failed.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            <p class="hint mt">Publish the latest <code>database.rules.json</code> in the
            Firebase console and try again. Everything else was cleared.</p>`
        });
      }

      status.textContent = 'Clearing this device…';
      ['mrguitar.cache.v1', 'mrguitar.outbox.v1', 'mrguitar.outbox.failed.v1', 'mrguitar.cart.v1']
        .forEach(k => localStorage.removeItem(k));

      toast('Shop data cleared — ready for business', 'success', 4000);
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      console.error(err);
      status.textContent = '';
      go.disabled = false;
      go.textContent = 'Erase & start fresh';
      toast('Reset failed: ' + (err?.message || 'unknown error'), 'error');
    }
  };
}

/* --------------------------------------------------------------- data */

function backup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    inventory: state.inventory,
    customers: state.customers,
    categories: state.categories,
    sales: state.sales,
    returns: state.returns,
    expenses: state.expenses,
    repairs: state.repairs,
    rentals: state.rentals
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mrguitar-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded', 'success');
}

function renderPending() {
  const el = $('#data-pending');
  if (!el) return;
  const n = pendingCount();
  el.textContent = n
    ? `${n} change${n === 1 ? '' : 's'} waiting to sync to the cloud.`
    : 'All changes are synced.';
}

function mountData() {
  $('#data-backup').onclick = backup;

  $('#data-update').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      // Imported lazily: app.js imports this module, so a static import would cycle.
      const { checkForUpdate } = await import('./app.js');
      const found = await checkForUpdate();
      if (found) toast('New version found — reloading', 'success');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check for updates';
    }
  };

  const danger = $('#danger-card');
  const resetBtn = $('#data-reset');
  if (danger) danger.hidden = !isAdmin();
  if (resetBtn) resetBtn.onclick = openReset;
  on('auth', () => { if (danger) danger.hidden = !isAdmin(); });

  const version = $('#data-version');
  if (version) {
    version.textContent = `App ${window.MRGUITAR?.version || '—'} · if this device is stuck on an old version, open the app with ?fresh=1 on the end of the address.`;
  }
  $('#data-clearcache').onclick = async () => {
    const ok = await confirmDialog(
      pendingCount()
        ? 'There are unsynced changes. Clearing the cache will discard them. Continue?'
        : 'Clear the offline cache on this device? Data in the cloud is untouched.'
    );
    if (!ok) return;
    ['mrguitar.cache.v1', 'mrguitar.outbox.v1', 'mrguitar.cart.v1'].forEach(k => localStorage.removeItem(k));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    toast('Cache cleared — reloading', 'info');
    setTimeout(() => location.reload(), 800);
  };
  on('outbox', renderPending);
  on('connection', () => { renderPending(); flushOutbox(); });
  renderPending();
}

/* --------------------------------------------------------------- mount */

export function mountAdmin() {
  mountUsers();
  mountCategories();
  mountData();
  on('settings', renderSettings);
  on('auth', renderSettings);
  renderSettings();
}

export { renderUsers, renderSettings };
