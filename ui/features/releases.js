(() => {
  const pageId = 'release-planner';
  const stageNames = ['Planning', 'Preparing', 'Ready', 'Released'];
  const templates = {
    Single: ['Approve final master', 'Prepare cover artwork', 'Check credits and metadata', 'Upload to SoundCloud', 'Prepare promotion'],
    EP: ['Sequence tracks', 'Approve final masters', 'Prepare cover artwork', 'Check credits and metadata', 'Upload tracks to SoundCloud', 'Prepare promotion'],
    Album: ['Finalize track list', 'Sequence and approve masters', 'Prepare album artwork', 'Check credits and metadata', 'Upload tracks to SoundCloud', 'Prepare launch promotion']
  };
  let context;
  let monthOffset = 0;
  let crop = {};
  let analyzed = {};
  let pendingRetry = '';

  const q = selector => document.querySelector(selector);
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const normalize = state => {
    state.releaseUx ||= { view: 'board', templates: [] };
    state.releaseUx.templates ||= [];
    state.releases.forEach(release => {
      release.stage ||= release.date && release.date < dateKey(new Date()) ? 'Released' : 'Planning';
      release.checks ||= [];
      release.checks.forEach(check => { check.owner ||= ''; check.due ||= ''; });
    });
  };
  const releaseById = id => context.getState().releases.find(item => item.id === id);
  const trackById = id => context.getState().tracks.find(item => item.id === id);
  const btn = (action, label, id = '', cls = '') => `<button class="rux-button ${cls}" data-action="release-ux-${action}" data-id="${context.esc(id)}">${label}</button>`;
  const statusText = track => {
    if (!track.lastUpload) return '<span class="rux-muted">No upload recorded from this app</span>';
    const value = String(track.lastUpload.state || 'unknown');
    const known = { processing: 'Processing (reported by SoundCloud)', finished: 'Ready (reported by SoundCloud)' };
    return `<span class="rux-status">${context.esc(known[value.toLowerCase()] || `SoundCloud status: ${value}`)}</span><small>Last response ${context.esc(track.lastUpload.at ? new Date(track.lastUpload.at).toLocaleString() : 'date not recorded')}</small>`;
  };
  const taskRows = release => release.checks.map((task, index) => `<div class="rux-task">
    <label class="rux-task-done"><input type="checkbox" data-rux-done="${context.esc(release.id)}" data-index="${index}" ${task.done ? 'checked' : ''}> <span>${context.esc(task.label)}</span></label>
    <label>Owner <input class="rux-small-input" data-rux-owner="${context.esc(release.id)}" data-index="${index}" maxlength="80" value="${context.esc(task.owner || '')}" placeholder="Unassigned"></label>
    <label>Due <input class="rux-small-input" type="date" data-rux-due="${context.esc(release.id)}" data-index="${index}" value="${context.esc(task.due || '')}"></label>
  </div>`).join('');
  const releaseCard = release => {
    const art = release.art ? `<img src="studio://art/${context.esc(release.id)}" alt="Artwork for ${context.esc(release.title)}" style="object-position:${crop[release.id]?.x ?? 50}% ${crop[release.id]?.y ?? 50}%;transform:scale(${crop[release.id]?.zoom ?? 1})">` : '<span aria-hidden="true">♫</span>';
    const track = trackById(release.trackId);
    const done = release.checks.filter(task => task.done).length;
    return `<article class="rux-release-card">
      <div class="rux-cover">${art}</div>
      <div class="rux-card-body"><div class="rux-card-meta"><span>${context.esc(release.type || 'Single')}</span><span>${context.esc(context.date(release.date))}</span></div>
      <h3>${context.esc(release.title)}</h3><p>${track ? context.esc(track.title) : 'No track linked'}</p>
      <label class="rux-field">Board stage <select data-rux-stage="${context.esc(release.id)}">${stageNames.map(stage => `<option ${release.stage === stage ? 'selected' : ''}>${stage}</option>`).join('')}</select></label>
      <div class="rux-crop-controls"><span>Artwork preview crop</span><label>Zoom <input data-rux-crop="zoom" data-id="${context.esc(release.id)}" type="range" min="1" max="2" step=".05" value="${crop[release.id]?.zoom ?? 1}"></label><label>Horizontal <input data-rux-crop="x" data-id="${context.esc(release.id)}" type="range" min="0" max="100" value="${crop[release.id]?.x ?? 50}"></label><label>Vertical <input data-rux-crop="y" data-id="${context.esc(release.id)}" type="range" min="0" max="100" value="${crop[release.id]?.y ?? 50}"></label></div>
      <div class="rux-progress"><span style="width:${release.checks.length ? done / release.checks.length * 100 : 0}%"></span></div><small>${done} of ${release.checks.length} checklist items complete</small>
      <details><summary>Tasks and ownership</summary><div class="rux-task-list">${taskRows(release) || '<p>No checklist tasks yet.</p>'}<div class="rux-add-task"><input data-rux-new-task="${context.esc(release.id)}" maxlength="100" placeholder="Add a checklist task">${btn('add-task', 'Add task', release.id)}</div></div></details>
      ${track ? `<details><summary>Linked audio quality summary</summary><div class="rux-quality"><span>Format <b>${context.esc(track.format || 'Not recorded')}</b></span><span>File size <b>${Number.isFinite(track.size) ? `${(track.size / 1048576).toFixed(1)} MB` : 'Not recorded'}</b></span><span>Duration <b>${analyzed[track.id] ? context.esc(analyzed[track.id]) : 'Not analyzed'}</b></span>${btn('analyze', 'Read local duration', track.id)}</div><p class="rux-note">Only local file format, size, and readable duration are shown. Sample rate and channel count are not exposed by the current app API.</p></details>` : ''}
      <div class="rux-card-actions">${btn('edit', 'Edit release', release.id)}${release.art ? btn('artwork', 'Choose artwork', release.id) : btn('artwork', 'Add artwork', release.id)}</div>
    </div></article>`;
  };
  const board = state => `<div class="rux-board">${stageNames.map(stage => {
    const items = state.releases.filter(release => (release.stage || 'Planning') === stage);
    return `<section class="rux-lane"><header><h2>${stage}</h2><span>${items.length}</span></header>${items.length ? items.map(releaseCard).join('') : '<p class="rux-empty">Drop a release here by changing its board stage.</p>'}</section>`;
  }).join('')}</div>`;
  const calendar = state => {
    const now = new Date();
    const month = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
    const entries = new Map();
    state.releases.forEach(release => { if (release.date) entries.set(release.date, [...(entries.get(release.date) || []), { title: release.title, kind: 'Release plan' }]);
      release.checks.forEach(task => { if (task.due && !task.done) entries.set(task.due, [...(entries.get(task.due) || []), { title: `${task.label} · ${release.title}`, kind: task.owner ? `Task · ${task.owner}` : 'Checklist task' }]); });
    });
    const headers = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="rux-day-name">${day}</div>`).join('');
    return `<div class="rux-calendar-head"><button class="rux-button" data-action="release-ux-month-prev">←</button><h2>${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button class="rux-button" data-action="release-ux-month-next">→</button></div><div class="rux-calendar">${headers}${days.map(day => { const key = dateKey(day); const hits = entries.get(key) || []; return `<div class="rux-day ${day.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === dateKey(now) ? 'today' : ''}"><b>${day.getDate()}</b>${hits.map(hit => `<div title="${context.esc(hit.kind)}">${context.esc(hit.title)}</div>`).join('')}</div>`; }).join('')}</div><p class="rux-note">Calendar entries are local planning dates and reminders. They do not schedule publication on SoundCloud.</p>`;
  };
  const uploadPanel = state => {
    const uploaded = state.tracks.filter(track => track.lastUpload).sort((a, b) => String(b.lastUpload.at || '').localeCompare(String(a.lastUpload.at || '')));
    const failed = uploaded.filter(track => String(track.lastUpload.state || '').toLowerCase() === 'failed');
    return `<section class="rux-panel"><header><div><h2>Upload status and history</h2><p>Based on the most recent upload response saved for each local track.</p></div></header>
      ${state.tracks.length ? state.tracks.map(track => `<div class="rux-upload-row"><div><strong>${context.esc(track.title)}</strong><small>${context.esc(track.format || '')} · ${Number.isFinite(track.size) ? `${(track.size / 1048576).toFixed(1)} MB` : 'size unavailable'}</small></div><div>${statusText(track)}</div><div>${/^https:\/\//i.test(track.lastUpload?.url || '') ? `<a href="${context.esc(track.lastUpload.url)}" target="_blank" rel="noreferrer">Open saved link</a>` : ''}</div>${String(track.lastUpload?.state || '').toLowerCase() === 'failed' ? btn('retry', 'Review retry', track.id) : track.lastUpload ? btn('retry', 'Upload another copy…', track.id) : '<span class="rux-muted">No saved upload</span>'}</div>`).join('') : '<p class="rux-empty">Import tracks to see their local upload status here.</p>'}
      <p class="rux-note">This app stores only the latest upload response per track, not a complete attempt log. A retry runs the normal upload flow; SoundCloud may create a separate track. Confirm the track was not already accepted before retrying.</p>
      ${failed.length ? `<p class="rux-alert">${failed.length} saved response${failed.length === 1 ? '' : 's'} report failed. Review before retrying.</p>` : ''}</section>`;
  };
  const templatesPanel = state => `<section class="rux-panel"><header><div><h2>Start from a release template</h2><p>Templates add a local release plan and checklist.</p></div></header><div class="rux-template-grid">${Object.entries(templates).map(([type, tasks]) => `<article><span class="rux-kicker">${type.toUpperCase()}</span><h3>${type} plan</h3><p>${tasks.length} suggested checklist tasks</p>${btn('template', `Create ${type}`, type, 'primary')}</article>`).join('')}</div>
    <h3>Your saved templates</h3>${state.releaseUx.templates.length ? state.releaseUx.templates.map(template => `<div class="rux-saved-template"><div><b>${context.esc(template.name)}</b><small>${template.tasks.length} checklist tasks</small></div>${btn('saved-template', 'Create release', template.id, 'primary')}</div>`).join('') : '<p class="rux-muted">No custom templates saved yet. Save a release plan as a template from its card.</p>'}</section>`;
  };

  function render(ctx) {
    context = ctx;
    const state = ctx.getState(); normalize(state);
    const view = state.releaseUx.view || 'board';
    const overdue = state.releases.flatMap(release => release.checks.filter(task => task.due && !task.done && task.due < dateKey(new Date())).map(task => ({ release, task })));
    const reminders = state.releases.flatMap(release => release.checks.filter(task => task.due && !task.done).map(task => ({ release, task }))).sort((a, b) => a.task.due.localeCompare(b.task.due));
    return `<div class="rux-page"><header class="rux-page-head"><div><span class="rux-kicker">YOUR RELEASE WORKSPACE</span><h1>Release planner</h1><p>Plan releases, keep local reminders, and review upload responses.</p></div><div class="rux-head-actions"><button class="rux-button primary" data-page="releases">＋ New release</button></div></header>
      <div class="rux-tabs" role="tablist">${[['board', 'Release board'], ['calendar', 'Calendar'], ['templates', 'Templates'], ['uploads', 'Upload activity']].map(([id, label]) => `<button role="tab" aria-selected="${view === id}" class="${view === id ? 'active' : ''}" data-action="release-ux-view" data-id="${id}">${label}</button>`).join('')}</div>
      ${overdue.length ? `<div class="rux-alert" role="status"><b>${overdue.length} overdue local reminder${overdue.length === 1 ? '' : 's'}</b><span>${overdue.slice(0, 3).map(({ task, release }) => `${ctx.esc(task.label)} · ${ctx.esc(release.title)}`).join(' / ')}</span></div>` : ''}
      ${view === 'board' ? `${state.releases.length ? board(state) : `<div class="rux-panel rux-empty"><h2>Start with a release plan</h2><p>Create a single, EP, or album plan to populate your board.</p><button class="rux-button primary" data-page="releases">＋ New release</button></div>`}<section class="rux-panel rux-reminders"><header><div><h2>Upcoming local reminders</h2><p>Checklist due dates are saved in this workspace only.</p></div></header>${reminders.slice(0, 8).map(({ release, task }) => `<div class="rux-reminder"><time>${ctx.esc(ctx.date(task.due))}</time><span>${ctx.esc(task.label)}</span><small>${ctx.esc(release.title)}${task.owner ? ` · ${ctx.esc(task.owner)}` : ''}</small></div>`).join('') || '<p class="rux-muted">Add due dates to checklist tasks to see reminders here.</p>'}</section>` : view === 'calendar' ? calendar(state) : view === 'templates' ? templatesPanel(state) : uploadPanel(state)}
      <p class="rux-note">Release dates and checklist reminders are for your planning. This workspace does not schedule posts or publish dates on SoundCloud.</p></div>`;
  }

  async function mutate(ctx, fn) {
    await ctx.update(state => { normalize(state); fn(state); });
  }
  const actions = {
    'release-ux-view': async (id, ctx) => mutate(ctx, state => { state.releaseUx.view = ['board', 'calendar', 'templates', 'uploads'].includes(id) ? id : 'board'; }),
    'release-ux-month-prev': async (_id, ctx) => { monthOffset--; ctx.render(); },
    'release-ux-month-next': async (_id, ctx) => { monthOffset++; ctx.render(); },
    'release-ux-template': async (type, ctx) => {
      const release = { id: ctx.uid(), title: `${type} release`, type, date: '', notes: '', trackId: '', stage: 'Planning', checks: templates[type].map(label => ({ label, done: false, owner: '', due: '' })) };
      await mutate(ctx, state => { state.releases.unshift(release); state.releaseUx.view = 'board'; });
      ctx.notice(`${type} template added. Edit its title and details on the Releases page.`);
    },
    'release-ux-saved-template': async (id, ctx) => {
      const template = ctx.getState().releaseUx?.templates?.find(item => item.id === id); if (!template) return;
      await mutate(ctx, state => { state.releases.unshift({ id: ctx.uid(), title: template.name, type: template.type || 'Single', date: '', notes: '', trackId: '', stage: 'Planning', checks: template.tasks.map(label => ({ label, done: false, owner: '', due: '' })) }); state.releaseUx.view = 'board'; });
    },
    'release-ux-add-task': async (id, ctx) => {
      const field = q(`[data-rux-new-task="${CSS.escape(id)}"]`); const label = field?.value.trim(); if (!label) return ctx.notice('Enter a task name first.');
      await mutate(ctx, state => { state.releases.find(item => item.id === id)?.checks.push({ label, done: false, owner: '', due: '' }); });
      ctx.notice('Checklist task added.');
    },
    'release-ux-edit': (id, ctx) => { ctx.openPage('releases'); ctx.notice(`Use Edit details on “${ctx.esc(releaseById(id)?.title || 'this release')}” to update its plan.`); },
    'release-ux-artwork': (id, ctx) => { ctx.openPage('releases'); ctx.notice('Choose artwork from the release card. Crop controls here only change the local preview.'); },
    'release-ux-retry': (id, ctx) => {
      const track = trackById(id); if (!track) return;
      if (!ctx.getConnection().connected) { ctx.openPage('soundcloud'); ctx.notice('Connect your artist account before retrying an upload.'); return; }
      const hasPrior = Boolean(track.lastUpload);
      const message = hasPrior ? `The last saved response for “${track.title}” is ${track.lastUpload.state || 'unknown'}. Continuing may create a separate SoundCloud track. Only continue if you confirmed the previous upload was not accepted.` : `No saved upload response exists for “${track.title}”. Continue to the standard upload form?`;
      if (!window.confirm(message)) return;
      pendingRetry = id;
      ctx.openPage('upload');
      ctx.notice('Opening the standard upload form. Review it before sending anything.');
    },
    'release-ux-analyze': async (id, ctx) => {
      const track = trackById(id); if (!track) return;
      const audio = new Audio();
      audio.preload = 'metadata'; audio.src = `studio://audio/${encodeURIComponent(id)}`;
      audio.onloadedmetadata = () => { analyzed[id] = Number.isFinite(audio.duration) ? `${Math.floor(audio.duration / 60)}:${String(Math.floor(audio.duration % 60)).padStart(2, '0')}` : 'Unavailable'; ctx.render(); };
      audio.onerror = () => { analyzed[id] = 'Unavailable'; ctx.render(); ctx.notice('Duration metadata could not be read from this local audio file.'); };
      ctx.notice('Reading duration from the local audio file…');
    },
    'release-ux-save-template': async (id, ctx) => {
      const release = releaseById(id); if (!release) return;
      const name = window.prompt('Name this release template:', release.title); if (!name?.trim()) return;
      await mutate(ctx, state => { state.releaseUx.templates.push({ id: ctx.uid(), name: name.trim(), type: release.type || 'Single', tasks: release.checks.map(task => task.label) }); });
      ctx.notice('Release template saved locally.');
    }
  };

  function onChange(event) {
    const target = event.target;
    if (target.dataset.ruxCrop) {
      const id = target.dataset.id; crop[id] ||= { x: 50, y: 50, zoom: 1 }; crop[id][target.dataset.ruxCrop] = Number(target.value);
      const card = target.closest('.rux-release-card'); const image = card?.querySelector('.rux-cover img');
      if (image) { image.style.objectPosition = `${crop[id].x}% ${crop[id].y}%`; image.style.transform = `scale(${crop[id].zoom})`; }
      return;
    }
    const id = target.dataset.ruxStage || target.dataset.ruxDone || target.dataset.ruxOwner || target.dataset.ruxDue;
    if (!id) return;
    const index = Number(target.dataset.index);
    context.update(state => {
      const release = state.releases.find(item => item.id === id); if (!release) return;
      if (target.dataset.ruxStage) release.stage = target.value;
      else if (target.dataset.ruxDone) release.checks[index].done = target.checked;
      else if (target.dataset.ruxOwner) release.checks[index].owner = target.value.trim();
      else if (target.dataset.ruxDue) release.checks[index].due = target.value;
    });
  }
  function onClick(event) {
    if (event.target.matches('[data-rux-save-template]')) actions['release-ux-save-template'](event.target.dataset.ruxSaveTemplate, context).catch(error => context.notice(error.message));
  }

  window.registerArtistPlugin({
    id: 'release-planner',
    pages: [{ id: pageId, title: 'Release planner', icon: '◷', render }],
    actions,
    init(ctx) {
      context = ctx;
      if (!document.querySelector('link[data-release-planner-style]')) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'features/releases.css'; link.dataset.releasePlannerStyle = 'true'; document.head.append(link);
      }
      document.addEventListener('change', onChange);
      document.addEventListener('click', onClick);
    },
    onRender(ctx) {
      context = ctx;
      if (ctx.getPage() === 'upload' && pendingRetry) {
        const id = pendingRetry;
        const trigger = document.querySelector(`[data-action="upload-track"][data-id="${CSS.escape(id)}"]`);
        if (trigger) { pendingRetry = ''; trigger.click(); }
      }
      if (ctx.getPage() === pageId) document.querySelectorAll('.rux-release-card').forEach(card => {
        const id = card.querySelector('[data-rux-stage]')?.dataset.ruxStage;
        if (!id) return;
        const save = card.querySelector('.rux-card-actions');
        if (save && !save.querySelector('[data-rux-save-template]')) {
          const button = document.createElement('button'); button.className = 'rux-button'; button.textContent = 'Save as template'; button.dataset.ruxSaveTemplate = id; save.append(button);
        }
      });
    }
  });
})();
