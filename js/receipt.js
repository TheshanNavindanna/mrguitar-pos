// Receipt rendering, printing and sharing.
// One model, three consumers: the HTML preview, the printer, and the PDF builder.
import { state } from './store.js';
import { esc, money, num, fmtDate, fmtTime, openModal, toast, $ } from './util.js';

const METHOD_LABEL = {
  cash: 'Cash', card: 'Card', bank: 'Bank transfer', credit: 'On credit', cheque: 'Cheque'
};

export const methodLabel = m => METHOD_LABEL[m] || m;

/* ----------------------------------------------------------------- model */

/**
 * Turn a sale into the plain structure a receipt is made of, honouring the
 * template settings. Both the HTML and the PDF render from this, so they can
 * never drift apart.
 */
export function receiptModel(sale) {
  const s = state.settings;
  const cur = s.currency || 'LKR';
  const layout = s.receiptLayout || 'classic';

  const header = [s.shopName || 'Mr. Guitar'];
  const subHeader = [];
  if (s.branch) subHeader.push(s.branch);
  if (s.address) subHeader.push(s.address);
  if (s.phone) subHeader.push('Tel: ' + s.phone);
  if (s.receiptHeaderNote) {
    String(s.receiptHeaderNote).split('\n').forEach(l => l.trim() && subHeader.push(l.trim()));
  }

  const meta = [['Invoice', sale.invoiceNo || '—']];
  meta.push(['Date', `${fmtDate(sale.timestamp)} ${fmtTime(sale.timestamp)}`]);
  if (s.receiptShowCashier !== false && (sale.cashierName || sale.cashierEmail)) {
    meta.push(['Served by', sale.cashierName || sale.cashierEmail]);
  }
  if (s.receiptShowCustomer !== false && sale.customerName) {
    meta.push(['Customer', sale.customerName]);
  }

  const items = (sale.lines || []).map(l => {
    const showSku = s.receiptShowSku !== false && l.sku;
    return {
      name: l.name,
      sku: showSku ? l.sku : '',
      qty: l.qty,
      unitPrice: num(l.unitPrice),
      discount: num(l.discount),
      lineTotal: num(l.lineTotal),
      // "2 × 32,000.00"
      qtyLine: `${l.qty} × ${money(l.unitPrice)}`,
      compact: `${l.qty}× ${l.name}`
    };
  });

  const totals = [];
  totals.push(['Subtotal', money(sale.subtotal)]);
  if (num(sale.itemDiscount) > 0) totals.push(['Item discounts', '-' + money(sale.itemDiscount)]);
  if (num(sale.discount) > 0) totals.push(['Discount', '-' + money(sale.discount)]);
  if (num(sale.tax) > 0) totals.push([`Tax (${sale.taxPercent}%)`, money(sale.tax)]);

  const grand = [`TOTAL (${cur})`, money(sale.total)];

  const payments = (sale.payments || []).map(p => [
    methodLabel(p.method) + (p.ref ? ` (${p.ref})` : ''),
    money(p.amount)
  ]);
  if (num(sale.change) > 0) payments.push(['Change', money(sale.change)]);
  if (num(sale.due) > 0) payments.push(['Balance due', money(sale.due)]);

  const saved = num(sale.discount) + num(sale.itemDiscount);
  const footer = [];
  if (s.receiptShowSavings !== false && saved > 0) footer.push(`You saved ${cur} ${money(saved)}`);
  if (sale.status === 'refunded') footer.push('*** REFUNDED ***');
  if (sale.status === 'partial-refund') footer.push('*** PARTIALLY REFUNDED ***');
  if (s.receiptFooter) footer.push(s.receiptFooter);

  return {
    layout,
    currency: cur,
    logo: s.receiptLogo || '',
    header, subHeader, meta, items, totals, grand, payments, footer,
    note: sale.note || '',
    wide: s.receiptWidth === 'a5'
  };
}

/* ------------------------------------------------------------------ HTML */

