(function () {
  function boot() {
    if (!window.frameflowPricing) return;
    const content = document.querySelector('.content'); if (!content || document.getElementById('pricingSettings')) return;
    const rates = window.frameflowPricing.rates();
    const card = document.createElement('div'); card.className = 'card no-print'; card.id = 'pricingSettings'; card.innerHTML = `<div class="item-head"><h2>Pricing rates</h2><button class="secondary" id="saveRates">Save rates</button></div><p class="empty">Rates are used by the designer and quotation calculator. Area-based profile, glass and service costs are in GBP.</p><div class="form-grid"><label class="field"><span>Default profile / m²</span><input name="areaRate" type="number" min="0" step="0.01" value="${rates.areaRate}"></label><label class="field"><span>Hardware / unit</span><input name="hardware" type="number" min="0" step="0.01" value="${rates.hardware}"></label><label class="field"><span>Labour / unit</span><input name="labour" type="number" min="0" step="0.01" value="${rates.labour}"></label><label class="field"><span>Installation / unit</span><input name="installation" type="number" min="0" step="0.01" value="${rates.installation}"></label><label class="field"><span>Delivery / quote</span><input name="delivery" type="number" min="0" step="0.01" value="${rates.delivery}"></label><label class="field"><span>VAT %</span><input name="vatRate" type="number" min="0" max="100" step="0.1" value="${rates.vatRate}"></label></div>`; content.insertBefore(card, content.children[1] || null);
    card.querySelector('#saveRates').onclick = () => { const next = {}; card.querySelectorAll('input').forEach((input) => { next[input.name] = Number(input.value) || 0; }); window.frameflowPricing.save(next); alert('Pricing rates saved.'); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
