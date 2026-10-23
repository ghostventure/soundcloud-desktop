const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,protocol,net,Tray,Menu,nativeTheme}=require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL}=require('node:url');
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
function handler(channel,fn){ipcMain.handle(channel,async(event,...args)=>{if(!win || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame) throw Error('Untrusted caller');return fn(...args);});}
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
   const u=new URL(request.url);
   if(u.hostname==='preview'){
    const id=u.pathname.slice(1);
    if(!/^\d+$/.test(id)||!account)return new Response('Preview unavailable',{status:404});
    try{return await account.preview(id,request.headers.get('range')||'');}
    catch{return new Response('SoundCloud preview unavailable',{status:502,headers:{'Cache-Control':'no-store'}});}
   }
   const id=u.pathname.slice(1);const file=store.asset(u.hostname,id);
   if(!file)return new Response('File unavailable',{status:404});
   try{await fs.promises.access(file,fs.constants.R_OK);}catch{return new Response('File unavailable',{status:404});}
   return net.fetch(pathToFileURL(file).toString(),{headers:request.headers});
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
