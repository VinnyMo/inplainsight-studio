'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Fixed channels only. Paths and file bytes never cross into the renderer.
contextBridge.exposeInMainWorld('studio', Object.freeze({
  chooseInput: (mode) => ipcRenderer.invoke('studio:choose-input', mode),
  process: ({ mode, password, confirmation, appearance }) => ipcRenderer.invoke('studio:process', { mode, password, confirmation, appearance }),
}));
