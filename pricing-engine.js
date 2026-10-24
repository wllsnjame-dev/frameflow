(function () {
  document.addEventListener('DOMContentLoaded', () => { if (location.pathname.toLowerCase().endsWith('/quotation.html') && document.body.firstChild?.nodeType === 3 && document.body.firstChild.textContent.trim() === '+') document.body.firstChild.remove(); });
  const defaults = {
    areaRate: 180,
    profileRates: { Window: 180, Door: 260, Sliding: 300, Casement: 180, Fixed: 150, 'French Door': 280, 'Bi-fold Door': 340, 'UPVC Window': 180, 'UPVC Door': 260, 'Composite Door': 300, 'Patio Door': 300 },
    glassRates: { 'Single glazed': 25, 'Double glazed': 55, 'Triple glazed': 85, Laminated: 75, 'A-rated clear': 55 },
    glassThicknessRates: { '4mm': 0, '24mm': 0, '28mm': 12, '32mm': 20 },
    hardware: 85,
    labour: 95,
    installation: 180,
    delivery: 120,
    vatRate: 20
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function rates() {
    const stored = JSON.parse(localStorage.getItem('frameflowPricing') || 'null') || {};
    return { ...clone(defaults), ...stored, profileRates: { ...defaults.profileRates, ...(stored.profileRates || {}) }, glassRates: { ...defaults.glassRates, ...(stored.glassRates || {}) }, glassThicknessRates: { ...defaults.glassThicknessRates, ...(stored.glassThicknessRates || {}) } };
  }
  function save(next) { localStorage.setItem('frameflowPricing', JSON.stringify({ ...rates(), ...next })); return rates(); }
  function line(item, customRates) {
    const current = customRates || rates();
    const area = Math.max(0, Number(item.width || 0) * Number(item.height || 0) / 1000000);
    const profile = Number(current.profileRates[item.type]) || Number(current.areaRate) || 0;
    const glass = Number(current.glassRates[item.glass]) || 0;
    const thickness = Number(current.glassThicknessRates[item.glassThickness]) || 0;
    const hardware = Number(current.hardware) || 0;
    const labour = Number(current.labour) || 0;
    const installation = Number(current.installation) || 0;
    const delivery = Number(current.delivery) || 0;
    const unitPrice = area * (profile + glass + thickness) + hardware + labour + installation + delivery;
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return { area, unitPrice, quantity, total: unitPrice * quantity, breakdown: { profile: area * profile, glass: area * (glass + thickness), hardware, labour, installation, delivery } };
  }
  function quote(items, discount, vatPercent, customRates) {
    const lines = (items || []).map((item) => ({ item, ...line(item, customRates) }));
    const subtotal = lines.reduce((sum, entry) => sum + entry.total, 0);
    const safeDiscount = Math.max(0, Math.min(Number(discount) || 0, subtotal));
    const vatRate = Math.max(0, Number(vatPercent ?? (customRates || rates()).vatRate) || 0) / 100;
    const vat = (subtotal - safeDiscount) * vatRate;
    return { lines, subtotal, discount: safeDiscount, vatRate, vat, total: subtotal - safeDiscount + vat };
  }
  window.frameflowPricing = { defaults, rates, save, line, quote };
})();
