'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { MAX_FILE_BYTES, MAX_PNG_BYTES } = require('./core.cjs');

const PAGE_PATH = path.join(__dirname, 'index.html');
const PAGE_URL = pathToFileURL(PAGE_PATH).href;
const MODES = new Set(['encode', 'decode']);
const MAX_PASSWORD_BYTES = 1024;
const selections = { encode: null, decode: null };
let window = null;
let busy = false;

function validSender(event) {
  return window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === PAGE_URL;
}

function failure(message) {
  return { ok: false, message };
}

function displayError(error, mode) {
  if (error && error.isFormatError && typeof error.message === 'string') return error.message;
  if (error && error.code === 'EEXIST') return 'A file already exists at that destination. Choose a new filename; existing files are never overwritten.';
  if (error && ['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return 'That location cannot be read or written. Choose a file and destination you can access.';
  if (error && error.code === 'ENOSPC') return 'There is not enough free space at the destination. Free some space and try again.';
  if (error && error.code === 'ENOENT') return 'The selected file or destination is no longer available. Choose it again.';
  return mode === 'decode'
    ? 'Could not recover this file. Check the password and use the original, unmodified InPlainSight PNG. Check your destination before retrying; use a new filename if a file was saved.'
    : 'Could not create the encrypted PNG. Check that your source file is available and no larger than 16 MiB, then try another destination.';
}

function processFile(mode, inputPath, password, outputPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), {
      workerData: { mode, inputPath, password, outputPath },
    });
    let received = false;
    worker.once('message', (result) => {
      received = true;
      if (result.ok) resolve();
      else reject(Object.assign(new Error(result.message), { code: result.code, isFormatError: result.isFormatError }));
    });
    worker.once('error', reject);
    worker.once('exit', () => { if (!received) reject(new Error('The file processor stopped unexpectedly.')); });
  });
}

function registerIpc() {
  ipcMain.handle('studio:choose-input', async (event, mode) => {
    if (!validSender(event) || !MODES.has(mode)) return failure('Invalid request.');
    if (busy) return failure('An operation is already in progress.');
    busy = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: mode === 'encode' ? 'Choose a file to encrypt' : 'Choose an InPlainSight PNG',
        buttonLabel: mode === 'encode' ? 'Choose file' : 'Choose PNG',
        properties: ['openFile'],
        filters: mode === 'decode' ? [{ name: 'PNG images', extensions: ['png'] }] : [{ name: 'All files', extensions: ['*'] }],
      });
      if (result.canceled || result.filePaths.length !== 1) return { ok: true, canceled: true };
      const inputPath = result.filePaths[0];
      const info = await fs.stat(inputPath);
      if (!info.isFile()) return failure('Choose a regular file.');
      if (mode === 'encode' && info.size > MAX_FILE_BYTES) return failure('This prototype supports source files up to 16 MiB. Choose a smaller file.');
      if (mode === 'decode' && info.size > MAX_PNG_BYTES) return failure('This PNG exceeds the 24 MiB prototype limit. Choose an original InPlainSight PNG.');
      selections[mode] = inputPath;
      return { ok: true, file: { name: path.basename(inputPath), size: info.size } };
    } catch (error) {
      return failure(displayError(error, mode));
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('studio:process', async (event, request) => {
    if (!validSender(event) || !request || typeof request !== 'object' || !MODES.has(request.mode)) return failure('Invalid request.');
    if (busy) return failure('An operation is already in progress.');
    const mode = request.mode;
    const inputPath = selections[mode];
    if (!inputPath) return failure('Choose a file first.');
    let password = request.password;
    const passwordBytes = typeof password === 'string' ? Buffer.byteLength(password, 'utf8') : 0;
    if (!passwordBytes || passwordBytes > MAX_PASSWORD_BYTES) return failure('Enter a password of at most 1,024 UTF-8 bytes.');
    if (mode === 'encode' && password.length < 12) return failure('Use a strong password with at least 12 characters.');
    if (mode === 'encode' && password !== request.confirmation) return failure('The two passwords do not match.');
    // Remove extra copies as early as practical. JavaScript cannot guarantee memory erasure.
    request.password = null;
    request.confirmation = null;
    busy = true;
    try {
      const result = await dialog.showSaveDialog(window, {
        title: mode === 'encode' ? 'Save encrypted PNG' : 'Save recovered file',
        buttonLabel: mode === 'encode' ? 'Encrypt and save' : 'Recover and save',
        defaultPath: mode === 'encode' ? `${path.basename(inputPath)}.encrypted.png` : 'recovered-file.bin',
        filters: mode === 'encode' ? [{ name: 'PNG images', extensions: ['png'] }] : [{ name: 'All files', extensions: ['*'] }],
        properties: ['showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      if (path.resolve(inputPath) === path.resolve(result.filePath)) return failure('Choose a different filename. Your original file is never replaced.');
      const operation = processFile(mode, inputPath, password, result.filePath);
      password = null;
      await operation;
      return { ok: true, savedName: path.basename(result.filePath), mode };
    } catch (error) {
      return failure(displayError(error, mode));
    } finally {
      password = null;
      busy = false;
    }
  });
}

function createWindow() {
  selections.encode = null;
  selections.decode = null;
  window = new BrowserWindow({
    title: 'InPlainSight Studio',
    width: 1120,
    height: 860,
    minWidth: 620,
    minHeight: 640,
    backgroundColor: '#0d151c',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      spellcheck: false,
      partition: 'inplainsight-private',
    },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('render-process-gone', () => {
    if (window && !window.isDestroyed()) window.destroy();
  });
  window.once('ready-to-show', () => window && window.show());
  // Let the bounded worker finish rather than interrupting a destination write.
  window.on('close', (event) => { if (busy) event.preventDefault(); });
  window.on('closed', () => { window = null; selections.encode = null; selections.decode = null; });
  window.loadFile(PAGE_PATH);
}

app.whenReady().then(() => {
  const privateSession = session.fromPartition('inplainsight-private', { cache: false });
  privateSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  privateSession.setPermissionCheckHandler(() => false);
  privateSession.on('will-download', (event) => event.preventDefault());
  // Permit only these bundled files; the app never needs a network connection.
  const allowedFiles = new Set(['index.html', 'renderer.js', 'style.css'].map((file) => pathToFileURL(path.join(__dirname, file)).href));
  privateSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !allowedFiles.has(details.url) });
  });
  const menu = process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]) : null;
  Menu.setApplicationMenu(menu);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', (event) => { if (busy) event.preventDefault(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
