
// ===================== daily report to Fawzy (11 PM) + daily backup to Google Drive (3 AM) =====================
function listAll_(coll) {
  var out = [], page = '';
  do {
    var r = UrlFetchApp.fetch(FS + coll + '?pageSize=300' + (page ? '&pageToken=' + page : ''), { headers: hdr_(), muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) break;
    var j = JSON.parse(r.getContentText());
    (j.documents || []).forEach(function (d) { var v = val_({ mapValue: { fields: d.fields || {} } }); v._id = d.name.split('/').pop(); out.push(v); });
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
// documents whose number field (at, …) is >= from
function since_(coll, field, from) {
  var url = FS.replace(/\/$/, '') + ':runQuery';
  var q = { structuredQuery: { from: [{ collectionId: coll }], where: { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(Math.floor(from)) } } }, limit: 5000 } };
  var r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: hdr_(), payload: JSON.stringify(q), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) { console.warn(r.getContentText()); return []; }
  return JSON.parse(r.getContentText()).filter(function (x) { return x.document; }).map(function (x) {
    var v = val_({ mapValue: { fields: x.document.fields || {} } }); v._id = x.document.name.split('/').pop(); return v; });
}
function fawzyUids_() {
  return listAll_('staff').filter(function (s) { return s.active !== false && (s.role === 'admin' || s.role === 'acc') && (/fawzy|فوزي/i.test(String(s.name || '') + ' ' + String(s.username || '')) || String(s.username || '').trim().toLowerCase() === 'abdooo'); }).map(function (s) { return s._id; });
}
function money_(n) { n = Math.round((n || 0) * 100) / 100; return '$' + n; }

function dailyReport() {
  var tz = 'Africa/Cairo', now = new Date(), d = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var t0 = Date.parse(d + 'T00:00:00' + Utilities.formatDate(now, tz, 'XXX'));
  var rooms = listAll_('rooms'), occ = rooms.filter(function (r) { return r.status === 'occ'; }).length;
  var orders = since_('orders', 'at', t0).filter(function (o) { return o.void !== true && o.st !== 'cancel'; });
  var food = 0, nFood = 0, mini = 0, tour = 0, trn = 0, nTrn = 0, cash = 0;
  orders.forEach(function (o) {
    var v = o.total || 0;
    if (o.kind === 'plan') return;
    if (o.kind === 'mini') mini += v;
    else if (o.kind === 'tour' && o.tour && o.tour.tr) { trn += v; nTrn++; }
    else if (o.kind === 'tour') tour += v;
    else { food += v; nFood++; }
    if (o.paid === true && o.pay === 'cash' && o.kind !== 'tour') cash += v;
  });
  var wash = 0; since_('laundry', 'at', t0).forEach(function (l) { if (l.void !== true && l.st !== 'cancel') wash += l.price || 0; });
  var ins = 0, outs = 0, col = cash;
  since_('log', 'at', t0).forEach(function (e) {
    if (e.type === 'checkin') ins++;
    if (e.type === 'checkout') { outs++; if (e.food || e.laundry) col += Math.max(0, (e.food || 0) + (e.laundry || 0) - (e.boardFood || 0)); }
    if (e.type === 'paid' || e.type === 'coPaid') col += e.amount || 0;
  });
  var total = food + mini + tour + trn + wash;
  var title = '📊 تقرير ' + dayAr_(d) + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
  var body = 'الإشغال ' + occ + '/' + rooms.length + ' · المطعم ' + money_(food) + ' (' + nFood + ' طلب) · إجمالي اليوم ' + money_(total) +
    ' · اتحصّل تقريباً ' + money_(col) + ' · ' + nTrn + ' انتقال · ' + ins + ' تشيك إن · ' + outs + ' خروج';
  var u = fawzyUids_();
  var n = u.length ? send_({ uids: u }, title, body) : 0;
  console.log(title + ' | ' + body + ' | devices: ' + n);
  return n;
}

// ---- backup: one JSON file a day in the Drive folder "Villa Khufu Backup" (the newest 60 are kept) ----
// small collections every day in full; the big ones the last 3 days every day, and everything in full on Fridays
function backupDaily() {
  var tz = 'Africa/Cairo', now = new Date(), d = Utilities.formatDate(now, tz, 'yyyy-MM-dd_HH-mm');
  var full = Utilities.formatDate(now, tz, 'u') === '5';
  var small = ['rooms', 'staff', 'geo', 'menu', 'rpay', 'sync', 'prep'];
  var big = ['orders', 'laundry', 'log', 'att', 'maint', 'greq', 'msgs', 'gstat'];
  var from = Date.now() - 3 * 864e5, data = { at: now.toISOString(), full: full, collections: {} };
  small.forEach(function (c) { data.collections[c] = listAll_(c); });
  big.forEach(function (c) { data.collections[c] = full ? listAll_(c) : since_(c, 'at', from); });
  var name = 'villa-khufu-' + (full ? 'FULL-' : '') + d + '.json';
  var folder = driveFolder_();
  var meta = { name: name, parents: [folder], mimeType: 'application/json' };
  var boundary = 'vk' + Date.now();
  var payload = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary +
    '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(data) + '\r\n--' + boundary + '--';
  var r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Drive upload failed: ' + r.getContentText());
  // keep the newest 60
  var lr = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent("'" + folder + "' in parents and trashed = false") + '&orderBy=createdTime desc&pageSize=200&fields=files(id,name)',
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (lr.getResponseCode() === 200) (JSON.parse(lr.getContentText()).files || []).slice(60).forEach(function (f) {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'delete', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  });
  var cnt = Object.keys(data.collections).map(function (c) { return c + ':' + data.collections[c].length; }).join(' ');
  console.log('Backup saved: ' + name + ' · ' + cnt);
  return name;
}
function driveFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('backupFolder');
  if (id) {
    var c = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '?fields=id,trashed', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (c.getResponseCode() === 200 && !JSON.parse(c.getContentText()).trashed) return id;
  }
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files', { method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ name: 'Villa Khufu Backup', mimeType: 'application/vnd.google-apps.folder' }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  id = JSON.parse(r.getContentText()).id; p.setProperty('backupFolder', id); return id;
}

// run this ONE time from the editor (Run ▶): it asks Google for permission, then turns on both every day
function setupDaily() {
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'dailyReport' || f === 'backupDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(23).nearMinute(0).inTimezone('Africa/Cairo').create();
  ScriptApp.newTrigger('backupDaily').timeBased().everyDays(1).atHour(3).nearMinute(0).inTimezone('Africa/Cairo').create();
  var b = backupDaily();
  console.log('Daily report (11 PM) and daily backup (3 AM) are on. First backup: ' + b);
}
