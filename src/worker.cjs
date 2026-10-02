'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { encodeFile, decodeFile, FormatError } = require('./core.cjs');

(async () => {
  let password = workerData.password;
  workerData.password = null;
  try {
    const operation = workerData.mode === 'encode' ? encodeFile : decodeFile;
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
    const result = await operation(workerData.inputPath, password, destination, workerData.appearance);
    parentPort.postMessage({ ok: true, canceled: Boolean(result.canceled) });
  } catch (error) {
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
