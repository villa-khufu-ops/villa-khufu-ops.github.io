// Smoke tests for the most used flows. Run: python3 tests/build.py && node tests/smoke.js
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'site');
const srv = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'admin.html');
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); r.end(d); }); });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  await new Promise(r => srv.listen(8799, r));
  const b = await chromium.launch();
  const page = async (f, q = '') => { const p = await b.newPage({ viewport: { width: 420, height: 1200 } }); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto('http://localhost:8799/' + f + q); await p.waitForTimeout(2000); return p; };
  const txt = p => p.locator('body').innerText();
  let t;

  // 1. manager home + main tiles
  let p = await page('admin.html');
  ok((await txt(p)).length > 50, 'manager home renders');
  ok(await p.locator('[data-v="rec"]').count() > 0, 'reception tile present');
  ok(p.errs.length === 0, 'manager home: no script errors ' + p.errs.join(' | '));

  // 1b. manager dashboard
  p = await page('admin.html');
  await p.click('[data-v="dash"]', { force: true }); await p.waitForTimeout(800);
  t = await txt(p);
  ok(t.includes('الإشغال') && t.includes('الفلوس النهارده'), 'manager dashboard renders');
  ok(t.includes('العربيات والسواقين'), 'dashboard shows drivers');
  await p.click('[data-v="drv-rep"]', { force: true }); await p.waitForTimeout(800);
  t = await txt(p);
  ok(t.includes('تقرير السواقين') && t.includes('مشوار'), 'driver report renders');
  ok(p.errs.length === 0, 'dashboard: no script errors ' + p.errs.join(' | '));

  // 2. restaurant order with service + VAT
  p = await page('rec.html');
  await p.click('[data-v="rest"]', { force: true }); await p.waitForTimeout(400);
  await p.click('[data-a="cat"][data-i="4"]'); await p.waitForTimeout(200);
  await p.locator('[data-a="q"][data-d="1"]').first().click(); await p.waitForTimeout(200);
  await p.click('.cartbar'); await p.waitForTimeout(400);
  t = await txt(p);
  ok(/خدمة 12%/.test(t) && /ضريبة 14%/.test(t), 'cart shows service and VAT');
  ok(t.includes('10.21'), 'pizza $8 total with service and VAT is $10.21');
  ok(p.errs.length === 0, 'restaurant: no script errors ' + p.errs.join(' | '));

  // 3. open accounts page
  p = await page('rec.html');
  await p.click('[data-v="rec"]', { force: true }).catch(() => {}); await p.waitForTimeout(300);
  const acc = p.locator('[data-v="rec-acc"]');
  if (await acc.count()) { await acc.first().click({ force: true }); await p.waitForTimeout(500); ok((await txt(p)).length > 50, 'accounts page renders'); }
  ok(p.errs.length === 0, 'accounts: no script errors ' + p.errs.join(' | '));

  // 4. statement lookup
  p = await page('rec.html');
  const inq = p.locator('[data-v="rec-inq"]');
  if (await inq.count()) { await inq.first().click({ force: true }); await p.waitForTimeout(300); await p.fill('#inqno', '104'); await p.click('#inqForm button'); await p.waitForTimeout(1200);
    ok(await p.locator('[data-a="invPrint"]').count() > 0, 'room statement opens with print button'); }
  ok(p.errs.length === 0, 'statement: no script errors ' + p.errs.join(' | '));

  // 5. kitchen: unprinted ticket alert
  p = await page('kitchen.html');
  await p.click('[data-v="kit"]', { force: true }); await p.waitForTimeout(500);
  ok((await txt(p)).includes('ما اتطبعش'), 'kitchen shows the unprinted ticket alert');
  ok(p.errs.length === 0, 'kitchen: no script errors ' + p.errs.join(' | '));

  // 6. guest QR: room, food, totals
  p = await page('guest.html', '?guest');
  await p.locator('#groom').fill('104'); await p.click('[data-a="gRoom"]'); await p.waitForTimeout(500);
  await p.click('[data-t="food"]'); await p.waitForTimeout(300);
  ok(await p.locator('[data-a="gCat"]').count() >= 8, 'guest menu categories');
  ok(p.errs.length === 0, 'guest page: no script errors ' + p.errs.join(' | '));
  p = await page('guest.html', '?guest&pre');
  ok((await txt(p)).includes('Make your tours'), 'pre-arrival page renders');

  // 7. attendance page
  p = await page('rec.html');
  const att = p.locator('[data-v="att"]');
  if (await att.count()) { await att.first().click({ force: true }); await p.waitForTimeout(400); }
  ok(p.errs.length === 0, 'attendance: no script errors ' + p.errs.join(' | '));

  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
