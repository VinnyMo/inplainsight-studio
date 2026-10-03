'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const p = require('./pipeline.cjs');
(async () => {
  const dir = path.join(__dirname, 'artifacts'); await fs.mkdir(dir, { recursive: true });
  const input = path.join(dir, 'synthetic-64k.bin'), video = path.join(dir, 'synthetic-64k.mp4'), recovered = path.join(dir, 'recovered-64k.bin');
  const bytes = Buffer.alloc(65536); for (let i = 0; i < bytes.length; i++) bytes[i] = crypto.createHash('sha256').update(`mp4-poc-fixture-${i >>> 5}`).digest()[i & 31];
  await fs.writeFile(input, bytes, { flag: 'wx' }); bytes.fill(0);
  const password = 'disposable-video-demo-password'; let peakNodeRss = process.memoryUsage().rss;
  const monitor = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss); }, 50);
  const begin = performance.now();
  try {
    const encoded = await p.encode(input, video, password), afterEncode = performance.now();
    const decoded = await p.decode(video, recovered, password), end = performance.now();
    const sourceHash = (await p.hashFile(input)).toString('hex'), recoveredHash = (await p.hashFile(recovered)).toString('hex');
    if (sourceHash !== recoveredHash) throw new Error('Recovered file mismatch');
    const report = { prototype: 'visible-mp4-poc-1', inputBytes: 65536, video, recovered, sourceHash, recoveredHash, byteExact: true,
      encodeAndVerifySeconds: (afterEncode - begin) / 1000, recoverySeconds: (end - afterEncode) / 1000,
      peakNodeRssBytes: Math.max(peakNodeRss, process.memoryUsage().rss), nodeMaxRssKiB: process.resourceUsage().maxRSS,
      resourceScope: 'Node process only; excludes FFmpeg/Electron/OS. FFmpeg benchmark below if supported.', encoded, decoded };
    await fs.writeFile(path.join(dir, 'evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { clearInterval(monitor); }
})().catch(error => { console.error(error); process.exitCode = 1; });
