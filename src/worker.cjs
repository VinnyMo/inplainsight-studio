'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { encodeFile, decodeFile, FormatError } = require('./core.cjs');
const wav = require('./wav.cjs');
const flac = require('./flac.cjs');

(async () => {
  let password = workerData.password;
  workerData.password = null;
  try {
    const carrier = workerData.mode === 'encode' ? (workerData.carrier || 'png') : await flac.detectCarrier(workerData.inputPath);
    const isAudio = ['wav', 'flac'].includes(carrier);
    const audio = carrier === 'flac' ? flac : wav;
    const signal = { get aborted() { return Boolean(workerData.cancelBuffer && Atomics.load(new Int32Array(workerData.cancelBuffer), 0)); } };
    const operation = isAudio ? (workerData.mode === 'encode' ? audio.encodeFile : audio.decodeFile) : (workerData.mode === 'encode' ? encodeFile : decodeFile);
    const destination = workerData.chooseDestination ? (name) => {
      password = null;
      return new Promise((resolve, reject) => {
        parentPort.once('message', (message) => {
          if (message && message.type === 'destination' && (message.outputPath === null || typeof message.outputPath === 'string')) resolve(message.outputPath);
          else reject(new Error('Invalid destination response.'));
        });
        parentPort.postMessage({ type: 'prepared', name });
      });
    } : workerData.outputPath;
    const result = await operation(workerData.inputPath, password, destination, isAudio ? { signal, ffmpeg: workerData.ffmpeg } : workerData.appearance);
    parentPort.postMessage({ ok: true, canceled: Boolean(result.canceled) });
  } catch (error) {
    if (error.code === 'ABORT_ERR') { parentPort.postMessage({ ok: true, canceled: true }); return; }
    parentPort.postMessage({
      ok: false,
      code: typeof error.code === 'string' ? error.code : undefined,
      isFormatError: error instanceof FormatError,
      message: error instanceof FormatError ? error.message : 'File processing failed.',
    });
  } finally {
    password = null;
    parentPort.close();
  }
})();
