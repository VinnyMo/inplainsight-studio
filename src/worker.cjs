'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { encodeFile, decodeFile, FormatError } = require('./core.cjs');

(async () => {
  let password = workerData.password;
  workerData.password = null;
  try {
    const operation = workerData.mode === 'encode' ? encodeFile : decodeFile;
    await operation(workerData.inputPath, password, workerData.outputPath);
    parentPort.postMessage({ ok: true });
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
