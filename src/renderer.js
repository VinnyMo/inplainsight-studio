'use strict';

const ui = Object.fromEntries([
  'operation-panel', 'encode-tab', 'decode-tab', 'choose-file', 'file-name', 'file-detail', 'file-heading', 'file-limit',
  'browse-label', 'password-heading', 'password', 'confirmation', 'confirmation-field', 'toggle-password', 'password-help',
  'submit-button', 'submit-label', 'submit-arrow', 'spinner', 'status', 'appearance-field', 'appearance',
].map((id) => [id, document.getElementById(id)]));
const selectedFiles = { encode: null, decode: null };
let mode = 'encode';
let busy = false;

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
  const file = selectedFiles[mode];
  ui['file-name'].textContent = file ? file.name : mode === 'encode' ? 'Choose a file' : 'Choose an encrypted PNG';
  ui['file-detail'].textContent = file ? `${formatSize(file.size)} · Ready to ${mode === 'encode' ? 'encrypt' : 'recover'}` : mode === 'encode' ? 'Your original stays untouched' : 'Use the original InPlainSight PNG';
  ui['browse-label'].textContent = file ? 'Change file →' : 'Browse files →';
  ui['choose-file'].classList.toggle('selected', Boolean(file));
}

function setMode(nextMode) {
  if (busy || nextMode === mode) return;
  mode = nextMode;
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
  ui['file-heading'].textContent = mode === 'encode' ? 'Choose your source file' : 'Choose your encrypted PNG';
  ui['file-limit'].textContent = mode === 'encode' ? 'Any file · max 16 MiB' : 'Original .png file';
  ui['password-heading'].textContent = mode === 'encode' ? 'Set a strong password' : 'Enter the original password';
  ui['confirmation-field'].hidden = mode === 'decode';
  ui['appearance-field'].hidden = mode === 'decode';
  ui.password.placeholder = mode === 'encode' ? 'At least 12 characters' : 'The password used to encrypt';
  ui['password-help'].textContent = mode === 'encode'
    ? 'Use a password manager or several randomly chosen words. There is no password reset.'
    : 'Enter the exact password, including spaces and capitalization. There is no password reset.';
  ui['submit-label'].textContent = mode === 'encode' ? 'Encrypt & save PNG' : 'Recover & save file';
  renderSelection();
}

function setBusy(value, operation = false) {
  busy = value;
  for (const element of document.querySelectorAll('button, input, select')) element.disabled = value;
  ui['operation-panel'].setAttribute('aria-busy', String(value));
  ui.spinner.hidden = !value || !operation;
  ui['submit-arrow'].hidden = value && operation;
  ui['submit-label'].textContent = value && operation ? (mode === 'encode' ? 'Encrypting…' : 'Recovering…') : mode === 'encode' ? 'Encrypt & save PNG' : 'Recover & save file';
}

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
      selectedFiles[mode] = result.file;
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
    setStatus(mode === 'encode' ? 'Choose a source file first.' : 'Choose an encrypted PNG first.', 'error');
    ui['choose-file'].focus();
    return;
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
    : 'Verifying the PNG and password. Then choose where to save the recovered file.');
  try {
    const pending = window.studio.process({ mode, password: ui.password.value, confirmation: ui.confirmation.value, appearance: ui.appearance.value });
    // Keep no form copy while the main process is working.
    clearPasswords();
    const result = await pending;
    if (!result.ok) setStatus(result.message, 'error', true);
    else if (result.canceled) setStatus('Save canceled. No file was created. Enter your password again when you’re ready.');
    else setStatus(mode === 'encode'
      ? `Saved ${result.savedName}. Keep this PNG unchanged and store your password safely.`
      : `Saved ${result.savedName}. Recovery verified.`, 'success', true);
  } catch {
    setStatus('The operation was interrupted. Check your destination before trying again; use a new filename if a file was already saved.', 'error', true);
  } finally {
    clearPasswords();
    setBusy(false);
  }
});

window.addEventListener('pagehide', clearPasswords);
if (!window.studio) {
  setStatus('Open InPlainSight Studio from the desktop app to use the native file picker.', 'error');
  setBusy(true);
}
