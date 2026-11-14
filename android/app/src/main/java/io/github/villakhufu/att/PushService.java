package io.github.villakhufu.att;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Hotel notifications (new order, maintenance, room checkout, messages…) sent by the Apps Script. */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String t) {
        Geo.prefs(this).edit().putString("fcm", t).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage m) {
        Map<String, String> d = m.getData();
        String title = d.get("title"), body = d.get("body"), tag = d.get("tag");
        if (title == null && m.getNotification() != null) { title = m.getNotification().getTitle(); body = m.getNotification().getBody(); }
        if (title == null) title = "فيلا خوفو";
        Geo.hotelNotify(this, tag == null ? String.valueOf(System.currentTimeMillis()) : tag, title, body == null ? "" : body);
    }
}
