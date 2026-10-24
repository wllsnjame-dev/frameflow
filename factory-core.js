(function () {
  const STORAGE_KEY = 'frameflow';

  const defaultState = () => ({
    factoryName: 'Northside Windows Ltd',
    settings: {
      companyName: 'Northside Windows Ltd',
      address: 'Leeds, UK',
      phone: '',
      email: '',
      vatNumber: '',
      companyRegistration: '',
      website: '',
      quotationFooter: 'Thank you for your enquiry. Terms are subject to final measurements and deposit terms.',
      invoiceFooter: 'Thank you for your business. Please pay promptly.',
      footer: 'Thank you for your business.'
    },
    customers: [],
    products: [],
    designs: [],
    measurements: [],
    quotes: [],
    quoteItems: [],
    orders: [],
    orderItems: [],
    invoices: [],
    invoiceItems: [],
    payments: [],
    production: [],
    productionItems: [],
    productionStatusHistory: [],
    productionQC: [],
    productionMaterialsUsed: [],
    materialTransactions: [],
    stockItems: [],
    stockMovements: [],
    suppliers: [],
    purchaseOrders: [],
    goodsReceipts: [],
    workCentres: [],
    productionSchedules: [],
    qcInspections: [],
    users: [],
    activeUserId: '',
    subscription: null,
    billingRecords: [],
    reports: {
      sales: [],
      orders: [],
      payments: [],
      production: [],
      stock: []
    }
  });

  function normalizeState(raw) {
    const state = raw && typeof raw === 'object' ? raw : {};
    const base = defaultState();

    const arrays = ['customers', 'products', 'designs', 'measurements', 'quoteItems', 'quotes', 'orders', 'orderItems', 'invoices', 'invoiceItems', 'payments', 'production', 'productionItems', 'productionStatusHistory', 'productionQC', 'productionMaterialsUsed', 'materialTransactions', 'stockItems', 'stockMovements', 'suppliers', 'purchaseOrders', 'goodsReceipts', 'workCentres', 'productionSchedules', 'qcInspections', 'users', 'billingRecords'];
    arrays.forEach((key) => {
      if (!Array.isArray(state[key])) state[key] = Array.isArray(base[key]) ? base[key].slice() : [];
    });

    state.settings = { ...base.settings, ...(state.settings || {}) };
    if (!state.subscription || typeof state.subscription !== 'object') state.subscription = base.subscription;
    if (!state.settings.quotationFooter && state.settings.footer) state.settings.quotationFooter = state.settings.footer;
    if (!state.settings.invoiceFooter && state.settings.footer) state.settings.invoiceFooter = state.settings.footer;
    state.factoryName = state.factoryName || state.settings.companyName || base.factoryName;
    state.reports = { ...base.reports, ...(state.reports || {}) };
    return state;
  }

  function readDb() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      const state = normalizeState(parsed);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return state;
    } catch (error) {
      console.warn('frameflow: invalid local storage, using defaults', error);
      return defaultState();
    }
  }

  function saveDb(db) {
    const cleaned = normalizeState(db);
    window.prodStore = cleaned;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    return cleaned;
}

  const currentState = readDb();
  window.prodStore = currentState;

  function getSupabaseConfig() {
    const config = window.FRAMEFLOW_SUPABASE_CONFIG || {};
    const url = config.SUPABASE_URL || config.url || '';
    const anonKey = config.SUPABASE_ANON_KEY || config.anonKey || '';
    const factoryId = config.FACTORY_ID || config.factoryId || '';
    const enabled = config.enabled === true;
    const validUrl = /^https:\/\/[^\s/]+\.supabase\.co(?:\/.*)?$/.test(url);
    const validFactoryId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(factoryId);
    return { url, anonKey, factoryId: validFactoryId ? factoryId : '', enabled, validFactoryId, valid: enabled && validUrl && anonKey.length > 20 };
  }

  function getDataMode() {
    return getSupabaseConfig().valid && window.FRAMEFLOW_SUPABASE_READY ? 'SUPABASE' : 'SUPABASE NOT CONFIGURED';
  }

  function nextNumber(prefix, existing) {
    const currentYear = new Date().getFullYear();
    const list = (existing || []).map((entry) => Number(String(entry.number || '').match(/(\d+)$/)?.[1] || 0)).filter((value) => Number.isFinite(value));
    const next = Math.max(0, ...list, 0) + 1;
    return `${prefix}-${currentYear}-${String(next).padStart(4, '0')}`;
  }

  function makeId() {
    return 'id-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  }

  window.frameflow = {
    STORAGE_KEY,
    defaultState,
    normalizeState,
    readDb,
    saveDb,
    getSupabaseConfig,
    getDataMode,
    nextNumber,
    makeId,
    dataMode: getDataMode()
  };
})();
