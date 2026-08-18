// Business reporting: KPIs, daily chart, top sellers, payment mix, staff mix.
import { state, on, salesBetween, isManager } from './store.js';
import {
  $, esc, money, num, int, r2, toast, rangeFor, dateKey, fmtDate,
  toCSV, downloadCSV
} from './util.js';

let range = 'month';
let customFrom = '';
let customTo = '';

const METHOD_LABEL = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', credit: 'On credit', cheque: 'Cheque' };

function bounds() {
  return rangeFor(range, customFrom, customTo);
}

/** Everything the report screen needs, computed once. */
export function buildReport() {
  const { from, to } = bounds();
  const sales = salesBetween(from, to);
  const expenses = state.expenses.filter(e => num(e.timestamp) >= from && num(e.timestamp) <= to);
  const returns = state.returns.filter(r => num(r.timestamp) >= from && num(r.timestamp) <= to);

  const revenue = r2(sales.reduce((s, x) => s + num(x.total) - num(x.refundedAmount), 0));
  const tax = r2(sales.reduce((s, x) => s + num(x.tax), 0));
  const cost = r2(sales.reduce((s, x) => s + num(x.cost), 0) - returns.reduce((s, x) => s + num(x.cost), 0));
  const grossProfit = r2(sales.reduce((s, x) => s + num(x.profit) - num(x.refundedProfit), 0));
  const expenseTotal = r2(expenses.reduce((s, x) => s + num(x.amount), 0));
  const netProfit = r2(grossProfit - expenseTotal);
  const refunded = r2(returns.reduce((s, x) => s + num(x.amount), 0));
  const due = r2(sales.reduce((s, x) => s + num(x.due), 0));
  const discount = r2(sales.reduce((s, x) => s + num(x.discount) + num(x.itemDiscount), 0));

  const itemsSold = sales.reduce((s, x) =>
    s + (x.lines || []).reduce((n, l) => n + int(l.qty, 0) - int(l.returnedQty, 0), 0), 0);

  // Top items by revenue
  const byItem = new Map();
  sales.forEach(s => (s.lines || []).forEach(l => {
    const qty = int(l.qty, 0) - int(l.returnedQty, 0);
    if (qty <= 0) return;
    const key = l.itemId || l.name;
    const cur = byItem.get(key) || { name: l.name, qty: 0, revenue: 0, profit: 0 };
    const unitNet = num(l.lineTotal) / Math.max(1, int(l.qty, 1));
    cur.qty += qty;
    cur.revenue += r2(unitNet * qty);
    cur.profit += r2((unitNet - num(l.buyPrice)) * qty);
    byItem.set(key, cur);
  }));
  const topItems = [...byItem.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Payment mix
  const byMethod = new Map();
  sales.forEach(s => (s.payments || []).forEach(p => {
    byMethod.set(p.method, r2((byMethod.get(p.method) || 0) + num(p.amount)));
  }));

  // Staff mix
  const byStaff = new Map();
  sales.forEach(s => {
    const key = s.cashierName || s.cashierEmail || 'Unknown';
    const cur = byStaff.get(key) || { count: 0, revenue: 0 };
    cur.count++;
    cur.revenue = r2(cur.revenue + num(s.total) - num(s.refundedAmount));
    byStaff.set(key, cur);
  });

  // Daily series
  const byDay = new Map();
  sales.forEach(s => {
    const k = dateKey(num(s.timestamp));
    byDay.set(k, r2((byDay.get(k) || 0) + num(s.total) - num(s.refundedAmount)));
  });
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-30);

  return {
    from, to, sales, revenue, tax, cost, grossProfit, expenseTotal, netProfit,
    refunded, due, discount, itemsSold, topItems, byMethod, byStaff, days,
    count: sales.length,
    average: sales.length ? r2(revenue / sales.length) : 0
  };
}

/* --------------------------------------------------------------- render */

function renderStats(rep) {
  const manager = isManager();
  $('#rep-stats').innerHTML = `
    <div class="stat stat--amber"><b>${money(rep.revenue, 0)}</b><span>Revenue</span></div>
    ${manager ? `<div class="stat stat--green"><b>${money(rep.grossProfit, 0)}</b><span>Gross profit</span></div>` : ''}
    ${manager ? `<div class="stat stat--red"><b>${money(rep.expenseTotal, 0)}</b><span>Expenses</span></div>` : ''}
    ${manager ? `<div class="stat ${rep.netProfit >= 0 ? 'stat--green' : 'stat--red'}"><b>${money(rep.netProfit, 0)}</b><span>Net profit</span></div>` : ''}
    <div class="stat"><b>${rep.count}</b><span>Sales</span></div>
    <div class="stat"><b>${rep.itemsSold}</b><span>Items sold</span></div>
    <div class="stat"><b>${money(rep.average, 0)}</b><span>Avg sale</span></div>
    <div class="stat ${rep.due > 0 ? 'stat--red' : ''}"><b>${money(rep.due, 0)}</b><span>Unpaid</span></div>
    ${rep.refunded > 0 ? `<div class="stat stat--red"><b>${money(rep.refunded, 0)}</b><span>Refunded</span></div>` : ''}
    ${rep.discount > 0 ? `<div class="stat"><b>${money(rep.discount, 0)}</b><span>Discounts given</span></div>` : ''}`;
}

