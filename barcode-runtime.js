(function () {
  if (window.frameflowBarcodeTracking) return;

  const fallbackStages = ['Order Received', 'Profile Cutting', 'Frame Assembly', 'Glass Fitting', 'Quality Control (QC)', 'Ready for Dispatch'];
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const read = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const save = (db) => {
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
  };
  const makeId = (prefix) => window.frameflow?.makeId?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let cameraStream = null;
  let detector = null;
  let scanning = false;
  let lastCameraTag = '';

  function normalizeStatus(value) {
    return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  }

  function isActiveOrder(order) {
    return ['new', 'confirmed', 'in production', 'ready', 'delivered', 'installed'].includes(normalizeStatus(order.status));
  }

  function isActiveJob(job) {
    const status = normalizeStatus(job.stage || job.status);
    return !['completed', 'complete', 'cancelled', 'canceled'].includes(status);
  }

  function identifier(value) {
    return String(value || 'UNNUMBERED').trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'UNNUMBERED';
  }

  function uniqueValue(prefix, source, fallback, used) {
    const base = `${prefix}-${identifier(source || fallback)}`;
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${identifier(fallback || 'JOB')}`;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base}-${identifier(fallback || 'JOB')}-${suffix++}`;
    used.add(candidate);
    return candidate;
  }

  function ensureTags(db) {
    ['orders', 'production', 'productionStatusHistory'].forEach((key) => { if (!Array.isArray(db[key])) db[key] = []; });
    let changed = false;
    const usedJobs = new Set();
    db.production.forEach((job, index) => {
      const orderNumber = job.orderNumber || job.order_number;
      const source = job.barcodeValue || job.barcode || `FF-JOB-${identifier(orderNumber || job.jobNumber || job.id)}`;
      let value = String(source).trim().toUpperCase();
      if (!value.startsWith('FF-JOB-')) value = `FF-JOB-${identifier(value)}`;
      if (usedJobs.has(value)) value = uniqueValue('FF-JOB', orderNumber, job.jobNumber || job.id || index + 1, usedJobs);
      else usedJobs.add(value);
      if (job.barcodeValue !== value) { job.barcodeValue = value; changed = true; }
    });
    const usedOrders = new Set();
    db.orders.forEach((order, index) => {
      const source = order.barcodeValue || order.orderTag || `FF-ORD-${identifier(order.number || order.orderNumber || order.id)}`;
      let value = String(source).trim().toUpperCase();
      if (!value.startsWith('FF-ORD-')) value = `FF-ORD-${identifier(value)}`;
      if (usedOrders.has(value)) value = uniqueValue('FF-ORD', order.number || order.orderNumber, order.id || index + 1, usedOrders);
      else usedOrders.add(value);
      if (order.barcodeValue !== value) { order.barcodeValue = value; changed = true; }
    });
    if (changed) save(db);
    return db;
  }

  function jobOrderNumber(job) {
    return job.orderNumber || job.order_number || '';
  }

  function jobForOrder(db, order) {
    const orderNumber = order.number || order.orderNumber || order.order_number;
    return db.production.find((job) => String(jobOrderNumber(job)) === String(orderNumber) || String(job.orderId || job.order_id || '') === String(order.id || ''));
  }

  function findTag(db, rawValue) {
    const value = String(rawValue || '').trim().toUpperCase();
    if (!value) return null;
    const job = db.production.find((item) => [item.barcodeValue, item.barcode].some((tag) => String(tag || '').trim().toUpperCase() === value));
    if (job) return { type: 'job', record: job };
    const order = db.orders.find((item) => String(item.barcodeValue || item.orderTag || '').trim().toUpperCase() === value);
    if (order) {
      const linkedJob = jobForOrder(db, order);
      return linkedJob ? { type: 'job', record: linkedJob } : { type: 'order', record: order };
    }
    const tagOrderNumber = value.startsWith('FF-JOB-') ? value.slice(7) : value.startsWith('FF-ORD-') ? value.slice(7) : '';
    if (tagOrderNumber) {
      const linkedJob = db.production.find((item) => identifier(jobOrderNumber(item)) === identifier(tagOrderNumber) || identifier(item.jobNumber) === identifier(tagOrderNumber));
      if (linkedJob) return { type: 'job', record: linkedJob };
      const order = db.orders.find((item) => identifier(item.number || item.orderNumber || item.order_number) === identifier(tagOrderNumber));
      if (order) return { type: 'order', record: order };
    }
    return null;
  }

  function stageOf(job) {
    const value = String(job.stage || job.status || '').toLowerCase();
    const stages = window.frameflowProductionKanban?.stages || fallbackStages;
    if (value.includes('cut')) return stages[1];
    if (value.includes('weld') || value.includes('assembl')) return stages[2];
    if (value.includes('glaz') || value.includes('glass')) return stages[3];
    if (value.includes('quality') || value === 'qc') return stages[4];
    if (value.includes('ready') || value.includes('dispatch')) return stages[5];
    if (value.includes('complete')) return 'Completed';
    if (value.includes('cancel')) return 'Cancelled';
    return stages[0];
  }

  function dateLabel(value) {
    if (!value) return 'Timestamp unavailable';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-GB');
  }

  function historyFor(job) {
    const history = Array.isArray(job.statusHistory) ? job.statusHistory : [];
    return history.slice(-5).reverse().map((entry) => `<li><span>${esc(entry.previous || 'Created')} → ${esc(entry.next || entry.newStatus || entry.new_status || 'Updated')}</span><time>${esc(dateLabel(entry.at || entry.changedAt || entry.changed_at))}</time></li>`).join('');
  }

  function renderTagGraphics(prefix, index, value) {
    return `<div class="tag-graphics"><div class="qr" id="${prefix}-qr-${index}" data-qr="${esc(value)}"></div><div><div class="tag-text">${esc(value)}</div><svg class="barcode-svg" id="${prefix}-barcode-${index}" data-barcode="${esc(value)}"></svg></div></div>`;
  }

  function drawTags() {
    document.querySelectorAll('[data-qr]').forEach((host) => {
      const value = host.dataset.qr;
      host.replaceChildren();
      if (typeof window.QRCode === 'function') {
        try { new window.QRCode(host, { text: value, width: 112, height: 112, correctLevel: window.QRCode.CorrectLevel?.M }); }
        catch { host.textContent = value; }
      } else host.textContent = 'QR library unavailable';
    });
    document.querySelectorAll('[data-barcode]').forEach((svg) => {
      const value = svg.dataset.barcode;
      if (typeof window.JsBarcode === 'function') {
        try { window.JsBarcode(svg, value, { format: 'CODE128', displayValue: true, fontSize: 11, height: 52, margin: 3, width: 1.5, background: '#ffffff', lineColor: '#18242b' }); }
        catch { svg.replaceWith(document.createTextNode(value)); }
      } else svg.replaceWith(document.createTextNode(value));
    });
  }

  function stageOptions(selected) {
    const stages = window.frameflowProductionKanban?.stages || fallbackStages;
    return stages.map((stage) => `<option value="${esc(stage)}"${stage === selected ? ' selected' : ''}>${esc(stage)}</option>`).join('');
  }

  function render() {
    const db = ensureTags(read());
    const jobs = db.production.filter(isActiveJob);
    const orders = db.orders.filter(isActiveOrder);
    const linkedOrders = new Set(jobs.map((job) => String(jobOrderNumber(job))));
    const cards = jobs.map((job, index) => {
      const orderNumber = jobOrderNumber(job);
      const currentStage = stageOf(job);
      const isTerminal = ['Completed', 'Cancelled'].includes(currentStage);
      return `<article class="job-card"><div class="job-head"><div><h3>${esc(job.jobNumber || orderNumber || 'Production job')}</h3><p>${esc(orderNumber || 'No order reference')} · ${esc(job.customer || '')}</p><span class="tag">${esc(job.barcodeValue)}</span></div><span class="tag">${esc(currentStage)}</span></div>${renderTagGraphics('job', index, job.barcodeValue)}<details><summary>Recent stage history</summary><ul class="stage-history">${historyFor(job) || '<li>No stage changes recorded.</li>'}</ul></details><div class="job-actions"><select aria-label="New production stage" data-stage-select="${esc(job.id || job.jobNumber || orderNumber)}"${isTerminal ? ' disabled' : ''}>${stageOptions(currentStage)}</select><button class="primary" type="button" data-update-job="${esc(job.id || job.jobNumber || orderNumber)}"${isTerminal ? ' disabled' : ''}>Update stage</button><button class="secondary" type="button" data-verify-tag="${esc(job.barcodeValue)}">Verify scan</button></div></article>`;
    }).join('');
    $('metrics').innerHTML = [
      ['Active production jobs', jobs.length],
      ['Active orders', orders.length],
      ['Jobs with tags', jobs.filter((job) => job.barcodeValue).length]
    ].map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('jobCount').textContent = `${jobs.length} active job${jobs.length === 1 ? '' : 's'} · tags are saved on each production record.`;
    $('jobCards').innerHTML = cards || '<div class="empty">No active production jobs. Confirm orders and create jobs in Production to generate job tags.</div>';
    $('orderRows').innerHTML = orders.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Order tag</th><th>Job</th><th>Action</th></tr></thead><tbody>${orders.map((order, index) => {
      const job = jobForOrder(db, order);
      return `<tr><td>${esc(order.number || order.orderNumber || order.order_number || '—')}</td><td>${esc(order.customer || '—')}</td><td>${esc(order.status || 'New')}</td><td><span class="tag">${esc(order.barcodeValue)}</span><div class="qr order-qr" id="order-qr-${index}" data-qr="${esc(order.barcodeValue)}"></div><svg class="barcode-svg order-barcode" id="order-barcode-${index}" data-barcode="${esc(order.barcodeValue)}"></svg></td><td>${esc(job?.jobNumber || 'Not in production')}</td><td><button class="secondary" type="button" data-verify-tag="${esc(order.barcodeValue)}">Verify order</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">No active orders.</div>';
    drawTags();
  }

  function showResult(rawValue) {
    const value = String(rawValue || '').trim();
    const box = $('scanResult');
    if (!value) {
      box.className = 'scan-result is-invalid';
      box.textContent = 'Scan or enter a tag first.';
      return;
    }
    const db = ensureTags(read());
    const match = findTag(db, value);
    if (!match) {
      box.className = 'scan-result is-invalid';
      box.innerHTML = `<strong>Tag not found</strong><div>${esc(value)}</div><p>Refresh jobs or check that the tag belongs to this factory.</p>`;
      return;
    }
    if (match.type === 'order') {
      const order = match.record;
      const linkedJob = jobForOrder(db, order);
      box.className = 'scan-result is-valid';
      box.innerHTML = `<strong>Order verified · ${esc(order.number || order.orderNumber || order.order_number || '')}</strong><div>${esc(order.customer || '')} · ${esc(order.status || 'New')}</div><p>${linkedJob ? `Production job ${esc(linkedJob.jobNumber || '')} · ${esc(stageOf(linkedJob))}` : 'No production job is linked to this order yet.'}</p>`;
      return;
    }
    const job = match.record;
    box.className = 'scan-result is-valid';
    box.innerHTML = `<strong>Job verified · ${esc(job.jobNumber || '')}</strong><div>${esc(jobOrderNumber(job))} · ${esc(job.customer || '')}</div><p>Current stage: ${esc(stageOf(job))}</p><ul class="stage-history">${historyFor(job) || '<li>No stage history recorded.</li>'}</ul>`;
  }

  function updateStage(identifierValue) {
    const select = document.querySelector(`[data-stage-select="${CSS.escape(identifierValue)}"]`);
    const api = window.frameflowProductionKanban;
    if (!select || !api?.transition) {
      $('scanResult').className = 'scan-result is-invalid';
      $('scanResult').textContent = 'The production transition service is unavailable. Reload Production and try again.';
      return;
    }
    const changed = api.transition(identifierValue, select.value);
    if (!changed) {
      $('scanResult').className = 'scan-result is-invalid';
      $('scanResult').textContent = 'Production job not found. Refresh the job list and try again.';
      return;
    }
    render();
    const db = read();
    const job = db.production.find((item) => [item.id, item.jobNumber, jobOrderNumber(item)].some((value) => String(value || '') === String(identifierValue)));
    $('scanInput').value = job?.barcodeValue || '';
    showResult($('scanInput').value);
  }

  async function stopCamera() {
    scanning = false;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    $('camera').srcObject = null;
    $('camera').classList.remove('is-open');
    $('stopCamera').hidden = true;
    $('startCamera').hidden = false;
  }

  async function scanFrame() {
    if (!scanning || !detector || !$('camera').videoWidth) return;
    try {
      const matches = await detector.detect($('camera'));
      if (matches.length && matches[0].rawValue && matches[0].rawValue !== lastCameraTag) {
        lastCameraTag = matches[0].rawValue;
        $('scanInput').value = lastCameraTag;
        showResult(lastCameraTag);
        await stopCamera();
        return;
      }
    } catch { /* Keep scanning until a readable tag is found. */ }
    if (scanning) requestAnimationFrame(scanFrame);
  }

  async function startCamera() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      $('scanResult').className = 'scan-result is-invalid';
      $('scanResult').textContent = 'Camera scanning is not supported here. Use a hardware scanner or enter the printed tag.';
      return;
    }
    try {
      detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      $('camera').srcObject = cameraStream;
      $('camera').classList.add('is-open');
      $('startCamera').hidden = true;
      $('stopCamera').hidden = false;
      scanning = true;
      await $('camera').play();
      scanFrame();
    } catch (error) {
      await stopCamera();
      $('scanResult').className = 'scan-result is-invalid';
      $('scanResult').textContent = `Camera unavailable: ${error.message || 'permission denied'}. Use a hardware scanner or enter the tag.`;
    }
  }

  function start() {
    if (!$('jobCards')) return;
    $('refreshJobs').addEventListener('click', render);
    $('printTags').addEventListener('click', () => window.print());
    $('scanForm').addEventListener('submit', (event) => { event.preventDefault(); showResult($('scanInput').value); });
    $('scanInput').addEventListener('change', () => showResult($('scanInput').value));
    $('startCamera').addEventListener('click', startCamera);
    $('stopCamera').addEventListener('click', stopCamera);
    document.addEventListener('click', (event) => {
      const verify = event.target.closest('[data-verify-tag]');
      if (verify) {
        $('scanInput').value = verify.dataset.verifyTag;
        showResult(verify.dataset.verifyTag);
        $('scanInput').focus();
      }
      const update = event.target.closest('[data-update-job]');
      if (update) updateStage(update.dataset.updateJob);
    });
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.addEventListener('beforeunload', stopCamera);
    window.frameflowBarcodeTracking = { render, findTag, ensureTags };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
