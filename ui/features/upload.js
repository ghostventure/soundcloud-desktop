(() => {
  const ID = 'artist-upload-desk';
  let selected = new Set();
  let activeTrack = '';
  let uploadJobs = [];
  let progressHandler;
  let busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeReceiptUrl=value=>{try{const url=new URL(String(value||''));return url.protocol==='https:'&&['soundcloud.com','www.soundcloud.com'].includes(url.hostname.toLowerCase())&&!url.username&&!url.password&&!url.port?url.href:'';}catch{return '';}};
  const arr = (state, key) => Array.isArray(state[key]) ? state[key] : [];
  const tracks = ctx => ctx.getState().tracks || [];
  const bytes = n => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;
  const normalize = value => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const defaults = (ctx, track) => ({title:track?.title || '', artist:ctx.getState().profile?.name === 'Your studio' ? '' : (ctx.getState().profile?.name || ''), genre:track?.genre || '', description:[track?.notes,track?.credits].filter(Boolean).join('\n\n'), sharing:'private', releaseId:'', remindersAt:''});
  const btn = (action,label,primary=false,id='') => `<button type="button" data-u-action="${action}" data-id="${esc(id)}" class="${primary?'primary':''}">${label}</button>`;
  const field = (label,name,value='',type='text',extra='') => `<label class="u-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const select = (label,name,options,value) => `<label class="u-field">${label}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${value===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
  const area = (label,name,value='') => `<label class="u-field">${label}<textarea name="${name}">${esc(value)}</textarea></label>`;
  const card = (title,content,more='') => `<section class="u-card"><div class="u-card-head"><h2>${title}</h2>${more}</div>${content}</section>`;
  const reviewJobs = () => uploadJobs.filter(job=>job.status==='outcome-unknown'||job.status==='accepted');
  const pendingJob = trackId => uploadJobs.find(job=>job.trackId===trackId&&(job.status==='outcome-unknown'||job.status==='accepted'));
  function renderJobReview(){
    const jobs=reviewJobs();if(!jobs.length)return '';
    return card('Upload receipts to review',`<p class="u-note" role="alert">Review saved attempts before uploading the same track again. Unknown outcomes require checking SoundCloud; confirmed receipts should be saved in your workspace first.</p><ul class="u-reminders">${jobs.map(job=>`<li><strong>${esc(job.title||'Untitled track')}</strong><span>${esc(job.accountLabel||'SoundCloud account')} Â· ${Math.max(0,Math.min(100,Number(job.progress)||0))}% sent Â· ${esc(job.updatedAt||'')}</span><small>${esc(job.message||'Review this upload attempt before continuing.')}</small>${safeReceiptUrl(job.remoteUrl)?`<a href="${esc(safeReceiptUrl(job.remoteUrl))}" target="_blank" rel="noreferrer">Open confirmed SoundCloud receipt</a>`:''}${btn('ack-upload-job',job.status==='accepted'?'I saved this receipt':'I checked SoundCloud',false,job.id)}</li>`).join('')}</ul>`);
  }
  async function refreshUploadJobs(ctx,repaint=false){try{uploadJobs=await window.studio.uploadJobs();if(!Array.isArray(uploadJobs))uploadJobs=[];if(repaint)ctx.render();}catch{}}
  function render(ctx) {
    const s=ctx.getState(), ts=tracks(ctx).slice(), queue=arr(s,'artistUploadQueue'), presets=arr(s,'artistUploadPresets'), templates=arr(s,'artistMetadataTemplates');
    const sort=s.artistLibrarySort||'title',pageSize=100,totalPages=Math.max(1,Math.ceil(ts.length/pageSize)),page=Math.min(s.artistLibraryPage||0,totalPages-1),visible=ts.slice(page*pageSize,(page+1)*pageSize);
    ts.sort(sort==='recent'?(a,b)=>String(b.added||'').localeCompare(String(a.added||'')):sort==='size'?(a,b)=>(b.size||0)-(a.size||0):sort==='status'?(a,b)=>String(a.status||'').localeCompare(String(b.status||'')):(a,b)=>String(a.title||'').localeCompare(String(b.title||'')));
    const onboard=s.artistSetup || {account:false,library:false,firstUpload:false};
    onboard.account=!!(onboard.account||ctx.getConnection()?.connected);
    onboard.library=!!(onboard.library||ts.length);
    const done=[onboard.account,onboard.library,onboard.firstUpload].filter(Boolean).length;
    const conn=ctx.getConnection();
    const scheduled=queue.filter(q=>q.remindersAt && q.status!=='uploaded').sort((a,b)=>a.remindersAt.localeCompare(b.remindersAt));
    return `<div class="u-page"><header class="u-head"><div><span class="eyebrow">ARTIST WORKSPACE</span><h1>Upload desk</h1><p>Prepare, review, and organize uploads before sending them to SoundCloud.</p></div><div class="u-actions">${btn('import-audio','＋ Import audio',true)}</div></header>
      ${card(`First-run setup <span class="u-count">${done}/3</span>`, `<p class="u-muted">A quick checklist to get your workspace ready. You can return to it any time.</p><div class="u-steps">${[['account','Connect SoundCloud','Connect your artist account before uploading.','connect'],['library','Add a track','Import a local audio file into your library.','import'],['firstUpload','Review an upload','Open a track and complete its preflight review.','start']].map(([key,title,detail,action],i)=>`<div class="u-step"><span class="u-step-number ${onboard[key]?'done':''}" aria-hidden="true">${onboard[key]?'✓':i+1}</span><div><strong>${title}</strong><small>${detail}</small></div>${onboard[key]?'<span class="u-tag">DONE</span>':btn(`setup-${action}`,action==='connect'?'Connect':action==='import'?'Import':'Choose track')}</div>`).join('')}</div>`, '<span class="u-tag">RESUMABLE</span>')}
      ${!conn?.connected?'<div class="u-note" role="status">SoundCloud is not connected. Your drafts remain on this PC; connect before starting an upload.</div>':''}
      ${renderJobReview()}
      ${scheduled.length?card('Local reminders',`<p class="u-note">These dates are reminders saved in this workspace. SoundCloud publication is not scheduled by this app.</p><ul class="u-reminders">${scheduled.map(q=>`<li><strong>${esc(q.metadata.title)}</strong><span>${new Date(q.remindersAt).toLocaleString()}</span>${btn('edit-queued','Edit',false,q.id)}</li>`).join('')}</ul>`):''}
      ${card('Draft upload queue',queue.length?`<div class="u-table-wrap"><table class="u-table"><thead><tr><th>TRACK / DETAILS</th><th>VISIBILITY</th><th>LOCAL REMINDER</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${queue.map(q=>{const t=ts.find(x=>x.id===q.trackId);return `<tr><td><strong>${esc(q.metadata?.title || t?.title || 'Track unavailable')}</strong><small>${esc(t?.format||'Track removed')} · ${t?bytes(t.size):'Unavailable'}</small></td><td>${esc(q.metadata?.sharing||'private')}</td><td>${q.remindersAt?esc(new Date(q.remindersAt).toLocaleString()):'None'}</td><td><span class="u-tag">${esc(q.status||'draft')}</span></td><td><div class="u-actions">${btn('edit-queued','Review',false,q.id)}${btn('send-queued','Upload now',true,q.id)}${btn('remove-queued','Remove',false,q.id)}</div></td></tr>`}).join('')}</tbody></table></div>`: `<div class="u-empty"><strong>No upload drafts yet</strong><p>Prepare a track and save it to the queue. Nothing is sent until you confirm the preflight.</p></div>`,btn('new-draft','＋ Prepare upload',true))}
      ${card('Upload presets',`<p class="u-muted">Presets save your common artist, genre, visibility, and description defaults. Private is always the starting visibility.</p>${presets.length?`<div class="u-chip-list">${presets.map(p=>`<div class="u-chip"><div><strong>${esc(p.name)}</strong><small>${esc(p.sharing)} · ${esc(p.genre||'No genre')}</small></div>${btn('use-preset','Use',false,p.id)}${btn('delete-preset','Delete',false,p.id)}</div>`).join('')}</div>`:'<p class="u-muted">No presets saved.</p>'}<form data-u-form="preset" class="u-inline-form"><label class="u-field">Preset name<input name="name" required maxlength="60" placeholder="e.g. Private demo"></label>${select('Default visibility','sharing',[['private','Private'],['public','Public']], 'private')}<label class="u-field">Artist name<input name="artist" maxlength="100" value="${esc(s.profile?.name==='Your studio'?'':s.profile?.name||'')}"></label><label class="u-field">Genre<input name="genre" maxlength="80"></label><button class="primary">Save preset</button></form>`)}
      ${card('Metadata templates',`<p class="u-muted">Reusable description and credits text for repeatable release details.</p>${templates.length?`<div class="u-chip-list">${templates.map(t=>`<div class="u-chip"><div><strong>${esc(t.name)}</strong><small>${esc((t.description||'').slice(0,100))}</small></div>${btn('delete-template','Delete',false,t.id)}</div>`).join('')}</div>`:'<p class="u-muted">No metadata templates saved.</p>'}<form data-u-form="template" class="u-inline-form"><label class="u-field">Template name<input name="name" required maxlength="60" placeholder="e.g. Standard credits"></label>${area('Description / credits','description','')}<button class="primary">Save template</button></form>`)}
      ${card('Library organizer',`<p class="u-muted">Sort by title, newest import, file size, or status. Select tracks for batch metadata and organization updates.</p><div class="u-toolbar"><label class="u-field">Sort by<select id="u-sort"><option value="title">Title A–Z</option><option value="recent">Recently added</option><option value="size">File size</option><option value="status">Status</option></select></label><span class="u-muted">${ts.length} tracks · ${selected.size} selected</span></div><div class="u-bulk"><label><input type="checkbox" id="u-select-all" ${ts.length&&selected.size===ts.length?'checked':''}> Select all</label><label class="u-field">Genre<input id="u-bulk-genre" placeholder="Set genre for selected"></label><label class="u-field">Status<select id="u-bulk-status"><option value="">Keep status</option>${['Draft','Mixing','Mastered','Released'].map(v=>`<option>${v}</option>`).join('')}</select></label><label class="u-field">Credits / notes<textarea id="u-bulk-notes" placeholder="Replace notes for selected tracks"></textarea></label>${btn('bulk-apply','Apply to selected',true)}</div>${ts.length?`<div class="u-table-wrap"><table class="u-table"><thead><tr><th>SELECT</th><th>TRACK</th><th>GENRE / STATUS</th><th>SIZE / FORMAT</th><th></th></tr></thead><tbody>${visible.map(t=>`<tr><td><input type="checkbox" aria-label="Select ${esc(t.title)}" data-track-select="${esc(t.id)}" ${selected.has(t.id)?'checked':''}></td><td><strong>${esc(t.title)}</strong><small>${esc(t.notes||t.credits||'No notes or credits')}</small></td><td>${esc(t.genre||'No genre')} · ${esc(t.status)}</td><td>${bytes(t.size)} · ${esc(t.format||'Audio')}</td><td>${btn('prepare-track','Prepare upload',false,t.id)}</td></tr>`).join('')}</tbody></table><div class="u-paging"><span>Showing ${page*pageSize+1}–${Math.min((page+1)*pageSize,ts.length)} of ${ts.length}</span>${page===0?'<button type="button" disabled>Previous</button>':btn('library-page','Previous',false,'-1')}<span>Page ${page+1} of ${totalPages}</span>${page>=totalPages-1?'<button type="button" disabled>Next</button>':btn('library-page','Next',false,'1')}</div></div>`:'<div class="u-empty"><strong>Your library is ready for audio</strong><p>Import tracks to sort them, review details, and prepare upload drafts.</p></div>'}`)}
      ${activeTrack?renderPreflight(ctx,activeTrack,ctx._uploadQueueEdit||''):''}
    </div>`;
  }
  function renderPreflight(ctx,id,queuedId='') {
    const s=ctx.getState(), t=tracks(ctx).find(x=>x.id===id); if(!t)return '';
    const q=arr(s,'artistUploadQueue').find(x=>x.id===queuedId), m=q?.metadata||defaults(ctx,t);
    const dup=tracks(ctx).filter(x=>x.id!==id && normalize(x.title)===normalize(m.title));
    const prior=t.lastUpload;
    const pending=pendingJob(id);
    return `<section class="u-card u-preflight" aria-labelledby="u-preflight-title"><div class="u-card-head"><h2 id="u-preflight-title">Preflight review</h2>${btn('close-preflight','Close')}</div><p class="u-muted">Review the details that will be sent for this track. Your audio file remains on this PC until you choose to upload.</p><div class="u-track-summary"><strong>${esc(t.title)}</strong><span>${esc(t.format||'Audio')} · ${bytes(t.size)} · ${esc(t.status||'Draft')}</span></div>${dup.length||prior?`<div class="u-warning" role="alert"><strong>Possible duplicate</strong><p>${prior?'This audio has been uploaded from this app before. Uploading creates another SoundCloud track.':''} ${dup.length?`Similar library title${dup.length>1?'s':''}: ${dup.map(x=>esc(x.title)).join(', ')}.`:''}</p></div>`:''}
      <form data-u-form="draft" data-track="${esc(id)}" data-queue="${esc(queuedId)}"><div class="u-fields">${field('Track title','title',m.title,'text','required maxlength="180"')}${field('Artist name','artist',m.artist,'text','maxlength="100"')}${field('Genre','genre',m.genre,'text','maxlength="80"')}${select('Visibility','sharing',[['private','Private — only you and people with the link'],['public','Public — visible to everyone']],m.sharing||'private')}</div>${select('Apply metadata template','templateId',[['','Do not apply'],...arr(s,'artistMetadataTemplates').map(x=>[x.id,x.name])],'')}${area('Description / credits','description',m.description||'')}${select('Cover artwork from release','releaseId',[['','Use track artwork if available'],...(s.releases||[]).filter(r=>r.art).map(r=>[r.id,r.title])],m.releaseId||'')}${field('Local reminder date and time','remindersAt',m.remindersAt||'','datetime-local')}<p class="u-hint">Reminder dates are stored locally only. This does not schedule or publish a SoundCloud track.</p><label class="u-confirm"><input type="checkbox" name="confirmPublic" value="yes" ${m.sharing==='public'?'required':''}> I understand that Public makes this track visible to everyone when SoundCloud finishes processing.</label><div class="u-actions"><button type="button" data-u-action="save-draft" data-id="${esc(id)}" class="primary">Save to draft queue</button>${q?btn('save-queued','Save changes',true,q.id):''}<button type="submit" name="intent" value="upload" class="u-upload-now" ${ctx.getConnection()?.connected&&!pending?'':'disabled'}>Upload now</button></div>${!ctx.getConnection()?.connected?'<p class="u-hint">Connect SoundCloud before uploading. You can still save this draft locally.</p>':''}</form></section>`;
  }
  function showPreflight(id,ctx,queueId='') { if(!tracks(ctx).some(t=>t.id===id))return ctx.notice('That track is no longer in the library.'); activeTrack=id; ctx._uploadQueueEdit=queueId; ctx.render(); setTimeout(()=>document.querySelector('.u-preflight')?.scrollIntoView({behavior:'smooth',block:'start'}),0); }
  async function persist(ctx,fn){return ctx.update(s=>{fn(s);});}
  async function saveDraft(ctx,id,data,queueId='') {
    const conn=ctx.getConnection();
    const metadata={title:data.title.trim(),artist:data.artist.trim(),genre:data.genre.trim(),description:data.description.trim(),sharing:data.sharing==='public'?'public':'private',releaseId:data.releaseId||'',remindersAt:data.remindersAt||''};
    if(!metadata.title)throw Error('Enter a track title before saving the draft.');
    if(metadata.sharing==='public'&&data.confirmPublic!=='yes')throw Error('Confirm that you understand this draft is set to public.');
    const qid=queueId||ctx.uid();
    await persist(ctx,s=>{const q=arr(s,'artistUploadQueue');const existing=q.find(x=>x.id===qid);const entry={id:qid,trackId:id,metadata,status:'draft',remindersAt:metadata.remindersAt,updatedAt:new Date().toISOString()};if(existing)Object.assign(existing,entry);else q.unshift(entry);s.artistSetup={...(s.artistSetup||{}),firstUpload:true,library:true,account:!!conn?.connected};});
    activeTrack='';ctx._uploadQueueEdit='';ctx.notice('Upload draft saved locally. Nothing was sent to SoundCloud.');
  }
  async function startUpload(ctx,id,data,queueId='') {
    if(busy)throw Error('An upload is already in progress.');
    const pending=pendingJob(id);if(pending)throw Error(pending.message||'Review the previous upload attempt before trying this track again.');
    if(!ctx.getConnection()?.connected)throw Error('Connect your SoundCloud account before uploading.');
    const metadata={title:data.title.trim(),artist:data.artist.trim(),genre:data.genre.trim(),description:data.description.trim(),sharing:data.sharing==='public'?'public':'private',releaseId:data.releaseId||''};
    if(!metadata.title)throw Error('Enter a track title before uploading.');
    if(metadata.sharing==='public'&&data.confirmPublic!=='yes')throw Error('Confirm that you want this track to be public before uploading.');
    busy=true;
    const status=document.querySelector('#upload-status'),title=document.querySelector('#upload-title'),percent=document.querySelector('#upload-percent'),progress=document.querySelector('#upload-progress');
    if(status){status.hidden=false;title.textContent=`Uploading ${metadata.title}`;percent.textContent='Connecting…';progress.value=0;}
    try {
      let result;
      try { result=await window.studio.upload(id,metadata); }
      catch(err) {
        await refreshUploadJobs(ctx,true);
        if(queueId)await persist(ctx,s=>{const q=arr(s,'artistUploadQueue').find(x=>x.id===queueId);if(q){q.status='retry';q.error=String(err.message||err).slice(0,300);}});
        ctx.notice(`Upload failed or was canceled. Your local audio and draft are preserved; review the details and retry when ready. ${String(err.message||err).slice(0,180)}`);
        throw err;
      }
      await refreshUploadJobs(ctx);
      let localUpdateError='';
      try {
        await persist(ctx,s=>{
          if(result?.state)Object.assign(s,result.state);
          const local=arr(s,'tracks').find(t=>t.id===id);
          if(local&&result?.track)local.lastUpload={id:result.track.id,sharing:result.track.sharing,state:result.track.state,at:new Date().toISOString(),url:result.track.url||''};
          s.artistSetup={...(s.artistSetup||{}),firstUpload:true,library:true,account:true};
          if(queueId)s.artistUploadQueue=arr(s,'artistUploadQueue').filter(q=>q.id!==queueId);
        });
      } catch(err) { localUpdateError=String(err.message||err).slice(0,180); }
      let journalWarning='';
      if(!localUpdateError&&result?.jobId&&!result?.journalWarning){try{await window.studio.acknowledgeUpload(result.jobId);}catch(err){journalWarning=String(err.message||err).slice(0,180);}}
      await refreshUploadJobs(ctx,true);
      activeTrack='';ctx._uploadQueueEdit='';
      if(localUpdateError)ctx.notice(`SoundCloud accepted this upload, but local track details could not be saved. Review its receipt before retrying. ${localUpdateError}`);
      else if(result?.localSaveError)ctx.notice('SoundCloud accepted the upload. The main workspace save failed, but this screen saved the receipt into the local workspace.');
      else if(result?.journalWarning||journalWarning)ctx.notice(`SoundCloud accepted the upload, but its recovery journal needs review. The receipt remains in Upload desk. ${result?.journalWarning||journalWarning}`);
      else ctx.notice('SoundCloud accepted the upload. Processing may take a few minutes.');
      return result;
    } finally {busy=false;if(status)status.hidden=true;}
  }
  async function handleAction(action,id,ctx) {
    const s=ctx.getState();
    if(action==='import-audio'){const r=await window.studio.importAudio();await ctx.update(x=>Object.assign(x,r.state));const legacyNote=r.legacyUnhashedTracks?` ${r.legacyUnhashedTracks} older track${r.legacyUnhashedTracks===1?' has':'s have'} no saved content hash, so their files were not checked for content duplicates.`:'';ctx.notice(r.count?`${r.count} track${r.count===1?'':'s'} imported. Exact-content duplicates were skipped.${legacyNote}`:`No new tracks imported.${legacyNote}`);return;}
    if(action==='connect')return ctx.openPage('soundcloud');
    if(action==='setup-import')return handleAction('import-audio',id,ctx);
    if(action==='setup-connect')return ctx.openPage('soundcloud');
    if(action==='setup-start'){const t=tracks(ctx)[0];if(t)return showPreflight(t.id,ctx);ctx.notice('Import a track first to begin the upload review.');return;}
    if(action==='new-draft'){const t=tracks(ctx)[0];if(t)return showPreflight(t.id,ctx);ctx.notice('Import an audio track before preparing an upload.');return;}
    if(action==='prepare-track')return showPreflight(id,ctx);
    if(action==='close-preflight'){activeTrack='';ctx._uploadQueueEdit='';return ctx.render();}
    if(action==='ack-upload-job'){const acknowledged=await window.studio.acknowledgeUpload(id);await refreshUploadJobs(ctx);ctx.render();return ctx.notice(acknowledged?'Upload attempt cleared from the review list.':'That upload attempt is no longer awaiting review.');}
    if(action==='edit-queued'){const q=arr(s,'artistUploadQueue').find(x=>x.id===id);if(q)return showPreflight(q.trackId,ctx,id);return;}
    if(action==='save-draft'){const form=document.querySelector('[data-u-form="draft"]');if(!form)return;const data=Object.fromEntries(new FormData(form));const dup=tracks(ctx).some(x=>x.id!==id&&normalize(x.title)===normalize(data.title));if(dup&&!confirm('A similar track title exists in your library. Save this draft anyway?'))return;return saveDraft(ctx,id,data,form.dataset.queue);}
    if(action==='save-queued'){const form=document.querySelector('[data-u-form="draft"]');if(!form)return;return saveDraft(ctx,form.dataset.track,Object.fromEntries(new FormData(form)),id);}
    if(action==='send-queued'){const q=arr(s,'artistUploadQueue').find(x=>x.id===id);if(!q)return;const t=tracks(ctx).find(x=>x.id===q.trackId);if(!t)return ctx.notice('The local audio file is no longer in the library. Reimport it and prepare a new draft.');if(q.metadata.sharing==='public'&&!confirm(`Upload “${q.metadata.title}” as PUBLIC? Anyone may find and listen to it once SoundCloud processes it.`))return;return startUpload(ctx,t.id,{...q.metadata,confirmPublic:q.metadata.sharing==='public'?'yes':''},id);}
    if(action==='remove-queued'){await persist(ctx,x=>x.artistUploadQueue=arr(x,'artistUploadQueue').filter(q=>q.id!==id));return ctx.notice('Draft removed. The source audio was not changed.');}
    if(action==='use-preset'){const p=arr(s,'artistUploadPresets').find(x=>x.id===id);if(p&&activeTrack){const f=document.querySelector('[data-u-form="draft"]');if(f){f.elements.artist.value=p.artist||'';f.elements.genre.value=p.genre||'';f.elements.sharing.value=p.sharing||'private';if(p.description)f.elements.description.value=p.description;}}return;}
    if(action==='delete-preset'){await persist(ctx,x=>x.artistUploadPresets=arr(x,'artistUploadPresets').filter(p=>p.id!==id));return;}
    if(action==='delete-template'){await persist(ctx,x=>x.artistMetadataTemplates=arr(x,'artistMetadataTemplates').filter(p=>p.id!==id));return;}
    if(action==='bulk-apply'){const ids=[...selected];if(!ids.length)return ctx.notice('Select one or more library tracks first.');const genre=document.querySelector('#u-bulk-genre')?.value.trim(),status=document.querySelector('#u-bulk-status')?.value,notes=document.querySelector('#u-bulk-notes')?.value;await persist(ctx,x=>{for(const t of x.tracks.filter(t=>ids.includes(t.id))){if(genre)t.genre=genre;if(status)t.status=status;if(notes?.trim())t.notes=notes.trim();}});ctx.notice(`Updated ${ids.length} selected track${ids.length===1?'':'s'}.`);return;}
    if(action==='library-page'){const delta=Number(id);return persist(ctx,x=>{const pages=Math.max(1,Math.ceil((x.tracks||[]).length/100));x.artistLibraryPage=Math.max(0,Math.min(pages-1,(x.artistLibraryPage||0)+delta));});}
  }
  function onSubmit(e,ctx){const form=e.target.closest('[data-u-form]');if(!form)return;e.preventDefault();e.stopPropagation();const kind=form.dataset.uForm;
    const data=Object.fromEntries(new FormData(form));
    (async()=>{try{if(kind==='preset'){if(!data.name.trim())return;await persist(ctx,s=>{s.artistUploadPresets=arr(s,'artistUploadPresets');s.artistUploadPresets.unshift({id:ctx.uid(),name:data.name.trim(),artist:data.artist.trim(),genre:data.genre.trim(),sharing:data.sharing==='public'?'public':'private',description:''});});ctx.notice('Upload preset saved.');}
      else if(kind==='template'){if(!data.name.trim())return;await persist(ctx,s=>{s.artistMetadataTemplates=arr(s,'artistMetadataTemplates');s.artistMetadataTemplates.unshift({id:ctx.uid(),name:data.name.trim(),description:data.description.trim()});});ctx.notice('Metadata template saved.');}
      else if(kind==='draft'){const id=form.dataset.track, qid=form.dataset.queue;if(data.templateId){const template=arr(ctx.getState(),'artistMetadataTemplates').find(t=>t.id===data.templateId);if(template)data.description=[data.description,template.description].filter(Boolean).join('\n\n');}const dup=tracks(ctx).some(x=>x.id!==id&&normalize(x.title)===normalize(data.title));if(dup&&!confirm('A similar track title exists in your library. Continue with this upload draft?'))return;
        if(e.submitter?.value==='upload'){if(data.sharing==='public'&&data.confirmPublic!=='yes')throw Error('Confirm public visibility before uploading.');if(!confirm(`Upload “${data.title}” to ${data.sharing==='public'?'SoundCloud as PUBLIC':'your connected SoundCloud account as PRIVATE'} now?`))return;await startUpload(ctx,id,data,qid);}
        else await saveDraft(ctx,id,data,qid);
      }
    }catch(err){ctx.notice(err.message||'Could not save the upload details.');}})();
  }
  function init(ctx){const link=document.createElement('link');link.rel='stylesheet';link.href='features/upload.css';document.head.appendChild(link);
    document.addEventListener('click',e=>{const b=e.target.closest('[data-u-action]');if(b){const act=b.dataset.uAction;if(act==='save-draft'||act==='save-queued')return; e.preventDefault();e.stopPropagation();handleAction(act,b.dataset.id,ctx).catch(err=>ctx.notice(err.message||'Action could not be completed.'));return;}const t=e.target.closest('[data-track-select]');if(t){t.checked?selected.add(t.dataset.trackSelect):selected.delete(t.dataset.trackSelect);}} ,true);
    document.addEventListener('change',e=>{if(e.target.id==='u-select-all'){selected=e.target.checked?new Set(tracks(ctx).map(t=>t.id)):new Set();ctx.render();}else if(e.target.dataset.trackSelect){e.target.checked?selected.add(e.target.dataset.trackSelect):selected.delete(e.target.dataset.trackSelect);} });
    document.addEventListener('submit',e=>onSubmit(e,ctx),true);
    document.addEventListener('click',e=>{if(e.target.matches('[data-u-action="save-draft"],[data-u-action="save-queued"]')){e.preventDefault();e.stopPropagation();const f=document.querySelector('[data-u-form="draft"]');if(f){const evt=new Event('submit',{bubbles:true,cancelable:true});Object.defineProperty(evt,'submitter',{value:e.target});f.dispatchEvent(evt);}}},true);
    document.addEventListener('change',e=>{if(e.target.id==='u-sort'){const sort=e.target.value;ctx.update(s=>s.artistLibrarySort=sort).then(()=>ctx.render());}});
    window.artistUploadGetSort=()=>ctx.getState().artistLibrarySort||'title';
    window.studio.onUpload(data=>{const p=document.querySelector('#upload-progress'),x=document.querySelector('#upload-percent');if(p)p.value=data.percent;if(x)x.textContent=data.percent===100?'Processing response…':`${data.percent}%`;});
    window.studio.uploadJobs().then(jobs=>{uploadJobs=Array.isArray(jobs)?jobs:[];ctx.render();}).catch(()=>{});
    if(!ctx.getState().artistSetup)ctx.update(s=>s.artistSetup={account:!!ctx.getConnection()?.connected,library:(s.tracks||[]).length>0,firstUpload:!!(s.tracks||[]).some(t=>t.lastUpload)}).catch(()=>{});
  }
  window.registerArtistPlugin({id:ID,pages:[{id:'upload-desk',title:'Upload desk',icon:'\uE898',render}],actions:{'upload-desk-action':handleAction},init,onRender(ctx){if(ctx.getPage()==='upload-desk'){const sel=document.querySelector('#u-sort');if(sel)sel.value=window.artistUploadGetSort?.()||'title';}}});
})();
