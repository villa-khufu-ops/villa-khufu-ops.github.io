package io.github.villakhufu.att;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Automatic check-out: the phone left the hotel and did not come back within GRACE minutes,
 * so the employee's open shift is closed at the time he left. Works with the app closed:
 * the app keeps the employee's own Firebase sign-in (refresh token, saved by the web app through
 * VKApp.setAuth) and writes his own attendance record exactly as the app would.
 */
public class AutoOut extends BroadcastReceiver {
    static final long GRACE = 15 * 60_000L;
    static final String KEY = "AIzaSyD6M9fTjZaRi9K9-LvaqPdLrNHkH75rKMA";
    static final String DB = "https://firestore.googleapis.com/v1/projects/villa-khufu-ops/databases/(default)/documents";

    static PendingIntent pi(Context c) {
        return PendingIntent.getBroadcast(c, 7, new Intent(c, AutoOut.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Called on the geofence EXIT: check again after the grace time. */
    static void schedule(Context c) {
        if (Geo.prefs(c).getString("rt", "").isEmpty()) return;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + GRACE, pi(c));
    }

    static void cancel(Context c) {
        c.getSystemService(AlarmManager.class).cancel(pi(c));
    }

    @Override
    public void onReceive(Context c, Intent intent) {
        SharedPreferences p = Geo.prefs(c);
        final long exitAt = p.getLong("exitAt", 0);
        if (p.getBoolean("inside", true) || exitAt == 0 || p.getLong("enterAt", 0) > exitAt) return;
        final String rt = p.getString("rt", "");
        if (rt.isEmpty()) return;
        final PendingResult res = goAsync();
        new Thread(() -> {
            try { run(c, rt, exitAt); } catch (Exception ignored) { }
            finally { res.finish(); }
        }).start();
    }

    static void run(Context c, String rt, long exitAt) throws Exception {
        // 1. fresh sign-in token for this employee
        JSONObject tok = new JSONObject(http("POST", "https://securetoken.googleapis.com/v1/token?key=" + KEY, null,
                "grant_type=refresh_token&refresh_token=" + java.net.URLEncoder.encode(rt, "UTF-8"), "application/x-www-form-urlencoded"));
        String id = tok.getString("id_token"), uid = tok.getString("user_id");
        if (tok.has("refresh_token")) Geo.prefs(c).edit().putString("rt", tok.getString("refresh_token")).apply();
        // 2. his open shift
        JSONObject q = new JSONObject().put("structuredQuery", new JSONObject()
                .put("from", new JSONArray().put(new JSONObject().put("collectionId", "att")))
                .put("where", new JSONObject().put("compositeFilter", new JSONObject().put("op", "AND").put("filters", new JSONArray()
                        .put(eq("uid", uid)).put(eq("st", "open"))))));
        JSONArray rows = new JSONArray(http("POST", DB + ":runQuery", id, q.toString(), "application/json"));
        for (int i = 0; i < rows.length(); i++) {
            JSONObject d = rows.getJSONObject(i).optJSONObject("document");
            if (d == null) continue;
            JSONObject f = d.getJSONObject("fields");
            long inAt = num(f, "inAt"), lastAt = num(f, "lastAt");
            if (exitAt < inAt) continue;                       // left before this shift began
            if (lastAt > exitAt + 5 * 60_000L) continue;       // the app saw him inside after he "left"
            JSONObject body = new JSONObject().put("fields", new JSONObject()
                    .put("outAt", new JSONObject().put("integerValue", String.valueOf(exitAt)))
                    .put("st", new JSONObject().put("stringValue", "closed"))
                    .put("auto", new JSONObject().put("booleanValue", true)));
            String name = d.getString("name");
            http("PATCH", "https://firestore.googleapis.com/v1/" + name
                    + "?updateMask.fieldPaths=outAt&updateMask.fieldPaths=st&updateMask.fieldPaths=auto"
                    + "&currentDocument.exists=true", id, body.toString(), "application/json");
            String hm = new SimpleDateFormat("h:mm a", new Locale("ar", "EG")).format(new Date(exitAt));
            Geo.notify(c, 2, "✅ اتسجّل انصرافك", "خرجت من الفندق الساعة " + hm + " · اتسجّل انصرافك أوتوماتيك");
        }
    }

    static JSONObject eq(String field, String v) throws Exception {
        return new JSONObject().put("fieldFilter", new JSONObject().put("field", new JSONObject().put("fieldPath", field))
                .put("op", "EQUAL").put("value", new JSONObject().put("stringValue", v)));
    }

    static long num(JSONObject f, String k) {
        JSONObject v = f.optJSONObject(k);
        if (v == null) return 0;
        if (v.has("integerValue")) return Long.parseLong(v.optString("integerValue", "0"));
        if (v.has("doubleValue")) return (long) v.optDouble("doubleValue", 0);
        return 0;
    }

    static String http(String method, String url, String bearer, String body, String type) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        if ("PATCH".equals(method)) { h.setRequestMethod("POST"); h.setRequestProperty("X-HTTP-Method-Override", "PATCH"); }
        else h.setRequestMethod(method);
        h.setConnectTimeout(20000); h.setReadTimeout(20000);
        if (bearer != null) h.setRequestProperty("Authorization", "Bearer " + bearer);
        if (body != null) {
            h.setDoOutput(true); h.setRequestProperty("Content-Type", type);
            try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = h.getResponseCode();
        InputStream in = code < 400 ? h.getInputStream() : h.getErrorStream();
        String s = "";
        if (in != null) { java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) bo.write(b, 0, n); s = bo.toString("UTF-8"); }
        if (code >= 400) throw new Exception(code + " " + s);
        return s;
    }
}
