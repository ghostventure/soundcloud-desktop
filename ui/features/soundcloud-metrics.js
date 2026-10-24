(() => {
  const PREFS_KEY = 'soundcloudMetricMilestonesV1';
  const metricDefs = [
    ['followersCount', 'Followers'], ['trackCount', 'SoundCloud tracks'],
    ['catalogPlayCount', 'Catalog plays'], ['catalogLikeCount', 'Catalog likes']
  ];
  let ctxRef;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const readPrefs = accountId => {
    try { const all = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; return all[accountId] || { thresholds: {}, sent: {} }; }
    catch { return { thresholds: {}, sent: {} }; }
  };
  const savePrefs = (accountId, value) => {
    try { const all = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; all[accountId] = value; localStorage.setItem(PREFS_KEY, JSON.stringify(all)); }
    catch { ctxRef?.notice('Milestone settings could not be saved in this browser profile.'); }
  };
  const total = (tracks, key) => tracks.reduce((sum, track) => Math.min(Number.MAX_SAFE_INTEGER, sum + (Number.isSafeInteger(track[key]) ? track[key] : 0)), 0);
  function milestoneValues(snapshot) {
    const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
    return {
      followersCount: snapshot?.profile?.followers_count || 0,
      trackCount: snapshot?.profile?.track_count || 0,
      catalogPlayCount: total(tracks, 'playback_count'),
      catalogLikeCount: tracks.reduce((sum, track) => Math.min(Number.MAX_SAFE_INTEGER, sum + (track.likes_count || track.favoritings_count || 0)), 0)
    };
  }
  function installSyncObserver(ctx) {
    const api = ctx.api;
    if (!api || api.__soundcloudMetricObserver || typeof api.sync !== 'function') return;
    const original = api.sync;
    const wrapped = async (...args) => {
      const before = ctx.getConnection()?.snapshot || null;
      const result = await original(...args);
      const snapshot = result?.snapshot || null;
      if (snapshot) checkMilestones(before, snapshot);
      return result;
    };
    try { api.sync = wrapped; Object.defineProperty(api, '__soundcloudMetricObserver', { value: true }); } catch { /* The catalog sync remains usable if interception is unavailable. */ }
  }
  function checkMilestones(before, after) {
    const id = ctxRef?.getConnection()?.activeAccountId;
    if (!id || !before || !after) return;
    const prefs = readPrefs(id), prior = milestoneValues(before), current = milestoneValues(after), hits = [];
    for (const [key, label] of metricDefs) {
      const threshold = Number(prefs.thresholds?.[key]);
      if (!Number.isSafeInteger(threshold) || threshold <= 0 || current[key] < threshold || prior[key] >= threshold) continue;
      hits.push(`${label} reached ${threshold.toLocaleString()} (observed at ${current[key].toLocaleString()})`);
      prefs.sent[key] = threshold;
    }
    if (hits.length) {
      savePrefs(id, prefs);
      const message = `SoundCloud milestone after sync: ${hits.join('; ')}. Values are from the saved API snapshot.`;
      setTimeout(() => ctxRef?.notice(message), 100);
    }
  }
  function metricsPanel(connection) {
    const id = connection.activeAccountId;
    const prefs = readPrefs(id), snapshot = connection.snapshot, history = snapshot?.performanceHistory || [];
    const latest = history[history.length - 1];
    const fields = metricDefs.map(([key, label]) => `<label class="scm-field">${label} milestone<input type="number" min="0" step="1" data-scm-threshold="${key}" value="${esc(prefs.thresholds?.[key] || '')}" placeholder="Off" ${id?'':'disabled'}></label>`).join('');
    return `<section class="panel scm-panel"><div class="scm-head"><div><h2>Performance milestones &amp; digest</h2><p>Alerts are evaluated only after you sync. Counts are SoundCloud API snapshots, not real-time analytics.</p></div><button type="button" data-scm="export" ${history.length?'':'disabled'}>Export recent digest (CSV)</button></div><div class="scm-fields">${fields}</div><p class="hint">${latest ? `Latest snapshot: ${esc(new Date(latest.capturedAt).toLocaleString())} · ${history.length} saved sync${history.length===1?'':'s'}` : 'Sync your catalog to start a timestamped metrics history.'} Deltas in the export compare adjacent saved snapshots.</p></section>`;
  }
  async function onClick(event) {
    const button = event.target.closest('[data-scm]');
    if (!button || !ctxRef) return;
    if (button.dataset.scm === 'export') {
      const result = await window.studio.exportPerformanceDigest();
      ctxRef.notice(result?.saved ? `Exported ${result.count} timestamped SoundCloud metric snapshots.` : 'Digest export canceled.');
      return;
    }
  }
  function onChange(event) {
    const input = event.target.closest('[data-scm-threshold]');
    if (!input || !ctxRef) return;
    const id = ctxRef.getConnection()?.activeAccountId;
    if (!id) return;
    const prefs = readPrefs(id), key = input.dataset.scmThreshold;
    const value = input.value.trim();
    prefs.thresholds = { ...prefs.thresholds, [key]: value && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0 };
    savePrefs(id, prefs);
  }
  window.registerArtistPlugin({
    id: 'soundcloud-metrics',
    init(ctx) {
      ctxRef = ctx; installSyncObserver(ctx);
      document.addEventListener('click', event => { onClick(event).catch(error => ctxRef?.notice(error.message || 'SoundCloud action failed.')); });
      document.addEventListener('change', onChange);
    },
    onRender(ctx) {
      ctxRef = ctx;
      if (ctx.getPage() === 'soundcloud') {
        document.querySelector('[data-scm-panel]')?.remove();
        const view = document.querySelector('#view');
        view?.insertAdjacentHTML('beforeend', `<div data-scm-panel>${metricsPanel(ctx.getConnection() || {})}</div>`);
      } else document.querySelector('[data-scm-panel]')?.remove();
    }
  });
})();
