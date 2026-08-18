// Repair / service jobs — intake, status tracking, and handing the finished job to the register.
import { state, on, dbPush, dbSet, dbDelete, isManager } from './store.js';
import {
  $, esc, money, num, int, uid, toast, openModal, confirmDialog,
  fmtDate, fmtDateTime, relDays, dateKey
} from './util.js';
import { pickCustomer } from './customers.js';

let filter = 'open';

export const STATUSES = [
  { id: 'received', label: 'Received', badge: 'badge--info' },
  { id: 'in-progress', label: 'In progress', badge: 'badge--warn' },
  { id: 'waiting-parts', label: 'Waiting for parts', badge: 'badge--warn' },
  { id: 'ready', label: 'Ready for pickup', badge: 'badge--ok' },
  { id: 'delivered', label: 'Delivered', badge: 'badge--mute' },
  { id: 'cancelled', label: 'Cancelled', badge: 'badge--mute' }
];

const statusMeta = id => STATUSES.find(s => s.id === id) || STATUSES[0];
const OPEN = ['received', 'in-progress', 'waiting-parts', 'ready'];

export const openJobsCount = () => state.repairs.filter(r => OPEN.includes(r.status)).length;

function visible() {
  const list = state.repairs.slice().sort((a, b) => num(b.receivedAt) - num(a.receivedAt));
  if (filter === 'all') return list;
  if (filter === 'open') return list.filter(r => OPEN.includes(r.status));
  return list.filter(r => r.status === filter);
}

function jobTotal(job) {
  return num(job.laborCharge) + num(job.partsCharge);
}

/* --------------------------------------------------------------- render */

function render() {
  const box = $('#repairs-list');
  if (!box) return;
  const list = visible();

  box.innerHTML = list.length
    ? list.map(j => {
        const meta = statusMeta(j.status);
        const overdue = j.promisedAt && num(j.promisedAt) < Date.now() && OPEN.includes(j.status);
        return `
        <button class="list__row" data-job="${esc(j.id)}">
          <div class="list__main">
            <div class="list__title">${esc(j.jobNo || '')} · ${esc(j.instrument || 'Instrument')}</div>
            <div class="list__sub">${esc(j.customerName || 'Walk-in')}${j.phone ? ' · ' + esc(j.phone) : ''}</div>
            <div class="tiny muted">${esc(j.issue || '')}</div>
            ${j.promisedAt ? `<div class="tiny ${overdue ? 'text-red strong' : 'muted'}">Promised ${fmtDate(j.promisedAt)} (${relDays(j.promisedAt)})</div>` : ''}
          </div>
          <div class="list__side">
            <span class="badge ${meta.badge}">${esc(meta.label)}</span>
            <div class="tiny strong mt">${money(jobTotal(j) || j.estimate || 0)}</div>
          </div>
        </button>`;
      }).join('')
    : '<div class="empty"><span class="ico">🛠️</span>No repair jobs here</div>';
}

/* -------------------------------------------------------------- editing */

