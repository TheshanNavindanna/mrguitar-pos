// Receipt rendering + printing. Shared by checkout and by reprint from sales history.
import { state } from './store.js';
import { esc, money, fmtDate, fmtTime, openModal, $ } from './util.js';

const line = (label, value, cls = '') =>
  `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;

/** Build the printable receipt HTML for a sale record. */
export function receiptHTML(sale, { copyLabel = '' } = {}) {
  const s = state.settings;
  const cur = s.currency || 'LKR';
  const wide = s.receiptWidth === 'a5';

  const items = (sale.lines || []).map(l => {
    const disc = l.discount > 0
      ? `<tr><td colspan="2" style="padding-left:8px">less discount</td><td class="r">-${money(l.discount)}</td></tr>`
      : '';
    return `
      <tr>
        <td colspan="3">${esc(l.name)}${l.sku ? ` <small>[${esc(l.sku)}]</small>` : ''}</td>
      </tr>
      <tr>
        <td style="padding-left:8px">${l.qty} × ${money(l.unitPrice)}</td>
        <td></td>
        <td class="r">${money(l.lineTotal)}</td>
      </tr>${disc}`;
  }).join('');

  const payments = (sale.payments || [])
    .map(p => line(labelFor(p.method) + (p.ref ? ` (${p.ref})` : ''), money(p.amount)))
    .join('');

  return `
  <div class="receipt ${wide ? 'receipt--a5' : ''}">
    <h2>${esc(s.shopName || 'Mr. Guitar')}</h2>
    <div class="center">
      ${s.branch ? esc(s.branch) + '<br>' : ''}
      ${s.address ? esc(s.address) + '<br>' : ''}
      ${s.phone ? 'Tel: ' + esc(s.phone) : ''}
    </div>
    <hr>
    <table>
      ${line('Invoice', sale.invoiceNo || '—')}
      ${line('Date', `${fmtDate(sale.timestamp)} ${fmtTime(sale.timestamp)}`)}
      ${line('Served by', sale.cashierName || sale.cashierEmail || '—')}
      ${sale.customerName ? line('Customer', sale.customerName) : ''}
    </table>
    <hr>
    <table>${items}</table>
    <hr>
    <table>
      ${line('Subtotal', money(sale.subtotal))}
      ${sale.itemDiscount > 0 ? line('Item discounts', '-' + money(sale.itemDiscount)) : ''}
      ${sale.discount > 0 ? line('Discount', '-' + money(sale.discount)) : ''}
      ${sale.tax > 0 ? line(`Tax (${sale.taxPercent}%)`, money(sale.tax)) : ''}
      <tr class="grand"><td>TOTAL (${esc(cur)})</td><td class="r">${money(sale.total)}</td></tr>
    </table>
    <hr>
    <table>
      ${payments}
      ${sale.change > 0 ? line('Change', money(sale.change)) : ''}
    </table>
    ${sale.note ? `<hr><div>Note: ${esc(sale.note)}</div>` : ''}
    ${sale.status === 'refunded' ? '<hr><div class="center"><b>*** REFUNDED ***</b></div>' : ''}
    ${sale.status === 'partial-refund' ? '<hr><div class="center"><b>*** PARTIALLY REFUNDED ***</b></div>' : ''}
    <hr>
    <div class="center">
      ${esc(s.receiptFooter || 'Thank you!')}
      ${copyLabel ? `<br><b>${esc(copyLabel)}</b>` : ''}
    </div>
  </div>`;
}

function labelFor(method) {
  return {
    cash: 'Cash',
    card: 'Card',
    bank: 'Bank transfer',
    credit: 'On credit',
    cheque: 'Cheque'
  }[method] || method;
}

/** Send a sale straight to the printer (thermal or A5, per settings). */
export function printReceipt(sale, opts) {
  const holder = $('#receipt-print');
  holder.innerHTML = receiptHTML(sale, opts);
  // Give the browser a tick to lay out before the print dialog blocks.
  setTimeout(() => {
    window.print();
  }, 80);
}

/** Preview sheet with print / share actions. */
export function showReceipt(sale) {
  const m = openModal({
    title: `Receipt ${sale.invoiceNo || ''}`,
    size: 'narrow',
    body: `<div class="receipt-preview">${receiptHTML(sale)}</div>`,
    footer: `
      <button class="btn btn--ghost" data-share>Share</button>
      <button class="btn" data-print>Print</button>`
  });
  m.root.querySelector('[data-print]').onclick = () => printReceipt(sale);
  m.root.querySelector('[data-share]').onclick = () => shareReceipt(sale);
  return m;
}

/** Plain-text receipt — good for WhatsApp, which most SL customers prefer. */
export function receiptText(sale) {
  const s = state.settings;
  const cur = s.currency || 'LKR';
  const rows = (sale.lines || [])
    .map(l => `${l.qty} x ${l.name} = ${money(l.lineTotal)}`)
    .join('\n');
  return [
    `*${s.shopName || 'Mr. Guitar'}*${s.branch ? ' - ' + s.branch : ''}`,
    `Invoice: ${sale.invoiceNo}`,
    `${fmtDate(sale.timestamp)} ${fmtTime(sale.timestamp)}`,
    sale.customerName ? `Customer: ${sale.customerName}` : '',
    '',
    rows,
    '',
    sale.discount > 0 ? `Discount: -${money(sale.discount)}` : '',
    sale.tax > 0 ? `Tax: ${money(sale.tax)}` : '',
    `*TOTAL: ${cur} ${money(sale.total)}*`,
    '',
    s.receiptFooter || 'Thank you!'
  ].filter(Boolean).join('\n');
}

export async function shareReceipt(sale) {
  const text = receiptText(sale);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Receipt ${sale.invoiceNo}`, text });
      return;
    } catch { /* user cancelled — fall through to clipboard */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    const { toast } = await import('./util.js');
    toast('Receipt copied to clipboard', 'success');
  } catch {
    const { toast } = await import('./util.js');
    toast('Could not share on this device', 'error');
  }
}
