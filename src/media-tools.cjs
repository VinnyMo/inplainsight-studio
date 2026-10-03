'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { spawn } = require('node:child_process');
const { FormatError } = require('./core.cjs');
const stream = require('./stream-envelope.cjs');
async function resolveFfmpeg() {
  const explicit = process.env.IPS_FFMPEG;
  const candidates = explicit ? [explicit] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(p => path.join(p.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  for (const file of candidates) {
    if (!path.isAbsolute(file)) continue; // Never run a relative executable from the source/destination folder.
    try { if ((await fs.stat(file)).isFile()) return file; } catch {}
  }
  throw new FormatError('FLAC needs an installed FFmpeg with FLAC support on PATH (or an absolute IPS_FFMPEG path). Nothing is installed automatically.');
}
function launch(executable, args, { signal, timeoutMs = 60000 } = {}) {
  stream.check(signal);
  const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', error, timedOut = false;
  child.on('error', e => { error = e; });
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-8192); });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const cancelTimer = setInterval(() => { if (signal?.aborted) child.kill(); }, 25);
  const closed = new Promise(resolve => child.once('close', code => { clearTimeout(timer); clearInterval(cancelTimer); resolve(code); }));
  return { child, async finish() {
    const code = await closed; stream.check(signal);
    if (error) throw new FormatError('FFmpeg could not start. Check the installed FLAC dependency.');
    if (timedOut) throw new FormatError('FLAC processing exceeded its 60-second media-process limit.');
    if (code !== 0) throw new FormatError('FLAC processing failed. Use an intact supported file and a working FFmpeg installation.');
    return stderr;
  }, async stop() { if (child.exitCode === null) child.kill(); await closed; } };
}
async function available() {
  let job;
  try {
    const executable = await resolveFfmpeg();
    job = launch(executable, ['-hide_banner', '-h', 'encoder=flac'], { timeoutMs: 3000 });
    let output = '';
    for await (const chunk of job.child.stdout) { if (output.length + chunk.length > 16384) throw new Error('Capability output limit'); output += chunk; }
    const stderr = await job.finish();
    if (!/Encoder flac/.test(output + stderr) || !/Supported sample formats:.*s16/.test(output + stderr)) throw new Error('No supported encoder');
    return { available: true, executable };
  } catch (error) { return { available: false, reason: error instanceof FormatError ? error.message : 'FLAC is unavailable: the installed FFmpeg did not report the required encoder.' }; }
  finally { if (job) await job.stop(); }
}
module.exports = { resolveFfmpeg, launch, available };
