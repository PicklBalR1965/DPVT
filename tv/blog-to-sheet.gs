/**
 * Doylestown Pickleball Club TV: Blogger -> "Slides" sheet
 *
 * Every hour this checks https://dtownpickl3.blogspot.com and adds each new post
 * to the Slides sheet as a "blog" slide (photo + QR code to the post).
 *   - Start Date = the day the post was published
 *   - End Date   = 7 days later, UNLESS the post lists a last day
 *                  ("Orders close Sunday, November 1", "Date: Saturday, October 17", "until Dec 5"...)
 * Blog rows are removed from the sheet a day after their End Date.
 * You can edit or uncheck any blog row like a normal slide; it won't be re-added.
 *
 * Setup (one time): Extensions > Apps Script, paste this file, Save, then run "setup" and approve.
 */

const BLOG = 'https://dtownpickl3.blogspot.com';
const SHEET = 'Slides';
const DAYS = 7;          // how long a post stays up when it has no last day
const SECONDS = 15;      // how long each blog slide shows
const ACCENT = 'navy';

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncBlogToSlides')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncBlogToSlides').timeBased().everyHours(1).create();
  syncBlogToSlides();
}

function syncBlogToSlides() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  const width = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(h => String(h).toLowerCase());
  const col = name => head.findIndex(h => h.indexOf(name) >= 0);
  const C = { show: col('show'), type: col('type'), title: col('title'), sub: col('subtitle'),
              det: col('detail'), link: col('link'), start: col('start'), end: col('end'),
              secs: col('second'), acc: col('accent'), photo: col('photo') };

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 1) remove blog rows that ended more than a day ago
  let rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i], end = r[C.end];
    if (String(r[C.type]).trim() === 'blog' && end instanceof Date && end.getTime() < today.getTime() - 864e5) {
      sh.deleteRow(i + 2);
    }
  }
  rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const have = new Set(rows.map(r => String(r[C.link]).trim()).filter(String));

  // 2) read the blog
  const feed = JSON.parse(UrlFetchApp.fetch(BLOG + '/feeds/posts/default?alt=json&max-results=15').getContentText());
  const entries = (feed.feed.entry || []).slice().reverse();   // oldest first

  entries.forEach(e => {
    const alt = (e.link || []).find(l => l.rel === 'alternate');
    const url = alt ? alt.href : '';
    if (!url || have.has(url)) return;

    const pub = new Date(e.published.$t);
    const text = plainText(e.content ? e.content.$t : (e.summary ? e.summary.$t : ''));
    let end = lastDay(text, pub, e.title.$t);
    if (!end) { end = new Date(pub); end.setDate(end.getDate() + DAYS); }
    end.setHours(0, 0, 0, 0);
    if (end.getTime() < today.getTime()) return;            // already over

    const start = new Date(pub); start.setHours(0, 0, 0, 0);
    const snippet = text.length > 170 ? text.slice(0, 170).replace(/\s+\S*$/, '') + '…' : text;
    const photo = e.media$thumbnail ? bigImg(e.media$thumbnail.url) : '';

    const row = new Array(width).fill('');
    row[C.show] = true; row[C.type] = 'blog'; row[C.title] = e.title.$t; row[C.det] = snippet;
    row[C.link] = url; row[C.start] = start; row[C.end] = end; row[C.secs] = SECONDS;
    row[C.acc] = ACCENT; if (C.photo >= 0) row[C.photo] = photo;

    // write into the first row with an empty Title (checkbox rows below the slides are "empty")
    const all = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), width).getValues();
    let idx = all.findIndex(r => String(r[C.title]).trim() === '');
    if (idx < 0) { sh.insertRowAfter(sh.getMaxRows()); idx = all.length; }
    sh.getRange(idx + 2, 1, 1, width).setValues([row]);
    have.add(url);
  });
}

function plainText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// Finds the post's last day.
//  Strong clues win: closes / ends / until / through / deadline / last day / "Date:" + Month Day, or a date in the title.
//  Weak clue ("by Month Day") is only used when there is no strong one.
function lastDay(text, pub, title) {
  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const fix = d => { if (d.getTime() < pub.getTime() - 60 * 864e5) d.setFullYear(d.getFullYear() + 1); return d; };
  const scan = (re, src) => { let m, best = null; re.lastIndex = 0;
    while ((m = re.exec(src))) { const d = fix(new Date(pub.getFullYear(), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), +m[3]));
      if (!best || d > best) best = d; } return best; };
  const MD = '\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?!\\d)';
  const strong = new RegExp('(clos(?:e|es|ing)|ends?\\b|until|through|thru|deadline|last day|date:?)[^.!?]{0,25}?' + MD, 'gi');
  const weak = new RegExp('(\\bby)[^.!?]{0,25}?' + MD, 'gi');
  let best = scan(strong, text);
  // dates written in the title, like "Polo Match | 9/26/2026" or "Open House Dec 5"
  const t = String(title || '');
  const num = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/);
  if (num) { const d = fix(new Date(pub.getFullYear(), +num[1] - 1, +num[2])); if (!best || d > best) best = d; }
  const named = scan(new RegExp('(x?)' + MD, 'gi'), t.replace(/order by|by /gi, '~'));
  if (named && (!best || named > best) && !/\bby\b/i.test(t)) best = named;
  return best || scan(weak, text);
}

function bigImg(u) {
  return String(u || '').replace(/\/s\d+(-c)?\//, '/s1600/').replace(/=s\d+(-c)?$/, '=s1600');
}
