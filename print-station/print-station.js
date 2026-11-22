// Villa Khufu · print station on this laptop
// Opens the app hidden in the background and prints every kitchen order on the kitchen printer
// (the laptop and the printer are on the same network), even orders sent from phones on mobile data.
//   node print-station.js --login   → opens a window: log in to the app once, then close the window
//   node print-station.js           → runs hidden and keeps printing (started by Windows at log-on)
const { chromium } = require('playwright');
const net = require('net'), fs = require('fs'), path = require('path');

const APP_URL = process.env.VK_URL || 'https://villa-khufu-ops.github.io/';
const PROFILE = path.join(__dirname, 'print-profile');
const LOG = path.join(__dirname, 'print-station-log.txt');
const STOP = path.join(__dirname, 'STOP-PRINT.txt');
const LOGIN = process.argv.includes('--login');

function log(m) {
  const line = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) + '  ' + m + '\r\n';
  try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1e6) fs.renameSync(LOG, LOG + '.old'); fs.appendFileSync(LOG, line); } catch (_) {}
  console.log(line.trim());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openContext(headless) {
  const opts = { headless, viewport: { width: 420, height: 900 }, locale: 'ar-EG', ignoreDefaultArgs: ['--enable-automation'] };
  for (const channel of ['chrome', 'msedge']) {
    try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel }); } catch (_) {}
  }
  return chromium.launchPersistentContext(PROFILE, opts);
}

// send the ticket bytes straight to the printer (port 9100)
function sendRaw(ip, port, b64) {
  return new Promise((resolve) => {
    let done = false; const fin = (r) => { if (!done) { done = true; try { s.destroy(); } catch (_) {} resolve(r); } };
    const s = net.connect({ host: String(ip), port: Number(port) || 9100 }, () => { s.end(Buffer.from(String(b64), 'base64'), () => setTimeout(() => fin('ok'), 300)); });
    s.setTimeout(8000, () => fin('timeout'));
    s.on('error', (e) => fin(String((e && e.code) || e)));
  });
}

async function login() {
  const ctx = await openContext(false);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(APP_URL).catch(() => {});
  console.log('سجّل دخول على الأبلكيشن في الشباك اللي اتفتح، وبعدين اقفل الشباك.');
  await new Promise((r) => ctx.on('close', r));
}

async function runOnce() {
  const ctx = await openContext(true);
  try {
    await ctx.exposeBinding('__vkRaw', async ({ page }, ip, port, b64, id) => {
      const r = await sendRaw(ip, port, b64);
      log('print to ' + ip + ' → ' + r);
      await page.evaluate(([i, x]) => { try { window.vkPrintDone && window.vkPrintDone(i, x); } catch (e) {} }, [id, r]).catch(() => {});
      return r;
    });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('vkStation', '1'); } catch (e) {}
      window.VKApp = { printRaw: function (ip, port, b64, id) { window.__vkRaw(ip, port, b64, id); }, version: function () { return 'laptop'; } };
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => log('page error: ' + String(e && e.message).slice(0, 200)));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.firebase && firebase.apps && firebase.apps.length, null, { timeout: 60000 });
    const uid = await page.evaluate(() => new Promise((res) => { const un = firebase.auth().onAuthStateChanged((u) => { un(); res(u ? u.uid : null); }); setTimeout(() => res(null), 20000); }));
    if (!uid) { log('مش مسجّل دخول · شغّل print-station-login.bat وسجّل دخول مرة واحدة'); await ctx.close(); await sleep(5 * 60000); return; }
    log('شغال · جهاز الطباعة جاهز');
    const started = Date.now();
    // stay up; reload every 6 hours to pick up app updates
    while (!fs.existsSync(STOP) && Date.now() - started < 6 * 3600e3 && !page.isClosed()) await sleep(15000);
  } catch (e) { log('error: ' + String(e && e.message || e).slice(0, 300)); await sleep(30000); }
  try { await ctx.close(); } catch (_) {}
}

(async () => {
  if (LOGIN) return login();
  // only one copy at a time
  const lock = net.createServer().on('error', () => { console.log('already running'); process.exit(0); });
  lock.listen(47913, '127.0.0.1', async () => {
    log('بدأ');
    while (!fs.existsSync(STOP)) await runOnce();
    log('اتوقف (STOP-PRINT.txt موجود)'); process.exit(0);
  });
})();