const row = (label, value, cls = '') =>
  `<tr class="${cls}"><td>${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;

function itemsHTML(m) {
  if (m.layout === 'compact') {
    return m.items.map(i => `
      <tr>
        <td>${esc(i.compact)}</td>
        <td class="r">${money(i.lineTotal)}</td>
      </tr>`).join('');
  }

  if (m.layout === 'detailed') {
    return m.items.map(i => `
      <tr><td colspan="2"><b>${esc(i.name)}</b></td></tr>
      ${i.sku ? `<tr><td colspan="2" style="padding-left:8px">SKU ${esc(i.sku)}</td></tr>` : ''}
      <tr>
        <td style="padding-left:8px">${esc(i.qtyLine)}</td>
        <td class="r">${money(i.qty * i.unitPrice)}</td>
      </tr>
      ${i.discount > 0 ? `<tr><td style="padding-left:8px">discount</td><td class="r">-${money(i.discount)}</td></tr>` : ''}
      <tr><td class="r" colspan="2"><b>${money(i.lineTotal)}</b></td></tr>`).join('');
  }

  // classic
  return m.items.map(i => `
    <tr><td colspan="2">${esc(i.name)}${i.sku ? ` <small>[${esc(i.sku)}]</small>` : ''}</td></tr>
    <tr>
      <td style="padding-left:8px">${esc(i.qtyLine)}</td>
      <td class="r">${money(i.lineTotal)}</td>
    </tr>
    ${i.discount > 0 ? `<tr><td style="padding-left:8px">less discount</td><td class="r">-${money(i.discount)}</td></tr>` : ''}`).join('');
}

/** Printable receipt HTML for a sale. */
export function receiptHTML(sale, { copyLabel = '' } = {}) {
  const m = receiptModel(sale);

  return `
  <div class="receipt ${m.wide ? 'receipt--a5' : ''}">
    ${m.logo ? `<div class="center"><img src="${esc(m.logo)}" alt="" class="receipt__logo"></div>` : ''}
    <h2>${esc(m.header[0])}</h2>
    <div class="center">${m.subHeader.map(l => esc(l)).join('<br>')}</div>
    <hr>
    <table>${m.meta.map(([k, v]) => row(k, v)).join('')}</table>
    <hr>
    <table>${itemsHTML(m)}</table>
    <hr>
    <table>
      ${m.totals.map(([k, v]) => row(k, v)).join('')}
      <tr class="grand"><td>${esc(m.grand[0])}</td><td class="r">${esc(m.grand[1])}</td></tr>
    </table>
    ${m.payments.length ? `<hr><table>${m.payments.map(([k, v]) => row(k, v)).join('')}</table>` : ''}
    ${m.note ? `<hr><div>Note: ${esc(m.note)}</div>` : ''}
    <hr>
    <div class="center">
      ${m.footer.map(l => esc(l)).join('<br>')}
      ${copyLabel ? `<br><b>${esc(copyLabel)}</b>` : ''}
    </div>
  </div>`;
}

/* --------------------------------------------------------------- printing */

export function printReceipt(sale, opts) {
  $('#receipt-print').innerHTML = receiptHTML(sale, opts);
  // Give the browser a tick to lay out before the print dialog blocks.
  setTimeout(() => window.print(), 80);
}

/* ------------------------------------------------------------ plain text */

/** Plain-text receipt — what actually goes into the WhatsApp message. */
export function receiptText(sale) {
  const m = receiptModel(sale);
  const lines = [];
  lines.push(`*${m.header[0]}*`);
  m.subHeader.forEach(l => lines.push(l));
  lines.push('');
  m.meta.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  lines.push('');
  m.items.forEach(i => lines.push(`${i.compact} — ${money(i.lineTotal)}`));
  lines.push('');
  m.totals.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  lines.push(`*TOTAL: ${m.currency} ${m.grand[1]}*`);
  if (m.payments.length) {
    lines.push('');
    m.payments.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  }
  lines.push('');
  m.footer.forEach(l => lines.push(l));
  return lines.filter(l => l !== undefined).join('\n');
}

/** Short item summary used inside the WhatsApp message template. */
export function itemsSummary(sale) {
  return receiptModel(sale).items
    .map(i => `${i.compact} — ${money(i.lineTotal)}`)
    .join('\n');
}

/* ---------------------------------------------------------- receipt sheet */

export function showReceipt(sale, { autoWhatsApp = false } = {}) {
  const hasNumber = !!sale.whatsapp;

  const m = openModal({
    title: `Receipt ${sale.invoiceNo || ''}`,
    size: 'narrow',
    body: `
      <div class="receipt-preview">${receiptHTML(sale)}</div>
      <div id="wa-status" class="hint mt"></div>`,
    footer: `
      <button class="btn btn--ghost" data-print>Print</button>
      <button class="btn btn--ghost" data-share>Share</button>
      <button class="btn btn--green" data-wa>${hasNumber ? 'WhatsApp' : 'WhatsApp…'}</button>`
  });

  m.root.querySelector('[data-print]').onclick = () => printReceipt(sale);
  m.root.querySelector('[data-share]').onclick = () => shareReceipt(sale);

  const waBtn = m.root.querySelector('[data-wa]');
  waBtn.onclick = async () => {
    const { sendReceiptToWhatsApp } = await import('./share.js');
    await sendReceiptToWhatsApp(sale, {
      button: waBtn,
      status: m.root.querySelector('#wa-status')
    });
  };

  // A number was captured at checkout — try to go straight to WhatsApp.
  if (autoWhatsApp && hasNumber) {
    waBtn.focus();
    setTimeout(() => waBtn.click(), 250);
  }

  return m;
}

/* --------------------------------------------------------- generic share */

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
    toast('Receipt copied to clipboard', 'success');
  } catch {
    toast('Could not share on this device', 'error');
  }
}
