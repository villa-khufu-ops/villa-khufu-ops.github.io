// Villa Khufu · reception laptop app + kitchen print station, in one program
//  - Always running in the background: prints every kitchen order on the kitchen printer
//    (this laptop and the printer are on the same network), even orders sent from phones on mobile data.
//  - The "Villa Khufu" icon opens the same program as a normal app window. Closing the window
//    does not stop printing: it keeps running in the background.
//   node print-station.js          → background (started by Windows)
//   node print-station.js --show   → open the app window (the Desktop icon)
const { chromium } = require('playwright');
const net = require('net'), http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const APP_ID = 'VillaKhufu.App';
const xe = (t) => String(t || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).slice(0, 300);
// a Windows notification (bottom right, with sound) while the app window is closed
function toast(title, body) {
  if (process.platform !== 'win32') { log('إشعار: ' + title + ' · ' + body); return; }
  const xml = '<toast scenario="reminder" activationType="protocol" launch="http://127.0.0.1:' + PORT + '/show"><visual><binding template="ToastGeneric"><text>' + xe(title) + '</text><text>' + xe(body) + '</text></binding></visual>' +
    '<actions><action content="افتح" activationType="protocol" arguments="http://127.0.0.1:' + PORT + '/show"/><action content="تمام" activationType="system" arguments="dismiss"/></actions><audio src="ms-winsoundevent:Notification.Reminder"/></toast>';
  const ps = "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;" +
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;" +
    "$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + Buffer.from(xml, 'utf8').toString('base64') + "')));" +
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('" + APP_ID + "').Show([Windows.UI.Notifications.ToastNotification]::new($x))";
  try { spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch (_) {}
  log('إشعار: ' + title);
}

const APP_URL = process.env.VK_URL || 'https://villa-khufu-ops.github.io/';
const PROFILE = path.join(__dirname, 'print-profile');
const LOG = path.join(__dirname, 'print-station-log.txt');
const STOP = path.join(__dirname, 'STOP-PRINT.txt');
const PORT = 47913;
const LOGIN = process.argv.includes('--login');   // setup: open the window once, then exit when it is closed
const SHOW = process.argv.includes('--show') || LOGIN;

function log(m) {
  const line = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) + '  ' + m + '\r\n';
  try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 1e6) fs.renameSync(LOG, LOG + '.old'); fs.appendFileSync(LOG, line); } catch (_) {}
  console.log(line.trim());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wantShow = SHOW, ctxNow = null, kick = null;

