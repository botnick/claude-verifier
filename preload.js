// Preload — runs in an isolated world before the renderer's scripts.
// Exposes a minimal, typed surface via contextBridge so the renderer
// never gets direct Node/Electron primitives.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chat:     (payload) => ipcRenderer.invoke('chat', payload),
  saveFile: (defaultName, content) =>
              ipcRenderer.invoke('save-file', { defaultName, content }),
  saveMdAuto: (filename, content) =>
              ipcRenderer.invoke('save-md-auto', { filename, content }),
  openFile: (filters) => ipcRenderer.invoke('open-file', { filters }),
  loadGolden:        () => ipcRenderer.invoke('load-golden'),
  loadCustomProbes:  () => ipcRenderer.invoke('load-custom-probes'),
  saveCustomProbes:  (data) => ipcRenderer.invoke('save-custom-probes', { data }),
  listReports:       () => ipcRenderer.invoke('list-reports'),
  readReport:        (name) => ipcRenderer.invoke('read-report', { name }),
  revealReport:      (name) => ipcRenderer.invoke('reveal-report', { name }),
  pushMd:   (content) => ipcRenderer.invoke('push-md', { content }),
  platform: process.platform,
});
