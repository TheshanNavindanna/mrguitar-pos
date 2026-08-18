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

function renderSettings() {
  const box = $('#settings-form');
  if (!box) return;
  const s = state.settings;
  const editable = isAdmin();

  box.innerHTML = `
    <div class="field-row">
      <label class="field"><span>Shop name</span>
        <input type="text" id="s-shopName" value="${esc(s.shopName)}" ${editable ? '' : 'disabled'}></label>
      <label class="field"><span>Branch</span>
        <input type="text" id="s-branch" value="${esc(s.branch)}" ${editable ? '' : 'disabled'}></label>
    </div>
    <label class="field"><span>Address</span>
      <input type="text" id="s-address" value="${esc(s.address)}" ${editable ? '' : 'disabled'}></label>
    <div class="field-row">
      <label class="field"><span>Phone</span>
        <input type="tel" id="s-phone" value="${esc(s.phone)}" ${editable ? '' : 'disabled'}></label>
      <label class="field"><span>Currency</span>
        <input type="text" id="s-currency" value="${esc(s.currency)}" ${editable ? '' : 'disabled'}></label>
    </div>
    <div class="field-row--3 field-row">
      <label class="field"><span>Tax %</span>
        <input type="number" id="s-taxPercent" step="any" inputmode="decimal" value="${esc(s.taxPercent)}" ${editable ? '' : 'disabled'}></label>
      <label class="field"><span>Low stock at</span>
        <input type="number" id="s-lowStockThreshold" inputmode="numeric" value="${esc(s.lowStockThreshold)}" ${editable ? '' : 'disabled'}></label>
      <label class="field"><span>Invoice prefix</span>
        <input type="text" id="s-invoicePrefix" value="${esc(s.invoicePrefix)}" ${editable ? '' : 'disabled'}></label>
    </div>
    <label class="field"><span>Receipt size</span>
      <select id="s-receiptWidth" ${editable ? '' : 'disabled'}>
        <option value="80mm" ${s.receiptWidth === '80mm' ? 'selected' : ''}>80mm thermal</option>
        <option value="a5" ${s.receiptWidth === 'a5' ? 'selected' : ''}>A5 / A4 paper</option>
      </select></label>
    <label class="field"><span>Receipt footer</span>
      <input type="text" id="s-receiptFooter" value="${esc(s.receiptFooter)}" ${editable ? '' : 'disabled'}></label>
    ${editable
      ? '<button class="btn btn--block" id="s-save">Save settings</button>'
      : '<p class="hint">Only an admin can change shop settings.</p>'}`;

  const saveBtn = $('#s-save');
  if (saveBtn) saveBtn.onclick = () => {
    const next = { ...DEFAULT_SETTINGS };
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      const field = document.getElementById(`s-${key}`);
      if (!field) return;
      next[key] = key === 'taxPercent' ? num(field.value, 0)
        : key === 'lowStockThreshold' ? int(field.value, 3)
        : field.value.trim();
    });
    dbSet('settings', next);
    state.settings = next;
    toast('Settings saved', 'success');
  };
}

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
