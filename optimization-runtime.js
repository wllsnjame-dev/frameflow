(function () {
  if (window.frameflowOptimization) return;

  const BAR_LENGTH = 6000;
  const DEFAULT_KERF = 3;
  const activeStatuses = new Set(['new', 'confirmed', 'in production', 'ready']);
  const $ = (id) => document.getElementById(id);
  const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const readDb = () => window.frameflow ? window.frameflow.readDb() : JSON.parse(localStorage.getItem('frameflow') || '{}');
  const money = (value) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(numeric(value));

  function normalizeStatus(status) {
    return String(status || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  }

  function findProduct(db, line, order) {
    const productValue = line.productId || line.product_id || line.product || order.productId || order.product_id || order.product;
    if (productValue && typeof productValue === 'object') return productValue;
    const wanted = String(productValue || line.productName || line.product_name || '').toLowerCase();
    return (db.products || []).find((product) => [product.id, product.name, product.productName, product.type].some((value) => String(value || '').toLowerCase() === wanted)) || {};
  }

  function getOrderItems(db, order) {
    if (Array.isArray(order.items) && order.items.length) return order.items;
    if (Array.isArray(order.orderItems) && order.orderItems.length) return order.orderItems;
    const orderNumber = order.number || order.orderNumber || order.order_number;
    const relational = (db.orderItems || []).filter((item) => [item.orderNumber, item.order_number, item.orderId, item.order_id].some((value) => String(value || '') === String(orderNumber || order.id || '')));
    if (relational.length) return relational;
    const quote = (db.quotes || []).find((item) => item.number === order.quoteNumber || item.id === order.quoteId || item.id === order.quote_id);
    if (Array.isArray(quote?.items) && quote.items.length) return quote.items;
    const product = findProduct(db, {}, order);
    return product.width || product.widthMm || product.width_mm ? [product] : [];
  }

  function profileFor(item, product) {
    const profile = item.profile || item.frameProfile || item.profileType || item.profile_type || product.profile || product.frameProfile || product.type || item.type || item.productType || 'UPVC Profile';
    const colour = item.frameColour || item.colour || item.color || product.frameColour || product.colour || '';
    const material = item.frameMaterial || item.material || product.frameMaterial || product.material || (/aluminium/i.test(`${profile} ${item.type || ''} ${product.type || ''}`) ? 'Aluminium' : /upvc/i.test(`${profile} ${item.type || ''} ${product.type || ''}`) ? 'UPVC' : '');
    return { name: String(profile), colour: String(colour), material: String(material), key: `${String(material).trim().toLowerCase()}|${String(profile).trim().toLowerCase()}|${String(colour).trim().toLowerCase()}` };
  }

  function makeCuts(db) {
    const orders = (db.orders || []).filter((order) => activeStatuses.has(normalizeStatus(order.status)));
    const cuts = [];
    const missing = [];
    orders.forEach((order) => {
      const orderNumber = order.number || order.orderNumber || order.order_number || 'Order';
      const lines = getOrderItems(db, order);
      if (!lines.length) {
        missing.push({ orderNumber, reason: 'No order items or linked product dimensions' });
        return;
      }
      lines.forEach((line, lineIndex) => {
        const product = findProduct(db, line, order);
        const item = { ...product, ...line };
        const width = numeric(item.width ?? item.widthMm ?? item.width_mm);
        const height = numeric(item.height ?? item.heightMm ?? item.height_mm);
        const quantity = Math.max(0, Math.floor(numeric(item.quantity, numeric(product.quantity, 1))));
        const productName = item.name || item.productName || item.product_name || item.type || item.productType || product.name || product.type || 'Window / Door';
        if (quantity < 1) return;
        if (Array.isArray(item.cutLengths) && item.cutLengths.length) {
          const profile = profileFor(item, product);
          item.cutLengths.forEach((cut) => {
            const length = numeric(typeof cut === 'number' ? cut : cut.length ?? cut.lengthMm ?? cut.length_mm);
            const count = Math.max(0, Math.floor(numeric(typeof cut === 'object' ? cut.quantity ?? cut.count : 1, 1))) * quantity;
            for (let index = 0; index < count; index += 1) {
              if (length > 0 && length <= BAR_LENGTH) cuts.push({ length, orderNumber, productName: cut.label || productName, orientation: cut.orientation || 'Custom', profile: cut.profile || profile.name, colour: profile.colour, material: profile.material, lineIndex });
              else if (length > BAR_LENGTH) missing.push({ orderNumber, reason: `${productName}: ${length} mm cut exceeds the 6000 mm bar` });
            }
          });
          return;
        }
        if (!width || !height) {
          missing.push({ orderNumber, reason: `${productName}: width or height is missing` });
          return;
        }
        if (width > BAR_LENGTH || height > BAR_LENGTH) {
          missing.push({ orderNumber, reason: `${productName}: dimension exceeds the 6000 mm bar` });
          return;
        }
        const profile = profileFor(item, product);
        for (let index = 0; index < quantity; index += 1) {
          for (let pair = 0; pair < 2; pair += 1) {
            cuts.push({ length: width, orderNumber, productName, orientation: 'Width', profile: profile.name, colour: profile.colour, material: profile.material, lineIndex });
            cuts.push({ length: height, orderNumber, productName, orientation: 'Height', profile: profile.name, colour: profile.colour, material: profile.material, lineIndex });
          }
        }
      });
    });
    return { orders, cuts, missing };
  }

  function packCuts(cuts, kerf) {
    const groups = new Map();
    cuts.forEach((cut) => {
      const material = String(cut.material || '');
      const profile = String(cut.profile || 'UPVC Profile');
      const colour = String(cut.colour || '');
      const key = `${material.trim().toLowerCase()}|${profile.trim().toLowerCase()}|${colour.trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, { name: profile, colour, material, cuts: [] });
      groups.get(key).cuts.push(cut);
    });
    const results = [];
    groups.forEach((group) => {
      const sorted = group.cuts.slice().sort((a, b) => b.length - a.length || a.orderNumber.localeCompare(b.orderNumber));
      const bars = [];
      sorted.forEach((cut) => {
        let bar = bars.find((candidate) => candidate.used + (candidate.cuts.length ? kerf : 0) + cut.length <= BAR_LENGTH + 0.000001);
        if (!bar) {
          bar = { cuts: [], used: 0, kerfWaste: 0 };
          bars.push(bar);
        }
        const kerfBeforeCut = bar.cuts.length ? kerf : 0;
        bar.cuts.push(cut);
        bar.used += cut.length + kerfBeforeCut;
        bar.kerfWaste += kerfBeforeCut;
      });
      bars.forEach((bar) => {
        bar.cutLength = bar.cuts.reduce((sum, cut) => sum + cut.length, 0);
        bar.scrapLength = Math.max(0, BAR_LENGTH - bar.used);
        bar.kerfWaste = Math.max(0, bar.cuts.length - 1) * kerf;
      });
      results.push({ ...group, bars });
    });
    return results;
  }

  function calculate(db, kerf) {
    const demand = makeCuts(db);
    const groups = packCuts(demand.cuts, kerf);
    const bars = groups.flatMap((group) => group.bars.map((bar, index) => ({ ...bar, profile: group.name, colour: group.colour, material: group.material, groupKey: `${group.material}|${group.name}|${group.colour}`, barNumber: index + 1 })));
    const totalCutLength = bars.reduce((sum, bar) => sum + bar.cutLength, 0);
    const kerfWaste = bars.reduce((sum, bar) => sum + bar.kerfWaste, 0);
    const scrapLength = bars.reduce((sum, bar) => sum + bar.scrapLength, 0);
    const barCapacity = bars.length * BAR_LENGTH;
    return { ...demand, groups, bars, totalCutLength, kerfWaste, scrapLength, totalWaste: kerfWaste + scrapLength, barCapacity, efficiency: barCapacity ? totalCutLength / barCapacity * 100 : 0 };
  }

  function saveKerf(value) {
    const db = readDb();
    db.settings = { ...(db.settings || {}), optimizationKerfMm: value };
    if (window.frameflow) window.frameflow.saveDb(db);
    else localStorage.setItem('frameflow', JSON.stringify(db));
  }

  function render() {
    const db = readDb();
    const kerf = Math.max(0, numeric($('kerf').value, DEFAULT_KERF));
    const report = calculate(db, kerf);
    const cards = [
      ['Active orders', report.orders.length],
      ['Profile pieces', report.cuts.length],
      ['Standard bars required', report.bars.length],
      ['Cut-length efficiency', `${report.efficiency.toFixed(1)}%`],
      ['Scrap / kerf waste', `${(report.totalWaste / 1000).toFixed(2)} m`]
    ];
    $('metrics').innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('summary').textContent = `${(report.totalCutLength / 1000).toFixed(2)} m cut length · ${(report.kerfWaste / 1000).toFixed(2)} m saw loss · ${(report.scrapLength / 1000).toFixed(2)} m remaining offcuts · 6000 mm stock bars`;
    $('cutCount').textContent = `${report.cuts.length} cuts from ${report.orders.length} active orders`;
    $('groups').innerHTML = report.groups.length ? report.groups.map((group) => `<section class="profile-group"><header><h2>${group.material ? `${escapeHtml(group.material)} · ` : ''}${escapeHtml(group.name)}${group.colour ? ` · ${escapeHtml(group.colour)}` : ''}</h2><span>${group.bars.length} bar${group.bars.length === 1 ? '' : 's'} · ${group.bars.reduce((sum, bar) => sum + bar.cuts.length, 0)} cuts</span></header>${group.bars.map((bar, index) => renderBar(group, bar, index + 1, kerf)).join('')}</section>`).join('') : '<div class="empty-state">No dimensional demand found in active orders. Add order items with width and height in millimetres.</div>';
    $('warnings').innerHTML = report.missing.length ? `<section class="warning"><h2>Items not optimized</h2><ul>${report.missing.map((item) => `<li><strong>${escapeHtml(item.orderNumber)}</strong> · ${escapeHtml(item.reason)}</li>`).join('')}</ul></section>` : '';
    window.frameflowOptimization.lastResult = report;
  }

  function renderBar(group, bar, barNumber, kerf) {
    let offset = 0;
    const pieces = bar.cuts.map((cut, index) => {
      const left = offset / BAR_LENGTH * 100;
      const width = cut.length / BAR_LENGTH * 100;
      offset += cut.length + (index < bar.cuts.length - 1 ? kerf : 0);
      return `<span class="cut-piece" style="left:${left}%;width:${width}%" title="${escapeHtml(cut.orderNumber)} · ${escapeHtml(cut.productName)} · ${cut.orientation} ${cut.length} mm">${cut.length} mm</span>`;
    }).join('');
    const kerfs = bar.cuts.map((cut, index) => {
      if (kerf <= 0 || index === bar.cuts.length - 1) return '';
      const position = bar.cuts.slice(0, index + 1).reduce((sum, piece) => sum + piece.length, 0) + index * kerf + kerf / 2;
      return `<i class="kerf-mark" style="left:${position / BAR_LENGTH * 100}%" title="Saw kerf ${kerf} mm"></i>`;
    }).join('');
    const scrapLeft = Math.max(0, 100 - offset / BAR_LENGTH * 100);
    const scrap = scrapLeft > 0 ? `<span class="scrap-piece" style="left:${offset / BAR_LENGTH * 100}%;width:${scrapLeft}%" title="Remaining offcut ${bar.scrapLength} mm">${bar.scrapLength} mm offcut</span>` : '';
    const cutList = bar.cuts.map((cut) => `<li><span>${escapeHtml(cut.orderNumber)} · ${escapeHtml(cut.productName)} · ${cut.orientation}</span><strong>${cut.length} mm</strong></li>`).join('');
    return `<article class="bar-card"><div class="bar-heading"><strong>Bar ${barNumber}</strong><span>${bar.cutLength} mm product · ${bar.kerfWaste} mm kerf · ${bar.scrapLength} mm offcut</span></div><div class="bar-track" role="img" aria-label="${escapeHtml(group.name)} 6000 mm bar, ${bar.cuts.length} cuts, ${bar.scrapLength} mm offcut">${pieces}${kerfs}${scrap}</div><details><summary>View cut assignments (${bar.cuts.length})</summary><ul class="cut-assignments">${cutList}</ul></details></article>`;
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+@\-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCsv() {
    const report = window.frameflowOptimization.lastResult || calculate(readDb(), numeric($('kerf').value, DEFAULT_KERF));
    const rows = [['FrameFlow profile cut optimization'], ['Bar length (mm)', BAR_LENGTH], ['Saw kerf (mm)', numeric($('kerf').value, DEFAULT_KERF)], ['Bars required', report.bars.length], ['Efficiency (%)', report.efficiency.toFixed(2)], ['Total product length (mm)', report.totalCutLength], ['Total kerf waste (mm)', report.kerfWaste], ['Total offcut scrap (mm)', report.scrapLength], [], ['Profile', 'Colour', 'Bar', 'Order', 'Product', 'Orientation', 'Cut length (mm)', 'Bar offcut (mm)'], ...report.groups.flatMap((group) => group.bars.flatMap((bar, index) => bar.cuts.map((cut) => [group.name, group.colour, index + 1, cut.orderNumber, cut.productName, cut.orientation, cut.length, bar.scrapLength])))];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frameflow-cut-list-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function machineReport() {
    return window.frameflowOptimization.lastResult || calculate(readDb(), numeric($('kerf').value, DEFAULT_KERF));
  }

  function downloadFile(contents, type, extension) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `frameflow-saw-program-${new Date().toISOString().slice(0, 10)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function machineCsvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function exportMachineCsv() {
    const report = machineReport();
    const kerf = Math.max(0, numeric($('kerf').value, DEFAULT_KERF));
    const rows = [['Program', 'BarNumber', 'StockLengthMm', 'KerfMm', 'Material', 'Profile', 'Colour', 'Sequence', 'OrderNumber', 'ProductName', 'Orientation', 'CutLengthMm', 'OffcutLengthMm']];
    let barNumber = 0;
    report.groups.forEach((group) => group.bars.forEach((bar) => {
      barNumber += 1;
      bar.cuts.forEach((cut, sequence) => rows.push(['FrameFlow Linear Cut Program', barNumber, BAR_LENGTH, kerf, group.material, group.name, group.colour, sequence + 1, cut.orderNumber, cut.productName, cut.orientation, cut.length, bar.scrapLength]));
    }));
    downloadFile(`\uFEFF${rows.map((row) => row.map(machineCsvCell).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8', 'csv');
  }

  function xmlEscape(value) {
    return String(value ?? '').replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]));
  }

  function exportMachineXml() {
    const report = machineReport();
    const kerf = Math.max(0, numeric($('kerf').value, DEFAULT_KERF));
    let barNumber = 0;
    const bars = report.groups.flatMap((group) => group.bars.map((bar) => ({ group, bar, number: ++barNumber })));
    const barXml = bars.map(({ group, bar, number: barNumber }) => `<Bar number="${barNumber}" stockLengthMm="${BAR_LENGTH}" material="${xmlEscape(group.material)}" profile="${xmlEscape(group.name)}" colour="${xmlEscape(group.colour)}" kerfMm="${kerf}" offcutLengthMm="${bar.scrapLength}">${bar.cuts.map((cut, index) => `<Cut sequence="${index + 1}" orderNumber="${xmlEscape(cut.orderNumber)}" product="${xmlEscape(cut.productName)}" orientation="${xmlEscape(cut.orientation)}" lengthMm="${cut.length}"/>`).join('')}</Bar>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<LinearCutProgram version="1.0" source="FrameFlow" generatedAt="${new Date().toISOString()}" barLengthMm="${BAR_LENGTH}" kerfMm="${kerf}"><Summary barCount="${bars.length}" cutCount="${report.cuts.length}" totalCutLengthMm="${report.totalCutLength}" efficiencyPercent="${report.efficiency.toFixed(2)}"/><Bars>${barXml}</Bars></LinearCutProgram>`;
    downloadFile(xml, 'application/xml;charset=utf-8', 'xml');
  }

  function start() {
    if (!$('groups')) return;
    const settings = readDb().settings || {};
    $('kerf').value = numeric(settings.optimizationKerfMm, DEFAULT_KERF);
    $('kerf').addEventListener('input', () => {
      const value = Math.max(0, numeric($('kerf').value, DEFAULT_KERF));
      saveKerf(value);
      render();
    });
    $('refresh').addEventListener('click', render);
    $('print').addEventListener('click', () => window.print());
    $('export').addEventListener('click', exportCsv);
    $('exportMachineCsv').addEventListener('click', exportMachineCsv);
    $('exportMachineXml').addEventListener('click', exportMachineXml);
    window.addEventListener('storage', (event) => { if (event.key === 'frameflow') render(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
    window.frameflowOptimization = { calculate, makeCuts, packCuts, render, exportCsv, exportMachineCsv, exportMachineXml, lastResult: null, barLength: BAR_LENGTH };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
