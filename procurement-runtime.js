(function () {
  if (window.frameflowProcurement) return;

  const $ = (id) => document.getElementById(id);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(number(value));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const read = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const save = (db) => window.frameflow ? window.frameflow.saveDb(db) : localStorage.setItem('frameflow', JSON.stringify(db));
  const makeId = (prefix) => window.frameflow?.makeId?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let editingPurchaseOrder = null;

  function ensureArrays(db) {
    ['suppliers', 'purchaseOrders', 'goodsReceipts', 'stockItems', 'stockMovements'].forEach((key) => {
      if (!Array.isArray(db[key])) db[key] = [];
    });
    return db;
  }

  function nextNumber(prefix, records) {
    return window.frameflow?.nextNumber?.(prefix, records) || `${prefix}-${new Date().getFullYear()}-${String(records.length + 1).padStart(4, '0')}`;
  }

  function supplierFor(db, id) {
    return db.suppliers.find((supplier) => supplier.id === id) || null;
  }

  function statusOf(order) {
    if (order.status === 'Cancelled') return 'Cancelled';
    const lines = Array.isArray(order.items) ? order.items : [];
    if (lines.length && lines.every((item) => number(item.receivedQuantity) >= number(item.orderedQuantity))) return 'Received';
    if (lines.some((item) => number(item.receivedQuantity) > 0)) return 'Part Received';
    return order.status || 'Draft';
  }

  function totalValue(order) {
    return (order.items || []).reduce((sum, item) => sum + number(item.orderedQuantity) * number(item.unitCost), 0);
  }

  function outstandingValue(order) {
    return (order.items || []).reduce((sum, item) => sum + Math.max(0, number(item.orderedQuantity) - number(item.receivedQuantity)) * number(item.unitCost), 0);
  }

  function renderMetrics(db) {
    const open = db.purchaseOrders.filter((order) => ['Sent', 'Part Received'].includes(statusOf(order)));
    const receiptsThisMonth = db.goodsReceipts.filter((receipt) => {
      const date = new Date(receipt.receivedAt || receipt.createdAt || '');
      const now = new Date();
      return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    });
    const receivedValue = receiptsThisMonth.reduce((sum, receipt) => sum + number(receipt.totalValue), 0);
    const cards = [
      ['Open purchase orders', open.length],
      ['Outstanding PO value', money(open.reduce((sum, order) => sum + outstandingValue(order), 0))],
      ['Receipts this month', receiptsThisMonth.length],
      ['Active suppliers', db.suppliers.filter((supplier) => supplier.isActive !== false).length],
      ['Received value this month', money(receivedValue)]
    ];
    $('metrics').innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function renderSuppliers(db) {
    $('supplierList').innerHTML = db.suppliers.length ? db.suppliers.map((supplier) => `<div class="supplier-row"><strong>${esc(supplier.name)}</strong><span>${esc(supplier.contactName || 'No contact')} · ${esc(supplier.email || supplier.phone || 'No contact details')}</span><span>${esc(supplier.reference || '')}${supplier.isActive === false ? ' · Archived' : ''}</span></div>`).join('') : '<div class="empty">No suppliers saved yet.</div>';
  }

  function renderOrders(db) {
    const query = $('poSearch').value.trim().toLowerCase();
    const statusFilter = $('poStatus').value;
    const filtered = db.purchaseOrders.filter((order) => {
      const supplier = supplierFor(db, order.supplierId);
      const status = statusOf(order);
      const text = [order.number, supplier?.name, ...(order.items || []).flatMap((item) => [item.name, item.stockCode])].join(' ').toLowerCase();
      return (!statusFilter || status === statusFilter) && (!query || text.includes(query));
    }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    $('poCount').textContent = `${filtered.length} purchase order${filtered.length === 1 ? '' : 's'}`;
    $('purchaseOrders').innerHTML = filtered.length ? filtered.map((order) => {
      const supplier = supplierFor(db, order.supplierId);
      const status = statusOf(order);
      const cls = status === 'Draft' ? 'draft' : status === 'Sent' ? 'sent' : status === 'Part Received' ? 'partial' : status === 'Cancelled' ? 'cancelled' : '';
      const canReceive = ['Sent', 'Part Received'].includes(status);
      const canEdit = status === 'Draft';
      return `<tr><td><strong>${esc(order.number)}</strong></td><td>${esc(supplier?.name || order.supplierName || 'Supplier unavailable')}</td><td>${esc(order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : '—')}</td><td>${esc(order.expectedDate || '—')}</td><td>${(order.items || []).length}</td><td>${money(totalValue(order))}</td><td><span class="status ${cls}">${esc(status)}</span></td><td><div class="po-actions">${canEdit ? `<button class="secondary" data-edit-po="${esc(order.id)}">Edit</button><button class="secondary" data-send-po="${esc(order.id)}">Mark sent</button>` : ''}${canReceive ? `<button class="primary" data-receive-po="${esc(order.id)}">Receive goods</button>` : ''}${!['Received', 'Cancelled'].includes(status) ? `<button class="danger" data-cancel-po="${esc(order.id)}">Cancel</button>` : ''}</div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No purchase orders match this filter.</td></tr>';
  }

  function renderReceipts(db) {
    const receipts = db.goodsReceipts.slice().sort((a, b) => String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')));
    $('receiptRows').innerHTML = receipts.length ? receipts.map((receipt) => `<tr><td><strong>${esc(receipt.number)}</strong></td><td>${esc(receipt.purchaseOrderNumber)}</td><td>${esc(receipt.supplierName)}</td><td>${esc(receipt.receivedAt ? new Date(receipt.receivedAt).toLocaleString('en-GB') : '—')}</td><td>${(receipt.items || []).map((item) => `${esc(item.name)} × ${number(item.quantity)}`).join('<br>')}</td><td>${money(receipt.totalValue)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No goods receipts recorded yet.</td></tr>';
  }

  function render() {
    const db = ensureArrays(read());
    renderMetrics(db);
    renderSuppliers(db);
    renderOrders(db);
    renderReceipts(db);
  }

  function lineRow(item = {}) {
    const db = ensureArrays(read());
    const options = db.stockItems.filter((stock) => stock.isActive !== false).map((stock) => `<option value="${esc(stock.id || '')}"${stock.id && stock.id === item.stockItemId ? ' selected' : ''}>${esc(stock.stockCode || stock.sku || 'No code')} · ${esc(stock.name)}</option>`).join('');
    return `<td><select class="line-stock" aria-label="Existing stock item"><option value="">New material…</option>${options}</select><input class="line-name" aria-label="Material name" placeholder="Material name" value="${esc(item.name || '')}"></td><td><input class="line-code" aria-label="Stock code" placeholder="Stock code" value="${esc(item.stockCode || '')}"></td><td><select class="line-category" aria-label="Category"><option>UPVC Profile</option><option>Glass</option><option>Hardware</option><option>Handles</option><option>Hinges</option><option>Locks</option><option>Gaskets</option><option>Reinforcement</option><option>Other</option></select></td><td><input class="line-unit" aria-label="Unit" value="${esc(item.unit || 'Units')}"></td><td><input class="line-quantity" aria-label="Ordered quantity" type="number" min="0.001" step="0.001" value="${item.orderedQuantity ?? ''}"></td><td><input class="line-cost" aria-label="Unit cost" type="number" min="0" step="0.01" value="${item.unitCost ?? ''}"></td><td><button class="remove-line" type="button" aria-label="Remove line">Remove</button></td>`;
  }

  function applyExistingStock(row, stock) {
    if (!stock) return;
    row.querySelector('.line-name').value = stock.name || '';
    row.querySelector('.line-code').value = stock.stockCode || stock.sku || '';
    row.querySelector('.line-category').value = stock.category || 'Other';
    row.querySelector('.line-unit').value = stock.unit || 'Units';
    row.querySelector('.line-cost').value = number(stock.unitCost).toFixed(2);
  }

  function renderSupplierOptions(selectedId = '') {
    const select = $('poForm').elements.supplierId;
    select.innerHTML = '<option value="">Choose supplier…</option>' + ensureArrays(read()).suppliers.filter((supplier) => supplier.isActive !== false).map((supplier) => `<option value="${esc(supplier.id)}"${supplier.id === selectedId ? ' selected' : ''}>${esc(supplier.name)}</option>`).join('');
  }

  function openPurchaseOrder(order = null) {
    const form = $('poForm');
    const db = ensureArrays(read());
    form.reset();
    editingPurchaseOrder = order ? order.id : null;
    $('poModalTitle').textContent = order ? `Edit ${order.number}` : 'Create purchase order';
    form.elements.id.value = order?.id || '';
    renderSupplierOptions(order?.supplierId || '');
    form.elements.expectedDate.value = order?.expectedDate || '';
    form.elements.notes.value = order?.notes || '';
    $('poLines').innerHTML = '';
    (order?.items?.length ? order.items : [{}]).forEach((item) => {
      const row = document.createElement('tr');
      row.className = 'po-line';
      row.innerHTML = lineRow(item);
      const select = row.querySelector('.line-category');
      select.value = item.category || 'UPVC Profile';
      $('poLines').appendChild(row);
      if (item.stockItemId) applyExistingStock(row, db.stockItems.find((stock) => stock.id === item.stockItemId));
    });
    $('poModal').classList.add('show');
  }

  function readLines() {
    return [...document.querySelectorAll('#poLines .po-line')].map((row) => {
      const stock = ensureArrays(read()).stockItems.find((item) => item.id && item.id === row.querySelector('.line-stock').value);
      return {
        stockItemId: stock?.id || '', stockCode: row.querySelector('.line-code').value.trim(),
        name: row.querySelector('.line-name').value.trim(), category: row.querySelector('.line-category').value,
        unit: row.querySelector('.line-unit').value.trim() || 'Units', orderedQuantity: number(row.querySelector('.line-quantity').value),
        receivedQuantity: 0, unitCost: number(row.querySelector('.line-cost').value)
      };
    }).filter((line) => line.name || line.stockCode || line.orderedQuantity > 0);
  }

  function savePurchaseOrder(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const supplier = supplierFor(db, form.elements.supplierId.value);
    const lines = readLines();
    if (!supplier) return alert('Choose a supplier before saving the purchase order.');
    if (!lines.length || lines.some((line) => !line.name || line.orderedQuantity <= 0 || line.unitCost < 0)) return alert('Add at least one material line with a name, positive quantity, and valid cost.');
    const id = form.elements.id.value || makeId('PO');
    const existing = db.purchaseOrders.find((order) => order.id === id);
    if (existing && statusOf(existing) !== 'Draft') return alert('Only draft purchase orders can be edited.');
    const now = new Date().toISOString();
    const record = {
      id, number: existing?.number || nextNumber('PO', db.purchaseOrders), supplierId: supplier.id, supplierName: supplier.name,
      status: existing?.status || 'Draft', expectedDate: form.elements.expectedDate.value, notes: form.elements.notes.value.trim(),
      items: lines.map((line, index) => ({ ...line, id: existing?.items?.[index]?.id || makeId('POLINE') })),
      createdAt: existing?.createdAt || now, updatedAt: now, sentAt: existing?.sentAt || ''
    };
    if (existing) Object.assign(existing, record);
    else db.purchaseOrders.push(record);
    save(db);
    $('poModal').classList.remove('show');
    render();
  }

  function markSent(id) {
    const db = ensureArrays(read());
    const order = db.purchaseOrders.find((item) => item.id === id);
    if (!order || statusOf(order) !== 'Draft') return;
    order.status = 'Sent';
    order.sentAt = new Date().toISOString();
    order.updatedAt = order.sentAt;
    save(db);
    render();
  }

  function cancelOrder(id) {
    const db = ensureArrays(read());
    const order = db.purchaseOrders.find((item) => item.id === id);
    if (!order || ['Received', 'Cancelled'].includes(statusOf(order))) return;
    if (!confirm(`Cancel ${order.number}? Received stock will remain in inventory.`)) return;
    order.status = 'Cancelled';
    order.cancelledAt = new Date().toISOString();
    order.updatedAt = order.cancelledAt;
    save(db);
    render();
  }

  function openReceipt(id) {
    const db = ensureArrays(read());
    const order = db.purchaseOrders.find((item) => item.id === id);
    if (!order || !['Sent', 'Part Received'].includes(statusOf(order))) return;
    $('receiptForm').elements.purchaseOrderId.value = order.id;
    $('receiptForm').elements.receiptId.value = makeId('GR');
    $('receiptTitle').textContent = `Receive goods · ${order.number}`;
    $('receiptMessage').textContent = '';
    $('receiptLines').innerHTML = (order.items || []).map((item, index) => {
      const remaining = Math.max(0, number(item.orderedQuantity) - number(item.receivedQuantity));
      return `<div class="receipt-line"><div><strong>${esc(item.name)}</strong><small>${esc(item.stockCode || 'No stock code')} · ${esc(item.category)} · ${esc(item.unit)}</small></div><div><strong>${number(item.receivedQuantity)} / ${number(item.orderedQuantity)} ${esc(item.unit)}</strong><small>${money(item.unitCost)} per ${esc(item.unit)}</small></div><label>Receive now<input data-receipt-index="${index}" type="number" min="0" max="${remaining}" step="0.001" value="${remaining}" ${remaining === 0 ? 'disabled' : ''}></label></div>`;
    }).join('');
    $('receiptModal').classList.add('show');
  }

  function findStockItem(db, line) {
    return db.stockItems.find((item) => (line.stockItemId && item.id === line.stockItemId) || (line.stockCode && String(item.stockCode || item.sku || '').toLowerCase() === line.stockCode.toLowerCase()) || (!line.stockCode && String(item.name || '').toLowerCase() === line.name.toLowerCase() && String(item.category || '').toLowerCase() === line.category.toLowerCase())) || null;
  }

  function receiveGoods(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const order = db.purchaseOrders.find((item) => item.id === form.elements.purchaseOrderId.value);
    const receiptId = form.elements.receiptId.value;
    if (!order || !['Sent', 'Part Received'].includes(statusOf(order))) return alert('This purchase order is not open for receiving.');
    if (db.goodsReceipts.some((receipt) => receipt.id === receiptId)) {
      $('receiptModal').classList.remove('show');
      render();
      return;
    }
    const quantities = [...document.querySelectorAll('[data-receipt-index]')].map((input) => number(input.value));
    const receivedLines = [];
    let totalValue = 0;
    for (let index = 0; index < order.items.length; index += 1) {
      const line = order.items[index];
      const quantity = quantities[index] || 0;
      const remaining = Math.max(0, number(line.orderedQuantity) - number(line.receivedQuantity));
      if (quantity < 0 || quantity > remaining + 0.000001) return alert(`Received quantity for ${line.name} must be between 0 and ${remaining} ${line.unit}.`);
      if (!quantity) continue;
      const stockItem = findStockItem(db, line);
      const previous = number(stockItem?.quantity);
      const newQuantity = Number((previous + quantity).toFixed(3));
      if (stockItem) {
        const oldValue = previous * number(stockItem.unitCost);
        const receivedCost = quantity * number(line.unitCost);
        stockItem.quantity = newQuantity;
        stockItem.unitCost = newQuantity > 0 ? Number(((oldValue + receivedCost) / newQuantity).toFixed(4)) : number(line.unitCost);
        stockItem.supplierName = order.supplierName || supplierFor(db, order.supplierId)?.name || stockItem.supplierName || '';
        stockItem.updatedAt = new Date().toISOString();
      } else {
        const newStock = {
          id: makeId('STOCK'), stockCode: line.stockCode, name: line.name, category: line.category || 'Other', unit: line.unit || 'Units',
          quantity: newQuantity, minimum: 0, maximum: 0, unitCost: number(line.unitCost), supplierName: order.supplierName || '',
          supplierReference: '', location: '', description: '', isActive: true, updatedAt: new Date().toISOString()
        };
        db.stockItems.push(newStock);
        line.stockItemId = newStock.id;
      }
      line.receivedQuantity = Number((number(line.receivedQuantity) + quantity).toFixed(3));
      totalValue += quantity * number(line.unitCost);
      receivedLines.push({ stockItemId: stockItem?.id || line.stockItemId, stockCode: line.stockCode, name: line.name, category: line.category, unit: line.unit, quantity, unitCost: number(line.unitCost), previousQuantity: previous, newQuantity });
    }
    if (!receivedLines.length) return alert('Enter at least one quantity to receive.');

    const now = new Date().toISOString();
    const receiptNumber = nextNumber('GR', db.goodsReceipts);
    const supplier = supplierFor(db, order.supplierId);
    db.goodsReceipts.push({ id: receiptId, number: receiptNumber, purchaseOrderId: order.id, purchaseOrderNumber: order.number, supplierId: order.supplierId, supplierName: supplier?.name || order.supplierName || '', receivedAt: now, items: receivedLines, totalValue });
    receivedLines.forEach((line) => {
      db.stockMovements.push({
        id: makeId('MOV'), stockItemId: line.stockItemId || '', stockCode: line.stockCode || '', itemName: line.name,
        movementType: 'Stock In', type: 'Stock In', quantity: line.quantity, previousQuantity: line.previousQuantity,
        newQuantity: line.newQuantity, reference: receiptNumber, purchaseOrderNumber: order.number,
        reason: `Goods received against ${order.number}`, supplier: supplier?.name || order.supplierName || '',
        createdAt: now, user: 'FrameFlow'
      });
    });
    order.status = order.items.every((item) => number(item.receivedQuantity) >= number(item.orderedQuantity)) ? 'Received' : 'Part Received';
    order.updatedAt = now;
    order.lastReceiptId = receiptId;
    save(db);
    $('receiptModal').classList.remove('show');
    render();
  }

  function addSupplier(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const name = String(payload.name || '').trim();
    if (!name) return;
    const duplicate = db.suppliers.some((supplier) => supplier.isActive !== false && supplier.name.toLowerCase() === name.toLowerCase());
    if (duplicate) return alert('A supplier with this name already exists.');
    db.suppliers.push({ id: makeId('SUP'), name, contactName: payload.contactName.trim(), email: payload.email.trim(), phone: payload.phone.trim(), address: payload.address.trim(), reference: payload.reference.trim(), isActive: true, createdAt: new Date().toISOString() });
    save(db);
    form.reset();
    render();
  }

  function start() {
    if (!$('purchaseOrders')) return;
    $('supplierForm').addEventListener('submit', addSupplier);
    $('poForm').addEventListener('submit', savePurchaseOrder);
    $('receiptForm').addEventListener('submit', receiveGoods);
    $('newPurchaseOrder').addEventListener('click', () => openPurchaseOrder());
    $('addLine').addEventListener('click', () => {
      const row = document.createElement('tr');
      row.className = 'po-line';
      row.innerHTML = lineRow();
      $('poLines').appendChild(row);
    });
    $('poLines').addEventListener('change', (event) => {
      if (!event.target.matches('.line-stock')) return;
      const db = ensureArrays(read());
      const stock = db.stockItems.find((item) => item.id === event.target.value);
      if (stock) applyExistingStock(event.target.closest('tr'), stock);
    });
    $('poLines').addEventListener('click', (event) => {
      if (event.target.closest('.remove-line')) event.target.closest('tr').remove();
    });
    $('poSearch').addEventListener('input', render);
    $('poStatus').addEventListener('change', render);
    $('printProcurement').addEventListener('click', () => window.print());
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('.modal').classList.remove('show')));
    document.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-po]');
      const send = event.target.closest('[data-send-po]');
      const receive = event.target.closest('[data-receive-po]');
      const cancel = event.target.closest('[data-cancel-po]');
      const db = ensureArrays(read());
      if (edit) openPurchaseOrder(db.purchaseOrders.find((order) => order.id === edit.dataset.editPo));
      if (send) markSent(send.dataset.sendPo);
      if (receive) openReceipt(receive.dataset.receivePo);
      if (cancel) cancelOrder(cancel.dataset.cancelPo);
    });
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.frameflowProcurement = { render, statusOf, receiveGoods, nextNumber };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
