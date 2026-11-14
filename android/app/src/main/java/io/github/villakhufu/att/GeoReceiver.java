package io.github.villakhufu.att;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

/** Called by Google Play services when the phone enters or leaves the hotel, even when the app is closed. */
public class GeoReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
        if (ev == null || ev.hasError()) return;
        SharedPreferences p = Geo.prefs(c);
        long now = System.currentTimeMillis();
        int t = ev.getGeofenceTransition();
        if (t == Geofence.GEOFENCE_TRANSITION_ENTER) {
            // one arrival notice per 3 hours (a short walk outside doesn't repeat it)
            if (now - p.getLong("enterAt", 0) > 3 * 3600_000L) Geo.arrived(c);
            p.edit().putLong("enterAt", now).putBoolean("inside", true).apply();
            c.getSystemService(android.app.NotificationManager.class).cancel(2);
        } else if (t == Geofence.GEOFENCE_TRANSITION_EXIT) {
            if (now - p.getLong("exitAt", 0) > 20 * 60_000L) Geo.left(c);
            p.edit().putLong("exitAt", now).putBoolean("inside", false).apply();
            c.getSystemService(android.app.NotificationManager.class).cancel(1);
        }
    }
}
