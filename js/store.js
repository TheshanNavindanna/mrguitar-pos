// Central app state, Firebase subscriptions, and the offline write queue.
import { db, R, ref, onValue, set, update, push, get, runTransaction } from './firebase.js';
import { uid, num, int, toast } from './util.js';

/* ----------------------------------------------------------------- state */

export const DEFAULT_SETTINGS = {
  shopName: 'Mr. Guitar',
  branch: 'Beliatta',
  address: '',
  phone: '',
  currency: 'LKR',
  countryCode: '94',                // Sri Lanka — used to normalise WhatsApp numbers
  taxPercent: 0,
  lowStockThreshold: 3,
  invoicePrefix: 'MG',

  // ----- receipt template -----
  receiptWidth: '80mm',             // '80mm' | 'a5'
  receiptLayout: 'classic',         // 'classic' | 'compact' | 'detailed'
  receiptLogo: '',                  // small data: URI, set from Settings
  receiptHeaderNote: '',            // extra header lines (VAT no, tagline…)
  receiptShowSku: true,
  receiptShowCashier: true,
  receiptShowCustomer: true,
  receiptShowSavings: true,         // "You saved X" line when a discount was given
  receiptFooter: 'Thank you for your business!',

  // ----- whatsapp -----
  whatsappEnabled: true,
  whatsappAttachPdf: true,          // upload a PDF and put the link in the message
  whatsappTemplate:
    'Hello {customer},\n' +
    'Thank you for shopping at {shop}.\n\n' +
    'Invoice: {invoice}\n' +
    'Date: {date}\n\n' +
    '{items}\n\n' +
    'Total: {currency} {total}\n\n' +
    '{link}\n' +
    '{footer}'
};

export const state = {
  user: null,
  profile: null,
  role: 'staff',
  online: navigator.onLine,
  settings: { ...DEFAULT_SETTINGS },
  inventory: {},   // id -> item
  categories: {},  // id -> {id,name}
  customers: {},   // id -> customer
  users: {},       // uid -> profile
  sales: [],       // newest last
  returns: [],
  expenses: [],
  repairs: [],
  rentals: [],
  held: {}         // id -> parked cart
};

export const isAdmin = () => state.role === 'admin';
export const isManager = () => state.role === 'admin' || state.role === 'manager';

/* --------------------------------------------------------------- emitter */

const listeners = new Map();

export function on(topic, cb) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(cb);
  return () => listeners.get(topic).delete(cb);
}

export function emit(topic, payload) {
  (listeners.get(topic) || []).forEach(cb => {
    try { cb(payload); } catch (err) { console.error(`[${topic}] listener failed`, err); }
  });
  (listeners.get('*') || []).forEach(cb => cb(topic, payload));
}

/* ----------------------------------------------------------- local cache */

const CACHE_KEY = 'mrguitar.cache.v1';

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      inventory: state.inventory,
      customers: state.customers,
      categories: state.categories,
      settings: state.settings
    }));
  } catch { /* quota — not fatal */ }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c.inventory) state.inventory = c.inventory;
    if (c.customers) state.customers = c.customers;
    if (c.categories) state.categories = c.categories;
    if (c.settings) state.settings = { ...DEFAULT_SETTINGS, ...c.settings };
  } catch { /* corrupt cache — ignore */ }
}

/* --------------------------------------------------------- offline queue */
/* RTDB keeps writes in memory while offline but loses them on reload, which for a
   shop POS means losing a sale. Everything that mutates goes through the outbox. */

const OUTBOX_KEY = 'mrguitar.outbox.v1';
let flushing = false;

const readOutbox = () => {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
};
const writeOutbox = ops => {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops)); } catch { /* ignore */ }
};

export const pendingCount = () => readOutbox().length;

function enqueue(op) {
  const ops = readOutbox();
  ops.push({ ...op, _id: uid('op'), _at: Date.now() });
  writeOutbox(ops);
  emit('outbox', ops.length);
}

async function runOp(op) {
  switch (op.kind) {
    case 'set':
      return set(R(op.path), op.value);
    case 'update':
      return update(R(op.path), op.value);
    case 'push':
      return set(R(op.path, op.key), op.value);
    case 'stockDelta':
      return runTransaction(R('inventory', op.itemId, 'stock'), cur => num(cur) + num(op.delta));
    default:
      console.warn('Unknown outbox op', op);
      return null;
  }
}

export async function flushOutbox() {
  if (flushing || !state.online) return;
  flushing = true;
  try {
    let ops = readOutbox();
    while (ops.length) {
      const op = ops[0];
      try {
        await runOp(op);
      } catch (err) {
        console.warn('Outbox op failed, will retry', op, err);
        break; // keep order; retry on next connect
      }
      ops = readOutbox().filter(o => o._id !== op._id);
      writeOutbox(ops);
      emit('outbox', ops.length);
    }
    if (!readOutbox().length) emit('outbox', 0);
  } finally {
    flushing = false;
  }
}

/**
 * Durable write. Applies immediately when online, otherwise queues to localStorage
 * and replays on reconnect. Always resolves — callers should not block the UI on it.
 */
