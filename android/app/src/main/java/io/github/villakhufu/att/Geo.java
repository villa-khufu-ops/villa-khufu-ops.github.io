package io.github.villakhufu.att;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** Hotel geofence: a notification when the employee arrives at the hotel or leaves it. */
public final class Geo {
    static final String CONFIG_URL = "https://villa-khufu-ops.github.io/hotel.json";
    static final String CHANNEL = "att";
    static final String FENCE_ID = "hotel";
    // fallback until hotel.json is read (the hotel location set in the app)
    static final double LAT = 29.9804812, LNG = 31.1386824;
    static final float R = 300f;
    static final String APP_URL = "https://villa-khufu-ops.github.io/";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("vk", Context.MODE_PRIVATE); }

    static boolean has(Context c, String p) { return c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }
    static boolean fine(Context c) { return has(c, Manifest.permission.ACCESS_FINE_LOCATION); }
    static boolean background(Context c) { return Build.VERSION.SDK_INT < 29 || has(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION); }
    static boolean notifs(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && !has(c, Manifest.permission.POST_NOTIFICATIONS)) return false;
        return c.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    static PendingIntent fencePi(Context c) {
        Intent i = new Intent(c, GeoReceiver.class);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(c, 0, i, f);
    }

    /** (Re)register the hotel geofence. Needs location permission "all the time". */
    @SuppressLint("MissingPermission")
    static void register(Context c, Runnable done) {
        if (!fine(c) || !background(c)) return;
        SharedPreferences p = prefs(c);
        double lat = Double.longBitsToDouble(p.getLong("lat", Double.doubleToLongBits(LAT)));
        double lng = Double.longBitsToDouble(p.getLong("lng", Double.doubleToLongBits(LNG)));
        float r = p.getFloat("r", R);
        Geofence g = new Geofence.Builder()
                .setRequestId(FENCE_ID)
                .setCircularRegion(lat, lng, r)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
                .setNotificationResponsiveness(60_000)
                .build();
        GeofencingRequest req = new GeofencingRequest.Builder()
                .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
                .addGeofence(g).build();
        GeofencingClient cl = LocationServices.getGeofencingClient(c);
        PendingIntent pi = fencePi(c);
        cl.removeGeofences(pi).addOnCompleteListener(t -> cl.addGeofences(req, pi)
                .addOnSuccessListener(v -> { p.edit().putLong("regAt", System.currentTimeMillis()).apply(); if (done != null) done.run(); })
                .addOnFailureListener(e -> p.edit().putString("regErr", String.valueOf(e.getMessage())).apply()));
    }

    /** Read the hotel location from the website, so moving the point in the app needs no new version. */
    static void refresh(Context c) {
        Context a = c.getApplicationContext();
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(CONFIG_URL + "?t=" + System.currentTimeMillis()).openConnection();
                h.setConnectTimeout(10000); h.setReadTimeout(10000);
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"))) {
                    String l; while ((l = br.readLine()) != null) sb.append(l);
                }
                JSONObject j = new JSONObject(sb.toString());
                double lat = j.getDouble("lat"), lng = j.getDouble("lng");
                float r = (float) j.optDouble("r", R);
                SharedPreferences p = prefs(a);
                boolean changed = Double.longBitsToDouble(p.getLong("lat", 0)) != lat
                        || Double.longBitsToDouble(p.getLong("lng", 0)) != lng || p.getFloat("r", 0) != r;
                p.edit().putLong("lat", Double.doubleToLongBits(lat)).putLong("lng", Double.doubleToLongBits(lng))
                        .putFloat("r", r).putString("url", j.optString("url", APP_URL)).apply();
                if (changed) register(a, null);
            } catch (Exception ignored) { }
        }).start();
    }

    static void channel(Context c) {
        NotificationChannel ch = new NotificationChannel(CHANNEL, "الحضور والانصراف", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("تنبيه لما توصل الفندق أو تمشي منه");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 300, 150, 300, 150, 300});
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    static void notify(Context c, int id, String title, String body) {
        channel(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_dialog_map)
                .setContentTitle(title).setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pi).setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .build();
        try { c.getSystemService(NotificationManager.class).notify(id, n); } catch (SecurityException ignored) { }
    }

    static void arrived(Context c) {
        notify(c, 1, "📍 إنت دلوقتي في الفندق", "دوس هنا وسجّل وصولك عشان ورديتك تبدأ");
    }

    static void left(Context c) {
        notify(c, 2, "🚪 خرجت من الفندق", "لو خلّصت شغلك دوس هنا وسجّل انصرافك · ولو لسه في الشغل سيبها");
    }

    private Geo() { }
}
