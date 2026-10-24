(function () {
  function boot() {
    if (!window.frameflowPricing) return;
    const modal = document.getElementById('designModal'); if (!modal || document.getElementById('designerPrice')) return;
    const output = document.createElement('strong'); output.id = 'designerPrice'; output.style.cssText = 'display:block;color:#087f78;font-size:20px;margin-top:5px'; output.textContent = '£0.00 estimated';
    const preview = document.getElementById('designerPreview'); if (preview) preview.appendChild(output);
    const update = () => { const form = document.getElementById('designForm'); if (!form) return; const result = window.frameflowPricing.line({ type: form.elements.type.value, width: form.elements.width.value, height: form.elements.height.value, quantity: 1, glass: form.elements.glass.value, glassThickness: form.elements.glassThickness.value }); output.textContent = `${new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(result.unitPrice)} estimated`; };
    modal.addEventListener('input', update); modal.addEventListener('change', update); update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
