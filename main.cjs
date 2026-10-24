const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,protocol,net,Tray,Menu,nativeTheme,Notification,safeStorage}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL,fileURLToPath}=require('node:url');
const {isDeepStrictEqual}=require('node:util');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createStore,randomUUID}=require('./store.cjs');
const testDir=!app.isPackaged&&process.env.CLOUDROOM_TEST_DATA;
if(testDir) app.setPath('userData',testDir);
else app.setPath('userData',path.join(app.getPath('appData'),'Soundcloud Desktop'));
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setAppUserModelId('com.soundclouddesktop.artist');
if(app.isPackaged){for(const flag of ['remote-debugging-port','remote-debugging-pipe','inspect','inspect-brk'])app.commandLine.removeSwitch(flag);}
let win,store,tray,uploadController,account,uploadJournal; let quitting=false;
let updateDownloadController=null,updateDownloadActive=false,updateInstallActive=false;
const updateRepo={owner:'ghostventure',name:'soundcloud-desktop'};
const updateVersionPattern=/^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const recoveryCandidateIdPattern=/^(?:previous|workspace-\d{13}-[a-f0-9]{64}\.json)$/i;
const updateMaxBytes=250*1024*1024;
const diagnosticEvents=[];
const safeDiagnosticCodes=new Set(['SC_UPLOAD_UNCERTAIN','EACCES','EADDRINUSE','EAI_AGAIN','ECONNRESET','ECONNREFUSED','EHOSTUNREACH','EIO','EINVAL','EISDIR','ENETUNREACH','ENOSPC','ENOENT','ENOTDIR','EPIPE','EPERM','ETIMEDOUT']);
const urls={home:'https://soundcloud.com',upload:'https://soundcloud.com/upload',insights:'https://soundcloud.com/you/insights',tracks:'https://soundcloud.com/you/tracks',api:'https://developers.soundcloud.com/docs/api/register-app'};
const audioExtensions=new Set(['.mp3','.wav','.flac','.ogg','.m4a','.aac','.aiff']);
const contentHashPattern=/^[a-f0-9]{64}$/i;
const workspaceBackupFormat='soundcloud-desktop-workspace-backup';
function theme(value){ if(nativeTheme.themeSource!==value)nativeTheme.themeSource=value; const dark=nativeTheme.shouldUseDarkColors; win?.setTitleBarOverlay({color:dark?'#191a1d':'#f2f3f5',symbolColor:dark?'#f5f5f5':'#222222',height:44}); }
function notifyHidden(kind){
 if((win&&!win.isDestroyed()&&win.isVisible())||!Notification.isSupported())return;
 const messages={
  'upload-complete':['Upload accepted','SoundCloud received your track. Processing may continue online.'],
  'upload-review':['Upload needs review','Open Upload desk to review its status before retrying.'],
  'sync-complete':['Catalog sync complete','Your saved SoundCloud catalog snapshot has been updated.'],
  'sync-failed':['Catalog sync did not finish','Your previous saved catalog snapshot is still available.']
 };
 const message=messages[kind];if(!message)return;
 try{const notification=new Notification({title:message[0],body:message[1]});notification.on('click',()=>{if(!win||win.isDestroyed())createWindow();else{win.show();win.focus();}});notification.show();}catch{}
}
function createWindow(){
 win=new BrowserWindow({width:1380,height:920,minWidth:980,minHeight:700,title:'SC-DS — Artist workspace',icon:path.join(__dirname,'assets/icon.ico'),backgroundColor:'#191a1d',...(Number(require('node:os').release().split('.')[2])>=22621?{backgroundMaterial:'mica'}:{}),titleBarStyle:'hidden',titleBarOverlay:{color:'#191a1d',symbolColor:'#ffffff',height:44},show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webviewTag:false,webSecurity:true,allowRunningInsecureContent:false,devTools:!app.isPackaged}});
 win.removeMenu(); win.loadFile(path.join(__dirname,'ui/index.html')); win.once('ready-to-show',()=>{theme(store.read().profile.theme);win.show();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',e=>e.preventDefault());
 win.webContents.on('will-redirect',e=>e.preventDefault());
 win.webContents.on('will-attach-webview',e=>e.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win.webContents.session.setPermissionCheckHandler(()=>false);
 win.webContents.session.on('will-download',(_event,item)=>item.cancel());
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
 'account:activity-feed':{args:[],limit:4,window:60000},
 'account:followings-tracks':{args:[],limit:4,window:60000},
 'account:comments':{args:[stringArg('SoundCloud track ID',160,{min:1,pattern:/^(?:soundcloud:tracks:\d{1,128}|[A-Za-z0-9_-]{1,128})$/})],limit:12,window:60000},
 'account:export-performance-digest':{args:[],limit:4,window:60000},
 'account:disconnect':{args:[],limit:10,window:60000},
 'account:add':{args:[stringArg('account label',80)],limit:10,window:60000},
 'account:switchTo':{args:[idArg('account ID')],limit:30,window:10000},
 'account:remove':{args:[idArg('account ID')],limit:10,window:60000},
 'audio:cancel-upload':{args:[],limit:20,window:10000},
 'audio:upload':{args:[idArg('track ID'),uploadMetadataArg],limit:120,window:60000},
 'audio:upload-jobs':{args:[],limit:30,window:10000},
 'audio:upload-acknowledge':{args:[idArg('upload job ID')],limit:30,window:10000},
 'backend:health':{args:[],limit:30,window:10000},
 'legal:open-notices':{args:[],limit:10,window:10000},
 'diagnostics:export':{args:[],limit:4,window:60000},
 'update:check':{args:[],limit:6,window:60000},
 'update:download':{args:[stringArg('update version',32,{min:5,pattern:updateVersionPattern})],limit:2,window:60000},
 'update:cancel':{args:[],limit:10,window:10000},
 'update:install':{args:[stringArg('update version',32,{min:5,pattern:updateVersionPattern})],limit:3,window:60000},
 'update:open-release':{args:[stringArg('update version',32,{min:5,pattern:updateVersionPattern})],limit:5,window:60000},
 'workspace:read':{args:[],limit:120,window:10000},
 'workspace:save':{args:[workspaceArg],limit:30,window:10000},
 'workspace:recovery-candidates':{args:[],limit:10,window:60000},
 'workspace:recovery-restore':{args:[stringArg('recovery candidate ID',100,{min:1,pattern:recoveryCandidateIdPattern})],limit:3,window:60000},
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
function parsedUpdateVersion(value){
 const match=typeof value==='string'?value.match(updateVersionPattern):null;
 return match?match.slice(1).map(Number):null;
}
function compareUpdateVersions(left,right){
 for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
 return 0;
}
function updateVersionText(parts){return parts.join('.');}
async function readLimitedBody(response,maxBytes){
 const lengthHeader=response.headers.get('content-length'),declared=lengthHeader===null?NaN:Number(lengthHeader);
 if(Number.isFinite(declared)&&declared>maxBytes)throw Error('GitHub returned an oversized update response.');
 if(!response.body)throw Error('GitHub returned an empty update response.');
 const chunks=[];let total=0;
 for await(const chunk of response.body){total+=chunk.length;if(total>maxBytes)throw Error('GitHub returned an oversized update response.');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks,total);
}
async function requestGitHubRelease(signal){
 let response;
 try{response=await fetch(`https://api.github.com/repos/${updateRepo.owner}/${updateRepo.name}/releases/latest`,{method:'GET',redirect:'error',signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SoundcloudDesktop-Updater'}});}
 catch(error){if(signal?.aborted)throw Error('GitHub update check timed out or was canceled.');throw Error('Could not reach GitHub to check for updates.');}
 if(response.status===403||response.status===429)throw Error('GitHub limited update requests. Try again later.');
 if(response.status===404)throw Error('No published GitHub release was found.');
 if(!response.ok)throw Error('GitHub could not provide update information.');
 let data;try{data=JSON.parse((await readLimitedBody(response,2*1024*1024)).toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw Error('GitHub returned invalid update information.');if(signal?.aborted)throw Error('GitHub update check timed out or was canceled.');throw error;}
 if(!plainObject(data)||!plainObject(data.author)||!Array.isArray(data.assets))throw Error('GitHub returned invalid update information.');
 return data;
}
function selectUpdateInstaller(release,releaseVersion){
 const matching=release.assets.filter(asset=>{
  if(!plainObject(asset)||asset.state!=='uploaded'||typeof asset.name!=='string')return false;
  const match=asset.name.match(/^SC-DS Installation Manager-Setup-((?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5}))\.exe$/i)
   ||asset.name.match(/^soundcloud[ .]desktop[ .-]+setup[ .-]+v?((?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5}))\.exe$/i);
  const version=match&&parsedUpdateVersion(match[1]);
  return !!version&&compareUpdateVersions(version,releaseVersion)===0;
 });
 if(matching.length!==1)throw Error('This GitHub release does not contain one unambiguous Windows installer.');
 const asset=matching[0];
 if(!Number.isSafeInteger(asset.size)||asset.size<1024*1024||asset.size>updateMaxBytes)throw Error('The Windows installer size is outside the allowed limit.');
 if(typeof asset.digest!=='string'||!/^sha256:[a-f0-9]{64}$/i.test(asset.digest))throw Error('This release does not provide the SHA-256 metadata required to verify its installer.');
 let download;try{download=new URL(asset.browser_download_url);}catch{throw Error('The Windows installer link is invalid.');}
 const expectedPath=`/${updateRepo.owner}/${updateRepo.name}/releases/download/${release.tag_name}/${asset.name}`;
 let decodedPath;try{decodedPath=decodeURIComponent(download.pathname);}catch{throw Error('The Windows installer link is invalid.');}
 if(download.protocol!=='https:'||download.hostname.toLowerCase()!=='github.com'||download.port||download.username||download.password||download.search||download.hash||decodedPath!==expectedPath)throw Error('The Windows installer link is outside the official GitHub release.');
 return {name:asset.name,size:asset.size,digest:asset.digest.slice(7).toLowerCase(),downloadUrl:download.href};
}
async function fetchVerifiedUpdate(expectedVersion,signal){
 const currentParts=parsedUpdateVersion(app.getVersion());
 if(!currentParts)throw Error('The installed app version cannot be compared safely.');
 const portable=!!process.env.PORTABLE_EXECUTABLE_DIR;
 if(process.platform!=='win32'||process.arch!=='x64')return {summary:{supported:false,currentVersion:app.getVersion(),available:false,reason:'Updates from this screen require 64-bit Windows.'},installer:null};
 let release;
 try{release=await requestGitHubRelease(signal||AbortSignal.timeout(20000));}
 catch(error){throw error;}
 const releaseParts=parsedUpdateVersion(release.tag_name);
 const expectedReleaseUrl=`https://github.com/${updateRepo.owner}/${updateRepo.name}/releases/tag/${release.tag_name}`;
 if(!releaseParts||release.draft!==false||release.prerelease!==false||String(release.author.login).toLowerCase()!==updateRepo.owner||release.html_url!==expectedReleaseUrl)throw Error('The latest GitHub release could not be verified.');
 const latestVersion=updateVersionText(releaseParts);
 if(expectedVersion&&latestVersion!==expectedVersion)throw Error('The available update changed. Check GitHub again before downloading.');
 const available=compareUpdateVersions(releaseParts,currentParts)>0;
 if(portable)return {summary:{supported:false,portable:true,currentVersion:app.getVersion(),latestVersion,available,releaseUrl:expectedReleaseUrl,reason:'Portable copies cannot be updated in place. Open the official release page to review and download the latest portable build.'},installer:null};
 if(!available)return {summary:{supported:true,currentVersion:app.getVersion(),latestVersion,available:false},installer:null};
 const installer=selectUpdateInstaller(release,releaseParts);
 const publishedAt=typeof release.published_at==='string'&&Number.isFinite(Date.parse(release.published_at))?new Date(release.published_at).toISOString():'';
 const releaseNotes=typeof release.body==='string'?release.body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,4000):'';
 return {summary:{supported:true,currentVersion:app.getVersion(),latestVersion,available:true,releaseUrl:expectedReleaseUrl,publishedAt,releaseNotes,installer:{name:installer.name,size:installer.size,digest:installer.digest}},installer};
}
async function checkGitHubUpdate(expectedVersion){return (await fetchVerifiedUpdate(expectedVersion)).summary;}
async function resolveStagingDirectory(){
 const base=await fs.promises.realpath(app.getPath('userData'));
 const directory=path.join(base,'updates');await fs.promises.mkdir(directory,{recursive:true});
 const real=await fs.promises.realpath(directory),relative=path.relative(base,real);
 if(process.platform==='win32'?relative.toLowerCase()!=='updates':relative!=='updates')throw Error('The update staging directory is not safe to use.');
 return real;
}
async function hashStagedInstaller(file,expectedSize){
 let stat;try{stat=await fs.promises.lstat(file);}catch{return null;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==expectedSize)return null;
 const hash=crypto.createHash('sha256');let total=0;
 try{for await(const chunk of fs.createReadStream(file)){total+=chunk.length;if(total>updateMaxBytes)return null;hash.update(chunk);}}catch{return null;}
 return total===expectedSize?hash.digest('hex'):null;
}
function verifyOptionalInstallerSignature(file){
 if(process.platform!=='win32')return Promise.reject(Error('Windows installer verification is required before opening updates.'));
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const command="$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:SC_DS_AUTHENTICODE_FILE; $subject=''; if($s.SignerCertificate){$subject=$s.SignerCertificate.Subject}; $result=[pscustomobject]@{status=[string]$s.Status;subject=[string]$subject}; [Console]::Out.Write((ConvertTo-Json -InputObject $result -Compress))";
 return new Promise((resolve,reject)=>{
  let child,output='',settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>{child?.kill();finish(Error('Windows installer verification timed out.'))},20000);
  try{child=spawn(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{shell:false,windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,SC_DS_AUTHENTICODE_FILE:file}});}catch{finish(Error('Windows installer verification is unavailable.'));return;}
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8192){child.kill();finish(Error('Windows returned an invalid installer-signature result.'));}});
  child.once('error',()=>finish(Error('Windows installer verification is unavailable.')));
  child.once('close',code=>{
   if(code!==0){finish(Error('Windows could not verify the installer.'));return;}
   try{
    const result=JSON.parse(output);
    if(result.status==='NotSigned'){finish();return;}
    const trustedName=typeof result.subject==='string'&&/(?:^|,\s*)(?:CN|O)=Black Lion Studios(?:\s*,|$)/i.test(result.subject);
    if(result.status!=='Valid'||!trustedName)throw Error();
    finish();
   }catch{finish(Error('The installer has an invalid signature or an untrusted publisher.'));}
  });
 });
}
function sendUpdateProgress(data){try{if(win&&!win.isDestroyed())win.webContents.send('update:progress',data);}catch{}}
async function fetchReleaseAsset(url,signal){
 const allowedHosts=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
 let target=new URL(url);
 for(let redirects=0;redirects<=3;redirects++){
  if(target.protocol!=='https:'||!allowedHosts.has(target.hostname.toLowerCase())||target.username||target.password||target.port)throw Error('The installer download left the approved GitHub hosts.');
  let response;try{response=await fetch(target,{method:'GET',redirect:'manual',signal,headers:{'User-Agent':'SoundcloudDesktop-Updater','Accept':'application/octet-stream'}});}catch(error){if(signal.aborted)throw error;throw Error('The installer could not be downloaded from GitHub.');}
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');try{await response.body?.cancel();}catch{}
   if(!location||redirects===3)throw Error('GitHub returned an invalid installer redirect.');
   try{target=new URL(location,target);}catch{throw Error('GitHub returned an invalid installer redirect.');}
   continue;
  }
  if(response.status===403||response.status===429)throw Error('GitHub limited installer downloads. Try again later.');
  if(!response.ok)throw Error('GitHub could not provide the installer.');
  return response;
 }
 throw Error('GitHub returned too many installer redirects.');
}
async function downloadGitHubUpdate(version){
 if(updateInstallActive)throw Error('The verified installer is being opened.');
 if(updateDownloadActive)throw Error('An update download is already in progress.');
 updateDownloadActive=true;const controller=new AbortController();updateDownloadController=controller;
 const timeout=setTimeout(()=>controller.abort('timeout'),10*60*1000);let handle=null,temp='',received=0;
 try{
  const verified=await fetchVerifiedUpdate(version,controller.signal),offer=verified.summary,installer=verified.installer;
  if(!installer||!offer.available||offer.latestVersion!==version)throw Error('No newer verified installed-build update is available.');
  if(controller.signal.aborted)throw Error('Update download canceled.');
  const directory=await resolveStagingDirectory(),target=path.join(directory,`SoundcloudDesktop-Setup-${version}.exe`);
  const existingHash=await hashStagedInstaller(target,installer.size);
  if(existingHash===installer.digest){await verifyOptionalInstallerSignature(target);return {downloaded:true,version,size:installer.size,digest:installer.digest,reused:true};}
  try{await fs.promises.unlink(target);}catch(error){if(error.code!=='ENOENT')throw Error('The previous staged installer could not be replaced.');}
  const response=await fetchReleaseAsset(installer.downloadUrl,controller.signal);
  const lengthHeader=response.headers.get('content-length'),declared=lengthHeader===null?NaN:Number(lengthHeader);
  if(Number.isFinite(declared)&&declared!==installer.size)throw Error('GitHub reported an unexpected installer size.');
  temp=path.join(directory,`SoundcloudDesktop-Setup-${version}.${randomUUID()}.part`);
  handle=await fs.promises.open(temp,'wx',0o600);
  const hash=crypto.createHash('sha256');
  sendUpdateProgress({version,phase:'downloading',received,total:installer.size});
  if(!response.body)throw Error('GitHub returned an empty installer.');
  for await(const chunk of response.body){
   if(controller.signal.aborted)throw Error('Update download canceled.');
   received+=chunk.length;if(received>installer.size||received>updateMaxBytes)throw Error('The downloaded installer exceeded its published size.');
   hash.update(chunk);let offset=0;while(offset<chunk.length){const result=await handle.write(chunk,offset,chunk.length-offset,null);if(!result.bytesWritten)throw Error('The installer could not be written to disk.');offset+=result.bytesWritten;}
   sendUpdateProgress({version,phase:'downloading',received,total:installer.size});
  }
  if(received!==installer.size)throw Error('The downloaded installer was incomplete.');
  sendUpdateProgress({version,phase:'verifying',received,total:installer.size});
  const actualDigest=hash.digest('hex');if(actualDigest!==installer.digest)throw Error('The installer SHA-256 did not match GitHub release metadata.');
  await handle.sync();await handle.close();handle=null;
  await verifyOptionalInstallerSignature(temp);
  await fs.promises.rename(temp,target);temp='';
  sendUpdateProgress({version,phase:'complete',received,total:installer.size});
  return {downloaded:true,version,size:installer.size,digest:installer.digest};
 }catch(error){
  if(controller.signal.reason==='user-cancel'){sendUpdateProgress({version,phase:'canceled',received,total:0});return {downloaded:false,canceled:true,version};}
  if(controller.signal.aborted)throw Error('The update download timed out. Try again on a stable connection.');
  throw error;
 }finally{
  clearTimeout(timeout);if(handle)try{await handle.close();}catch{}
  if(temp)try{await fs.promises.unlink(temp);}catch{}
  updateDownloadController=null;updateDownloadActive=false;
 }
}
async function installGitHubUpdate(version){
 if(updateInstallActive)throw Error('The verified installer is already being opened.');
 if(updateDownloadActive)throw Error('Wait for the update download to finish first.');
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('The verified installer handoff requires 64-bit Windows.');
 updateInstallActive=true;
 try{
 const verified=await fetchVerifiedUpdate(version),offer=verified.summary,installer=verified.installer;
 if(!installer||!offer.available||offer.latestVersion!==version)throw Error('No newer verified installed-build update is available. Check GitHub again.');
 const directory=await resolveStagingDirectory(),file=path.join(directory,`SoundcloudDesktop-Setup-${version}.exe`);
 if(await hashStagedInstaller(file,installer.size)!==installer.digest)throw Error('The staged installer is missing or failed its SHA-256 check. Download and verify it again.');
 await verifyOptionalInstallerSignature(file);
 const answer=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Open installer'],defaultId:0,cancelId:0,message:`Open the verified SC-DS ${version} installer?`,detail:'The setup program will open for you to review and run. No update is installed silently; close the setup window to cancel.'});
 if(answer.response!==1)return {started:false,canceled:true};
 if(await hashStagedInstaller(file,installer.size)!==installer.digest)throw Error('The staged installer changed after review. Download and verify it again.');
 await verifyOptionalInstallerSignature(file);
 await new Promise((resolve,reject)=>{
  let child;try{child=spawn(file,[],{shell:false,detached:true,stdio:'ignore',windowsHide:false});}catch{reject(Error('Windows could not start the verified installer.'));return;}
  child.once('error',()=>reject(Error('Windows could not start the verified installer.')));
  child.once('spawn',()=>{child.unref();resolve();});
 });
 app.quit();return {started:true,version};
 }finally{updateInstallActive=false;}
}
async function cleanupOldUpdateStaging(){
 let directory;try{directory=await resolveStagingDirectory();}catch{return;}
 let entries;try{entries=await fs.promises.readdir(directory,{withFileTypes:true});}catch{return;}
 const now=Date.now();
 for(const entry of entries){
  if(!entry.isFile()||entry.isSymbolicLink())continue;
  if(!/^SoundcloudDesktop-Setup-\d+\.\d+\.\d+(?:\.[0-9a-f-]{36})?\.(?:exe|part)$/i.test(entry.name))continue;
  const file=path.join(directory,entry.name);let stat;try{stat=await fs.promises.lstat(file);}catch{continue;}
  const maxAge=entry.name.endsWith('.part')?24*60*60*1000:30*24*60*60*1000;
  if(now-stat.mtimeMs>maxAge)try{await fs.promises.unlink(file);}catch{}
 }
}
async function collectBackendHealth(){
 const storage=async()=>{
  if(typeof store?.health!=='function')return {available:false,ok:false,checks:{}};
  try{return projectHealth(await store.health(),['dataDirectoryReadable','dataDirectoryWritable','workspaceReadable','workspaceValid','workspaceEncryptedAtRest']);}
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
 const s=store.read(),seenPaths=new Set(s.tracks.map(track=>track.file)),knownHashes=new Map();let count=0;
 for(const track of s.tracks){
  if(!contentHashPattern.test(track.contentHash||'')||!Number.isSafeInteger(track.contentHashSize)||track.contentHashSize<0)continue;
  const key=track.contentHashSize,rows=knownHashes.get(key)||[];rows.push(track);knownHashes.set(key,rows);
 }
 if(!Array.isArray(paths))return {state:s,count,legacyUnhashedTracks:s.tracks.filter(track=>!contentHashPattern.test(track.contentHash||'')).length};
 for(const file of paths){
  if(typeof file!=='string'||seenPaths.has(file))continue;
  const originalExt=path.extname(file),ext=originalExt.toLowerCase();if(!audioExtensions.has(ext))continue;
  let stat;try{stat=await fs.promises.stat(file);}catch{continue;}
  if(!stat.isFile())continue;
  const imported=await hashAudioFile(file,stat);
  if(!imported)throw Error('An audio file changed while it was being imported. Retry the import after the file finishes copying.');
  seenPaths.add(file);
  let duplicate=false;
  for(const prior of knownHashes.get(imported.size)||[]){
   if(String(prior.contentHash).toLowerCase()!==imported.sha256)continue;
   if(typeof prior.file==='string'){
    try{
     const current=await fs.promises.stat(prior.file);
     if(!current.isFile()||current.size!==prior.contentHashSize||current.mtimeMs!==prior.contentHashMtimeMs||current.ctimeMs!==prior.contentHashCtimeMs)continue;
    }catch(error){if(error.code!=='ENOENT')continue;}
   }
   duplicate=true;break;
  }
  if(duplicate)continue;
  const track={id:randomUUID(),title:path.basename(file,originalExt),file,format:ext.slice(1).toUpperCase(),size:imported.size,contentHash:imported.sha256,contentHashSize:imported.size,contentHashMtimeMs:imported.mtimeMs,contentHashCtimeMs:imported.ctimeMs,status:'Draft',genre:'',notes:'',credits:'',link:'',added:new Date().toISOString()};
  s.tracks.unshift(track);const rows=knownHashes.get(imported.size)||[];rows.push(track);knownHashes.set(imported.size,rows);count++;
 }
 const saved=count?await store.writeAsync(s):s;
 return {state:saved,count,legacyUnhashedTracks:saved.tracks.filter(track=>!contentHashPattern.test(track.contentHash||'')).length};
}
async function hashAudioFile(file,initialStat){
 const before=initialStat||await fs.promises.stat(file);
 if(!before.isFile()||!Number.isSafeInteger(before.size)||before.size<0)return null;
 const hash=crypto.createHash('sha256');
 for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 const after=await fs.promises.stat(file);
 if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)return null;
 return {sha256:hash.digest('hex'),size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs};
}
async function saveArtwork(file){
 const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>10*1024*1024)throw Error('Choose artwork smaller than 10 MB.');
 const dir=path.join(app.getPath('userData'),'artwork');await fs.promises.mkdir(dir,{recursive:true});
 const dest=path.join(dir,randomUUID()+path.extname(file));await fs.promises.copyFile(file,dest);return dest;
}
function getWorkspaceRecoveryCandidates(){
 if(!store||typeof store.recoveryCandidates!=='function')throw Error('Workspace recovery is not available in this build.');
 const candidates=store.recoveryCandidates();
 if(!Array.isArray(candidates)||candidates.length>100)throw Error('Workspace recovery returned an unsupported candidate list.');
 return candidates.map(candidate=>{
  if(!plainObject(candidate)||typeof candidate.id!=='string'||!recoveryCandidateIdPattern.test(candidate.id)||typeof candidate.capturedAt!=='string'||candidate.capturedAt.length>40||!Number.isFinite(Date.parse(candidate.capturedAt))||typeof candidate.profileName!=='string'||candidate.profileName.length>256||!['trackCount','releaseCount','campaignCount'].every(key=>Number.isSafeInteger(candidate[key])&&candidate[key]>=0&&candidate[key]<=10000))throw Error('Workspace recovery returned an invalid candidate.');
  const profileName=candidate.profileName.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,256)||'Unnamed profile';
  return {id:candidate.id,capturedAt:new Date(candidate.capturedAt).toISOString(),profileName,trackCount:candidate.trackCount,releaseCount:candidate.releaseCount,campaignCount:candidate.campaignCount};
 });
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
 const maxBytes=maxWorkspaceBytes,stat=await fs.promises.stat(file);
 if(!stat.isFile())throw Error('Choose a workspace backup file.');
 if(stat.size>maxBytes)throw Error('Workspace backups must be 32 MB or smaller.');
 const chunks=[];let total=0;
 for await(const chunk of fs.createReadStream(file,{start:0,end:maxBytes})) { total+=chunk.length;if(total>maxBytes)throw Error('Workspace backups must be 32 MB or smaller.');chunks.push(chunk); }
 let parsed;try{parsed=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}catch{throw Error('The selected workspace backup is not valid JSON.');}
 if(plainObject(parsed)&&parsed.format===workspaceBackupFormat){
  if(parsed.version!==1||!plainObject(parsed.workspace)||typeof parsed.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(parsed.sha256))throw Error('The workspace backup integrity envelope is invalid.');
  const expected=Buffer.from(parsed.sha256,'hex'),actual=crypto.createHash('sha256').update(JSON.stringify(parsed.workspace),'utf8').digest();
  if(!crypto.timingSafeEqual(expected,actual))throw Error('The workspace backup checksum does not match. The file may have changed or become corrupted.');
  return {workspace:parsed.workspace,checksumVerified:true};
 }
 return {workspace:parsed,checksumVerified:false};
}
function serializeWorkspaceBackup(workspace){
 const sha256=crypto.createHash('sha256').update(JSON.stringify(workspace),'utf8').digest('hex');
 const contents=JSON.stringify({format:workspaceBackupFormat,version:1,sha256,workspace},null,2);
 if(Buffer.byteLength(contents,'utf8')>maxWorkspaceBytes)throw Error('Workspace backups must be 32 MB or smaller.');
 return contents;
}
function createUploadJournal(dir,storage){
 const file=path.join(dir,'upload-jobs.json'),magic=Buffer.from('SC-DS-UPLOAD-DPAPI-V1\n','ascii');let jobs=[],needsProtection=false;
 if(typeof storage?.encrypt!=='function'||typeof storage?.decrypt!=='function')throw Error('Windows account encryption is unavailable for upload history.');
 if(fs.existsSync(file)){
  let saved;try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024+4096)throw Error();const bytes=fs.readFileSync(file),protectedFile=bytes.subarray(0,magic.length).equals(magic);needsProtection=!protectedFile;saved=JSON.parse(protectedFile?storage.decrypt(bytes.subarray(magic.length)):bytes.toString('utf8'));}catch{throw Error('Saved upload history could not be read. The file was left untouched, and uploads are paused until the history can be recovered.');}
  const statuses=['uploading','outcome-unknown','accepted','failed','acknowledged'];
  if(saved?.version!==1||!Array.isArray(saved.jobs)||saved.jobs.length>500||saved.jobs.some(job=>!plainObject(job)||typeof job.id!=='string'||!recordIdPattern.test(job.id)||typeof job.trackId!=='string'||!recordIdPattern.test(job.trackId)||typeof job.title!=='string'||job.title.length>180||!statuses.includes(job.status)||!Number.isFinite(job.progress)||job.progress<0||job.progress>100||typeof job.startedAt!=='string'||typeof job.updatedAt!=='string'||typeof job.message!=='string'||job.message.length>240||(job.remoteId!==undefined&&(typeof job.remoteId!=='string'||job.remoteId.length>128))||(job.remoteUrl!==undefined&&(typeof job.remoteUrl!=='string'||job.remoteUrl.length>2048||(job.remoteUrl!==''&&!safeSoundCloudUrl(job.remoteUrl))))))throw Error('Saved upload history has an unsupported format. The file was left untouched, and uploads are paused until the history can be recovered.');
  jobs=saved.jobs;
 }
 function write(){
  const temp=`${file}.${randomUUID()}.tmp`;
  try{const plain=JSON.stringify({version:1,jobs}),bytes=Buffer.concat([magic,Buffer.from(storage.encrypt(plain))]);if(bytes.length>1024*1024)throw Error('Upload history exceeded its safe size limit.');const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);needsProtection=false;}
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
 if(needsProtection)write();
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
  const localStorage={encrypt:value=>safeStorage.encryptString(value),decrypt:value=>safeStorage.decryptString(value)};
  try{if(!safeStorage.isEncryptionAvailable())throw Error('Windows account encryption is unavailable.');store=createStore(app.getPath('userData'),localStorage);}catch(e){const message=redactDiagnosticText(e?.message||e);recordDiagnostic('workspace-startup',message);dialog.showErrorBox('Workspace could not be opened',message+'\nYour existing data has been preserved.');app.quit();return;}
  void cleanupOldUpdateStaging();
  try{uploadJournal=createUploadJournal(app.getPath('userData'),localStorage);}catch(e){const message=redactDiagnosticText(e?.message||e);recordDiagnostic('upload-journal-startup',message);dialog.showErrorBox('Upload recovery history unavailable',message);}
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
  handler('account:activity-feed',()=>account?account.activityFeed():Promise.reject(Error('Connect your SoundCloud account first.')));
  handler('account:followings-tracks',()=>account?account.followedArtistsTracks():Promise.reject(Error('Connect your SoundCloud account first.')));
  handler('account:export-performance-digest',async()=>{
   if(!account)throw Error('SoundCloud account storage is unavailable.');
   const snapshot=account.status().snapshot;
   const history=Array.isArray(snapshot?.performanceHistory)?snapshot.performanceHistory:[];
   if(!history.length)throw Error('Sync your SoundCloud catalog at least once before exporting a performance digest.');
   const result=await dialog.showSaveDialog(win,{title:'Export recent SoundCloud performance digest',defaultPath:`SoundCloud-Performance-Digest-${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:'CSV digest',extensions:['csv']}]});
   if(result.canceled||!result.filePath)return {saved:false};
   const fields=['capturedAt','source','deltaMeaning','followersCount','followersDelta','trackCount','trackDelta','catalogPlayCount','catalogPlayDelta','catalogLikeCount','catalogLikeDelta'];
   const quote=value=>`"${String(value??'').replace(/"/g,'""')}"`;
   const rows=[fields.join(',')];
   for(let index=0;index<history.length;index++){
    const row=history[index],prior=history[index-1];
    rows.push([row.capturedAt,'SoundCloud API snapshot','Difference from immediately prior saved sync; not time-based analytics',row.followersCount,prior?row.followersCount-prior.followersCount:'',row.trackCount,prior?row.trackCount-prior.trackCount:'',row.catalogPlayCount,prior?row.catalogPlayCount-prior.catalogPlayCount:'',row.catalogLikeCount,prior?row.catalogLikeCount-prior.catalogLikeCount:''].map(quote).join(','));
   }
   const csv=`${rows.join('\r\n')}\r\n`;
   if(Buffer.byteLength(csv,'utf8')>256*1024)throw Error('Performance digest exceeded its safe export size.');
   await fs.promises.writeFile(result.filePath,csv,'utf8');
   return {saved:true,count:history.length};
  });
  handler('backend:health',()=>collectBackendHealth());
  handler('legal:open-notices',async()=>{
   const file=path.join(app.isPackaged?process.resourcesPath:path.join(__dirname,'docs'),'PRIVACY-AND-LICENSES.md');
   if(!fs.existsSync(file))throw Error('The privacy and third-party notices file is missing from this app package.');
   const openError=await shell.openPath(file);
   if(openError){
    if(process.platform!=='win32')throw Error('The privacy and third-party notices file could not be opened.');
    spawn('notepad.exe',[file],{detached:true,stdio:'ignore',windowsHide:true}).unref();
   }
   return true;
  });
  handler('update:check',()=>checkGitHubUpdate());
  handler('update:download',version=>downloadGitHubUpdate(version));
  handler('update:cancel',()=>{if(!updateDownloadController)return false;updateDownloadController.abort('user-cancel');return true;});
  handler('update:install',version=>installGitHubUpdate(version));
  handler('update:open-release',async version=>{
   if(process.platform!=='win32'||process.arch!=='x64'||!process.env.PORTABLE_EXECUTABLE_DIR)throw Error('The release-page shortcut is for portable Windows builds.');
   const {summary}=await fetchVerifiedUpdate(version);
   const requested=parsedUpdateVersion(version),requestedVersion=requested&&updateVersionText(requested),prefix=`/${updateRepo.owner}/${updateRepo.name}/releases/tag/`;
   let target;try{target=new URL(summary.releaseUrl);}catch{throw Error('The official release page could not be verified.');}
   const tag=target.pathname.startsWith(prefix)?target.pathname.slice(prefix.length):'',pageParts=parsedUpdateVersion(tag),pageVersion=pageParts&&updateVersionText(pageParts);
   if(!summary.portable||summary.latestVersion!==requestedVersion||pageVersion!==requestedVersion||target.protocol!=='https:'||target.hostname!=='github.com'||target.port||target.username||target.password||target.search||target.hash||target.href!==summary.releaseUrl)throw Error('The official release page could not be verified.');
   await shell.openExternal(target.href);return true;
  });
  handler('diagnostics:export',async()=>{
   const result=await dialog.showSaveDialog(win,{title:'Export privacy-safe support bundle',defaultPath:`Soundcloud-Desktop-support-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'Support bundle',extensions:['json']}]});
   if(result.canceled||!result.filePath)return {saved:false};
   const bundle={
    schemaVersion:1,
    generatedAt:new Date().toISOString(),
    app:{name:'SC-DS',version:app.getVersion()},
    system:{platform:process.platform,release:os.release(),architecture:process.arch,electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node},
    backend:await collectBackendHealth(),
    recentEvents:diagnosticEvents.slice(0,50).map(({at,channel,category,code})=>({at,channel,category,...(code?{code}:{})})),
    privacy:{workspaceContentIncluded:false,credentialsIncluded:false,accountIdentifiersIncluded:false,localPathsIncluded:false,rawErrorMessagesIncluded:false}
   };
   const contents=JSON.stringify(bundle,null,2);if(Buffer.byteLength(contents,'utf8')>128*1024)throw Error('Support bundle exceeded its size limit.');
   await fs.promises.writeFile(result.filePath,contents,'utf8');recordDiagnostic('diagnostics:export','support bundle exported');return {saved:true};
  });
  for(const action of ['credentials','authorize','sync','disconnect','add','switchTo','remove'])handler('account:'+action,async(...args)=>{
   if(!account)throw Error('Account storage is unavailable.');
   if(uploadController&&['add','switchTo','remove'].includes(action))throw Error('Finish the current upload before changing SoundCloud accounts.');
   try{const result=await account[action](...args);if(action==='sync')notifyHidden('sync-complete');return result;}
   catch(error){if(action==='sync')notifyHidden('sync-failed');throw error;}
  });
  handler('account:comments',trackId=>{
   if(!account?.status().connected)throw Error('Connect your SoundCloud account before reviewing comments.');
   return account.comments(trackId);
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
    notifyHidden('upload-complete');
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
    if(!serverAccepted)notifyHidden('upload-review');
    if(!serverAccepted){try{if(error.code==='SC_UPLOAD_UNCERTAIN')uploadJournal.uncertain(jobId);else uploadJournal.failed(jobId);}catch{}}
    throw error;
   }finally{uploadController=null;}
  });
  tray=new Tray(path.join(__dirname,'assets/icon.ico'));tray.setToolTip('SC-DS · Artist workspace');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open SC-DS',click:()=>{if(!win)createWindow();else win.show();}},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',()=>{if(!win)createWindow();else win.show();});
  handler('workspace:read',()=>store.read());
  handler('workspace:save',s=>{ // Renderer may edit metadata but cannot grant itself filesystem access.
   return store.writeRenderer(s);
  });
  handler('workspace:recovery-candidates',()=>getWorkspaceRecoveryCandidates());
  handler('workspace:recovery-restore',async id=>{
   if(typeof store.restoreRecovery!=='function')throw Error('Workspace recovery is not available in this build.');
   const candidate=getWorkspaceRecoveryCandidates().find(item=>item.id===id);
   if(!candidate)throw Error('That recovery point is no longer available. Review the list again.');
   const detail=`Captured: ${new Date(candidate.capturedAt).toLocaleString()}\nArtist profile: ${candidate.profileName}\nTracks: ${candidate.trackCount}\nReleases: ${candidate.releaseCount}\nCampaigns: ${candidate.campaignCount}\n\nThe current workspace will be copied before restoring. Audio and artwork files remain references and are not included in recovery points.`;
   const answer=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Restore recovery point'],defaultId:0,cancelId:0,message:'Review workspace recovery',detail});
   if(answer.response!==1)return null;
   await store.flush();
   if(!fs.existsSync(store.file))await store.writeAsync(store.read());
   const savedCopy=`${store.file}.before-recovery-${Date.now()}-${randomUUID()}.json`;
   await fs.promises.copyFile(store.file,savedCopy);
   return await store.restoreRecovery(id);
  });
  handler('audio:import',async()=>{const r=await dialog.showOpenDialog(win,{title:'Add music to your library',properties:['openFile','multiSelections'],filters:[{name:'Audio',extensions:[...audioExtensions].map(x=>x.slice(1))}]});return addAudio(r.canceled?[]:r.filePaths);});
  handler('audio:drop',paths=>addAudio(paths));
  handler('audio:reveal',id=>{const t=store.read().tracks.find(t=>t.id===id);if(t && fs.existsSync(t.file))shell.showItemInFolder(t.file);else throw Error('The original file was moved or removed.');});
  handler('audio:artwork',async id=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Cover artwork',extensions:['png','jpg','jpeg']}]});if(r.canceled)return store.read();const s=store.read();const t=s.tracks.find(t=>t.id===id);if(!t)throw Error('Track not found.');t.art=await saveArtwork(r.filePaths[0]);return store.writeAsync(s);});
  handler('artwork:pick',async id=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Artwork',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return store.read();const s=store.read();const release=s.releases.find(r=>r.id===id);if(!release)throw Error('Release not found');release.art=await saveArtwork(r.filePaths[0]);return store.writeAsync(s);});
  handler('workspace:backup',async()=>{const notice=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Choose backup location'],defaultId:0,cancelId:0,message:'Protect your workspace backup',detail:'The exported JSON backup is readable and is not encrypted by SC-DS. It includes profile details, workspace notes, local file paths, track titles, and upload receipts, but excludes SoundCloud login credentials and audio bytes. Save it only in a folder you control.'});if(notice.response!==1)return false;const r=await dialog.showSaveDialog(win,{defaultPath:'SC-DS-workspace-backup.json',filters:[{name:'Workspace backup',extensions:['json']}]});if(!r.canceled){await store.flush();await fs.promises.writeFile(r.filePath,serializeWorkspaceBackup(store.read()),'utf8');return true;}return false;});
  handler('workspace:restore',async()=>{
   const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Workspace backup',extensions:['json']}]});if(r.canceled)return null;
   const {validate}=require('./store.cjs'),backup=await readWorkspaceBackup(r.filePaths[0]),next=validate(backup.workspace),current=store.read();
   const integrityNote=backup.checksumVerified?'The SHA-256 checksum matches and can detect accidental changes. It does not prove who created the backup.':'This legacy raw JSON backup has no checksum; its workspace structure will still be validated.';
   const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Restore workspace'],defaultId:0,cancelId:0,message:'Review workspace restore',detail:`Preview of changes if restored:\n${restorePreview(current,next)}\n\n${integrityNote} This replaces the current workspace. A copy will be saved first. Audio and artwork files are referenced, not included.`});
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
