'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const core = require('../src/core.cjs');
const PASS = 'filename recovery test password';

test('portable basename suggestions retain extensions without allowing paths or unsafe names', () => {
  for (const [input, expected] of [
    ['photo.jpeg', 'photo.jpeg'], ['résumé final.pdf', 'résumé final.pdf'],
    ['../../escape.txt', 'escape.txt'], ['C:\\Users\\me\\letter.docx', 'letter.docx'],
    ['//server/share/report.csv', 'report.csv'], ['..\\../mix.txt', 'mix.txt'],
    ['../', 'recovered-file.bin'], ['..', 'recovered-file.bin'], ['', 'recovered-file.bin'],
    ['CON.txt', '_CON.txt'], ['nul', '_nul'], ['COM1.zip', '_COM1.zip'], ['LPT².log', '_LPT².log'],
    ['a:b*?<>|"\x00\n.txt', 'a_b________.txt'], ['report.pdf. ', 'report.pdf'],
    ['report\u202egnp.exe', 'report_gnp.exe'],
  ]) assert.equal(core.safeFilename(input), expected, JSON.stringify(input));
  for (const input of ['🙂'.repeat(100) + '.zip', 'é'.repeat(200) + '.pdf', 'a'.repeat(300) + '.png']) {
    const name = core.safeFilename(input);
    assert.ok(Buffer.byteLength(name) <= 200);
    assert.equal(path.extname(name), path.extname(input));
    assert.equal(Buffer.from(name).toString(), name);
    assert.equal(core.safeFilename(name), name);
  }
});

test('canceled and failing destination choosers clear recovered buffers and create no files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-filename-'));
  const png = path.join(dir, 'in.png');
  const secret = Buffer.from('synthetic plaintext only for the cleanup test');
  const originalConcat = Buffer.concat;
  try {
    await fs.writeFile(png, core.envelopeToPng(await core.encryptBytes(secret, PASS, 'report.pdf')));
    for (const fail of [false, true]) {
      const buffers = [];
      Buffer.concat = (...args) => {
        const result = originalConcat(...args);
        if (result.equals(secret)) buffers.push(result);
        return result;
      };
      try {
        const operation = core.decodeFile(png, PASS, async name => {
          assert.equal(name, 'report.pdf');
          assert.deepEqual(await fs.readdir(dir), ['in.png']);
          assert.ok(buffers.length > 0);
          if (fail) throw new Error('picker failed');
          return null;
        });
        if (fail) await assert.rejects(operation, /picker failed/);
        else assert.equal((await operation).canceled, true);
        assert.ok(buffers.every(buffer => buffer.every(byte => byte === 0)));
      } finally { Buffer.concat = originalConcat; }
      assert.deepEqual(await fs.readdir(dir), ['in.png']);
    }
  } finally { Buffer.concat = originalConcat; await fs.rm(dir, { recursive: true, force: true }); }
});

