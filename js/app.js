// Boot, navigation and cross-module glue.
import { state, on, isAdmin, isManager, pendingCount, flushOutbox, lowStockItems } from './store.js';
import { initAuth, mountAuthUI, logout } from './auth.js';
import { $, $$, esc, toast } from './util.js';
import { mountPOS, renderCart } from './pos.js';
import { mountInventory, editItem, showLowStock } from './inventory.js';
import { mountSales } from './sales.js';
import { mountReports, renderReports } from './reports.js';
import { mountCustomers, editCustomer } from './customers.js';
import { mountRepairs, editJob, openJobsCount } from './repairs.js';
import { mountRentals, newRental, outRentalsCount, overdueRentalsCount } from './rentals.js';
import { mountExpenses, editExpense } from './expenses.js';
import { mountAdmin } from './admin.js';

const APP_VERSION = '2.1.1';

/* ---------------------------------------------------------- navigation */

const TABS = ['pos', 'inventory', 'sales', 'reports', 'more'];
const SUB_SECTIONS = ['customers', 'repairs', 'rentals', 'expenses', 'admin', 'settings'];

let currentSection = 'pos';

const FAB_ACTIONS = {
  inventory: () => editItem(null),
  customers: () => editCustomer(null),
  repairs: () => editJob(null),
  rentals: () => newRental(),
  expenses: () => editExpense(null)
};

export function goto(section) {
  currentSection = section;
  $$('.section').forEach(s => s.classList.toggle('is-active', s.id === `sec-${section}`));
  $$('.tabbar__btn').forEach(b => {
    const owns = b.dataset.tab === section
      || (b.dataset.tab === 'more' && SUB_SECTIONS.includes(section));
    b.classList.toggle('is-active', owns);
  });

  const fab = $('#fab');
  fab.hidden = !FAB_ACTIONS[section];
  fab.onclick = FAB_ACTIONS[section] || null;

  if (section === 'reports') renderReports();
  renderCart();                        // keeps the mobile cart bar in sync
  window.scrollTo({ top: 0, behavior: 'instant' });
  history.replaceState(null, '', `#${section}`);
}

/* ---------------------------------------------------------- more menu */

function renderMoreMenu() {
  const box = $('#more-menu');
  if (!box) return;

  const low = lowStockItems().length;
  const jobs = openJobsCount();
  const rentalsOut = outRentalsCount();
  const overdue = overdueRentalsCount();
  const pendingStaff = Object.values(state.users || {}).filter(u => u.status === 'pending').length;

  const tiles = [
    { id: 'customers', ico: '👥', label: 'Customers', count: `${Object.keys(state.customers || {}).length} saved` },
    { id: 'repairs', ico: '🛠️', label: 'Repairs', count: jobs ? `${jobs} open` : 'none open' },
    { id: 'rentals', ico: '🎸', label: 'Rentals', count: overdue ? `${overdue} overdue` : `${rentalsOut} out` },
    { id: 'expenses', ico: '🧮', label: 'Expenses', count: `${state.expenses.length} logged`, manager: true },
    { id: 'lowstock', ico: '⚠️', label: 'Low stock', count: low ? `${low} item${low === 1 ? '' : 's'}` : 'all good' },
    { id: 'settings', ico: '⚙️', label: 'Settings', count: 'shop &amp; receipt' },
    { id: 'admin', ico: '🔑', label: 'Staff', count: pendingStaff ? `${pendingStaff} pending` : 'accounts', admin: true }
  ].filter(t => (!t.manager || isManager()) && (!t.admin || isAdmin()));

  box.innerHTML = tiles.map(t => `
    <button class="menu-tile" data-go="${t.id}">
      <span class="ico">${t.ico}</span>
      <span>${esc(t.label)}</span>
      <span class="count">${t.count}</span>
    </button>`).join('');

  $('#app-version').textContent = `Mr. Guitar POS v${APP_VERSION} · signed in as ${state.profile?.name || state.user?.email || ''}`;
}

/* -------------------------------------------------------------- header */

function renderHeader() {
  $('#hdr-shop').textContent = state.settings.shopName || 'Mr. Guitar';
  const roleLabel = { admin: 'Admin', manager: 'Manager', staff: 'Staff' }[state.role] || 'Staff';
  $('#hdr-user').textContent = `${state.settings.branch || ''} · ${state.profile?.name || state.user?.email || ''} (${roleLabel})`;
  renderStatusPill();
}

function renderStatusPill() {
  const pill = $('#hdr-status');
  if (!pill) return;
  const pending = pendingCount();
  if (!state.online) {
    pill.hidden = false;
    pill.className = 'pill pill--offline';
    pill.textContent = pending ? `Offline · ${pending}` : 'Offline';
  } else if (pending) {
    pill.hidden = false;
    pill.className = 'pill pill--sync';
    pill.textContent = `Syncing ${pending}`;
  } else {
    pill.hidden = true;
  }
}

/* ------------------------------------------------------------- alerts */

let alertedLowStock = false;

function checkAlerts() {
  if (alertedLowStock) return;
  const low = lowStockItems();
  if (low.length) {
    alertedLowStock = true;
    toast(`${low.length} item${low.length === 1 ? '' : 's'} low on stock`, 'warn', 4000);
  }
}

/* --------------------------------------------------------------- boot */

function mountShell() {
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b) goto(b.dataset.tab);
  });

  $('#more-menu').addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.dataset.go === 'lowstock') return showLowStock();
    goto(b.dataset.go);
  });

  $('#hdr-logout').onclick = async () => {
    const { confirmDialog } = await import('./util.js');
    if (pendingCount() && !(await confirmDialog('Some changes have not synced yet. Sign out anyway?'))) return;
    logout();
  };

  $('#hdr-refresh').onclick = () => {
    flushOutbox();
    renderReports();
    toast(state.online ? 'Synced' : 'Offline — changes are queued', state.online ? 'success' : 'warn');
  };

  on('connection', renderStatusPill);
  on('outbox', renderStatusPill);
  on('settings', renderHeader);
  on('inventory', () => { renderMoreMenu(); checkAlerts(); });
  on('repairs', renderMoreMenu);
  on('rentals', renderMoreMenu);
  on('customers', renderMoreMenu);
  on('expenses', renderMoreMenu);
  on('users', renderMoreMenu);
}

let mounted = false;

function mountModules() {
  if (mounted) return;
  mounted = true;
  mountShell();
  mountPOS();
  mountInventory();
  mountSales();
  mountReports();
  mountCustomers();
  mountRepairs();
  mountRentals();
  mountExpenses();
  mountAdmin();
}

function start(profile) {
  mountModules();
  renderHeader();
  renderMoreMenu();

  const hash = location.hash.replace('#', '');
  goto([...TABS, ...SUB_SECTIONS].includes(hash) ? hash : 'pos');

  setTimeout(checkAlerts, 1500);
}

/* ------------------------------------------------------- service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}

/* ------------------------------------------------------------- kick off */

mountAuthUI();
initAuth(start);

// Warn before closing with an unsaved cart or unsynced writes.
window.addEventListener('beforeunload', e => {
  if (pendingCount() > 0) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Expose a tiny debug handle — handy when diagnosing a till on the shop floor.
window.MRGUITAR = { state, goto, version: APP_VERSION };
