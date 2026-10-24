(function () {
  function boot() {
    if (!window.frameflow) return;
    const number = new URLSearchParams(location.search).get('number');
    const db = window.frameflow.readDb();
    const quote = (db.quotes || []).find((entry) => entry.number === number);
    const content = document.querySelector('.content');
    if (!content || !quote) return;
    const style = document.createElement('style');
    style.textContent = '#signatureCanvas{display:block;width:min(620px,100%);height:auto;background:#fff;border:1px dashed #087f78;border-radius:8px;touch-action:none}.signature-layout{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:18px}.signature-image{max-width:100%;border:1px solid #dfe5df;border-radius:6px}@media(max-width:700px){.signature-layout{grid-template-columns:1fr}}';
    document.head.appendChild(style);
    const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(value) || 0);
    const card = document.createElement('section');
    card.className = 'card no-print';
    card.id = 'quoteApprovalCard';
    card.innerHTML = `<div class="item-head"><div><h2>Customer approval</h2><p class="empty">Capture a signature before approving or rejecting this quotation.</p></div><strong id="approvalStatus">${quote.status || 'Draft'}</strong></div><div class="signature-layout"><div><canvas id="signatureCanvas" width="620" height="190" aria-label="Customer digital signature"></canvas><div class="actions"><button class="secondary" id="clearSignature" type="button">Clear</button><button class="secondary" id="rejectQuote" type="button">Reject quotation</button><button class="primary" id="approveQuote" type="button">Approve with signature</button></div></div><div id="signaturePreview"></div></div><div class="actions"><button class="primary" id="convertOrder" type="button">Convert approved quotation to order</button></div><p id="approvalMessage" class="empty"></p>`;
    content.appendChild(card);
    const canvas = document.getElementById('signatureCanvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let drawing = false;
    context.strokeStyle = '#18242b'; context.lineWidth = 2; context.lineCap = 'round';
    function point(event) { const rect = canvas.getBoundingClientRect(); const source = event.touches?.[0] || event; return { x: (source.clientX - rect.left) * canvas.width / rect.width, y: (source.clientY - rect.top) * canvas.height / rect.height }; }
    function start(event) { drawing = true; context.beginPath(); const p = point(event); context.moveTo(p.x, p.y); event.preventDefault(); }
    function draw(event) { if (!drawing) return; const p = point(event); context.lineTo(p.x, p.y); context.stroke(); event.preventDefault(); }
    function stop() { drawing = false; }
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', draw); canvas.addEventListener('mouseup', stop); canvas.addEventListener('mouseleave', stop); canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false }); canvas.addEventListener('touchend', stop);
    function hasInk() { const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) return true; return false; }
    function preview() { document.getElementById('signaturePreview').innerHTML = quote.signatureImage ? `<p class="empty">Saved signature</p><img class="signature-image" src="${quote.signatureImage}" alt="Saved customer signature">` : ''; document.getElementById('approvalStatus').textContent = quote.status || 'Draft'; }
    function saveQuote(status, image) { quote.status = status; quote.signatureImage = image || quote.signatureImage || ''; quote.responseAt = new Date().toISOString(); quote.responseDate = quote.responseAt; window.frameflow.saveDb(db); preview(); document.getElementById('approvalMessage').textContent = `Quotation ${quote.number} marked ${status.toLowerCase()}.`; }
    document.getElementById('clearSignature').onclick = () => { context.clearRect(0, 0, canvas.width, canvas.height); };
    document.getElementById('approveQuote').onclick = () => { if (!hasInk() && !quote.signatureImage) return alert('Please capture the customer signature before approving.'); saveQuote('Approved', hasInk() ? canvas.toDataURL('image/png') : quote.signatureImage); };
    document.getElementById('rejectQuote').onclick = () => { if (!confirm('Reject this quotation?')) return; saveQuote('Rejected', ''); };
    document.getElementById('convertOrder').onclick = () => {
      if (quote.status !== 'Approved') return alert('Approve the quotation before converting it to an order.');
      if (quote.convertedOrderId || quote.orderId || quote.convertedOrderNumber) return alert(`This quotation has already been converted to ${quote.convertedOrderNumber || quote.convertedOrderId}.`);
      const orderId = window.frameflow.makeId();
      const orderNumber = window.frameflow.nextNumber('ORD', db.orders || []);
      const order = { id: orderId, number: orderNumber, customerId: quote.customerId || '', customer: quote.customer || '', project: quote.project || '', quoteId: quote.id || quote.number, quoteNumber: quote.number, items: JSON.parse(JSON.stringify(quote.items || [])), designs: JSON.parse(JSON.stringify(quote.designs || [])), measurements: JSON.parse(JSON.stringify(quote.measurements || [])), subtotal: Number(quote.subtotal || 0), discount: Number(quote.discount || 0), vatRate: Number(quote.vatRate || 0), vat: Number(quote.vat || 0), total: Number(quote.total || 0), notes: quote.terms || '', status: 'New', amountPaid: 0, orderDate: new Date().toISOString().slice(0, 10), statusHistory: [{ previous: '', next: 'New', at: new Date().toISOString(), user: 'Alex Morgan' }] };
      db.orders = Array.isArray(db.orders) ? db.orders : []; db.orders.push(order); quote.convertedOrderId = orderId; quote.convertedOrderNumber = orderNumber; quote.convertedAt = new Date().toISOString(); window.frameflow.saveDb(db); document.getElementById('approvalMessage').textContent = `Order ${orderNumber} created from ${quote.number}.`; document.getElementById('convertOrder').disabled = true;
    };
    if (quote.signatureImage) { const image = new Image(); image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height); image.src = quote.signatureImage; }
    preview();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
