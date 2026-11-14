package io.github.villakhufu.att;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Geofences are wiped when the phone restarts or the app updates: put the hotel back. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        Geo.register(c, null);
        Geo.refresh(c);
    }
}
