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
    long pausedAt = 0;
    android.webkit.ValueCallback<Uri[]> pick;
    static final int PICK = 41;
    Uri camUri;
    boolean failed = false;

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
            // photo of a maintenance problem: pick from the gallery / files (the phone offers its camera app too)
            @Override
            public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> cb, FileChooserParams fp) {
                if (pick != null) pick.onReceiveValue(null);
                pick = cb;
                try {
                    Intent get = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                    Intent ch = Intent.createChooser(get, "صورة العطل");
                    camUri = null;
                    if (Build.VERSION.SDK_INT >= 29) {
                        try {
                            ContentValues cv = new ContentValues();
                            cv.put(MediaStore.Images.Media.DISPLAY_NAME, "vk-" + System.currentTimeMillis() + ".jpg");
                            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                            camUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, camUri)
                                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            ch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{ cam });
                        } catch (Exception ignored) { camUri = null; }
                    }
                    startActivityForResult(ch, PICK);
                } catch (Exception e) { pick = null; return false; }
                return true;
            }
        });
        w.setWebViewClient(new WebViewClient() {
            // no internet when the app opens: a simple Arabic page that tries again by itself
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, android.webkit.WebResourceError e) {
                if (r == null || !r.isForMainFrame()) return;
                failed = true;
                v.loadDataWithBaseURL(null, "<html dir='rtl'><body style='font-family:sans-serif;background:#121010;color:#F4EDE2;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center;gap:12px'>"
                        + "<div style='font-size:46px'>📶</div><b style='font-size:22px'>مفيش نت دلوقتي</b><span style='font-size:16px;opacity:.8'>الأبلكيشن هيفتح لوحده أول ما النت يرجع</span></body></html>", "text/html", "UTF-8", null);
                v.postDelayed(WebActivity.this::retry, 5000);
            }
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
        home();
        checkApk();
    }

    void home() {
        failed = false;
        String o = getIntent() == null ? null : getIntent().getStringExtra("open");
        String q = "";
        if (o != null) { try { q = "&open=" + java.net.URLEncoder.encode(o, "UTF-8"); } catch (Exception ignored) { } getIntent().removeExtra("open"); }
        w.loadUrl("https://" + HOST + "/?app=1&u=" + System.currentTimeMillis() + q);
    }
    void retry() {
        if (!failed || isFinishing()) return;
        android.net.ConnectivityManager cm = (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        android.net.NetworkCapabilities nc = cm == null ? null : cm.getNetworkCapabilities(cm.getActiveNetwork());
        if (nc != null && nc.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)) home();
        else w.postDelayed(this::retry, 5000);
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        // a tapped notification: go straight to that order / transfer
        String o = i.getStringExtra("open");
        if (o != null && w != null) { i.removeExtra("open"); w.evaluateJavascript("window.vkOpen&&window.vkOpen(" + org.json.JSONObject.quote(o) + ")", null); }
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
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != PICK || pick == null) return;
        Uri[] r = null;
        if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{ data.getData() };
        else if (res == RESULT_OK && camUri != null) r = new Uri[]{ camUri };
        else if (camUri != null) { try { getContentResolver().delete(camUri, null, null); } catch (Exception ignored) { } }
        camUri = null;
        pick.onReceiveValue(r);
        pick = null;
    }

    @Override
    public void onBackPressed() {
        if (w.canGoBack()) w.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onResume() {
        super.onResume(); w.onResume();
        // left in the background for hours: open fresh, so the phone always has the newest version
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 4 * 3600_000L) home();
        pausedAt = 0;
    }

    @Override
    protected void onPause() { pausedAt = System.currentTimeMillis(); w.onPause(); super.onPause(); }

    String ver() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }

    /** What the hotel web app can ask the phone for (window.VKApp). */
    class Bridge {
        @JavascriptInterface public String pushToken() { return Geo.prefs(WebActivity.this).getString("fcm", ""); }
        @JavascriptInterface public String version() { return ver(); }
        /** The signed-in employee (his own Firebase refresh token) for the automatic check-out when he leaves the hotel. Empty = signed out. */
        @JavascriptInterface public void setAuth(String rt) {
            Geo.prefs(WebActivity.this).edit().putString("rt", rt == null ? "" : rt).apply();
            if (rt == null || rt.isEmpty()) AutoOut.cancel(WebActivity.this);
        }
        /** Kitchen printer on the hotel network (ESC/POS on port 9100): send the ticket bytes straight to it. */
        @JavascriptInterface public void printRaw(String host, int port, String b64, String cb) {
            new Thread(() -> {
                String res = "ok";
                try (java.net.Socket so = new java.net.Socket()) {
                    so.connect(new java.net.InetSocketAddress(host, port > 0 ? port : 9100), 4000);
                    so.setSoTimeout(6000);
                    java.io.OutputStream out = so.getOutputStream();
                    out.write(android.util.Base64.decode(b64, android.util.Base64.DEFAULT));
                    out.flush();
                    Thread.sleep(400);
                } catch (Exception e) {
                    res = String.valueOf(e.getMessage());
                }
                final String r = res;
                runOnUiThread(() -> w.evaluateJavascript("window.vkPrintDone&&vkPrintDone(" + org.json.JSONObject.quote(cb) + "," + org.json.JSONObject.quote(r) + ")", null));
            }).start();
        }
        /** Top and bottom bars in the colour of the app's look (dark look = dark bars). */
        @JavascriptInterface public void setBar(String hex, boolean darkIcons) {
            runOnUiThread(() -> {
                try {
                    int c = Color.parseColor(hex);
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    int f = 0;
                    if (darkIcons) f |= android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    getWindow().getDecorView().setSystemUiVisibility(f);
                } catch (Exception ignored) { }
            });
        }
        /** Screen stays on (kitchen screen, print station). */
        @JavascriptInterface public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
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
