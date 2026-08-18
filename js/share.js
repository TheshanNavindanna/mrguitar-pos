// WhatsApp delivery: build a PDF receipt, upload it, open WhatsApp on the number.
//
// WhatsApp's deep link can carry a recipient and text only — there is no way to
// attach a file to a specific number from a web page. So the PDF is uploaded to
// Firebase Storage and its link goes into the message; the customer taps once.
import { state } from './store.js';
import { money, num, fmtDate, fmtTime, toast } from './util.js';
import { receiptModel, itemsSummary, methodLabel } from './receipt.js';

/* ------------------------------------------------------------ phone number */

/**
 * Normalise a locally-typed number into the international digits WhatsApp wants.
 * "077 123 4567" / "+94771234567" / "0094771234567" -> "94771234567"
 */
export function normalizePhone(raw, countryCode = state.settings.countryCode || '94') {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  const cc = String(countryCode).replace(/\D/g, '') || '94';

  if (d.startsWith('0')) d = cc + d.slice(1);
  else if (!d.startsWith(cc) && d.length <= 10) d = cc + d;
  return d;
}

export function isValidPhone(raw) {
  const d = normalizePhone(raw);
  return d.length >= 10 && d.length <= 15;
}

/** "94771234567" -> "+94 77 123 4567" for display. */
export function prettyPhone(raw) {
  const d = normalizePhone(raw);
  if (!d) return '';
  const cc = String(state.settings.countryCode || '94').replace(/\D/g, '');
  const rest = d.startsWith(cc) ? d.slice(cc.length) : d;
  return `+${cc} ${rest.replace(/(\d{2})(\d{3})(\d+)/, '$1 $2 $3')}`.trim();
}

/* -------------------------------------------------------------------- PDF */

let pdfLibPromise = null;

function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
      .then(mod => mod.jsPDF || mod.default?.jsPDF || mod.default);
  }
  return pdfLibPromise;
}

/** Flatten the receipt model into printable instructions. */
function pdfLines(sale) {
  const m = receiptModel(sale);
  const out = [];
  const push = (type, a, b) => out.push({ type, a, b });

  if (m.logo) push('logo', m.logo);
  push('title', m.header[0]);
  m.subHeader.forEach(l => push('center', l));
  push('hr');
  m.meta.forEach(([k, v]) => push('kv', k, v));
  push('hr');

  m.items.forEach(i => {
    if (m.layout === 'compact') {
      push('kv', i.compact, money(i.lineTotal));
    } else {
      push('left', i.name + (i.sku ? `  [${i.sku}]` : ''));
      push('kv', '  ' + i.qtyLine, money(i.qty * i.unitPrice));
      if (i.discount > 0) push('kv', '  less discount', '-' + money(i.discount));
      if (m.layout === 'detailed') push('kv', '', money(i.lineTotal));
    }
  });

  push('hr');
  m.totals.forEach(([k, v]) => push('kv', k, v));
  push('grand', m.grand[0], m.grand[1]);
  if (m.payments.length) {
    push('hr');
    m.payments.forEach(([k, v]) => push('kv', k, v));
  }
  if (m.note) { push('hr'); push('left', 'Note: ' + m.note); }
  push('hr');
  m.footer.forEach(l => push('center', l));

  return { model: m, lines: out };
}

/**
 * Build the receipt as a PDF Blob. Thermal receipts get a continuous 80mm page
 * sized to the content; A5 gets a normal sheet.
 */
