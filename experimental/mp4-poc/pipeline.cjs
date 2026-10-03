'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const crypt = require('./crypto-stream.cjs'), symbols = require('./symbols.cjs');
const PROFILES = new Map([[1, symbols], [2, require('./symbols-dense.cjs')]]);
const { resolveFfmpeg } = require('../../src/media-tools.cjs');
const FRAME_BYTES = symbols.WIDTH * symbols.HEIGHT, MAX_FRAMES = Math.ceil(crypt.MAX_ENVELOPE / symbols.PAYLOAD) * symbols.COPIES;
const MAX_VIDEO = 16 * 1024 * 1024, TIMEOUT = 15000, MAX_JOB_MS = 30000;
function settings(options) {
  const carrierProfile = options.carrierProfile ?? 1, crf = options.crf ?? 18, gop = options.gop ?? 1, maxVideoBytes = options.maxVideoBytes ?? MAX_VIDEO;
  if (!PROFILES.has(carrierProfile) || ![18, 24].includes(crf) || ![1, 30].includes(gop) || !Number.isSafeInteger(maxVideoBytes) || maxVideoBytes < 1 || maxVideoBytes > MAX_VIDEO) throw new Error('Unsupported bounded encoding settings');
  return { carrierProfile, crf, gop, maxVideoBytes };
}
function launch(executable, args, signal, timeoutMs = TIMEOUT) {
  crypt.check(signal);
  const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', spawnError, timedOut = false;
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-32768); });
  child.on('error', error => { spawnError = error; });
  // Keep write failures observable through callback without an unhandled stream error.
  child.stdin.on('error', () => {});
  const abort = () => child.kill();
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  const closed = new Promise(resolve => child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve({ code, stderr, spawnError, timedOut }); }));
  return { child, closed, async finish() { const r = await closed; crypt.check(signal); if (r.spawnError) throw r.spawnError; if (r.timedOut) throw new Error('FFmpeg time limit'); if (r.code !== 0) throw new Error(`Media process failed (${r.code}): ${r.stderr.slice(-1200)}`); return r; }, async stop() { if (child.exitCode === null) child.kill(); await closed; } };
}
async function hashFile(file, limit = MAX_VIDEO) {
  const h = await fs.open(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(65536); let bytes = 0;
  try { const stat = await h.stat(); if (!stat.isFile() || stat.size > limit) throw new Error('Hash input bound');
    while (true) { const { bytesRead } = await h.read(buffer, 0, buffer.length, null); if (!bytesRead) break; bytes += bytesRead; if (bytes > limit || bytes > stat.size) throw new Error('Hash input grew'); hash.update(buffer.subarray(0, bytesRead)); }
    if (bytes !== stat.size) throw new Error('Hash input changed'); return hash.digest();
  } finally { buffer.fill(0); await h.close(); }
}
async function probe(file, signal) {
  file = path.resolve(file);
  const stat = await fs.stat(file); if (!stat.isFile() || stat.size > MAX_VIDEO) throw new Error('Video input bound');
  const ffmpeg = await resolveFfmpeg();
  const job = launch(path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe', '-probesize', '1048576', '-analyzeduration', '1000000', '-f', 'mov', '-show_streams', '-show_format', '-of', 'json', file], signal, 5000);
  let stdout = '';
  try {
    job.child.stdin.end();
    for await (const chunk of job.child.stdout) { if (Buffer.byteLength(stdout) + chunk.length > 65536) throw new Error('Probe output bound'); stdout += chunk; }
    await job.finish(); const data = JSON.parse(stdout), stream = data.streams?.[0];
    if (data.streams?.length !== 1 || stream.codec_type !== 'video' || stream.codec_name !== 'h264' || stream.width !== symbols.WIDTH || stream.height !== symbols.HEIGHT || stream.pix_fmt !== 'yuv420p') throw new Error('Unsupported video profile');
    const duration = Number(data.format.duration), frames = Number(stream.nb_frames);
    const [rateN, rateD] = String(stream.avg_frame_rate).split('/').map(Number);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_FRAMES / 30 + 1 || !Number.isSafeInteger(frames) || frames < 3 || frames > MAX_FRAMES || rateN / rateD !== 30) throw new Error('Video duration/frame/rate bound');
    return { bytes: stat.size, duration, codec: stream.codec_name, width: stream.width, height: stream.height, reportedFrames: Number.isFinite(frames) ? frames : null, streams: data.streams.length };
  } finally { await job.stop(); }
}
async function encodeVideo(envelope, output, options = {}) {
  const config = settings(options), codec = PROFILES.get(config.carrierProfile);
  const { signal, progress = () => {} } = options, total = (await fs.stat(envelope)).size;
  if (total < 96 || total > crypt.MAX_ENVELOPE) throw new Error('Envelope bound');
  const streamId = (await hashFile(envelope, crypt.MAX_ENVELOPE)).subarray(0, 16), count = Math.ceil(total / codec.PAYLOAD);
  let job, source, frames = 0, outputTimer, monitorError;
  try {
    source = await fs.open(envelope, 'r');
    job = launch(await resolveFfmpeg(), ['-hide_banner', '-loglevel', 'info', '-benchmark', '-nostdin', '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1', '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', '1280x720', '-framerate', '30', '-i', 'pipe:0', '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', String(config.crf), '-g', String(config.gop), '-bf', '0', '-pix_fmt', 'yuv420p', '-fs', String(config.maxVideoBytes), '-f', 'mp4', '-n', path.resolve(output)], signal);
    job.child.stdout.resume();
    // Byte budget is checked during encoding, with final stat authoritative (small polling overshoot possible).
    outputTimer = setInterval(() => { fs.stat(output).then(stat => { if (stat.size > config.maxVideoBytes) { monitorError = new Error('Video output bound'); if (job.child.exitCode === null) job.child.kill(); } }).catch(() => {}); }, 100);
    for (let index = 0; index < count; index++) {
      const data = await crypt.readExact(source, Math.min(codec.PAYLOAD, total - index * codec.PAYLOAD)), packet = codec.makePacket(data, index, total, streamId), frame = codec.raster(packet);
      for (let copy = 0; copy < symbols.COPIES; copy++) {
        crypt.check(signal); await new Promise((resolve, reject) => job.child.stdin.write(frame, error => error ? reject(error) : resolve())); frames++;
        progress({ phase: 'encoding', frames, totalFrames: count * symbols.COPIES });
      }
    }
    job.child.stdin.end(); const result = await job.finish(); if (monitorError) throw monitorError;
    if ((await fs.stat(output)).size > config.maxVideoBytes) throw new Error('Video output bound');
    return { ...config, cellSize: codec.CELL, frames, packetCount: count, ffmpegBenchmark: result.stderr.split(/\r?\n/).filter(line => line.startsWith('bench:')) };
  } finally { clearInterval(outputTimer); try { if (source) await source.close(); } finally { if (job) await job.stop(); } }
}
function collector(onPacket) {
  let group = [], index = 0, expected, invalidFrames = 0, correctedWords = 0, physicalFrames = 0, selectedProfile;
  return {
    async frame(frame) {
      physicalFrames++; if (physicalFrames > MAX_FRAMES) throw new Error('Decoded frame bound');
      let decoded;
      for (const [profile, codec] of selectedProfile ? [[selectedProfile, PROFILES.get(selectedProfile)]] : PROFILES) {
        try { decoded = { ...codec.unraster(frame), profile }; selectedProfile = profile; break; } catch {}
      }
      if (decoded) group.push(decoded); else { invalidFrames++; group.push(null); }
      if (group.length < symbols.COPIES) return;
      const valid = group.filter(Boolean); if (!valid.length) throw new Error('All copies of a frame packet are damaged');
      const packet = valid[0];
      if (packet.index !== index || valid.some(p => !p.packet.equals(packet.packet))) throw new Error('Missing, reordered or inconsistent frame packet');
      if (!expected) expected = { count: packet.count, total: packet.total, profile: packet.profile, streamId: Buffer.from(packet.streamId) };
      if (packet.count !== expected.count || packet.total !== expected.total || !packet.streamId.equals(expected.streamId)) throw new Error('Mixed stream');
      correctedWords += valid.reduce((sum, p) => sum + p.corrections, 0); await onPacket(packet.data); index++; group = [];
    },
    finish() { if (group.length || !expected || index !== expected.count || physicalFrames !== expected.count * symbols.COPIES) throw new Error('Truncated/trailing video or missing final packet'); return { ...expected, physicalFrames, invalidFrames, correctedWords }; },
  };
}
async function decodeVideo(video, envelope, { signal, progress = () => {} } = {}) {
  video = path.resolve(video);
  const info = await probe(video, signal), before = await fs.stat(video);
  let job, dest; const hash = crypto.createHash('sha256'); let bytes = 0, frames = 0, offset = 0, rawBytes = 0;
  const frame = Buffer.alloc(FRAME_BYTES);
  const collect = collector(async data => { bytes += data.length; if (bytes > crypt.MAX_ENVELOPE) throw new Error('Recovered byte bound'); hash.update(data); await crypt.writeAll(dest, data); });
  try {
    dest = await fs.open(envelope, 'wx', 0o600);
    job = launch(await resolveFfmpeg(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-max_alloc', '67108864', '-threads', '1', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-probesize', '1048576', '-analyzeduration', '1000000', '-max_pixels', String(FRAME_BYTES), '-f', 'mov', '-i', video, '-map', '0:v:0', '-an', '-sn', '-dn', '-pix_fmt', 'gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], signal);
    job.child.stdin.end();
    for await (const chunk of job.child.stdout) {
      crypt.check(signal);
      rawBytes += chunk.length; if (rawBytes > info.reportedFrames * FRAME_BYTES || rawBytes > MAX_FRAMES * FRAME_BYTES) throw new Error('Decoded raw-byte bound');
      for (let p = 0; p < chunk.length;) { const n = Math.min(FRAME_BYTES - offset, chunk.length - p); chunk.copy(frame, offset, p, p + n); p += n; offset += n;
        if (offset === FRAME_BYTES) { await collect.frame(frame); frames++; progress({ phase: 'decoding', frames }); offset = 0; }
      }
    }
    await job.finish(); if (offset || frames !== info.reportedFrames) throw new Error('Partial or mismatched raw frames'); const result = collect.finish();
    const after = await fs.stat(video); if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Video changed during recovery');
    if (bytes !== result.total || !hash.digest().subarray(0, 16).equals(result.streamId)) throw new Error('Recovered envelope length/hash mismatch');
    await dest.sync(); return { ...info, ...result, streamId: result.streamId.toString('hex') };
  } finally { try { if (dest) await dest.close(); } finally { if (job) await job.stop(); } }
}
async function withJob(output, operation, options = {}) {
  const budget = options.maxJobMs ?? MAX_JOB_MS;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_JOB_MS) throw new Error('Invalid job time budget');
  crypt.check(options.signal);
  const deadline = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(), budget); let job;
  try { const directory = path.dirname(path.resolve(output)); job = await fs.mkdtemp(path.join(directory, '.ips-mp4-'));
    await fs.writeFile(path.join(job, 'ownership.json'), JSON.stringify({ prototype: 'mp4-poc-1', pid: process.pid }), { flag: 'wx' }); return await operation(job, { ...options, signal });
  } finally { clearTimeout(timer); if (job) await fs.rm(job, { recursive: true, force: true }); }
}
async function encode(input, output, password, options = {}) {
  settings(options);
  return withJob(output, async (job, options) => {
    const encrypted = path.join(job, 'encrypted.bin'), video = path.join(job, 'carrier.mp4'), recovered = path.join(job, 'verification.bin');
    const source = await crypt.encrypt(input, encrypted, password, options), encoded = await encodeVideo(encrypted, video, options);
    const decoded = await decodeVideo(video, recovered, options), verified = await crypt.decrypt(recovered, password, options);
    if (source.bytes !== verified.bytes || source.sha256 !== verified.sha256) throw new Error('Export verification failed');
    crypt.check(options.signal); const h = await fs.open(video, 'r+'); try { await h.sync(); } finally { await h.close(); }
    await fs.link(video, path.resolve(output)); return { source, encoded, decoded, verified, output: path.resolve(output) };
  }, options);
}
async function decode(input, output, password, options = {}) {
  return withJob(output, async (job, options) => {
    const envelope = path.join(job, 'recovered-envelope.bin'), plaintext = path.join(job, 'recovered-file');
    const decoded = await decodeVideo(input, envelope, options);
    // First pass authenticates the entire stream without creating plaintext on disk.
    const verified = await crypt.decrypt(envelope, password, options); crypt.check(options.signal);
    const dest = await fs.open(plaintext, 'wx', 0o600); let written;
    try { written = await crypt.decrypt(envelope, password, { ...options, onChunk: bytes => crypt.writeAll(dest, bytes) }); await dest.sync(); } finally { await dest.close(); }
    if (written.bytes !== verified.bytes || written.sha256 !== verified.sha256) throw new Error('Verification spool changed');
    crypt.check(options.signal); await fs.link(plaintext, path.resolve(output)); return { decoded, verified, output: path.resolve(output) };
  }, options);
}
module.exports = { encode, decode, encodeVideo, decodeVideo, collector, probe, hashFile, MAX_VIDEO, MAX_FRAMES };
