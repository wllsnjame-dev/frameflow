(function () {
  if (window.frameflowCloud) return;

  const CONFIG = window.FRAMEFLOW_SUPABASE_CONFIG || window.SUPABASE_CONFIG || {};
  const META_KEY = 'frameflow-cloud-sync';
  const STORAGE_KEY = 'frameflow';
  const SNAPSHOT_TABLE = 'factory_snapshots';
  const URL = CONFIG.url || CONFIG.SUPABASE_URL || '';
  const PUBLIC_KEY = CONFIG.anonKey || CONFIG.SUPABASE_ANON_KEY || '';
  const enabled = CONFIG.enabled === true && /^https:\/\/[^\s/]+\.supabase\.co(?:\/.*)?$/.test(URL) && PUBLIC_KEY.length > 20;
  const client = enabled ? (window.supabaseClient || (window.supabase?.createClient ? window.supabase.createClient(URL, PUBLIC_KEY) : null)) : null;
  let debounceTimer = 0;
  let pollingTimer = 0;
  let syncBusy = false;
  let suppressLocalSync = false;
  let localChangeSequence = 0;
  let originalSetItem;
  let api;

  function readDb() {
    if (window.frameflow) return window.frameflow.readDb();
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function normalize(data) {
    return window.frameflow ? window.frameflow.normalizeState(data) : data && typeof data === 'object' ? data : {};
  }

  function cloudState(data) {
    const state = normalize(data);
    state.users = [];
    state.activeUserId = '';
    return state;
  }

  function localRoleForMembership(role) {
    const normalized = String(role || '').toLowerCase();
    if (['owner', 'admin'].includes(normalized)) return 'admin';
    if (normalized === 'sales') return 'sales';
    if (normalized === 'procurement') return 'procurement';
    return 'worker';
  }

  function stateForSignedInUser(snapshotState, user, membership) {
    const state = normalize(snapshotState);
    const localUsers = normalize(readDb()).users || [];
    const authUserId = `supabase-${user.id}`;
    state.users = localUsers.filter((entry) => entry.source !== 'supabase-auth' && entry.id !== authUserId);
    state.users.push({
      id: authUserId,
      name: user.user_metadata?.full_name || user.email || 'Supabase user',
      email: user.email || '',
      role: localRoleForMembership(membership.role),
      isActive: true,
      source: 'supabase-auth',
      createdAt: user.created_at || new Date().toISOString()
    });
    state.activeUserId = authUserId;
    return state;
  }

  function getMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); }
    catch { return null; }
  }

  function setMeta(value) {
    const serialized = JSON.stringify(value);
    if (originalSetItem) originalSetItem.call(localStorage, META_KEY, serialized);
    else localStorage.setItem(META_KEY, serialized);
  }

  function setLocalState(state) {
    const value = JSON.stringify(normalize(state));
    suppressLocalSync = true;
    try {
      if (originalSetItem) originalSetItem.call(localStorage, STORAGE_KEY, value);
      else localStorage.setItem(STORAGE_KEY, value);
      if (window.frameflow) window.prodStore = JSON.parse(value);
    } finally { suppressLocalSync = false; }
  }

  function applyRemoteState(snapshotState, user, membership) {
    setLocalState(stateForSignedInUser(snapshotState, user, membership));
    window.frameflowRBAC?.applyPageAccess?.();
  }

  function setStatus(message, kind = 'info') {
    const panelStatus = document.getElementById('cloudSyncStatus');
    if (panelStatus) {
      panelStatus.textContent = message;
      panelStatus.className = `cloud-status ${kind}`;
    }
    const badge = document.getElementById('frameflowStatus');
    if (badge) {
      badge.textContent = `CLOUD · ${message.toUpperCase()}`;
      badge.dataset.state = kind;
    }
  }

  function requireClient() {
    if (!enabled || !client) throw new Error('Supabase URL/public key are not configured, or the Supabase client library is unavailable. Local mode remains active.');
    return client;
  }

  async function session() {
    const supabase = requireClient();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error('Sign in to Supabase before connecting a factory.');
    return data.session;
  }

  async function getMemberships() {
    const supabase = requireClient();
    const current = await session();
    const { data: memberships, error } = await supabase.from('memberships').select('factory_id,role').eq('user_id', current.user.id);
    if (error) throw error;
    if (!memberships?.length) return [];
    const factoryIds = memberships.map((membership) => membership.factory_id);
    const { data: factories, error: factoryError } = await supabase.from('factories').select('id,name').in('id', factoryIds);
    if (factoryError) throw factoryError;
    const byId = new Map((factories || []).map((factory) => [factory.id, factory]));
    return memberships.map((membership) => ({ ...membership, name: byId.get(membership.factory_id)?.name || membership.factory_id }));
  }

  async function verifyMembership(factoryId) {
    const current = await session();
    const { data, error } = await requireClient().from('memberships').select('factory_id,role').eq('factory_id', factoryId).eq('user_id', current.user.id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This signed-in account is not a member of the selected factory.');
    return { user: current.user, membership: data };
  }

  async function fetchSnapshot(factoryId) {
    const { data, error } = await requireClient().from(SNAPSHOT_TABLE).select('factory_id,state,version,updated_at,updated_by').eq('factory_id', factoryId).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function backupLocal() {
    const current = localStorage.getItem(STORAGE_KEY);
    if (!current) return '';
    const key = `frameflow-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (originalSetItem) originalSetItem.call(localStorage, key, current);
    else localStorage.setItem(key, current);
    return key;
  }

  function startAutoSync(factoryId, version) {
    setMeta({ factoryId, version, enabled: true, dirty: false, paused: false });
    setStatus('Cloud sync active; local changes are queued automatically.', 'ok');
    beginPolling();
  }

  async function login(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function logout() {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    setMeta(null);
    stopPolling();
    const state = normalize(readDb());
    const localUser = (state.users || []).find((user) => user.source !== 'supabase-auth' && user.isActive !== false) || null;
    state.users = (state.users || []).filter((user) => user.source !== 'supabase-auth');
    state.activeUserId = localUser?.id || '';
    suppressLocalSync = true;
    try {
      if (originalSetItem) originalSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(state));
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (window.frameflow) window.prodStore = state;
    } finally { suppressLocalSync = false; }
    setStatus('Signed out; LocalStorage remains available offline.', 'info');
  }

  async function pull(factoryId) {
    const { user, membership } = await verifyMembership(factoryId);
    const snapshot = await fetchSnapshot(factoryId);
    if (!snapshot) throw new Error('No cloud snapshot exists for this factory. An owner/admin can initialize it from local data.');
    const backupKey = backupLocal();
    applyRemoteState(snapshot.state, user, membership);
    startAutoSync(factoryId, Number(snapshot.version));
    setStatus(`Cloud snapshot loaded${backupKey ? `; local backup saved as ${backupKey}` : ''}.`, 'ok');
    return { version: Number(snapshot.version), backupKey, userId: user.id };
  }

  async function initializeFromLocal(factoryId, overwrite = false) {
    const { user, membership } = await verifyMembership(factoryId);
    if (!['owner', 'admin'].includes(String(membership.role).toLowerCase())) throw new Error('Only a factory owner/admin can initialize or replace its cloud snapshot.');
    const current = await fetchSnapshot(factoryId);
    const supabase = requireClient();
    const now = new Date().toISOString();
    const state = cloudState(readDb());
    if (!current) {
      const { data, error } = await supabase.from(SNAPSHOT_TABLE).insert({ factory_id: factoryId, state, version: 1, updated_at: now, updated_by: user.id }).select('version').single();
      if (error) throw error;
      startAutoSync(factoryId, Number(data.version));
      return { version: Number(data.version), initialized: true };
    }
    if (!overwrite) throw new Error(`A cloud snapshot already exists at version ${current.version}. Pull it, or explicitly choose Replace cloud with local data.`);
    backupLocal();
    const nextVersion = Number(current.version) + 1;
    const { data, error } = await supabase.from(SNAPSHOT_TABLE).update({ state, version: nextVersion, updated_at: now, updated_by: user.id }).eq('factory_id', factoryId).eq('version', Number(current.version)).select('version').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Cloud data changed since it was loaded. Pull the latest snapshot and review before replacing it.');
    startAutoSync(factoryId, Number(data.version));
    return { version: Number(data.version), initialized: false };
  }

  async function flushLocal() {
    const meta = getMeta();
    if (!meta?.enabled || meta.paused || !navigator.onLine || syncBusy) return;
    syncBusy = true;
    const sequenceAtStart = localChangeSequence;
    try {
      const { user, membership } = await verifyMembership(meta.factoryId);
      const snapshot = await fetchSnapshot(meta.factoryId);
      const state = cloudState(readDb());
      const now = new Date().toISOString();
      if (!snapshot) throw new Error('The selected factory cloud snapshot was removed. Sync paused; local data is preserved.');
      if (Number(snapshot.version) !== Number(meta.version)) {
        if (meta.dirty) {
          setMeta({ ...meta, paused: true, remoteVersion: Number(snapshot.version) });
          throw new Error(`Version conflict: cloud is at ${snapshot.version}, this browser expected ${meta.version}. Pull or review the cloud copy before syncing.`);
        }
        applyRemoteState(snapshot.state, user, membership);
        setMeta({ ...meta, version: Number(snapshot.version), dirty: false, paused: false });
        setStatus(`Updated from cloud version ${snapshot.version}.`, 'ok');
        return;
      }
      const nextVersion = Number(meta.version) + 1;
      const { data, error } = await client.from(SNAPSHOT_TABLE).update({ state, version: nextVersion, updated_at: now, updated_by: user.id }).eq('factory_id', meta.factoryId).eq('version', Number(meta.version)).select('version').maybeSingle();
      if (error) throw error;
      if (!data) {
        setMeta({ ...meta, dirty: true, paused: true });
        throw new Error('Cloud changed during save. Sync paused to prevent overwriting another browser.');
      }
      const changedDuringPush = localChangeSequence !== sequenceAtStart;
      setMeta({ ...(getMeta() || meta), version: Number(data.version), dirty: changedDuringPush, paused: false });
      setStatus(changedDuringPush ? 'A newer local change is queued.' : `Synced version ${data.version}.`, changedDuringPush ? 'pending' : 'ok');
      if (changedDuringPush) setTimeout(flushLocal, 0);
    } catch (error) {
      const current = getMeta();
      if (current?.enabled && !current.paused) setMeta({ ...current, dirty: true });
      setStatus(error.message || 'Cloud unavailable; changes remain on this device.', 'error');
    } finally { syncBusy = false; }
  }

  function queueLocalSync() {
    const meta = getMeta();
    if (!meta?.enabled || suppressLocalSync) return;
    localChangeSequence += 1;
    setMeta({ ...meta, dirty: true });
    setStatus(navigator.onLine ? 'Local changes queued for cloud sync…' : 'Offline; local changes saved and queued.', 'pending');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushLocal, 700);
  }

  function installStorageHook() {
    if (Storage.prototype.__frameflowCloudHook) return;
    originalSetItem = Storage.prototype.setItem;
    const hooked = function (key, value) {
        const isFrameflowWrite = this === localStorage && key === STORAGE_KEY;
        const previousValue = isFrameflowWrite ? localStorage.getItem(STORAGE_KEY) : null;
      originalSetItem.call(this, key, value);
        if (isFrameflowWrite && !suppressLocalSync && previousValue !== String(value)) queueLocalSync();
    };
    Object.defineProperty(hooked, '__frameflowCloudHook', { value: true });
    Storage.prototype.setItem = hooked;
    Object.defineProperty(Storage.prototype, '__frameflowCloudHook', { value: true, configurable: true });
  }

  async function checkRemote() {
    const meta = getMeta();
    if (!meta?.enabled || !navigator.onLine) return;
    try {
      const { user, membership } = await verifyMembership(meta.factoryId);
      const snapshot = await fetchSnapshot(meta.factoryId);
      if (!snapshot) throw new Error('Cloud snapshot unavailable.');
      if (Number(snapshot.version) > Number(meta.version)) {
        if (meta.dirty) {
          setMeta({ ...meta, paused: true, remoteVersion: Number(snapshot.version) });
          setStatus(`Cloud version ${snapshot.version} is newer; local changes are preserved. Pull or resolve the conflict.`, 'error');
          return;
        }
        applyRemoteState(snapshot.state, user, membership);
        setMeta({ ...meta, version: Number(snapshot.version), dirty: false });
        setStatus(`Updated from cloud version ${snapshot.version}.`, 'ok');
      }
    } catch (error) {
      setStatus(`Offline fallback active: ${error.message}`, 'error');
    }
  }

  function beginPolling() {
    stopPolling();
    pollingTimer = setInterval(checkRemote, 15000);
  }

  function stopPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = 0;
  }

  function factoryControls() {
    return {
      loginForm: document.getElementById('cloudLoginForm'),
      factorySelect: document.getElementById('cloudFactorySelect'),
      connectButton: document.getElementById('cloudPullButton'),
      initializeButton: document.getElementById('cloudInitializeButton'),
      replaceButton: document.getElementById('cloudReplaceButton'),
      logoutButton: document.getElementById('cloudLogoutButton'),
      refreshButton: document.getElementById('cloudRefreshButton')
    };
  }

  function showCloudMessage(message, kind = 'info') {
    const box = document.getElementById('cloudSyncStatus');
    if (!box) return;
    box.textContent = message;
    box.className = `cloud-status ${kind}`;
  }

  async function refreshFactoryList() {
    const controls = factoryControls();
    const factories = await getMemberships();
    const remembered = localStorage.getItem('frameflow-cloud-selected-factory') || '';
    controls.factorySelect.innerHTML = '<option value="">Select a factory you belong to…</option>' + factories.map((factory) => `<option value="${factory.factory_id}"${factory.factory_id === remembered ? ' selected' : ''}>${escapeHtml(factory.name)} · ${escapeHtml(factory.role)}</option>`).join('');
    controls.factorySelect.hidden = !factories.length;
    controls.refreshButton.hidden = !factories.length;
    controls.connectButton.hidden = !factories.length;
    controls.initializeButton.hidden = !factories.length;
    controls.replaceButton.hidden = !factories.length;
    controls.logoutButton.hidden = false;
    if (!factories.length) showCloudMessage('This Supabase account has no factory memberships. Ask a factory owner to add your Auth user in public.memberships.', 'error');
    else {
      showCloudMessage(`Signed in. ${factories.length} factory membership${factories.length === 1 ? '' : 's'} found. Select one to continue.`, 'ok');
      await updateFactoryInfo();
    }
    return factories;
  }

  async function updateFactoryInfo() {
    const controls = factoryControls();
    const factoryId = controls.factorySelect.value;
    const info = document.getElementById('cloudSnapshotInfo');
    if (!factoryId) {
      if (info) info.textContent = 'Select a factory to inspect its cloud snapshot.';
      controls.connectButton.hidden = true;
      controls.initializeButton.hidden = true;
      controls.replaceButton.hidden = true;
      return;
    }
    try {
      await verifyMembership(factoryId);
      const snapshot = await fetchSnapshot(factoryId);
      if (info) info.textContent = snapshot ? `Cloud snapshot version ${snapshot.version} · last updated ${new Date(snapshot.updated_at).toLocaleString('en-GB')}.` : 'No snapshot exists for this factory yet.';
      controls.connectButton.hidden = !snapshot;
      controls.initializeButton.hidden = !!snapshot;
      controls.replaceButton.hidden = !snapshot;
    } catch (error) {
      if (info) info.textContent = error.message;
      controls.connectButton.hidden = true;
      controls.initializeButton.hidden = true;
      controls.replaceButton.hidden = true;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  async function initializePanel() {
    const controls = factoryControls();
    if (!controls.loginForm || controls.loginForm.dataset.bound === 'true') return;
    controls.loginForm.dataset.bound = 'true';
    [controls.factorySelect, controls.connectButton, controls.initializeButton, controls.replaceButton, controls.logoutButton, controls.refreshButton].filter(Boolean).forEach((element) => { element.hidden = true; });
    const syncEnabled = getMeta()?.enabled === true;
    if (!enabled || !client) showCloudMessage('Cloud is not configured in this browser. LocalStorage workflows continue normally.', 'info');
    else {
      const { data } = await client.auth.getSession();
      if (data.session) await refreshFactoryList().catch((error) => showCloudMessage(error.message, 'error'));
      else showCloudMessage('Sign in to a real Supabase Auth user to list factory memberships.', 'info');
    }
    if (syncEnabled) {
      controls.logoutButton.hidden = false;
      controls.refreshButton.hidden = false;
    }
    controls.loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await login(controls.loginForm.elements.email.value.trim(), controls.loginForm.elements.password.value);
        controls.loginForm.elements.password.value = '';
        await refreshFactoryList();
        controls.logoutButton.hidden = false;
      } catch (error) { showCloudMessage(error.message, 'error'); }
    });
    controls.refreshButton?.addEventListener('click', async () => {
      try { await refreshFactoryList(); }
      catch (error) { showCloudMessage(error.message, 'error'); }
    });
    controls.factorySelect?.addEventListener('change', updateFactoryInfo);
    controls.connectButton?.addEventListener('click', async () => {
      const factoryId = controls.factorySelect.value;
      if (!factoryId) return showCloudMessage('Select a factory before pulling its data.', 'error');
      try {
        const result = await pull(factoryId);
        localStorage.setItem('frameflow-cloud-selected-factory', factoryId);
        showCloudMessage(`Cloud data loaded at version ${result.version}. Local backup retained. Auto-sync is active.`, 'ok');
      } catch (error) { showCloudMessage(error.message, 'error'); }
    });
    controls.initializeButton?.addEventListener('click', async () => {
      const factoryId = controls.factorySelect.value;
      if (!factoryId || !confirm('Initialize an empty cloud snapshot from this browser’s local FrameFlow data?')) return;
      try {
        const result = await initializeFromLocal(factoryId, false);
        localStorage.setItem('frameflow-cloud-selected-factory', factoryId);
        showCloudMessage(`Cloud snapshot initialized at version ${result.version}; auto-sync is active.`, 'ok');
      } catch (error) { showCloudMessage(error.message, 'error'); }
    });
    controls.replaceButton?.addEventListener('click', async () => {
      const factoryId = controls.factorySelect.value;
      if (!factoryId || !confirm('Replace the cloud snapshot with this browser’s local data? A local backup will be retained.')) return;
      try {
        const result = await initializeFromLocal(factoryId, true);
        localStorage.setItem('frameflow-cloud-selected-factory', factoryId);
        showCloudMessage(`Cloud snapshot replaced at version ${result.version}; local backup retained.`, 'ok');
      } catch (error) { showCloudMessage(error.message, 'error'); }
    });
    controls.logoutButton?.addEventListener('click', async () => {
      try { await logout(); controls.factorySelect.innerHTML = '<option value="">Select a factory you belong to…</option>'; controls.factorySelect.hidden = true; controls.logoutButton.hidden = true; }
      catch (error) { showCloudMessage(error.message, 'error'); }
    });
    window.dispatchEvent(new CustomEvent('frameflow-cloud-ready'));
  }

  async function autoResume() {
    const meta = getMeta();
    if (!meta?.enabled) return;
    try {
      const { user, membership } = await verifyMembership(meta.factoryId);
      const snapshot = await fetchSnapshot(meta.factoryId);
      if (!snapshot) throw new Error('Cloud snapshot is missing.');
      const localCloudUser = readDb().users?.find((entry) => entry.source === 'supabase-auth');
      const expectedRole = localRoleForMembership(membership.role);
      const identityChanged = !localCloudUser || localCloudUser.id !== `supabase-${user.id}` || localCloudUser.role !== expectedRole;
      if (identityChanged && meta.dirty) {
        setMeta({ ...meta, paused: true });
        setStatus('A different Auth identity has pending local changes. Sync is paused; pull the selected factory snapshot before continuing.', 'error');
        return;
      }
      if (Number(snapshot.version) > Number(meta.version)) {
        if (meta.dirty) {
          setMeta({ ...meta, paused: true, remoteVersion: Number(snapshot.version) });
          setStatus('Cloud and local versions differ; local changes are preserved. Use the Security page to resolve.', 'error');
        } else {
          applyRemoteState(snapshot.state, user, membership);
          setMeta({ ...meta, version: Number(snapshot.version), dirty: false, paused: false });
          setStatus(`Connected to cloud version ${snapshot.version}.`, 'ok');
        }
      } else if (identityChanged && !meta.dirty) {
        applyRemoteState(snapshot.state, user, membership);
        setMeta({ ...meta, version: Number(snapshot.version), dirty: false, paused: false });
        setStatus(`Connected to cloud version ${snapshot.version} as ${membership.role}.`, 'ok');
      } else {
        setStatus(`Connected to cloud version ${snapshot.version}.`, 'ok');
      }
      beginPolling();
    } catch (error) {
      setStatus(`Offline fallback active: ${error.message}`, 'error');
    }
  }

  function start() {
    if (!client) {
      setStatus('Supabase is not configured; local-only mode active.', 'info');
    } else {
      setStatus('Supabase configured; sign in and select a factory to enable sync.', 'info');
      installStorageHook();
      autoResume();
      window.addEventListener('online', () => { const meta = getMeta(); if (meta?.dirty) flushLocal(); else checkRemote(); });
      window.addEventListener('offline', () => setStatus('Offline; local changes remain available on this device.', 'pending'));
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY || suppressLocalSync) return;
        queueLocalSync();
      });
    }
    initializePanel().catch((error) => showCloudMessage(error.message, 'error'));
    window.frameflowCloud = api;
    window.dispatchEvent(new CustomEvent('frameflow-cloud-ready'));
  }

  api = {
    client,
    configured: !!client,
    getMemberships,
    verifyMembership,
    fetchSnapshot,
    login,
    logout,
    pull,
    initializeFromLocal,
    flushLocal,
    getMeta,
    status: setStatus,
    snapshotTable: SNAPSHOT_TABLE
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
