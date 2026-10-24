(() => {
  const pluginId = 'track-ux-toolkit';
  const pageId = 'track-toolkit';
  const maxRecent = 12;
  const waveCache = new Map();
  let context;
  let view = 'all';
  let search = '';
  let selected = new Set();
  let reviewIds = [];
  let showReview = false;
  let detail = null;
  let shortcutsOpen = false;
  let uploading = false;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const list = (value) => Array.isArray(value) ? value : [];
  const validId = id => /^(?:\d{1,128}|soundcloud:tracks:\d{1,128})$/.test(String(id ?? ''));
  const prettyNumber = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
  const soundcloudUrl = value => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && ['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname.toLowerCase()) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  const data = () => context.getState().artistTrackUx ||= { favorites: [], recent: [] };
  const localTracks = () => list(context.getState().tracks);
  const releases = () => list(context.getState().releases);
  const remoteTracks = () => list(context.getConnection()?.snapshot?.tracks);
  const keyOf = (kind, id) => `${kind}:${id}`;
  const favoriteRefs = () => list(data().favorites);
  const isFavorite = (kind, id) => {
    const aliases = new Set([String(id)]);
    if (kind === 'remote') {
      const track = remoteTracks().find(item => String(item.id) === String(id) || String(item.urn) === String(id));
      if (track) { if (track.id !== undefined) aliases.add(String(track.id)); if (track.urn) aliases.add(String(track.urn)); }
    }
    return favoriteRefs().some(item => item.kind === kind && aliases.has(String(item.id)));
  };
  const safeTrackUrl = track => soundcloudUrl(track?.permalink_url || track?.link || track?.lastUpload?.url);
  const profileName = () => context.getState().profile?.name && context.getState().profile.name !== 'Your studio' ? context.getState().profile.name : '';
  const missingMetadata = track => [
    !String(track?.title || '').trim() && 'Title',
    !String(profileName()).trim() && 'Artist name',
    !String(track?.genre || '').trim() && 'Genre',
    !String(track?.credits || track?.notes || '').trim() && 'Credits or description'
  ].filter(Boolean);

  function styles() {
    if (document.querySelector('link[data-track-ux-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'features/ui-track-actions.css';
    link.dataset.trackUxStyle = 'true';
    document.head.appendChild(link);
  }

  function button(action, label, id = '', cls = '', extra = '') {
    return `<button type="button" class="tu-button ${cls}" data-tu-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
  }
  function localTrack(id) { return localTracks().find(track => String(track.id) === String(id)); }
  function remoteTrack(id) { return remoteTracks().find(track => String(track.id) === String(id) || String(track.urn) === String(id)); }
  function remoteTrackId(track) {
    const urn = String(track?.urn || ''), legacy = String(track?.id ?? '');
    return validId(urn) ? urn : validId(legacy) ? legacy : '';
  }
  function isRecent(kind,id) {
    const aliases=new Set([String(id)]);
    if(kind==='remote'){const track=remoteTrack(id);if(track){aliases.add(String(track.id));if(track.urn)aliases.add(String(track.urn));}}
    return list(data().recent).some(ref=>ref.kind===kind&&aliases.has(String(ref.id)));
  }
  function release(id) { return releases().find(item => String(item.id) === String(id)); }
  function titleOf(item, fallback = 'Untitled') { return String(item?.title || fallback); }
  function trackWarnings(track) {
    const missing = missingMetadata(track);
    return missing.length ? `<span class="tu-warning-count" title="Missing: ${esc(missing.join(', '))}">${missing.length} metadata item${missing.length === 1 ? '' : 's'} missing</span>` : '<span class="tu-ready">Metadata looks complete</span>';
  }

  function recentMatches(ref) {
    if (!ref || !ref.kind || !ref.id) return null;
    if (ref.kind === 'local') return localTrack(ref.id) || null;
    if (ref.kind === 'remote') return remoteTrack(ref.id) || null;
    if (ref.kind === 'release') return release(ref.id) || null;
    return null;
  }

  function itemCard(kind, item) {
    const id = kind === 'remote' ? remoteTrackId(item) || String(item.id) : String(item.id);
    const favorite = isFavorite(kind, id);
    const label = titleOf(item, kind === 'release' ? 'Untitled release' : 'Untitled track');
    const searchText = `${label} ${item.genre || ''} ${item.artist || ''} ${item.sharing || ''} ${item.notes || ''}`.toLowerCase();
    if (search && !searchText.includes(search)) return '';
    if (view === 'pinned' && !favorite) return '';
    if (view === 'recent' && !isRecent(kind,id)) return '';
    const checkbox = kind === 'local' ? `<label class="tu-select"><input type="checkbox" data-tu-select="${esc(id)}" ${selected.has(id) ? 'checked' : ''}><span>Review upload</span></label>` : '';
    const secondary = kind === 'local'
      ? `${esc(item.format || 'Audio')} · ${item.size ? `${(Number(item.size) / 1048576).toFixed(1)} MB` : 'size unavailable'} · ${esc(item.status || 'Draft')}`
      : kind === 'remote'
        ? `${esc(item.sharing || 'Visibility unavailable')} · ${prettyNumber(item.playback_count)} plays · ${prettyNumber(item.likes_count ?? item.favoritings_count)} likes`
        : `${esc(item.type || 'Release plan')} · ${context.date(item.date)}`;
    const warning = kind === 'local' ? trackWarnings(item) : '';
    return `<article class="tu-item-card" data-tu-item="${esc(kind)}:${esc(id)}"><div class="tu-item-copy"><span class="tu-kicker">${kind === 'local' ? 'LOCAL TRACK' : kind === 'remote' ? 'SOUNDCLOUD TRACK' : 'RELEASE PLAN'}</span><h3>${esc(label)}</h3><p>${secondary}</p>${warning}</div><div class="tu-item-actions">${checkbox}${button('detail', 'Details', keyOf(kind, id))}${kind === 'local' ? button('play-local', 'Play local', id) : ''}${button('favorite', favorite ? 'Unpin' : 'Pin', keyOf(kind, id), favorite ? 'is-pinned' : '')}</div></article>`;
  }

  function collections() {
    const state = context.getState();
    return [
      ...localTracks().map(item => ({ kind: 'local', item })),
      ...remoteTracks().map(item => ({ kind: 'remote', item })),
      ...releases().map(item => ({ kind: 'release', item }))
    ];
  }

  function filteredCards() {
    const items = collections();
    if (view === 'recent') {
      const ordered = list(data().recent).map(ref => ({ kind: ref.kind, item: recentMatches(ref) })).filter(row => row.item);
      const seen = new Set();
      return ordered.filter(row => { const key = keyOf(row.kind, row.item.id); if (seen.has(key)) return false; seen.add(key); return true; }).map(row => itemCard(row.kind, row.item)).filter(Boolean);
    }
    return items.map(({ kind, item }) => itemCard(kind, item)).filter(Boolean);
  }

  function favoritesPanel() {
    const items = favoriteRefs().map(ref => ({ ref, item: recentMatches(ref) })).filter(row => row.item);
    return `<section class="tu-panel"><div class="tu-panel-head"><div><h2>Pinned tracks and releases</h2><p>Keep the items you return to most within reach.</p></div><span class="tu-count">${items.length}</span></div>${items.length ? `<div class="tu-list">${items.slice(0, 8).map(({ ref, item }) => itemCard(ref.kind, item)).join('')}</div>` : '<p class="tu-empty">Pin a local track, synced SoundCloud track, or release plan to build this list.</p>'}</section>`;
  }

  function recentPanel() {
    const items = list(data().recent).map(ref => ({ ref, item: recentMatches(ref) })).filter(row => row.item).slice(0, 6);
    return `<section class="tu-panel"><div class="tu-panel-head"><div><h2>Recently opened</h2><p>Your last few track and release details, saved in this workspace.</p></div></div>${items.length ? `<div class="tu-recent-list">${items.map(({ ref, item }) => `<button type="button" data-tu-action="detail" data-id="${esc(keyOf(ref.kind, ref.id))}"><span>${esc(ref.kind === 'release' ? 'Release' : 'Track')}</span><strong>${esc(titleOf(item))}</strong><small>${esc(ref.at ? new Date(ref.at).toLocaleString() : '')}</small></button>`).join('')}</div>` : '<p class="tu-empty">Open a track or release detail to see it here.</p>'}</section>`;
  }

  function reviewPanel() {
    if (!showReview) return '';
    const rows = reviewIds.map(id => localTrack(id)).filter(Boolean);
    return `<section class="tu-panel tu-review" aria-labelledby="tu-review-title"><div class="tu-panel-head"><div><span class="tu-kicker">UPLOAD PREFLIGHT</span><h2 id="tu-review-title">Visibility and metadata review</h2><p>Each track defaults to Private. Review missing details before the app sends any audio.</p></div>${button('close-review', 'Close review')}</div>${rows.length ? `<div class="tu-review-table-wrap"><table class="tu-review-table"><thead><tr><th>TRACK</th><th>METADATA CHECK</th><th>VISIBILITY</th></tr></thead><tbody>${rows.map(track => `<tr><td><strong>${esc(titleOf(track))}</strong><small>${esc(track.format || 'Audio')} · ${esc(track.status || 'Draft')}</small></td><td>${trackWarnings(track)}${missingMetadata(track).length ? `<small>Missing: ${esc(missingMetadata(track).join(', '))}</small>` : ''}</td><td><label class="tu-vis-field">Choose visibility<select data-tu-sharing="${esc(track.id)}"><option value="private">Private — only you and people with the link</option><option value="public">Public — visible to everyone</option></select></label></td></tr>`).join('')}</tbody></table></div><label class="tu-review-confirm"><input type="checkbox" data-tu-public-confirm> I understand that any track set to Public may be visible to everyone after SoundCloud processes it.</label><div class="tu-review-actions"><span>${rows.length} selected track${rows.length === 1 ? '' : 's'} · no upload begins until you continue</span>${button('upload-reviewed', uploading ? 'Uploading…' : `Upload ${rows.length} reviewed track${rows.length === 1 ? '' : 's'}`, '', 'tu-primary', uploading ? 'disabled' : '')}</div><p class="tu-note">A failed upload stops the remaining batch. Completed uploads are kept in your library and are not sent a second time automatically.</p>` : '<p class="tu-empty">Those tracks are no longer in your library. Select them again to review.</p>'}</section>`;
  }

  function shortcutPanel() {
    if (!shortcutsOpen) return '';
    return `<section class="tu-shortcuts" role="dialog" aria-modal="false" aria-labelledby="tu-shortcuts-title"><div class="tu-panel-head"><div><span class="tu-kicker">KEYBOARD REFERENCE</span><h2 id="tu-shortcuts-title">Keyboard shortcuts</h2></div>${button('close-shortcuts', 'Close')}</div><dl><div><dt>Ctrl + I</dt><dd>Import audio</dd></div><div><dt>Ctrl + N</dt><dd>Create a release plan</dd></div><div><dt>Space</dt><dd>Play or pause local audio when focus is outside a text field</dd></div><div><dt>?</dt><dd>Open or close this reference</dd></div><div><dt>Esc</dt><dd>Close track details or this reference</dd></div></dl><p class="tu-note">Use Tab and Shift+Tab to move through controls.</p></section>`;
  }

  function detailPanel() {
    if (!detail) return '';
    const item = detail.kind === 'local' ? localTrack(detail.id) : detail.kind === 'remote' ? remoteTrack(detail.id) : release(detail.id);
    if (!item) return '';
    const title = titleOf(item, detail.kind === 'release' ? 'Untitled release' : 'Untitled track');
    if (detail.kind === 'release') {
      const track = localTrack(item.trackId);
      const checklist = list(item.checks);
      return `<div class="tu-drawer-backdrop" data-tu-action="close-detail"><aside class="tu-drawer" role="dialog" aria-modal="true" aria-labelledby="tu-detail-title" data-tu-drawer><div class="tu-drawer-head"><div><span class="tu-kicker">RELEASE PLAN DETAILS</span><h2 id="tu-detail-title">${esc(title)}</h2></div>${button('close-detail', 'Close')}</div><div class="tu-detail-grid"><div><span>Release type</span><strong>${esc(item.type || 'Single')}</strong></div><div><span>Target date</span><strong>${esc(context.date(item.date))}</strong></div><div><span>Linked track</span><strong>${esc(track?.title || 'No track linked')}</strong></div><div><span>Checklist</span><strong>${checklist.filter(check => check.done).length} of ${checklist.length} complete</strong></div></div><section class="tu-detail-block"><h3>Release notes</h3><p>${esc(item.notes || 'No release notes saved.')}</p></section><section class="tu-detail-block"><h3>Checklist</h3>${checklist.length ? `<ul>${checklist.map(check => `<li>${check.done ? '✓' : '○'} ${esc(check.label)}</li>`).join('')}</ul>` : '<p>No checklist items saved.</p>'}</section><div class="tu-drawer-actions">${button('favorite', isFavorite('release', item.id) ? 'Unpin release' : 'Pin release', keyOf('release', item.id))}${track ? button('detail', 'View linked track', keyOf('local', track.id)) : ''}</div></aside></div>`;
    }
    const local = detail.kind === 'local';
    const url = safeTrackUrl(item);
    const id = detail.kind === 'remote' ? remoteTrackId(item) || String(item.id) : String(item.id);
    const streamAvailable = detail.kind === 'remote' && validId(id) && (item.streamable === true || !!item.stream_url);
    const missing = local ? missingMetadata(item) : [];
    const preview = streamAvailable
      ? `<div class="tu-detail-block"><h3>SoundCloud preview</h3><audio class="tu-remote-audio" controls preload="none" src="studio://preview/${encodeURIComponent(id)}" data-tu-remote-audio="${esc(id)}">Your browser does not support audio playback.</audio><p class="tu-note">This preview uses a stream marked available by SoundCloud. Playback depends on the account and track permissions.</p></div>`
      : detail.kind === 'remote' ? `<div class="tu-detail-block tu-unavailable"><h3>Inline preview unavailable</h3><p>${validId(id) ? 'SoundCloud did not report a playable stream for this track in the current catalog snapshot.' : 'A valid SoundCloud track identifier is not available for a preview.'}</p></div>` : '';
    const localPlayer = local ? `<div class="tu-detail-block"><h3>Local playback and waveform</h3><audio class="tu-local-audio" controls preload="metadata" src="studio://audio/${encodeURIComponent(id)}" data-tu-local-audio="${esc(id)}">Your browser does not support local audio playback.</audio><div class="tu-wave-wrap"><canvas class="tu-waveform" width="640" height="72" data-tu-waveform="${esc(id)}" role="img" aria-label="Waveform generated from this local audio file"></canvas></div><div class="tu-wave-actions">${button('waveform', waveCache.has(id) ? 'Regenerate waveform' : 'Generate waveform', id)}<span data-tu-wave-status="${esc(id)}">${waveCache.has(id) ? 'Waveform uses decoded samples from this file.' : 'Generate a waveform from the local audio samples; unsupported codecs and larger files use the standard audio controls only.'}</span></div></div>` : '';
    return `<div class="tu-drawer-backdrop" data-tu-action="close-detail"><aside class="tu-drawer" role="dialog" aria-modal="true" aria-labelledby="tu-detail-title" data-tu-drawer><div class="tu-drawer-head"><div><span class="tu-kicker">${local ? 'LOCAL TRACK DETAILS' : 'SOUNDCLOUD TRACK DETAILS'}</span><h2 id="tu-detail-title">${esc(title)}</h2></div>${button('close-detail', 'Close')}</div><div class="tu-detail-grid"><div><span>Artist</span><strong>${esc(local ? (profileName() || 'Not set') : (item.user?.username || item.artist || 'Not provided'))}</strong></div><div><span>${local ? 'File format' : 'Visibility'}</span><strong>${esc(local ? item.format || 'Unknown' : item.sharing || 'Not reported')}</strong></div><div><span>${local ? 'File size' : 'Plays'}</span><strong>${local && item.size ? `${(Number(item.size) / 1048576).toFixed(1)} MB` : local ? 'Unavailable' : prettyNumber(item.playback_count)}</strong></div><div><span>${local ? 'Status' : 'Likes'}</span><strong>${esc(local ? item.status || 'Draft' : prettyNumber(item.likes_count ?? item.favoritings_count))}</strong></div></div>${local ? `<section class="tu-detail-block"><h3>Metadata review</h3>${missing.length ? `<p class="tu-warning-detail">Missing: ${esc(missing.join(', '))}. Add useful details before your next upload.</p>` : '<p class="tu-ready">Title, artist, genre, and credits or description are present.</p>'}<p>${esc(item.notes || item.credits || 'No notes or credits saved.')}</p></section>${localPlayer}` : preview}<section class="tu-detail-block"><h3>SoundCloud link</h3>${url ? `<p class="tu-link-value">${esc(url)}</p>` : '<p class="tu-note">No SoundCloud permalink is available in this snapshot. Sync the catalog or upload the local track to retrieve one.</p>'}</section><div class="tu-drawer-actions">${button('favorite', isFavorite(detail.kind, id) ? 'Unpin' : 'Pin', keyOf(detail.kind, id))}${button('copy-url', 'Copy SoundCloud URL', keyOf(detail.kind, id), '', url ? '' : 'disabled')}${button('share-card', 'Copy share card', keyOf(detail.kind, id), '', url ? '' : 'disabled')}${button('open-track', 'Open in SoundCloud', keyOf(detail.kind, id), '', url && typeof window.studio?.openTrack === 'function' ? '' : 'disabled')}${local ? button('edit-local', 'Edit local metadata', id) + button('reveal', 'Show file in Explorer', id) : ''}</div>${url && typeof window.studio?.openTrack !== 'function' ? '<p class="tu-note">Direct SoundCloud launch is disabled until the secure URL opener is available in this build.</p>' : ''}</aside></div>`;
  }

  function render(ctx) {
    context = ctx;
    data();
    const localCount = localTracks().length;
    const remoteCount = remoteTracks().length;
    const releaseCount = releases().length;
    const cards = filteredCards();
    const hasSelection = selected.size > 0;
    return `<div class="tu-page"><header class="tu-head"><div><span class="tu-kicker">TRACKS AND RELEASES</span><h1>Track toolkit</h1><p>Review upload visibility, spot missing metadata, and return to pinned or recently opened items.</p></div><div class="tu-head-actions"><button type="button" class="tu-button" data-tu-action="shortcuts">? Shortcuts</button><button type="button" class="tu-button tu-primary" data-page="upload">＋ Upload music</button></div></header>
      <div class="tu-summary"><span>${localCount.toLocaleString()} local tracks</span><span>${remoteCount.toLocaleString()} synced SoundCloud tracks</span><span>${releaseCount.toLocaleString()} release plans</span><button type="button" data-tu-action="review-selected" ${hasSelection ? '' : 'disabled'}>Review visibility for ${selected.size} selected</button></div>
      <div class="tu-toolbar"><div class="tu-tabs" role="tablist" aria-label="Track toolkit view">${[['all','Everything'],['pinned','Pinned'],['recent','Recently opened']].map(([id,label]) => `<button type="button" role="tab" aria-selected="${view === id}" class="${view === id ? 'active' : ''}" data-tu-action="view" data-id="${id}">${label}</button>`).join('')}</div><label class="tu-search">Search tracks and releases<input type="search" value="${esc(search)}" data-tu-search placeholder="Name, genre, visibility…"></label></div>
      ${reviewPanel()}${view === 'all' ? `${favoritesPanel()}${recentPanel()}` : ''}<section class="tu-panel"><div class="tu-panel-head"><div><h2>${view === 'pinned' ? 'Pinned items' : view === 'recent' ? 'Recently opened items' : 'Your tracks and releases'}</h2><p>${view === 'all' ? 'Select local tracks to prepare a visibility review before uploading.' : 'Open an item for its details and available actions.'}</p></div><span class="tu-count">${cards.length}</span></div>${cards.length ? `<div class="tu-list">${cards.slice(0, 90).join('')}</div>${cards.length > 90 ? '<p class="tu-note">Showing the first 90 matches. Narrow the search to find a specific item.</p>' : ''}` : `<p class="tu-empty">${view === 'pinned' ? 'Nothing is pinned in this view yet.' : view === 'recent' ? 'Open a track or release detail to build your recent list.' : 'Import audio, sync SoundCloud, or create a release plan to populate this toolkit.'}</p>`}</section>
      <section class="tu-panel tu-shortcut-hint"><div><h2>Keyboard reference</h2><p>See the app’s import, release, playback, and toolkit shortcuts.</p></div>${button('shortcuts', 'Show shortcuts')}</section>${shortcutPanel()}${detailPanel()}</div>`;
  }

  async function persistRecent(kind, id) {
    const at = new Date().toISOString();
    await context.update(state => {
      state.artistTrackUx ||= { favorites: [], recent: [] };
      state.artistTrackUx.recent = [{ kind, id: String(id), at }, ...list(state.artistTrackUx.recent).filter(item => !(item.kind === kind && String(item.id) === String(id)))].slice(0, maxRecent);
    });
  }

  async function toggleFavorite(kind, id) {
    await context.update(state => {
      state.artistTrackUx ||= { favorites: [], recent: [] };
      const refs = list(state.artistTrackUx.favorites);
      const index = refs.findIndex(item => item.kind === kind && String(item.id) === String(id));
      if (index >= 0) refs.splice(index, 1);
      else refs.unshift({ kind, id: String(id) });
      state.artistTrackUx.favorites = refs.slice(0, 100);
    });
    context.notice(isFavorite(kind, id) ? 'Pinned to your track toolkit.' : 'Removed from pinned items.');
  }

  async function openDetails(ref) {
    const [kind, ...idParts] = String(ref).split(':');
    const id = idParts.join(':');
    if (!['local', 'remote', 'release'].includes(kind) || !recentMatches({ kind, id })) return context.notice('That track or release is no longer available.');
    detail = { kind, id };
    await persistRecent(kind, id);
  }

  function drawWaveform(canvas, peaks) {
    if (!canvas || !peaks?.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width, height = canvas.height, mid = Math.floor(height / 2);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = getComputedStyle(document.body).color || '#eee';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath();
    peaks.forEach((peak, index) => {
      const x = index / Math.max(1, peaks.length - 1) * width;
      const amplitude = Math.max(1, peak * (height * 0.45));
      ctx.moveTo(x, mid - amplitude);
      ctx.lineTo(x, mid + amplitude);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function onRender(ctx) {
    context = ctx;
    styles();
    const nav = document.querySelector('#nav');
    if (nav && !nav.querySelector('[data-tu-nav]')) {
      nav.insertAdjacentHTML('beforeend', `<section class="nav-group" aria-label="Track tools" data-tu-nav><div class="nav-label">TRACK TOOLS</div><button data-page="${pageId}" class="${ctx.getPage() === pageId ? 'active' : ''}" ${ctx.getPage() === pageId ? 'aria-current="page"' : ''}><span class="icon" aria-hidden="true">♫</span>Track toolkit</button></section>`);
    } else if (nav) {
      const item = nav.querySelector(`[data-tu-nav] button[data-page="${pageId}"]`);
      item?.classList.toggle('active', ctx.getPage() === pageId);
      if (ctx.getPage() === pageId) item?.setAttribute('aria-current', 'page');
      else item?.removeAttribute('aria-current');
    }
    if (ctx.getPage() === pageId) {
      document.querySelectorAll('[data-tu-waveform]').forEach(canvas => drawWaveform(canvas, waveCache.get(canvas.dataset.tuWaveform)?.peaks));
      const searchField = document.querySelector('[data-tu-search]');
      if (searchField && document.activeElement !== searchField) searchField.value = search;
    }
  }

  async function generateWaveform(id) {
    const track = localTrack(id);
    if (!track) return context.notice('That local audio is no longer in the library.');
    if (!Number.isFinite(Number(track.size)) || Number(track.size) > 8 * 1024 * 1024) {
      const status = document.querySelector(`[data-tu-wave-status="${CSS.escape(String(id))}"]`);
      if (status) status.textContent = 'Waveform generation is limited to local files up to 8 MB. Use the standard audio controls for this file.';
      return;
    }
    if (typeof AudioContext !== 'function' || typeof fetch !== 'function') {
      const status = document.querySelector(`[data-tu-wave-status="${CSS.escape(String(id))}"]`);
      if (status) status.textContent = 'This audio codec cannot be decoded for a waveform here. The standard player remains available.';
      return;
    }
    const status = document.querySelector(`[data-tu-wave-status="${CSS.escape(String(id))}"]`);
    if (status) status.textContent = 'Reading local audio samples…';
    let audioContext;
    try {
      const response = await fetch(`studio://audio/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('The original audio file is unavailable.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('This file exceeds the 8 MB waveform limit.');
      audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(bytes);
      if (!Number.isFinite(decoded.duration) || decoded.duration > 360) throw new Error('Waveform generation is limited to tracks up to six minutes. Use the standard player for this file.');
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel));
      const points = 240;
      const peaks = Array.from({ length: points }, (_, point) => {
        const start = Math.floor(point / points * decoded.length);
        const end = Math.max(start + 1, Math.floor((point + 1) / points * decoded.length));
        let peak = 0;
        for (const samples of channels) for (let index = start; index < end; index++) peak = Math.max(peak, Math.abs(samples[index] || 0));
        return peak;
      });
      waveCache.set(String(id), { peaks, duration: decoded.duration });
      context.render();
      const updated = document.querySelector(`[data-tu-wave-status="${CSS.escape(String(id))}"]`);
      if (updated) updated.textContent = 'Waveform generated from decoded samples in this local audio file. Click the waveform to seek.';
    } catch (error) {
      const updated = document.querySelector(`[data-tu-wave-status="${CSS.escape(String(id))}"]`);
      if (updated) updated.textContent = `${error.message || 'Waveform unavailable.'} The standard player remains available.`;
    } finally {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    }
  }

  async function uploadReviewed() {
    if (uploading) return;
    const connection = context.getConnection();
    if (!connection?.connected) return context.notice('Connect SoundCloud before uploading reviewed tracks.');
    const rows = reviewIds.map(id => ({ track: localTrack(id), sharing: document.querySelector(`[data-tu-sharing="${CSS.escape(String(id))}"]`)?.value || 'private' })).filter(row => row.track);
    if (!rows.length) return context.notice('Select at least one track to review.');
    if (rows.some(row => !String(row.track.title || '').trim())) return context.notice('Add a title to every selected track before uploading.');
    const publicCount = rows.filter(row => row.sharing === 'public').length;
    if (publicCount && !document.querySelector('[data-tu-public-confirm]')?.checked) return context.notice('Confirm that you understand the public tracks may be visible to everyone.');
    const summary = rows.map(row => `${row.track.title} — ${row.sharing.toUpperCase()}`).join('\n');
    if (!confirm(`Upload these ${rows.length} reviewed track${rows.length === 1 ? '' : 's'} to SoundCloud?\n\n${summary}\n\nEach track will upload separately. A failed upload stops the remaining tracks.`)) return;
    uploading = true;
    let recoveredReceipt = false;
    context.render();
    try {
      for (const { track, sharing } of rows) {
        context.notice(`Uploading ${track.title} as ${sharing}…`);
        const result = await window.studio.upload(track.id, {
          title: String(track.title).trim(),
          artist: profileName(),
          genre: String(track.genre || ''),
          description: [track.credits, track.notes].filter(Boolean).join('\n\n'),
          sharing
        });
        try {
          await context.update(state => {
            if (result?.state) Object.assign(state, result.state);
            const local = list(state.tracks).find(item => item.id === track.id);
            if (local && result?.track) local.lastUpload = { id: result.track.id, sharing: result.track.sharing, state: result.track.state, at: new Date().toISOString(), url: result.track.url || '' };
          });
        } catch (error) { error.uploadAccepted = true; error.acceptedTrackTitle = track.title; throw error; }
        if (result?.jobId && !result?.journalWarning) {
          try { await window.studio.acknowledgeUpload(result.jobId); }
          catch (error) { error.uploadAccepted = true; error.acceptedTrackTitle = track.title; throw error; }
        }
        if (result?.localSaveError || result?.journalWarning) recoveredReceipt = true;
      }
      selected.clear();
      reviewIds = [];
      showReview = false;
      context.notice(recoveredReceipt ? `SoundCloud accepted the reviewed uploads. Review any unacknowledged receipts in Upload desk before starting another attempt.` : `Finished uploading ${rows.length} reviewed track${rows.length === 1 ? '' : 's'}.`);
    } catch (error) {
      context.notice(error.uploadAccepted
        ? `SoundCloud accepted “${error.acceptedTrackTitle || 'this track'}”, but its local receipt could not be finalized. Open Upload desk and review the receipt before retrying. ${String(error.message || error).slice(0, 180)}`
        : `Batch stopped. Tracks already accepted by SoundCloud remain saved; review the failed track before retrying. ${String(error.message || error).slice(0, 220)}`);
    } finally {
      uploading = false;
      context.render();
    }
  }

  async function handle(action, id) {
    if (action === 'view') { view = ['all', 'pinned', 'recent'].includes(id) ? id : 'all'; return context.render(); }
    if (action === 'search') { search = id; return context.render(); }
    if (action === 'detail') return openDetails(id);
    if (action === 'close-detail') { detail = null; return context.render(); }
    if (action === 'favorite') { const [kind, ...parts] = id.split(':'); return toggleFavorite(kind, parts.join(':')); }
    if (action === 'review-selected') { reviewIds = [...selected]; showReview = true; context.render(); document.querySelector('.tu-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (action === 'close-review') { showReview = false; return context.render(); }
    if (action === 'upload-reviewed') return uploadReviewed();
    if (action === 'shortcuts') { shortcutsOpen = !shortcutsOpen; return context.render(); }
    if (action === 'close-shortcuts') { shortcutsOpen = false; return context.render(); }
    if (action === 'waveform') return generateWaveform(id);
    if (action === 'play-local') {
      detail = { kind: 'local', id: String(id) };
      await persistRecent('local', id);
      setTimeout(() => document.querySelector(`[data-tu-local-audio="${CSS.escape(String(id))}"]`)?.play().catch(() => {}), 0);
      return;
    }
    if (action === 'copy-url' || action === 'share-card' || action === 'open-track') {
      const [kind, ...parts] = id.split(':');
      const itemId = parts.join(':');
      const item = kind === 'local' ? localTrack(itemId) : remoteTrack(itemId);
      const url = safeTrackUrl(item);
      if (!url) return context.notice('There is no valid SoundCloud permalink in the current data. Sync the catalog or upload the track first.');
      if (action === 'copy-url') { await window.studio.copy(url); return context.notice('SoundCloud URL copied.'); }
      if (action === 'share-card') { await window.studio.copy(`${titleOf(item)}\n${profileName() || item.user?.username || item.artist || 'SoundCloud track'}\nListen on SoundCloud: ${url}`); return context.notice('Track share card copied.'); }
      if (typeof window.studio?.openTrack !== 'function') return context.notice('Direct SoundCloud launch is unavailable in this build.');
      await window.studio.openTrack(url);
      return;
    }
    if (action === 'edit-local') {
      document.querySelector(`#view button[data-action="edit-track"][data-id="${CSS.escape(String(id))}"]`)?.click();
      return;
    }
    if (action === 'reveal') return window.studio.reveal(id);
  }

  function init(ctx) {
    context = ctx;
    document.addEventListener('click', event => {
      const canvas = event.target.closest('[data-tu-waveform]');
      if (canvas) {
        const wave = waveCache.get(canvas.dataset.tuWaveform);
        const audio = document.querySelector(`[data-tu-local-audio="${CSS.escape(canvas.dataset.tuWaveform)}"]`);
        if (wave && audio && Number.isFinite(audio.duration)) {
          const bounds = canvas.getBoundingClientRect();
          const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
          audio.currentTime = fraction * audio.duration;
        }
        return;
      }
      const actionButton = event.target.closest('[data-tu-action]');
      if (!actionButton) return;
      event.preventDefault();
      event.stopPropagation();
      const action = actionButton.dataset.tuAction;
      if (action === 'close-detail' && event.target.closest('[data-tu-drawer]') && !event.target.closest('button[data-tu-action="close-detail"]')) return;
      if (action === 'close-detail' && event.target.closest('[data-tu-drawer]') && event.target.closest('button[data-tu-action="close-detail"]')) { detail = null; context.render(); return; }
      actionButton.disabled = true;
      Promise.resolve(handle(action, actionButton.dataset.id || '')).catch(error => context.notice(error.message || 'Could not complete that track action.')).finally(() => { if (actionButton.isConnected) actionButton.disabled = false; });
    }, true);
    document.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-tu-select]');
      if (checkbox) {
        checkbox.checked ? selected.add(checkbox.dataset.tuSelect) : selected.delete(checkbox.dataset.tuSelect);
        const toolbar = document.querySelector('.tu-summary button[data-tu-action="review-selected"]');
        if (toolbar) { toolbar.disabled = !selected.size; toolbar.textContent = `Review visibility for ${selected.size} selected`; }
      }
    }, true);
    document.addEventListener('input', event => {
      if (!event.target.matches('[data-tu-search]')) return;
      search = event.target.value.trim().toLowerCase();
      const position = event.target.selectionStart;
      context.render();
      const field = document.querySelector('[data-tu-search]');
      field?.focus();
      field?.setSelectionRange(position, position);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && (detail || shortcutsOpen)) {
        if (detail) detail = null;
        else shortcutsOpen = false;
        context.render();
        return;
      }
      const target = event.target;
      const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if (!typing && event.key === '?' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        shortcutsOpen = !shortcutsOpen;
        if (context.getPage() !== pageId) context.openPage(pageId);
        else context.render();
      }
    }, true);
    document.addEventListener('error', event => {
      if (event.target.matches?.('[data-tu-remote-audio]')) {
        const note = event.target.closest('.tu-detail-block')?.querySelector('.tu-note');
        if (note) note.textContent = 'SoundCloud did not provide a playable stream to this preview. Open the track on SoundCloud if a permalink is available.';
      }
    }, true);
  }

  window.registerArtistPlugin({
    id: pluginId,
    pages: [{ id: pageId, title: 'Track toolkit', icon: '♫', render }],
    actions: {},
    init,
    onRender
  });
})();
