// Villa Khufu – Aiosell -> Operations app room sync (cloud version, runs on GitHub Actions every 10 minutes)
// Aiosell is READ ONLY: this script only reads the Room Status Report and the Arrival Report.
// Log-ins come from GitHub Secrets (AIOSELL_USER, AIOSELL_PASS, APP_USER, APP_PASS) and are never printed.
// The browser session is kept between runs ENCRYPTED (key = the secrets), so it logs in only when Aiosell asks.
// Usage:
//   node sync/sync.js        normal run (writes changes)
//   node sync/sync.js --dry  test run (shows changes, writes nothing)

const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const DIR = __dirname;
const STATE = path.join(DIR, '.state', 'session.enc');
const ENV = process.env;
const AIOSELL_URL = 'https://pms.aiosell.com/reports/bc25795482';
const APP_URL = 'https://villa-khufu-ops.github.io/';
const DRY = process.argv.includes('--dry');

function stamp() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' });
}
function log(msg) {
  // the repo is public, so its run logs are too: never log passwords, guest names or notes – only room numbers
  let line = `[${stamp()}]${DRY ? ' [تجربة]' : ''} ${msg}\n`;
  for (const k of ['AIOSELL_USER', 'AIOSELL_PASS', 'APP_USER', 'APP_PASS']) if (ENV[k]) line = line.split(ENV[k]).join('***');
  process.stdout.write(line);
}
const todayCairo = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

// hard stop so a stuck run never blocks the next one
setTimeout(() => { log('خطأ: الدورة أخدت أكتر من 7 دقايق واتقفلت'); process.exit(2); }, 7 * 60 * 1000).unref();

