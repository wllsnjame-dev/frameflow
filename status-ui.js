(function () {
  function renderStatus() {
    if (!window.frameflow) return;
    addOptimizationNavigation();
    addSecurityNavigation();
    const status = document.createElement('div');
    status.id = 'frameflowStatus';
    status.textContent = window.frameflow.getDataMode() === 'SUPABASE' ? 'SUPABASE CONFIGURED · AUTH REQUIRED' : 'LOCAL MODE · SUPABASE NOT CONFIGURED';
    status.setAttribute('role', 'status');
    status.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:20;padding:6px 9px;border:1px solid #dfe5df;border-radius:5px;background:#fff;color:#087f78;font:600 10px Arial,sans-serif;letter-spacing:.5px;box-shadow:0 4px 14px #20383d18';
    document.body.appendChild(status);
    const page = location.pathname.toLowerCase();
    const rbacScript = document.createElement('script');
    rbacScript.src = 'rbac-runtime.js';
    rbacScript.onload = () => window.frameflowRBAC?.applyPageAccess();
    document.body.appendChild(rbacScript);
    const cloudScript = document.createElement('script');
    cloudScript.src = 'cloud-sync.js';
    document.body.appendChild(cloudScript);
    if (page.endsWith('/production.html') || page.endsWith('/stock.html')) {
      const integration = document.createElement('script');
      integration.src = 'production-kanban.js';
      document.body.appendChild(integration);
    }
    if (location.pathname.toLowerCase().endsWith('/orders.html') && window.frameflow) attachOrderDesigns();
  }

  function addOptimizationNavigation() {
    const dashboardNav = document.getElementById('nav');
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Optimization"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Optimization';
      button.textContent = 'Optimization';
      button.onclick = () => { location.href = 'optimization.html'; };
      const stockButton = dashboardNav.querySelector('[data-page="Stock"]');
      if (stockButton) stockButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Barcode Tracking"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Barcode Tracking';
      button.textContent = 'Barcode Tracking';
      button.onclick = () => { location.href = 'barcode.html'; };
      const optimizationButton = dashboardNav.querySelector('[data-page="Optimization"]');
      const stockButton = dashboardNav.querySelector('[data-page="Stock"]');
      if (optimizationButton) optimizationButton.insertAdjacentElement('afterend', button);
      else if (stockButton) stockButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Procurement"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Procurement';
      button.textContent = 'Procurement';
      button.onclick = () => { location.href = 'procurement.html'; };
      const barcodeButton = dashboardNav.querySelector('[data-page="Barcode Tracking"]');
      const stockButton = dashboardNav.querySelector('[data-page="Stock"]');
      if (barcodeButton) barcodeButton.insertAdjacentElement('afterend', button);
      else if (stockButton) stockButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Planning & QC"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Planning & QC';
      button.textContent = 'Planning & QC';
      button.onclick = () => { location.href = 'planning.html'; };
      const procurementButton = dashboardNav.querySelector('[data-page="Procurement"]');
      const stockButton = dashboardNav.querySelector('[data-page="Stock"]');
      if (procurementButton) procurementButton.insertAdjacentElement('afterend', button);
      else if (stockButton) stockButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }

    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav')) return;
      if (sidebar.querySelector('a[href="optimization.html"]')) return;
      const link = document.createElement('a');
      link.href = 'optimization.html';
      link.textContent = 'Optimization';
      const stockLink = [...sidebar.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Stock');
      if (stockLink) stockLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav') || sidebar.querySelector('a[href="planning.html"]')) return;
      const link = document.createElement('a');
      link.href = 'planning.html';
      link.textContent = 'Planning & QC';
      const procurementLink = sidebar.querySelector('a[href="procurement.html"]');
      const stockLink = [...sidebar.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Stock');
      if (procurementLink) procurementLink.insertAdjacentElement('afterend', link);
      else if (stockLink) stockLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav') || sidebar.querySelector('a[href="barcode.html"]')) return;
      const link = document.createElement('a');
      link.href = 'barcode.html';
      link.textContent = 'Barcode Tracking';
      const optimizationLink = sidebar.querySelector('a[href="optimization.html"]');
      const stockLink = [...sidebar.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Stock');
      if (optimizationLink) optimizationLink.insertAdjacentElement('afterend', link);
      else if (stockLink) stockLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav') || sidebar.querySelector('a[href="procurement.html"]')) return;
      const link = document.createElement('a');
      link.href = 'procurement.html';
      link.textContent = 'Procurement';
      const barcodeLink = sidebar.querySelector('a[href="barcode.html"]');
      const stockLink = [...sidebar.querySelectorAll('a')].find((item) => item.textContent.trim() === 'Stock');
      if (barcodeLink) barcodeLink.insertAdjacentElement('afterend', link);
      else if (stockLink) stockLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
  }

  function addSecurityNavigation() {
    const dashboardNav = document.getElementById('nav');
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Security"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Security';
      button.textContent = 'Security';
      button.onclick = () => { location.href = 'rbac.html'; };
      const planningButton = dashboardNav.querySelector('[data-page="Planning & QC"]');
      const procurementButton = dashboardNav.querySelector('[data-page="Procurement"]');
      if (planningButton) planningButton.insertAdjacentElement('afterend', button);
      else if (procurementButton) procurementButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }

    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav') || sidebar.querySelector('a[href="rbac.html"]')) return;
      const link = document.createElement('a');
      link.href = 'rbac.html';
      link.textContent = 'Security';
      const planningLink = sidebar.querySelector('a[href="planning.html"]');
      const procurementLink = sidebar.querySelector('a[href="procurement.html"]');
      if (planningLink) planningLink.insertAdjacentElement('afterend', link);
      else if (procurementLink) procurementLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
    if (dashboardNav && !dashboardNav.querySelector('[data-page="Billing"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = 'Billing';
      button.textContent = 'Billing';
      button.onclick = () => { location.href = 'billing.html'; };
      const securityButton = dashboardNav.querySelector('[data-page="Security"]');
      if (securityButton) securityButton.insertAdjacentElement('afterend', button);
      else dashboardNav.appendChild(button);
    }
    document.querySelectorAll('.side, .sidebar').forEach((sidebar) => {
      if (sidebar.querySelector('#nav') || sidebar.querySelector('a[href="billing.html"]')) return;
      const link = document.createElement('a');
      link.href = 'billing.html';
      link.textContent = 'Billing';
      const securityLink = sidebar.querySelector('a[href="rbac.html"]');
      if (securityLink) securityLink.insertAdjacentElement('afterend', link);
      else sidebar.appendChild(link);
    });
  }

  function attachOrderDesigns() {
    if (document.getElementById('orderDesignAttachments')) return;
    const db = window.frameflow.readDb();
    db.designs = Array.isArray(db.designs) ? db.designs : [];
    const panel = document.createElement('section');
    panel.id = 'orderDesignAttachments';
    panel.className = 'card';
    panel.style.cssText = 'margin:18px 0;padding:18px;background:#fff;border:1px solid #dfe5df;border-radius:12px';
    panel.innerHTML = '<h2>Order design attachment</h2><p class="empty">Attach a saved design or a local photo to an order.</p><form id="orderDesignForm"><select name="orderNumber" required></select><select name="designId"><option value="">No saved design</option></select><input name="image" type="file" accept="image/*"><button class="primary">Attach</button></form><p id="orderAttachmentStatus" class="empty"></p>';
    const content = document.querySelector('.content');
    if (!content) return;
    content.appendChild(panel);
    const form = panel.querySelector('form');
    form.elements.orderNumber.innerHTML = (db.orders || []).map((order) => `<option value="${order.number}">${order.number} · ${order.customer || 'Customer'}</option>`).join('') || '<option value="">No orders yet</option>';
    form.elements.designId.innerHTML += db.designs.map((design) => `<option value="${design.id}">${design.name} · ${design.type}</option>`).join('');
    form.onsubmit = (event) => {
      event.preventDefault();
      const order = db.orders.find((entry) => entry.number === form.elements.orderNumber.value);
      if (!order) return alert('Create an order before attaching a design.');
      const design = db.designs.find((entry) => entry.id === form.elements.designId.value);
      const file = form.elements.image.files[0];
      const commit = (image) => { order.designId = design?.id || order.designId || ''; order.designName = design?.name || order.designName || ''; order.designImage = image || design?.image || order.designImage || ''; order.updatedAt = new Date().toISOString(); window.frameflow.saveDb(db); panel.querySelector('#orderAttachmentStatus').textContent = `Attachment saved to ${order.number}.`; };
      if (!file) return commit();
      if (file.size > 2 * 1024 * 1024) return alert('Please choose an image smaller than 2 MB.');
      const reader = new FileReader(); reader.onload = () => commit(reader.result); reader.readAsDataURL(file);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderStatus);
  else renderStatus();
})();
