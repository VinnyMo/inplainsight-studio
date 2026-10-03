'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, session, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');
const { MAX_FILE_BYTES, MAX_PNG_BYTES, safeFilename } = require('./core.cjs');
const wav = require('./wav.cjs');
const flac = require('./flac.cjs');
const media = require('./media-tools.cjs');
let mediaAvailability;
const getMediaAvailability = () => mediaAvailability ||= media.available();
const preflight = require('./preflight.js');
const { initialWindowBounds } = require('./window-bounds.cjs');

const PAGE_PATH = path.join(__dirname, 'index.html');
const PAGE_URL = pathToFileURL(PAGE_PATH).href;
const MODES = new Set(['encode', 'decode']);
const MAX_PASSWORD_BYTES = 1024;
const selections = { encode: null, decode: null };
let window = null;
let busy = false;
let activeCancellation = null;

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
    ? 'Could not recover this file. Check the password and use the original, unmodified InPlainSight PNG, WAV or FLAC. Check your destination before retrying; use a new filename if a file was saved.'
    : 'Could not create the encrypted file. Check that your source file is available and no larger than 16 MiB, then try another destination.';
}

function processFile(mode, inputPath, password, outputPath, chooseDestination, appearance = 'glitch', carrier = 'png', ffmpeg) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.cjs'), {
      workerData: { mode, inputPath, password, outputPath, chooseDestination: Boolean(chooseDestination), appearance, carrier, ffmpeg, cancelBuffer: activeCancellation?.buffer },
    });
    let received = false, prepared = false, chooserError;
    worker.on('message', async (result) => {
      if (result.type === 'prepared' && chooseDestination && !prepared) {
        prepared = true;
        let destination = null;
        try { destination = await chooseDestination(safeFilename(result.name)); }
        catch (error) { chooserError = error; }
        // Even if the dialog fails, let the worker clear plaintext before returning.
        try { worker.postMessage({ type: 'destination', outputPath: destination }); }
        catch (error) { await worker.terminate(); reject(error); }
        return;
      }
      received = true;
      if (chooserError) reject(chooserError);
      else if (result.ok) resolve(result);
      else reject(Object.assign(new Error(result.message), { code: result.code, isFormatError: result.isFormatError }));
    });
    worker.once('error', reject);
    worker.once('exit', () => { if (!received) reject(new Error('The file processor stopped unexpectedly.')); });
  });
}

