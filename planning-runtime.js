(function () {
  if (window.frameflowPlanning) return;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const read = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const save = (db) => window.frameflow ? window.frameflow.saveDb(db) : localStorage.setItem('frameflow', JSON.stringify(db));
  const makeId = (prefix) => window.frameflow?.makeId?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workStages = ['Profile Cutting', 'Frame Assembly', 'Glass Fitting', 'Quality Control (QC)', 'Any'];
  let editingCentreId = '';

  function ensureArrays(db) {
    ['production', 'productionSchedules', 'workCentres', 'qcInspections'].forEach((key) => { if (!Array.isArray(db[key])) db[key] = []; });
    return db;
  }

  function isActiveJob(job) {
    const status = String(job.status || job.stage || '').toLowerCase();
    return !['completed', 'complete', 'cancelled', 'canceled'].some((terminal) => status.includes(terminal));
  }

  function jobKey(job) {
    return String(job.id || job.jobNumber || job.orderNumber || job.order_number || '');
  }

  function jobFor(db, identifier) {
    return db.production.find((job) => [job.id, job.jobNumber, job.orderNumber, job.order_number].some((value) => String(value || '') === String(identifier || '')));
  }

  function jobUnits(job) {
    return Math.max(1, (job.items || []).reduce((sum, item) => sum + Math.max(0, Math.floor(number(item.quantity) || 0)), 0));
  }

  function centerFor(db, id) {
    return db.workCentres.find((center) => center.id === id) || null;
  }

  function stageOptions(selected) {
    return workStages.map((stage) => `<option value="${esc(stage)}"${stage === selected ? ' selected' : ''}>${esc(stage)}</option>`).join('');
  }

  function sortedSchedules(db) {
    return db.productionSchedules.slice().sort((a, b) => `${a.date || ''}T${a.startTime || ''}`.localeCompare(`${b.date || ''}T${b.startTime || ''}`));
  }

  function loadFor(db, centerId, date, excludingId = '') {
    return db.productionSchedules.filter((schedule) => schedule.workCentreId === centerId && schedule.date === date && schedule.id !== excludingId && schedule.status !== 'Cancelled').reduce((sum, schedule) => sum + number(schedule.plannedUnits), 0);
  }

  function capacityFor(db, center, date, excludingId = '') {
    const scheduled = loadFor(db, center.id, date, excludingId);
    const capacity = Math.max(0, number(center.capacityUnits));
    return { scheduled, capacity, remaining: capacity - scheduled, percent: capacity ? scheduled / capacity * 100 : 0 };
  }

  function renderMetrics(db) {
    const jobs = db.production.filter(isActiveJob);
    const today = new Date().toISOString().slice(0, 10);
    const scheduledToday = db.productionSchedules.filter((schedule) => schedule.date === today && schedule.status !== 'Cancelled');
    const passed = db.qcInspections.filter((record) => record.result === 'Pass').length;
    const failed = db.qcInspections.filter((record) => record.result === 'Fail').length;
    const scheduledUnits = scheduledToday.reduce((sum, schedule) => sum + number(schedule.plannedUnits), 0);
    const cards = [
      ['Active jobs', jobs.length],
      ['Work centres', db.workCentres.filter((center) => center.isActive !== false).length],
      ['Runs scheduled today', scheduledToday.length],
      ['Units planned today', scheduledUnits],
      ['QC pass / fail', `${passed} / ${failed}`]
    ];
    $('metrics').innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function renderWorkCentres(db) {
    $('workCentres').innerHTML = db.workCentres.length ? db.workCentres.map((center) => {
      const date = $('scheduleForm').elements.date.value;
      const load = capacityFor(db, center, date);
      const inactive = center.isActive === false;
      return `<form class="centre-row" data-centre-id="${esc(center.id)}"><div class="form-grid"><label class="field full">Work-centre name<input name="name" value="${esc(center.name)}" required></label><label class="field">Stage<select name="stage">${stageOptions(center.stage)}</select></label><label class="field">Daily capacity (units)<input name="capacityUnits" type="number" min="1" step="1" value="${number(center.capacityUnits)}" required></label></div><span>${load.scheduled} / ${load.capacity} units scheduled for ${esc(date || 'selected date')} · ${inactive ? 'Archived' : `${Math.max(0, load.remaining)} available`}</span><div class="actions" style="margin-top:8px"><button type="submit" class="secondary">Save centre</button>${inactive ? `<button type="button" class="secondary" data-activate-centre="${esc(center.id)}">Activate</button>` : `<button type="button" class="secondary" data-archive-centre="${esc(center.id)}">Archive</button>`}</div></form>`;
    }).join('') : '<div class="empty">Add a work centre to define daily production capacity.</div>';
  }

  function renderJobOptions(db, selectedJobId = '') {
    const select = $('scheduleForm').elements.jobId;
    const jobs = db.production.filter(isActiveJob);
    select.innerHTML = '<option value="">Select active production job…</option>' + jobs.map((job) => `<option value="${esc(jobKey(job))}"${jobKey(job) === selectedJobId ? ' selected' : ''}>${esc(job.jobNumber || jobKey(job))} · ${esc(job.orderNumber || job.order_number || '')} · ${esc(job.customer || 'Customer')}</option>`).join('');
    const qc = $('qcForm').elements.jobId;
    qc.innerHTML = '<option value="">Select production job…</option>' + db.production.map((job) => `<option value="${esc(jobKey(job))}">${esc(job.jobNumber || jobKey(job))} · ${esc(job.orderNumber || job.order_number || '')} · ${esc(job.customer || 'Customer')}</option>`).join('');
  }

  function renderCentreOptions(db) {
    const select = $('scheduleForm').elements.workCentreId;
    const active = db.workCentres.filter((center) => center.isActive !== false);
    select.innerHTML = '<option value="">Select work centre…</option>' + active.map((center) => `<option value="${esc(center.id)}">${esc(center.name)} · ${esc(center.stage)}</option>`).join('');
  }

  function renderSchedules(db) {
    const schedules = sortedSchedules(db);
    const selectedDate = $('scheduleForm').elements.date.value;
    $('scheduleDateLabel').textContent = selectedDate ? `Capacity is evaluated per centre for ${selectedDate}.` : '';
    $('scheduleRows').innerHTML = schedules.length ? schedules.map((schedule) => {
      const center = centerFor(db, schedule.workCentreId);
      const job = jobFor(db, schedule.productionJobId || schedule.jobId);
      const load = center ? capacityFor(db, center, schedule.date, schedule.id) : { scheduled: 0, capacity: 0 };
      const totalLoad = center ? loadFor(db, center.id, schedule.date) : 0;
      const capacityPercent = center?.capacityUnits ? Math.min(100, totalLoad / number(center.capacityUnits) * 100) : 0;
      return `<tr><td>${esc(schedule.date)}<br>${esc(schedule.startTime || '—')}</td><td><strong>${esc(job?.jobNumber || schedule.jobNumber || 'Job')}</strong><br>${esc(job?.orderNumber || schedule.orderNumber || '')}</td><td>${esc(center?.name || 'Centre unavailable')}<br><small>${esc(schedule.stage || center?.stage || '')}</small></td><td>${number(schedule.plannedUnits)}</td><td>${totalLoad} / ${number(center?.capacityUnits)} units <div style="height:5px;background:#edf0ed;margin-top:5px"><i style="display:block;height:100%;width:${capacityPercent}%;background:${capacityPercent > 100 ? '#a74930' : '#087f78'}"></i></div></td><td><span class="status scheduled">${esc(schedule.status || 'Scheduled')}</span></td><td><button type="button" class="secondary" data-unschedule="${esc(schedule.id)}">Remove</button></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">No production runs scheduled yet.</td></tr>';
  }

  function latestCheck(db, jobId, checkpoint, unitRef) {
    return db.qcInspections.filter((record) => record.productionJobId === jobId && record.checkpoint === checkpoint && String(record.unitRef || 'All units') === String(unitRef || 'All units')).sort((a, b) => String(b.inspectedAt).localeCompare(String(a.inspectedAt)))[0] || null;
  }

  function renderQc(db) {
    const query = $('qcSearch').value.trim().toLowerCase();
    const resultFilter = $('qcResultFilter').value;
    const inspections = db.qcInspections.slice().sort((a, b) => String(b.inspectedAt || '').localeCompare(String(a.inspectedAt || ''))).filter((record) => {
      const job = jobFor(db, record.productionJobId);
      const text = [record.jobNumber, record.orderNumber, record.checkpoint, record.unitRef, record.inspector, record.notes, job?.customer].join(' ').toLowerCase();
      return (!resultFilter || record.result === resultFilter) && (!query || text.includes(query));
    });
    $('qcRows').innerHTML = inspections.length ? inspections.map((record) => `<tr><td>${esc(new Date(record.inspectedAt).toLocaleString('en-GB'))}</td><td><strong>${esc(record.jobNumber || 'Job')}</strong><br>${esc(record.orderNumber || '')}</td><td>${esc(record.checkpoint)}</td><td>${esc(record.unitRef || 'All units')}</td><td><span class="status ${record.result === 'Pass' ? 'pass' : 'fail'}">${esc(record.result)}</span></td><td>${esc(record.inspector)}</td><td>${esc(record.notes || '—')}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No inspection records match this filter.</td></tr>';
  }

  function render() {
    const db = ensureArrays(read());
    renderMetrics(db);
    renderWorkCentres(db);
    renderJobOptions(db);
    renderCentreOptions(db);
    renderSchedules(db);
    renderQc(db);
  }

  function addWorkCentre(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    const capacityUnits = Math.floor(number(form.elements.capacityUnits.value));
    if (!name || capacityUnits < 1) return alert('Enter a work-centre name and capacity of at least one unit per day.');
    if (db.workCentres.some((center) => center.isActive !== false && center.name.toLowerCase() === name.toLowerCase())) return alert('An active work centre with this name already exists.');
    db.workCentres.push({ id: makeId('WC'), name, stage: form.elements.stage.value, capacityUnits, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    save(db);
    form.reset();
    render();
  }

  function saveWorkCentre(form) {
    const db = ensureArrays(read());
    const centre = db.workCentres.find((item) => item.id === form.dataset.centreId);
    if (!centre) return;
    const name = form.elements.name.value.trim();
    const capacityUnits = Math.floor(number(form.elements.capacityUnits.value));
    if (!name || capacityUnits < 1) return alert('Enter a name and a capacity of at least one unit per day.');
    if (db.workCentres.some((item) => item.id !== centre.id && item.isActive !== false && item.name.toLowerCase() === name.toLowerCase())) return alert('Another active work centre already uses this name.');
    centre.name = name;
    centre.stage = form.elements.stage.value;
    centre.capacityUnits = capacityUnits;
    centre.updatedAt = new Date().toISOString();
    save(db);
    render();
  }

  function changeCentreState(id, active) {
    const db = ensureArrays(read());
    const centre = db.workCentres.find((item) => item.id === id);
    if (!centre) return;
    centre.isActive = active;
    centre.updatedAt = new Date().toISOString();
    save(db);
    render();
  }

  function scheduleRun(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const job = jobFor(db, form.elements.jobId.value);
    const center = centerFor(db, form.elements.workCentreId.value);
    const date = form.elements.date.value;
    const plannedUnits = Math.floor(number(form.elements.plannedUnits.value));
    if (!job || !isActiveJob(job)) return showMessage('scheduleMessage', 'Choose an active production job.', true);
    if (!center || center.isActive === false) return showMessage('scheduleMessage', 'Choose an active work centre.', true);
    if (!date || plannedUnits < 1) return showMessage('scheduleMessage', 'Enter a run date and a positive planned unit count.', true);
    const existing = db.productionSchedules.find((schedule) => schedule.productionJobId === jobKey(job) && schedule.workCentreId === center.id && schedule.date === date && schedule.status !== 'Cancelled');
    const load = capacityFor(db, center, date, existing?.id || '');
    if (load.scheduled + plannedUnits > load.capacity) return showMessage('scheduleMessage', `Capacity exceeded: ${load.scheduled} units already planned, ${plannedUnits} requested, ${load.capacity} available for this centre and date.`, true);
    const now = new Date().toISOString();
    const schedule = {
      id: existing?.id || makeId('RUN'), productionJobId: jobKey(job), jobNumber: job.jobNumber || '', orderNumber: job.orderNumber || job.order_number || '',
      workCentreId: center.id, stage: center.stage === 'Any' ? job.stage || job.status || 'Production' : center.stage,
      date, startTime: form.elements.startTime.value || '08:00', plannedUnits, status: 'Scheduled', updatedAt: now,
      createdAt: existing?.createdAt || now
    };
    if (existing) Object.assign(existing, schedule);
    else db.productionSchedules.push(schedule);
    job.workCentreId = center.id;
    job.scheduledDate = date;
    job.plannedStartTime = schedule.startTime;
    job.plannedUnits = plannedUnits;
    job.plannedStage = schedule.stage;
    job.updatedAt = now;
    save(db);
    showMessage('scheduleMessage', `Scheduled ${job.jobNumber || jobKey(job)} at ${center.name}.`, false);
    form.elements.jobId.value = '';
    render();
  }

  function removeSchedule(id) {
    const db = ensureArrays(read());
    const schedule = db.productionSchedules.find((item) => item.id === id);
    if (!schedule) return;
    db.productionSchedules = db.productionSchedules.filter((item) => item.id !== id);
    const job = jobFor(db, schedule.productionJobId);
    if (job?.workCentreId === schedule.workCentreId && job?.scheduledDate === schedule.date) {
      delete job.workCentreId;
      delete job.scheduledDate;
      delete job.plannedStartTime;
      delete job.plannedUnits;
      delete job.plannedStage;
    }
    save(db);
    render();
  }

  function recordInspection(event) {
    event.preventDefault();
    const db = ensureArrays(read());
    const form = event.currentTarget;
    const job = jobFor(db, form.elements.jobId.value);
    if (!job) return showMessage('qcMessage', 'Choose a production job.', true);
    const unitRef = form.elements.unitRef.value.trim() || 'All units';
    const checkpoint = form.elements.checkpoint.value;
    const result = form.elements.result.value;
    const inspector = form.elements.inspector.value.trim();
    if (!inspector) return showMessage('qcMessage', 'Inspector name is required.', true);
    const now = new Date().toISOString();
    const record = {
      id: makeId('QC'), productionJobId: jobKey(job), jobNumber: job.jobNumber || '', orderNumber: job.orderNumber || job.order_number || '',
      customer: job.customer || '', checkpoint, unitRef, result, inspector, notes: form.elements.notes.value.trim(), inspectedAt: now
    };
    db.qcInspections.push(record);
    job.latestQCInspection = { id: record.id, checkpoint, unitRef, result, inspector, notes: record.notes, inspectedAt: now };
    save(db);
    showMessage('qcMessage', `${result} recorded for ${record.jobNumber || record.orderNumber} · ${checkpoint} · ${unitRef}.`, false);
    const preserveJob = form.elements.jobId.value;
    form.elements.notes.value = '';
    form.elements.unitRef.value = unitRef;
    form.elements.jobId.value = preserveJob;
    render();
    form.elements.jobId.value = preserveJob;
  }

  function showMessage(id, message, error) {
    const box = $(id);
    box.textContent = message;
    box.className = `form-message ${error ? 'error' : 'ok'}`;
  }

  function start() {
    if (!$('scheduleForm')) return;
    const dateInput = $('scheduleForm').elements.date;
    dateInput.value = new Date().toISOString().slice(0, 10);
    $('centreForm').addEventListener('submit', addWorkCentre);
    $('scheduleForm').addEventListener('submit', scheduleRun);
    $('qcForm').addEventListener('submit', recordInspection);
    dateInput.addEventListener('change', render);
    $('qcSearch').addEventListener('input', render);
    $('qcResultFilter').addEventListener('change', render);
    $('printPlanning').addEventListener('click', () => window.print());
    $('workCentres').addEventListener('submit', (event) => {
      const form = event.target.closest('[data-centre-id]');
      if (!form) return;
      event.preventDefault();
      saveWorkCentre(form);
    });
    document.addEventListener('click', (event) => {
      const archive = event.target.closest('[data-archive-centre]');
      const activate = event.target.closest('[data-activate-centre]');
      const unschedule = event.target.closest('[data-unschedule]');
      if (archive) changeCentreState(archive.dataset.archiveCentre, false);
      if (activate) changeCentreState(activate.dataset.activateCentre, true);
      if (unschedule) removeSchedule(unschedule.dataset.unschedule);
    });
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.frameflowPlanning = { render, capacityFor, latestCheck };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
