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

  // 6b. driver account: sees only his transfers, with weekday, guest phone and flight
  p = await page('driver.html');
  t = await txt(p);
  ok(t.includes('انتقالاتي') && t.includes('MS 778') && t.includes('7700 900123') && t.includes('بكرة'), 'driver page shows his transfer with phone and flight');
  ok(/الأحد|الاتنين|التلات|الأربع|الخميس|الجمعة|السبت/.test(t), 'driver page shows the weekday');
  ok(!t.includes('05:00'), 'driver page hides other drivers transfers');
  ok(await p.locator('a[href^="tel:"]').count() === 1, 'driver page has a call button');
  ok(p.errs.length === 0, 'driver page: no script errors ' + p.errs.join(' | '));

  // 6c. company order + monthly account
  p = await page('rec.html');
  await p.click('[data-v="co-acc"]', { force: true }); await p.waitForTimeout(600);
  t = await txt(p);
  ok(t.includes('Blue Sky') && t.includes('حسابات الشركات'), 'company accounts page shows Blue Sky');
  p = await page('rec.html');
  await p.click('[data-v="rest"]', { force: true }); await p.waitForTimeout(400);
  await p.click('[data-a="cat"][data-i="4"]'); await p.waitForTimeout(200);
  await p.locator('[data-a="q"][data-d="1"]').first().click(); await p.waitForTimeout(200);
  await p.click('.cartbar'); await p.waitForTimeout(400);
  await p.click('[data-a="dest"][data-d="co"]'); await p.waitForTimeout(200);
  await p.click('[data-a="pickCo"]'); await p.waitForTimeout(200);
  await p.click('[data-a="sendOrder"]'); await p.waitForTimeout(500);
  const coO = await p.evaluate(() => Object.values(__DB.orders).filter(o => o.pay === 'co'));
  ok(coO.length === 1 && coO[0].co === 'bluesky' && coO[0].paid === false && coO[0].total === 10.21, 'restaurant order goes on Blue Sky, unpaid');
  await p.evaluate(() => { const b = document.createElement('button'); b.dataset.a = 'go'; b.dataset.v = 'co-acc'; b.id = 'goco'; document.getElementById('app').appendChild(b); });
  await p.click('#goco', { force: true }); await p.waitForTimeout(600);
  t = await txt(p);
  ok(t.includes('10.21') && t.includes('الشركة دفعت'), 'company account shows the order and pay button');
  await p.click('[data-a="coPay"]'); await p.waitForTimeout(400); await p.click('[data-a="coPay"][data-m="cash"]'); await p.waitForTimeout(500);
  const paid = await p.evaluate(() => Object.values(__DB.orders).filter(o => o.pay === 'co' && o.paid).length);
  ok(paid === 1, 'company pay marks orders paid');
  await p.evaluate(() => { __DB.orders.cx1 = { d: new Date().toISOString().slice(0,10), at: Date.now(), by: 'r1', dest: 'co', co: 'bluesky', coName: 'Blue Sky', items: [{ n: 'Koshari', p: 5, q: 2 }], total: 12.77, tx: 1, st: 'served', no: 9, pay: 'co', paid: false }; });
  await p.click('[data-a="coMonth"]', { force: true }); await p.waitForTimeout(300);
  ok(p.errs.length === 0, 'company accounts: no script errors ' + p.errs.join(' | '));

  // 6d. print station prints orders sent from phones that are not on the hotel Wi-Fi
  { const ps = await b.newPage(); ps.errs = []; ps.on('pageerror', e => ps.errs.push(e.message));
    await ps.addInitScript(() => { localStorage.setItem('vkStation', '1'); window.__P = []; window.VKApp = { printRaw: function (ip, port, data, id) { __P.push(ip); setTimeout(() => window.vkPrintDone(id, 'ok'), 50); }, version: () => '1.10' }; });
    await ps.goto('http://localhost:8799/kitchen.html'); await ps.waitForTimeout(1500);
    await ps.evaluate(() => { const f = firebase.firestore(); f.collection('prt').doc('n1').set({ st: 'none', at: Date.now(), by: 'r1', no: 5, err: '' }); f.collection('orders').doc('n1').set({ d: new Date().toISOString().slice(0, 10), at: Date.now() - 5000, by: 'r1', dest: 'table', table: '7', items: [{ n: 'Koshari', p: 5, q: 1 }], total: 6.4, st: 'new', no: 5, pay: 'cash', paid: true }); });
    await ps.waitForTimeout(6000);
    ok(await ps.evaluate(() => __P.length === 1 && __DB.prt.n1.st === 'ok' && !!__DB.prt.station), 'print station prints the order once and marks it printed');
    ok(ps.errs.length === 0, 'print station: no script errors ' + ps.errs.join(' | ')); }

  // 7. attendance page
  p = await page('rec.html');
  const att = p.locator('[data-v="att"]');
  if (await att.count()) { await att.first().click({ force: true }); await p.waitForTimeout(400); }
  ok(p.errs.length === 0, 'attendance: no script errors ' + p.errs.join(' | '));

  await b.close(); srv.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
