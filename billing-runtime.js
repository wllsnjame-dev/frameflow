(function () {
  if (window.frameflowBilling) return;

  const tiers = {
    starter: { name: 'Starter', monthly: 49, summary: 'For small teams getting started.', features: ['Core customer and order workflows', 'Production and stock management', 'Local browser storage'] },
    professional: { name: 'Professional', monthly: 149, summary: 'For growing window and door factories.', features: ['Everything in Starter', 'Material optimization and barcode tracking', 'Procurement, planning and QC'] },
    enterprise: { name: 'Enterprise', monthly: 299, summary: 'For larger operations and multiple teams.', features: ['Everything in Professional', 'Expanded operational reporting', 'Priority deployment planning'] }
  };
  const legacyPlans = { basic: 'starter', pro: 'professional' };
  const $ = (id) => document.getElementById(id);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(number(value));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const read = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const save = (db) => window.frameflow ? window.frameflow.saveDb(db) : localStorage.setItem('frameflow', JSON.stringify(db));
  const canonicalPlan = (plan) => legacyPlans[plan] || plan;
  const yearlyPrice = (tier) => tier.monthly * 12;

  function ensureState(db) {
    if (!Array.isArray(db.billingRecords)) db.billingRecords = [];
    return db;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function addPeriod(start, cycle) {
    const date = new Date(`${start}T12:00:00`);
    if (cycle === 'yearly') date.setFullYear(date.getFullYear() + 1);
    else date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
  }

  function statusOf(record) {
    const status = String(record.status || '').trim();
    if (['paid', 'cancelled', 'expired', 'past due'].includes(status.toLowerCase())) {
      return status.toLowerCase() === 'past due' ? 'Past Due' : status;
    }
    if (record.dueDate && record.dueDate < today()) return 'Past Due';
    return record.status || 'Pending';
  }

  function renderCurrent(db) {
    const subscription = db.subscription;
    if (!subscription) {
      $('currentPlan').innerHTML = '<div><h2>No active subscription</h2><p>Choose a tier and cadence to create a local subscription record.</p></div><span class="status">Not subscribed</span>';
      return;
    }
    const plan = canonicalPlan(subscription.plan);
    const tier = tiers[plan] || tiers.starter;
    const latest = db.billingRecords.filter((record) => record.kind === 'subscription').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const subscriptionStatus = String(subscription.status || '').trim();
    const subscriptionStatusLower = subscriptionStatus.toLowerCase();
    const latestStatus = latest ? statusOf(latest) : '';
    const status = ['expired', 'past due'].includes(subscriptionStatusLower)
      ? (subscriptionStatusLower === 'past due' ? 'Past Due' : subscriptionStatus)
      : latestStatus === 'Past Due' ? latestStatus : subscriptionStatus || latestStatus || 'Pending';
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const cycle = subscription.billingCycle === 'yearly' ? 'yearly' : 'monthly';
    const price = cycle === 'yearly' ? yearlyPrice(tier) : tier.monthly;
    const renewalDate = subscription.currentPeriodEnd || 'pending payment';
    $('currentPlan').innerHTML = `<div><h2>${esc(tier.name)} · ${cycle === 'yearly' ? 'Annual' : 'Monthly'}</h2><p>${money(price)} / ${cycle === 'yearly' ? 'year' : 'month'} · Started ${esc(subscription.startedAt || '—')}</p><p>${subscription.cancelAtPeriodEnd ? `Cancels at period end (${esc(renewalDate)})` : `Next renewal: ${esc(renewalDate)}`}</p></div><div><span class="status ${statusClass}">${esc(status)}</span>${!subscription.cancelAtPeriodEnd ? '<button class="danger" id="cancelSubscription" type="button" style="display:block;margin-top:9px">Cancel at period end</button>' : ''}</div>`;
    const currentTier = $('tiers')?.querySelector(`[data-tier="${plan}"]`);
    document.querySelectorAll('.tier').forEach((card) => card.classList.toggle('selected', card === currentTier));
  }

  function renderTiers(db) {
    const cycle = $('billingCycle').value;
    $('cycleNote').textContent = cycle === 'yearly' ? 'Annual billing is 12 monthly payments in one local ledger entry.' : 'Billed monthly in this local ledger.';
    const currentPlan = canonicalPlan(db.subscription?.plan);
    $('tiers').innerHTML = Object.entries(tiers).map(([key, tier]) => {
      const price = cycle === 'yearly' ? yearlyPrice(tier) : tier.monthly;
      return `<article class="tier ${currentPlan === key ? 'selected' : ''}" data-tier="${key}"><h2>${tier.name}</h2><p>${tier.summary}</p><div class="tier-price">${money(price)}<small> / ${cycle === 'yearly' ? 'year' : 'month'}</small></div><ul>${tier.features.map((feature) => `<li>${esc(feature)}</li>`).join('')}</ul><button class="primary" type="button" data-choose-tier="${key}">${currentPlan === key ? 'Renew / change cadence' : `Choose ${tier.name}`}</button></article>`;
    }).join('');
  }

  function renderHistory(db) {
    const records = db.billingRecords.filter((record) => record.kind === 'subscription').sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    $('billingRows').innerHTML = records.length ? records.map((record) => {
      const status = statusOf(record);
      const className = status.toLowerCase().replace(/\s+/g, '-');
      const plan = canonicalPlan(record.plan);
      const period = [record.periodStart, record.periodEnd].filter(Boolean).map(esc).join(' – ') || '—';
      return `<tr><td><strong>${esc(record.number)}</strong></td><td>${esc(tiers[plan]?.name || record.plan)}</td><td>${period}</td><td>${money(record.amount)}</td><td>${esc(record.dueDate || '—')}</td><td><span class="status ${className}">${esc(status)}</span></td><td>${esc(record.paymentMethod || record.paymentProvider || '—')}</td><td>${esc(record.paidAt || '—')}</td><td>${['Pending', 'Past Due'].includes(status) ? `<button class="secondary" type="button" data-mark-paid="${esc(record.id)}">Record manual payment</button>` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="empty">No subscription payment records yet.</td></tr>';
  }

  function render() {
    const db = ensureState(read());
    renderCurrent(db);
    renderTiers(db);
    renderHistory(db);
  }

  function chooseTier(plan) {
    const db = ensureState(read());
    const tier = tiers[plan];
    if (!tier) return;
    const cycle = $('billingCycle').value;
    const now = today();
    const amount = cycle === 'yearly' ? yearlyPrice(tier) : tier.monthly;
    const number = window.frameflow?.nextNumber?.('SUB', db.billingRecords) || `SUB-${new Date().getFullYear()}-${String(db.billingRecords.length + 1).padStart(4, '0')}`;
    const record = {
      id: window.frameflow?.makeId?.() || `BILL-${Date.now()}`,
      number,
      kind: 'subscription',
      plan,
      billingCycle: cycle,
      amount,
      currency: 'GBP',
      status: 'Pending',
      periodStart: now,
      dueDate: now,
      periodEnd: addPeriod(now, cycle),
      createdAt: new Date().toISOString(),
      paymentProvider: 'manual/local'
    };
    db.billingRecords.push(record);
    db.subscription = {
      ...(db.subscription || {}),
      plan,
      billingCycle: cycle,
      status: 'Pending',
      startedAt: db.subscription?.startedAt || now,
      currentPeriodStart: now,
      currentPeriodEnd: record.periodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: new Date().toISOString()
    };
    save(db);
    render();
    setMessage(`${tier.name} ${cycle} plan recorded as pending. No payment was taken.`);
  }

  function recordManualPayment(id) {
    const db = ensureState(read());
    const record = db.billingRecords.find((entry) => entry.id === id && entry.kind === 'subscription');
    if (!record || !confirm(`Record ${money(record.amount)} as manually paid for ${record.number}? This will only update the local ledger.`)) return;
    const now = new Date().toISOString();
    record.status = 'Paid';
    record.paidAt = now;
    record.paymentMethod = 'Manual record';
    record.updatedAt = now;
    if (canonicalPlan(db.subscription?.plan) === canonicalPlan(record.plan) && db.subscription?.billingCycle === record.billingCycle) {
      db.subscription.status = 'Active';
      db.subscription.currentPeriodStart = record.periodStart;
      db.subscription.currentPeriodEnd = record.periodEnd;
      db.subscription.lastPaymentAt = now;
    }
    save(db);
    render();
    setMessage(`Payment status for ${record.number} recorded as paid locally. No payment provider was contacted.`);
  }

  function cancelAtPeriodEnd() {
    const db = ensureState(read());
    if (!db.subscription || db.subscription.cancelAtPeriodEnd) return;
    if (!confirm('Schedule this subscription to cancel at the end of its current period?')) return;
    db.subscription.cancelAtPeriodEnd = true;
    db.subscription.updatedAt = new Date().toISOString();
    save(db);
    render();
    setMessage('Cancellation scheduled locally for the end of the current period.');
  }

  function setMessage(message) {
    $('billingMessage').textContent = message;
  }

  function start() {
    if (!$('tiers')) return;
    const db = ensureState(read());
    $('billingCycle').value = db.subscription?.billingCycle || 'monthly';
    $('billingCycle').addEventListener('change', render);
    $('printBilling').addEventListener('click', () => window.print());
    $('tiers').addEventListener('click', (event) => {
      const button = event.target.closest('[data-choose-tier]');
      if (button) chooseTier(button.dataset.chooseTier);
    });
    $('billingRows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mark-paid]');
      if (button) recordManualPayment(button.dataset.markPaid);
    });
    $('currentPlan').addEventListener('click', (event) => {
      if (event.target.closest('#cancelSubscription')) cancelAtPeriodEnd();
    });
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.frameflowBilling = { tiers, render };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