export function writeOp(op) {
  enqueue(op);
  return flushOutbox();
}

export const dbSet = (path, value) => writeOp({ kind: 'set', path, value });
export const dbUpdate = (path, value) => writeOp({ kind: 'update', path, value });
export const dbDelete = path => writeOp({ kind: 'set', path, value: null });
export const stockDelta = (itemId, delta) => writeOp({ kind: 'stockDelta', itemId, delta });

/** Push with a client-generated key so the record id is known before it reaches the server. */
export function dbPush(path, value) {
  const key = push(R(path)).key || uid('rec');
  const record = { ...value, id: key };
  writeOp({ kind: 'push', path, key, value: record });
  return record;
}

/* ------------------------------------------------------- invoice numbers */

/**
 * Atomic invoice counter. Falls back to a timestamp-based number when offline so
 * two devices can keep selling without colliding.
 */
export async function nextInvoiceNo() {
  const prefix = state.settings.invoicePrefix || 'MG';
  if (!state.online) {
    return `${prefix}-OFF${Date.now().toString().slice(-8)}`;
  }
  try {
    const res = await runTransaction(R('counters/invoice'), cur => int(cur, 0) + 1);
    const n = int(res.snapshot.val(), 1);
    return `${prefix}-${String(n).padStart(5, '0')}`;
  } catch {
    return `${prefix}-OFF${Date.now().toString().slice(-8)}`;
  }
}

/* ------------------------------------------------------------ collections */

const listToArray = snapshotValue => {
  const out = [];
  if (!snapshotValue) return out;
  Object.keys(snapshotValue).forEach(key => out.push({ ...snapshotValue[key], id: key }));
  return out.sort((a, b) => num(a.timestamp) - num(b.timestamp));
};

let unsubscribers = [];

function watchMap(path, key, after) {
  const un = onValue(R(path), snap => {
    state[key] = snap.val() || {};
    if (after) after();
    emit(key, state[key]);
  }, err => console.warn(`watch ${path} failed`, err));
  unsubscribers.push(un);
}

function watchList(path, key) {
  const un = onValue(R(path), snap => {
    state[key] = listToArray(snap.val());
    emit(key, state[key]);
  }, err => console.warn(`watch ${path} failed`, err));
  unsubscribers.push(un);
}

/** Attach all realtime listeners for a signed-in, approved user. */
export function subscribeAll() {
  unsubscribeAll();
  loadCache();

  const unSettings = onValue(R('settings'), snap => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.val() || {}) };
    saveCache();
    emit('settings', state.settings);
  });
  unsubscribers.push(unSettings);

  watchMap('inventory', 'inventory', saveCache);
  watchMap('categories', 'categories', saveCache);
  watchMap('customers', 'customers', saveCache);
  watchMap('held', 'held');

  watchList('sales', 'sales');
  watchList('returns', 'returns');
  watchList('repairs', 'repairs');
  watchList('rentals', 'rentals');

  // Expenses are manager+ only in the security rules — don't attach a listener
  // that would just be denied for staff.
  if (isManager()) watchList('expenses', 'expenses');

  if (isManager()) watchMap('users', 'users');

  // Connection state drives the offline badge and outbox replay.
  const unConn = onValue(ref(db, '.info/connected'), snap => {
    state.online = snap.val() === true;
    emit('connection', state.online);
    if (state.online) flushOutbox();
  });
  unsubscribers.push(unConn);
}

export function unsubscribeAll() {
  unsubscribers.forEach(un => { try { un(); } catch { /* ignore */ } });
  unsubscribers = [];
}

/* -------------------------------------------------------------- lookups */

export const itemById = id => state.inventory[id] || null;
export const customerById = id => state.customers[id] || null;

export const categoryNames = () => {
  const fromSettings = Object.values(state.categories).map(c => c.name).filter(Boolean);
  if (fromSettings.length) return fromSettings.sort((a, b) => a.localeCompare(b));
  return ['Guitars', 'Accessories', 'Strings', 'Repair Parts', 'Amps & Pedals', 'Rentals'];
};

export const inventoryList = () =>
  Object.values(state.inventory).sort((a, b) => String(a.name).localeCompare(String(b.name)));

export const lowStockItems = () => {
  const fallback = int(state.settings.lowStockThreshold, 3);
  return inventoryList().filter(i => {
    if (i.trackStock === false) return false;
    const level = i.reorderLevel === undefined || i.reorderLevel === '' ? fallback : int(i.reorderLevel, fallback);
    return int(i.stock, 0) <= level;
  });
};

/** Sales within [from, to], newest first. */
export const salesBetween = (from, to) =>
  state.sales.filter(s => num(s.timestamp) >= from && num(s.timestamp) <= to)
    .slice().sort((a, b) => num(b.timestamp) - num(a.timestamp));

/* ---------------------------------------------------------------- online */

window.addEventListener('online', () => { state.online = true; emit('connection', true); flushOutbox(); });
window.addEventListener('offline', () => { state.online = false; emit('connection', false); });

/** One-shot read, used by seeding/migration paths. */
export const readOnce = async path => (await get(R(path))).val();

export { toast };
