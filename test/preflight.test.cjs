'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { carriers, evaluate } = require('../src/preflight.js');
const core = require('../src/core.cjs');

test('preflight preserves current limits at zero, boundaries and invalid sizes', () => {
  assert.equal(carriers[0].inputLimit, core.MAX_FILE_BYTES);
  assert.equal(carriers[0].outputLimit, core.MAX_PNG_BYTES);
  for (const size of [0, 1, core.MAX_FILE_BYTES - 1, core.MAX_FILE_BYTES]) {
    for (const appearance of ['plain', 'glitch']) {
      const result = evaluate({ size, appearance });
      assert.equal(result.eligible, true);
      assert.ok(result.estimatedOutputBytes > size);
      assert.match(result.estimateText, /not a guaranteed bound/);
    }
  }
  assert.equal(evaluate({ size: core.MAX_FILE_BYTES + 1 }).code, 'input-limit');
  assert.equal(evaluate().code, 'source-required');
  for (const size of [-1, NaN, Infinity, 0.5, '12', Number.MAX_SAFE_INTEGER + 1]) assert.equal(evaluate({ size }).code, 'invalid-size');
  assert.equal(evaluate({ size: 1, appearance: 'unknown' }).code, 'invalid-appearance');
});

test('unsupported status precedes size checks and approved budgets cannot enable formats', () => {
  assert.deepEqual(carriers.map(c => [...c.budgets]), [[100e6,500e6],[25e6,100e6],[1e9,4e9],[1e9,4e9],[5e9,50e9]]);
  for (const carrier of ['jpeg', 'video', 'unknown']) {
    for (const size of [undefined, 0, 16 * 1024 * 1024 + 1, 50e9]) {
      const result = evaluate({ size, carrier });
      assert.equal(result.code, 'unsupported');
      assert.equal(result.eligible, false);
      assert.equal(result.estimatedOutputBytes, undefined);
    }
  }
  assert.equal(evaluate({ size: 100e6, budget: 500e6 }).eligible, false);
  assert.ok(evaluate({ size: 1, appearance: 'glitch' }).estimatedOutputBytes > evaluate({ size: 1, appearance: 'plain' }).estimatedOutputBytes);
});

test('WAV budgets stay bounded independently of planned gigabyte capacity', () => { const wav = require('../src/wav.cjs'); const c = carriers.find(c => c.id === 'wav'); assert.equal(c.inputLimit, wav.MAX_INPUT); assert.equal(c.outputLimit, wav.MAX_WAV_BYTES); for (const size of [0, 65536, wav.MAX_INPUT]) assert.equal(evaluate({ size, carrier: 'wav' }).eligible, true); assert.equal(evaluate({ size: wav.MAX_INPUT + 1, carrier: 'wav' }).eligible, false); });


test('FLAC dependency and standardized summaries separate estimates, duration, limits and warnings', () => {
  assert.equal(evaluate({ size: 1, carrier: 'flac' }).code, 'dependency-unavailable');
  assert.equal(evaluate({ size: 50e9, carrier: 'flac' }).code, 'dependency-unavailable');
  assert.equal(evaluate({ size: 16 * 1024 * 1024 + 1, carrier: 'flac', flacAvailable: true }).code, 'input-limit');
  for (const carrier of ['png', 'wav', 'flac']) {
    const result = evaluate({ size: 1024, carrier, flacAvailable: true });
    assert.equal(result.eligible, true); assert.match(result.estimateText, /^Estimated output size:/);
    assert.equal(result.limitingFactor, 'Maximum source size: 16 MiB');
    assert.match(result.warningText, /^Keep the exported file unchanged so it can be recovered/);
    assert.doesNotMatch(result.reason, /available|16 MiB/);
    if (carrier === 'png') { assert.equal(result.durationText, ''); assert.match(result.estimateText, /not a guaranteed bound/); }
    else { assert.match(result.durationText, /^Duration:/); assert.match(result.warningText, /Noise audio/); }
  }
});
