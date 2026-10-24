const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const blank = () => ({version:1, profile:{name:'Your studio', theme:'dark', genre:'', location:'', tagline:'', bio:'', soundcloudUrl:'', website:'', firstRunComplete:false}, tracks:[], releases:[], campaigns:[]});
function validate(s) {
  if (!s || s.version !== 1 || !s.profile || !['tracks','releases','campaigns'].every(k => Array.isArray(s[k]))) throw Error('This is not a Soundcloud Desktop workspace backup.');
  if (typeof s.profile.name !== 'string' || !['dark','light','system'].includes(s.profile.theme)) throw Error('Invalid workspace settings.');
  for (const k of ['tracks','releases','campaigns']) {
    if (s[k].length > 10000) throw Error('Workspace is too large.');
    const ids = new Set();
    for (const row of s[k]) { if (!row || typeof row.id !== 'string' || ids.has(row.id) || typeof row.title !== 'string') throw Error('Invalid workspace record.'); ids.add(row.id); }
  }
  for (const r of s.releases) if (!Array.isArray(r.checks) || !r.checks.every(c => typeof c.label === 'string' && typeof c.done === 'boolean') || typeof r.date !== 'string') throw Error('Invalid release.');
  for (const t of s.tracks) if (typeof t.file !== 'string' || !['Draft','Mixing','Mastered','Released'].includes(t.status)) throw Error('Invalid track.');
  for (const c of s.campaigns) if (!['Planned','In progress','Done'].includes(c.status) || typeof c.date !== 'string') throw Error('Invalid campaign.');
  return s;
}
function createStore(dir) {
  fs.mkdirSync(dir,{recursive:true}); const file=path.join(dir,'workspace.json');
  let state;
  const tempPattern = /^workspace\.json\.[0-9a-f-]{36}\.tmp$/i;
  const tempFiles = () => fs.readdirSync(dir).filter(name => tempPattern.test(name)).map(name => {
    const full = path.join(dir, name);
    try {
      const info = fs.lstatSync(full);
      return info.isFile() && !info.isSymbolicLink() ? { full, age: Date.now() - info.mtimeMs } : null;
    } catch { return null; }
  }).filter(Boolean);
  if (fs.existsSync(file)) {
    state=validate(JSON.parse(fs.readFileSync(file,'utf8')));
    for (const candidate of tempFiles()) {
      if (candidate.age < 24*60*60*1000) continue;
      try {
        validate(JSON.parse(fs.readFileSync(candidate.full,'utf8')));
        fs.rmSync(candidate.full,{force:true});
      } catch { try { fs.rmSync(candidate.full,{force:true}); } catch { /* Leave a locked scratch file for a later startup. */ } }
    }
  } else {
    const candidates=tempFiles();
    if (candidates.length===1 && candidates[0].age>=24*60*60*1000) {
      try {
        state=validate(JSON.parse(fs.readFileSync(candidates[0].full,'utf8')));
        fs.linkSync(candidates[0].full,file);
        try { fs.rmSync(candidates[0].full,{force:true}); } catch { /* The valid workspace is also present at the primary path. */ }
      } catch { state=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):blank(); }
    } else state=blank();
  }
  let pendingWrite=Promise.resolve();
  function persist(next){
    const task=pendingWrite.then(async()=>{
      const temp=`${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle=await fs.promises.open(temp,'wx');
        await handle.writeFile(JSON.stringify(next),'utf8');
        await handle.sync();
        await handle.close();
        handle=undefined;
        await fs.promises.rename(temp,file);
        state=next;
        return structuredClone(state);
      } catch(error) {
        if(handle) await handle.close().catch(()=>{});
        await fs.promises.rm(temp,{force:true}).catch(()=>{});
        throw error;
      }
    });
    pendingWrite=task.then(()=>undefined,()=>undefined);
    return task;
  }
  function write(value){const next=structuredClone(value);validate(next);const temp=`${file}.${randomUUID()}.tmp`;let fd;try{fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,JSON.stringify(next),'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);state=next;return structuredClone(state);}catch(error){if(fd!==undefined){try{fs.closeSync(fd);}catch{}}try{fs.rmSync(temp,{force:true});}catch{}throw error;}}
  function writeAsync(value){const next=structuredClone(value);validate(next);return persist(next);}
  function writeRenderer(value){
    const next=structuredClone(value);validate(next);
    const tracks=new Map(state.tracks.map(track=>[track.id,track]));
    for(const track of next.tracks){const prior=tracks.get(track.id);if(!prior||track.file!==prior.file||track.art!==prior.art)throw Error('Import audio and artwork with the file picker.');}
    const releases=new Map(state.releases.map(release=>[release.id,release]));
    for(const release of next.releases)if(release.art&&release.art!==releases.get(release.id)?.art)throw Error('Choose artwork with the file picker.');
    return persist(next);
  }
  function asset(kind,id){
    const collection=kind==='audio'?'tracks':kind==='art'?'releases':kind==='trackart'?'tracks':null;
    const field=kind==='audio'?'file':'art';
    return collection?state[collection].find(row=>row.id===id)?.[field]:undefined;
  }
  return {read:()=>structuredClone(state),write,writeAsync,writeRenderer,asset,flush:()=>pendingWrite,file};
}
module.exports={blank,validate,createStore,randomUUID};