function renderChart(rep) {
  const box = $('#rep-chart');
  if (!rep.days.length) {
    box.innerHTML = '<div class="empty" style="width:100%">No sales in this period</div>';
    return;
  }
  const max = Math.max(...rep.days.map(d => d[1]), 1);
  box.innerHTML = rep.days.map(([day, value]) => {
    const pct = Math.max(2, Math.round((value / max) * 100));
    const label = day.slice(8) + '/' + day.slice(5, 7);
    return `<div class="bars__col" title="${esc(label)}: ${money(value)}">
      <div class="bars__bar" style="height:${pct}%"></div>
      <div class="bars__lbl">${esc(label)}</div>
    </div>`;
  }).join('');
}

function renderTables(rep) {
  const manager = isManager();

  $('#rep-top').innerHTML = rep.topItems.length
    ? rep.topItems.map(i => `
        <tr>
          <td>${esc(i.name)}<br><span class="tiny muted">${i.qty} sold</span></td>
          <td class="right nowrap">${money(i.revenue)}
            ${manager ? `<br><span class="tiny text-green">+${money(i.profit)}</span>` : ''}</td>
        </tr>`).join('')
    : '<tr><td class="muted">No data</td></tr>';

  const methods = [...rep.byMethod.entries()].sort((a, b) => b[1] - a[1]);
  const methodTotal = methods.reduce((s, m) => s + m[1], 0) || 1;
  $('#rep-methods').innerHTML = methods.length
    ? methods.map(([m, v]) => `
        <tr>
          <td>${esc(METHOD_LABEL[m] || m)}</td>
          <td class="right nowrap">${money(v)}<br><span class="tiny muted">${Math.round(v / methodTotal * 100)}%</span></td>
        </tr>`).join('')
    : '<tr><td class="muted">No data</td></tr>';

  const staff = [...rep.byStaff.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  $('#rep-staff').innerHTML = staff.length
    ? staff.map(([name, v]) => `
        <tr>
          <td>${esc(name)}<br><span class="tiny muted">${v.count} sale${v.count === 1 ? '' : 's'}</span></td>
          <td class="right nowrap">${money(v.revenue)}</td>
        </tr>`).join('')
    : '<tr><td class="muted">No data</td></tr>';
}

export function renderReports() {
  if (!$('#rep-stats')) return;
  const rep = buildReport();
  renderStats(rep);
  renderChart(rep);
  renderTables(rep);
}

/* -------------------------------------------------------------- export */

function exportReport() {
  const rep = buildReport();
  const rows = [
    ['Period', `${fmtDate(rep.from)} to ${fmtDate(rep.to)}`],
    ['Revenue', rep.revenue],
    ['Cost of goods', rep.cost],
    ['Gross profit', rep.grossProfit],
    ['Expenses', rep.expenseTotal],
    ['Net profit', rep.netProfit],
    ['Tax collected', rep.tax],
    ['Discounts given', rep.discount],
    ['Refunds', rep.refunded],
    ['Outstanding (unpaid)', rep.due],
    ['Number of sales', rep.count],
    ['Items sold', rep.itemsSold],
    ['Average sale', rep.average],
    [],
    ['Top items', 'Qty', 'Revenue', 'Profit'],
    ...rep.topItems.map(i => [i.name, i.qty, r2(i.revenue), r2(i.profit)]),
    [],
    ['Payment method', 'Amount'],
    ...[...rep.byMethod.entries()].map(([m, v]) => [METHOD_LABEL[m] || m, v]),
    [],
    ['Staff', 'Sales', 'Revenue'],
    ...[...rep.byStaff.entries()].map(([n, v]) => [n, v.count, v.revenue])
  ];
  const csv = rows.map(r => r.map(c => {
    const s = c === undefined || c === null ? '' : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  downloadCSV(`mrguitar-report-${range}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  toast('Report exported', 'success');
}

/* --------------------------------------------------------------- mount */

export function mountReports() {
  $('#rep-range').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range;
    $('#rep-range').querySelectorAll('.chip').forEach(c => c.classList.toggle('is-active', c === b));
    $('#rep-custom').hidden = range !== 'custom';
    renderReports();
  });

  $('#rep-from').addEventListener('change', e => { customFrom = e.target.value; renderReports(); });
  $('#rep-to').addEventListener('change', e => { customTo = e.target.value; renderReports(); });
  $('#rep-export').onclick = exportReport;

  on('sales', renderReports);
  on('expenses', renderReports);
  on('returns', renderReports);
  renderReports();
}
