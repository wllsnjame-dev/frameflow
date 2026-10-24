(function () {
  const source = window.SUPABASE_CONFIG || window.FRAMEFLOW_SUPABASE_CONFIG || {};
  const url = source.url || source.SUPABASE_URL || '';
  const anonKey = source.anonKey || source.SUPABASE_ANON_KEY || '';
  const factoryId = source.factoryId || source.FACTORY_ID || '';
  const validFactoryId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(factoryId);
  const valid = source.enabled === true && /^https:\/\/[^\s/]+\.supabase\.co(?:\/.*)?$/.test(url) && anonKey.length > 20;

  if (!valid || !window.supabase || typeof window.supabase.createClient !== 'function') return;

  window.supabaseClient = window.supabase.createClient(url, anonKey);
  window.FRAMEFLOW_SUPABASE_READY = true;
  window.FRAMEFLOW_SUPABASE_CONFIG = { ...source, url, anonKey, factoryId: validFactoryId ? factoryId : '', FACTORY_ID: validFactoryId ? factoryId : '' };
  window.frameflowSupabase = {
    async testConnection(targetFactoryId) {
      const session = (await window.supabaseClient.auth.getSession()).data.session;
      if (!session) return { connected: false, reason: 'AUTHENTICATION REQUIRED' };
      const selectedFactoryId = targetFactoryId || (validFactoryId ? factoryId : '');
      if (!selectedFactoryId) {
        const memberships = await window.supabaseClient.from('memberships').select('factory_id,role').eq('user_id', session.user.id);
        if (memberships.error) return { connected: false, reason: memberships.error.message };
        return { connected: false, reason: memberships.data?.length ? 'FACTORY SELECTION REQUIRED' : 'NO FACTORY MEMBERSHIP', memberships: memberships.data || [] };
      }
      const result = await window.supabaseClient.from('memberships').select('factory_id,role').eq('factory_id', selectedFactoryId).eq('user_id', session.user.id).maybeSingle();
      if (result.error) return { connected: false, reason: result.error.message };
      return { connected: !!result.data, reason: result.data ? 'CONNECTED' : 'FACTORY NOT ACCESSIBLE', membership: result.data || null };
    },
    client: window.supabaseClient,
    factoryId: validFactoryId ? factoryId : ''
  };
})();