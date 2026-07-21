// pdfView.js — "Save as PDF" for receipt photos. No PDF library: it builds a
// clean, one-receipt-per-page printable view in the current document and calls
// window.print(), so the user saves it via the browser's own Print → Save as
// PDF (same posture as KennelOS's invoice/puppy-record print docs, and iOS-safe
// because nothing is opened in a popup). Fully offline.
//
// Each page shows the receipt image plus its details (receipt #, date, amount,
// vendor, category, business, subject, notes) — a self-documenting archive for
// tax time. Entries with no photo are skipped.
import { photoRepo } from '../data/photoRepo.js';
import { effectiveAmount } from '../data/entryRepo.js';
import { categoryLabel, subjectTypeLabel } from '../data/vocab.js';
import { esc, fmtMoney, fmtDate, toast } from './ui.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function detailRows(e) {
  const subj = e.subject_type === 'dog'
    ? (e.subject_name || 'Dog')
    : (e.subject_name || 'Kennel');
  const odo = (e.odometer_start != null || e.odometer_end != null)
    ? `${e.odometer_start ?? '?'} → ${e.odometer_end ?? '?'}` : '';
  const rows = [
    ['Receipt #', e.receipt_number],
    ['Date', fmtDate(e.entry_date)],
    ['Amount', fmtMoney(effectiveAmount(e))],
    e.kind === 'trip' ? ['Mileage', `${e.miles ?? '?'} mi × ${fmtMoney(e.mileage_rate)}/mi`] : ['Vendor', e.vendor],
    ...(e.kind === 'trip' ? [['Odometer', odo], ['Vehicle', e.vehicle], ['Driver', e.driver]] : []),
    ['Category', categoryLabel(e.category)],
    ['Attached to', `${subjectTypeLabel(e.subject_type)}${subj ? ` — ${subj}` : ''}`],
    ['Business', e.business],
    ['Notes', e.notes]
  ].filter(([, v]) => v != null && v !== '');
  return rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
}

// Build the print view for the given entries and trigger Print → Save as PDF.
// Options:
//   title   — labels the run (e.g. the business name) in the document header.
//   from/to — the YYYY-MM-DD date range the selection was filtered to (shown on
//             the summary page when set).
//   summary — when true (default), prepend a summary page with the count, date
//             range, and TOTAL of the included receipts. The per-receipt "Save as
//             PDF" passes false (no cover for a single receipt).
export async function printReceiptsPdf(entries, opts = {}) {
  const { title = 'Receipts', from = '', to = '', summary = true } = (typeof opts === 'string') ? { title: opts } : opts;
  const withPhotos = entries.filter((e) => e.photo_id);
  if (!withPhotos.length) { toast('No photos in this selection', 'err'); return; }

  const pages = [];
  for (const e of withPhotos) {
    const p = await photoRepo.get(e.photo_id);
    if (!p?.blob) continue;
    let dataUrl = '';
    try { dataUrl = await blobToDataUrl(p.blob); } catch { continue; }
    pages.push({ e, dataUrl });
  }
  if (!pages.length) { toast('No photos in this selection', 'err'); return; }

  // Total over the receipts actually included in the PDF.
  const total = pages.reduce((sum, { e }) => sum + (effectiveAmount(e) || 0), 0);
  const rangeText = (from || to) ? `${from ? fmtDate(from) : '…'} – ${to ? fmtDate(to) : '…'}` : 'All dates';

  const coverHtml = (summary && pages.length > 1) ? `
    <section class="pdf-page pdf-cover">
      <h1>${esc(title)}</h1>
      <table class="pdf-summary">
        <tr><th>Receipts</th><td>${pages.length}</td></tr>
        <tr><th>Date range</th><td>${esc(rangeText)}</td></tr>
        <tr class="pdf-total"><th>Total</th><td>${esc(fmtMoney(total))}</td></tr>
      </table>
      <p class="pdf-generated">Generated ${esc(fmtDate(new Date().toISOString().slice(0, 10)))}</p>
    </section>` : '';

  const root = document.createElement('div');
  root.className = 'pdf-root';
  root.innerHTML = coverHtml + pages.map(({ e, dataUrl }) => `
    <section class="pdf-page">
      <div class="pdf-head">
        <span class="pdf-title">${esc(title)}</span>
        <span class="pdf-rcpt">${esc(e.receipt_number || '')}</span>
      </div>
      <div class="pdf-imgwrap"><img src="${dataUrl}" alt="receipt"></div>
      <table class="pdf-meta">${detailRows(e)}</table>
    </section>`).join('') + ((summary && pages.length === 1) ? `<p class="pdf-single-total">Total: ${esc(fmtMoney(total))}</p>` : '');

  document.body.appendChild(root);
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Wait for every receipt image to actually finish decoding, then force a
  // layout and let two frames paint, before opening the print dialog. A fixed
  // delay isn't enough headroom on mobile: several full-resolution camera
  // photos as data URLs can take longer than a few ms to decode/paint, and if
  // the print snapshot is taken before that finishes, some mobile browsers
  // (notably Android print-to-PDF) rasterize the still-stale page underneath
  // instead of the newly built document.
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
  void root.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.print();
  // Safety net if afterprint never fires (some mobile browsers).
  setTimeout(cleanup, 120000);
}
