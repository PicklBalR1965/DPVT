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

(async () => {
  fs.mkdirSync('out', { recursive: true });
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync('prev/meta.json', 'utf8')).shots || {}; } catch (e) {}
  const shots = Object.assign({}, prev);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1520 }, timezoneId: 'America/New_York', locale: 'en-US'
  });
  let ok = 0;
  for (const id of IDS) {
    const page = await ctx.newPage();
    try {
      await page.goto(`https://widgets.courtreserve.com/Online/Public/EmbedCode/${ORG}/${id}`,
        { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForSelector('#CourtsScheduler .k-scheduler-content', { timeout: 30000 });
      await page.waitForTimeout(4000);
      await page.addStyleTag({ content: '.k-current-time,.k-current-time-arrow,.k-scheduler-now-arrow{display:none!important}' });
      await page.evaluate(relabel);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `out/courts-${id}.jpg`, type: 'jpeg', quality: 80 });
      shots[id] = Date.now();
      ok++;
      console.log('captured', id);
    } catch (e) {
      console.error('FAILED', id, e.message);
      if (fs.existsSync(`prev/courts-${id}.jpg`) && !fs.existsSync(`out/courts-${id}.jpg`)) {
        fs.copyFileSync(`prev/courts-${id}.jpg`, `out/courts-${id}.jpg`);   // keep the last good picture
      }
    }
    await page.close();
  }
  await browser.close();
  if (!ok) process.exit(1);                         // nothing new: leave the published pictures alone

  // "ts" is the OLDEST picture, so the TV never claims a screen is fresher than it is
  const times = IDS.map(id => shots[id] || 0);
  const meta = { ts: Math.min.apply(null, times), shots, written: Date.now() };
  fs.writeFileSync('out/meta.json', JSON.stringify(meta));
  console.log('meta', JSON.stringify(meta));
})();