// ---------- browser + encrypted session ----------
let BROWSER = null;
const stateKey = () => crypto.scryptSync(String(ENV.AIOSELL_PASS || '') + '|' + String(ENV.APP_PASS || ''), 'villa-khufu-sync', 32);
function loadState() {
  try {
    const b = fs.readFileSync(STATE);
    const d = crypto.createDecipheriv('aes-256-gcm', stateKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch (_) { return undefined; }
}
async function saveState(ctx) {
  try {
    const st = Buffer.from(JSON.stringify(await ctx.storageState()), 'utf8');
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', stateKey(), iv);
    const enc = Buffer.concat([c.update(st), c.final()]);
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    fs.writeFileSync(STATE, Buffer.concat([iv, c.getAuthTag(), enc]));
  } catch (_) {}
}
async function openContext() {
  if (!BROWSER) BROWSER = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  return BROWSER.newContext({
    viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'Africa/Cairo',
    bypassCSP: true, // the app's security policy blocks the script's page checks otherwise
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    storageState: loadState(),
  });
}

// signs the app (Firebase) in with APP_USER / APP_PASS when the saved session is gone
async function appSignIn(page) {
  await page.waitForFunction(() => window.firebase && firebase.apps && firebase.apps.length, null, { timeout: 60000 });
  const uid = await page.evaluate(() => new Promise((res) => {
    const un = firebase.auth().onAuthStateChanged((u) => { un(); res(u ? u.uid : null); });
    setTimeout(() => res(null), 20000);
  }));
  if (uid) return uid;
  if (!ENV.APP_USER || !ENV.APP_PASS) throw new Error('ناقص APP_USER أو APP_PASS في GitHub Secrets');
  const r = await page.evaluate(async ({ u, p }) => {
    try { const c = await firebase.auth().signInWithEmailAndPassword(u.includes('@') ? u : u + '@villakhufu.app', p); return { uid: c.user.uid }; }
    catch (e) { return { err: String(e && e.code || e) }; }
  }, { u: ENV.APP_USER.trim().toLowerCase(), p: ENV.APP_PASS });
  if (!r.uid) throw new Error('تسجيل الدخول على الأبلكيشن فشل (' + r.err + ') · راجع APP_USER و APP_PASS');
  return r.uid;
}

// ---------- Aiosell ----------
async function isLoginPage(page) {
  if (/login|signin|auth/i.test(page.url())) return true;
  return page.locator('input[type="password"]').first().isVisible().catch(() => false);
}

// logs in to Aiosell with AIOSELL_USER / AIOSELL_PASS (only reads: Aiosell is never changed)
async function aiosellLogin(page) {
  if (!ENV.AIOSELL_USER || !ENV.AIOSELL_PASS) throw new Error('ناقص AIOSELL_USER أو AIOSELL_PASS في GitHub Secrets');
  if (!(await isLoginPage(page))) {
    await page.context().clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} }).catch(() => {});
    await page.goto(AIOSELL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  }
  const pass = page.locator('input[type="password"]').first();
  if (!(await pass.isVisible().catch(() => false))) {
    await page.screenshot({ path: path.join(DIR, 'login-page.png') }).catch(() => {});
    throw new Error('مش لاقي صفحة تسجيل الدخول بتاعة Aiosell · ' + page.url());
  }
  await page.screenshot({ path: path.join(DIR, 'login-page.png') }).catch(() => {}); // empty login form, for troubleshooting
  const user = page.locator('input[type="email"], input[name*="user" i], input[name*="email" i], input[formcontrolname*="user" i], input[formcontrolname*="email" i], input[type="text"]').first();
  await user.fill(ENV.AIOSELL_USER);
  await pass.fill(ENV.AIOSELL_PASS);
  const btn = page.getByRole('button', { name: /log\s*in|sign\s*in|submit|continue/i });
  if (!(await tryClick(btn, 4000))) await pass.press('Enter');
  await page.waitForTimeout(8000);
  if (await isLoginPage(page)) {
    await page.locator('input').evaluateAll((l) => l.forEach((i) => { i.value = ''; })).catch(() => {});
    await page.screenshot({ path: path.join(DIR, 'login-failed.png') }).catch(() => {});
    throw new Error('Aiosell رفض تسجيل الدخول · راجع AIOSELL_USER و AIOSELL_PASS (أو Aiosell طالب كود تأكيد)');
  }
  log('اتعمل تسجيل دخول على Aiosell');
  await page.goto(AIOSELL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
}

async function tryClick(locator, timeout = 4000) {
  try { await locator.first().click({ timeout }); return true; } catch (_) { return false; }
}

async function selectReport(page, name) {
  const re = new RegExp('^\\s*' + name.replace(/\s+/g, '\\s*') + '\\s*$', 'i');
  // Aiosell uses an ng-select box (options open in a panel attached to <body>)
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = page.locator('ng-select.select-report .ng-select-container, ng-select .ng-select-container').first();
    await box.waitFor({ state: 'visible', timeout: 20000 });
    await box.click();
    await page.keyboard.type(name.split(' ').slice(0, 2).join(' '), { delay: 40 }).catch(() => {});
    try {
      const opt = page.locator('ng-dropdown-panel .ng-option').filter({ hasText: re }).first();
      await opt.waitFor({ state: 'visible', timeout: 8000 });
      await opt.click();
    } catch (_) {
      if (attempt === 2) break;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(2000);
      continue;
    }
    await page.waitForTimeout(800);
    // press Submit to load the report
    await tryClick(page.getByRole('button', { name: /^\s*Submit\s*$/i }), 5000);
    return;
  }
  await dumpPage(page);
  throw new Error(`مش لاقي اختيار ${name} (اتحفظ debug-aiosell.html)`);
}

const selectRoomStatus = (page) => selectReport(page, 'Room Status Report');

// saves the page structure for troubleshooting – tables (guest data) are removed first
async function dumpPage(page) {
  try {
    const html = await page.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll('table, script, style, svg, img').forEach((e) => e.remove());
      return c.outerHTML;
    });
    fs.writeFileSync(path.join(DIR, 'debug-aiosell.html'), html.slice(0, 400000));
  } catch (_) {}
}

