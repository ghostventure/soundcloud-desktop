const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('studio',{
  read:()=>ipcRenderer.invoke('workspace:read'), save:s=>ipcRenderer.invoke('workspace:save',s),
  importAudio:()=>ipcRenderer.invoke('audio:import'), dropAudio:files=>ipcRenderer.invoke('audio:drop',Array.from(files,f=>webUtils.getPathForFile(f))),
  reveal:id=>ipcRenderer.invoke('audio:reveal',id), artwork:id=>ipcRenderer.invoke('artwork:pick',id),
  backup:()=>ipcRenderer.invoke('workspace:backup'), restore:()=>ipcRenderer.invoke('workspace:restore'),
  open:where=>ipcRenderer.invoke('soundcloud:open',where), copy:text=>ipcRenderer.invoke('clipboard:copy',text),
  theme:value=>ipcRenderer.invoke('theme:set',value), minimize:()=>ipcRenderer.invoke('window:tray'),
  connection:()=>ipcRenderer.invoke('account:status'), credentials:(id,secret)=>ipcRenderer.invoke('account:credentials',id,secret),
  authorize:()=>ipcRenderer.invoke('account:authorize'), sync:()=>ipcRenderer.invoke('account:sync'), disconnect:()=>ipcRenderer.invoke('account:disconnect'),
  upload:(id,metadata)=>ipcRenderer.invoke('audio:upload',id,metadata), trackArtwork:id=>ipcRenderer.invoke('audio:artwork',id),cancelUpload:()=>ipcRenderer.invoke('audio:cancel-upload'),
  onUpload:fn=>ipcRenderer.on('upload:progress',(_event,data)=>fn(data))
});
