'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const flac = require('../src/flac.cjs'), wav = require('../src/wav.cjs'), media = require('../src/media-tools.cjs');
const PASS = 'synthetic FLAC test password';
async function fixture(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ips-flac-test-')); try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
test('FLAC optional dependency reports unavailable without installing or searching relative paths', async () => {
  const before = process.env.IPS_FFMPEG;
  try { process.env.IPS_FFMPEG = 'relative-ffmpeg.exe'; assert.equal((await media.available()).available, false); await assert.rejects(media.resolveFfmpeg(), /installed FFmpeg/); }
  finally { if (before === undefined) delete process.env.IPS_FFMPEG; else process.env.IPS_FFMPEG = before; }
});
test('FLAC round trips empty, chunk boundary and maximum source; PCM matches verified WAV', { timeout: 60000 }, async t => {
  const tools = await media.available(); if (!tools.available) return t.skip('Optional installed FFmpeg FLAC encoder is unavailable');
  await fixture(async dir => {
    for (const size of [0, 65537, flac.MAX_INPUT]) {
      const source = path.join(dir, 'original.pdf'), audio = path.join(dir, 'audio.flac'), out = path.join(dir, 'recovered');
      const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = (i * 73 + (i >>> 8)) & 255;
      await fs.writeFile(source, bytes); const result = await flac.encodeFile(source, PASS, audio);
      assert.equal(result.verified, true); assert.ok(result.flacBytes <= flac.MAX_FLAC_BYTES);
      assert.equal(await flac.detectCarrier(audio), 'flac');
      await flac.decodeFile(audio, PASS, name => { assert.equal(name, 'original.pdf'); return out; }, { tempRoot: dir });
      assert.deepEqual(await fs.readFile(out), bytes);
      await fs.unlink(audio); await fs.unlink(out); assert.deepEqual(await fs.readdir(dir), ['original.pdf']);
    }
  });
});
test('FLAC corruption, truncation, invalid profile/length and wrong password never reach recovery Save', { timeout: 30000 }, async t => {
  if (!(await media.available()).available) return t.skip('Optional FFmpeg unavailable');
  await fixture(async dir => {
    const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.flac'), broken = path.join(dir, 'broken.flac');
    await fs.writeFile(source, Buffer.alloc(65536, 42)); await flac.encodeFile(source, PASS, audio);
    let saves = 0; const chooser = () => { saves++; return path.join(dir, 'bad-output'); };
    await assert.rejects(flac.decodeFile(audio, 'wrong-password', chooser, { tempRoot: dir }));
    const bytes = await fs.readFile(audio), variants = [bytes.subarray(0, 41), bytes.subarray(0, -1), bytes.subarray(0, -200)];
    for (const offset of [4, 7, 8, 10, 18, 21, 25, 26, bytes.length - 10, bytes.length - 1]) { const b = Buffer.from(bytes); b[offset] ^= 1; variants.push(b); }
    for (const [index, data] of variants.entries()) { await fs.writeFile(broken, data); await assert.rejects(flac.decodeFile(broken, PASS, chooser, { tempRoot: dir }), undefined, `variant ${index}`); }
    assert.equal(saves, 0); assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.flac', 'broken.flac', 'source']);
  });
});
test('FLAC no-overwrite, limit refusal, publication failure, chooser cancellation and retry clean stages', { timeout: 30000 }, async t => {
  if (!(await media.available()).available) return t.skip('Optional FFmpeg unavailable');
  await fixture(async dir => {
    const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.flac'), out = path.join(dir, 'out');
    await fs.writeFile(source, 'original fixture'); await flac.encodeFile(source, PASS, audio);
    const before = await fs.readFile(audio);
    await assert.rejects(flac.encodeFile(source, PASS, audio), { code: 'EEXIST' });
    await assert.rejects(flac.decodeFile(audio, PASS, source, { tempRoot: dir }), { code: 'EEXIST' });
    assert.deepEqual(await fs.readFile(audio), before); assert.equal(await fs.readFile(source, 'utf8'), 'original fixture');
    assert.equal((await flac.decodeFile(audio, PASS, () => null, { tempRoot: dir })).canceled, true);
    await assert.rejects(flac.decodeFile(audio, PASS, () => { throw new Error('chooser failed'); }, { tempRoot: dir }), /chooser failed/);
    const link = fs.link; fs.link = async (...args) => { if (args[1] === out) throw Object.assign(new Error('disk failure'), { code: 'ENOSPC' }); return link(...args); };
    try { await assert.rejects(flac.decodeFile(audio, PASS, out, { tempRoot: dir }), { code: 'ENOSPC' }); } finally { fs.link = link; }
    await flac.decodeFile(audio, PASS, out, { tempRoot: dir }); assert.equal(await fs.readFile(out, 'utf8'), 'original fixture');
    await fs.truncate(source, flac.MAX_INPUT + 1); await assert.rejects(flac.encodeFile(source, PASS, path.join(dir, 'too-big.flac')), /16 MiB/);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.flac', 'out', 'source']);
  });
});
test('FLAC cancellation stops child processes and cleans encrypted/decoded stages before retry', { timeout: 30000 }, async t => {
  const tools = await media.available(); if (!tools.available) return t.skip('Optional FFmpeg unavailable');
  await fixture(async dir => {
    const source = path.join(dir, 'source'), audio = path.join(dir, 'audio.flac'), out = path.join(dir, 'out');
    await fs.writeFile(source, Buffer.alloc(65536, 123));
    const signal = { aborted: false };
    await assert.rejects(flac.encodeFile(source, PASS, audio, { signal, progress: p => { if (p.phase === 'encoded-flac') signal.aborted = true; } }), { code: 'ABORT_ERR' });
    assert.deepEqual(await fs.readdir(dir), ['source']);
    await flac.encodeFile(source, PASS, audio);
    signal.aborted = false;
    await assert.rejects(flac.decodeFile(audio, PASS, out, { tempRoot: dir, signal, progress: p => { if (p.phase === 'decoding-flac') signal.aborted = true; } }), { code: 'ABORT_ERR' });
    assert.deepEqual((await fs.readdir(dir)).sort(), ['audio.flac', 'source']);
    signal.aborted = false;
    const job = media.launch(tools.executable, ['-v', 'error', '-nostdin', '-re', '-i', audio, '-f', 'null', '-'], { signal }); job.child.stdout.resume();
    const timer = setTimeout(() => { signal.aborted = true; }, 80);
    try { await assert.rejects(job.finish(), { code: 'ABORT_ERR' }); } finally { clearTimeout(timer); await job.stop(); }
    await flac.decodeFile(audio, PASS, out, { tempRoot: dir }); assert.deepEqual(await fs.readFile(out), await fs.readFile(source));
  });
});
