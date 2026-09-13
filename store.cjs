const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const blank = () => ({version:1, profile:{name:'Your studio', theme:'dark'}, tracks:[], releases:[], campaigns:[]});
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
  let state=fs.existsSync(file)?validate(JSON.parse(fs.readFileSync(file,'utf8'))):blank();
  return {read:()=>structuredClone(state), write(value){ validate(value); const temp=file+'.tmp'; fs.writeFileSync(temp,JSON.stringify(value,null,2)); fs.renameSync(temp,file); state=structuredClone(value); return this.read(); },file};
}
module.exports={blank,validate,createStore,randomUUID};