export function editJob(id) {
  const j = id ? state.repairs.find(r => r.id === id) : null;
  let customerId = j?.customerId || null;
  let customerName = j?.customerName || '';

  const m = openModal({
    title: j ? `Job ${j.jobNo}` : 'New repair job',
    body: `
      <button class="btn btn--ghost btn--block mb" id="j-customer">👤 ${esc(customerName || 'Choose customer')}</button>

      <div class="field-row">
        <label class="field"><span>Contact name</span>
          <input type="text" id="j-name" value="${esc(j?.customerName || '')}"></label>
        <label class="field"><span>Phone</span>
          <input type="tel" id="j-phone" inputmode="tel" value="${esc(j?.phone || '')}"></label>
      </div>

      <label class="field"><span>Instrument *</span>
        <input type="text" id="j-instrument" value="${esc(j?.instrument || '')}"
               placeholder="e.g. Yamaha F310 acoustic, natural"></label>

      <label class="field"><span>Reported problem *</span>
        <textarea id="j-issue" placeholder="Buzzing on the low E, action too high…">${esc(j?.issue || '')}</textarea></label>

      <div class="field-row">
        <label class="field"><span>Estimate given</span>
          <input type="number" id="j-estimate" step="any" inputmode="decimal" value="${esc(j?.estimate ?? '')}"></label>
        <label class="field"><span>Advance paid</span>
          <input type="number" id="j-advance" step="any" inputmode="decimal" value="${esc(j?.advance ?? '')}"></label>
      </div>

      <div class="field-row">
        <label class="field"><span>Received on</span>
          <input type="date" id="j-received" value="${esc(dateKey(j?.receivedAt || Date.now()))}"></label>
        <label class="field"><span>Promised by</span>
          <input type="date" id="j-promised" value="${j?.promisedAt ? esc(dateKey(j.promisedAt)) : ''}"></label>
      </div>

      <label class="field"><span>Status</span>
        <select id="j-status">
          ${STATUSES.map(s => `<option value="${s.id}" ${j?.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select></label>

      <div class="field-row">
        <label class="field"><span>Parts charge</span>
          <input type="number" id="j-parts" step="any" inputmode="decimal" value="${esc(j?.partsCharge ?? '')}"></label>
        <label class="field"><span>Labour charge</span>
          <input type="number" id="j-labor" step="any" inputmode="decimal" value="${esc(j?.laborCharge ?? '')}"></label>
      </div>
      <label class="field"><span>Parts cost to shop</span>
        <input type="number" id="j-partscost" step="any" inputmode="decimal" value="${esc(j?.partsCost ?? '')}"></label>

      <label class="field"><span>Work done / internal notes</span>
        <textarea id="j-note">${esc(j?.note || '')}</textarea></label>`,
    footer: `
      ${j && isManager() ? '<button class="btn btn--ghost btn--danger" data-del>Delete</button>' : ''}
      ${j && j.status !== 'delivered' ? '<button class="btn btn--green" data-checkout>Charge &amp; close</button>' : ''}
      <button class="btn" data-save>Save</button>`
  });

  m.root.querySelector('#j-customer').onclick = async () => {
    const c = await pickCustomer();
    if (c === undefined) return;
    customerId = c ? c.id : null;
    customerName = c ? c.name : '';
    m.root.querySelector('#j-customer').textContent = `👤 ${customerName || 'Walk-in'}`;
    if (c) {
      m.root.querySelector('#j-name').value = c.name;
      if (c.phone) m.root.querySelector('#j-phone').value = c.phone;
    }
  };

  const collect = () => {
    const instrument = m.root.querySelector('#j-instrument').value.trim();
    const issue = m.root.querySelector('#j-issue').value.trim();
    if (!instrument) { toast('Instrument is required', 'error'); return null; }
    if (!issue) { toast('Describe the problem', 'error'); return null; }

    const receivedRaw = m.root.querySelector('#j-received').value;
    const promisedRaw = m.root.querySelector('#j-promised').value;
    return {
      customerId,
      customerName: m.root.querySelector('#j-name').value.trim() || customerName,
      phone: m.root.querySelector('#j-phone').value.trim(),
      instrument,
      issue,
      estimate: num(m.root.querySelector('#j-estimate').value, 0),
      advance: num(m.root.querySelector('#j-advance').value, 0),
      receivedAt: receivedRaw ? +new Date(receivedRaw) : Date.now(),
      promisedAt: promisedRaw ? +new Date(promisedRaw) : null,
      status: m.root.querySelector('#j-status').value,
      partsCharge: num(m.root.querySelector('#j-parts').value, 0),
      laborCharge: num(m.root.querySelector('#j-labor').value, 0),
      partsCost: num(m.root.querySelector('#j-partscost').value, 0),
      note: m.root.querySelector('#j-note').value.trim(),
      updatedAt: Date.now()
    };
  };

  const save = () => {
    const data = collect();
    if (!data) return null;
    if (j) {
      const record = { ...j, ...data };
      dbSet(`repairs/${j.id}`, record);
      return record;
    }
    const jobNo = `JOB-${String(state.repairs.length + 1).padStart(4, '0')}-${String(Date.now()).slice(-4)}`;
    return dbPush('repairs', { ...data, jobNo, createdAt: Date.now(), byName: state.profile?.name || '' });
  };

  m.root.querySelector('[data-save]').onclick = () => {
    if (save()) { toast('Repair job saved', 'success'); m.close(); }
  };

  const checkout = m.root.querySelector('[data-checkout]');
  if (checkout) checkout.onclick = async () => {
    const record = save();
    if (!record) return;
    m.close();
    await chargeJob(record);
  };

  const del = m.root.querySelector('[data-del]');
  if (del) del.onclick = async () => {
    if (await confirmDialog('Delete this repair job?')) {
      dbDelete(`repairs/${j.id}`);
      toast('Job deleted', 'info');
      m.close();
    }
  };
}

/** Push the job's charges into the register as custom lines. */
async function chargeJob(job) {
  const { cart, addCustomLine, renderCart } = await import('./pos.js');
  const total = jobTotal(job);
  if (total <= 0) return toast('Set a parts or labour charge first', 'warn');

  if (cart.lines.length && !(await confirmDialog('Add this repair to the current cart?', { okText: 'Add', danger: false }))) return;

  if (num(job.laborCharge) > 0) {
    addCustomLine({ name: `Repair labour — ${job.instrument} (${job.jobNo})`, price: num(job.laborCharge) });
  }
  if (num(job.partsCharge) > 0) {
    addCustomLine({
      name: `Repair parts — ${job.instrument} (${job.jobNo})`,
      price: num(job.partsCharge),
      cost: num(job.partsCost)
    });
  }
  if (num(job.advance) > 0) {
    addCustomLine({ name: `Less advance paid (${job.jobNo})`, price: -num(job.advance) });
  }

  cart.customerId = job.customerId || null;
  cart.customerName = job.customerName || '';
  cart.note = `Repair ${job.jobNo}`;
  renderCart();

  dbSet(`repairs/${job.id}/status`, 'delivered');
  dbSet(`repairs/${job.id}/deliveredAt`, Date.now());

  document.querySelector('[data-tab="pos"]')?.click();
  toast('Repair added to cart — take payment now', 'success', 3500);
}

/* --------------------------------------------------------------- detail */

function showJob(id) {
  const j = state.repairs.find(r => r.id === id);
  if (!j) return;
  const meta = statusMeta(j.status);

  const m = openModal({
    title: `${j.jobNo} · ${j.instrument}`,
    body: `
      <p class="mb"><span class="badge ${meta.badge}">${esc(meta.label)}</span></p>
      <div class="card">
        <div class="small">
          <b>${esc(j.customerName || 'Walk-in')}</b>${j.phone ? ` · ${esc(j.phone)}` : ''}<br>
          Received ${fmtDate(j.receivedAt)}${j.promisedAt ? ` · promised ${fmtDate(j.promisedAt)}` : ''}
        </div>
      </div>
      <h4 class="mb">Reported problem</h4>
      <p class="small mb">${esc(j.issue || '—')}</p>
      ${j.note ? `<h4 class="mb">Work done</h4><p class="small mb">${esc(j.note)}</p>` : ''}
      <div class="totals">
        ${num(j.estimate) ? `<div class="totals__row"><span>Estimate</span><span>${money(j.estimate)}</span></div>` : ''}
        <div class="totals__row"><span>Parts</span><span>${money(j.partsCharge)}</span></div>
        <div class="totals__row"><span>Labour</span><span>${money(j.laborCharge)}</span></div>
        ${num(j.advance) ? `<div class="totals__row"><span>Advance paid</span><span>-${money(j.advance)}</span></div>` : ''}
        <div class="totals__row totals__row--grand"><span>Balance</span><span>${money(jobTotal(j) - num(j.advance))}</span></div>
      </div>
      <div class="chips mt" id="job-status-quick">
        ${STATUSES.filter(s => s.id !== j.status).map(s => `<button class="chip" data-set="${s.id}">→ ${esc(s.label)}</button>`).join('')}
      </div>`,
    footer: `
      ${j.phone ? `<a class="btn btn--ghost" href="tel:${esc(j.phone)}">Call</a>` : ''}
      <button class="btn btn--ghost" data-edit>Edit</button>
      ${j.status !== 'delivered' ? '<button class="btn btn--green" data-charge>Charge</button>' : ''}`
  });

  m.root.querySelector('#job-status-quick').addEventListener('click', e => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    dbSet(`repairs/${j.id}/status`, b.dataset.set);
    dbSet(`repairs/${j.id}/updatedAt`, Date.now());
    toast(`Marked ${statusMeta(b.dataset.set).label.toLowerCase()}`, 'success');
    m.close();
  });

  m.root.querySelector('[data-edit]').onclick = () => { m.close(); editJob(id); };
  const charge = m.root.querySelector('[data-charge]');
  if (charge) charge.onclick = () => { m.close(); chargeJob(j); };
}

/* --------------------------------------------------------------- mount */

export function mountRepairs() {
  $('#rep-job-add').onclick = () => editJob(null);

  $('#repairs-filter').addEventListener('click', e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    filter = b.dataset.status;
    $('#repairs-filter').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    render();
  });

  $('#repairs-list').addEventListener('click', e => {
    const b = e.target.closest('[data-job]');
    if (b) showJob(b.dataset.job);
  });

  on('repairs', render);
  render();
}
