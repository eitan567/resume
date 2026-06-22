const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notStrictEqual(start, -1, `${name} helper should exist in index.html`);

  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i++) {
    const char = html[i];
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return html.slice(start, i + 1);
  }

  throw new Error(`Could not extract ${name}`);
}

const source = extractFunction('exportDotPaintMetrics');
const exportDotPaintMetrics = vm.runInNewContext(`(${source})`);
const railSource = extractFunction('exportTimelineRailMetrics');
const exportTimelineRailMetrics = vm.runInNewContext(`(${railSource})`);

const metrics = exportDotPaintMetrics(
  { left: 100, top: 50, width: 14, height: 14 },
  { left: 10, top: 5, width: 794 },
  2382,
  {
    borderWidth: 3,
    shadowSpread: 2,
    fillStyle: '#022159',
    borderStyle: '#fff',
    shadowStyle: '#b9c6dd'
  }
);

assert.strictEqual(metrics.cx, 291);
assert.strictEqual(metrics.cy, 156);
assert.strictEqual(metrics.outerRadius, 27);
assert.strictEqual(metrics.borderRadius, 21);
assert.strictEqual(metrics.fillRadius, 12);
assert.strictEqual(metrics.fillStyle, '#022159');
assert.strictEqual(metrics.borderStyle, '#fff');
assert.strictEqual(metrics.shadowStyle, '#b9c6dd');

const rail = exportTimelineRailMetrics(
  { top: 105, bottom: 605 },
  { top: 5, width: 794 },
  2382,
  664,
  {
    top: 9,
    bottom: 10,
    width: 2.5,
    strokeStyle: '#b9c6dd'
  }
);

assert.strictEqual(rail.x, 1992);
assert.strictEqual(rail.y1, 327);
assert.strictEqual(rail.y2, 1770);
assert.strictEqual(rail.lineWidth, 7.5);
assert.strictEqual(rail.strokeStyle, '#b9c6dd');
assert.match(
  html,
  /visibility\s*=\s*['"]hidden['"]/,
  'shot() should hide cloned dots before drawing the export-only version'
);
assert.match(
  html,
  /\.experience::before,\s*\.edu-timeline::before/,
  'shot() should hide cloned timeline rails before drawing the export-only rails'
);
assert.match(
  html,
  /exportDotPaintMetrics\(r,\s*pr,\s*canvas\.width,/,
  'shot() should draw exported dots with the shared exportDotPaintMetrics helper'
);
assert.match(
  html,
  /drawExportRail\(ctx,/,
  'shot() should draw export-only timeline rails before drawing dots'
);
assert.match(
  html,
  /eraseExportRail\(ctx,/,
  'shot() should erase html2canvas timeline rails before drawing aligned export rails'
);
assert.doesNotMatch(
  html,
  /windowWidth:\s*el\.scrollWidth/,
  'shot() should not size the cloned export viewport from scrollWidth because it shrinks .page max-width'
);
assert.match(
  html,
  /windowWidth:\s*captureWidth/,
  'shot() should size the cloned export viewport from the live page bounding width'
);
assert.match(
  html,
  /clonedDoc\.body\.style\.padding\s*=\s*['"]0['"]/,
  'shot() should remove body padding in the clone so .page does not shrink during export'
);
assert.match(
  html,
  /maxWidth\s*=\s*['"]none['"]/,
  'shot() should disable max-width in the clone so export geometry stays at A4 width'
);
assert.match(
  html,
  /ctx\.setTransform\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/,
  'shot() should reset the html2canvas context transform before painting export-only dots'
);

console.log('export dot paint metrics match the CSS dot geometry');
