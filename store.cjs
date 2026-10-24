const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const workspaceByteLimit=128*1024*1024;
const blank = () => ({version:1, profile:{name:'Your studio', theme:'dark', genre:'', location:'', tagline:'', bio:'', soundcloudUrl:'', website:'', firstRunComplete:false}, tracks:[], releases:[], campaigns:[]});
function validate(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.version !== 1 || !s.profile || typeof s.profile !== 'object' || Array.isArray(s.profile) || !['tracks','releases','campaigns'].every(k => Array.isArray(s[k]))) throw Error('This is not a Soundcloud Desktop workspace backup.');
  if (typeof s.profile.name !== 'string' || s.profile.name.length > 256 || !['dark','light','system'].includes(s.profile.theme)) throw Error('Invalid workspace settings.');
  for (const key of ['genre','location','tagline','bio','soundcloudUrl','website']) if (s.profile[key] !== undefined && (typeof s.profile[key] !== 'string' || s.profile[key].length > 10000)) throw Error('Invalid workspace settings.');
  if (s.profile.firstRunComplete !== undefined && typeof s.profile.firstRunComplete !== 'boolean') throw Error('Invalid workspace settings.');
  for (const k of ['tracks','releases','campaigns']) {
    if (s[k].length > 10000) throw Error('Workspace is too large.');
    const ids = new Set();
    for (const row of s[k]) { if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id || row.id.length > 256 || ids.has(row.id) || typeof row.title !== 'string' || row.title.length > 1000) throw Error('Invalid workspace record.'); ids.add(row.id); }
  }
  for (const r of s.releases) if (!Array.isArray(r.checks) || r.checks.length > 1000 || !r.checks.every(c => c && typeof c === 'object' && !Array.isArray(c) && typeof c.label === 'string' && c.label.length <= 1000 && typeof c.done === 'boolean' && (c.owner === undefined || typeof c.owner === 'string') && (c.due === undefined || typeof c.due === 'string')) || typeof r.date !== 'string' || (r.type !== undefined && !['Single','EP','Album'].includes(r.type))) throw Error('Invalid release.');
  for (const t of s.tracks) if (typeof t.file !== 'string' || !['Draft','Mixing','Mastered','Released'].includes(t.status) || (t.size !== undefined && (!Number.isFinite(t.size) || t.size < 0)) || (t.format !== undefined && typeof t.format !== 'string')) throw Error('Invalid track.');
  for (const c of s.campaigns) if (!['Planned','In progress','Done'].includes(c.status) || typeof c.date !== 'string' || (c.channel !== undefined && typeof c.channel !== 'string') || (c.caption !== undefined && typeof c.caption !== 'string')) throw Error('Invalid campaign.');
  return s;
}
function serializeWorkspace(value){const bytes=Buffer.from(JSON.stringify(value),'utf8');if(bytes.length>workspaceByteLimit)throw Error('Workspace data exceeds the 128 MB safe storage limit. Remove old records or shorten large notes before saving.');return bytes;}
function createStore(dir) {
  fs.mkdirSync(dir,{recursive:true}); const file=path.join(dir,'workspace.json');
  const previousFile=`${file}.previous`;
  let state;
  let diskHash=null;
  let recoveredFromPrevious=false;
  let queuedWrites=0;
  const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
  const readCurrentBytes=()=>{try{return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const readPreviousBytes=()=>{const info=fs.lstatSync(previousFile);if(!info.isFile()||info.isSymbolicLink()||info.size>workspaceByteLimit)throw Error('Invalid previous workspace file.');return fs.readFileSync(previousFile);};
  const ensureWorkspaceUnchanged=bytes=>{
    const currentHash=bytes===null?null:hashBytes(bytes);
    if(currentHash!==diskHash)throw Error('The workspace file changed outside Soundcloud Desktop. Reopen the app before saving so the newer data is not overwritten.');
  };
  const preservePrevious=bytes=>{
    if(bytes===null||recoveredFromPrevious)return;
    const temp=`${previousFile}.${randomUUID()}.tmp`;
    let fd;
    try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,previousFile);}
    catch(error){if(fd!==undefined){try{fs.closeSync(fd);}catch{}}try{fs.rmSync(temp,{force:true});}catch{}throw error;}
  };
  const tempPattern = /^workspace\.json\.[0-9a-f-]{36}\.tmp$/i;
  const tempFiles = () => fs.readdirSync(dir).filter(name => tempPattern.test(name)).map(name => {
    const full = path.join(dir, name);
    try {
      const info = fs.lstatSync(full);
      return info.isFile() && !info.isSymbolicLink() ? { full, age: Date.now() - info.mtimeMs } : null;
    } catch { return null; }
  }).filter(Boolean);
  if (fs.existsSync(file)) {
    const primaryBytes=fs.readFileSync(file);
    diskHash=hashBytes(primaryBytes);
    try { state=validate(JSON.parse(primaryBytes.toString('utf8'))); }
    catch (primaryError) {
      try {
        const previousBytes=readPreviousBytes();
        state=validate(JSON.parse(previousBytes.toString('utf8')));
        recoveredFromPrevious=true;
      } catch { throw primaryError; }
    }
    if(!recoveredFromPrevious)for (const candidate of tempFiles()) {
      if (candidate.age < 24*60*60*1000) continue;
      try {
        validate(JSON.parse(fs.readFileSync(candidate.full,'utf8')));
        fs.rmSync(candidate.full,{force:true});
      } catch { try { fs.rmSync(candidate.full,{force:true}); } catch { /* Leave a locked scratch file for a later startup. */ } }
    }
  } else {
    try {
      state=validate(JSON.parse(readPreviousBytes().toString('utf8')));
      recoveredFromPrevious=true;
    } catch {
      const candidates=tempFiles();
      if (candidates.length===1 && candidates[0].age>=24*60*60*1000) {
        try {
          const candidateBytes=fs.readFileSync(candidates[0].full);
          state=validate(JSON.parse(candidateBytes.toString('utf8')));
          fs.linkSync(candidates[0].full,file);
          diskHash=hashBytes(candidateBytes);
          try { fs.rmSync(candidates[0].full,{force:true}); } catch { /* The valid workspace is also present at the primary path. */ }
        } catch { state=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):blank(); }
      } else state=blank();
    }
  }
  let pendingWrite=Promise.resolve();
  function persist(next){
    const bytes=serializeWorkspace(next);
    queuedWrites++;
    const task=pendingWrite.then(async()=>{
      const temp=`${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        const currentBytes=readCurrentBytes();ensureWorkspaceUnchanged(currentBytes);preservePrevious(currentBytes);
        handle=await fs.promises.open(temp,'wx');
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle=undefined;
        ensureWorkspaceUnchanged(readCurrentBytes());
        await fs.promises.rename(temp,file);
        state=next;
        diskHash=hashBytes(bytes);recoveredFromPrevious=false;
        return structuredClone(state);
      } catch(error) {
        if(handle) await handle.close().catch(()=>{});
        await fs.promises.rm(temp,{force:true}).catch(()=>{});
        throw error;
      }
    });
    pendingWrite=task.then(()=>{queuedWrites--;},()=>{queuedWrites--;});
    return task;
  }
  function write(value){if(queuedWrites)throw Error('A workspace update is already being saved.');const next=structuredClone(value);validate(next);const bytes=serializeWorkspace(next);const temp=`${file}.${randomUUID()}.tmp`;let fd;try{const currentBytes=readCurrentBytes();ensureWorkspaceUnchanged(currentBytes);preservePrevious(currentBytes);fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;ensureWorkspaceUnchanged(readCurrentBytes());fs.renameSync(temp,file);state=next;diskHash=hashBytes(bytes);recoveredFromPrevious=false;return structuredClone(state);}catch(error){if(fd!==undefined){try{fs.closeSync(fd);}catch{}}try{fs.rmSync(temp,{force:true});}catch{}throw error;}}
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
  function health(){
    let directoryReadable=false,directoryWritable=false,workspaceReadable=true,workspaceValid=true;
    try{fs.accessSync(dir,fs.constants.R_OK);directoryReadable=true;}catch{}
    try{fs.accessSync(dir,fs.constants.W_OK);directoryWritable=true;}catch{}
    try{const bytes=readCurrentBytes();if(bytes!==null){fs.accessSync(file,fs.constants.R_OK);validate(JSON.parse(bytes.toString('utf8')));if(hashBytes(bytes)!==diskHash)workspaceValid=false;}}catch{workspaceReadable=false;workspaceValid=false;}
    if(recoveredFromPrevious)workspaceValid=false;
    return {ok:directoryReadable&&directoryWritable&&workspaceReadable&&workspaceValid,checks:{dataDirectoryReadable:directoryReadable,dataDirectoryWritable:directoryWritable,workspaceReadable,workspaceValid}};
  }
  return {read:()=>structuredClone(state),write,writeAsync,writeRenderer,asset,health,flush:()=>pendingWrite,file};
}
module.exports={blank,validate,createStore,randomUUID};
