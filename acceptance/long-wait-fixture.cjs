'use strict';
const fs = require('node:fs');
const path = require('node:path');
const output = path.join(__dirname, 'long-wait-result.json');
const delayMs = 150000;
const startedAt = new Date().toISOString();
const monotonicStart = performance.now();
fs.writeFileSync(output, JSON.stringify({state:'running', startedAt, delayMs}, null, 2));
setTimeout(() => {
  const result = {state:'completed', startedAt, finishedAt:new Date().toISOString(), delayMs, elapsedMs:Math.round(performance.now()-monotonicStart), calculation:19*19};
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}, delayMs);