export async function buildReceiptPdf(sale) {
  const JsPDF = await loadPdfLib();
  const { model, lines } = pdfLines(sale);

  const wide = model.wide;
  const pageW = wide ? 148 : 80;              // mm
  const margin = wide ? 12 : 5;
  const contentW = pageW - margin * 2;
  const font = wide ? 'helvetica' : 'courier';
  const size = wide ? 10 : 8;
  const lh = wide ? 5 : 3.6;

  // Measure first so the thermal page is exactly as tall as the receipt.
  const probe = new JsPDF({ unit: 'mm', format: [pageW, 200] });
  probe.setFont(font, 'normal');
  probe.setFontSize(size);

  let rows = 0;
  lines.forEach(l => {
    if (l.type === 'hr') { rows += 0.7; return; }
    if (l.type === 'logo') { rows += 6; return; }
    if (l.type === 'title') { rows += 2; return; }
    const text = l.type === 'kv' ? `${l.a} ${l.b}` : String(l.a ?? '');
    rows += probe.splitTextToSize(text, contentW).length;
  });

  const pageH = wide ? 210 : Math.max(80, margin * 2 + rows * lh + 8);
  const doc = new JsPDF({ unit: 'mm', format: wide ? 'a5' : [pageW, pageH] });
  doc.setFont(font, 'normal');
  doc.setFontSize(size);

  let y = margin;
  const right = pageW - margin;

  for (const l of lines) {
    switch (l.type) {
      case 'logo':
        try {
          doc.addImage(l.a, 'PNG', pageW / 2 - 12, y, 24, 0);
          y += 20;
        } catch { /* bad image — skip it rather than lose the receipt */ }
        break;

      case 'title':
        doc.setFont(font, 'bold');
        doc.setFontSize(size + 4);
        doc.text(String(l.a), pageW / 2, y + lh, { align: 'center' });
        doc.setFontSize(size);
        doc.setFont(font, 'normal');
        y += lh * 2;
        break;

      case 'center':
        doc.splitTextToSize(String(l.a), contentW).forEach(t => {
          doc.text(t, pageW / 2, y + lh, { align: 'center' });
          y += lh;
        });
        break;

      case 'hr':
        doc.setLineDashPattern([0.6, 0.6], 0);
        doc.line(margin, y + lh * 0.4, right, y + lh * 0.4);
        doc.setLineDashPattern([], 0);
        y += lh * 0.7;
        break;

      case 'grand':
        doc.setFont(font, 'bold');
        doc.setFontSize(size + 2);
        doc.text(String(l.a), margin, y + lh);
        doc.text(String(l.b), right, y + lh, { align: 'right' });
        doc.setFontSize(size);
        doc.setFont(font, 'normal');
        y += lh * 1.6;
        break;

      case 'kv': {
        const value = String(l.b ?? '');
        const valueW = doc.getTextWidth(value);
        const labelLines = doc.splitTextToSize(String(l.a ?? ''), contentW - valueW - 2);
        labelLines.forEach((t, idx) => {
          doc.text(t, margin, y + lh);
          if (idx === labelLines.length - 1) doc.text(value, right, y + lh, { align: 'right' });
          y += lh;
        });
        break;
      }

      default:
        doc.splitTextToSize(String(l.a ?? ''), contentW).forEach(t => {
          doc.text(t, margin, y + lh);
          y += lh;
        });
    }
  }

  return doc.output('blob');
}

