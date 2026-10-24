(function () {
  if (window.frameflowReports) return;

  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(number(value));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const dbRead = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const dateText = (value) => value ? String(value).slice(0, 10) : '';

  function rangeStart(value, now = new Date()) {
    if (value === 'all') return null;
    if (value === '365') return new Date(now.getFullYear(), 0, 1);
    const days = Number(value);
    if (!days) return null;
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function inRange(value, start, end = new Date()) {
    if (!value) return true;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return true;
    return (!start || parsed >= start) && parsed <= end;
  }

  function recordDate(record, fallbacks = []) {
    for (const key of ['paymentDate', 'paidAt', 'paid_at', 'usedAt', 'used_at', 'createdAt', 'created_at', 'invoiceDate', 'invoice_date', 'orderDate', 'order_date', 'date', ...fallbacks]) {
      if (record?.[key]) return record[key];
    }
    return '';
  }

  function paymentRecords(invoice, db) {
    const embedded = Array.isArray(invoice.payments) ? invoice.payments : [];
    if (embedded.length) return embedded;
    const identifiers = new Set([invoice.id, invoice.number, invoice.invoiceNumber, invoice.invoice_number].filter(Boolean).map(String));
    const matching = (db.payments || []).filter((payment) => [payment.invoiceId, payment.invoice_id, payment.invoiceNumber, payment.invoice_number].filter(Boolean).some((value) => identifiers.has(String(value))));
    if (matching.length) return matching;
    const paid = number(invoice.amountPaid ?? invoice.amount_paid ?? invoice.paid);
    const total = number(invoice.total);
    const fallback = paid || (/^paid$/i.test(invoice.status || '') ? total : 0);
    return fallback > 0 ? [{ amount: fallback, paymentDate: invoice.paymentDate || invoice.paidAt || invoice.invoiceDate || invoice.date || '' }] : [];
  }

  function invoiceStats(invoice, db) {
    const payments = paymentRecords(invoice, db);
    const paid = payments.reduce((sum, payment) => sum + number(payment.amount), 0);
    const total = number(invoice.total);
    const balance = invoice.balanceDue !== undefined && invoice.balanceDue !== null
      ? Math.max(0, number(invoice.balanceDue))
      : Math.max(0, total - paid);
    return { payments, total, paid, balance };
  }

  function collectedInRange(invoices, db, start, end) {
    return invoices.reduce((sum, invoice) => {
      const payments = paymentRecords(invoice, db);
      return sum + payments.reduce((amount, payment) => {
        const date = recordDate(payment, [invoice.invoiceDate, invoice.invoice_date, invoice.date]);
        return inRange(date, start, end) ? amount + number(payment.amount) : amount;
      }, 0);
    }, 0);
  }

  function orderStatus(status) {
    const value = String(status || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    if (value === 'new' || value === 'pending') return 'New';
    if (value === 'confirmed') return 'Confirmed';
    if (value.includes('production') || ['cutting', 'welding', 'assembly', 'glazing', 'quality check'].includes(value)) return 'In Production';
    if (value === 'completed' || value === 'complete') return 'Completed';
    if (value === 'cancelled' || value === 'canceled') return 'Cancelled';
    return 'Other';
  }

  function jobCompletedDate(job) {
    if (job.completedAt || job.completed_at) return job.completedAt || job.completed_at;
    const history = Array.isArray(job.statusHistory) ? job.statusHistory : [];
    const completed = [...history].reverse().find((entry) => /^(completed|complete)$/i.test(entry.next || entry.newStatus || entry.new_status || ''));
    return completed?.at || completed?.changedAt || completed?.changed_at || job.updatedAt || job.updated_at || job.createdAt || job.created_at || '';
  }

  function stockStatus(item) {
    const quantity = number(item.quantity);
    const minimum = number(item.minimum ?? item.minimumStockLevel ?? item.minimum_stock_level);
    return quantity <= 0 ? 'Out of stock' : quantity <= minimum ? 'Low stock' : 'In stock';
  }

  function buildReport(db, range, now = new Date()) {
    const start = rangeStart(range, now);
    const end = now;
    const invoices = db.invoices || [];
    const inRangeInvoices = invoices.filter((invoice) => inRange(recordDate(invoice, ['invoiceDate', 'invoice_date', 'date']), start, end));
    const orders = (db.orders || []).filter((order) => inRange(recordDate(order, ['orderDate', 'order_date']), start, end));
    const jobs = (db.production || []).filter((job) => inRange(recordDate(job, ['scheduledDate', 'scheduled_date']), start, end));
    const stockItems = (db.stockItems || []).filter((item) => item.isActive !== false);
    const usages = (db.productionMaterialsUsed || []).filter((record) => inRange(recordDate(record, ['usedAt', 'used_at']), start, end));
    const invoiceTotals = inRangeInvoices.map((invoice) => ({ invoice, ...invoiceStats(invoice, db) }));
    const outstandingInvoices = invoiceTotals.filter((entry) => entry.balance > 0);
    const activeJobs = jobs.filter((job) => !/^(completed|complete|cancelled|canceled)$/i.test(job.status || job.stage || ''));
    const completedJobs = jobs.filter((job) => /^(completed|complete)$/i.test(job.status || job.stage || '') && inRange(jobCompletedDate(job), start, end));
    const orderStatuses = ['New', 'Confirmed', 'In Production', 'Completed', 'Cancelled', 'Other'];
    const statusCounts = Object.fromEntries(orderStatuses.map((status) => [status, 0]));
    orders.forEach((order) => { statusCounts[orderStatus(order.status)] += 1; });

    const stockByKey = new Map();
    stockItems.forEach((item) => {
      const key = String(item.id || item.stockCode || item.sku || item.name || 'stock-item');
      stockByKey.set(key, item);
      if (item.stockCode || item.sku) stockByKey.set(String(item.stockCode || item.sku), item);
    });
    const materialGroups = new Map();
    usages.forEach((record) => {
      const stockItem = stockByKey.get(String(record.stockItemId || record.stock_item_id || record.stockCode || record.stock_code || record.sku || ''));
      const name = record.name || record.itemName || record.item_name || stockItem?.name || 'Uncatalogued material';
      const code = record.stockCode || record.stock_code || record.sku || stockItem?.stockCode || stockItem?.sku || '';
      const unit = record.unit || stockItem?.unit || 'units';
      const key = `${record.stockItemId || record.stock_item_id || code || name}|${unit}`;
      const group = materialGroups.get(key) || { name, code, unit, quantity: 0, value: 0, stockItem };
      const quantity = number(record.quantity);
      group.quantity += quantity;
      group.value += record.lineCost !== undefined ? number(record.lineCost) : quantity * number(record.unitCost ?? stockItem?.unitCost);
      group.stockItem = stockItem || group.stockItem;
      materialGroups.set(key, group);
    });

    const months = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push({ key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, label: date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), value: 0 });
    }
    const monthByKey = new Map(months.map((month) => [month.key, month]));
    invoices.forEach((invoice) => {
      paymentRecords(invoice, db).forEach((payment) => {
        const date = recordDate(payment, [invoice.invoiceDate, invoice.invoice_date, invoice.date]);
        if (!inRange(date, start, end)) return;
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) return;
        const month = monthByKey.get(`${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`);
        if (month) month.value += number(payment.amount);
      });
    });

    return {
      invoices: invoiceTotals,
      outstandingInvoices,
      orders,
      jobs,
      stockItems,
      usages: [...materialGroups.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity),
      months,
      statusCounts,
      paidRevenue: collectedInRange(invoices, db, start, end),
      outstanding: outstandingInvoices.reduce((sum, entry) => sum + entry.balance, 0),
      stockValue: stockItems.reduce((sum, item) => sum + number(item.quantity) * number(item.unitCost), 0),
      activeJobs,
      completedJobs,
      end
    };
  }

  function rowOrEmpty(rows, colspan, message) {
    return rows.length ? rows.join('') : `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
  }

  function render() {
    const db = dbRead();
    const report = buildReport(db, $('rangeFilter').value);
    const maxMonth = Math.max(1, ...report.months.map((month) => month.value));
    const invoiceLabel = (invoice) => invoice.number || invoice.invoiceNumber || invoice.invoice_number || '—';
    const invoicePaid = (entry) => entry.paid;

    $('metrics').innerHTML = [
      ['Collected revenue', money(report.paidRevenue)],
      ['Outstanding balance', money(report.outstanding)],
      ['Orders in period', report.orders.length],
      ['Active production jobs', report.activeJobs.length],
      ['Completed jobs', report.completedJobs.length],
      ['Current stock value', money(report.stockValue)]
    ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');

    const rangeName = $('rangeFilter').selectedOptions[0]?.textContent || 'All time';
    $('reportNote').textContent = `Period: ${rangeName}. Collected revenue is based on recorded payment amounts; legacy paid totals without payment dates use the invoice date.`;
    $('monthlyRows').innerHTML = rowOrEmpty(report.months.map((month) => `<tr><td>${escapeHtml(month.label)}</td><td>${money(month.value)}</td><td><div class="report-bar"><i style="width:${Math.min(100, month.value / maxMonth * 100)}%"></i></div></td></tr>`), 3, 'No paid revenue recorded in this period.');

    const statusTotal = report.orders.length || 1;
    $('orderStatusRows').innerHTML = Object.entries(report.statusCounts).map(([status, count]) => `<tr><td>${escapeHtml(status)}</td><td>${count}</td><td>${(count / statusTotal * 100).toFixed(1)}%</td></tr>`).join('');
    $('productionMetrics').innerHTML = [
      ['Jobs in period', report.jobs.length],
      ['Active jobs', report.activeJobs.length],
      ['Throughput', report.completedJobs.length],
      ['Quality control', report.jobs.filter((job) => /quality|\bqc\b/i.test(job.status || job.stage || '')).length]
    ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');

    $('salesRows').innerHTML = rowOrEmpty(report.invoices.map((entry) => `<tr><td>${escapeHtml(invoiceLabel(entry.invoice))}</td><td>${escapeHtml(entry.invoice.customer || '—')}</td><td>${escapeHtml(entry.invoice.orderNumber || entry.invoice.order || '—')}</td><td>${escapeHtml(entry.invoice.invoiceDate || entry.invoice.invoice_date || entry.invoice.date || '—')}</td><td>${money(entry.total)}</td><td>${money(invoicePaid(entry))}</td><td>${money(entry.balance)}</td></tr>`), 7, 'No invoice data in this period.');
    $('outstandingRows').innerHTML = rowOrEmpty(report.outstandingInvoices.map((entry) => `<tr><td>${escapeHtml(invoiceLabel(entry.invoice))}</td><td>${escapeHtml(entry.invoice.customer || '—')}</td><td>${money(entry.total)}</td><td>${money(entry.paid)}</td><td>${money(entry.balance)}</td><td>${escapeHtml(entry.invoice.status || (entry.paid > 0 ? 'Part paid' : 'Unpaid'))}</td></tr>`), 6, 'No outstanding invoices.');
    $('productionRows').innerHTML = rowOrEmpty(report.jobs.map((job) => `<tr><td>${escapeHtml(job.jobNumber || job.job_number || job.number || '—')}</td><td>${escapeHtml(job.customer || '—')}</td><td>${escapeHtml(job.orderNumber || job.order_number || '—')}</td><td>${escapeHtml(job.stage || job.status || 'Pending')}</td></tr>`), 4, 'No production data in this period.');

    $('materialRows').innerHTML = rowOrEmpty(report.usages.map((usage) => {
      const item = usage.stockItem;
      const quantity = number(item?.quantity);
      const value = item ? `${quantity} ${escapeHtml(item.unit || usage.unit)}` : 'Not in stock';
      const status = item ? stockStatus(item) : 'Not catalogued';
      return `<tr><td>${escapeHtml(usage.name)}</td><td>${escapeHtml(usage.code || '—')}</td><td>${usage.quantity.toFixed(3)}</td><td>${escapeHtml(usage.unit)}</td><td>${money(usage.value)}</td><td>${value}</td><td>${escapeHtml(status)}</td></tr>`;
    }), 7, 'No production material usage recorded in this period.');

    $('stockRows').innerHTML = rowOrEmpty(report.stockItems.map((item) => `<tr><td>${escapeHtml(item.stockCode || item.sku || '—')}</td><td>${escapeHtml(item.name || '—')}</td><td>${number(item.quantity)} ${escapeHtml(item.unit || '')}</td><td>${money(item.unitCost)}</td><td>${money(number(item.quantity) * number(item.unitCost))}</td><td>${escapeHtml(stockStatus(item))}</td></tr>`), 6, 'No stock data available.');
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const db = dbRead();
    const report = buildReport(db, $('rangeFilter').value);
    const rows = [['FrameFlow factory report'], ['Period', $('rangeFilter').selectedOptions[0]?.textContent || 'All time'], [], ['Financial summary'], ['Metric', 'Amount'], ['Collected revenue', report.paidRevenue.toFixed(2)], ['Outstanding balance', report.outstanding.toFixed(2)], [], ['Monthly collected revenue'], ['Month', 'Revenue'], ...report.months.map((month) => [month.label, month.value.toFixed(2)]), [], ['Order status'], ['Status', 'Count'], ...Object.entries(report.statusCounts), [], ['Production throughput'], ['Metric', 'Count'], ['Jobs in period', report.jobs.length], ['Active jobs', report.activeJobs.length], ['Completed jobs', report.completedJobs.length], [], ['Material consumption'], ['Material', 'Code', 'Quantity', 'Unit', 'Usage value', 'Current stock', 'Stock status'], ...report.usages.map((usage) => [usage.name, usage.code, usage.quantity.toFixed(3), usage.unit, usage.value.toFixed(2), usage.stockItem ? `${number(usage.stockItem.quantity)} ${usage.stockItem.unit || usage.unit}` : 'Not in stock', usage.stockItem ? stockStatus(usage.stockItem) : 'Not catalogued']), [], ['Current stock'], ['Code', 'Item', 'Quantity', 'Unit', 'Unit cost', 'Value', 'Status'], ...report.stockItems.map((item) => [item.stockCode || item.sku, item.name, number(item.quantity), item.unit, number(item.unitCost).toFixed(2), (number(item.quantity) * number(item.unitCost)).toFixed(2), stockStatus(item)])];
    const content = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `frameflow-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function addStyles() {
    if (document.getElementById('reportRuntimeStyles')) return;
    const style = document.createElement('style');
    style.id = 'reportRuntimeStyles';
    style.textContent = '#metrics,.report-submetrics{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.report-submetrics{margin:12px 0 0}.report-note{margin:0 0 16px;color:#687675;font-size:12px}.report-bar{height:8px;background:#e7ece8;border-radius:4px;min-width:100px;overflow:hidden}.report-bar i{display:block;height:100%;background:#087f78;border-radius:4px}.card{break-inside:avoid}.table-wrap{overflow-x:auto}@media print{body{background:#fff}.side,.top,.toolbar,.actions,.report-note{display:none!important}.content{max-width:none;padding:0}.layout{display:block}.card{border:1px solid #ccd5ce;box-shadow:none;margin:0 0 12px;padding:12px}.heading{margin:0 0 12px}.heading h1{font-size:26px}.metrics,.report-submetrics{display:grid;grid-template-columns:repeat(3,1fr)}table{font-size:10px}.metric{box-shadow:none;border:1px solid #dfe5df}}';
    document.head.appendChild(style);
  }

  function start() {
    if (!$('rangeFilter') || !$('metrics')) return;
    addStyles();
    $('rangeFilter').addEventListener('change', render);
    $('printReport').addEventListener('click', () => window.print());
    $('exportReport').addEventListener('click', exportCsv);
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.frameflowReports = { render, buildReport, exportCsv };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
