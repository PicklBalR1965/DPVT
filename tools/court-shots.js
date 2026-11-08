// Photographs the CourtReserve court widgets and writes JPEGs + meta.json into ./out
// Run by .github/workflows/court-shots.yml every 30 minutes.
const { chromium } = require('playwright');
const fs = require('fs');

const IDS = ['21564', '106548', '106549'];          // Indoor 1-5, Outdoor 1-12, Outdoor 13-16
const ORG = '6688';

// Runs inside the page: relabel private events and hide the widget's own "now" marker
function relabel() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(n => {
    if (/private event/i.test(n.nodeValue)) {
      n.nodeValue = n.nodeValue
        .replace(/-=\s*Private Event[^=]*=-/gi, 'Private Event')
        .replace(/Private Event\s+[A-Z0-9]{4,8}\b/g, 'Private Event');
    }
  });
}

// Runs inside the page: read every event on the scheduler grid, keyed by court column
function extract() {
  const clean = t => String(t || '').replace(/-=\s*Private Event[^=]*=-/gi, 'Private Event').replace(/Private Event\s+[A-Z0-9]{4,8}\b/g, 'Private Event').replace(/\s+/g, ' ').trim();
  const hd = [...document.querySelectorAll('#CourtsScheduler .k-scheduler-header th')].map(t => {
    const r = t.getBoundingClientRect(); return { n: t.textContent.trim(), l: r.left, r: r.right };
  }).filter(h => /^[A-Z]{2}\d{1,2}$/.test(h.n));
  const out = { courts: hd.map(h => h.n), ev: {} };
  hd.forEach(h => { out.ev[h.n] = []; });
  document.querySelectorAll('#CourtsScheduler .k-event').forEach(e => {
    const r = e.getBoundingClientRect(), mid = (r.left + r.right) / 2;
    const h = hd.find(x => mid >= x.l && mid <= x.r); if (!h) return;
    const tm = (e.querySelector('.event-time') || {}).textContent || '';
    const m = tm.match(/(\d{1,2}:\d{2})\s*([AP]M)\s*-\s*(\d{1,2}:\d{2})\s*([AP]M)/i); if (!m) return;
    const mins = (hm, ap) => { const p = hm.split(':').map(Number); let hh = p[0] % 12; if (/p/i.test(ap)) hh += 12; return hh * 60 + p[1]; };
    const lines = e.innerText.split('\n').map(clean).filter(Boolean);
    const cat = lines[0] || '';
    const title = (lines[1] && !/\d:\d\d\s*[AP]M/i.test(lines[1])) ? lines[1] : cat;
    out.ev[h.n].push({ s: mins(m[1], m[2]), e: mins(m[3], m[4]), cat: cat, title: title });
  });
  return out;
}

(async () => {
  fs.mkdirSync('out', { recursive: true });
  // start from the last published files so a failed capture never wipes a good picture
  try { fs.readdirSync('prev').filter(f => /^(courts-.*\.jpg|meta\.json|courts\.json)$/.test(f)).forEach(f => fs.copyFileSync('prev/' + f, 'out/' + f)); } catch (e) {}
  const log = [];
  const note = m => { console.log(m); log.push(m); };
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync('prev/meta.json', 'utf8')).shots || {}; } catch (e) {}
  const shots = Object.assign({}, prev);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1520 }, timezoneId: 'America/New_York', locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  let ok = 0;
  let board = { widgets: {} };
  try { board = JSON.parse(fs.readFileSync('prev/courts.json', 'utf8')); } catch (e) {}
  for (const id of IDS) {
    const page = await ctx.newPage();
    try {
      // 'networkidle' never happens here (the widget keeps a live connection open), so wait for the DOM instead
      await page.goto(`https://widgets.courtreserve.com/Online/Public/EmbedCode/${ORG}/${id}`,
        { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('#CourtsScheduler .k-scheduler-content', { timeout: 30000 });
      await page.waitForTimeout(4000);
      await page.addStyleTag({ content: '.k-current-time,.k-current-time-arrow,.k-scheduler-now-arrow{display:none!important}' });
      await page.evaluate(relabel);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `out/courts-${id}.jpg`, type: 'jpeg', quality: 80 });
      shots[id] = Date.now();
      try {
        const d = await page.evaluate(extract);
        if (d.courts.length) { d.ts = shots[id]; board.widgets[id] = d; note(id + ': ' + d.courts.length + ' courts, ' + Object.values(d.ev).reduce((a, b) => a + b.length, 0) + ' events'); }
      } catch (e3) { note('extract failed ' + id + ': ' + e3.message.split('\n')[0]); }
      ok++;
      note('captured ' + id);
    } catch (e) {
      note('FAILED ' + id + ': ' + e.message.split('\n')[0]);
      try {   // leave clues so a failure can be diagnosed from the published branch
        await page.screenshot({ path: `out/debug-${id}.png` });
        const txt = await page.evaluate(() => document.title + ' | ' + (document.body ? document.body.innerText : '').slice(0, 400));
        note('page ' + id + ': ' + txt.replace(/\s+/g, ' '));
      } catch (e2) { note('no debug for ' + id + ': ' + e2.message.split('\n')[0]); }
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync('out/courts.json', JSON.stringify(board));
  fs.writeFileSync('out/log.txt', log.join('\n') + '\n');
  if (!ok) process.exit(1);                         // nothing new: the old pictures stay published

  // "ts" is the OLDEST picture, so the TV never claims a screen is fresher than it is
  const times = IDS.map(id => shots[id] || 0);
  const meta = { ts: Math.min.apply(null, times), shots, written: Date.now() };
  fs.writeFileSync('out/meta.json', JSON.stringify(meta));
  console.log('meta', JSON.stringify(meta));
})();