/** Download the PDF to this device (works with no internet). */
export async function downloadReceiptPdf(sale) {
  const blob = await buildReceiptPdf(sale);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sale.invoiceNo || 'receipt'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- upload */

/** Upload the PDF and return a public download link, or null if that isn't possible. */
export async function uploadReceiptPdf(sale) {
  if (!state.online) return null;
  const { loadStorage } = await import('./firebase.js');
  const { storage, sRef, uploadBytes, getDownloadURL } = await loadStorage();

  const blob = await buildReceiptPdf(sale);
  const year = new Date(num(sale.timestamp) || Date.now()).getFullYear();
  const safeName = String(sale.invoiceNo || sale.id || Date.now()).replace(/[^A-Za-z0-9_-]/g, '');
  const fileRef = sRef(storage, `receipts/${year}/${safeName}.pdf`);

  await uploadBytes(fileRef, blob, {
    contentType: 'application/pdf',
    cacheControl: 'public, max-age=31536000'
  });
  return getDownloadURL(fileRef);
}

/* -------------------------------------------------------------- message */

/** Fill the configurable WhatsApp template. */
export function buildWhatsAppMessage(sale, link) {
  const s = state.settings;
  const m = receiptModel(sale);
  const template = s.whatsappTemplate || '{shop}\nInvoice {invoice}\nTotal: {currency} {total}\n{link}';

  const values = {
    shop: s.shopName || 'Mr. Guitar',
    branch: s.branch || '',
    customer: sale.customerName || 'there',
    invoice: sale.invoiceNo || '',
    date: `${fmtDate(sale.timestamp)} ${fmtTime(sale.timestamp)}`,
    items: itemsSummary(sale),
    total: money(sale.total),
    currency: m.currency,
    paid: money(sale.paid),
    due: money(sale.due),
    method: (sale.payments || []).map(p => methodLabel(p.method)).join(', '),
    phone: s.phone || '',
    link: link ? `Your receipt (PDF): ${link}` : '',
    footer: s.receiptFooter || ''
  };

  return template
    .replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build the wa.me URL. An empty number opens WhatsApp's contact picker. */
export function whatsappUrl(phone, text) {
  const digits = normalizePhone(phone);
  const encoded = encodeURIComponent(text);
  return digits
    ? `https://wa.me/${digits}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

/**
 * Open WhatsApp. Popup blockers only allow window.open inside a user gesture, so
 * fall back to a same-tab navigation, which is never blocked.
 */
export function openWhatsApp(url) {
  const win = window.open(url, '_blank', 'noopener');
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------- main entry */

/**
 * Send a receipt to the sale's WhatsApp number.
 * Falls back to a text-only message whenever the PDF cannot be produced or
 * uploaded — the sale is already saved, so this must never hard-fail.
 */
export async function sendReceiptToWhatsApp(sale, { button, status, phone } = {}) {
  const s = state.settings;
  let number = phone || sale.whatsapp || '';

  if (!number) {
    const { promptDialog } = await import('./util.js');
    const entered = await promptDialog({
      title: 'Send receipt on WhatsApp',
      label: 'Customer WhatsApp number',
      value: sale.customerPhone || '',
      type: 'tel',
      okText: 'Send',
      hint: `Local or international format. Country code ${s.countryCode || '94'} is added automatically.`
    });
    if (entered === null) return null;
    number = entered.trim();
    if (number && !isValidPhone(number)) {
      toast('That does not look like a valid number', 'error');
      return null;
    }
  }

  const setStatus = msg => { if (status) status.textContent = msg; };
  const busy = on => {
    if (!button) return;
    button.disabled = on;
    button.textContent = on ? 'Preparing…' : 'WhatsApp';
  };

  busy(true);
  let link = null;

  if (s.whatsappAttachPdf !== false) {
    if (!state.online) {
      setStatus('Offline — sending the receipt as text only.');
    } else {
      try {
        setStatus('Building the PDF…');
        link = await uploadReceiptPdf(sale);
        setStatus('PDF ready.');
      } catch (err) {
        console.warn('Receipt PDF upload failed', err);
        setStatus('Could not upload the PDF — sending as text instead.');
      }
    }
  }

  const message = buildWhatsAppMessage(sale, link);
  const url = whatsappUrl(number, message);

  busy(false);
  openWhatsApp(url);

  if (link) {
    // Remember it so re-sending from history does not rebuild the PDF.
    try {
      const { dbSet } = await import('./store.js');
      dbSet(`sales/${sale.id}/receiptUrl`, link);
      sale.receiptUrl = link;
    } catch { /* not important enough to surface */ }
  }

  toast(number ? `Opening WhatsApp for ${prettyPhone(number)}` : 'Opening WhatsApp', 'success');
  return { link, url, number };
}
