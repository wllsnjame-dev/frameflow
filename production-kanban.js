(function () {
  if (window.frameflowProductionKanbanLoaded) return;
  window.frameflowProductionKanbanLoaded = true;

  const stages = ['Order Received', 'Profile Cutting', 'Frame Assembly', 'Glass Fitting', 'Quality Control (QC)', 'Ready for Dispatch'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const read = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const save = (db) => {
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
    window.prodStore = db;
  };
  const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function stageFor(status) {
    const value = String(status || '').toLowerCase();
    if (value.includes('cut')) return stages[1];
    if (value.includes('weld') || value.includes('assembl')) return stages[2];
    if (value.includes('glaz') || value.includes('glass')) return stages[3];
    if (value.includes('quality') || value === 'qc') return stages[4];
    if (value.includes('ready') || value.includes('dispatch') || value === 'completed') return stages[5];
    return stages[0];
  }

  function ensureJobs(db) {
    ['orders', 'quotes', 'production', 'productionStatusHistory', 'productionMaterialsUsed', 'materialTransactions', 'stockItems', 'stockMovements'].forEach((key) => {
      if (!Array.isArray(db[key])) db[key] = [];
    });
    let changed = false;
    db.orders.filter((order) => String(order.status || '').toLowerCase() === 'confirmed').forEach((order) => {
      const orderNumber = order.number || order.orderNumber;
      if (!orderNumber || db.production.some((job) => (job.orderNumber || job.order_number) === orderNumber)) return;
      const quote = db.quotes.find((item) => item.number === order.quoteNumber);
      const now = new Date().toISOString();
      db.production.push({
        id: id('JOB'), jobNumber: `PROD-${new Date().getFullYear()}-${String(db.production.length + 1).padStart(4, '0')}`,
        orderNumber, customer: order.customer || quote?.customer || '', requiredDate: order.requiredDate || order.requiredDeliveryDate || '',
        priority: order.priority || 'Normal', items: JSON.parse(JSON.stringify(order.items || order.orderItems || quote?.items || [])),
        materialsUsed: [], materialTransactions: [], stage: stages[0], status: stages[0],
        statusHistory: [{ previous: '', next: stages[0], at: now, user: 'FrameFlow' }], qc: {}, createdAt: now
      });
      changed = true;
    });
    return changed;
  }

  function basisAmount(item, basis) {
    const width = Number(item.width ?? item.widthMm ?? item.width_mm) || 0;
    const height = Number(item.height ?? item.heightMm ?? item.height_mm) || 0;
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (basis === 'per-unit') return quantity;
    if (basis === 'perimeter-m') return 2 * (width + height) / 1000 * quantity;
    if (basis === 'area-m2') return width * height / 1000000 * quantity;
    return 0;
  }

  function consume(db, job) {
    if (job.inventoryDeduction?.transactionId) return { ok: true };
    if ((job.materialTransactions || []).some((transaction) => transaction.status === 'Committed')) {
      job.inventoryDeduction = { transactionId: `PROD-CONSUME:${job.jobNumber || job.orderNumber}`, skippedBecauseMaterialsAlreadyCommitted: true };
      return { ok: true };
    }
    const rules = db.stockItems.filter((item) => item.isActive !== false && Number(item.consumptionRate) > 0 && item.consumptionBasis && item.consumptionBasis !== 'none');
    if (!rules.length) return { ok: false, message: 'Configure a usage basis and rate for at least one stock item before starting production.' };
    const requirements = rules.map((stockItem) => ({
      stockItem,
      quantity: (job.items || []).reduce((sum, item) => sum + basisAmount(item, stockItem.consumptionBasis), 0) * Number(stockItem.consumptionRate)
    })).filter((entry) => entry.quantity > 0.000001);
    if (!requirements.length) return { ok: false, message: 'The order has no usable dimensions or quantities for the configured stock rules.' };
    const shortage = requirements.filter(({ stockItem, quantity }) => quantity > Number(stockItem.quantity || 0));
    if (shortage.length) return { ok: false, message: `Insufficient stock: ${shortage.map(({ stockItem, quantity }) => `${stockItem.name} needs ${quantity.toFixed(3)} ${stockItem.unit || 'units'}; ${Number(stockItem.quantity || 0).toFixed(3)} available`).join('; ')}.` };

    const now = new Date().toISOString();
    const transactionId = `PROD-CONSUME:${job.jobNumber || job.orderNumber}`;
    job.materialsUsed = Array.isArray(job.materialsUsed) ? job.materialsUsed : [];
    job.materialTransactions = Array.isArray(job.materialTransactions) ? job.materialTransactions : [];
    requirements.forEach(({ stockItem, quantity }) => {
      const previous = Number(stockItem.quantity) || 0;
      const next = Number(Math.max(0, previous - quantity).toFixed(3));
      const used = Number(quantity.toFixed(3));
      stockItem.quantity = next;
      stockItem.updatedAt = now;
      const stockCode = stockItem.stockCode || stockItem.sku || '';
      const itemName = stockItem.name || '';
      db.stockMovements.push({ id: id('MOV'), transactionId, stockCode, itemName, movementType: 'Production Usage', type: 'Production Usage', quantity: used, previousQuantity: previous, newQuantity: next, reference: job.jobNumber || job.orderNumber, reason: 'Automatic production material consumption', productionJobId: job.id || job.jobNumber, orderNumber: job.orderNumber, createdAt: now, user: 'FrameFlow' });
      const record = { id: id('MAT'), transactionId, productionJobId: job.id || job.jobNumber, orderId: job.orderNumber, stockItemId: stockItem.id || null, stockCode, name: itemName, quantity: used, unit: stockItem.unit || 'Units', usedAt: now, lineCost: used * (Number(stockItem.unitCost) || 0) };
      job.materialsUsed.push(record);
      db.productionMaterialsUsed.push(record);
    });
    const transaction = { id: id('TX'), transactionKey: transactionId, jobNumber: job.jobNumber, orderNumber: job.orderNumber, totalCost: requirements.reduce((sum, entry) => sum + entry.quantity * (Number(entry.stockItem.unitCost) || 0), 0), createdAt: now, status: 'Committed' };
    job.materialTransactions.push(transaction);
    db.materialTransactions.push(transaction);
    job.inventoryDeduction = { transactionId, deductedAt: now };
    return { ok: true };
  }

  function cutList(job) {
    const items = job.items || [];
    if (!items.length) return '<p class="ff-empty">No order dimensions are available for this job.</p>';
    return `<table class="ff-cut-list"><thead><tr><th>Product</th><th>Profile cut list (mm)</th><th>Glass (mm)</th><th>Qty</th></tr></thead><tbody>${items.map((item) => {
      const width = Number(item.width ?? item.widthMm ?? item.width_mm) || 0;
      const height = Number(item.height ?? item.heightMm ?? item.height_mm) || 0;
      const qty = Math.max(0, Number(item.quantity) || 0);
      return `<tr><td>${esc(item.type || item.productType || item.product_type || 'Window / Door')}</td><td>${width && height ? `2 × ${width} + 2 × ${height} mm / unit` : 'Dimensions missing'}</td><td>${width && height ? `${width} × ${height} mm / unit` : 'Dimensions missing'}</td><td>${qty}</td></tr>`;
    }).join('')}</tbody></table><p class="ff-cut-note">Cut lengths use the ordered sizes. Apply factory-approved fabrication allowances where required.</p>`;
  }

  function addStyles() {
    if (document.getElementById('ffProductionStyle')) return;
    const style = document.createElement('style');
    style.id = 'ffProductionStyle';
    style.textContent = '.ff-kanban-wrap{margin:18px 0 24px}.ff-board-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.ff-board-head h2{font-size:21px;margin:3px 0}.ff-kicker{font:700 10px Arial,sans-serif;text-transform:uppercase;color:#087f78}.ff-kanban{display:grid;grid-template-columns:repeat(6,minmax(220px,1fr));gap:10px;overflow-x:auto;padding:2px 2px 12px}.ff-stage{background:#edf2ee;border:1px solid #d9e2dc;border-radius:6px;min-height:170px;padding:10px}.ff-stage h3{font:700 12px Arial,sans-serif;margin:0 0 10px;min-height:30px}.ff-job{background:#fff;border:1px solid #dfe5df;border-left:3px solid #087f78;border-radius:4px;padding:10px;margin-bottom:8px}.ff-job strong,.ff-job small{display:block}.ff-job small{color:#657271;margin-top:4px}.ff-job details{margin-top:8px;font-size:11px}.ff-job summary{cursor:pointer;font-weight:700}.ff-advance{margin-top:8px;padding:6px 8px;background:#087f78;color:#fff;border-radius:4px;font-size:11px}.ff-empty{color:#788481;font-size:12px}.ff-cut-list{width:100%;border-collapse:collapse;margin-top:7px}.ff-cut-list th,.ff-cut-list td{padding:5px;border-bottom:1px solid #e5ebe6;text-align:left}.ff-cut-note{font-size:10px;color:#66716f}.ff-stock-warning{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 16px;padding:12px 14px;border-radius:5px;font:12px Arial,sans-serif;background:#fff0e8;border:1px solid #e99a70;color:#7e3218}.ff-stock-clear{display:flex;gap:10px;margin:0 0 16px;padding:12px 14px;border-radius:5px;background:#e9f4ed;border:1px solid #b7d1bf;color:#245b38;font:12px Arial,sans-serif}.ff-stock-badge{display:inline-block;margin-left:6px;padding:3px 6px;border-radius:3px;background:#b84320;color:#fff;font:700 10px Arial,sans-serif;white-space:nowrap}@media(max-width:700px){.ff-kanban{grid-template-columns:repeat(6,minmax(235px,1fr))}.ff-board-head{align-items:flex-start;gap:10px;flex-wrap:wrap}}';
    document.head.appendChild(style);
  }

  function ensureBoard() {
    if (!document.querySelector('#list') || document.getElementById('ffKanban')) return;
    addStyles();
    const board = document.createElement('section');
    board.id = 'ffKanban';
    board.className = 'ff-kanban-wrap';
    board.innerHTML = '<div class="ff-board-head"><div><span class="ff-kicker">Workshop flow</span><h2>Production Kanban</h2></div><button type="button" class="secondary" data-refresh>Refresh confirmed orders</button></div><div class="ff-kanban" aria-label="Production stages"></div>';
    const metrics = $('#list .metrics');
    if (metrics) metrics.insertAdjacentElement('afterend', board);
  }

  function renderBoard() {
    const host = $('#ffKanban .ff-kanban');
    if (!host) return;
    const db = read();
    if (ensureJobs(db)) save(db);
    host.innerHTML = stages.map((stage) => {
      const jobs = db.production.filter((job) => stageFor(job.stage || job.status) === stage);
      return `<section class="ff-stage" data-stage="${esc(stage)}"><h3>${esc(stage)} <span>(${jobs.length})</span></h3>${jobs.map((job) => {
        const index = db.production.indexOf(job);
        const next = stages[Math.min(stages.indexOf(stage) + 1, stages.length - 1)];
        return `<article class="ff-job" draggable="true" data-job-index="${index}"><strong>${esc(job.jobNumber || 'Production job')}</strong><small>${esc(job.orderNumber || 'No order')} · ${esc(job.customer || '')}</small><small>${(job.items || []).map((item) => `${Number(item.quantity) || 0} × ${esc(item.type || item.productType || 'Window / Door')}`).join(', ') || 'No order items'}</small><details><summary>Millimeter cut list</summary>${cutList(job)}</details>${stage !== stages[5] ? `<button type="button" class="ff-advance" data-advance="${index}" data-next="${esc(next)}">Move to ${esc(next)}</button>` : ''}</article>`;
      }).join('') || '<p class="ff-empty">No jobs in this stage.</p>'}</section>`;
    }).join('');
  }

  function transition(index, nextStage) {
    const db = read();
    const job = db.production?.[Number(index)];
    if (!job || !stages.includes(nextStage)) return;
    const previous = stageFor(job.stage || job.status);
    if (previous === nextStage) return;
    if (nextStage === stages[1]) {
      const result = consume(db, job);
      if (!result.ok) return alert(result.message);
    }
    const at = new Date().toISOString();
    job.stage = nextStage;
    job.status = nextStage;
    job.statusHistory = Array.isArray(job.statusHistory) ? job.statusHistory : [];
    job.statusHistory.push({ previous, next: nextStage, at, user: 'FrameFlow' });
    db.productionStatusHistory.push({ id: id('HIST'), productionJobId: job.id || job.jobNumber, jobNumber: job.jobNumber, previousStatus: previous, newStatus: nextStage, changedAt: at, changedBy: 'FrameFlow' });
    save(db);
    renderBoard();
  }

  function startProduction() {
    if (!document.querySelector('#list')) return;
    ensureBoard();
    renderBoard();
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-refresh]')) renderBoard();
      const button = event.target.closest('[data-advance]');
      if (button) transition(button.dataset.advance, button.dataset.next);
    });
    const board = $('#ffKanban .ff-kanban');
    board?.addEventListener('dragstart', (event) => {
      const card = event.target.closest('[data-job-index]');
      if (card) event.dataTransfer.setData('text/plain', card.dataset.jobIndex);
    });
    board?.addEventListener('dragover', (event) => { if (event.target.closest('.ff-stage')) event.preventDefault(); });
    board?.addEventListener('drop', (event) => {
      const lane = event.target.closest('.ff-stage');
      if (!lane) return;
      event.preventDefault();
      transition(event.dataTransfer.getData('text/plain'), lane.dataset.stage);
    });
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') renderBoard(); });
  }

  function addStockControls() {
    const form = document.getElementById('itemForm');
    const grid = form?.querySelector('.form-grid');
    if (!grid || form.querySelector('[name="consumptionBasis"]')) return;
    const basis = document.createElement('label');
    basis.className = 'field';
    basis.innerHTML = '<span>Automatic usage basis</span><select name="consumptionBasis"><option value="none">Not auto-consumed</option><option value="per-unit">Per finished unit</option><option value="perimeter-m">Per product perimeter (m)</option><option value="area-m2">Per product area (m²)</option></select>';
    const rate = document.createElement('label');
    rate.className = 'field';
    rate.innerHTML = '<span>Stock units per basis unit</span><input name="consumptionRate" type="number" min="0" step="0.001" value="0"><small>Set a rate for profile, glass, hardware or gasket usage.</small>';
    grid.append(basis, rate);
      const stockCode = form.elements.stockCode?.value;
      const item = read().stockItems?.find((entry) => (entry.stockCode || entry.sku) === stockCode);
      form.elements.consumptionBasis.value = item?.consumptionBasis || 'none';
      form.elements.consumptionRate.value = item?.consumptionRate ?? 0;
  }

  function updateWarnings() {
    const db = read();
    const items = (db.stockItems || []).filter((item) => item.isActive !== false);
    const low = items.filter((item) => Number(item.quantity || 0) > 0 && Number(item.quantity || 0) <= Number(item.minimum ?? item.minimumStockLevel ?? 0));
    const out = items.filter((item) => Number(item.quantity || 0) <= 0);
    const heading = $('.content')?.querySelector('.heading');
    if (!heading) return;
    let box = document.getElementById('ffStockWarning');
    if (!box) {
      box = document.createElement('aside');
      box.id = 'ffStockWarning';
      box.setAttribute('role', 'status');
      heading.insertAdjacentElement('afterend', box);
    }
    box.className = low.length || out.length ? 'ff-stock-warning' : 'ff-stock-clear';
    box.innerHTML = low.length || out.length
      ? `<strong>LOW STOCK WARNING</strong><span>${low.length} low-stock · ${out.length} out of stock</span><span>${[...out, ...low].slice(0, 8).map((item) => `${esc(item.name)} (${Number(item.quantity || 0)} ${esc(item.unit || 'units')})`).join(' · ')}</span>`
      : '<strong>Stock levels healthy</strong><span>No active items are below their minimum level.</span>';
    document.querySelectorAll('.content tbody tr').forEach((row) => {
        const cell = [...row.querySelectorAll('td')].find((entry) => entry.textContent.trim() === 'Low Stock');
        if (cell && !cell.querySelector('.ff-stock-badge')) cell.insertAdjacentHTML('beforeend', '<span class="ff-stock-badge">LOW STOCK WARNING</span>');
    });
  }

  function startStock() {
    if (!document.getElementById('add') || !document.querySelector('#items')) return;
    const modal = document.getElementById('modal');
    if (modal) new MutationObserver(addStockControls).observe(modal, { childList: true, subtree: true });
    document.addEventListener('click', (event) => {
      if (event.target.closest('#add, [data-edit]')) setTimeout(addStockControls, 0);
      if (event.target.closest('#add, [data-edit], [data-stock-in], [data-stock-out], [data-adjust]')) setTimeout(updateWarnings, 0);
    });
    const table = document.querySelector('#items');
    if (table) new MutationObserver(updateWarnings).observe(table, { childList: true, subtree: true });
    window.addEventListener('storage', (event) => {
      if (event.key !== 'frameflow') return;
      updateWarnings();
      if (typeof window.refresh === 'function') window.refresh();
    });
    updateWarnings();
  }

  window.frameflowProductionKanban = {
    stages: stages.slice(),
    transition(identifier, nextStage) {
      const db = read();
      const index = (db.production || []).findIndex((job) => [job.id, job.jobNumber, job.orderNumber].some((value) => String(value || '') === String(identifier || '')));
      if (index < 0) return false;
      transition(index, nextStage);
      return true;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { startProduction(); startStock(); });
  else { startProduction(); startStock(); }
})();
