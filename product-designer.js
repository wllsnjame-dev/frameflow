(function () {
  function boot() {
    if (!window.frameflow) return;
    const db = window.frameflow.readDb();
    db.designs = Array.isArray(db.designs) ? db.designs : [];
    const save = () => window.frameflow.saveDb(db);
    const content = document.querySelector('.content'); if (!content) return;
    const style = document.createElement('style');
    style.textContent = '.design-thumb{width:72px;height:52px;object-fit:cover;border:1px solid #dfe5df;border-radius:6px}.designer-preview{display:flex;align-items:center;gap:14px;margin:18px 0;padding:16px;background:#f6faf8;border:1px solid #dfe5df;border-radius:8px}.preview-frame{width:calc(120px * var(--ratio, 1));max-width:65%;height:120px;border:8px solid var(--frame-colour,#087f78);background:linear-gradient(90deg,transparent 48%,#087f78 49%,#087f78 51%,transparent 52%),linear-gradient(0deg,transparent 48%,#087f78 49%,#087f78 51%,transparent 52%),#dcebea}.empty{color:#6f7b7d;font-size:12px}.modal{z-index:10}';
    document.head.appendChild(style);
    content.innerHTML = `
      <div class="heading"><div><div class="kicker">Catalogue + design studio</div><h1>Products & Designer</h1><p>Build reusable window and door designs with measurements, options and images.</p></div><div class="actions"><button class="primary" id="newDesign">+ New design</button></div></div>
      <div class="card"><div class="toolbar"><input id="productSearch" placeholder="Search products and designs…"><select id="productTypeFilter"><option value="">All types</option><option>Window</option><option>Door</option><option>Sliding</option><option>Casement</option><option>Fixed</option><option>French Door</option><option>Bi-fold Door</option><option>UPVC Window</option><option>UPVC Door</option><option>Aluminium Window</option><option>Aluminium Door</option><option>Aluminium Sliding Door</option></select></div><div style="overflow:auto"><table><thead class="thead"><tr><th>Design</th><th>Type</th><th>Size</th><th>Options</th><th>Preview</th><th>Actions</th></tr></thead><tbody id="designRows"></tbody></table></div></div>
      <div class="modal" id="designModal"><div class="modal-box"><h2 id="designTitle">New window or door design</h2><form id="designForm"><input type="hidden" name="id"><div class="form-grid"><label class="field"><span>Design name</span><input name="name" required></label><label class="field"><span>Type</span><select name="type"><option>Window</option><option>Door</option><option>Sliding</option><option>Casement</option><option>Fixed</option><option>French Door</option><option>Bi-fold Door</option><option>UPVC Window</option><option>UPVC Door</option><option>Aluminium Window</option><option>Aluminium Door</option><option>Aluminium Sliding Door</option></select></label><label class="field"><span>Frame material</span><select name="frameMaterial"><option value="">Select material</option><option>UPVC</option><option>Aluminium</option><option>Composite</option></select></label><label class="field"><span>Width (mm)</span><input name="width" type="number" min="1" required></label><label class="field"><span>Height (mm)</span><input name="height" type="number" min="1" required></label><label class="field"><span>Frame / profile</span><input name="profile" placeholder="70mm UPVC, aluminium…"></label><label class="field"><span>Frame colour</span><input name="frameColour" placeholder="White, Anthracite…"></label><label class="field"><span>Glass specification</span><input name="glass" placeholder="Double glazed, laminated…"></label><label class="field"><span>Glass colour</span><input name="glassColour"></label><label class="field"><span>Glass thickness</span><input name="glassThickness" placeholder="24mm"></label><label class="field"><span>Panels</span><input name="panels" placeholder="1, 2, Georgian…"></label><label class="field"><span>Opening direction</span><input name="openingDirection" placeholder="Left, right, tilt & turn…"></label><label class="field"><span>Handles</span><input name="handles"></label><label class="field"><span>Mesh</span><input name="mesh" placeholder="None, fly screen…"></label><label class="field"><span>Accessories</span><input name="accessories"></label><label class="field"><span>Quantity</span><input name="quantity" type="number" min="1" value="1"></label><label class="field"><span>Unit price (£)</span><input name="price" type="number" min="0" step="0.01"></label><label class="field full"><span>Notes</span><textarea name="notes"></textarea></label><label class="field full"><span>Photo / design image</span><input id="designImage" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><small>Choose an image up to 1 MB to keep the local and synced factory record compact.</small></label></div><div class="designer-preview" id="designerPreview"><div class="preview-frame"><span class="preview-cross"></span></div><div id="previewLabel">1200 × 1200 mm</div></div><div class="actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Save design</button></div></form></div></div>`;
    const $ = (id) => document.getElementById(id); const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char])); let editing = null;
    const headingActions = content.querySelector('.heading .actions');
    if (headingActions && !$('newProduct')) {
      const addProduct = document.createElement('button');
      addProduct.type = 'button'; addProduct.id = 'newProduct'; addProduct.className = 'primary'; addProduct.textContent = '+ Add product';
      const newDesign = $('newDesign');
      if (newDesign) { newDesign.className = 'secondary'; headingActions.insertBefore(addProduct, newDesign); }
      else headingActions.appendChild(addProduct);
    }
    const fields = ['id','name','type','frameMaterial','width','height','profile','frameColour','glass','glassColour','glassThickness','panels','openingDirection','handles','mesh','accessories','quantity','price','notes','imageUrl','image'];
    const imageInput = $('designImage');
    const imageField = imageInput?.closest('.field');
    if (imageField && !$('designImageUrl')) {
      const urlField = document.createElement('label');
      urlField.className = 'field full';
      urlField.innerHTML = '<span>Photo URL</span><input id="designImageUrl" name="imageUrl" type="url" placeholder="https://example.com/window-profile.jpg">';
      const previewField = document.createElement('div');
      previewField.id = 'designImagePreview';
      previewField.className = 'field full';
      previewField.setAttribute('aria-live', 'polite');
      imageField.insertAdjacentElement('afterend', urlField);
      urlField.insertAdjacentElement('afterend', previewField);
    }
    function safeImageSource(value) {
      const source = String(value || '').trim();
      if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(source)) return source;
      try { const url = new URL(source, location.href); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
      catch { return ''; }
    }
    function imageFor(form) { return safeImageSource(form.dataset.image) || safeImageSource(form.elements.imageUrl?.value) || ''; }
    function previewImage() {
      const previewHost = $('designImagePreview');
      if (!previewHost) return;
      const source = imageFor($('designForm'));
      previewHost.replaceChildren();
      if (!source) { previewHost.textContent = 'No image preview selected.'; return; }
      const image = document.createElement('img');
      image.src = source;
      image.alt = 'Product or design preview';
      image.style.cssText = 'display:block;max-width:240px;max-height:160px;object-fit:contain;border:1px solid #dfe5df;border-radius:4px';
      image.onerror = () => { previewHost.textContent = 'Image could not be loaded.'; };
      previewHost.appendChild(image);
    }
    function render() { const query = ($('productSearch').value || '').toLowerCase(); const type = $('productTypeFilter').value; const list = [...(db.products || []).filter((item) => !item.archived).map((item) => ({ ...item, source: 'Product' })), ...db.designs.map((item) => ({ ...item, source: 'Design' }))].filter((item) => (!type || item.type === type) && (!query || JSON.stringify(item).toLowerCase().includes(query))); $('designRows').innerHTML = list.map((item) => { const image = safeImageSource(item.image) || safeImageSource(item.imageUrl); const specs = [item.frameMaterial || item.material, item.profile, item.frameColour || item.colour, item.glass, item.glassThickness, item.openingDirection || item.opening].filter(Boolean).join(' · '); return `<tr><td><strong>${esc(item.name || item.productName || item.type || 'Unnamed')}</strong><br><small>${item.source}</small></td><td>${esc(item.type || '—')}</td><td>${item.width || 0} × ${item.height || 0} mm</td><td>${esc(specs || '—')}</td><td>${image ? `<img class="design-thumb" src="${esc(image)}" alt="${esc(item.name || item.type || 'Product')} preview" loading="lazy">` : '<span class="empty">No image</span>'}</td><td><button class="mini secondary" data-edit="${esc(item.id || item.name)}" data-source="${item.source}">Edit</button>${item.source === 'Design' ? `<button class="mini danger" data-delete="${esc(item.id)}">Delete</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6">No products or designs match your filters.</td></tr>'; }
    function preview() { const form = $('designForm'); const width = Number(form.width.value || 1200); const height = Number(form.height.value || 1200); $('previewLabel').textContent = `${width} × ${height} mm`; $('designerPreview').style.setProperty('--ratio', `${Math.min(2.4, Math.max(.45, width / height))}`); $('designerPreview').style.setProperty('--frame-colour', form.frameColour.value || '#087f78'); }
    function open(item, source) { const itemSource = source || 'Design'; editing = item ? { item, source: itemSource } : (source ? { item: null, source: itemSource } : null); const form = $('designForm'); form.reset(); fields.forEach((key) => { if (form.elements[key] && key !== 'image') form.elements[key].value = item?.[key] || ''; }); if (item) { $('designTitle').textContent = itemSource === 'Product' ? 'Edit product' : 'Edit design'; form.dataset.image = /^data:image\//i.test(item.image || '') ? item.image : ''; if (!form.elements.imageUrl.value && /^https?:\/\//i.test(item.image || '')) form.elements.imageUrl.value = item.image; if (!form.elements.frameMaterial.value) form.elements.frameMaterial.value = /aluminium/i.test(`${item.type || ''} ${item.profile || ''}`) ? 'Aluminium' : /upvc/i.test(`${item.type || ''} ${item.profile || ''}`) ? 'UPVC' : ''; } else { form.width.value = 1200; form.height.value = 1200; form.quantity.value = 1; form.dataset.image = ''; form.frameMaterial.value = itemSource === 'Product' ? 'UPVC' : ''; $('designTitle').textContent = itemSource === 'Product' ? 'Add catalogue product' : 'New window or door design'; } form.querySelector('button.primary').textContent = itemSource === 'Product' ? 'Save product' : 'Save design'; $('designModal').classList.add('show'); preview(); previewImage(); }
    $('newDesign').onclick = () => open(null, 'Design'); $('newProduct').onclick = () => open(null, 'Product'); $('productSearch').oninput = render; $('productTypeFilter').onchange = render; document.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => button.closest('.modal').classList.remove('show')); $('designForm').oninput = () => { preview(); previewImage(); };
    $('designForm').elements.type.addEventListener('change', (event) => {
      const type = event.target.value;
      if (/aluminium/i.test(type)) $('designForm').elements.frameMaterial.value = 'Aluminium';
      else if (/upvc/i.test(type)) $('designForm').elements.frameMaterial.value = 'UPVC';
      else if (/composite/i.test(type)) $('designForm').elements.frameMaterial.value = 'Composite';
    });
    $('designImage').onchange = () => { const file = $('designImage').files[0]; if (!file) return; if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { $('designImage').value = ''; return alert('Choose a PNG, JPEG, WebP or GIF image.'); } if (file.size > 1024 * 1024) { $('designImage').value = ''; return alert('Please choose an image smaller than 1 MB for browser storage.'); } const reader = new FileReader(); reader.onload = () => { $('designForm').dataset.image = reader.result; $('designImageUrl').value = ''; previewImage(); }; reader.onerror = () => alert('The selected image could not be read. Please try another file.'); reader.readAsDataURL(file); };
    $('designImageUrl').addEventListener('input', () => { $('designForm').dataset.image = ''; $('designImage').value = ''; previewImage(); });
    $('designForm').onsubmit = (event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.target).entries()); if (Number(payload.width) <= 0 || Number(payload.height) <= 0) return alert('Width and height must be greater than zero.'); const source = editing?.source || 'Design'; const original = editing?.item; const inferredMaterial = /aluminium/i.test(`${payload.type || ''} ${payload.profile || ''}`) ? 'Aluminium' : /upvc/i.test(`${payload.type || ''} ${payload.profile || ''}`) ? 'UPVC' : ''; const record = { ...payload, id: payload.id || `${source === 'Product' ? 'PRODUCT' : 'DESIGN'}-${Date.now()}`, width: Number(payload.width), height: Number(payload.height), quantity: Number(payload.quantity || 1), price: Number(payload.price || 0), colour: payload.frameColour || '', frameMaterial: payload.frameMaterial || inferredMaterial, image: imageFor(event.target), imageUrl: safeImageSource(payload.imageUrl), updatedAt: new Date().toISOString() }; const collection = source === 'Product' ? db.products : db.designs; const index = collection.findIndex((item) => (item.id || item.name) === (original?.id || original?.name || record.id)); if (index >= 0) collection[index] = { ...collection[index], ...record }; else collection.push(record); save(); $('designModal').classList.remove('show'); render(); };
    $('designRows').onclick = (event) => { const item = event.target.closest('button'); if (!item) return; if (item.dataset.delete && confirm('Delete this design?')) { db.designs = db.designs.filter((design) => design.id !== item.dataset.delete); save(); render(); } if (item.dataset.edit) { const collection = item.dataset.source === 'Design' ? db.designs : db.products; open(collection.find((entry) => (entry.id || entry.name) === item.dataset.edit), item.dataset.source); } };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
