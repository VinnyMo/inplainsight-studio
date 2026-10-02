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
    require: name => name === 'electron' ? electron : name === './core.cjs' ? core : require(name),
    __dirname: source, Buffer, process, mockWindow,
  });
  const event = { sender: webContents, senderFrame: mainFrame };
  return {
    dialogs,
    select: (mode = 'decode') => handlers.get('studio:choose-input')(event, mode),
    encode: (appearance) => handlers.get('studio:process')(event, { mode: 'encode', password: PASS, confirmation: PASS, appearance }),
    recover: (password = PASS) => handlers.get('studio:process')(event, { mode: 'decode', password }),
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
