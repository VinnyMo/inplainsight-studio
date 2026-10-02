'use strict';
const { Worker } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const test = require('node:test');

test('worker round trip, authentication failure, and existing-output protection', { timeout: 30000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-worker-'));
  const input = path.join(directory, 'original.txt');
  const png = path.join(directory, 'encrypted.png');
  const output = path.join(directory, 'recovered.bin');
  const source = Buffer.from('A worker-thread test file.\n');
  const invoke = (mode, inputPath, outputPath, password = 'long test passphrase for worker') => new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../src/worker.cjs'), { workerData: { mode, inputPath, outputPath, password } });
    let received = false;
    worker.once('message', (result) => { received = true; resolve(result); });
    worker.once('error', reject);
    worker.once('exit', () => { if (!received) reject(new Error('Worker exited without a result')); });
  });
  try {
    await fs.writeFile(input, source);
    assert.equal((await invoke('encode', input, png)).ok, true);
    assert.equal((await invoke('decode', png, output)).ok, true);
    assert.deepEqual(await fs.readFile(output), source);
    const wrongPath = path.join(directory, 'wrong.bin');
    const wrong = await invoke('decode', png, wrongPath, 'a different long password');
    assert.equal(wrong.ok, false);
    assert.equal(wrong.isFormatError, true);
    assert.match(wrong.message, /Wrong password/);
    await assert.rejects(() => fs.stat(wrongPath), { code: 'ENOENT' });
    const duplicate = await invoke('decode', png, output);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'EEXIST');
    assert.equal(duplicate.message, 'File processing failed.');
    assert.deepEqual(await fs.readFile(output), source);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
