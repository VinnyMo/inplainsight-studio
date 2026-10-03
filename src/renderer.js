'use strict';

const ui = Object.fromEntries([
  'format-duration', 'format-warning', 'format-details', 'cancel-operation', 'format-field', 'format-reason', 'format-estimate', 'format-limit', 'export-fields', 'reset-source', 'password-step',
  'carrier-png', 'carrier-jpeg', 'carrier-wav', 'carrier-flac', 'carrier-video',
  'operation-panel', 'encode-tab', 'decode-tab', 'choose-file', 'file-name', 'file-detail', 'file-heading', 'file-limit',
  'browse-label', 'password-heading', 'password', 'confirmation', 'confirmation-field', 'toggle-password', 'password-help',
  'submit-button', 'submit-label', 'submit-arrow', 'spinner', 'status', 'appearance-field', 'appearance', 'output-name', 'output-name-label', 'output-name-help',
].map((id) => [id, document.getElementById(id)]));
const selectedFiles = { encode: null, decode: null };
const outputNames = { encode: '', decode: '' };
let mode = 'encode';
let busy = false;
let selectedCarrier = 'png';
let flacAvailable = false;
const preflight = window.studioPreflight;
function renderFormats() {
  const file = selectedFiles.encode;
  const result = preflight.evaluate({ size: file?.size, carrier: selectedCarrier, appearance: ui.appearance.value, flacAvailable });
  ui['appearance-field'].hidden = mode === 'decode' || selectedCarrier !== 'png';
  if (mode === 'encode') {
    ui['submit-label'].textContent = `Encrypt & save ${selectedCarrier.toUpperCase()}`;
    ui['output-name-help'].textContent = `Leave blank to use the default name. ${selectedCarrier.toUpperCase()} extension is added automatically.`;
    ui['output-name'].placeholder = file ? `${file.name}.encrypted.${selectedCarrier}` : 'Default filename';
  }
  ui['format-field'].hidden = mode !== 'encode' || !file;
  ui['export-fields'].hidden = mode === 'encode' && (!file || !result.eligible);
  ui['password-step'].textContent = mode === 'encode' ? '03' : '02';
  for (const carrier of preflight.carriers) {
    const item = preflight.evaluate({ size: file?.size, carrier: carrier.id, appearance: ui.appearance.value, flacAvailable });
    const button = ui[`carrier-${carrier.id}`];
    button.setAttribute('aria-disabled', String(!item.eligible));
    button.setAttribute('aria-pressed', String(carrier.id === selectedCarrier && item.eligible));
    button.title = item.reason;
  }
  ui['format-reason'].textContent = result.eligible ? '' : result.reason;
  ui['format-duration'].textContent = result.durationText || '';
  ui['format-duration'].hidden = !result.durationText;
  ui['format-warning'].textContent = result.warningText || '';
  ui['format-details'].textContent = result.detailsText || '';
  ui['format-estimate'].textContent = result.estimateText || 'Estimated output size: unavailable for this source.';
  ui['format-limit'].textContent = result.limitingFactor || 'Maximum source size: 16 MiB';
}
for (const carrier of preflight.carriers) {
  const explain = () => {
    if (!busy) { const item = preflight.evaluate({ size: selectedFiles.encode?.size, carrier: carrier.id, appearance: ui.appearance.value, flacAvailable }); ui['format-reason'].textContent = item.eligible ? '' : item.reason; }
  };
  ui[`carrier-${carrier.id}`].addEventListener('click', () => {
    if (busy) return;
    const check = preflight.evaluate({ size: selectedFiles.encode?.size, carrier: carrier.id, appearance: ui.appearance.value, flacAvailable });
    if (check.eligible) { selectedCarrier = carrier.id; renderFormats(); }
    explain();
  });
  for (const event of ['focus', 'mouseenter']) ui[`carrier-${carrier.id}`].addEventListener(event, explain);
}
ui.appearance.addEventListener('change', renderFormats);
ui['reset-source'].addEventListener('click', async () => {
  if (busy || mode !== 'encode') return;
  setBusy(true);
  try {
    const result = await window.studio.resetInput('encode');
    if (!result.ok) { setStatus(result.message, 'error', true); return; }
    selectedFiles.encode = null; outputNames.encode = ''; ui['output-name'].value = '';
    selectedCarrier = 'png'; ui.appearance.value = 'glitch'; clearPasswords(); setStatus(''); renderSelection();
  } catch { setStatus('Could not clear the source. Try again.', 'error', true); }
  finally { setBusy(false); ui['choose-file'].focus(); }
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function clearPasswords() {
  ui.password.value = '';
  ui.confirmation.value = '';
  ui.password.type = 'password';
  ui.confirmation.type = 'password';
  ui['toggle-password'].textContent = 'Show';
  ui['toggle-password'].setAttribute('aria-label', 'Show password');
  ui['toggle-password'].setAttribute('aria-pressed', 'false');
}

function setStatus(message, type = 'info', focus = false) {
  ui.status.textContent = message;
  ui.status.className = `status ${type}`;
  ui.status.hidden = !message;
  if (focus && message) ui.status.focus();
}

function renderSelection() {
  renderFormats();
  const file = selectedFiles[mode];
  ui['file-name'].textContent = file ? file.name : mode === 'encode' ? 'Choose a file' : 'Choose an encrypted PNG, WAV or FLAC';
  ui['file-detail'].textContent = file ? `${formatSize(file.size)} · Ready to ${mode === 'encode' ? 'encrypt' : 'recover'}` : mode === 'encode' ? 'Your original stays untouched' : 'Use the original InPlainSight PNG, WAV or FLAC';
  if (file && mode === 'encode' && !preflight.evaluate({ size: file.size, carrier: selectedCarrier, appearance: ui.appearance.value, flacAvailable }).eligible) ui['file-detail'].textContent = `${formatSize(file.size)} — No supported output available`;
  ui['browse-label'].textContent = file ? 'Change file →' : 'Browse files →';
  ui['choose-file'].classList.toggle('selected', Boolean(file));
  ui['output-name'].placeholder = mode === 'encode' && file ? `${file.name}.encrypted.${selectedCarrier}` : mode === 'encode' ? 'Default filename' : 'Original filename after verification';
}

function setMode(nextMode) {
  if (busy || nextMode === mode) return;
  outputNames[mode] = ui['output-name'].value;
  mode = nextMode;
  ui['output-name'].value = outputNames[mode];
  ui['output-name-label'].textContent = mode === 'encode' ? 'Encrypted filename (optional)' : 'Recovered filename (optional)';
  ui['output-name-help'].textContent = mode === 'encode'
    ? 'Leave blank to use the default name. PNG extension is added automatically.'
    : 'Leave blank to use the original filename and extension after verification. Include an extension if you change the name.';
  clearPasswords();
  setStatus('');
  for (const tabMode of ['encode', 'decode']) {
    const tab = ui[`${tabMode}-tab`];
    const active = mode === tabMode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  ui['operation-panel'].setAttribute('aria-labelledby', `${mode}-tab`);
  ui['file-heading'].textContent = mode === 'encode' ? 'Choose your source file' : 'Choose your encrypted PNG, WAV or FLAC';
  ui['file-limit'].textContent = mode === 'encode' ? 'Any regular file' : 'Original .png, .wav or .flac file';
  ui['password-heading'].textContent = mode === 'encode' ? 'Set a strong password' : 'Enter the original password';
  ui['confirmation-field'].hidden = mode === 'decode';
  ui['appearance-field'].hidden = mode === 'decode';
  ui.password.placeholder = mode === 'encode' ? 'At least 12 characters' : 'The password used to encrypt';
  ui['password-help'].textContent = mode === 'encode'
    ? 'Use a password manager or several randomly chosen words. There is no password reset.'
    : 'Enter the exact password, including spaces and capitalization. There is no password reset.';
  ui['submit-label'].textContent = mode === 'encode' ? `Encrypt & save ${selectedCarrier.toUpperCase()}` : 'Recover & save file';
  renderSelection();
}

function setBusy(value, operation = false) {
  busy = value;
  if (!value) renderFormats();
  for (const element of document.querySelectorAll('button, input, select')) element.disabled = value;
  ui['operation-panel'].setAttribute('aria-busy', String(value));
  const cancellable = mode === 'encode' ? ['wav', 'flac'].includes(selectedCarrier) : ['wav', 'flac'].includes(selectedFiles.decode?.carrier);
  ui['cancel-operation'].hidden = !value || !operation || !cancellable;
  ui['cancel-operation'].disabled = false;
  ui.spinner.hidden = !value || !operation;
  ui['submit-arrow'].hidden = value && operation;
  ui['submit-label'].textContent = value && operation ? (mode === 'encode' ? 'Encrypting…' : 'Recovering…') : mode === 'encode' ? `Encrypt & save ${selectedCarrier.toUpperCase()}` : 'Recover & save file';
}

ui['cancel-operation'].addEventListener('click', async () => {
  if (!busy) return;
  ui['cancel-operation'].disabled = true;
  try { const result = await window.studio.cancel(); if (!busy) return; setStatus(result.ok ? 'Cancel requested. Waiting for safe cleanup.' : result.message); }
  catch { if (!busy) return; setStatus('Could not request cancellation. Wait for the operation to finish.', 'error'); }
  finally { if (busy) ui['cancel-operation'].disabled = false; }
});

for (const tabMode of ['encode', 'decode']) {
  ui[`${tabMode}-tab`].addEventListener('click', () => setMode(tabMode));
  ui[`${tabMode}-tab`].addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || busy) return;
    event.preventDefault();
    const nextMode = event.key === 'Home' ? 'encode' : event.key === 'End' ? 'decode' : mode === 'encode' ? 'decode' : 'encode';
    setMode(nextMode);
    ui[`${nextMode}-tab`].focus();
  });
}

