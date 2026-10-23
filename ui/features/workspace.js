(() => {
  const pluginId = 'artist-workspace';
  const key = 'artistWorkspace';
  const cardCatalog = [
    ['releases', 'Release plans'], ['actions', 'Next actions'],
    ['campaigns', 'Campaigns'], ['connection', 'SoundCloud connection']
  ];
  const templates = [
    { id: 'release-announcement', title: 'Release announcement', channel: 'Instagram', caption: 'New music is on the way: [release title].\n\nListen on [release link] on [release date].' },
    { id: 'short-preview', title: 'Short preview', channel: 'TikTok', caption: 'A little preview of [release title]. Out [release date].\n\nPre-save / listen: [release link]' },
    { id: 'playlist-pitch', title: 'Playlist pitch', channel: 'Playlist pitch', caption: 'Hello [contact],\n\nI would love to share [release title] with you. It is a [genre/mood] release, out [release date].\n\nPrivate link: [release link]\n\nThank you for listening.' },
    { id: 'thank-you', title: 'Release day thank-you', channel: 'General', caption: '[release title] is out now. Thank you for listening and sharing.\n\n[release link]' }
  ];
  const helpItems = [
    { title: 'Plan a release', category: 'Releases', body: 'Open Releases to set a target date, choose artwork, link a local track, and work through the checklist. The readiness score is a planning aid based on those saved details.', page: 'releases' },
    { title: 'Choose release artwork', category: 'Releases', body: 'Open the release card and choose artwork. Artwork is saved locally on this PC and referenced by the release plan.', page: 'releases' },
    { title: 'Link a track to a release', category: 'Releases', body: 'Edit a release and select a track from your local library. You can change the link later if the master changes.', page: 'releases' },
    { title: 'Prepare a campaign', category: 'Promotion', body: 'Use a campaign template below to create a draft, then edit it in Promotion. The template is copied into your local workspace.', page: 'promotion' },
    { title: 'Organize campaign links', category: 'Promotion', body: 'Save a label, URL, related release, channel, and notes. The app does not collect click analytics for these links.', page: 'promotion' },
    { title: 'Track follow-ups', category: 'Contacts', body: 'Keep promoter or outlet notes and a follow-up date in the local contact list. Dates are reminders for your own workflow; no message is sent.', page: 'artist-promotion-tools' },
    { title: 'Connect or reconnect SoundCloud', category: 'SoundCloud', body: 'Open the SoundCloud page to connect or sync using the credentials configured on this PC. This workspace shows the saved connection snapshot and last sync time.', page: 'soundcloud' },
    { title: 'Understand synced metrics', category: 'SoundCloud', body: 'Follower and track totals reflect the latest catalog snapshot available locally. Time-based analytics remain in SoundCloud Artist Insights.', page: 'soundcloud' },
    { title: 'Use keyboard navigation', category: 'Accessibility', body: 'Use Tab and Shift+Tab to move through controls, Enter or Space to activate buttons, and / on this page to focus help search. Focus outlines are visible.', page: 'artist-help' },
    { title: 'Back up your workspace', category: 'Workspace', body: 'Use Settings → Export workspace backup to save metadata. Audio and artwork files remain in their original or local artwork folders.', page: 'settings' }
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const clone = value => structuredClone(value ?? {});
  const dataOf = state => state[key] && typeof state[key] === 'object' ? state[key] : {};
  const shortDate = (value, ctx) => value ? ctx.date(value) : 'No date set';
  const tag = (text, cls = '') => `<span class="aw-tag ${cls}">${esc(text)}</span>`;
  const button = (action, text, id = '', cls = '') => `<button type="button" class="${cls}" data-action="${pluginId}-${action}" data-id="${esc(id)}">${text}</button>`;
  const panel = (title, body, extra = '') => `<section class="aw-panel ${extra}"><div class="aw-panel-head"><h2>${title}</h2></div>${body}</section>`;
  const pageHead = (title, subtitle, actions = '') => `<header class="aw-head"><div><p class="aw-kicker">SC ARTIST WORKSPACE</p><h1 tabindex="-1" data-aw-heading>${title}</h1><p>${subtitle}</p></div><div class="aw-actions">${actions}</div></header>`;
  const setStylesheet = () => {
    if (document.querySelector('link[data-artist-workspace-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = 'features/workspace.css'; link.dataset.artistWorkspaceStyle = 'true';
    document.head.appendChild(link);
  };
  const snapshot = state => {
    const hadWorkspace = Object.prototype.hasOwnProperty.call(state, key);
    const workspace = hadWorkspace ? clone(state[key]) : null;
    if (workspace) delete workspace.history;
    return { campaigns: clone(state.campaigns || []), hadWorkspace, workspace };
  };
  const commit = async (ctx, label, mutator) => {
    const before = snapshot(ctx.getState());
    await ctx.update(state => {
      const existing = dataOf(state);
      const history = Array.isArray(existing.history) ? existing.history : [];
      state[key] = existing;
      mutator(state, existing);
      const after = dataOf(state);
      after.history = [{ id: ctx.uid(), label, at: new Date().toISOString(), before }, ...history].slice(0, 8);
      state[key] = after;
    });
  };
  const empty = (text, action = '') => `<div class="aw-empty"><p>${esc(text)}</p>${action}</div>`;

  const dashboard = ctx => {
    const state = ctx.getState(), extra = dataOf(state);
    const chosen = Array.isArray(extra.dashboardCards) ? extra.dashboardCards : cardCatalog.map(x => x[0]);
    const releases = [...(state.releases || [])].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const campaigns = state.campaigns || [];
    const due = releases.flatMap(release => (release.checks || []).filter(check => !check.done).map(check => ({ release, check }))).slice(0, 5);
    const releaseCards = releases.length ? releases.map(release => {
      const track = state.tracks.find(item => item.id === release.trackId);
      const checks = release.checks || [];
      const dimensions = [Boolean(release.title?.trim()), Boolean(release.date), Boolean(release.trackId && track), Boolean(release.art), checks.length > 0 && checks.every(item => item.done)];
      const score = Math.round(dimensions.filter(Boolean).length / dimensions.length * 100);
      const next = checks.find(item => !item.done);
      const days = release.date ? Math.ceil((new Date(release.date + 'T12:00:00') - new Date(new Date().toDateString())) / 86400000) : null;
      return `<article class="aw-release"><div class="aw-release-main"><div class="aw-release-title"><strong>${esc(release.title || 'Untitled release')}</strong>${tag(release.type || 'Single')}</div><p>${track ? `Track: ${esc(track.title)}` : 'No library track linked'} · ${release.art ? 'Artwork added' : 'Artwork missing'}</p><p>Target: ${shortDate(release.date, ctx)}${days !== null ? ` · ${days < 0 ? `${Math.abs(days)} days past` : `${days} days away`}` : ''}</p>${next ? `<p class="aw-next">Next: ${esc(next.label)}</p>` : '<p class="aw-next">Checklist complete</p>'}</div><div class="aw-score" role="img" aria-label="Release readiness ${score} percent"><strong>${score}%</strong><span>ready</span></div><div class="aw-release-actions">${button('open-releases', 'Edit release plan', release.id)}${!release.art ? button('pick-artwork', 'Choose artwork', release.id, 'aw-secondary') : ''}${track ? button('open-library', 'View track', track.id, 'aw-secondary') : ''}</div></article>`;
    }).join('') : empty('No release plans yet. Start with a date, track, and artwork.', button('open-releases', 'Plan a release'));
    const panels = {
      releases: panel('Release plans', releaseCards),
      actions: panel('Next actions', due.length ? `<ul class="aw-list">${due.map(({ release, check }) => `<li><span>${esc(check.label)}</span><small>${esc(release.title)} · ${shortDate(release.date, ctx)}</small></li>`).join('')}</ul>` : empty('No incomplete release checklist items.')),
      campaigns: panel('Campaigns', campaigns.length ? `<ul class="aw-list">${campaigns.slice(0, 4).map(c => `<li><span>${esc(c.title)}</span><small>${esc(c.channel || 'General')} · ${shortDate(c.date, ctx)} · ${esc(c.status)}</small></li>`).join('')}</ul>${button('open-promotion', 'Open promotion')}` : empty('No campaign drafts yet.', button('open-promotion', 'Prepare a campaign'))),
      connection: panel('SoundCloud connection', connectionCard(ctx))
    };
    return pageHead('Artist workspace', 'Keep release plans, promotion, and the next useful action in view.', button('open-releases', 'Release plans') + button('open-promotion', 'Promotion', '', 'aw-secondary')) +
      `<div class="aw-dashboard-tools"><label>Dashboard sections <select data-aw-cards aria-label="Choose dashboard sections" multiple size="4">${cardCatalog.map(([id, label]) => `<option value="${id}" ${chosen.includes(id) ? 'selected' : ''}>${label}</option>`).join('')}</select><small>Use Ctrl or Command to select more than one.</small></label><button type="button" data-action="${pluginId}-save-dashboard">Save dashboard</button></div><div class="aw-dashboard-grid">${chosen.map(id => panels[id]).filter(Boolean).join('')}</div>` + historyPanel(extra);
  };
  const connectionCard = ctx => {
    const connection = ctx.getConnection() || {}, snapshot = connection.snapshot || {}, profile = snapshot.profile || {};
    const username = profile.username || profile.permalink || '';
    const lastSync = snapshot.syncedAt ? new Date(snapshot.syncedAt).toLocaleString() : '';
    const status = connection.connected ? 'Connected' : connection.configured ? 'Disconnected' : 'Not configured';
    return `<div class="aw-connection"><span class="aw-connection-dot ${connection.connected ? 'is-connected' : ''}" aria-hidden="true"></span><div><strong>${esc(status)}${username ? ` · ${esc(username)}` : ''}</strong><p>${connection.connected ? (lastSync ? `Last synced ${esc(lastSync)}` : 'Connected; no sync time is available in the saved snapshot.') : connection.configured ? 'Reconnect from the SoundCloud page using the saved credentials.' : 'Connect from the SoundCloud page to configure this PC.'}</p></div></div><div class="aw-actions">${connection.connected ? button('open-soundcloud', 'SoundCloud details') : button('open-soundcloud', connection.configured ? 'Reconnect account' : 'Connect account')}</div>`;
  };
  const historyPanel = extra => {
    const history = Array.isArray(extra.history) ? extra.history : [];
    return panel('Recent changes', history.length ? `<ol class="aw-history">${history.slice(0, 5).map(entry => `<li><div><strong>${esc(entry.label)}</strong><small>${esc(new Date(entry.at).toLocaleString())}</small></div></li>`).join('')}</ol>${button('undo', 'Undo latest change', '', 'aw-undo')}` : empty('Changes you make in this workspace will appear here.'), 'aw-history-panel');
  };
  const promotion = ctx => {
    const state = ctx.getState(), extra = dataOf(state), links = Array.isArray(extra.links) ? extra.links : [], contacts = Array.isArray(extra.contacts) ? extra.contacts : [];
    const campaignTemplates = Array.isArray(extra.templates) ? extra.templates : templates;
    const campaignList = campaignTemplates.map(item => `<article class="aw-template"><div><h3>${esc(item.title)}</h3><p>${esc(item.channel)} · ${esc(item.caption).replace(/\n/g, '<br>')}</p></div>${button('use-template', 'Create draft', item.id)}</article>`).join('');
    const linkList = links.length ? `<div class="aw-table-wrap"><table class="aw-table"><thead><tr><th>Link</th><th>Release / channel</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${links.map(link => `<tr><td><strong>${esc(link.label)}</strong><small>${esc(link.url)}</small></td><td>${esc(ctx.getState().releases.find(r => r.id === link.releaseId)?.title || 'Unlinked')}<small>${esc(link.channel || 'No channel')}</small></td><td>${esc(link.notes || '—')}</td><td>${button('copy-link', 'Copy URL', link.id)} ${button('remove-link', 'Remove', link.id, 'aw-secondary')}</td></tr>`).join('')}</tbody></table></div>` : empty('Save release, press, or campaign URLs here. Click analytics are not collected.');
    const contactsList = contacts.length ? `<div class="aw-table-wrap"><table class="aw-table"><thead><tr><th>Contact</th><th>Follow-up</th><th>Notes</th><th></th></tr></thead><tbody>${contacts.map(person => `<tr><td><strong>${esc(person.name)}</strong><small>${esc(person.outlet || person.email || 'No outlet or email')}</small></td><td>${shortDate(person.followUp, ctx)}</td><td>${esc(person.notes || '—')}</td><td>${button('remove-contact', 'Remove', person.id, 'aw-secondary')}</td></tr>`).join('')}</tbody></table></div>` : empty('Keep promoter and outlet notes locally, with a follow-up date.');
    return pageHead('Promotion toolkit', 'Reusable drafts, organized links, and local outreach notes.', button('open-promotion', 'Campaigns')) +
      `<div class="aw-promo-grid">${panel('Campaign templates', `<p class="aw-description">Create a local campaign draft from a starting point. Review it in Promotion before sharing.</p>${campaignList}`)}${panel('Add a campaign link', `<form data-aw-form="link" class="aw-form"><label>Link label<input name="label" required maxlength="100" placeholder="Release page, private stream…"></label><label>URL<input name="url" type="url" required maxlength="2000" placeholder="https://…"></label><label>Related release<select name="releaseId"><option value="">No release linked</option>${state.releases.map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select></label><label>Channel<input name="channel" maxlength="60" placeholder="Press, email, social…"></label><label class="aw-wide">Notes<textarea name="notes" maxlength="1000" rows="2" placeholder="Context for this link"></textarea></label><button type="submit">Save link details</button></form>${panel('Saved campaign links', linkList, 'aw-nested')}<p class="aw-note">Links are organized locally; this app does not record clicks or engagement analytics.</p>`)}</div>` +
      `<div class="aw-promo-grid aw-bottom-grid">${panel('Outreach contacts', `<p class="aw-description">Personal notes and follow-up dates are saved on this PC. No messages are sent.</p><form data-aw-form="contact" class="aw-form"><label>Name<input name="name" required maxlength="100" placeholder="Contact name"></label><label>Outlet or email<input name="outlet" maxlength="160" placeholder="Publication, playlist, or email"></label><label>Follow-up date<input name="followUp" type="date"></label><label class="aw-wide">Notes<textarea name="notes" maxlength="2000" rows="2" placeholder="Pitch context, past contact, next step…"></textarea></label><button type="submit">Add contact</button></form>${panel('Contact list', contactsList, 'aw-nested')}`)}${panel('Campaign drafts', state.campaigns.length ? `<ul class="aw-list">${state.campaigns.slice(0, 6).map(c => `<li><span>${esc(c.title)}</span><small>${esc(c.channel || 'General')} · ${shortDate(c.date, ctx)}</small></li>`).join('')}</ul>${button('open-promotion', 'Edit in Promotion')}` : empty('Your campaign drafts will appear here.', button('open-promotion', 'Open Promotion')))}</div>` + historyPanel(extra);
  };
  let helpQuery = '';
  const help = ctx => {
    const state = ctx.getState(), extra = dataOf(state), q = helpQuery.trim().toLowerCase();
    const filtered = helpItems.filter(item => !q || `${item.title} ${item.category} ${item.body}`.toLowerCase().includes(q));
    return pageHead('Help & connection', 'Search workflow tips and check the SoundCloud status saved on this PC.') +
      `<section class="aw-panel aw-help-search"><label for="aw-help-query">Search help</label><input id="aw-help-query" type="search" data-aw-help-search value="${esc(helpQuery)}" placeholder="Try “artwork”, “follow-up”, or “reconnect”" autocomplete="off"><small>Press / to focus search. Results update as you type.</small></section>`+
      panel(`SoundCloud account · ${esc(ctx.getConnection()?.connected ? 'Connected' : 'Needs attention')}`, connectionCard(ctx)) +
      `<section class="aw-help-results" aria-live="polite"><p class="aw-kicker">${filtered.length} HELP TOPIC${filtered.length === 1 ? '' : 'S'}</p>${filtered.length ? filtered.map(item => `<article class="aw-help-item"><div>${tag(item.category)}<h2>${esc(item.title)}</h2><p>${esc(item.body)}</p></div>${button('help-page', 'Open related page', item.page)}</article>`).join('') : empty('No matching help topics. Try a shorter search.')}</section>`;
  };

  const actions = {
    [`${pluginId}-open-releases`]: (id, ctx) => {
      ctx.openPage('releases');
      if (id) [...document.querySelectorAll('#view button[data-action="edit-release"]')].find(item => item.dataset.id === id)?.click();
    },
    [`${pluginId}-pick-artwork`]: async (id, ctx) => {
      ctx.openPage('releases');
      const item = [...document.querySelectorAll('#view button[data-action="artwork"]')].find(button => button.dataset.id === id);
      await item?.click();
    },
    [`${pluginId}-open-library`]: (id, ctx) => {
      ctx.openPage('library');
      const item = [...document.querySelectorAll('#view button[data-action="edit-track"]')].find(button => button.dataset.id === id);
      item?.closest('tr')?.scrollIntoView({ block: 'nearest' }); item?.focus();
    },
    [`${pluginId}-open-promotion`]: (_id, ctx) => ctx.openPage('promotion'),
    [`${pluginId}-open-soundcloud`]: (_id, ctx) => ctx.openPage('soundcloud'),
    [`${pluginId}-help-page`]: (id, ctx) => ctx.openPage(id),
    [`${pluginId}-save-dashboard`]: async (_id, ctx) => {
      const selected = [...document.querySelector('[data-aw-cards]')?.selectedOptions || []].map(option => option.value);
      await commit(ctx, 'Updated dashboard sections', (_state, extra) => { extra.dashboardCards = selected.length ? selected : ['releases']; });
      ctx.notice('Dashboard sections saved.');
    },
    [`${pluginId}-use-template`]: async (id, ctx) => {
      const state = ctx.getState(), extra = dataOf(state);
      const source = [...(Array.isArray(extra.templates) ? extra.templates : templates), ...templates].find(item => item.id === id);
      if (!source) return;
      await commit(ctx, `Created ${source.title} campaign draft`, state => {
        state.campaigns.unshift({ id: ctx.uid(), title: source.title, caption: source.caption, channel: source.channel, date: '', status: 'Planned', contact: '', link: '' });
      });
      ctx.openPage('promotion'); ctx.notice('Campaign draft created. Edit it in Promotion.');
    },
    [`${pluginId}-copy-link`]: async (id, ctx) => {
      const link = (dataOf(ctx.getState()).links || []).find(item => item.id === id);
      if (link) { await ctx.api.copy(link.url); ctx.notice('Link copied. Click activity is not tracked.'); }
    },
    [`${pluginId}-remove-link`]: async (id, ctx) => {
      await commit(ctx, 'Removed a campaign link', (_state, extra) => { extra.links = (extra.links || []).filter(item => item.id !== id); });
      ctx.notice('Link removed from the local workspace.');
    },
    [`${pluginId}-remove-contact`]: async (id, ctx) => {
      await commit(ctx, 'Removed an outreach contact', (state, extra) => { extra.contacts = (extra.contacts || []).filter(item => item.id !== id); });
      ctx.notice('Contact removed from the local workspace.');
    },
    [`${pluginId}-undo`]: async (_id, ctx) => {
      const state = ctx.getState(), extra = dataOf(state), entry = (extra.history || [])[0];
      if (!entry?.before) return ctx.notice('There is no saved change to undo.');
      const remainingHistory = (extra.history || []).slice(1);
      await ctx.update(current => {
        current.campaigns = clone(entry.before.campaigns || []);
        if (entry.before.hadWorkspace) current[key] = { ...(entry.before.workspace || {}), history: remainingHistory };
        else delete current[key];
      });
      ctx.notice(`Undid: ${entry.label}`);
    }
  };

  const submitForm = async (form, ctx) => {
    const values = Object.fromEntries(new FormData(form));
    if (form.dataset.awForm === 'link') {
      const url = String(values.url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('Enter an http or https URL.');
      await commit(ctx, `Saved link: ${values.label}`, (_state, extra) => {
        extra.links = Array.isArray(extra.links) ? extra.links : [];
        extra.links.unshift({ id: ctx.uid(), label: String(values.label).trim(), url, releaseId: values.releaseId || '', channel: String(values.channel || '').trim(), notes: String(values.notes || '').trim(), createdAt: new Date().toISOString() });
      });
      ctx.notice('Campaign link details saved locally.');
    } else if (form.dataset.awForm === 'contact') {
      await commit(ctx, `Added contact: ${values.name}`, (_state, extra) => {
        extra.contacts = Array.isArray(extra.contacts) ? extra.contacts : [];
        extra.contacts.unshift({ id: ctx.uid(), name: String(values.name).trim(), outlet: String(values.outlet || '').trim(), followUp: values.followUp || '', notes: String(values.notes || '').trim(), createdAt: new Date().toISOString() });
      });
      ctx.notice('Contact and follow-up saved locally.');
    }
  };

  let lastPage = '';
  window.registerArtistPlugin({
    id: pluginId,
    pages: [
      { id: 'artist-workspace', title: 'Workspace', icon: '◈', render: dashboard },
      { id: 'artist-promotion-tools', title: 'Promotion tools', icon: '↗', render: promotion },
      { id: 'artist-help', title: 'Help & connection', icon: '?', render: help }
    ],
    actions,
    init() { setStylesheet(); },
    onRender(ctx) {
      const page = ctx.getPage();
      if (page !== lastPage && ['artist-workspace', 'artist-promotion-tools', 'artist-help'].includes(page)) {
        requestAnimationFrame(() => document.querySelector('#view [data-aw-heading]')?.focus({ preventScroll: true }));
      }
      lastPage = page;
      document.querySelectorAll('#view form[data-aw-form]').forEach(form => {
        if (form.dataset.awBound) return;
        form.dataset.awBound = 'true';
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (!form.reportValidity()) return;
          submitForm(form, ctx).catch(error => ctx.notice(error.message));
        });
      });
      const search = document.querySelector('[data-aw-help-search]');
      if (search && !search.dataset.awBound) {
        search.dataset.awBound = 'true';
        search.addEventListener('input', () => {
          helpQuery = search.value;
          const start = search.selectionStart, end = search.selectionEnd;
          ctx.render();
          const replacement = document.querySelector('[data-aw-help-search]');
          replacement?.focus(); replacement?.setSelectionRange(start, end);
        });
      }
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) && document.querySelector('[data-aw-help-search]')) {
      event.preventDefault(); document.querySelector('[data-aw-help-search]')?.focus();
    }
  });
})();