function mainHarness() {
  const handlers = new Map();
  const dialogs = { showOpenDialog: null, showSaveDialog: null };
  const source = path.join(__dirname, '../src');
  const mainFrame = { url: pathToFileURL(path.join(source, 'index.html')).href };
  const webContents = { mainFrame };
  const mockWindow = { isDestroyed: () => false, webContents };
  const electron = {
    app: { whenReady: () => ({ then() {} }), on() {} },
    dialog: dialogs, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  };
  vm.runInNewContext(fsSync.readFileSync(path.join(source, 'main.cjs'), 'utf8') + '\nwindow = mockWindow; registerIpc();', {
    require: name => name === 'electron' ? electron : name.startsWith('./') ? require(path.join(source, name)) : require(name),
    __dirname: source, Buffer, process, mockWindow,
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return {
    dialogs,
    select: (mode = 'decode') => handlers.get('studio:choose-input')(event, mode),
    cancel: () => handlers.get('studio:cancel')(event),
    reset: () => handlers.get('studio:reset-input')(event, 'encode'),
    encode: (appearance, outputName, carrier) => handlers.get('studio:process')(event, { mode: 'encode', password: PASS, confirmation: PASS, appearance, outputName, carrier }),
    recover: (password = PASS, outputName) => handlers.get('studio:process')(event, { mode: 'decode', password, outputName }),
  };
}

test('main and real worker authenticate before Save, honor rename, cancel and retry safely', { timeout: 60000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-main-'));
  const png = path.join(dir, 'in.png'), out = path.join(dir, 'user-choice.dat');
  const secret = Buffer.from('original contents');
  const h = mainHarness();
  let dialogCalls = 0;
  h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [png] });
  h.dialogs.showSaveDialog = async (_window, options) => {
    dialogCalls++;
    assert.equal(options.defaultPath, 'original.pdf');
    assert.deepEqual(await fs.readdir(dir), ['in.png']);
    return { canceled: true };
  };
  try {
    await fs.writeFile(png, core.envelopeToPng(await core.encryptBytes(secret, PASS, 'original.pdf')));
    assert.equal((await h.select()).ok, true);
    assert.equal((await h.recover('wrong but sufficiently long password')).ok, false);
    assert.equal(dialogCalls, 0);
    // Authenticated metadata alone is insufficient: damaged final content must also fail before Save.
    const bytes = await fs.readFile(png), damaged = core.pngToEnvelope(bytes);
    damaged[damaged.length - 1] ^= 1;
    await fs.writeFile(png, core.envelopeToPng(damaged));
    assert.equal((await h.recover()).ok, false);
    assert.equal(dialogCalls, 0);
    await fs.writeFile(png, bytes);
    for (let i = 0; i < 2; i++) assert.equal((await h.recover()).canceled, true);
    assert.equal(dialogCalls, 2);
    assert.deepEqual(await fs.readdir(dir), ['in.png']);
    h.dialogs.showSaveDialog = async () => { throw new Error('dialog unavailable'); };
    assert.equal((await h.recover()).ok, false);
    assert.deepEqual(await fs.readdir(dir), ['in.png']);
    h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: png });
    assert.match((await h.recover()).message, /original file is never replaced/);
    assert.deepEqual(await fs.readFile(png), bytes);
    let release;
    h.dialogs.showSaveDialog = () => new Promise(resolve => { release = resolve; });
    const pending = h.recover();
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    assert.match((await h.recover()).message, /already in progress/);
    assert.match((await h.select()).message, /already in progress/);
    release({ canceled: false, filePath: out });
    const saved = await pending;
    assert.equal(saved.ok, true);
    assert.equal(saved.savedName, 'user-choice.dat');
    assert.deepEqual(await fs.readFile(out), secret);
    h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: out });
    assert.match((await h.recover()).message, /never overwritten/);
    assert.deepEqual(await fs.readFile(out), secret);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['in.png', 'user-choice.dat']);
    h.dialogs.showSaveDialog = async () => ({ canceled: true });
    assert.equal((await h.recover()).canceled, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('main and real worker preserve both appearance choices and reject unknown values', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-appearance-'));
  const input = path.join(dir, 'input.bin'), h = mainHarness();
  try {
    await fs.writeFile(input, 'appearance choice');
    h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
    await h.select('encode');
    h.dialogs.showSaveDialog = async () => { throw new Error('invalid appearance reached dialog'); };
    assert.match((await h.encode('unsupported')).message, /Plain or Glitch/);
    for (const appearance of ['plain', 'glitch']) {
      const output = path.join(dir, appearance + '.png');
      h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: output });
      assert.equal((await h.encode(appearance)).ok, true);
      const png = await fs.readFile(output), envelope = core.pngToEnvelope(png);
      assert.deepEqual(png, core.envelopeToPng(envelope, appearance));
      assert.equal((await core.decryptBytes(envelope, PASS)).data.toString(), 'appearance choice');
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('optional output names are sanitized, defaults retained, and encrypted destinations stay PNG', { timeout: 60000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-output-names-'));
  const input = path.join(dir, 'source.pdf'), h = mainHarness();
  try {
    await fs.writeFile(input, 'output filename test');
    h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
    await h.select('encode');
    for (const [name, expected] of [
      [undefined, 'source.pdf.encrypted.png'], ['', 'source.pdf.encrypted.png'], ['   ', 'source.pdf.encrypted.png'],
      ['secret', 'secret.png'], ['secret.PNG', 'secret.PNG'], ['secret.jpg', 'secret.jpg.png'],
      ['../../secret.png', 'secret.png'], ['C:\\private\\CON', '_CON.png'], ['foo\u202e.png', 'foo_.png'],
      ['x'.repeat(500), 'x'.repeat(196) + '.png'],
    ]) {
      h.dialogs.showSaveDialog = async (_window, options) => {
        assert.equal(options.defaultPath, expected);
        return { canceled: true };
      };
      assert.equal((await h.encode('plain', name)).canceled, true);
    }
    let dialogs = 0;
    h.dialogs.showSaveDialog = async () => { dialogs++; return { canceled: true }; };
    for (const invalid of [null, {}, 42, 'x'.repeat(1025)]) {
      assert.match((await h.encode('plain', invalid)).message, /output filename/);
    }
    assert.equal(dialogs, 0);
    // Save As is authoritative; a missing or other extension receives .png.
    for (const [appearance, choice, expected] of [
      ['plain', 'save-as', 'save-as.png'], ['glitch', 'save-as.jpg', 'save-as.jpg.png'],
      ['glitch', 'uppercase-extension.PNG', 'uppercase-extension.PNG'],
    ]) {
      h.dialogs.showSaveDialog = async (_window, options) => {
        assert.equal(options.defaultPath, 'field-name.png');
        return { canceled: false, filePath: path.join(dir, choice) };
      };
      const result = await h.encode(appearance, 'field-name');
      assert.equal(result.ok, true);
      assert.equal(result.savedName, expected);
      const png = path.join(dir, expected);
      const recovered = await core.decryptBytes(core.pngToEnvelope(await fs.readFile(png)), PASS);
      // Naming the PNG must not change the authenticated original filename.
      assert.equal(recovered.name, 'source.pdf');
      h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [png] });
      await h.select('decode');
      for (const [name, suggested] of [[undefined, 'source.pdf'], ['', 'source.pdf'], ['  ', 'source.pdf'], ['../../renamed.txt', 'renamed.txt'], ['renamed', 'renamed']]) {
        h.dialogs.showSaveDialog = async (_window, options) => {
          assert.equal(options.defaultPath, suggested);
          return { canceled: true };
        };
        assert.equal((await h.recover(PASS, name)).canceled, true);
      }
      h.dialogs.showSaveDialog = async () => { throw new Error('unauthenticated save dialog'); };
      assert.equal((await h.recover('wrong password', 'my-override.txt')).ok, false);
      const out = path.join(dir, expected + '.recovered');
      h.dialogs.showSaveDialog = async (_window, options) => {
        assert.equal(options.defaultPath, 'renamed.txt');
        return { canceled: false, filePath: out };
      };
      assert.equal((await h.recover(PASS, 'renamed.txt')).savedName, path.basename(out));
      assert.equal(await fs.readFile(out, 'utf8'), 'output filename test');
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('filename overrides are snapshotted and appended PNG destinations never overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-name-race-'));
  const source = path.join(dir, 'source.png'), h = mainHarness();
  try {
    await fs.writeFile(source, 'original source');
    h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    await h.select('encode');
    let release, entered;
    const opened = new Promise(resolve => { entered = resolve; });
    h.dialogs.showSaveDialog = (_window, options) => {
      assert.equal(options.defaultPath, 'first.png');
      entered();
      return new Promise(resolve => { release = resolve; });
    };
    const pending = h.encode('plain', 'first');
    await opened;
    assert.match((await h.encode('plain', 'second')).message, /already in progress/);
    assert.match((await h.select('decode')).message, /already in progress/);
    release({ canceled: true });
    assert.equal((await pending).canceled, true);
    h.dialogs.showSaveDialog = async (_window, options) => {
      assert.equal(options.defaultPath, 'second.png');
      // Appending .png resolves to the source: the original must remain unchanged.
      return { canceled: false, filePath: path.join(dir, 'source') };
    };
    assert.match((await h.encode('plain', 'second')).message, /original file is never replaced/);
    assert.equal(await fs.readFile(source, 'utf8'), 'original source');
    const existing = path.join(dir, 'existing.png');
    await fs.writeFile(existing, 'already here');
    h.dialogs.showSaveDialog = async () => ({ canceled: false, filePath: path.join(dir, 'existing') });
    assert.match((await h.encode('plain', 'second')).message, /never overwritten/);
    assert.equal(await fs.readFile(existing, 'utf8'), 'already here');
    assert.deepEqual((await fs.readdir(dir)).sort(), ['existing.png', 'source.png']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('main preflight rejects unsupported carriers and changed oversized sources before Save; reset forgets source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-preflight-'));
  const file = path.join(dir, 'synthetic.bin');
  const h = mainHarness();
  let saves = 0;
  h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  h.dialogs.showSaveDialog = async () => { saves++; return { canceled: true }; };
  try {
    await fs.writeFile(file, 'synthetic');
    assert.equal((await h.select('encode')).ok, true);
    assert.match((await h.encode('plain', '', 'video')).message, /not available/);
    await fs.truncate(file, core.MAX_FILE_BYTES + 1);
    assert.match((await h.encode('glitch')).message, /16 MiB/);
    assert.equal((await h.select('encode')).file.size, core.MAX_FILE_BYTES + 1);
    assert.equal(saves, 0);
    await fs.truncate(file, core.MAX_FILE_BYTES);
    assert.equal((await h.encode('plain')).canceled, true);
    assert.equal(saves, 1);
    assert.equal((await h.reset()).ok, true);
    assert.match((await h.encode('plain')).message, /Choose a file first/);
    assert.equal(saves, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('WAV main/worker export and signature recovery honor names, Save cancellation, operation cancellation and retry', { timeout: 30000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-wav-main-'));
  const source = path.join(dir, 'original.pdf'), audio = path.join(dir, 'renamed.WAV'), disguised = path.join(dir, 'carrier.bin'), out = path.join(dir, 'recovered.txt');
  const h = mainHarness(); let input = source, cancelOperation = true;
  h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
  try {
    await fs.writeFile(source, 'synthetic original');
    await h.select('encode');
    h.dialogs.showSaveDialog = async (_win, options) => {
      assert.equal(options.defaultPath, 'custom.wav'); assert.equal(options.filters[0].extensions[0], 'wav');
      if (cancelOperation) assert.equal((await h.cancel()).ok, true);
      return { canceled: false, filePath: audio };
    };
    assert.equal((await h.encode('glitch', 'custom', 'wav')).canceled, true);
    await assert.rejects(fs.stat(audio), { code: 'ENOENT' });
    cancelOperation = false;
    assert.equal((await h.encode('glitch', 'custom', 'wav')).ok, true);
    assert.match((await h.encode('glitch', 'custom', 'wav')).message, /never overwritten/);
    await fs.rename(audio, disguised); input = disguised;
    assert.equal((await h.select()).file.carrier, 'wav');
    let saves = 0;
    h.dialogs.showSaveDialog = async (_win, options) => { saves++; assert.equal(options.defaultPath, 'recovered.txt'); return { canceled: true }; };
    assert.equal((await h.recover('wrong-password', 'recovered.txt')).ok, false); assert.equal(saves, 0);
    assert.equal((await h.recover(PASS, 'recovered.txt')).canceled, true); assert.equal(saves, 1);
    h.dialogs.showSaveDialog = async (_win, options) => { assert.equal(options.defaultPath, 'recovered.txt'); return { canceled: false, filePath: out }; };
    assert.equal((await h.recover(PASS, 'recovered.txt')).ok, true);
    assert.equal(await fs.readFile(out, 'utf8'), 'synthetic original');
    assert.match((await h.recover(PASS, 'recovered.txt')).message, /never overwritten/);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['carrier.bin','original.pdf','recovered.txt']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('FLAC main/worker export and signature recovery honor names, Save cancellation, operation cancellation and retry', { timeout: 30000 }, async t => {
  if (!(await require('../src/media-tools.cjs').available()).available) return t.skip('Optional installed FFmpeg FLAC encoder is unavailable');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-flac-main-'));
  const source = path.join(dir, 'original.pdf'), audio = path.join(dir, 'renamed.FLAC'), disguised = path.join(dir, 'carrier.bin'), out = path.join(dir, 'recovered.txt');
  const h = mainHarness(); let input = source, cancelOperation = true;
  h.dialogs.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
  try {
    await fs.writeFile(source, 'synthetic original');
    await h.select('encode');
    h.dialogs.showSaveDialog = async (_win, options) => {
      assert.equal(options.defaultPath, 'custom.flac'); assert.equal(options.filters[0].extensions[0], 'flac');
      if (cancelOperation) assert.equal((await h.cancel()).ok, true);
      return { canceled: false, filePath: audio };
    };
    assert.equal((await h.encode('glitch', 'custom', 'flac')).canceled, true);
    await assert.rejects(fs.stat(audio), { code: 'ENOENT' });
    cancelOperation = false;
    assert.equal((await h.encode('glitch', 'custom', 'flac')).ok, true);
    assert.match((await h.encode('glitch', 'custom', 'flac')).message, /never overwritten/);
    await fs.rename(audio, disguised); input = disguised;
    assert.equal((await h.select()).file.carrier, 'flac');
    let saves = 0;
    h.dialogs.showSaveDialog = async (_win, options) => { saves++; assert.equal(options.defaultPath, 'recovered.txt'); return { canceled: true }; };
    assert.equal((await h.recover('wrong-password', 'recovered.txt')).ok, false); assert.equal(saves, 0);
    assert.equal((await h.recover(PASS, 'recovered.txt')).canceled, true); assert.equal(saves, 1);
    h.dialogs.showSaveDialog = async (_win, options) => { assert.equal(options.defaultPath, 'recovered.txt'); return { canceled: false, filePath: out }; };
    assert.equal((await h.recover(PASS, 'recovered.txt')).ok, true);
    assert.equal(await fs.readFile(out, 'utf8'), 'synthetic original');
    assert.match((await h.recover(PASS, 'recovered.txt')).message, /never overwritten/);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['carrier.bin','original.pdf','recovered.txt']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
