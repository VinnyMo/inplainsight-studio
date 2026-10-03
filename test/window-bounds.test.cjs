'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { initialWindowBounds } = require('../src/window-bounds.cjs');
test('startup window stays inside work area including taskbars, scaling, small and secondary displays', () => {
  for (const work of [{ x: 0, y: 0, width: 1440, height: 1000 }, { x: 0, y: 40, width: 1366, height: 728 },
    { x: -1280, y: 0, width: 1280, height: 680 }, { x: 1920, y: -200, width: 800, height: 600 },
    { x: 0, y: 0, width: 500, height: 400 }]) {
    const b = initialWindowBounds(work);
    assert.ok(b.x >= work.x && b.y >= work.y);
    assert.ok(b.x + b.width <= work.x + work.width && b.y + b.height <= work.y + work.height);
    assert.ok(b.minWidth <= b.width && b.minHeight <= b.height);
    assert.ok(b.width > 0 && b.height > 0);
  }
});