async function readTable(page) {
  return page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((t) => /HouseKeeping/i.test(t.innerText));
    if (!t) return null;
    const date = (s) => ((s || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    const hr = (t.tHead && t.tHead.rows[t.tHead.rows.length - 1]) || t.rows[0];
    const hs = [...hr.cells].map((c) => (c.innerText || '').trim());
    const find = (re, def) => { const i = hs.findIndex((h) => re.test(h)); return i >= 0 ? i : def; };
    const ix = {
      room: find(/^room(\s*no\.?)?$|room\s*no/i, 0),
      status: find(/^status$/i, 2),
      pax: find(/^pax$|guests?|adults?/i, 3),
      meal: find(/meal/i, 4),
      in: find(/check\s*-?\s*in/i, 9),
      out: find(/check\s*-?\s*out/i, 10),
    };
    const body = t.tBodies.length ? [...t.tBodies].flatMap((b) => [...b.rows]) : [...t.rows].slice(1);
    // only the needed columns are read – guest names are never touched
    const rows = body.map((tr) => {
      const c = [...tr.cells].map((td) => (td.innerText || '').trim());
      const room = ((c[ix.room] || '').match(/\b\d{3}\b/) || [''])[0];
      const pax = parseInt(c[ix.pax], 10);
      return { room, status: c[ix.status] || '', pax: Number.isFinite(pax) ? pax : null, meal: c[ix.meal] || '', in: date(c[ix.in]), out: date(c[ix.out]) };
    }).filter((r) => r.room);
    return { rows, diag: `أعمدة=[${hs.join(' | ')}] صفوف=${body.length} أول خانة رقم الغرفة=[${body.slice(0, 4).map((tr) => ((tr.cells[ix.room] || {}).innerText || '').trim().slice(0, 15)).join(' , ')}]` };
  });
}

