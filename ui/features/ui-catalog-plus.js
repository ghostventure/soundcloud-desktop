(() => {
  const ID = 'ui-catalog-plus';
  const STORE = 'sc-artist-ui-catalog-plus-v1';
  const PAGE_SIZE = 100;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const asText = value => value == null ? '' : String(value);
  const safeParse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
  const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const stored = safeParse(readStored(STORE));
  const preferences = {
    overview: { order: [], hidden: [], ...(stored.overview || {}) },
    catalog: {
      columns: { id: false, title: true, visibility: true, plays: true, likes: true, url: false, description: false, release: false, uploaded: false, ...(stored.catalog?.columns || {}) },
      filters: Array.isArray(stored.catalog?.filters) ? stored.catalog.filters : [],
      query: stored.catalog?.query || '',
      visibility: stored.catalog?.visibility || 'All',
      sort: stored.catalog?.sort || 'title',
      direction: stored.catalog?.direction === -1 ? -1 : 1,
      group: stored.catalog?.group || '',
      ...(stored.catalog || {})
    }
  };
  const selected = new Set();
  let context = null;
  let lastTracks = [];
  let lastHistory = { changes: [], delta: null, previousAt: '' };

  function savePreferences() {
    try { localStorage.setItem(STORE, JSON.stringify(preferences)); } catch { /* View preferences are best effort on locked-down profiles. */ }
  }

  function addStyles() {
    if (document.querySelector('link[data-ui-catalog-plus-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'features/ui-catalog-plus.css';
    link.dataset.uiCatalogPlusStyle = 'true';
    document.head.appendChild(link);
  }

  const metricSummary = snapshot => {
    const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
    const profile = snapshot?.profile || {};
    return {
      syncedAt: snapshot?.syncedAt || '',
      followers: profile.followers_count != null && Number.isFinite(Number(profile.followers_count)) ? Number(profile.followers_count) : null,
      trackCount: profile.track_count != null && Number.isFinite(Number(profile.track_count)) ? Number(profile.track_count) : tracks.length,
      plays: tracks.reduce((sum, track) => sum + number(track.playback_count), 0),
      likes: tracks.reduce((sum, track) => sum + number(track.likes_count ?? track.favoritings_count), 0),
      tracks: tracks.map(track => ({ id: asText(track.id), title: asText(track.title || 'Untitled track'), sharing: asText(track.sharing) }))
    };
  };

  function diffCatalog(previous, current, at) {
    const before = new Map((previous?.tracks || []).map(track => [track.id, track]));
    const after = new Map((current?.tracks || []).map(track => [track.id, track]));
    const changes = [];
    for (const track of current.tracks) {
      const old = before.get(track.id);
      if (!old) changes.push({ at, kind: 'Added', title: track.title, id: track.id, detail: 'New track in the synced catalog' });
      else {
        if (old.title !== track.title) changes.push({ at, kind: 'Renamed', title: track.title, id: track.id, detail: `${old.title} → ${track.title}` });
        if (old.sharing !== track.sharing) changes.push({ at, kind: 'Visibility', title: track.title, id: track.id, detail: `${old.sharing || 'Unknown'} → ${track.sharing || 'Unknown'}` });
      }
    }
    for (const track of previous?.tracks || []) {
      if (!after.has(track.id)) changes.push({ at, kind: 'Removed', title: track.title, id: track.id, detail: 'No longer returned by the latest catalog sync' });
    }
    return changes;
  }

  function accountHistory(snapshot) {
    const current = metricSummary(snapshot);
    const account = asText(snapshot?.profile?.username || 'default').toLowerCase();
    const all = safeParse(readStored(`${STORE}:history`));
    const entry = all[account] || { latest: null, previousAt: '', delta: null, changes: [] };
    if (current.syncedAt && entry.latest?.syncedAt !== current.syncedAt) {
      if (entry.latest) {
        entry.previousAt = entry.latest.syncedAt;
        entry.delta = Object.fromEntries(['followers', 'trackCount', 'plays', 'likes'].map(key => [key, {
          previous: entry.latest[key], current: current[key], difference: entry.latest[key] == null || current[key] == null ? null : current[key] - entry.latest[key]
        }]));
        entry.changes = [...diffCatalog(entry.latest, current, current.syncedAt), ...(entry.changes || [])].slice(0, 100);
      }
      entry.latest = current;
      all[account] = entry;
      try { localStorage.setItem(`${STORE}:history`, JSON.stringify(all)); } catch { /* Keep the live view useful if local storage is full. */ }
    }
    lastHistory = entry;
    return entry;
  }

  const formatNum = value => value == null ? '—' : Number(value).toLocaleString();
  const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${Number(value).toLocaleString()}`;
  const niceDate = value => {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? asText(value) : date.toLocaleString();
  };

  const overviewLabels = () => [...document.querySelectorAll('#view .stats .stat')].map(card => card.querySelector('.label')?.textContent.trim()).filter(Boolean);
  function overviewControls(labels) {
    const order = preferences.overview.order.filter(label => labels.includes(label));
    for (const label of labels) if (!order.includes(label)) order.push(label);
    preferences.overview.order = order;
    const rows = order.map((label, index) => `<div class="ucp-card-setting"><label><input type="checkbox" data-ucp-card-visible="${esc(label)}" ${preferences.overview.hidden.includes(label) ? '' : 'checked'}><span>${esc(label)}</span></label><div><button type="button" data-ucp-action="card-up" data-index="${index}" aria-label="Move ${esc(label)} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-ucp-action="card-down" data-index="${index}" aria-label="Move ${esc(label)} down" ${index === order.length - 1 ? 'disabled' : ''}>↓</button></div></div>`).join('');
    return `<details class="ucp-overview-settings"><summary>Customize Overview cards</summary><div class="ucp-card-settings">${rows}<p>Changes are saved on this PC.</p></div></details>`;
  }

  function applyOverviewCards(ctx) {
    const stats = document.querySelector('#view .stats');
    if (!stats || ctx.getPage() !== 'overview') return;
    const cards = [...stats.querySelectorAll('.stat')];
    if (!cards.length) return;
    const labels = cards.map(card => card.querySelector('.label')?.textContent.trim() || '');
    const order = preferences.overview.order.filter(label => labels.includes(label));
    for (const label of labels) if (!order.includes(label)) order.push(label);
    preferences.overview.order = order;
    const byLabel = new Map(cards.map(card => [card.querySelector('.label')?.textContent.trim() || '', card]));
    for (const label of order) {
      const card = byLabel.get(label);
      if (!card) continue;
      card.hidden = preferences.overview.hidden.includes(label);
      stats.appendChild(card);
    }
    if (!document.querySelector('#view [data-ucp-overview-settings]')) {
      const root = document.createElement('div');
      root.dataset.ucpOverviewSettings = 'true';
      root.innerHTML = overviewControls(labels);
      stats.insertAdjacentElement('afterend', root);
    }
  }

  function signedMetric(label, key) {
    const item = lastHistory.delta?.[key];
    if (!item) return `<article class="ucp-delta"><span>${esc(label)}</span><strong>First sync</strong><small>Sync again to compare</small></article>`;
    const change = item.difference;
    return `<article class="ucp-delta"><span>${esc(label)}</span><strong>${signed(change)}</strong><small>${formatNum(item.previous)} → ${formatNum(item.current)}</small></article>`;
  }

  function renderOverviewSnapshot(snapshot) {
    if (!snapshot?.syncedAt) return '';
    const previousAt = lastHistory.previousAt;
    const compare = lastHistory.delta
      ? `<div class="ucp-delta-grid">${signedMetric('Followers', 'followers')}${signedMetric('Account tracks', 'trackCount')}${signedMetric('Catalog plays', 'plays')}${signedMetric('Catalog likes', 'likes')}</div><p class="ucp-note">Compared with sync from ${esc(niceDate(previousAt))}. Plays and likes are cumulative counts; the difference is the change observed between snapshots.</p>`
      : '<p class="ucp-note">Sync again after this saved snapshot to see the changes since the previous sync.</p>';
    return `<section class="panel ucp-compare" aria-labelledby="ucp-compare-title"><div class="ucp-panel-heading"><div><span class="eyebrow">SYNC COMPARISON</span><h2 id="ucp-compare-title">Changes since your previous sync</h2></div><small>Latest: ${esc(niceDate(snapshot.syncedAt))}</small></div>${compare}</section>`;
  }

  const optionalFields = {
    url: track => track.permalink_url || track.url,
    description: track => track.description,
    release: track => track.release_title || track.release || track.album_title,
    uploaded: track => track.created_at || track.createdAt || track.uploaded_at
  };
  function availableFields(tracks) {
    return Object.fromEntries(Object.entries(optionalFields).map(([key, getter]) => [key, tracks.some(track => asText(getter(track)).trim())]));
  }
  function groupOptions(tracks) {
    const optional = availableFields(tracks);
    const choices = [{ value: '', label: 'No grouping' }];
    if (tracks.some(track => asText(track.sharing).trim())) choices.push({ value: 'visibility', label: 'Visibility' });
    if (optional.release) choices.push({ value: 'release', label: 'Release' });
    if (optional.uploaded) choices.push({ value: 'uploaded', label: 'Upload date' });
    return choices;
  }
  function groupValue(track, group) {
    if (group === 'visibility') return asText(track.sharing) || 'Unknown visibility';
    if (group === 'release') return asText(optionalFields.release(track)) || 'No release metadata';
    if (group === 'uploaded') {
      const raw = asText(optionalFields.uploaded(track));
      if (!raw) return 'Unknown upload date';
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString();
    }
    return '';
  }
  const baseColumns = [
    ['id', 'Track ID', track => asText(track.id)],
    ['title', 'Track', track => asText(track.title || 'Untitled track')],
    ['visibility', 'Visibility', track => asText(track.sharing) || 'Unknown'],
    ['plays', 'Plays', track => number(track.playback_count)],
    ['likes', 'Likes', track => number(track.likes_count ?? track.favoritings_count)],
    ['url', 'URL', track => asText(optionalFields.url(track))],
    ['description', 'Description', track => asText(optionalFields.description(track))],
    ['release', 'Release', track => asText(optionalFields.release(track))],
    ['uploaded', 'Uploaded', track => asText(optionalFields.uploaded(track))]
  ];
  function availableColumns(tracks) {
    const optional = availableFields(tracks);
    return baseColumns.filter(([key]) => !optionalFields[key] || optional[key]);
  }
  const sortValue = (track, key) => {
    if (key === 'plays') return number(track.playback_count);
    if (key === 'likes') return number(track.likes_count ?? track.favoritings_count);
    const col = baseColumns.find(([id]) => id === key);
    return col ? col[2](track).toLocaleLowerCase() : '';
  };
  function compareTracks(a, b) {
    if (preferences.catalog.group) {
      const grouped = groupValue(a, preferences.catalog.group).localeCompare(groupValue(b, preferences.catalog.group), undefined, { numeric: true, sensitivity: 'base' });
      if (grouped) return grouped;
    }
    const av = sortValue(a, preferences.catalog.sort), bv = sortValue(b, preferences.catalog.sort);
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
    return cmp * preferences.catalog.direction;
  }

  function activeChips() {
    const chips = [];
    if (preferences.catalog.query.trim()) chips.push(`<button type="button" class="ucp-chip" data-ucp-action="clear-query">Search: “${esc(preferences.catalog.query.trim())}” <span aria-hidden="true">×</span></button>`);
    if (preferences.catalog.visibility !== 'All') chips.push(`<button type="button" class="ucp-chip" data-ucp-action="clear-visibility">Visibility: ${esc(preferences.catalog.visibility)} <span aria-hidden="true">×</span></button>`);
    if (preferences.catalog.group) chips.push(`<button type="button" class="ucp-chip" data-ucp-action="clear-group">Group: ${esc(preferences.catalog.group === 'uploaded' ? 'Upload date' : preferences.catalog.group)} <span aria-hidden="true">×</span></button>`);
    return chips.length ? `<div class="ucp-chips" aria-label="Active filters">${chips.join('')}</div>` : '<span class="ucp-note">No active filters</span>';
  }

  function catalogRows(tracks, columns, group) {
    const result = [];
    let lastGroup = null;
    for (const track of tracks) {
      if (group) {
        const value = groupValue(track, group);
        if (value !== lastGroup) {
          lastGroup = value;
          const span = columns.filter(column => preferences.catalog.columns[column[0]]).length + 1;
          result.push(`<tr class="ucp-group-row"><th colspan="${span}">${esc(value)}</th></tr>`);
        }
      }
      const id = asText(track.id);
      const cells = columns.filter(column => preferences.catalog.columns[column[0]]).map(([key, label, getter]) => {
        const value = getter(track);
        if (key === 'plays' || key === 'likes') return `<td class="ucp-number">${formatNum(value)}</td>`;
        if (key === 'url' && value) return `<td><a href="${esc(value)}" target="_blank" rel="noreferrer">Open link ↗</a></td>`;
        if (key === 'description') return `<td class="ucp-description" title="${esc(value)}">${esc(value || '—')}</td>`;
        if (key === 'uploaded') return `<td>${esc(niceDate(value))}</td>`;
        return `<td>${esc(value || '—')}</td>`;
      }).join('');
      result.push(`<tr><td class="ucp-select-cell"><input type="checkbox" aria-label="Select ${esc(track.title || id)}" data-ucp-select="${esc(id)}" ${selected.has(id) ? 'checked' : ''}></td>${cells}</tr>`);
    }
    return result.join('');
  }

  function filteredTracks() {
    const query = preferences.catalog.query.trim().toLocaleLowerCase();
    return lastTracks.filter(track => {
      if (preferences.catalog.visibility !== 'All' && track.sharing !== preferences.catalog.visibility.toLowerCase()) return false;
      if (!query) return true;
      const fields = [track.id, track.title, track.sharing, optionalFields.url(track), optionalFields.description(track), optionalFields.release(track), optionalFields.uploaded(track)];
      return fields.some(value => asText(value).toLocaleLowerCase().includes(query));
    });
  }

  function savedFilterOptions() {
    return `<option value="">Saved filters…</option>${preferences.catalog.filters.map((filter, index) => `<option value="${index}" ${preferences.catalog.selectedFilter === index ? 'selected' : ''}>${esc(filter.name)}</option>`).join('')}`;
  }

  function changelogMarkup() {
    const changes = lastHistory.changes || [];
    const newest = changes.slice(0, 25);
    const rows = newest.length ? newest.map(item => `<li><span class="ucp-change-kind">${esc(item.kind)}</span><div><strong>${esc(item.title || 'Untitled track')}</strong><small>${esc(item.detail || '')} · ${esc(niceDate(item.at))}</small></div><code>${esc(item.id)}</code></li>`).join('') : '<li class="ucp-empty-change">No catalog changes have been recorded yet. The next sync will be compared with this snapshot.</li>';
    return `<details class="panel ucp-changelog"><summary>Catalog change log <span>${changes.length.toLocaleString()} recorded</span></summary><ul>${rows}</ul></details>`;
  }

  function renderCatalogPanel() {
    const panel = document.querySelector('#view table')?.closest('.panel');
    if (!panel) return;
    const tracks = lastTracks;
    const columns = availableColumns(tracks);
    const columnSettings = columns.map(([key, label]) => `<label><input type="checkbox" data-ucp-column="${key}" ${preferences.catalog.columns[key] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('');
    const groups = groupOptions(tracks);
    if (!groups.some(option => option.value === preferences.catalog.group)) preferences.catalog.group = '';
    const filtered = filteredTracks();
    const sorted = filtered.slice().sort(compareTracks);
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    preferences.catalog.page = Math.min(Math.max(0, preferences.catalog.page || 0), pageCount - 1);
    const page = preferences.catalog.page;
    const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const displayColumns = columns.filter(column => preferences.catalog.columns[column[0]]);
    const sortDirection = key => preferences.catalog.sort === key ? (preferences.catalog.direction === 1 ? ' ↑' : ' ↓') : '';
    const headers = displayColumns.map(([key, label]) => `<th><button type="button" class="ucp-sort" data-ucp-sort="${key}" aria-label="Sort by ${esc(label)}">${esc(label)}${sortDirection(key)}</button></th>`).join('');
    const sortOptions = displayColumns.map(([key, label]) => `<option value="${key}" ${preferences.catalog.sort === key ? 'selected' : ''}>${esc(label)}</option>`).join('');
    const visibleIds = visible.map(track => asText(track.id));
    const selectedVisible = visibleIds.filter(id => selected.has(id)).length;
    const history = changelogMarkup();
    panel.innerHTML = `<div class="ucp-catalog">
      <div class="ucp-toolbar">
        <label class="ucp-search-label">Search catalog<input type="search" data-ucp-field="query" value="${esc(preferences.catalog.query)}" placeholder="Track title, ID, URL, or description" aria-label="Search tracks by title, ID, URL, or description"></label>
        <label>Visibility<select data-ucp-field="visibility"><option ${preferences.catalog.visibility === 'All' ? 'selected' : ''}>All</option><option value="Public" ${preferences.catalog.visibility === 'Public' ? 'selected' : ''}>Public</option><option value="Private" ${preferences.catalog.visibility === 'Private' ? 'selected' : ''}>Private</option></select></label>
        <label>Group by<select data-ucp-field="group">${groups.map(option => `<option value="${esc(option.value)}" ${preferences.catalog.group === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label>
        <label>Sort by<select data-ucp-field="sort">${sortOptions}</select></label>
        <label>Saved filters<select data-ucp-field="saved-filter">${savedFilterOptions()}</select></label>
        <button type="button" data-ucp-action="save-filter">Save current filter</button><button type="button" data-ucp-action="remove-filter" ${Number.isInteger(preferences.catalog.selectedFilter) && preferences.catalog.filters[preferences.catalog.selectedFilter] ? '' : 'disabled'}>Remove saved filter</button>
        <details class="ucp-column-picker"><summary>Columns</summary><div>${columnSettings}</div></details>
      </div>
      <div class="ucp-filter-row">${activeChips()}<span class="ucp-selected-count" aria-live="polite">${selected.size.toLocaleString()} selected · ${selectedVisible.toLocaleString()} on this page</span></div>
      <div class="ucp-selection-actions"><label><input type="checkbox" data-ucp-select-visible ${visible.length > 0 && selectedVisible === visible.length ? 'checked' : ''}> Select visible page</label><button type="button" data-ucp-action="clear-selection" ${selected.size ? '' : 'disabled'}>Clear selection</button><span>Selected tracks are only marked for review; this does not change anything on SoundCloud.</span></div>
      <div class="ucp-table-wrap"><table><thead><tr><th class="ucp-select-head">SELECT</th>${headers}</tr></thead><tbody>${visible.length ? catalogRows(visible, columns, preferences.catalog.group) : `<tr><td colspan="${displayColumns.length + 1}" class="ucp-no-results">${tracks.length ? 'No tracks match these filters.' : 'No tracks are available in the saved catalog snapshot.'}</td></tr>`}</tbody></table></div>
      <div class="page-controls"><span>Showing ${sorted.length ? page * PAGE_SIZE + 1 : 0}–${Math.min((page + 1) * PAGE_SIZE, sorted.length)} of ${sorted.length.toLocaleString()} tracks</span><button type="button" data-ucp-action="page-prev" ${page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pageCount}</span><button type="button" data-ucp-action="page-next" ${page >= pageCount - 1 ? 'disabled' : ''}>Next</button></div>
    </div>${history}`;
  }

  function renderCatalog(ctx) {
    const snapshot = ctx.getConnection()?.snapshot;
    const source = document.querySelector('#view table')?.closest('.panel');
    if (!source || !snapshot) return;
    lastTracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
    accountHistory(snapshot);
    renderCatalogPanel();
  }

  function refreshCatalog(focusSelector = '', caret = null) {
    if (!context || context.getPage() !== 'soundcloud') return;
    renderCatalogPanel();
    if (focusSelector) {
      const target = document.querySelector(focusSelector);
      target?.focus();
      if (caret != null && target?.setSelectionRange) target.setSelectionRange(caret, caret);
    }
  }

  function moveOverviewCard(index, delta) {
    const order = preferences.overview.order;
    const next = index + delta;
    if (next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    savePreferences();
    context?.render();
  }

  function handleClick(event) {
    const actionButton = event.target.closest('[data-ucp-action]');
    if (!actionButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = actionButton.dataset.ucpAction;
    if (action === 'card-up' || action === 'card-down') return moveOverviewCard(Number(actionButton.dataset.index), action === 'card-up' ? -1 : 1);
    if (action === 'clear-query') preferences.catalog.query = '';
    if (action === 'clear-visibility') preferences.catalog.visibility = 'All';
    if (action === 'clear-group') preferences.catalog.group = '';
    if (action === 'page-prev') preferences.catalog.page = Math.max(0, (preferences.catalog.page || 0) - 1);
    if (action === 'page-next') preferences.catalog.page = (preferences.catalog.page || 0) + 1;
    if (action === 'clear-selection') selected.clear();
    if (action === 'save-filter') {
      const name = window.prompt('Name this catalog filter');
      if (!name?.trim()) return;
      preferences.catalog.filters.push({ name: name.trim().slice(0, 60), query: preferences.catalog.query, visibility: preferences.catalog.visibility });
      preferences.catalog.selectedFilter = preferences.catalog.filters.length - 1;
    }
    if (action === 'remove-filter' && Number.isInteger(preferences.catalog.selectedFilter)) {
      preferences.catalog.filters.splice(preferences.catalog.selectedFilter, 1);
      preferences.catalog.selectedFilter = null;
    }
    savePreferences();
    refreshCatalog();
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-ucp-card-visible]')) {
      const label = target.dataset.ucpCardVisible;
      preferences.overview.hidden = target.checked ? preferences.overview.hidden.filter(item => item !== label) : [...new Set([...preferences.overview.hidden, label])];
      savePreferences();
      context?.render();
      return;
    }
    if (target.matches('[data-ucp-column]')) {
      preferences.catalog.columns[target.dataset.ucpColumn] = target.checked;
      savePreferences();
      refreshCatalog();
      return;
    }
    if (target.matches('[data-ucp-select]')) {
      target.checked ? selected.add(target.dataset.ucpSelect) : selected.delete(target.dataset.ucpSelect);
      refreshCatalog();
      return;
    }
    if (target.matches('[data-ucp-select-visible]')) {
      const filtered = filteredTracks().slice().sort(compareTracks);
      const ids = filtered.slice((preferences.catalog.page || 0) * PAGE_SIZE, ((preferences.catalog.page || 0) + 1) * PAGE_SIZE).map(track => asText(track.id));
      if (target.checked) ids.forEach(id => selected.add(id)); else ids.forEach(id => selected.delete(id));
      refreshCatalog();
      return;
    }
    if (!target.matches('[data-ucp-field]')) return;
    const field = target.dataset.ucpField;
    if (field === 'saved-filter') {
      const filter = preferences.catalog.filters[Number(target.value)];
      if (filter) {
        preferences.catalog.selectedFilter = Number(target.value);
        preferences.catalog.query = filter.query || '';
        preferences.catalog.visibility = filter.visibility || 'All';
        preferences.catalog.page = 0;
      } else preferences.catalog.selectedFilter = null;
    } else if (field === 'visibility') preferences.catalog.visibility = target.value;
    else if (field === 'group') preferences.catalog.group = target.value;
    else if (field === 'sort') { preferences.catalog.sort = target.value; preferences.catalog.page = 0; }
    savePreferences();
    refreshCatalog();
  }

  function handleInput(event) {
    const target = event.target;
    if (!target.matches('[data-ucp-field="query"]')) return;
    const caret = target.selectionStart;
    preferences.catalog.query = target.value;
    preferences.catalog.page = 0;
    savePreferences();
    refreshCatalog('[data-ucp-field="query"]', caret);
  }

  function handleSort(event) {
    const button = event.target.closest('[data-ucp-sort]');
    if (!button || context?.getPage() !== 'soundcloud') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = button.dataset.ucpSort;
    if (preferences.catalog.sort === key) preferences.catalog.direction *= -1;
    else { preferences.catalog.sort = key; preferences.catalog.direction = 1; }
    preferences.catalog.page = 0;
    savePreferences();
    refreshCatalog();
  }

  window.registerArtistPlugin({
    id: ID,
    init(ctx) {
      context = ctx;
      document.addEventListener('click', handleClick, true);
      document.addEventListener('click', handleSort, true);
      document.addEventListener('change', handleChange);
      document.addEventListener('input', handleInput);
    },
    onRender(ctx) {
      context = ctx;
      addStyles();
      if (ctx.getPage() === 'overview') {
        const snapshot = ctx.getConnection()?.snapshot;
        if (snapshot?.syncedAt) {
          accountHistory(snapshot);
          const compare = renderOverviewSnapshot(snapshot);
          const stats = document.querySelector('#view .stats');
          if (stats && !document.querySelector('#view [data-ucp-compare]')) {
            const box = document.createElement('div');
            box.dataset.ucpCompare = 'true';
            box.innerHTML = compare;
            const settings = document.querySelector('#view [data-ucp-overview-settings]');
            (settings || stats).insertAdjacentElement('afterend', box);
          }
        }
        applyOverviewCards(ctx);
      } else if (ctx.getPage() === 'soundcloud') renderCatalog(ctx);
    }
  });
})();
