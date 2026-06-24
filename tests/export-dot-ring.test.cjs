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

function listItemContaining(text) {
  const items = html.match(/<li\b[\s\S]*?<\/li>/g) || [];
  const item = items.find(candidate => candidate.includes(text));
  assert.ok(item, `Expected a list item containing ${text}`);
  return item;
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
assert.doesNotMatch(
  html,
  /Adobe Stock|Etsy|אומנות דיגיטלית|digital art/,
  'Independent work should stay focused on software development, not digital art sales'
);
assert.doesNotMatch(
  html,
  /יוצר[\s\S]*אלבומים דיגיטליים|digital album creator/,
  'Independent development bullet should not include the digital album creator example'
);
assert.match(
  html,
  /<button[^>]*id="viewNormal"[^>]*data-en="Normal view"[^>]*>תצוגה רגילה<\/button>/,
  'Normal view button should be translated in English mode'
);
assert.match(
  html,
  /<button[^>]*id="viewWide"[^>]*data-en="Wide view"[^>]*>תצוגה רחבה<\/button>/,
  'Wide view button should be translated in English mode'
);
assert.doesNotMatch(
  html,
  /מערכות שפיתחתי בבנק|Systems I developed at the bank/,
  'Discount systems should be merged into the per-system bullets without a duplicated overview bullet'
);
assert.doesNotMatch(
  html,
  /class="exp-subhead"/,
  'Discount projects should not use a standalone heading'
);
assert.match(
  html,
  /<li class="exp-projects">[\s\S]*פרויקטים מרכזיים שעבדתי[\s\S]*עליהם:[\s\S]*<ul class="exp-project-list">[\s\S]*<b>מפנה<\/b>[\s\S]*<b>תצפית<\/b>[\s\S]*<span class="en"><b>CCM<\/b><\/span>/,
  'Discount projects should be nested under one bullet heading'
);
assert.match(
  html,
  /\.exp-project-list\s*\{[\s\S]*margin:[\s\S]*padding:/,
  'Nested project bullets should have compact list styling'
);
assert.match(
  html,
  /<button[^>]*id="btnAiPrompt"[^>]*onclick="openAiPromptDialog\(\)"[^>]*aria-label="עריכת הנחיות ל-AI"[\s\S]*<\/button>/,
  'Settings should expose the AI instruction through an icon button instead of a visible textarea'
);
assert.match(
  html,
  /<div class="modal-overlay" id="aiPromptModal"[\s\S]*<textarea id="scriptPrompt"[\s\S]*<\/textarea>[\s\S]*id="btnSaveAiPrompt"/,
  'AI instruction editing should happen in its own dialog with the existing scriptPrompt textarea'
);
const settingsModalHtml = html.slice(html.indexOf('id="settingsModal"'), html.indexOf('id="archiveModal"'));
assert.doesNotMatch(
  settingsModalHtml,
  /scriptPrompt/,
  'The main settings screen should not show the AI instruction label above the script area'
);
assert.match(
  html,
  /<h3 class="set-col-title set-title-row">[\s\S]*הגדרות הקראה[\s\S]*id="verCombo"[\s\S]*id="btnNewVersion"[\s\S]*id="btnAiPrompt"/,
  'Version combo, new version, and AI prompt icon should sit in the narration settings title row'
);
const scriptToolbarHtml = html.slice(
  html.indexOf('<label class="set-label">תסריט ההקראה</label>'),
  html.indexOf('<textarea id="scriptArea"')
);
assert.doesNotMatch(
  scriptToolbarHtml,
  /btnNewVersion/,
  'The script toolbar should no longer contain the new-version button'
);
assert.match(
  html,
  /<textarea id="scriptArea"[^>]*oncontextmenu="openScriptContextMenu\(event\)"/,
  'The script textarea should open an AI context menu on right-click'
);
assert.match(
  html,
  /id="scriptContextMenu"[\s\S]*ניקוד[\s\S]*ניסוח מחדש[\s\S]*הוראות להקלטה/,
  'The script context menu should offer niqqud, rewrite, and recording-instruction actions'
);
assert.match(
  html,
  /function recordNarration\(\)[\s\S]*if \(recInProgress \|\| recSession\) \{ stopActiveRecording\(\); return; \}[\s\S]*btn\.disabled = false; btn\.textContent = '⏹ עצור';/,
  'Record button should remain clickable as a stop button while recording'
);

const mafneItem = listItemContaining('<b>מפנה</b>');
assert.match(mafneItem, /מערכת לניהול ייעוציים פנסיוניים ללקוחות הבנק[\s\S]*ASP\.NET[\s\S]*SSRS/);
assert.match(mafneItem, /פיתחתי דפים חדשים[\s\S]*ערכתי דפים קיימים רבים[\s\S]*דוחות[\s\S]*SSRS/);

const tatzpitItem = listItemContaining('<b>תצפית</b>');
assert.match(tatzpitItem, /מערכת הייעוץ של שוק ההון ללקוחות העסקיים של[\s\S]*דיסקונט[\s\S]*JAVA\/J2EE[\s\S]*JSP[\s\S]*JASPER/);
assert.match(tatzpitItem, /פיתחתי רבות גם[\s\S]*UI[\s\S]*צד שרת[\s\S]*קישור למסד נתונים[\s\S]*דוחות[\s\S]*JASPER/);

const ccmItem = listItemContaining('<span class="en"><b>CCM</b></span>');
assert.match(ccmItem, /מערכת קשרי לקוחות וניהול מגבלות לוגיות על שליחת הודעות[\s\S]*מיילים/);
assert.match(ccmItem, /C#[\s\S]*Vue\.js 2\.0[\s\S]*NET Core 3\.1/);
assert.match(ccmItem, /יצרתי את ה-[\s\S]*UI[\s\S]*עבדתי רבות ב-[\s\S]*UI/);
const crossSystemItem = listItemContaining('מערכות <span class="en">Web</span> בנקאיות קריטיות');
assert.match(crossSystemItem, /שדרוג ממשקים[\s\S]*מערכות ליבה ותיקות[\s\S]*טכנולוגיות חדשות/);
assert.doesNotMatch(crossSystemItem, /Java\/J2EE|ASP\.NET|Vue\.js 2\.0|NET Core 3\.1/);
assert.match(
  html,
  /ממשק שוטף מול גורמים עסקיים ומשתמשי קצה בבנק/,
  'Discount experience should keep the original stakeholder interface bullet'
);
assert.match(
  html,
  /היכרות עמוקה עם מערכות הבנק ונהליו/,
  'Discount experience should keep the original bank familiarity bullet'
);

console.log('export dot paint metrics match the CSS dot geometry');
