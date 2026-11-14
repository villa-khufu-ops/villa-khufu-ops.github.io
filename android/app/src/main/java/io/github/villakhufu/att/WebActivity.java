package io.github.villakhufu.att;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** The hotel app itself, full screen inside our own app (no browser bar). */
public class WebActivity extends Activity {
    static final String HOST = "villa-khufu-ops.github.io";
    WebView w;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.rgb(250, 247, 240));
        getWindow().getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        w = new WebView(this);
        setContentView(w);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " VillaKhufuApp/" + ver());
        CookieManager.getInstance().setAcceptCookie(true);
        w.addJavascriptInterface(new Bridge(), "VKApp");
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                cb.invoke(origin, Geo.fine(WebActivity.this), false);
            }
        });
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // WhatsApp, phone calls, maps and other sites open in their own apps
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        // always a fresh page on start, so every update reaches the phone right away
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        w.loadUrl("https://" + HOST + "/?app=1&u=" + System.currentTimeMillis());
        checkApk();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
    }

    /** New version of the Android app on the website: offer to download it. */
    void checkApk() {
        new Thread(() -> {
            try {
                java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL("https://" + HOST + "/download/version.json?t=" + System.currentTimeMillis()).openConnection();
                h.setUseCaches(false); h.setConnectTimeout(10000); h.setReadTimeout(10000);
                StringBuilder sb = new StringBuilder();
                try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(h.getInputStream(), "UTF-8"))) {
                    String l; while ((l = br.readLine()) != null) sb.append(l);
                }
                org.json.JSONObject j = new org.json.JSONObject(sb.toString());
                int code = j.getInt("code");
                String name = j.optString("version", "");
                long mine = getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
                if (code > mine) runOnUiThread(() -> {
                    if (isFinishing()) return;
                    new android.app.AlertDialog.Builder(this)
                            .setTitle("في نسخة جديدة من الأبلكيشن " + name)
                            .setMessage("دوس «نزّل» وبعدين افتح الملف ودوس «تحديث».")
                            .setPositiveButton("نزّل", (d, x) -> {
                                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://" + HOST + "/download/villa-khufu.apk?v=" + name))); } catch (Exception ignored) { }
                            })
                            .setNegativeButton("بعدين", null).show();
                });
            } catch (Exception ignored) { }
        }).start();
    }

    @Override
    public void onBackPressed() {
        if (w.canGoBack()) w.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onResume() { super.onResume(); w.onResume(); }

    @Override
    protected void onPause() { w.onPause(); super.onPause(); }

    String ver() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    /** What the hotel web app can ask the phone for (window.VKApp). */
    class Bridge {
        @JavascriptInterface public String pushToken() { return Geo.prefs(WebActivity.this).getString("fcm", ""); }
        @JavascriptInterface public String version() { return ver(); }
        @JavascriptInterface public void setup() {
            runOnUiThread(() -> startActivity(new Intent(WebActivity.this, MainActivity.class).putExtra("setup", true)));
        }
        /** Excel/CSV reports: saved in the phone's Downloads, then opened. */
        @JavascriptInterface public void saveFile(String name, String b64, String mime) {
            runOnUiThread(() -> {
                try {
                    byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                    Uri uri;
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues cv = new ContentValues();
                        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                        cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                        uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(data); }
                    } else {
                        File f = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name);
                        try (FileOutputStream os = new FileOutputStream(f)) { os.write(data); }
                        Toast.makeText(WebActivity.this, "اتحفظ: " + f.getPath(), Toast.LENGTH_LONG).show();
                        return;
                    }
                    Toast.makeText(WebActivity.this, "اتحفظ في التنزيلات: " + name, Toast.LENGTH_LONG).show();
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                    } catch (Exception ignored) { }
                } catch (Exception e) {
                    Toast.makeText(WebActivity.this, "ما اتحفظش: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
