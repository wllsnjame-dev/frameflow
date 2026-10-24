(function () {
  if (window.frameflowRBAC) return;

  const roleDefinitions = {
    admin: {
      label: 'Administrator',
      modules: ['dashboard', 'customers', 'products', 'quotations', 'orders', 'invoices', 'production', 'stock', 'optimization', 'barcode', 'procurement', 'planning', 'billing', 'reports', 'settings', 'security'],
      permissions: ['customers.write', 'products.write', 'quotations.write', 'orders.write', 'invoices.write', 'production.write', 'stock.write', 'procurement.write', 'workcentres.write', 'schedules.write', 'qc.write', 'billing.write', 'users.write']
    },
    sales: {
      label: 'Sales Representative',
      modules: ['dashboard', 'customers', 'products', 'quotations', 'orders', 'invoices', 'reports'],
      permissions: ['customers.write', 'quotations.write', 'orders.write']
    },
    worker: {
      label: 'Factory Worker',
      modules: ['dashboard', 'products', 'production', 'stock', 'barcode', 'planning'],
      permissions: ['production.write', 'qc.write']
    },
    procurement: {
      label: 'Procurement / Stock Manager',
      modules: ['dashboard', 'products', 'stock', 'optimization', 'procurement', 'reports'],
      permissions: ['stock.write', 'procurement.write']
    }
  };

  const pageModules = {
    'app.html': 'dashboard',
    'customers.html': 'customers',
    'products.html': 'products',
    'quotation.html': 'quotations',
    'orders.html': 'orders',
    'invoices.html': 'invoices',
    'production.html': 'production',
    'stock.html': 'stock',
    'optimization.html': 'optimization',
    'barcode.html': 'barcode',
    'procurement.html': 'procurement',
    'planning.html': 'planning',
    'billing.html': 'billing',
    'reports.html': 'reports',
    'settings.html': 'settings',
    'rbac.html': 'security'
  };

  const roleOf = (user) => roleDefinitions[user?.role] ? user.role : 'worker';
  const id = () => window.frameflow?.makeId?.() || `USER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function ensureSession() {
    const db = window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
    if (!Array.isArray(db.users)) db.users = [];
    let changed = false;
    if (!db.users.length) {
      db.users.push({ id: id(), name: 'FrameFlow Administrator', email: '', role: 'admin', isActive: true, createdAt: new Date().toISOString() });
      changed = true;
    }
    db.users.forEach((user) => {
      if (user.isActive === undefined) { user.isActive = true; changed = true; }
      if (!roleDefinitions[user.role]) { user.role = 'worker'; changed = true; }
    });
    let active = db.users.find((user) => user.id === db.activeUserId && user.isActive !== false);
    if (!active) {
      active = db.users.find((user) => user.role === 'admin' && user.isActive !== false) || db.users.find((user) => user.isActive !== false);
      db.activeUserId = active?.id || '';
      changed = true;
    }
    if (changed) {
      if (window.frameflow) window.frameflow.saveDb(db);
      else localStorage.setItem('frameflow', JSON.stringify(db));
    }
    return { db, active };
  }

  function currentUser() {
    return ensureSession().active;
  }

  function canModule(module) {
    const user = currentUser();
    return !!user && roleDefinitions[roleOf(user)].modules.includes(module);
  }

  function hasPermission(permission) {
    const user = currentUser();
    return typeof permission === 'string' && !!user && roleDefinitions[roleOf(user)].permissions.includes(permission);
  }

  function can(permission) {
    return hasPermission(permission) && (!permission.endsWith('.write') || permission === 'billing.write' || !subscriptionWriteLocked());
  }

  function setActiveUser(userId) {
    const { db } = ensureSession();
    const user = db.users.find((entry) => entry.id === userId && entry.isActive !== false);
    if (!user) return false;
    db.activeUserId = user.id;
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
    return true;
  }

  function hide(selector) {
    document.querySelectorAll(selector).forEach((element) => { element.hidden = true; });
  }

  function subscriptionWriteLocked() {
    const db = window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
    const status = String(db.subscription?.status || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
    return status === 'expired' || status === 'past due';
  }

  function isBillingPage() {
    return location.pathname.split('/').pop().toLowerCase() === 'billing.html';
  }

  function applySubscriptionReadOnly() {
    const locked = subscriptionWriteLocked() && !isBillingPage();
    const host = document.querySelector('#content, .content');
    let notice = document.getElementById('subscriptionReadOnlyNotice');

    if (locked && host) {
      if (!notice) {
        notice = document.createElement('aside');
        notice.id = 'subscriptionReadOnlyNotice';
        notice.setAttribute('role', 'alert');
        notice.style.cssText = 'margin:0 0 18px;padding:13px 15px;border:1px solid #e8cfa4;border-radius:5px;background:#fff8e9;color:#775718;font:12px/1.5 Arial,sans-serif';
        notice.innerHTML = `Factory subscription status is <strong>${String((window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}')).subscription.status).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]))}</strong>. The workspace is read-only. ${canModule('billing') ? '<a href="billing.html" style="color:#087f78;font-weight:700">Review subscription billing</a> to restore write access.' : 'Contact a factory administrator to restore write access.'}`;
        host.prepend(notice);
      }
    } else if (notice) {
      notice.remove();
    }

    document.querySelectorAll('button:not([data-page]), input:not([type="search"]):not(.search):not([type="hidden"]), select, textarea, [contenteditable="true"]').forEach((element) => {
      if (locked && !element.hasAttribute('data-subscription-lock')) {
        element.setAttribute('data-subscription-lock', 'true');
        if (element.isContentEditable) {
          element.setAttribute('data-subscription-was-editable', element.getAttribute('contenteditable'));
          element.setAttribute('contenteditable', 'false');
        } else {
          element.setAttribute('data-subscription-was-disabled', String(element.disabled === true));
          element.disabled = true;
        }
      }
    });
    if (!locked) document.querySelectorAll('[data-subscription-lock]').forEach((element) => {
      if (element.hasAttribute('data-subscription-was-editable')) {
        element.setAttribute('contenteditable', element.getAttribute('data-subscription-was-editable'));
        element.removeAttribute('data-subscription-was-editable');
      } else {
        element.disabled = element.getAttribute('data-subscription-was-disabled') === 'true';
        element.removeAttribute('data-subscription-was-disabled');
      }
      element.removeAttribute('data-subscription-lock');
    });
  }

  function protectControls() {
    if (!hasPermission('customers.write')) hide('#newCustomer, #newMeasurement, #customerForm, #measurementForm, #customerRows [data-edit], #customerRows [data-delete], #customerRows [data-measurement-delete]');
    if (!hasPermission('products.write')) hide('#newProduct, #newDesign, #productForm, #designForm, #productRows [data-edit], #productRows [data-delete], #designRows [data-edit], #designRows [data-delete], #pricingSettings');
    if (!hasPermission('quotations.write')) hide('#quoteDraft, #quoteSave, #saveDraft, #saveSend, #quoteAddItem, #addItem, #savePricing');
    if (!hasPermission('orders.write')) hide('#newOrder, #editOrder, #invoice, #payment, #changeStatus, #cancelOrder, #saveDetails, #saveOrder, #orderDesignForm, [data-new-order], [data-edit-order], [data-save-order]');
    if (!hasPermission('invoices.write')) hide('#newInvoice, #editInvoice, #recordPayment, #sendInvoice, #markPaid, #cancelInvoice, #addPayment, [data-add-payment], [data-payment-action], [data-invoice-edit]');
    if (!hasPermission('production.write')) hide('#create, #change, #saveDetails, #saveQc, [data-advance], [data-status-update]');
    if (!hasPermission('stock.write')) hide('#add, #items [data-stock-in], #items [data-stock-out], #items [data-adjust], #items [data-edit], #items [data-archive]');
    if (!hasPermission('procurement.write')) hide('#supplierForm, #newPurchaseOrder, [data-edit-po], [data-send-po], [data-receive-po], [data-cancel-po]');
    if (!hasPermission('workcentres.write')) hide('#centreForm, #workCentres form, [data-save-centre], [data-archive-centre], [data-activate-centre]');
    if (!hasPermission('schedules.write')) hide('#scheduleForm, [data-unschedule]');
    if (!hasPermission('qc.write')) hide('#qcForm');
    if (!hasPermission('users.write')) hide('#userForm, [data-edit-user], [data-delete-user]');
    if (!hasPermission('billing.write')) hide('#billingCycle, #tiers [data-choose-tier], [data-mark-paid], #cancelSubscription');
    applySubscriptionReadOnly();
  }

  function filterNavigation() {
    const links = {
      'app.html': 'dashboard', 'customers.html': 'customers', 'products.html': 'products', 'quotation.html': 'quotations',
      'orders.html': 'orders', 'invoices.html': 'invoices', 'production.html': 'production', 'stock.html': 'stock',
      'optimization.html': 'optimization', 'barcode.html': 'barcode', 'procurement.html': 'procurement', 'planning.html': 'planning',
      'reports.html': 'reports', 'settings.html': 'settings', 'rbac.html': 'security', 'billing.html': 'billing'
    };
    document.querySelectorAll('a[href], #nav [data-page]').forEach((link) => {
      const target = link.tagName === 'A' ? link.getAttribute('href') : ({ 'Dashboard': 'app.html', 'Customers': 'customers.html', 'Products': 'products.html', 'Quotations': 'quotation.html', 'Orders': 'orders.html', 'Invoices': 'invoices.html', 'Production': 'production.html', 'Stock': 'stock.html', 'Optimization': 'optimization.html', 'Barcode Tracking': 'barcode.html', 'Procurement': 'procurement.html', 'Planning & QC': 'planning.html', 'Billing': 'billing.html', 'Reports': 'reports.html', 'Settings': 'settings.html', 'Security': 'rbac.html' })[link.dataset.page];
      const module = links[target];
      if (module && !canModule(module)) link.hidden = true;
    });
  }

  function denyPage(module) {
    const host = document.querySelector('#content, .content');
    if (!host) return;
    const user = currentUser();
    const role = roleDefinitions[roleOf(user)];
    host.innerHTML = `<section class="rbac-denied"><style>.rbac-denied{max-width:620px;margin:50px auto;padding:28px;background:#fff;border:1px solid #dfe5df;border-radius:6px}.rbac-denied h1{margin:0 0 8px;font-size:24px}.rbac-denied p{color:#6f7b7d}.rbac-denied a{color:#087f78;font-weight:700}</style><h1>Access restricted</h1><p>${role.label} does not have access to this module.</p><a href="app.html">Return to Dashboard</a></section>`;
  }

  function applyPageAccess() {
    const { active } = ensureSession();
    const file = location.pathname.split('/').pop().toLowerCase();
    const module = pageModules[file];
    if (module && !canModule(module)) {
      denyPage(module);
      filterNavigation();
      return;
    }
    protectControls();
    filterNavigation();
  }

  function renderSecurity() {
    const host = document.getElementById('securityApp');
    if (!host || !can('users.write')) return;
    const { db, active } = ensureSession();
    const activeSelect = document.getElementById('activeSession');
    activeSelect.innerHTML = db.users.filter((user) => user.isActive !== false).map((user) => `<option value="${escapeHtml(user.id)}"${user.id === active?.id ? ' selected' : ''}>${escapeHtml(user.name)} · ${escapeHtml(roleDefinitions[roleOf(user)].label)}</option>`).join('');
    document.getElementById('userRows').innerHTML = db.users.length ? db.users.map((user) => `<tr><td><strong>${escapeHtml(user.name)}</strong></td><td>${escapeHtml(user.email || '—')}</td><td>${escapeHtml(roleDefinitions[roleOf(user)].label)}</td><td>${user.isActive === false ? 'Inactive' : user.id === active?.id ? 'Active session' : 'Active'}</td><td><div class="security-actions"><button type="button" class="secondary" data-edit-user="${escapeHtml(user.id)}">Edit</button>${user.id !== active?.id && user.isActive !== false ? `<button type="button" class="secondary" data-switch-user="${escapeHtml(user.id)}">Switch session</button>` : ''}${user.id !== active?.id ? `<button type="button" class="danger" data-delete-user="${escapeHtml(user.id)}">Remove</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="5">No local users configured.</td></tr>';
    const permissionRows = Object.entries(roleDefinitions).map(([role, definition]) => `<tr><td><strong>${escapeHtml(definition.label)}</strong></td>${['dashboard', 'customers', 'products', 'quotations', 'orders', 'invoices', 'production', 'stock', 'optimization', 'barcode', 'procurement', 'planning', 'billing', 'reports', 'settings', 'security'].map((module) => `<td>${definition.modules.includes(module) ? '<span class="permission-yes">Allowed</span>' : '<span class="permission-no">—</span>'}</td>`).join('')}<td>${definition.permissions.length ? definition.permissions.map(escapeHtml).join('<br>') : 'Read only'}</td></tr>`).join('');
    document.getElementById('permissionRows').innerHTML = permissionRows;
    document.getElementById('currentRoleLabel').textContent = active ? `${active.name} · ${roleDefinitions[roleOf(active)].label}` : 'No active user';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function saveUser(event) {
    event.preventDefault();
    const { db } = ensureSession();
    const form = event.currentTarget;
    const userId = form.elements.userId.value;
    const name = form.elements.name.value.trim();
    const email = form.elements.email.value.trim();
    const role = form.elements.role.value;
    if (!name || !roleDefinitions[role]) return setSecurityMessage('Enter a name and select a valid role.', true);
    const existing = db.users.find((user) => user.id === userId);
    const changedActiveRole = !!existing && existing.id === db.activeUserId && existing.role !== role;
    if (existing) {
      existing.name = name;
      existing.email = email;
      existing.role = role;
      existing.updatedAt = new Date().toISOString();
    } else {
      db.users.push({ id: id(), name, email, role, isActive: true, createdAt: new Date().toISOString() });
    }
    if (!db.users.some((user) => user.role === 'admin' && user.isActive !== false)) return setSecurityMessage('At least one active Administrator is required.', true);
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
    if (changedActiveRole) {
      location.reload();
      return;
    }
    form.reset();
    form.elements.userId.value = '';
    document.getElementById('userFormTitle').textContent = 'Add local user';
    setSecurityMessage('Local role profile saved.', false);
    renderSecurity();
  }

  function setSecurityMessage(message, error) {
    const element = document.getElementById('securityMessage');
    if (!element) return;
    element.textContent = message;
    element.className = `security-message ${error ? 'error' : 'ok'}`;
  }

  function editUser(userId) {
    const user = ensureSession().db.users.find((entry) => entry.id === userId);
    if (!user) return;
    const form = document.getElementById('userForm');
    form.elements.userId.value = user.id;
    form.elements.name.value = user.name || '';
    form.elements.email.value = user.email || '';
    form.elements.role.value = roleOf(user);
    document.getElementById('userFormTitle').textContent = `Edit ${user.name}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function removeUser(userId) {
    const { db, active } = ensureSession();
    const user = db.users.find((entry) => entry.id === userId);
    if (!user || user.id === active?.id) return;
    if (!confirm(`Remove local user ${user.name}?`)) return;
    const remaining = db.users.filter((entry) => entry.id !== userId);
    if (!remaining.some((entry) => entry.role === 'admin' && entry.isActive !== false)) return setSecurityMessage('At least one active Administrator is required.', true);
    db.users = remaining;
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
    renderSecurity();
  }

  function switchUser(userId) {
    if (!setActiveUser(userId)) return;
    location.reload();
  }

  function start() {
    ensureSession();
    const file = location.pathname.split('/').pop().toLowerCase();
    const module = pageModules[file];
    if (module && !canModule(module)) denyPage(module);
    filterNavigation();
    protectControls();
    const host = document.querySelector('#content, .content');
    if (host) new MutationObserver(() => {
      const currentFile = location.pathname.split('/').pop().toLowerCase();
      const currentModule = pageModules[currentFile];
      if (currentModule && !canModule(currentModule)) denyPage(currentModule);
      else protectControls();
      filterNavigation();
    }).observe(host, { childList: true, subtree: true });
    new MutationObserver(applySubscriptionReadOnly).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('submit', (event) => {
      if (subscriptionWriteLocked() && !isBillingPage()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('click', (event) => {
      if (!subscriptionWriteLocked() || isBillingPage()) return;
      const action = event.target.closest('button:not([data-page]), input[type="submit"], input[type="button"], [role="button"], a[data-action], [data-edit], [data-delete], [data-save], [data-advance], [data-status-update]');
      if (action && !action.closest('#subscriptionReadOnlyNotice')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener('storage', (event) => {
      if (event.key === 'frameflow') protectControls();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) protectControls();
    });
    const securityHost = document.getElementById('securityApp');
    if (securityHost) {
      document.getElementById('userForm').addEventListener('submit', saveUser);
      document.getElementById('activeSession').addEventListener('change', (event) => switchUser(event.target.value));
      document.getElementById('resetUserForm').addEventListener('click', () => {
        document.getElementById('userForm').reset();
        document.getElementById('userForm').elements.userId.value = '';
        document.getElementById('userFormTitle').textContent = 'Add local user';
        setSecurityMessage('', false);
      });
      document.getElementById('userRows').addEventListener('click', (event) => {
        const edit = event.target.closest('[data-edit-user]');
        const remove = event.target.closest('[data-delete-user]');
        const switchButton = event.target.closest('[data-switch-user]');
        if (edit) editUser(edit.dataset.editUser);
        if (remove) removeUser(remove.dataset.deleteUser);
        if (switchButton) switchUser(switchButton.dataset.switchUser);
      });
      renderSecurity();
    }
  }

  window.frameflowRBAC = { roleDefinitions, pageModules, currentUser, can, canModule, setActiveUser, ensureSession, applyPageAccess, subscriptionWriteLocked };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