ui['choose-file'].addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  setStatus('');
  try {
    const result = await window.studio.chooseInput(mode);
    if (!result.ok) setStatus(result.message, 'error', true);
    else if (!result.canceled) {
      clearPasswords();
      selectedFiles[mode] = result.file;
      outputNames[mode] = '';
      ui['output-name'].value = '';
      renderSelection();
    }
  } catch {
    setStatus('The file picker could not be opened. Close and reopen the app, then try again.', 'error', true);
  } finally {
    setBusy(false);
  }
});

ui['toggle-password'].addEventListener('click', () => {
  const show = ui.password.type === 'password';
  ui.password.type = show ? 'text' : 'password';
  ui.confirmation.type = show ? 'text' : 'password';
  ui['toggle-password'].textContent = show ? 'Hide' : 'Show';
  ui['toggle-password'].setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  ui['toggle-password'].setAttribute('aria-pressed', String(show));
});

ui['operation-panel'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  setStatus('');
  if (!selectedFiles[mode]) {
    setStatus(mode === 'encode' ? 'Choose a source file first.' : 'Choose an encrypted PNG, WAV or FLAC first.', 'error');
    ui['choose-file'].focus();
    return;
  }
  if (mode === 'encode') {
    const check = preflight.evaluate({ size: selectedFiles.encode.size, carrier: selectedCarrier, appearance: ui.appearance.value, flacAvailable });
    if (!check.eligible) { renderFormats(); setStatus(check.reason, 'error'); ui['choose-file'].focus(); return; }
  }
  if (!ui.password.value || (mode === 'encode' && ui.password.value.length < 12)) {
    setStatus(mode === 'encode' ? 'Use a strong password with at least 12 characters.' : 'Enter the password used to encrypt this file.', 'error');
    ui.password.focus();
    return;
  }
  if (new TextEncoder().encode(ui.password.value).length > 1024) {
    setStatus('That password is too long. The maximum is 1,024 UTF-8 bytes.', 'error');
    ui.password.focus();
    return;
  }
  if (mode === 'encode' && ui.password.value !== ui.confirmation.value) {
    setStatus('The two passwords do not match.', 'error');
    ui.confirmation.focus();
    return;
  }
  setBusy(true, true);
  setStatus(mode === 'encode'
    ? 'Choose a new destination in the save dialog. Processing may take a moment.'
    : 'Verifying the encrypted file and password. Then choose where to save the recovered file.');
  try {
    const pending = window.studio.process({ mode, carrier: selectedCarrier, password: ui.password.value, confirmation: ui.confirmation.value, appearance: ui.appearance.value, outputName: ui['output-name'].value });
    // Keep no form copy while the main process is working.
    clearPasswords();
    const result = await pending;
    if (!result.ok) setStatus(result.message, 'error', true);
    else if (result.canceled) setStatus('Save canceled. No file was created. Enter your password again when you’re ready.');
    else setStatus(mode === 'encode'
      ? `Saved ${result.savedName}. Keep this encrypted file unchanged and store your password safely.`
      : `Saved ${result.savedName}. Recovery verified.`, 'success', true);
  } catch {
    setStatus('The operation was interrupted. Check your destination before trying again; use a new filename if a file was already saved.', 'error', true);
  } finally {
    clearPasswords();
    setBusy(false);
  }
});

renderFormats();
if (window.studio?.capabilities) window.studio.capabilities().then(result => { flacAvailable = result.flac?.available === true; if (!busy) renderFormats(); }).catch(() => {});
window.addEventListener('pagehide', clearPasswords);
if (!window.studio) {
  setStatus('Open InPlainSight Studio from the desktop app to use the native file picker.', 'error');
  setBusy(true);
}
