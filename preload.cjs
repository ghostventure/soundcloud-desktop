const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('studio',{
  read:()=>ipcRenderer.invoke('workspace:read'), save:s=>ipcRenderer.invoke('workspace:save',s),
  importAudio:()=>ipcRenderer.invoke('audio:import'), dropAudio:files=>ipcRenderer.invoke('audio:drop',Array.from(files,f=>webUtils.getPathForFile(f))),
  reveal:id=>ipcRenderer.invoke('audio:reveal',id), artwork:id=>ipcRenderer.invoke('artwork:pick',id),
  backup:()=>ipcRenderer.invoke('workspace:backup'), restore:()=>ipcRenderer.invoke('workspace:restore'),
  recoveryCandidates:()=>ipcRenderer.invoke('workspace:recovery-candidates'), restoreRecovery:id=>ipcRenderer.invoke('workspace:recovery-restore',id),
  open:where=>ipcRenderer.invoke('soundcloud:open',where), openTrack:url=>ipcRenderer.invoke('soundcloud:open-track',url), copy:text=>ipcRenderer.invoke('clipboard:copy',text),
  theme:value=>ipcRenderer.invoke('theme:set',value), minimize:()=>ipcRenderer.invoke('window:tray'),
  connection:()=>ipcRenderer.invoke('account:status'), credentials:(id,secret)=>ipcRenderer.invoke('account:credentials',id,secret),
  accountAdd:label=>ipcRenderer.invoke('account:add',label), accountSwitch:id=>ipcRenderer.invoke('account:switchTo',id), accountRemove:id=>ipcRenderer.invoke('account:remove',id),
  authorize:()=>ipcRenderer.invoke('account:authorize'), sync:()=>ipcRenderer.invoke('account:sync'), activityFeed:()=>ipcRenderer.invoke('account:activity-feed'), comments:trackId=>ipcRenderer.invoke('account:comments',trackId), disconnect:()=>ipcRenderer.invoke('account:disconnect'),
  exportPerformanceDigest:()=>ipcRenderer.invoke('account:export-performance-digest'),
  upload:(id,metadata)=>ipcRenderer.invoke('audio:upload',id,metadata), uploadJobs:()=>ipcRenderer.invoke('audio:upload-jobs'), acknowledgeUpload:id=>ipcRenderer.invoke('audio:upload-acknowledge',id),
  backendHealth:()=>ipcRenderer.invoke('backend:health'), exportSupportBundle:()=>ipcRenderer.invoke('diagnostics:export'),
  checkUpdates:()=>ipcRenderer.invoke('update:check'), downloadUpdate:version=>ipcRenderer.invoke('update:download',version),
  cancelUpdateDownload:()=>ipcRenderer.invoke('update:cancel'), installUpdate:version=>ipcRenderer.invoke('update:install',version),
  openUpdateRelease:version=>ipcRenderer.invoke('update:open-release',version),
  onUpdateProgress:fn=>ipcRenderer.on('update:progress',(_event,data)=>fn(data)),
  trackArtwork:id=>ipcRenderer.invoke('audio:artwork',id),cancelUpload:()=>ipcRenderer.invoke('audio:cancel-upload'),
  onUpload:fn=>ipcRenderer.on('upload:progress',(_event,data)=>fn(data))
});
