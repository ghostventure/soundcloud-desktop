(() => {
  const ID = 'artist-ui-workspace-tools';
  const PREFS_KEY = 'artistUiWorkspacePrefs';
  const ACTIVITY_KEY = 'artistUiWorkspaceActivity';
  const SYNC_KEY = 'artistUiWorkspaceLastSync';
  const UNDO_KEY = 'artistUiWorkspaceUndo';
  const FIELDS = {
    tracks: ['title', 'genre', 'notes', 'credits', 'status', 'link'],
    releases: ['title', 'date', 'type', 'trackId', 'notes', 'checks'],
    campaigns: ['title', 'date', 'status', 'channel', 'contact', 'link', 'caption']
  };
  const navNames = { overview: 'Overview', upload: 'Upload music', library: 'Music library', releases: 'Releases', promotion: 'Promotion', soundcloud: 'SoundCloud', settings: 'Settings' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const jsonClone = value => JSON.parse(JSON.stringify(value));
  const read = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences are best-effort when local storage is unavailable. */ } };
  let prefs = { contrast: false, compact: false, scale: 1 };
  let lastState = null;
  let originalSave = null;
  let originalSync = null;
  let originalUpload = null;
  let saveObserverInstalled = false;
  let syncObserverInstalled = false;
  let syncBaseline = null;
  let syncPending = false;
  let activeTask = null;
  let summaryTimer = null;
  let ctxRef = null;

  const styles = () => {
    if (document.querySelector('link[data-ui-workspace-tools-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'features/ui-workspace-tools.css';
    link.dataset.uiWorkspaceToolsStyle = 'true';
    document.head.appendChild(link);
  };

  function applyPrefs() {
    document.body.classList.toggle('uwt-contrast', !!prefs.contrast);
    document.body.classList.toggle('uwt-compact', !!prefs.compact);
    document.body.style.setProperty('--uwt-zoom', String([0.9, 1, 1.1, 1.2, 1.3].includes(Number(prefs.scale)) ? Number(prefs.scale) : 1));
  }

  function activityList() {
    const value = read(ACTIVITY_KEY, []);
    return Array.isArray(value) ? value.filter(item => item && typeof item.label === 'string').slice(0, 20) : [];
  }

  function recordActivity(label, category = 'workspace') {
    const entries = activityList();
    const last = entries[0];
    if (last?.label === label && Date.now() - new Date(last.at).getTime() < 1500) return;
    entries.unshift({ id: crypto.randomUUID(), label: String(label).slice(0, 90), category, at: new Date().toISOString() });
    write(ACTIVITY_KEY, entries.slice(0, 20));
    refreshOverviewPanels();
  }

  function trackedSnapshot(state) {
    const snapshot = {};
    for (const [collection, fields] of Object.entries(FIELDS)) {
      snapshot[collection] = Object.fromEntries((Array.isArray(state?.[collection]) ? state[collection] : []).filter(row => row?.id).map(row => [row.id, Object.fromEntries(fields.map(key => [key, Object.prototype.hasOwnProperty.call(row, key) ? { present: true, value: row[key] } : { present: false }]))]));
    }
    return snapshot;
  }

  function changedRecords(before, after) {
    if (!before || !after) return [];
    const edits = [];
    for (const [collection, fields] of Object.entries(FIELDS)) {
      const oldRows = before[collection] || {}, newRows = after[collection] || {};
      if (Object.keys(oldRows).length !== Object.keys(newRows).length) continue;
      for (const id of Object.keys(oldRows)) {
        if (!newRows[id]) continue;
        const changed = fields.filter(field => JSON.stringify(oldRows[id][field]) !== JSON.stringify(newRows[id][field]));
        if (changed.length) edits.push({ collection, id, fields: changed, before: Object.fromEntries(changed.map(field => [field, oldRows[id][field]])), after: Object.fromEntries(changed.map(field => [field, newRows[id][field]])) });
      }
    }
    return edits;
  }

  function categoryFor(collection) {
    return collection === 'tracks' ? 'track metadata' : collection === 'releases' ? 'release plan' : 'campaign plan';
  }

  function installSaveObserver(ctx) {
    const api = ctx.api;
    if (!api || api.__artistUiWorkspaceSaveObserver) return;
    originalSave = api.save;
    if (typeof originalSave !== 'function') return;
    const wrapped = async state => {
      const before = lastState;
      const outgoing = trackedSnapshot(state);
      const result = await originalSave(state);
      lastState = trackedSnapshot(result || state);
      if (undoSuppressed) return result;
      const edits = changedRecords(before, outgoing);
      if (edits.length) {
        const editKind = edits.length === 1 ? categoryFor(edits[0].collection) : 'metadata and planning';
        write(UNDO_KEY, { id: crypto.randomUUID(), label: `Edited ${editKind}`, at: new Date().toISOString(), edits });
        recordActivity(`Edited ${editKind}`, 'edit');
      }
      return result;
    };
    try { api.save = wrapped; saveObserverInstalled = api.save === wrapped; } catch { saveObserverInstalled = false; }
  }

  let undoSuppressed = false;

  function metricTooltips() {
    const root = document.querySelector('#view');
    if (!root) return;
    const copy = {
      'Local tracks': 'Tracks imported into this PC workspace. This is not your SoundCloud catalog count.',
      'Planned releases': 'Release plans saved in this local workspace.',
      'Ready to release': 'Local tracks marked Mastered; SoundCloud does not verify this status.',
      'Promotion tasks': 'Campaign drafts not marked Done in this workspace.',
      Followers: 'Follower count from the last successful SoundCloud API sync. It is not a live count.',
      'Tracks on SoundCloud': 'SoundCloud profile count from the last sync. The returned catalog can differ from this count.',
      'Catalog plays': 'Sum of playback counts returned for synced tracks. This may not match Artist Insights totals.',
      'Catalog likes': 'Sum of likes returned for synced tracks. This API snapshot may omit some SoundCloud analytics.',
      'Most played in this catalog': 'Ranks only tracks returned by the most recent API sync; time-based analytics are not available here.',
      'Catalog visibility': 'Counts public and private visibility among tracks returned in the latest sync.',
      'Current tracks on SoundCloud': 'Catalog data reflects the last successful sync, not changes made since then.'
    };
    root.querySelectorAll('.stat, .sc-pulse-stat').forEach(card => {
      const label = card.querySelector('.label, span')?.textContent?.trim();
      const tip = copy[label];
      if (tip) {
        card.title = tip;
        card.setAttribute('aria-label', `${label}. ${tip}`);
        const labelNode = card.querySelector('.label, span');
        if (labelNode && !card.querySelector('.uwt-info')) labelNode.insertAdjacentHTML('afterend', `<button type="button" class="uwt-info" title="${esc(tip)}" aria-label="${esc(`${label}: ${tip}`)}">i</button>`);
      }
    });
    root.querySelectorAll('.sc-pulse-panel h3').forEach(heading => {
      if (copy[heading.textContent.trim()]) heading.title = copy[heading.textContent.trim()];
    });
  }

  function prefsDialog() {
    if (document.querySelector('#uwt-preferences')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="uwt-preferences" class="uwt-dialog" aria-labelledby="uwt-prefs-title"><form method="dialog"><div class="uwt-dialog-head"><div><span class="eyebrow">DISPLAY</span><h2 id="uwt-prefs-title">Reading & focus</h2></div><button class="quiet" value="close" aria-label="Close display preferences">Close</button></div><label class="uwt-check"><input type="checkbox" data-uwt-pref="contrast"><span><strong>High contrast</strong><small>Increase text, border, and keyboard focus contrast.</small></span></label><label class="uwt-check"><input type="checkbox" data-uwt-pref="compact"><span><strong>Compact density</strong><small>Reduce spacing in navigation, cards, and tables.</small></span></label><label class="uwt-field">Text size<select data-uwt-pref="scale"><option value="0.9">Smaller</option><option value="1">Default</option><option value="1.1">Large</option><option value="1.2">Larger</option><option value="1.3">Largest</option></select></label><p class="uwt-local-note">These display preferences are stored on this PC.</p></form></dialog>`);
    const dlg = document.querySelector('#uwt-preferences');
    dlg.querySelectorAll('[data-uwt-pref]').forEach(control => control.addEventListener('change', () => {
      const key = control.dataset.uwtPref;
      prefs[key] = key === 'scale' ? Number(control.value) : control.checked;
      write(PREFS_KEY, prefs);
      applyPrefs();
    }));
  }

  function commandDialog() {
    if (document.querySelector('#uwt-command-palette')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="uwt-command-palette" class="uwt-dialog uwt-palette" aria-labelledby="uwt-palette-title"><div class="uwt-palette-head"><h2 id="uwt-palette-title">Go to or run a command</h2><button type="button" class="quiet" data-uwt="close-palette">Close</button></div><label class="uwt-sr-only" for="uwt-palette-query">Search pages and commands</label><input id="uwt-palette-query" type="search" autocomplete="off" placeholder="Search pages and actions…" aria-controls="uwt-palette-results"><div id="uwt-palette-results" role="listbox" aria-label="Commands"></div><small>Use ↑ and ↓ to move, Enter to open, Esc to close · Ctrl+K</small></dialog>`);
  }

  function toolBar(ctx) {
    const right = document.querySelector('.topline>div');
    if (!right || right.querySelector('[data-uwt-toolbar]')) return;
    right.insertAdjacentHTML('afterbegin', `<div class="uwt-toolbar" data-uwt-toolbar><button type="button" data-uwt="open-palette" title="Open command palette (Ctrl+K)" aria-label="Open command palette">⌕ <span>Commands</span></button><button type="button" data-uwt="open-prefs" aria-label="Display and accessibility preferences" title="Display and accessibility">Aa</button></div>`);
    ensureTaskPanel();
  }

  function ensureTaskPanel() {
    if (document.querySelector('#uwt-task-status')) return;
    const main = document.querySelector('main');
    const anchor = document.querySelector('.topline');
    if (main && anchor) anchor.insertAdjacentHTML('afterend', '<section id="uwt-task-status" class="uwt-task" role="status" aria-live="polite" hidden></section>');
  }

  function renderTask(task) {
    activeTask = task;
    const panel = document.querySelector('#uwt-task-status');
    if (!panel) return;
    if (!task) { panel.hidden = true; panel.innerHTML = ''; return; }
    const progress = task.kind === 'upload' && Number.isFinite(task.percent)
      ? `<progress max="100" value="${Math.max(0, Math.min(100, task.percent))}" aria-label="Upload progress"></progress>`
      : '<progress aria-label="Progress"></progress>';
    panel.hidden = false;
    panel.innerHTML = `<div class="uwt-task-top"><strong>${esc(task.title)}</strong><span>${esc(task.detail || '')}</span></div>${progress}<ol>${task.stages.map((stage, index) => `<li class="${index < task.step ? 'done' : index === task.step ? 'current' : ''}"><span aria-hidden="true">${index < task.step ? '✓' : index + 1}</span>${esc(stage)}</li>`).join('')}</ol>`;
  }

  function connectionSummary(ctx) {
    const connection = ctx.getConnection() || {};
    const accounts = Array.isArray(connection.accounts) ? connection.accounts : [];
    const active = accounts.find(item => item.id === connection.activeAccountId) || accounts[0];
    const display = active?.username || active?.label || connection.snapshot?.profile?.username || (connection.connected ? 'Connected account' : 'No active account');
    const removeButtons = accounts.length > 1 ? accounts.map(account => `<li><span>${esc(account.username || account.label || 'SoundCloud account')}${account.id === connection.activeAccountId ? ' <b>ACTIVE</b>' : ''}</span><button type="button" data-uwt="remove-account" data-id="${esc(account.id)}" aria-label="Remove ${esc(account.username || account.label || 'SoundCloud account')}">Remove</button></li>`).join('') : '';
    return `<section class="uwt-account" aria-labelledby="uwt-account-title"><div class="uwt-account-status"><div><span class="eyebrow">SOUNDCLOUD ACCOUNT</span><h2 id="uwt-account-title">${esc(display)}</h2><p>${connection.connected ? 'This is the active account for sync and uploads.' : connection.configured ? 'Active account is disconnected. Reconnect to sync or upload.' : 'Connect this account to begin.'}</p></div><span class="uwt-active-badge">${connection.connected ? 'CONNECTED · ACTIVE' : 'ACTIVE ACCOUNT'}</span></div>${accounts.length > 1 ? `<label class="uwt-field">Switch active account<select data-uwt-account-switch aria-label="Switch active SoundCloud account">${accounts.map(account => `<option value="${esc(account.id)}" ${account.id === connection.activeAccountId ? 'selected' : ''}>${esc(account.username || account.label || 'SoundCloud account')}${account.connected ? '' : ' · reconnect needed'}</option>`).join('')}</select></label><ul class="uwt-account-list">${removeButtons}</ul>` : ''}<div class="uwt-add-account"><label class="uwt-field">Add another account<input data-uwt-account-label maxlength="80" placeholder="Optional label, e.g. Side project"></label><button type="button" data-uwt="add-account" ${connection.configured ? '' : 'disabled'}>Add account & connect</button></div>${!connection.configured ? '<p class="uwt-local-note">Save your SoundCloud app credentials below first. Additional accounts use those encrypted app credentials and keep separate login tokens.</p>' : ''}</section>`;
  }

  function syncOverviewCards() {
    const activities = activityList();
    const undo = read(UNDO_KEY, null);
    const sync = read(SYNC_KEY, null);
    const activityBody = activities.length
      ? `<ol class="uwt-activity-list">${activities.slice(0, 8).map(item => `<li><span>${esc(item.label)}</span><time datetime="${esc(item.at)}">${esc(new Date(item.at).toLocaleString())}</time></li>`).join('')}</ol>`
      : '<p>No recent workspace activity yet. Your local edits and SoundCloud syncs will appear here.</p>';
    const undoBody = undo?.edits?.length
      ? `<p>${esc(undo.label)} · ${esc(new Date(undo.at).toLocaleString())}</p><button type="button" data-uwt="undo" class="uwt-primary">Undo this edit</button>`
      : '<p>Edits to existing track details and release or campaign plans can be undone once.</p>';
    const syncBody = sync
      ? `<p>${esc(new Date(sync.at).toLocaleString())}${sync.added || sync.removed || sync.updated ? ` · ${sync.added} added · ${sync.removed} removed · ${sync.updated} updated` : ' · no track changes'}</p><ul>${sync.metrics.slice(0, 4).map(item => `<li>${esc(item)}</li>`).join('')}</ul><small>Summary compares the two catalog snapshots returned by SoundCloud. It is not a complete account activity log.</small>`
      : '<p>After syncing, compare the new SoundCloud catalog snapshot with the previous one.</p>';
    return `<section class="uwt-overview-grid"><article class="uwt-panel"><div class="uwt-panel-head"><h2>Recent activity</h2><span>Saved on this PC</span></div>${activityBody}</article><article class="uwt-panel"><div class="uwt-panel-head"><h2>What changed?</h2><span>Last catalog sync</span></div>${syncBody}</article><article class="uwt-panel uwt-undo-panel"><div class="uwt-panel-head"><h2>Undo a metadata edit</h2><span>One reversible change</span></div>${undoBody}</article></section>`;
  }

  function refreshOverviewPanels() {
    const view = document.querySelector('#view');
    if (ctxRef?.getPage() !== 'overview' || !view) return;
    let section = view.querySelector('[data-uwt-overview]');
    if (!section) {
      view.insertAdjacentHTML('beforeend', `<div data-uwt-overview>${syncOverviewCards()}</div>`);
      section = view.querySelector('[data-uwt-overview]');
    } else section.innerHTML = syncOverviewCards();
  }

  function snapshotSummary(before, after) {
    const oldTracks = Array.isArray(before?.tracks) ? before.tracks : [];
    const newTracks = Array.isArray(after?.tracks) ? after.tracks : [];
    const oldById = new Map(oldTracks.map(track => [String(track.id), track]));
    const newById = new Map(newTracks.map(track => [String(track.id), track]));
    const added = newTracks.filter(track => !oldById.has(String(track.id))).length;
    const removed = oldTracks.filter(track => !newById.has(String(track.id))).length;
    const updated = newTracks.filter(track => {
      const prior = oldById.get(String(track.id));
      return prior && ['title', 'sharing', 'playback_count', 'likes_count', 'favoritings_count'].some(key => JSON.stringify(prior[key]) !== JSON.stringify(track[key]));
    }).length;
    const oldPlays = oldTracks.reduce((sum, track) => sum + Number(track.playback_count || 0), 0);
    const newPlays = newTracks.reduce((sum, track) => sum + Number(track.playback_count || 0), 0);
    const oldLikes = oldTracks.reduce((sum, track) => sum + Number(track.likes_count || track.favoritings_count || 0), 0);
    const newLikes = newTracks.reduce((sum, track) => sum + Number(track.likes_count || track.favoritings_count || 0), 0);
    const metrics = [];
    const metric = (label, oldValue, newValue) => { if (oldValue !== newValue) metrics.push(`${label}: ${Number(oldValue || 0).toLocaleString()} → ${Number(newValue || 0).toLocaleString()}`); };
    metric('Followers', before?.profile?.followers_count, after?.profile?.followers_count);
    metric('SoundCloud track count', before?.profile?.track_count, after?.profile?.track_count);
    metric('Catalog plays', oldPlays, newPlays);
    metric('Catalog likes', oldLikes, newLikes);
    if (!before) metrics.unshift('First saved catalog snapshot');
    return { at: new Date().toISOString(), added, removed, updated, metrics };
  }

  function instrumentSync(ctx) {
    const api = ctx.api;
    if (!api || api.__artistUiWorkspaceSyncObserver || typeof api.sync !== 'function') return;
    originalSync = api.sync;
    const wrapped = async (...args) => {
      const before = ctx.getConnection()?.snapshot || null;
      renderTask({ kind: 'sync', title: 'Syncing SoundCloud catalog', detail: 'Waiting for the profile and catalog response', step: 0, stages: ['Contacting SoundCloud', 'Reading returned track pages', 'Saving the new snapshot'] });
      try {
        const result = await originalSync(...args);
        const summary = snapshotSummary(before, result?.snapshot || null);
        write(SYNC_KEY, summary);
        recordActivity('Synced SoundCloud catalog', 'sync');
        renderTask({ kind: 'sync', title: 'Catalog sync complete', detail: `${summary.added} added · ${summary.removed} removed · ${summary.updated} updated`, step: 3, stages: ['Profile received', 'Catalog received', 'Snapshot saved'] });
        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(() => renderTask(null), 7000);
        refreshOverviewPanels();
        return result;
      } catch (error) {
        renderTask({ kind: 'sync', title: 'Catalog sync did not finish', detail: 'The previous saved snapshot remains available.', step: 0, stages: ['Request failed', 'Previous snapshot preserved', 'Reconnect or try again'] });
        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(() => renderTask(null), 8000);
        throw error;
      }
    };
    try { api.sync = wrapped; syncObserverInstalled = api.sync === wrapped; } catch { syncObserverInstalled = false; }
  }

  function instrumentUpload(ctx) {
    const api = window.studio;
    if (!api || api.__artistUiWorkspaceUploadObserver || typeof api.upload !== 'function') return;
    originalUpload = api.upload;
    const wrapped = async (...args) => {
      renderTask({ kind: 'upload', title: 'Preparing upload', detail: 'Checking the active SoundCloud account', percent: 0, step: 0, stages: ['Prepare track', 'Transfer audio', 'Wait for SoundCloud acceptance'] });
      try {
        const result = await originalUpload(...args);
        renderTask({ kind: 'upload', title: 'Upload accepted', detail: 'SoundCloud received the track; processing may continue online.', percent: 100, step: 3, stages: ['Track prepared', 'Audio transferred', 'SoundCloud accepted upload'] });
        recordActivity('Uploaded a track to SoundCloud', 'upload');
        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(() => renderTask(null), 7000);
        return result;
      } catch (error) {
        renderTask({ kind: 'upload', title: 'Upload did not finish', detail: 'Review the upload result before retrying.', percent: activeTask?.percent || 0, step: 1, stages: ['Track prepared', 'Transfer stopped or was rejected', 'Check SoundCloud before retrying'] });
        clearTimeout(summaryTimer);
        summaryTimer = setTimeout(() => renderTask(null), 8000);
        throw error;
      }
    };
    try { api.upload = wrapped; } catch { /* Main-world bridge methods can be read-only in Electron. */ }
    if (typeof api.onUpload === 'function') api.onUpload(data => {
      if (activeTask?.kind !== 'upload') return;
      const percent = Math.max(0, Math.min(100, Number(data?.percent || 0)));
      renderTask({ ...activeTask, title: percent >= 100 ? 'Waiting for SoundCloud response' : 'Uploading audio', detail: percent >= 100 ? 'Transfer sent; waiting for acceptance' : `${percent}% transferred`, percent, step: percent >= 100 ? 2 : 1 });
    });
  }

  function availableCommands() {
    const commands = [...document.querySelectorAll('#nav button[data-page]')].map(button => ({ label: `Open ${button.textContent.trim()}`, kind: 'page', value: button.dataset.page }));
    const connection = ctxRef?.getConnection() || {};
    const actions = [
      ['Import audio', 'import', ''], ['Create a release plan', 'new-release', ''],
      ['Open upload desk', 'upload-page', ''], ['Open SoundCloud account', 'connect-page', '']
    ];
    if (connection.connected) actions.unshift(['Sync SoundCloud catalog', 'sync', '']);
    for (const [label, action, id] of actions) commands.push({ label, kind: 'action', value: action, id });
    return commands;
  }

  function paintCommands(query = '') {
    const root = document.querySelector('#uwt-palette-results');
    if (!root) return;
    const value = query.trim().toLocaleLowerCase();
    const rows = availableCommands().filter(item => !value || item.label.toLocaleLowerCase().includes(value)).slice(0, 12);
    root.innerHTML = rows.length ? rows.map((item, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-uwt-command-kind="${item.kind}" data-uwt-command-value="${esc(item.value)}" data-id="${esc(item.id || '')}"><span>${esc(item.label)}</span><kbd>${item.kind === 'page' ? 'PAGE' : 'ACTION'}</kbd></button>`).join('') : '<p class="uwt-no-commands">No matching pages or actions.</p>';
  }

  function openPalette() {
    const dialog = document.querySelector('#uwt-command-palette');
    if (!dialog) return;
    const query = dialog.querySelector('#uwt-palette-query');
    query.value = '';
    paintCommands('');
    dialog.showModal();
    query.focus();
  }

  function runCommand(kind, value, id = '') {
    document.querySelector('#uwt-command-palette')?.close();
    if (kind === 'page') {
      document.querySelector(`#nav [data-page="${CSS.escape(value)}"]`)?.click();
      return;
    }
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.action = value; button.dataset.id = id;
    button.hidden = true; document.body.appendChild(button); button.click(); button.remove();
  }

  function updateConnection(ctx, value) {
    const connection = ctx.getConnection();
    Object.keys(connection).forEach(key => delete connection[key]);
    Object.assign(connection, value || {});
    ctx.render();
  }

  function accountActions(ctx) {
    const root = document.querySelector('#view');
    if (ctx.getPage() !== 'soundcloud' || !root || root.querySelector('[data-uwt-account]')) return;
    const firstBlock = root.querySelector('.settings-block');
    if (!firstBlock) return;
    firstBlock.insertAdjacentHTML('beforebegin', `<div data-uwt-account>${connectionSummary(ctx)}</div>`);
  }

  function handleClick(event) {
    const command = event.target.closest('[data-uwt-command-kind]');
    if (command) {
      event.preventDefault();
      runCommand(command.dataset.uwtCommandKind, command.dataset.uwtCommandValue, command.dataset.id || '');
      return;
    }
    const button = event.target.closest('[data-uwt]');
    if (!button) return;
    const action = button.dataset.uwt;
    const ctx = ctxRef;
    if (!ctx) return;
    event.preventDefault();
    if (action === 'open-palette') openPalette();
    else if (action === 'close-palette') document.querySelector('#uwt-command-palette')?.close();
    else if (action === 'open-prefs') {
      const dialog = document.querySelector('#uwt-preferences');
      dialog.querySelector('[data-uwt-pref="contrast"]').checked = !!prefs.contrast;
      dialog.querySelector('[data-uwt-pref="compact"]').checked = !!prefs.compact;
      dialog.querySelector('[data-uwt-pref="scale"]').value = String(prefs.scale);
      dialog.showModal();
    } else if (action === 'add-account') {
      (async () => {
        if (typeof ctx.api.accountAdd !== 'function') throw new Error('Secure multi-account storage is unavailable in this build.');
        const label = document.querySelector('[data-uwt-account-label]')?.value?.trim() || '';
        const status = await ctx.api.accountAdd(label);
        updateConnection(ctx, status);
        recordActivity('Added a SoundCloud account', 'account');
        ctx.notice('Account saved securely. Finish authorization in your browser to connect it.');
        const connected = await ctx.api.authorize();
        updateConnection(ctx, connected);
        recordActivity('Connected a SoundCloud account', 'account');
        ctx.notice('SoundCloud account connected and active.');
      })().catch(error => ctx.notice(error.message || 'Could not add the account.'));
    } else if (action === 'remove-account') {
      const id = button.dataset.id;
      const label = button.closest('li')?.querySelector('span')?.textContent?.replace('ACTIVE', '').trim() || 'this account';
      if (!window.confirm(`Remove ${label} and its saved SoundCloud login from this PC?`)) return;
      (async () => {
        const status = await ctx.api.accountRemove(id);
        updateConnection(ctx, status);
        recordActivity('Removed a SoundCloud account', 'account');
        ctx.notice('Saved account login removed from this PC.');
      })().catch(error => ctx.notice(error.message || 'Could not remove the account.'));
    } else if (action === 'undo') {
      performUndo(ctx).catch(error => ctx.notice(error.message || 'Could not undo this edit.'));
    } else if (action === 'palette-command') runCommand(button.dataset.kind, button.dataset.value, button.dataset.id || '');
  }

  async function performUndo(ctx) {
    const record = read(UNDO_KEY, null);
    if (!record?.edits?.length) return ctx.notice('There is no reversible metadata edit to undo.');
    const state = ctx.getState();
    for (const edit of record.edits) {
      const current = state[edit.collection]?.find(row => row.id === edit.id);
      if (!current || Object.entries(edit.after).some(([key, value]) => {
        const actual = Object.prototype.hasOwnProperty.call(current, key) ? { present: true, value: current[key] } : { present: false };
        return JSON.stringify(actual) !== JSON.stringify(value);
      })) {
        write(UNDO_KEY, null);
        refreshOverviewPanels();
        return ctx.notice('This edit changed again, so it cannot be safely undone.');
      }
    }
    undoSuppressed = true;
    try {
      await ctx.update(current => {
        for (const edit of record.edits) {
          const row = current[edit.collection].find(item => item.id === edit.id);
          for (const [key, value] of Object.entries(edit.before)) {
            if (value.present) row[key] = jsonClone(value.value);
            else delete row[key];
          }
        }
      });
    } finally { undoSuppressed = false; }
    write(UNDO_KEY, null);
    recordActivity('Undid a metadata or planning edit', 'undo');
    refreshOverviewPanels();
    ctx.notice('The previous metadata and planning values were restored.');
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-uwt-account-switch]')) {
      (async () => {
        const status = await ctxRef.api.accountSwitch(target.value);
        updateConnection(ctxRef, status);
        recordActivity('Switched active SoundCloud account', 'account');
        ctxRef.notice(`Active SoundCloud account: ${status.snapshot?.profile?.username || status.accounts?.find(item => item.id === status.activeAccountId)?.label || 'account'}.`);
      })().catch(error => ctxRef?.notice(error.message || 'Could not switch accounts.'));
    } else if (target.matches('[data-uwt-command-kind]')) {
      runCommand(target.dataset.uwtCommandKind, target.dataset.uwtCommandValue, target.dataset.id || '');
    }
  }

  function handleInput(event) {
    if (event.target.id === 'uwt-palette-query') paintCommands(event.target.value);
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault(); openPalette(); return;
    }
    const dialog = document.querySelector('#uwt-command-palette');
    if (!dialog?.open) return;
    const options = [...dialog.querySelectorAll('[data-uwt-command-kind]')];
    const index = options.findIndex(button => button.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
      options.forEach((button, i) => button.setAttribute('aria-selected', String(i === next)));
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault(); options[Math.max(0, index)].click();
    }
  }

  function recordClicks() {
    document.addEventListener('click', event => {
      if (event.target.closest('[data-uwt]') || event.target.closest('[data-uwt-command-kind]')) return;
      const page = event.target.closest('#nav [data-page]');
      if (page) { recordActivity(`Opened ${navNames[page.dataset.page] || page.textContent.trim()}`, 'navigation'); return; }
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const label = button.getAttribute('aria-label') || button.textContent.trim();
      const mapping = {
        sync: 'Started SoundCloud catalog sync', import: 'Imported audio', 'import-audio': 'Imported audio',
        'upload-page': 'Opened upload workflow', 'upload-track': 'Prepared a track upload',
        'new-release': 'Started a release plan', 'new-campaign': 'Started a campaign',
        'save-credentials': 'Saved SoundCloud app credentials', authorize: 'Started SoundCloud connection'
      };
      const action = button.dataset.action;
      if (mapping[action]) recordActivity(mapping[action], 'action');
      else if (label && label.length < 70 && !/^(edit|remove|delete|save)$/i.test(label)) recordActivity(label, 'action');
      if (action === 'sync' && !syncObserverInstalled) {
        syncBaseline = ctxRef?.getConnection()?.snapshot || null;
        syncPending = true;
        renderTask({ kind: 'sync', title: 'Syncing SoundCloud catalog', detail: 'Waiting for SoundCloud profile and track data', step: 0, stages: ['Contacting SoundCloud', 'Reading returned track pages', 'Saving the new snapshot'] });
      }
    }, true);
    document.addEventListener('submit', event => {
      if (event.target?.id === 'edit-form') lastState = trackedSnapshot(ctxRef?.getState());
    }, true);
  }

  function installNoticeObserver() {
    const notice = document.querySelector('#notice');
    if (!notice || notice.dataset.uwtObserver) return;
    notice.dataset.uwtObserver = 'true';
    new MutationObserver(() => {
      const text = notice.textContent || '';
      if (syncPending && /catalog updated|catalog is ready/i.test(text)) {
        const summary = snapshotSummary(syncBaseline, ctxRef?.getConnection()?.snapshot || null);
        write(SYNC_KEY, summary);
        recordActivity('Synced SoundCloud catalog', 'sync');
        syncPending = false; syncBaseline = null;
        renderTask({ kind: 'sync', title: 'Catalog sync complete', detail: `${summary.added} added · ${summary.removed} removed · ${summary.updated} updated`, step: 3, stages: ['Profile received', 'Catalog received', 'Snapshot saved'] });
        clearTimeout(summaryTimer); summaryTimer = setTimeout(() => renderTask(null), 7000);
        refreshOverviewPanels();
      } else if (syncPending && /soundcloud returned|rate limit|authorization failed|timed out|catalog sync/i.test(text)) {
        syncPending = false; syncBaseline = null;
        renderTask({ kind: 'sync', title: 'Catalog sync did not finish', detail: 'The previous saved snapshot remains available.', step: 0, stages: ['Request failed', 'Previous snapshot preserved', 'Reconnect or try again'] });
        clearTimeout(summaryTimer); summaryTimer = setTimeout(() => renderTask(null), 8000);
      }
      if (activeTask?.kind === 'upload' && /accepted the upload|upload accepted|upload failed|upload was canceled|upload rejected|upload timed out|rate limit reached|soundcloud returned/i.test(text)) {
        const succeeded = /accepted the upload|upload accepted/i.test(text);
        renderTask({ kind: 'upload', title: succeeded ? 'Upload accepted' : 'Upload did not finish', detail: succeeded ? 'SoundCloud received the track; processing may continue online.' : 'Review the upload result before retrying.', percent: succeeded ? 100 : activeTask.percent || 0, step: succeeded ? 3 : 1, stages: succeeded ? ['Track prepared', 'Audio transferred', 'SoundCloud accepted upload'] : ['Track prepared', 'Transfer stopped or was rejected', 'Check SoundCloud before retrying'] });
        if (succeeded) recordActivity('Uploaded a track to SoundCloud', 'upload');
        clearTimeout(summaryTimer); summaryTimer = setTimeout(() => renderTask(null), succeeded ? 7000 : 8000);
      }
    }).observe(notice, { childList: true, characterData: true, subtree: true });
  }

  window.registerArtistPlugin({
    id: ID,
    init(ctx) {
      ctxRef = ctx;
      prefs = { ...prefs, ...read(PREFS_KEY, {}) };
      prefs.scale = [0.9, 1, 1.1, 1.2, 1.3].includes(Number(prefs.scale)) ? Number(prefs.scale) : 1;
      applyPrefs(); styles(); prefsDialog(); commandDialog();
      lastState = trackedSnapshot(ctx.getState());
      installSaveObserver(ctx); instrumentSync(ctx); instrumentUpload(ctx);
      recordClicks();
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
      document.addEventListener('input', handleInput);
      document.addEventListener('keydown', handleKeydown);
      window.studio.onUpload?.(data => {
        if (activeTask?.kind === 'upload') return;
        const percent = Math.max(0, Math.min(100, Number(data?.percent || 0)));
        renderTask({ kind: 'upload', title: 'Uploading audio', detail: `${percent}% transferred`, percent, step: percent >= 100 ? 2 : 1, stages: ['Track prepared', 'Transfer audio', 'Wait for SoundCloud acceptance'] });
      });
    },
    onRender(ctx) {
      ctxRef = ctx;
      styles(); toolBar(ctx); metricTooltips(); accountActions(ctx);
      const currentSnapshot = trackedSnapshot(ctx.getState());
      if (!saveObserverInstalled) {
        const edits = changedRecords(lastState, currentSnapshot);
        if (edits.length && !undoSuppressed) {
          const editKind = edits.length === 1 ? categoryFor(edits[0].collection) : 'metadata and planning';
          write(UNDO_KEY, { id: crypto.randomUUID(), label: `Edited ${editKind}`, at: new Date().toISOString(), edits });
          recordActivity(`Edited ${editKind}`, 'edit');
        }
      }
      lastState = currentSnapshot;
      if (ctx.getPage() === 'overview') refreshOverviewPanels();
      if (activeTask) renderTask(activeTask);
    }
  });
})();
