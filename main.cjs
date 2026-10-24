const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,protocol,net,Tray,Menu,nativeTheme}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL,fileURLToPath}=require('node:url');
const {isDeepStrictEqual}=require('node:util');
const os=require('node:os');
const {createStore,randomUUID}=require('./store.cjs');
const testDir=!app.isPackaged&&process.env.CLOUDROOM_TEST_DATA;
if(testDir) app.setPath('userData',testDir);
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setAppUserModelId('com.soundclouddesktop.artist');
if(app.isPackaged){for(const flag of ['remote-debugging-port','remote-debugging-pipe','inspect','inspect-brk'])app.commandLine.removeSwitch(flag);}
let win,store,tray,uploadController,account,uploadJournal; let quitting=false;
const diagnosticEvents=[];
const safeDiagnosticCodes=new Set(['SC_UPLOAD_UNCERTAIN','EACCES','EADDRINUSE','EAI_AGAIN','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','EIO','EINVAL','EISDIR','ENETUNREACH','ENOSPC','ENOENT','ENOTDIR','EPIPE','EPERM','ETIMEDOUT']);
const urls={home:'https://soundcloud.com',upload:'https://soundcloud.com/upload',insights:'https://soundcloud.com/you/insights',tracks:'https://soundcloud.com/you/tracks',api:'https://developers.soundcloud.com/docs/api/register-app'};
const audioExtensions=new Set(['.mp3','.wav','.flac','.ogg','.m4a','.aac','.aiff']);
function theme(value){ if(nativeTheme.themeSource!==value)nativeTheme.themeSource=value; const dark=nativeTheme.shouldUseDarkColors; win?.setTitleBarOverlay({color:dark?'#191a1d':'#f2f3f5',symbolColor:dark?'#f5f5f5':'#222222',height:44}); }
function createWindow(){
 win=new BrowserWindow({width:1380,height:920,minWidth:980,minHeight:700,title:'Soundcloud Desktop — Artist workspace',icon:path.join(__dirname,'assets/icon.ico'),backgroundColor:'#191a1d',...(Number(require('node:os').release().split('.')[2])>=22621?{backgroundMaterial:'mica'}:{}),titleBarStyle:'hidden',titleBarOverlay:{color:'#191a1d',symbolColor:'#ffffff',height:44},show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,devTools:!app.isPackaged}});
 win.removeMenu(); win.loadFile(path.join(__dirname,'ui/index.html')); win.once('ready-to-show',()=>{theme(store.read().profile.theme);win.show();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'})); win.webContents.on('will-navigate',e=>e.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win.webContents.on('render-process-gone',(_event,details)=>{const reason=['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure'].includes(details.reason)?details.reason:'unknown';if(reason!=='clean-exit')recordDiagnostic('renderer-crash','renderer process stopped',reason);if(win&&!quitting&&reason!=='clean-exit'){dialog.showMessageBox(win,{type:'error',message:'The workspace stopped responding.',detail:'Your saved library and release plans are preserved. Reload the workspace to continue.',buttons:['Reload workspace','Close app']}).then(({response})=>{if(response===0)win?.reload();else app.quit();});}});
 win.on('closed',()=>{win=null;});
 win.on('close',e=>{if(uploadController&&!quitting){e.preventDefault();win.hide();}});
}
const recordIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const ipcWindow=new Map();
const maxWorkspaceBytes=32*1024*1024;
function safeSoundCloudUrl(value){
 if(typeof value!=='string'||!value||value.length>2048)return '';
 try{const url=new URL(value);return url.protocol==='https:'&&['soundcloud.com','www.soundcloud.com'].includes(url.hostname.toLowerCase())&&!url.username&&!url.password&&!url.port?url.href:'';}catch{return '';}
}
function redactDiagnosticText(value){
 let text=String(value??'').slice(0,4000);
 text=text.replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~+/-]+=*/gi,'$1 [REDACTED]');
 text=text.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,'[TOKEN]');
 text=text.replace(/\b(client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|password|secret|token|code(?:[_-]?verifier)?|verifier|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,'$1=[REDACTED]');
 text=text.replace(/https?:\/\/[^\s"'<>]*/gi,'[URL]');
 text=text.replace(/(["'])(?:[A-Z]:\\|\\\\|\/(?:Users|home|private|tmp)\/)[^"'\r\n]*\1/g,'[LOCAL_PATH]');
 text=text.replace(/\b[A-Z]:\\[^\s"'<>]*/gi,'[LOCAL_PATH]');
 text=text.replace(/\\\\[^\s"'<>]+/g,'[LOCAL_PATH]');
 text=text.replace(/\/(?:Users|home|private|tmp)\/[^\s"'<>]*/g,'[LOCAL_PATH]');
 text=text.replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]');
 return text.slice(0,600);
}
function diagnosticCategory(message){
 const text=String(message||'').toLowerCase();
 if(/eacces|eperm|permission|access denied/.test(text))return 'permission';
 if(/timed? ?out|timeout|deadline/.test(text))return 'timeout';
 if(/429|rate limit|retry-after/.test(text))return 'rate-limit';
 if(/oauth|authorization|credential|token|account/.test(text))return 'account';
 if(/invalid|unsupported|too large|validation/.test(text))return 'validation';
 return 'operation';
}
function diagnosticCode(value){const code=String(value||'');return safeDiagnosticCodes.has(code)?code:'';}
function recordDiagnostic(channel,message,code){
 const safeChannel=/^[a-z0-9:-]{1,64}$/i.test(String(channel||''))?String(channel):'app';
 const safeCode=diagnosticCode(code);
 diagnosticEvents.unshift({at:new Date().toISOString(),channel:safeChannel,category:diagnosticCategory(message),...(safeCode?{code:safeCode}:{})});
 if(diagnosticEvents.length>50)diagnosticEvents.length=50;
}
const stringArg=(label,max,{min=0,pattern,values}={})=>value=>{
 if(typeof value!=='string'||value.length<min||value.length>max||value.includes('\0'))throw Error(`Invalid ${label}.`);
 if(pattern&&!pattern.test(value))throw Error(`Invalid ${label}.`);
 if(values&&!values.includes(value))throw Error(`Invalid ${label}.`);
};
const idArg=label=>stringArg(label,128,{min:1,pattern:recordIdPattern});
const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function workspaceArg(value){
 if(!plainObject(value)||value.version!==1||!plainObject(value.profile)||!Array.isArray(value.tracks)||!Array.isArray(value.releases)||!Array.isArray(value.campaigns)||['tracks','releases','campaigns'].some(key=>value[key].length>10000))throw Error('Invalid workspace data.');
 let bytes;try{bytes=Buffer.byteLength(JSON.stringify(value),'utf8');}catch{throw Error('Workspace data could not be read.');}
 if(bytes>maxWorkspaceBytes)throw Error('Workspace data is too large to save in one request.');
}
function uploadMetadataArg(value){
 if(!plainObject(value))throw Error('Invalid upload details.');
 const allowed=new Set(['title','sharing','artist','genre','description','releaseId']);
 if(Object.keys(value).some(key=>!allowed.has(key)))throw Error('Invalid upload details.');
 stringArg('upload title',180,{min:1})(value.title);
 stringArg('upload visibility',8,{min:1,values:['public','private']})(value.sharing);
 stringArg('artist name',1000)(value.artist);
 stringArg('genre',1000)(value.genre);
 stringArg('upload description',10000)(value.description);
 if(value.releaseId!==undefined)stringArg('release ID',128,{pattern:/^(?:[A-Za-z0-9_-]{0,128})$/})(value.releaseId);
}
const ipcContracts={
 'account:status':{args:[],limit:120,window:10000},
 'account:credentials':{args:[stringArg('client ID',4096,{min:1}),stringArg('client secret',4096,{min:1})],limit:5,window:60000},
 'account:authorize':{args:[],limit:3,window:60000},
 'account:sync':{args:[],limit:4,window:60000},
 'account:disconnect':{args:[],limit:10,window:60000},
 'account:add':{args:[stringArg('account label',80)],limit:10,window:60000},
 'account:switchTo':{args:[idArg('account ID')],limit:30,window:10000},
 'account:remove':{args:[idArg('account ID')],limit:10,window:60000},
 'audio:cancel-upload':{args:[],limit:20,window:10000},
 'audio:upload':{args:[idArg('track ID'),uploadMetadataArg],limit:120,window:60000},
 'audio:upload-jobs':{args:[],limit:30,window:10000},
 'audio:upload-acknowledge':{args:[idArg('upload job ID')],limit:30,window:10000},
 'backend:health':{args:[],limit:30,window:10000},
 'diagnostics:export':{args:[],limit:4,window:60000},
 'workspace:read':{args:[],limit:120,window:10000},
 'workspace:save':{args:[workspaceArg],limit:30,window:10000},
 'audio:import':{args:[],limit:10,window:10000},
 'audio:drop':{args:[value=>{
  if(!Array.isArray(value)||value.length>500)throw Error('Choose no more than 500 audio files at once.');
  let total=0;for(const file of value){stringArg('audio file path',32768,{min:1})(file);total+=Buffer.byteLength(file,'utf8');}
  if(total>4*1024*1024)throw Error('The selected file list is too large.');
 }],limit:10,window:10000},
 'audio:reveal':{args:[idArg('track ID')],limit:30,window:10000},
 'audio:artwork':{args:[idArg('track ID')],limit:12,window:60000},
 'artwork:pick':{args:[idArg('release ID')],limit:12,window:60000},
 'workspace:backup':{args:[],limit:4,window:60000},
 'workspace:restore':{args:[],limit:4,window:60000},
 'clipboard:copy':{args:[stringArg('clipboard text',100000)],limit:30,window:10000},
 'soundcloud:open':{args:[stringArg('SoundCloud destination',32,{min:1,values:['home','upload','insights','tracks','api']})],limit:20,window:10000},
 'soundcloud:open-track':{args:[stringArg('SoundCloud track link',2048,{min:1})],limit:20,window:10000},
 'theme:set':{args:[stringArg('theme',8,{min:1,values:['dark','light','system']})],limit:20,window:10000},
 'window:tray':{args:[],limit:20,window:10000}
};
function validateIpcRequest(channel,args){
 const contract=ipcContracts[channel];
 if(!contract)throw Error('This workspace action is unavailable.');
 if(args.length!==contract.args.length)throw Error('Invalid request data.');
 for(let index=0;index<contract.args.length;index++)contract.args[index](args[index]);
 const now=Date.now(), prior=ipcWindow.get(channel)||[];
 const recent=prior.filter(time=>now-time<contract.window);
 if(recent.length>=contract.limit)throw Error('This action was requested too often. Wait a moment and try again.');
 recent.push(now);ipcWindow.set(channel,recent);
}
function isTrustedDocument(frame){
 if(!frame||!frame.url)return false;
 try{
  const actual=new URL(frame.url),expected=pathToFileURL(path.join(__dirname,'ui/index.html'));
  if(actual.protocol!=='file:'||actual.search||actual.hash)return false;
  const actualPath=path.resolve(fileURLToPath(actual)),expectedPath=path.resolve(fileURLToPath(expected));
  return process.platform==='win32'?actualPath.toLowerCase()===expectedPath.toLowerCase():actualPath===expectedPath;
 }catch{return false;}
}
function handler(channel,fn){
 if(!ipcContracts[channel])throw Error(`Missing IPC contract for ${channel}.`);
 ipcMain.handle(channel,async(event,...args)=>{
  const contents=win?.webContents;
  if(!contents||event.sender!==contents||event.senderFrame!==contents.mainFrame||!isTrustedDocument(event.senderFrame))throw Error('Untrusted caller');
  try{validateIpcRequest(channel,args);return await fn(...args);}
  catch(error){
   const message=redactDiagnosticText(error?.message||error)||'The request could not be completed.';
   const code=diagnosticCode(error?.code);recordDiagnostic(channel,message,code);
   const safeError=new Error(message);if(code)safeError.code=code;
   throw safeError;
  }
 });
}
function projectHealth(raw,keys,includeAccountCount=false){
 if(!plainObject(raw)||!plainObject(raw.checks))return {available:false,ok:false,checks:{}};
 const checks={};for(const key of keys){const value=raw.checks[key];if(typeof value==='boolean')checks[key]=value;else if(typeof value==='number'&&Number.isFinite(value))checks[key]=key.endsWith('CooldownMs')?Math.max(0,Math.min(value,86400000)):value;}
 return {available:true,ok:raw.ok===true,checks,...(includeAccountCount&&Number.isSafeInteger(raw.accountCount)?{accountCount:Math.max(0,raw.accountCount)}:{})};
}
function projectSyncCheckpoint(raw){
 if(!plainObject(raw))return undefined;
 const checkpoint={};
 if(['running','completed','interrupted'].includes(raw.status))checkpoint.status=raw.status;
 for(const key of ['pageCount','trackCount'])if(Number.isSafeInteger(raw[key])&&raw[key]>=0&&raw[key]<=10000000)checkpoint[key]=raw[key];
 for(const key of ['startedAt','lastUpdated'])if(typeof raw[key]==='string'&&raw[key].length<=40&&Number.isFinite(Date.parse(raw[key])))checkpoint[key]=new Date(raw[key]).toISOString();
 if(typeof raw.errorCode==='string'&&/^[a-z0-9_-]{1,64}$/i.test(raw.errorCode))checkpoint.errorCode=raw.errorCode;
 return Object.keys(checkpoint).length?checkpoint:undefined;
}
async function collectBackendHealth(){
 const storage=async()=>{
  if(typeof store?.health!=='function')return {available:false,ok:false,checks:{}};
  try{return projectHealth(await store.health(),['dataDirectoryReadable','dataDirectoryWritable','workspaceReadable','workspaceValid']);}
  catch(error){const text=redactDiagnosticText(error?.message||error);recordDiagnostic('workspace-health',text);return {available:true,ok:false,checks:{},errorCategory:diagnosticCategory(text)};}
 };
 const soundcloud=async()=>{
  if(typeof account?.health!=='function')return {available:false,ok:false,checks:{}};
  try{
   const [health,status]=await Promise.all([account.health(),typeof account.status==='function'?Promise.resolve().then(()=>account.status()).catch(()=>null):null]);
   const projected=projectHealth(health,['osEncryptionAvailable','credentialVaultReadable','credentialVaultWritable','activeAccountConfigured','activeAccountConnected','accountCooldownMs','apiCircuitCooldownMs'],true);
   const syncCheckpoint=projectSyncCheckpoint(status?.syncCheckpoint);
   return syncCheckpoint?{...projected,syncCheckpoint}:projected;
  }
  catch(error){const text=redactDiagnosticText(error?.message||error);recordDiagnostic('connection-health',text);return {available:true,ok:false,checks:{},errorCategory:diagnosticCategory(text)};}
 };
 const [workspace,connection]=await Promise.all([storage(),soundcloud()]);
 return {generatedAt:new Date().toISOString(),workspace,connection};
}
async function addAudio(paths){
 const s=store.read(),seen=new Set(s.tracks.map(track=>track.file));let count=0;
 if(!Array.isArray(paths))return {state:s,count};
 for(const file of paths){
  if(typeof file!=='string'||seen.has(file))continue;
  const originalExt=path.extname(file),ext=originalExt.toLowerCase();if(!audioExtensions.has(ext))continue;
  let stat;try{stat=await fs.promises.stat(file);}catch{continue;}
  if(!stat.isFile())continue;
  seen.add(file);
  s.tracks.unshift({id:randomUUID(),title:path.basename(file,originalExt),file,format:ext.slice(1).toUpperCase(),size:stat.size,status:'Draft',genre:'',notes:'',credits:'',link:'',added:new Date().toISOString()});count++;
 }
 const saved=await store.writeAsync(s);return {state:saved,count};
}
async function saveArtwork(file){
 const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('Choose artwork smaller than 10 MB.');
 const dir=path.join(app.getPath('userData'),'artwork');await fs.promises.mkdir(dir,{recursive:true});
 const dest=path.join(dir,randomUUID()+path.extname(file));await fs.promises.copyFile(file,dest);return dest;
}
function restorePreview(current,incoming){
 const lines=[];
 for(const [label,key] of [['Tracks','tracks'],['Releases','releases'],['Campaigns','campaigns']]){
  const before=new Map(current[key].map(row=>[row.id,row])),after=new Map(incoming[key].map(row=>[row.id,row]));let added=0,changed=0,removed=0;
  for(const [id,row] of after){if(!before.has(id))added++;else if(!isDeepStrictEqual(before.get(id),row))changed++;}
  for(const id of before.keys())if(!after.has(id))removed++;
  lines.push(`${label}: ${added} added, ${changed} changed, ${removed} removed`);
 }
 lines.push(`Artist profile: ${isDeepStrictEqual(current.profile,incoming.profile)?'unchanged':'will be replaced'}`);
 return lines.join('\n');
}
async function readWorkspaceBackup(file){
 const maxBytes=32*1024*1024,stat=await fs.promises.stat(file);
 if(!stat.isFile())throw Error('Choose a workspace backup file.');
 if(stat.size>maxBytes)throw Error('Workspace backups must be 32 MB or smaller.');
 const chunks=[];let total=0;
 for await(const chunk of fs.createReadStream(file,{start:0,end:maxBytes})) { total+=chunk.length;if(total>maxBytes)throw Error('Workspace backups must be 32 MB or smaller.');chunks.push(chunk); }
 return Buffer.concat(chunks,total).toString('utf8');
}
function createUploadJournal(dir){
 const file=path.join(dir,'upload-jobs.json');let jobs=[];
 if(fs.existsSync(file)){
  let saved;try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024*1024)throw Error();saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Saved upload history could not be read. The file was left untouched, and uploads are paused until the history can be recovered.');}
  const statuses=['uploading','outcome-unknown','accepted','failed','acknowledged'];
  if(saved?.version!==1||!Array.isArray(saved.jobs)||saved.jobs.length>500||saved.jobs.some(job=>!plainObject(job)||typeof job.id!=='string'||!recordIdPattern.test(job.id)||typeof job.trackId!=='string'||!recordIdPattern.test(job.trackId)||typeof job.title!=='string'||job.title.length>180||!statuses.includes(job.status)||!Number.isFinite(job.progress)||job.progress<0||job.progress>100||typeof job.startedAt!=='string'||typeof job.updatedAt!=='string'||typeof job.message!=='string'||job.message.length>240||(job.remoteId!==undefined&&(typeof job.remoteId!=='string'||job.remoteId.length>128))||(job.remoteUrl!==undefined&&(typeof job.remoteUrl!=='string'||job.remoteUrl.length>2048||(job.remoteUrl!==''&&!safeSoundCloudUrl(job.remoteUrl))))))throw Error('Saved upload history has an unsupported format. The file was left untouched, and uploads are paused until the history can be recovered.');
  jobs=saved.jobs;
 }
 function write(){
  const temp=`${file}.${randomUUID()}.tmp`;
  try{fs.writeFileSync(temp,JSON.stringify({version:1,jobs}),{flag:'wx',mode:0o600});fs.renameSync(temp,file);}
  catch(error){try{fs.rmSync(temp,{force:true});}catch{}throw Error(`Upload history could not be saved: ${error.message}`);}
 }
 let interrupted=false;
 for(const job of jobs)if(job.status==='uploading'){job.status='outcome-unknown';job.progress=job.progress||0;job.updatedAt=new Date().toISOString();job.message='The app closed before it recorded an outcome. Check SoundCloud before retrying.';interrupted=true;}
 if(interrupted)write();
 function trim(){
  const active=jobs.filter(job=>job.status==='uploading'||job.status==='outcome-unknown'||job.status==='accepted');
  const history=jobs.filter(job=>job.status!=='uploading'&&job.status!=='outcome-unknown'&&job.status!=='accepted').slice(0,100);
  jobs=[...active,...history];
 }
 function get(id){return jobs.find(job=>job.id===id);}
 return {
  begin({trackId,title,accountId,accountLabel}){
   if(jobs.filter(job=>job.status==='outcome-unknown'||job.status==='accepted').length>=250)throw Error('Review or acknowledge saved upload receipts before starting another upload.');
   if(jobs.some(job=>job.status==='uploading'&&job.trackId===trackId&&job.accountId===String(accountId||'')))throw Error('This track already has an active upload attempt.');
   if(jobs.some(job=>job.status==='outcome-unknown'&&job.trackId===trackId&&job.accountId===String(accountId||'')))throw Error('A previous upload attempt for this track has an unknown outcome. Check SoundCloud and acknowledge that attempt before retrying.');
   if(jobs.some(job=>job.status==='accepted'&&job.trackId===trackId&&job.accountId===String(accountId||'')))throw Error('A previous upload was accepted. Save or review its receipt before starting another attempt.');
   const now=new Date().toISOString(),job={id:randomUUID(),trackId,title:String(title).slice(0,180),accountId:String(accountId||'').slice(0,128),accountLabel:String(accountLabel||'').slice(0,80),status:'uploading',progress:0,startedAt:now,updatedAt:now,message:''};
   jobs.unshift(job);trim();try{write();}catch(error){jobs=jobs.filter(item=>item.id!==job.id);throw error;}return job.id;
  },
  progress(id,value){const job=get(id);if(!job||job.status!=='uploading')return;const percent=Math.max(0,Math.min(100,Math.floor(Number(value)||0)));if(percent-job.progress<5&&percent!==100)return;job.progress=percent;job.updatedAt=new Date().toISOString();write();},
  accepted(id,remote){const job=get(id);if(!job||job.status!=='uploading')return null;job.status='accepted';job.progress=100;job.remoteId=String(remote.urn||remote.id||'').slice(0,128);job.remoteUrl=safeSoundCloudUrl(remote.permalink_url);job.updatedAt=new Date().toISOString();job.message='SoundCloud accepted this upload. Save the receipt locally before trying this track again.';try{write();return null;}catch(error){return redactDiagnosticText(error.message);}},
  localSaveFailed(id,error){const job=get(id);if(!job||job.status!=='accepted')return null;job.message=`SoundCloud accepted this upload, but local workspace details could not be saved. Receipt: ${job.remoteId||'ID unavailable'}. ${redactDiagnosticText(error?.message||error||'').slice(0,120)}`.slice(0,240);job.updatedAt=new Date().toISOString();try{write();return null;}catch(writeError){return redactDiagnosticText(writeError.message);}},
  failed(id){const job=get(id);if(!job||job.status!=='uploading')return;job.status='failed';job.updatedAt=new Date().toISOString();job.message='The upload was rejected or failed before an uncertain result was reported. Review the error before retrying.';write();},
  uncertain(id){const job=get(id);if(!job||job.status!=='uploading')return;job.status='outcome-unknown';job.updatedAt=new Date().toISOString();job.message='SoundCloud may have received this upload. Check your SoundCloud catalog before retrying.';write();},
  acknowledge(id){const job=get(id);if(!job||!['outcome-unknown','accepted'].includes(job.status))return false;job.status='acknowledged';job.updatedAt=new Date().toISOString();job.message=job.remoteId?`Receipt reviewed: ${job.remoteId}`:'Upload outcome reviewed.';write();return true;},
  list(){return structuredClone(jobs.slice(0,351));}
 };
}
if(!app.requestSingleInstanceLock()) app.quit(); else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(()=>{
  try{store=createStore(app.getPath('userData'));}catch(e){const message=redactDiagnosticText(e?.message||e);recordDiagnostic('workspace-startup',message);dialog.showErrorBox('Workspace could not be opened',message+'\nYour existing data has been preserved.');app.quit();return;}
  try{uploadJournal=createUploadJournal(app.getPath('userData'));}catch(e){const message=redactDiagnosticText(e?.message||e);recordDiagnostic('upload-journal-startup',message);dialog.showErrorBox('Upload recovery history unavailable',message);}
  protocol.handle('studio',async request=>{
   let u;try{u=new URL(request.url);}catch{return new Response('File unavailable',{status:404});}
   if(request.method!=='GET'||u.protocol!=='studio:'||u.username||u.password||u.port||u.search||u.hash)return new Response('File unavailable',{status:404});
   const rawPath=u.pathname.slice(1);if(!rawPath||rawPath.length>192||rawPath.includes('/'))return new Response('File unavailable',{status:404});
   let id;try{id=decodeURIComponent(rawPath);}catch{return new Response('File unavailable',{status:404});}
   if(u.hostname==='preview'){
    if(!/^(?:\d{1,128}|soundcloud:tracks:\d{1,128})$/.test(id)||!account)return new Response('Preview unavailable',{status:404});
    try{return await account.preview(id,request.headers.get('range')||'');}
    catch{return new Response('SoundCloud preview unavailable',{status:502,headers:{'Cache-Control':'no-store'}});}
   }
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))return new Response('File unavailable',{status:404});
   const snapshot=store.read();let file='';
   if(u.hostname==='audio'){
    const track=snapshot.tracks.find(item=>item.id===id);
    if(track&&typeof track.file==='string'&&path.isAbsolute(track.file)&&audioExtensions.has(path.extname(track.file).toLowerCase()))file=track.file;
   }else if(u.hostname==='art'||u.hostname==='trackart'){
    const row=(u.hostname==='art'?snapshot.releases:snapshot.tracks).find(item=>item.id===id);
    const artworkRoot=path.join(app.getPath('userData'),'artwork');
    if(row&&typeof row.art==='string'&&['.png','.jpg','.jpeg','.webp'].includes(path.extname(row.art).toLowerCase())){
     try{
      const [root,target]=await Promise.all([fs.promises.realpath(artworkRoot),fs.promises.realpath(row.art)]);
      const relative=path.relative(root,target);
      if(relative&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative))file=target;
     }catch{}
    }
   }
   if(!file)return new Response('File unavailable',{status:404});
   try{if(!(await fs.promises.stat(file)).isFile())return new Response('File unavailable',{status:404});}catch{return new Response('File unavailable',{status:404});}
   const headers={};const range=request.headers.get('range');if(range&&range.length<=64&&/^bytes=\d*-\d*$/.test(range))headers.Range=range;
   try{return await net.fetch(pathToFileURL(file).toString(),{headers});}catch{return new Response('File unavailable',{status:404});}
  });
  createWindow();
  try{account=require('./connection.cjs').createConnection(app.getPath('userData'));}catch(e){const message=redactDiagnosticText(e?.message||e);recordDiagnostic('connection-startup',message);dialog.showErrorBox('SoundCloud connection',message);}
  handler('account:status',()=>account?account.status():{configured:false,connected:false});
  handler('backend:health',()=>collectBackendHealth());
  handler('diagnostics:export',async()=>{
   const result=await dialog.showSaveDialog(win,{title:'Export privacy-safe support bundle',defaultPath:`Soundcloud-Desktop-support-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Support bundle',extensions:['json']}]});
   if(result.canceled||!result.filePath)return {saved:false};
   const bundle={
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    app:{name:'Soundcloud Desktop',version:app.getVersion()},
    system:{platform:process.platform,release:os.release(),architecture:process.arch,electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node},
    backend:await collectBackendHealth(),
    recentEvents:diagnosticEvents.slice(0,50).map(({at,channel,category,code})=>({at,channel,category,...(code?{code}:{})})),
    privacy:{workspaceContentIncluded:false,credentialsIncluded:false,accountIdentifiersIncluded:false,localPathsIncluded:false,rawErrorMessagesIncluded:false}
   };
   const contents=JSON.stringify(bundle,null,2);if(Buffer.byteLength(contents,'utf8')>128*1024)throw Error('Support bundle exceeded its size limit.');
   await fs.promises.writeFile(result.filePath,contents,'utf8');recordDiagnostic('diagnostics:export','support bundle exported');return {saved:true};
  });
  for(const action of ['credentials','authorize','sync','disconnect','add','switchTo','remove'])handler('account:'+action,(...args)=>{
   if(!account)throw Error('Account storage is unavailable.');
   if(uploadController&&['add','switchTo','remove'].includes(action))throw Error('Finish the current upload before changing SoundCloud accounts.');
   return account[action](...args);
  });
  handler('audio:cancel-upload',()=>{uploadController?.abort();});
  handler('audio:upload-jobs',()=>uploadJournal?.list()||[]);
  handler('audio:upload-acknowledge',id=>uploadJournal?.acknowledge(id)||false);
  handler('audio:upload',async(id,meta)=>{
   if(uploadController)throw Error('An upload is already in progress.');if(!account?.status().connected)throw Error('Connect your SoundCloud account before uploading.');
   if(!uploadJournal)throw Error('Upload recovery history is unavailable. Resolve the saved history issue before uploading.');
   const s=store.read(),track=s.tracks.find(t=>t.id===id);if(!track)throw Error('Import the audio file first.');
   if(!meta||typeof meta.title!=='string'||!meta.title.trim()||meta.title.length>180||!['public','private'].includes(meta.sharing))throw Error('Add a title and choose private or public.');
   const fields={title:meta.title.trim(),sharing:meta.sharing};for(const k of ['artist','genre','description']){if(typeof meta[k]!=='string'||meta[k].length>10000)throw Error('Invalid upload details.');fields[k]=meta[k];}
   const artwork=meta.releaseId?s.releases.find(r=>r.id===meta.releaseId)?.art:track.art;
   const accountState=account.status(),accountInfo=accountState.accounts?.find(item=>item.id===accountState.activeAccountId);
   const jobId=uploadJournal.begin({trackId:id,title:fields.title,accountId:accountState.activeAccountId,accountLabel:accountInfo?.label});
   uploadController=new AbortController();let last=-1,serverAccepted=false,journalWarning='';
   try{
    const remote=await account.upload(track.file,fields,{artwork,signal:uploadController.signal,onProgress:percent=>{try{uploadJournal.progress(jobId,percent);}catch(error){journalWarning=journalWarning||redactDiagnosticText(error?.message||error).slice(0,180);}if(last!==percent){last=percent;win?.webContents.send('upload:progress',{id,percent,title:fields.title});}}});
    serverAccepted=true;
    journalWarning=journalWarning||uploadJournal.accepted(jobId,remote)||'';
    const remoteId=String(remote.urn||remote.id||'').slice(0,128),acceptedTrack={id:remoteId,title:remote.title||fields.title,sharing:remote.sharing||fields.sharing,state:remote.state||'processing',url:safeSoundCloudUrl(remote.permalink_url)};
    let saved=null,localSaveError='';
    try{
     const latest=store.read(),local=latest.tracks.find(t=>t.id===id);
     if(!local)throw Error('The track was removed from the local workspace before its receipt could be saved.');
     local.link=acceptedTrack.url;local.lastUpload={id:remoteId,sharing:acceptedTrack.sharing,state:acceptedTrack.state,at:new Date().toISOString(),url:acceptedTrack.url};
     saved=await store.writeAsync(latest);
    }catch(error){localSaveError=redactDiagnosticText(error?.message||error).slice(0,240);const journalError=uploadJournal.localSaveFailed(jobId,error);if(journalError)localSaveError=`${localSaveError}; upload receipt history also could not be saved.`.slice(0,240);}
    return {state:saved,track:acceptedTrack,jobId,localSaveError,journalWarning};
   }catch(error){
    if(!serverAccepted){try{if(error.code==='SC_UPLOAD_UNCERTAIN')uploadJournal.uncertain(jobId);else uploadJournal.failed(jobId);}catch{}}
    throw error;
   }finally{uploadController=null;}
  });
  tray=new Tray(path.join(__dirname,'assets/icon.ico'));tray.setToolTip('Soundcloud Desktop · Artist workspace');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Soundcloud Desktop',click:()=>{if(!win)createWindow();else win.show();}},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',()=>{if(!win)createWindow();else win.show();});
  handler('workspace:read',()=>store.read());
  handler('workspace:save',s=>{ // Renderer may edit metadata but cannot grant itself filesystem access.
   return store.writeRenderer(s);
  });
  handler('audio:import',async()=>{const r=await dialog.showOpenDialog(win,{title:'Add music to your library',properties:['openFile','multiSelections'],filters:[{name:'Audio',extensions:[...audioExtensions].map(x=>x.slice(1))}]});return addAudio(r.canceled?[]:r.filePaths);});
  handler('audio:drop',paths=>addAudio(paths));
  handler('audio:reveal',id=>{const t=store.read().tracks.find(t=>t.id===id);if(t && fs.existsSync(t.file))shell.showItemInFolder(t.file);else throw Error('The original file was moved or removed.');});
  handler('audio:artwork',async id=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Cover artwork',extensions:['png','jpg','jpeg']}]});if(r.canceled)return store.read();const s=store.read();const t=s.tracks.find(t=>t.id===id);if(!t)throw Error('Track not found.');t.art=await saveArtwork(r.filePaths[0]);return store.writeAsync(s);});
  handler('artwork:pick',async id=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Artwork',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return store.read();const s=store.read();const release=s.releases.find(r=>r.id===id);if(!release)throw Error('Release not found');release.art=await saveArtwork(r.filePaths[0]);return store.writeAsync(s);});
  handler('workspace:backup',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'Soundcloud Desktop-workspace.json',filters:[{name:'Workspace backup',extensions:['json']}]});if(!r.canceled){await store.flush();await fs.promises.writeFile(r.filePath,JSON.stringify(store.read(),null,2),'utf8');return true;}return false;});
  handler('workspace:restore',async()=>{
   const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Workspace backup',extensions:['json']}]});if(r.canceled)return null;
   const {validate}=require('./store.cjs'),next=validate(JSON.parse(await readWorkspaceBackup(r.filePaths[0]))),current=store.read();
   const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Restore workspace'],defaultId:0,cancelId:0,message:'Review workspace restore',detail:`Preview of changes if restored:\n${restorePreview(current,next)}\n\nThis replaces the current workspace. A copy will be saved first. Audio and artwork files are referenced, not included.`});
   if(answer.response!==1)return null;await store.flush();if(fs.existsSync(store.file))await fs.promises.copyFile(store.file,store.file+'.before-restore-'+Date.now()+'.json');return store.writeAsync(next);
  });
  handler('clipboard:copy',text=>{if(typeof text!=='string'||text.length>100000)throw Error('Invalid clipboard text');clipboard.writeText(text);return true;});
  handler('soundcloud:open',key=>{if(!urls[key])throw Error('Unknown destination');return shell.openExternal(urls[key]);});
  handler('soundcloud:open-track',value=>{
   if(typeof value!=='string'||value.length>2048)throw Error('Invalid SoundCloud track link.');
   let target;try{target=new URL(value);}catch{throw Error('Invalid SoundCloud track link.');}
   const host=target.hostname.toLowerCase();
   if(target.protocol!=='https:'||target.username||target.password||target.port||!['soundcloud.com','www.soundcloud.com','on.soundcloud.com','snd.sc'].includes(host))throw Error('Only SoundCloud track links can be opened here.');
   return shell.openExternal(target.toString());
  });
  handler('theme:set',value=>{if(!['dark','light','system'].includes(value))throw Error('Invalid theme');theme(value);});
  handler('window:tray',()=>win.hide());
  nativeTheme.on('updated',()=>{if(win)theme(nativeTheme.themeSource);});
 });
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',()=>{quitting=true;tray?.destroy();});
}
