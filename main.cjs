const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,protocol,net,Tray,Menu,nativeTheme}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL,fileURLToPath}=require('node:url');
const {createStore,randomUUID}=require('./store.cjs');
const testDir=!app.isPackaged&&process.env.CLOUDROOM_TEST_DATA;
if(testDir) app.setPath('userData',testDir);
protocol.registerSchemesAsPrivileged([{scheme:'studio',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setAppUserModelId('com.soundclouddesktop.artist');
if(app.isPackaged){for(const flag of ['remote-debugging-port','remote-debugging-pipe','inspect','inspect-brk'])app.commandLine.removeSwitch(flag);}
let win,store,tray,uploadController,account; let quitting=false;
const urls={home:'https://soundcloud.com',upload:'https://soundcloud.com/upload',insights:'https://soundcloud.com/you/insights',tracks:'https://soundcloud.com/you/tracks',api:'https://developers.soundcloud.com/docs/api/register-app'};
const audioExtensions=new Set(['.mp3','.wav','.flac','.ogg','.m4a','.aac','.aiff']);
function theme(value){ if(nativeTheme.themeSource!==value)nativeTheme.themeSource=value; const dark=nativeTheme.shouldUseDarkColors; win?.setTitleBarOverlay({color:dark?'#191a1d':'#f2f3f5',symbolColor:dark?'#f5f5f5':'#222222',height:44}); }
function createWindow(){
 win=new BrowserWindow({width:1380,height:920,minWidth:980,minHeight:700,title:'Soundcloud Desktop — Artist workspace',icon:path.join(__dirname,'assets/icon.ico'),backgroundColor:'#191a1d',...(Number(require('node:os').release().split('.')[2])>=22621?{backgroundMaterial:'mica'}:{}),titleBarStyle:'hidden',titleBarOverlay:{color:'#191a1d',symbolColor:'#ffffff',height:44},show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,devTools:!app.isPackaged}});
 win.removeMenu(); win.loadFile(path.join(__dirname,'ui/index.html')); win.once('ready-to-show',()=>{theme(store.read().profile.theme);win.show();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'})); win.webContents.on('will-navigate',e=>e.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 win.webContents.on('render-process-gone',(_event,details)=>{if(win&&!quitting&&details.reason!=='clean-exit'){dialog.showMessageBox(win,{type:'error',message:'The workspace stopped responding.',detail:'Your saved library and release plans are preserved. Reload the workspace to continue.',buttons:['Reload workspace','Close app']}).then(({response})=>{if(response===0)win?.reload();else app.quit();});}});
 win.on('closed',()=>{win=null;});
 win.on('close',e=>{if(uploadController&&!quitting){e.preventDefault();win.hide();}});
}
const recordIdPattern=/^[A-Za-z0-9_-]{1,128}$/;
const ipcWindow=new Map();
const maxWorkspaceBytes=32*1024*1024;
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
  validateIpcRequest(channel,args);
  return fn(...args);
 });
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
if(!app.requestSingleInstanceLock()) app.quit(); else {
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
 app.whenReady().then(()=>{
  try{store=createStore(app.getPath('userData'));}catch(e){dialog.showErrorBox('Workspace could not be opened',e.message+'\nYour existing data has been preserved.');app.quit();return;}
  protocol.handle('studio',async request=>{
   let u;try{u=new URL(request.url);}catch{return new Response('File unavailable',{status:404});}
   if(request.method!=='GET'||u.protocol!=='studio:'||u.username||u.password||u.port||u.search||u.hash)return new Response('File unavailable',{status:404});
   const match=/^\/([A-Za-z0-9_-]{1,128})$/.exec(u.pathname);
   if(!match)return new Response('File unavailable',{status:404});
   const id=match[1];
   if(u.hostname==='preview'){
    if(!/^\d{1,20}$/.test(id)||!account)return new Response('Preview unavailable',{status:404});
    try{return await account.preview(id,request.headers.get('range')||'');}
    catch{return new Response('SoundCloud preview unavailable',{status:502,headers:{'Cache-Control':'no-store'}});}
   }
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
  try{account=require('./connection.cjs').createConnection(app.getPath('userData'));}catch(e){dialog.showErrorBox('SoundCloud connection',e.message);}
  handler('account:status',()=>account?account.status():{configured:false,connected:false});
  for(const action of ['credentials','authorize','sync','disconnect','add','switchTo','remove'])handler('account:'+action,(...args)=>{
   if(!account)throw Error('Account storage is unavailable.');
   if(uploadController&&['add','switchTo','remove'].includes(action))throw Error('Finish the current upload before changing SoundCloud accounts.');
   return account[action](...args);
  });
  handler('audio:cancel-upload',()=>{uploadController?.abort();});
  handler('audio:upload',async(id,meta)=>{
   if(uploadController)throw Error('An upload is already in progress.');if(!account?.status().connected)throw Error('Connect your SoundCloud account before uploading.');
   const s=store.read(),track=s.tracks.find(t=>t.id===id);if(!track)throw Error('Import the audio file first.');
   if(!meta||typeof meta.title!=='string'||!meta.title.trim()||meta.title.length>180||!['public','private'].includes(meta.sharing))throw Error('Add a title and choose private or public.');
   const fields={title:meta.title.trim(),sharing:meta.sharing};for(const k of ['artist','genre','description']){if(typeof meta[k]!=='string'||meta[k].length>10000)throw Error('Invalid upload details.');fields[k]=meta[k];}
   const artwork=meta.releaseId?s.releases.find(r=>r.id===meta.releaseId)?.art:track.art;
   uploadController=new AbortController();let last=-1;
   try{const remote=await account.upload(track.file,fields,{artwork,signal:uploadController.signal,onProgress:percent=>{if(last!==percent){last=percent;win?.webContents.send('upload:progress',{id,percent,title:fields.title});}}});
    const latest=store.read();const local=latest.tracks.find(t=>t.id===id);if(local){local.link=remote.permalink_url||'';local.lastUpload={id:remote.id||remote.urn,sharing:remote.sharing||fields.sharing,state:remote.state||'processing',at:new Date().toISOString()};}
    const saved=local?await store.writeAsync(latest):store.read();
    return {state:saved,track:{id:remote.id||remote.urn,title:remote.title||fields.title,sharing:remote.sharing||fields.sharing,state:remote.state||'processing',url:remote.permalink_url||''}};
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
  handler('workspace:restore',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Workspace backup',extensions:['json']}]});if(r.canceled)return null;const {validate}=require('./store.cjs');const next=validate(JSON.parse(await fs.promises.readFile(r.filePaths[0],'utf8')));const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Restore workspace'],defaultId:0,cancelId:0,message:'Replace the current workspace?',detail:'A copy of the current workspace will be saved before restoring. Audio and artwork files are referenced, not included.'});if(answer.response!==1)return null;await store.flush();if(fs.existsSync(store.file))await fs.promises.copyFile(store.file,store.file+'.before-restore-'+Date.now()+'.json');return store.writeAsync(next);});
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
