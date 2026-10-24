(() => {
  const pluginId = 'soundcloud-current-catalog';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const numeric = value => {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : 0;
  };
  const formatNumber = value => numeric(value).toLocaleString();
  const previewId = track => {
    const safe = value => /^(?:\d{1,128}|soundcloud:tracks:\d{1,128})$/.test(String(value ?? ''));
    return safe(track?.urn) ? String(track.urn) : safe(track?.id) ? String(track.id) : '';
  };

  const addStyles = () => {
    if (document.querySelector('link[data-soundcloud-catalog-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'features/soundcloud-catalog.css';
    link.dataset.soundcloudCatalogStyle = 'true';
    document.head.appendChild(link);
  };

  const render = ctx => {
    const connection = ctx.getConnection() || {};
    const snapshot = connection.snapshot;
    const tracks = Array.isArray(snapshot?.tracks) ? snapshot.tracks : [];
    const connected = !!connection.connected;
    const profile = snapshot?.profile || {};
    const lastSynced = snapshot?.syncedAt
      ? new Date(snapshot.syncedAt).toLocaleString()
      : '';
    const message = connected
      ? (lastSynced ? `Latest catalog sync: ${esc(lastSynced)}` : 'Sync to load your catalog.')
      : 'Connect your artist account to see the tracks currently on SoundCloud.';
    const actions = connected
      ? `<button data-action="sync">Sync catalog</button><button data-page="soundcloud">View full catalog</button>`
      : `<button class="primary" data-page="soundcloud">Connect SoundCloud</button>`;
    const likesFor = track => numeric(track.likes_count || track.favoritings_count);
    const totalPlays = tracks.reduce((total, track) => total + numeric(track.playback_count), 0);
    const totalLikes = tracks.reduce((total, track) => total + likesFor(track), 0);
    const publicTracks = tracks.filter(track => track.sharing === 'public').length;
    const privateTracks = tracks.filter(track => track.sharing === 'private').length;
    const otherVisibility = Math.max(0, tracks.length - publicTracks - privateTracks);
    const topTracks = tracks.slice().sort((a, b) => numeric(b.playback_count) - numeric(a.playback_count)).slice(0, 3);
    const topPlayCount = Math.max(1, ...topTracks.map(track => numeric(track.playback_count)));
    const accountPulse = snapshot ? `<section class="sc-catalog-pulse" aria-labelledby="sc-pulse-title"><header class="sc-pulse-heading"><div><span class="eyebrow">SOUNDCLOUD SNAPSHOT</span><h2 id="sc-pulse-title">${esc(profile.username || 'Your artist account')}</h2><p>${lastSynced ? `Synced ${esc(lastSynced)} · totals reflect the tracks returned by that sync.` : 'Catalog metrics from the latest saved sync.'}</p></div></header><div class="sc-pulse-stats"><article class="sc-pulse-stat"><span>Followers</span><strong>${formatNumber(profile.followers_count)}</strong></article><article class="sc-pulse-stat"><span>Tracks on SoundCloud</span><strong>${formatNumber(profile.track_count ?? tracks.length)}</strong></article><article class="sc-pulse-stat"><span>Catalog plays</span><strong>${formatNumber(totalPlays)}</strong></article><article class="sc-pulse-stat"><span>Catalog likes</span><strong>${formatNumber(totalLikes)}</strong></article></div><div class="sc-pulse-grid"><section class="panel sc-pulse-panel"><h3>Most played in this catalog</h3>${topTracks.length ? topTracks.map(track => { const plays = numeric(track.playback_count); const width = Math.round(plays / topPlayCount * 100); return `<div class="sc-top-track"><div class="sc-top-track-label"><strong>${esc(track.title || 'Untitled track')}</strong><span>${formatNumber(plays)} plays · ${formatNumber(likesFor(track))} likes</span></div><div class="sc-play-bar" aria-label="${width}% of top track plays"><i style="width:${width}%"></i></div></div>`; }).join('') : '<p class="sc-pulse-empty">Sync a catalog with tracks to see top performers.</p>'}</section><section class="panel sc-pulse-panel"><h3>Catalog visibility</h3><p class="sc-visibility-intro">Visibility counts are based on the synced tracks below.</p><div class="sc-visibility-counts"><div><strong>${publicTracks.toLocaleString()}</strong><span>Public</span></div><div><strong>${privateTracks.toLocaleString()}</strong><span>Private</span></div>${otherVisibility ? `<div><strong>${otherVisibility.toLocaleString()}</strong><span>Other</span></div>` : ''}</div></section></div></section>` : '';

    let content;
    if (tracks.length) {
      content = `<div class="sc-current-table-wrap"><table><thead><tr><th>TRACK</th><th>VISIBILITY</th><th>PLAYS</th><th>LIKES</th><th>LISTEN</th></tr></thead><tbody>${tracks.slice(0, 5).map(track => { const id = previewId(track); const playable = connected && track.streamable === true && !!id; return `<tr><td><strong>${esc(track.title || 'Untitled track')}</strong></td><td>${esc(track.sharing || 'Unknown')}</td><td>${formatNumber(track.playback_count)}</td><td>${formatNumber(likesFor(track))}</td><td>${playable ? `<button type="button" class="sc-preview-button" data-action="play-soundcloud-track" data-id="${esc(id)}" aria-label="Play preview of ${esc(track.title || 'untitled track')}">Play</button>` : `<span class="sc-preview-unavailable" title="SoundCloud did not mark this track previewable in the current synced catalog">Preview unavailable</span>`}</td></tr>`; }).join('')}</tbody></table></div>`;
    } else if (connected) {
      content = '<p class="sc-current-empty">No tracks were found in the synced catalog.</p>';
    } else {
      content = '<p class="sc-current-empty">Your SoundCloud tracks will appear here after you connect and sync.</p>';
    }

    return `${accountPulse}<section class="sc-current-catalog" data-soundcloud-current><div class="section-head"><div><h2>Current tracks on SoundCloud</h2><p>${message}${tracks.length ? ` · ${tracks.length.toLocaleString()} synced tracks` : ''}</p></div><div class="sc-current-actions">${actions}</div></div><div class="panel">${content}${tracks.length > 5 ? `<button class="link sc-current-all" data-page="soundcloud">View all ${tracks.length.toLocaleString()} tracks →</button>` : ''}</div></section>`;
  };

  window.registerArtistPlugin({
    id: pluginId,
    onRender(ctx) {
      if (ctx.getPage() !== 'overview') return;
      const view = document.querySelector('#view');
      const stats = view?.querySelector('.stats');
      if (!stats || view.querySelector('[data-soundcloud-current]')) return;
      addStyles();
      stats.insertAdjacentHTML('afterend', render(ctx));
    }
  });
})();
