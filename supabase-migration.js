(function () {
  const migrationOrder = [
    ['customers', 'customers'],
    ['products', 'products'],
    ['quotes', 'quotes'],
    ['quoteItems', 'quote_items'],
    ['orders', 'orders'],
    ['orderItems', 'order_items'],
    ['invoices', 'invoices'],
    ['invoiceItems', 'invoice_items'],
    ['payments', 'payments'],
    ['production', 'production_jobs'],
    ['productionItems', 'production_items'],
    ['productionStatusHistory', 'production_status_history'],
    ['productionQC', 'production_qc'],
    ['stockItems', 'stock_items'],
    ['stockMovements', 'stock_movements'],
    ['productionMaterialsUsed', 'production_materials_used']
  ];

  const relationFields = {
    customer_id: 'customers',
    quote_id: 'quotes',
    quote_item_id: 'quoteItems',
    order_id: 'orders',
    order_item_id: 'orderItems',
    invoice_id: 'invoices',
    product_id: 'products',
    production_job_id: 'production'
  };

  function uuid() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    throw new Error('This browser does not provide crypto.randomUUID().');
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function buildPlan(rawState, factoryId) {
    if (!factoryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(factoryId)) {
      throw new Error('A real FACTORY_ID UUID is required before migration.');
    }

    const state = window.frameflow ? window.frameflow.normalizeState(rawState) : rawState || {};
    const ids = new Map();
    const rows = [];
    const errors = [];
    const settings = state.settings || {};
    rows.push({ sourceKey: 'settings', table: 'factories', sourceId: factoryId, row: {
      id: factoryId,
      name: settings.companyName || state.factoryName || 'Factory',
      address: settings.address || null,
      phone: settings.phone || null,
      email: settings.email || null,
      vat_number: settings.vatNumber || null,
      registration_details: settings.companyRegistration || null,
      website: settings.website || null
    } });

    migrationOrder.forEach(([sourceKey, table]) => {
      asArray(state[sourceKey]).forEach((source, index) => {
        const sourceId = source.id || `${sourceKey}-${index + 1}`;
        const targetId = ids.get(`${sourceKey}:${sourceId}`) || uuid();
        ids.set(`${sourceKey}:${sourceId}`, targetId);
        const row = { ...source, id: targetId, factory_id: factoryId };

        Object.entries(relationFields).forEach(([field, relation]) => {
          const sourceRelation = source[field];
          if (!sourceRelation) return;
          const mapped = ids.get(`${relation}:${sourceRelation}`);
          if (mapped) row[field] = mapped;
          else errors.push(`${table}.${field} references an unmapped record: ${sourceRelation}`);
        });

        if (table === 'production_jobs' && !row.job_number) row.job_number = row.number || `JOB-${index + 1}`;
        rows.push({ sourceKey, table, sourceId, row });
      });
    });

    return { factoryId, rows, errors, counts: rows.reduce((result, item) => { result[item.table] = (result[item.table] || 0) + 1; return result; }, {}) };
  }

  async function migrate(options) {
    const settings = options || {};
    const plan = buildPlan(settings.state || (window.frameflow && window.frameflow.readDb()), settings.factoryId);
    if (plan.errors.length || settings.dryRun !== false) return { dryRun: true, inserted: 0, verified: 0, plan };
    if (!settings.client || typeof settings.client.insert !== 'function' || typeof settings.client.verify !== 'function') {
      throw new Error('A server-side or trusted Supabase client with insert() and verify() is required.');
    }

    let inserted = 0;
    const failures = [];
    for (const item of plan.rows) {
      try {
        await settings.client.insert(item.table, item.row);
        inserted += 1;
      } catch (error) {
        failures.push({ table: item.table, sourceId: item.sourceId, message: error.message });
      }
    }
    const verified = await settings.client.verify(plan.rows);
    return { dryRun: false, inserted, verified, failures, plan };
  }

  window.frameflowMigration = { buildPlan, migrate, migrationOrder };
})();
