(function () {
  function boot() {
    if (!window.frameflow) return;
    const db = window.frameflow.readDb();
    db.measurements = Array.isArray(db.measurements) ? db.measurements : [];
    const save = () => window.frameflow.saveDb(db);
    const content = document.querySelector('.content');
    if (!content) return;

    content.innerHTML = `
      <div class="heading"><div><div class="kicker">CRM</div><h1>Customers</h1><p>Contacts, project measurements and complete commercial history.</p></div><div class="actions"><button class="primary" id="newCustomer">+ Add customer</button></div></div>
      <div class="card">
        <div class="toolbar"><input id="customerSearch" placeholder="Search name, company, phone, email, city or postcode…"><select id="customerFilter"><option value="">All customers</option><option value="history">With history</option><option value="measurements">With measurements</option></select><select id="customerSort"><option value="name">Sort by name</option><option value="recent">Sort by recent</option><option value="history">Sort by history</option></select></div>
        <div style="overflow:auto"><table><thead class="thead"><tr><th>Name</th><th>Contact</th><th>Address</th><th>History</th><th>Measurements</th><th>Actions</th></tr></thead><tbody id="customerRows"></tbody></table></div>
      </div>
      <div class="card" id="measurementPanel"><div class="item-head"><h2>Measurements</h2><button class="secondary" id="newMeasurement">+ Add measurement</button></div><div id="measurementRows"></div></div>
      <div class="modal" id="customerModal"><div class="modal-box"><h2 id="customerModalTitle">Add customer</h2><form id="customerForm"><input type="hidden" name="id"><div class="form-grid"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Company</span><input name="company"></label><label class="field"><span>Phone</span><input name="phone"></label><label class="field"><span>Email</span><input name="email" type="email"></label><label class="field full"><span>Address</span><textarea name="address"></textarea></label><label class="field"><span>City</span><input name="city"></label><label class="field"><span>Postcode</span><input name="postcode"></label><label class="field full"><span>Notes</span><textarea name="notes"></textarea></label></div><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Save customer</button></div></form></div></div>
      <div class="modal" id="measurementModal"><div class="modal-box"><h2>Add measurement</h2><form id="measurementForm"><div class="form-grid"><label class="field"><span>Customer</span><select name="customerId" required></select></label><label class="field"><span>Room / location</span><input name="location" required></label><label class="field"><span>Width (mm)</span><input name="width" type="number" min="1" required></label><label class="field"><span>Height (mm)</span><input name="height" type="number" min="1" required></label><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" value="1" required></label><label class="field full"><span>Notes</span><textarea name="notes"></textarea></label></div><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Save measurement</button></div></form></div></div>`;

    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
    const customerId = (customer) => customer.id || customer.name;
    const history = (customer) => {
      const name = customer.name || '';
      const quotes = (db.quotes || []).filter((entry) => entry.customerId === customerId(customer) || entry.customer === name).length;
      const orders = (db.orders || []).filter((entry) => entry.customerId === customerId(customer) || entry.customer === name).length;
      const invoices = (db.invoices || []).filter((entry) => entry.customerId === customerId(customer) || entry.customer === name).length;
      return { quotes, orders, invoices, total: quotes + orders + invoices };
    };

    function renderCustomers() {
      const query = ($('customerSearch').value || '').toLowerCase();
      const filter = $('customerFilter').value;
      const sort = $('customerSort').value;
      const list = (db.customers || []).filter((customer) => {
        const text = [customer.name, customer.company, customer.phone, customer.email, customer.address, customer.city, customer.postcode, customer.notes].join(' ').toLowerCase();
        const recordHistory = history(customer);
        const hasMeasurements = db.measurements.some((measurement) => measurement.customerId === customerId(customer));
        return (!query || text.includes(query)) && (!filter || (filter === 'history' ? recordHistory.total > 0 : hasMeasurements));
      }).sort((a, b) => sort === 'recent' ? String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) : sort === 'history' ? history(b).total - history(a).total : String(a.name || '').localeCompare(String(b.name || '')));
      $('customerRows').innerHTML = list.map((customer) => { const recordHistory = history(customer); const id = customerId(customer); return `<tr><td><strong>${esc(customer.name || 'Unnamed')}</strong><br><small>${esc(customer.company || '')}</small></td><td>${esc(customer.phone || '—')}<br>${esc(customer.email || '—')}</td><td>${esc(customer.address || '—')}<br>${esc([customer.city, customer.postcode].filter(Boolean).join(', '))}</td><td>Q ${recordHistory.quotes} · O ${recordHistory.orders} · I ${recordHistory.invoices}</td><td>${db.measurements.filter((measurement) => measurement.customerId === id).length}</td><td><div class="actions-cell"><button class="mini secondary" data-edit="${esc(id)}">Edit</button><button class="mini danger" data-delete="${esc(id)}">Delete</button></div></td></tr>`; }).join('') || '<tr><td colspan="6">No customers match your filters.</td></tr>';
    }

    function renderMeasurements() {
      const nameById = Object.fromEntries((db.customers || []).map((customer) => [customerId(customer), customer.name]));
      $('measurementRows').innerHTML = db.measurements.length ? `<div style="overflow:auto"><table><thead class="thead"><tr><th>Customer</th><th>Location</th><th>Size</th><th>Qty</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${db.measurements.map((measurement) => `<tr><td>${esc(nameById[measurement.customerId] || measurement.customer || 'Unknown')}</td><td>${esc(measurement.location)}</td><td>${measurement.width} × ${measurement.height} mm</td><td>${measurement.quantity}</td><td>${esc(measurement.notes || '—')}</td><td><button class="mini danger" data-measurement-delete="${esc(measurement.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No measurements recorded yet.</p>';
    }

    function openCustomer(customer) {
      const form = $('customerForm'); form.reset();
      if (customer) Object.keys(customer).forEach((key) => { if (form.elements[key]) form.elements[key].value = customer[key] || ''; });
      $('customerModalTitle').textContent = customer ? 'Edit customer' : 'Add customer'; $('customerModal').classList.add('show');
    }
    function closeModal(modal) { modal.classList.remove('show'); }

    $('newCustomer').onclick = () => openCustomer(null);
    $('customerSearch').oninput = renderCustomers; $('customerFilter').onchange = renderCustomers; $('customerSort').onchange = renderCustomers;
    $('customerRows').onclick = (event) => {
      const editId = event.target.dataset.edit; const deleteId = event.target.dataset.delete;
      if (editId) openCustomer((db.customers || []).find((customer) => customerId(customer) === editId));
      if (deleteId) { const customer = db.customers.find((entry) => customerId(entry) === deleteId); if (customer && confirm(`Delete ${customer.name}?`)) { db.customers = db.customers.filter((entry) => customerId(entry) !== deleteId); save(); renderCustomers(); renderMeasurements(); } }
    };
    document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => closeModal(button.closest('.modal')));
    $('customerForm').onsubmit = (event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.target).entries()); const id = payload.id || `CUST-${Date.now()}`; const record = { ...payload, id, updatedAt: new Date().toISOString() }; const index = db.customers.findIndex((customer) => customerId(customer) === id); if (index >= 0) db.customers[index] = { ...db.customers[index], ...record }; else db.customers.push(record); save(); closeModal($('customerModal')); renderCustomers(); };
    $('newMeasurement').onclick = () => { $('measurementForm').reset(); $('measurementForm').customerId.innerHTML = db.customers.map((customer) => `<option value="${esc(customerId(customer))}">${esc(customer.name)}</option>`).join('') || '<option value="">Create a customer first</option>'; $('measurementModal').classList.add('show'); };
    $('measurementForm').onsubmit = (event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.target).entries()); if (!payload.customerId) return alert('Create a customer before adding measurements.'); db.measurements.push({ ...payload, id: `MEAS-${Date.now()}`, width: Number(payload.width), height: Number(payload.height), quantity: Number(payload.quantity), createdAt: new Date().toISOString() }); save(); closeModal($('measurementModal')); renderCustomers(); renderMeasurements(); };
    $('measurementRows').onclick = (event) => { const id = event.target.dataset.measurementDelete; if (id && confirm('Delete this measurement?')) { db.measurements = db.measurements.filter((measurement) => measurement.id !== id); save(); renderCustomers(); renderMeasurements(); } };
    renderCustomers(); renderMeasurements();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
