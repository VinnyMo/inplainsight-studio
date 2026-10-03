'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Fixed channels only. Paths and file bytes never cross into the renderer.
contextBridge.exposeInMainWorld('studio', Object.freeze({
  chooseInput: (mode) => ipcRenderer.invoke('studio:choose-input', mode),
  capabilities: () => ipcRenderer.invoke('studio:capabilities'),
  cancel: () => ipcRenderer.invoke('studio:cancel'),
  resetInput: (mode) => ipcRenderer.invoke('studio:reset-input', mode),
  process: ({ carrier, mode, password, confirmation, appearance, outputName }) => ipcRenderer.invoke('studio:process', { carrier, mode, password, confirmation, appearance, outputName }),
}));
