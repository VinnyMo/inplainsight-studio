'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const p = require('./pipeline.cjs'), c = require('./crypto-stream.cjs');
(async () => {
  const input = path.join(__dirname, 'artifacts/synthetic-64k.bin'), dir = path.join(__dirname, 'comparison'); await fs.mkdir(dir, { recursive: false });
  const spool = await fs.mkdtemp(path.join(dir, '.comparison-')), encrypted = path.join(spool, 'shared-envelope.bin'), password = 'disposable-density-comparison-password', results = [];
  try {
    const source = await c.encrypt(input, encrypted, password);
    const cases = [
      { name: '8px-crf18-intra', carrierProfile: 1, crf: 18, gop: 1 },
      { name: '8px-crf24-intra', carrierProfile: 1, crf: 24, gop: 1 },
      { name: '4px-crf18-intra', carrierProfile: 2, crf: 18, gop: 1 },
      { name: '4px-crf24-intra', carrierProfile: 2, crf: 24, gop: 1 },
      { name: '4px-crf24-gop30', carrierProfile: 2, crf: 24, gop: 30 },
    ];
    for (const settings of cases) {
      const video = path.join(spool, settings.name + '.mp4'), recovered = path.join(spool, settings.name + '.bin'), start = performance.now();
      try {
        const encoded = await p.encodeVideo(encrypted, video, settings), encodeEnd = performance.now();
        const decoded = await p.decodeVideo(video, recovered), sourceHandle = await fs.open(input, 'r'); let exactBytes = 0, verified;
        try { verified = await c.decrypt(recovered, password, { onChunk: async chunk => { const expected = await c.readExact(sourceHandle, chunk.length); assert.deepEqual(chunk, expected); exactBytes += chunk.length; expected.fill(0); } }); }
        finally { await sourceHandle.close(); }
        assert.equal(verified.sha256, source.sha256); assert.equal(verified.bytes, source.bytes); assert.equal(exactBytes, source.bytes);
        const final = path.join(dir, settings.name + '.mp4'); await fs.link(video, final);
        const result = { ...settings, status: 'verified byte-for-byte', inputBytes: source.bytes, videoBytes: decoded.bytes, expansion: decoded.bytes / source.bytes,
          playbackSeconds: decoded.duration, frames: decoded.physicalFrames, encodeSeconds: (encodeEnd - start) / 1000,
          verificationSeconds: (performance.now() - encodeEnd) / 1000, correctedWords: decoded.correctedWords, erasedFrames: decoded.invalidFrames,
          recoveredSha256: verified.sha256, videoSha256: (await p.hashFile(final)).toString('hex'), video: final, ffmpegBenchmark: encoded.ffmpegBenchmark };
        results.push(result); console.log(JSON.stringify(result));
      } catch (error) { results.push({ ...settings, status: 'rejected', error: error.message }); console.log(JSON.stringify(results.at(-1))); }
      await fs.writeFile(path.join(dir, 'results.json'), JSON.stringify({ sameEncryptedEnvelope: true, source, results }, null, 2));
    }
  } finally { await fs.rm(spool, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