function registerIpc() {
  ipcMain.handle('studio:capabilities', async (event) => {
    if (!validSender(event)) return failure('Invalid request.');
    const result = await getMediaAvailability();
    return { flac: { available: result.available, reason: result.reason } };
  });
  ipcMain.handle('studio:cancel', async (event) => {
    if (!validSender(event)) return failure('Invalid request.');
    if (!activeCancellation) return failure('No cancellable audio operation is running.');
    Atomics.store(activeCancellation, 0, 1);
    return { ok: true };
  });
  ipcMain.handle('studio:reset-input', async (event, mode) => {
    if (!validSender(event) || !MODES.has(mode)) return failure('Invalid request.');
    if (busy) return failure('An operation is already in progress.');
    selections[mode] = null;
    return { ok: true };
  });
  ipcMain.handle('studio:choose-input', async (event, mode) => {
    if (!validSender(event) || !MODES.has(mode)) return failure('Invalid request.');
    if (busy) return failure('An operation is already in progress.');
    busy = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: mode === 'encode' ? 'Choose a file to encrypt' : 'Choose an InPlainSight PNG, WAV or FLAC',
        buttonLabel: mode === 'encode' ? 'Choose file' : 'Choose file',
        properties: ['openFile'],
        filters: mode === 'decode' ? [{ name: 'InPlainSight files', extensions: ['png', 'wav', 'flac'] }, { name: 'All files', extensions: ['*'] }] : [{ name: 'All files', extensions: ['*'] }],
      });
      if (result.canceled || result.filePaths.length !== 1) return { ok: true, canceled: true };
      const inputPath = result.filePaths[0];
      const info = await fs.stat(inputPath);
      if (!info.isFile()) return failure('Choose a regular file.');
      if (mode === 'decode' && info.size > MAX_PNG_BYTES) return failure('This encrypted file exceeds the 36 MiB file limit.');
      const carrier = mode === 'decode' ? await flac.detectCarrier(inputPath) : undefined;
      if (carrier === 'wav' && info.size > wav.MAX_WAV_BYTES) return failure('This WAV exceeds the supported size limit.');
      selections[mode] = inputPath;
      return { ok: true, file: { name: path.basename(inputPath), size: info.size, carrier } };
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
    const appearance = request.appearance ?? 'glitch';
    if (mode === 'encode' && !['plain', 'glitch'].includes(appearance)) return failure('Choose Plain or Glitch appearance.');
    if (request.outputName !== undefined && (typeof request.outputName !== 'string' || request.outputName.length > 1024)) return failure('Enter an output filename of at most 1,024 characters.');
    const outputName = (request.outputName ?? '').trim();
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
      const carrier = mode === 'decode' ? await flac.detectCarrier(inputPath) : (request.carrier ?? 'png');
      const extension = ['wav', 'flac'].includes(carrier) ? carrier : 'png';
      let ffmpeg;
      if (carrier === 'flac') {
        const dependency = await getMediaAvailability();
        if (!dependency.available) return failure(dependency.reason);
        ffmpeg = dependency.executable;
      }
      const hasExtension = name => name.toLowerCase().endsWith(`.${extension}`);
      if (['wav', 'flac'].includes(carrier)) activeCancellation = new Int32Array(new SharedArrayBuffer(4));
      if (mode === 'encode') {
        const info = await fs.stat(inputPath);
        if (!info.isFile()) return failure('Choose a regular file.');
        const check = preflight.evaluate({ size: info.size, carrier: request.carrier ?? 'png', appearance, flacAvailable: Boolean(ffmpeg) });
        if (!check.eligible) return failure(check.reason);
      }
      let outputPath;
      const chooseDestination = async (name) => {
        // Recovery calls this only after the whole file has authenticated.
        if (activeCancellation && Atomics.load(activeCancellation, 0)) return null;
        let suggestedName = outputName ? safeFilename(outputName) : name;
        if (mode === 'encode' && !hasExtension(suggestedName)) suggestedName = safeFilename(`${suggestedName}.${extension}`);
        const result = await dialog.showSaveDialog(window, {
          title: mode === 'encode' ? `Save encrypted ${extension.toUpperCase()}` : 'Save recovered file',
          buttonLabel: mode === 'encode' ? 'Encrypt and save' : 'Save recovered file',
          defaultPath: suggestedName,
          filters: mode === 'encode' ? [{ name: `${extension.toUpperCase()} files`, extensions: [extension] }] : [{ name: 'All files', extensions: ['*'] }],
          properties: ['showOverwriteConfirmation'],
        });
        if (result.canceled || !result.filePath) return null;
        const destination = mode === 'encode' && !hasExtension(result.filePath) ? `${result.filePath}.${extension}` : result.filePath;
        if (path.resolve(inputPath) === path.resolve(destination)) throw Object.assign(new Error('Choose a different filename. Your original file is never replaced.'), { isFormatError: true });
        outputPath = destination;
        return outputPath;
      };
      let operation;
      if (mode === 'decode') {
        operation = processFile(mode, inputPath, password, undefined, chooseDestination, appearance, carrier, ffmpeg);
      } else {
        if (!await chooseDestination(`${path.basename(inputPath)}.encrypted.${extension}`)) return { ok: true, canceled: true };
        operation = processFile(mode, inputPath, password, outputPath, undefined, appearance, carrier, ffmpeg);
      }
      password = null;
      const result = await operation;
      if (result.canceled) return { ok: true, canceled: true };
      return { ok: true, savedName: path.basename(outputPath), mode };
    } catch (error) {
      return failure(displayError(error, mode));
    } finally {
      password = null;
      activeCancellation = null;
      busy = false;
    }
  });
}

function createWindow() {
  selections.encode = null;
  selections.decode = null;
  window = new BrowserWindow({
    title: 'InPlainSight Studio',
    ...initialWindowBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea),
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
  const allowedFiles = new Set(['index.html', 'preflight.js', 'renderer.js', 'style.css'].map((file) => pathToFileURL(path.join(__dirname, file)).href));
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