async function readAiosell(ctx) {
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400 && /aiosell/i.test(r.url())) bad.push(r.status() + ' ' + r.url().split('?')[0].slice(-60)); });
  try {
    await page.goto(AIOSELL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    // logged out shows either the login page or the report page with 401 errors and an empty list
    if ((await isLoginPage(page)) || bad.some((b) => /^401/.test(b))) { bad.length = 0; await aiosellLogin(page); }

    let rows = null;
    for (let attempt = 1; attempt <= 2 && !rows; attempt++) {
      await selectRoomStatus(page);
      try {
        await page.waitForFunction(
          () => [...document.querySelectorAll('table')].some((t) => /HouseKeeping/i.test(t.innerText)),
          null, { timeout: 15000 });
        await page.waitForTimeout(1500);
        const res = await readTable(page);
        if (res) { rows = res.rows; if (!rows.length) log('تشخيص الجدول: ' + res.diag); }
      } catch (_) { /* retry once */ }
    }
    if (!rows) {
      await page.screenshot({ path: path.join(DIR, 'error-aiosell.png') }).catch(() => {});
      throw new Error('جدول Room Status مظهرش في Aiosell (اتحفظت صورة error-aiosell.png)');
    }
    return rows.map((r) => ({ ...r, notes: null }));
  } catch (e) {
    const opts = await page.evaluate(() => [...document.querySelectorAll('ng-dropdown-panel .ng-option')].map((o) => o.innerText.trim()).slice(0, 40)).catch(() => []);
    log(`تشخيص: اختيارات القايمة=${opts.length} [${opts.join(' | ')}] · أخطاء السيرفر=${bad.length} [${bad.slice(0, 5).join(' , ')}] · ${page.url()}`);
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------- tomorrow's arrivals (Arrival Report with tomorrow's date) ----------
const tomorrowCairo = () => {
  const t = new Date(todayCairo() + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
async function readTomorrow(ctx) {
  const T = tomorrowCairo();
  const page = await ctx.newPage();
  try {
    await page.goto(AIOSELL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    if (await isLoginPage(page)) await aiosellLogin(page);
    const dates = page.locator('input[type="date"]');
    if ((await dates.count()) < 2) throw new Error('مش لاقي خانات التاريخ في تقرير الوصول');
    for (let attempt = 1; attempt <= 2; attempt++) {
      await dates.nth(0).fill(T);
      await dates.nth(1).fill(T);
      await page.waitForTimeout(500);
      await tryClick(page.getByRole('button', { name: /^\s*Submit\s*$/i }), 5000);
      await page.waitForTimeout(7000);
      const res = await page.evaluate((T) => {
        const dmy = T.split('-').reverse().join('-'); // 2026-11-04 -> 04-11-2026
        const t = [...document.querySelectorAll('table')].find((x) => /Special Comments/i.test(x.innerText) || /Checkin/i.test(x.innerText));
        if (!t) return { rows: [], noTable: true };
        const hr = (t.tHead && t.tHead.rows[t.tHead.rows.length - 1]) || t.rows[0];
        const hs = [...hr.cells].map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim());
        const ix = (re) => hs.findIndex((h) => re.test(h));
        const iR = ix(/^Room No/i), iP = ix(/^PAX/i), iI = ix(/^Checkin/i), iO = ix(/^Checkout/i), iM = ix(/^Rateplan/i), iC = ix(/Special Comments/i);
        const body = t.tBodies.length ? [...t.tBodies].flatMap((b) => [...b.rows]) : [...t.rows].slice(1);
        const toIso = (s) => { const m = (s || '').match(/(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ((s || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0]; };
        // only these columns are read – guest names, phones, e-mails and IDs are never touched
        const rows = body.map((tr) => {
          const c = [...tr.cells].map((td) => (td.innerText || '').trim());
          return { room: ((c[iR] || '').match(/\b\d{3}\b/) || [''])[0], pax: parseInt(c[iP], 10), in: toIso(c[iI]), out: toIso(c[iO]), meal: c[iM] || '', comment: iC >= 0 ? (c[iC] || '') : '' };
        }).filter((r) => r.in);
        return { rows, stale: rows.some((r) => r.in !== T), dmy };
      }, T);
      if (!res.noTable && !res.stale) return { T, rows: res.rows };
      if (res.noTable && attempt === 2) return { T, rows: [] }; // no table after submit = no arrivals
    }
    throw new Error('تقرير وصول بكرة ما اتحمّلش');
  } finally {
    await page.close().catch(() => {});
  }
}

function mapPlan(meal) {
  const w = (meal || '').trim().split(/\s+/)[0].toUpperCase();
  return { BB: 'BB', CP: 'BB', HB: 'HB', MAP: 'HB', FB: 'FB', AP: 'FB', RO: 'RO', EP: 'RO' }[w] || null;
}

// ---------- App / Firestore ----------
async function applyToApp(ctx, aiosellRows, tmr) {
  const page = await ctx.newPage();
  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await appSignIn(page);

    return await page.evaluate(async ({ A, TODAY, DRY, TMR }) => {
      const db = firebase.firestore();
      const uid = firebase.auth().currentUser.uid;
      const R = {};
      (await db.collection('rooms').get()).forEach((d) => { R[d.id] = d.data(); });

      const unpaid = new Set();
      for (const col of ['orders', 'laundry']) {
        (await db.collection(col).where('paid', '==', false).get()).forEach((d) => {
          const x = d.data();
          if (x.void === true || x.st === 'cancel' || x.room == null) return;
          unpaid.add(String(x.room));
        });
      }

      // rooms with an open to-do that reception still has to enter in Aiosell
      const pending = new Set();
      // (the old aio to-do list is no longer used)

      // the day (local) a room was checked out: a booking that started before that day is the guest who already left,
      // a booking that started that day or later is a new guest who came into the cleaned room
      const coDay = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      const upd = {}; const logs = [];
      const rep = { in: [], out: [], arrAdd: [], arrDel: [], plan: [], dates: [], pax: [], notes: [], skip: [] };
      const put = (room, data) => { upd[room] = Object.assign(upd[room] || {}, data); };
      const addLog = (room, type, reason) =>
        logs.push({ d: TODAY, at: Date.now(), room, type, by: uid, w: null, reason, src: 'aiosell' });
      const checkout = (room, arrival) => {
        if (unpaid.has(room)) {
          rep.skip.push(`${room}: عليها فاتورة مش متدفعة، مخرجتهاش`);
          if (!R[room].coHold) put(room, { coHold: Date.now() }); // reception sees a red alert with the open checks
          return;
        }
        const data = { status: 'clean', in: null, out: null, plan: null, pax: null, notes: null, sofa: false, cleanReq: null, coHold: null, coAt: Date.now(), cleanAt: null, src: 'aiosell' };
        // a stay-cleaning task still open on this room becomes a full departure cleaning for the same worker
        const ot = R[room].task;
        if (ot && ot.w) { data.task = { w: ot.w, st: 'new', at: Date.now(), ackAt: 0, next: 0, doneAt: 0 }; logs.push({ d: TODAY, at: Date.now(), room, type: 'assign', by: uid, w: ot.w, reason: 'خروج · تنظيف كامل', src: 'aiosell' }); }
        else if (ot) data.task = null;
        if (arrival) data.arrival = arrival;
        put(room, data);
        const arrToday = arrival || (R[room].arrival && R[room].arrival.in && R[room].arrival.in <= TODAY);
        addLog(room, 'checkout', 'خروج · تنظيف كامل' + (arrToday ? ' · وصول النهارده' : ''));
        rep.out.push(room);
      };

      // one row per room: Checked In > Assigned > empty
      const rank = (s) => (/checked\s*in/i.test(s) ? 2 : /assigned/i.test(s) ? 1 : 0);
      const byRoom = {};
      for (const a of A) if (!byRoom[a.room] || rank(a.status) > rank(byRoom[a.room].status)) byRoom[a.room] = a;

      for (const room of Object.keys(byRoom).sort()) {
        const a = byRoom[room]; const r = R[room];
        if (!r) { rep.skip.push(`${room}: مش موجودة في الأبلكيشن`); continue; }
        const occ = r.status === 'occ';
        const k = rank(a.status);
        const setPaxNotes = () => {
          if (a.pax != null && r.pax !== a.pax) { put(room, { pax: a.pax }); rep.pax.push(`${room}: ${a.pax}`); }
          if (a.notes && r.notes !== a.notes) { put(room, { notes: a.notes }); rep.notes.push(room); }
        };
        if (pending.has(room)) {
          if (occ && k > 0) setPaxNotes();
          rep.skip.push(`غرفة ${room} مستنية تتسجّل على Aiosell`);
          continue;
        }

        if (k === 2) { // Checked In
          if (!a.in || !a.out) { rep.skip.push(`${room}: تواريخ ناقصة في Aiosell`); continue; }
          if (occ) {
            if (r.in !== a.in || r.out !== a.out) { put(room, { in: a.in, out: a.out }); rep.dates.push(room); }
            if (a.plan && r.plan !== a.plan) { put(room, { plan: a.plan }); rep.plan.push(`${room} ${a.plan}`); }
            setPaxNotes();
          } else if (r.status === 'maint') {
            rep.skip.push(`${room}: Checked In في Aiosell بس الغرفة صيانة في الأبلكيشن`);
          } else if (a.out <= TODAY) {
            rep.skip.push(`${room}: Aiosell لسه بيقول Checked In بس الخروج النهارده والأبلكيشن مخرّجها`);
          } else if (r.coAt && Date.now() - r.coAt < 36 * 3600000 && a.in < coDay(r.coAt)
                     && !(r.arrival && r.arrival.in === a.in)) {
            // reception checked this guest out in the app (early departure) and Aiosell isn't updated yet:
            // don't put the old guest back in the room, or the cleaned room would need cleaning again
            rep.skip.push(`${room}: الأبلكيشن عامل لها تشيك آوت بدري وAiosell لسه بيقول Checked In · سجّل الخروج على Aiosell`);
          } else {
            put(room, { status: 'occ', in: a.in, out: a.out, plan: a.plan, pax: a.pax, notes: (r.arrival && r.arrival.notes) || r.notes || null, sofa: false, cleanReq: null, task: null, arrival: null, src: 'aiosell' });
            addLog(room, 'checkin', 'تشيك إن من Aiosell');
            rep.in.push(room);
          }
        } else if (k === 1) { // Assigned
          if (!a.in || a.in > TODAY) continue;
          const arr = { in: a.in, out: a.out || null, plan: a.plan, pax: a.pax, notes: (r.arrival && r.arrival.in === a.in && r.arrival.notes) || null, src: 'aiosell' };
          if (occ && r.in === a.in) {
            if (a.plan && !r.plan) { put(room, { plan: a.plan }); rep.plan.push(`${room} ${a.plan}`); }
            else rep.skip.push(`${room}: متسجلة تشيك إن في الأبلكيشن وAiosell لسه بيقول Assigned`);
            setPaxNotes();
          } else if (occ) {
            checkout(room, arr);
          } else {
            const cur = r.arrival || null;
            const same = cur && cur.in === arr.in && cur.out === arr.out && (cur.plan || null) === arr.plan &&
              (cur.pax ?? null) === arr.pax && (cur.notes || null) === arr.notes && cur.src === 'aiosell';
            if (!same) {
              const keep = cur && cur.in === arr.in ? { ready: cur.ready ?? null, readyAt: cur.readyAt ?? null } : {};
              put(room, { arrival: Object.assign({}, arr, keep) });
              rep.arrAdd.push(room);
            }
          }
        } else { // no guest
          if (occ) {
            if (r.in === TODAY && r.src === 'walkin') rep.skip.push(`${room}: walk-in اتعمله تشيك إن النهارده في الأبلكيشن ومش في Aiosell`);
            else checkout(room, null);
          } else if (r.arrival && r.arrival.in && r.arrival.in <= TODAY) {
            put(room, { arrival: null });
            rep.arrDel.push(room);
          }
        }
      }

      const PAY = /virtual credit card|charge|cancel|grace period|genius|payment|prepaid|paid|card|commission|invoice|price|rate|deposit|refund|booking\.?\s?com|extranet|expedia|settings/i;
      const clean = (t) => {
        const kept = String(t).split(/(?<=[.!?\n])\s+/).filter((x) => x.trim() && !PAY.test(x)).join(' ').trim().slice(0, 150);
        return kept || null;
      };
      for (const [room, r] of Object.entries(R)) {
        const cur = Object.assign({}, r, upd[room] || {});
        if (cur.notes && PAY.test(cur.notes)) { put(room, { notes: clean(cur.notes) }); rep.notes.push(room + ' (اتنضّفت)'); }
        const ar = cur.arrival;
        if (ar && ar.notes && PAY.test(ar.notes)) { put(room, { arrival: Object.assign({}, ar, { notes: clean(ar.notes) }) }); rep.notes.push(room + ' وصول (اتنضّفت)'); }
      }

      const n = Object.keys(upd).length + logs.length;
      if (!DRY) {
        const b = db.batch();
        const t = new Date(TODAY + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
        const pdoc = db.collection('prep').doc(t.toISOString().slice(0, 10));
        b.set(pdoc, { syncAt: Date.now() }, { merge: true });
        // tomorrow's arrivals: replace the whole arr map (assign = HK pre-assignments, untouched)
        if (TMR) b.update(pdoc, { arr: TMR.arr, arrAt: Date.now() });
        for (const [room, data] of Object.entries(upd)) b.update(db.collection('rooms').doc(room), data);
        for (const l of logs) b.set(db.collection('log').doc(), l);
        await b.commit();
      }
      rep.tmr = TMR ? Object.keys(TMR.arr).length : null;
      return rep;
    }, { A: aiosellRows, TODAY: todayCairo(), DRY, TMR: tmr });
  } finally {
    await page.close().catch(() => {});
  }
}

function summary(rep) {
  const parts = [];
  if (rep.in.length) parts.push(`تشيك إن: ${rep.in.join('، ')}`);
  if (rep.out.length) parts.push(`خروج: ${rep.out.join('، ')}`);
  if (rep.arrAdd.length) parts.push(`وصول اتضاف: ${rep.arrAdd.join('، ')}`);
  if (rep.arrDel.length) parts.push(`وصول اتشال: ${rep.arrDel.join('، ')}`);
  if (rep.dates.length) parts.push(`تواريخ اتعدلت: ${rep.dates.join('، ')}`);
  if (rep.plan.length) parts.push(`وجبات: ${rep.plan.join('، ')}`);
  if (rep.pax.length) parts.push(`عدد أفراد: ${rep.pax.join('، ')}`);
  if (rep.notes.length) parts.push(`ملاحظات: ${rep.notes.join('، ')}`);
  const tm = rep.tmr == null ? '' : ` · وصول بكرة: ${rep.tmr} غرفة`;
  let s = (parts.length ? parts.join(' | ') : 'مفيش تغيير · الأبلكيشن مطابق لـ Aiosell') + tm;
  if (rep.skip.length) s += ' || متعملش: ' + rep.skip.join(' / ');
  return s;
}

// status for the app: last sync time, result and rooms that need a human (Firestore doc sync/aiosell)
async function writeStatus(ctx, data) {
  if (DRY) return;
  let page;
  try {
    page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await appSignIn(page);
    const err = await page.evaluate((d) => new Promise((res) => {
      const un = firebase.auth().onAuthStateChanged(async (u) => {
        un();
        if (!u) return res('no-auth');
        try { await firebase.firestore().collection('sync').doc('aiosell').set(Object.assign({ at: Date.now(), by: u.uid, src: 'cloud' }, d)); res(null); }
        catch (e) { res(String(e && e.code || e)); }
      });
    }), data);
    if (err) log('تنبيه: ماقدرتش أكتب حالة التحديث في الأبلكيشن (' + err + ')');
  } catch (_) {} finally { if (page) await page.close().catch(() => {}); }
}

async function runOnce() {
  let ctx;
  try {
    ctx = await openContext();
    const raw = await readAiosell(ctx);
    const rows = raw.map((r) => ({ ...r, plan: mapPlan(r.meal) }));
    if (!rows.length) throw new Error('جدول Aiosell فاضي');
    let tmr = null;
    try {
      const t = await readTomorrow(ctx);
      const PAY = /virtual credit card|charge|cancel|grace period|genius|payment|prepaid|paid|card|commission|invoice|price|rate|deposit|refund|booking\.?\s?com|extranet|expedia|settings|for more info/i;
      const arr = {};
      for (const r of t.rows) {
        if (!r.room) continue;
        let notes = r.comment.split(/(?<=[.!?])\s+|\n/).map((x) => x.trim()).filter((x) => x && x !== '-' && !PAY.test(x)).join(' ');
        notes = notes.replace(/Approximate time of arrival:\s*between\s*(\d{1,2}):\d{2}\s*and\s*(\d{1,2}):\d{2}/i, 'وصول تقريباً بين $1 و$2').slice(0, 150) || null;
        arr[r.room] = { in: r.in, out: r.out || null, plan: mapPlan(r.meal), pax: Number.isFinite(r.pax) ? r.pax : null, notes };
      }
      tmr = { arr };
    } catch (e) {
      log('تنبيه: وصول بكرة ما اتسحبش (' + ((e && e.message) || e).split('\n')[0] + ') · باقي التحديث شغال');
    }
    const rep = await applyToApp(ctx, rows, tmr);
    log(summary(rep));
    await saveState(ctx);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

(async () => {
  // up to 2 tries per run: network blips and Aiosell server errors usually clear within a minute
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runOnce();
      process.exit(0);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const needsLogin = /تسجيل الدخول|Secrets/.test(msg);
      log((attempt === 1 && !needsLogin ? 'خطأ (هعيد المحاولة بعد دقيقة): ' : 'خطأ: ') + msg.split('\n')[0]);
      if (needsLogin || attempt === 2) process.exit(1);
      await new Promise((r) => setTimeout(r, 60000));
    }
  }
})();
