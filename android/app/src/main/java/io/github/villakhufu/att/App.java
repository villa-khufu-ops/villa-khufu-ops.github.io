package io.github.villakhufu.att;

import android.app.Application;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

/** Starts Firebase (for the phone notifications) whenever the app process starts, also when a notification wakes it. */
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        initPush(this);
    }

    static void initPush(android.content.Context c) {
        if (Fb.APP_ID.isEmpty() || Fb.API_KEY.isEmpty()) return;
        try {
            if (FirebaseApp.getApps(c).isEmpty()) {
                FirebaseApp.initializeApp(c, new FirebaseOptions.Builder()
                        .setApplicationId(Fb.APP_ID).setApiKey(Fb.API_KEY)
                        .setProjectId(Fb.PROJECT).setGcmSenderId(Fb.SENDER).build());
            }
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t ->
                    Geo.prefs(c).edit().putString("fcm", t).apply());
        } catch (Exception e) {
            Geo.prefs(c).edit().putString("pushErr", String.valueOf(e)).apply();
        }
    }
}