async function openContext(show) {
  const opts = show
    ? { headless: false, viewport: null, locale: 'ar-EG', ignoreDefaultArgs: ['--enable-automation', '--disable-background-networking'], args: ['--app=' + APP_URL, '--kiosk-printing', '--window-size=1300,880', '--no-first-run'] }
    : { headless: true, viewport: { width: 420, height: 900 }, locale: 'ar-EG', ignoreDefaultArgs: ['--enable-automation', '--disable-background-networking'] };
  for (const channel of ['msedge', 'chrome']) {
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

async function runOnce() {
  const show = wantShow;
  let ctx;
  for (let k = 0; k < 4 && !ctx; k++) { try { ctx = await openContext(show); } catch (e) { if (k === 3) { ctx = null; var err = e; } else await sleep(3000); } }
  if (!ctx) { const e = err; log('ما فتحش الشباك: ' + String(e && e.message || e).split('\n')[0].slice(0, 200)); wantShow = false; await sleep(5000); return; }
  ctxNow = ctx;
  let closed = false; ctx.on('close', () => { closed = true; });
  try {
    await ctx.exposeBinding('__vkRaw', async ({ page }, ip, port, b64, id) => {
      const r = await sendRaw(ip, port, b64);
      log('print to ' + ip + ' → ' + r);
      await page.evaluate(([i, x]) => { try { window.vkPrintDone && window.vkPrintDone(i, x); } catch (e) {} }, [id, r]).catch(() => {});
      return r;
    });
    try { await ctx.grantPermissions(['notifications'], { origin: new URL(APP_URL).origin }); } catch (_) {}
    // the notification also reaches the page (sw.js posts it); with the window closed, Windows shows it
    await ctx.exposeBinding('__vkNote', async (_src, title, body) => { if (!show) toast(title, body); });
    await ctx.addInitScript(() => {
      try { navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', (e) => { const n = e.data && e.data.vkNote; if (n && window.__vkNote) window.__vkNote(String(n.title || 'Villa Khufu'), String(n.body || '')); }); } catch (e) {}
      try { localStorage.setItem('vkStation', '1'); } catch (e) {}
      window.VKApp = { printRaw: function (ip, port, b64, id) { window.__vkRaw(ip, port, b64, id); }, version: function () { return 'laptop'; } };
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('pageerror', (e) => log('page error: ' + String(e && e.message).slice(0, 200)));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });   // reload so the printer hook is in place
    if (show) {
      log('الشباك مفتوح · الطباعة شغالة');
      // the window: stays until the person closes it, then back to the background
      await new Promise((res) => { const t = setInterval(() => { if (closed || page.isClosed() || fs.existsSync(STOP)) { clearInterval(t); res(); } }, 1000); });
      wantShow = false;
      if (LOGIN) { try { await ctx.close(); } catch (_) {} log('تسجيل الدخول خلص'); process.exit(0); }
    } else {
      await page.waitForFunction(() => window.firebase && firebase.apps && firebase.apps.length, null, { timeout: 60000 });
      const uid = await page.evaluate(() => new Promise((res) => { const un = firebase.auth().onAuthStateChanged((u) => { un(); res(u ? u.uid : null); }); setTimeout(() => res(null), 20000); }));
      if (!uid) { log('مش مسجّل دخول · افتح أيقونة Villa Khufu وسجّل دخول مرة واحدة'); await ctx.close(); await sleep(60000); return; }
      log('شغال في الخلفية · الطباعة جاهزة');
      await page.waitForFunction(() => typeof meDoc === 'function' && meDoc(), null, { timeout: 60000 }).catch(() => {});
      const pn = await page.evaluate(() => { try { if (typeof pushEnable !== 'function') return 'no'; if (!localStorage.getItem('vkPush')) { pushEnable(); return 'on'; } pushRefresh && pushRefresh(); return 'ok'; } catch (e) { return 'err ' + e; } }).catch((e) => 'err');
      if (pn === 'on') log('الإشعارات اتفعّلت على اللاب توب');
      const started = Date.now();
      // stay up until the icon asks for the window, or 6 hours pass (then a fresh start)
      while (!fs.existsSync(STOP) && !wantShow && Date.now() - started < 6 * 3600e3 && !closed && !page.isClosed()) await new Promise((r) => { kick = r; setTimeout(r, 5000); });
    }
  } catch (e) { log('error: ' + String(e && e.message || e).slice(0, 300)); await sleep(15000); }
  try { await ctx.close(); } catch (_) {}
  ctxNow = null;
}

function askRunningToShow() {
  return new Promise((res) => {
    const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/show', timeout: 3000 }, (r) => { r.resume(); res(true); });
    rq.on('error', () => res(false)); rq.on('timeout', () => { rq.destroy(); res(false); });
  });
}

(async () => {
  // only one copy at a time: the copy that runs also answers the icon ("/show" = open the window)
  const srv = http.createServer((req, res) => {
    if (req.url === '/show') { if (!wantShow) { wantShow = true; if (kick) kick(); } res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<script>window.close()</script>Villa Khufu'); } else res.end('villa-khufu');
  });
  srv.on('error', async () => { if (SHOW) await askRunningToShow(); process.exit(0); });
  srv.listen(PORT, '127.0.0.1', async () => {
    try { if (fs.existsSync(STOP)) fs.unlinkSync(STOP); } catch (_) {}
    log('بدأ');
    while (!fs.existsSync(STOP)) { try { await runOnce(); } catch (e) { log('error: ' + String(e && e.message || e).slice(0, 200)); await sleep(15000); } }
    log('اتوقف (STOP-PRINT.txt موجود)'); process.exit(0);
  });
})();
