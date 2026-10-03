'use strict';
function initialWindowBounds(workArea) {
  const width = Math.max(1, Math.min(1060, workArea.width - 32));
  const height = Math.max(1, Math.min(860, workArea.height - 32));
  return { width, height, minWidth: Math.min(620, width), minHeight: Math.min(520, height),
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2) };
}
module.exports = { initialWindowBounds };
