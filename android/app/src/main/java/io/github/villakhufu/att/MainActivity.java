package io.github.villakhufu.att;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Opens the hotel app. The first time (or while a permission is missing) it shows the setup steps for the arrival notices. */
public class MainActivity extends Activity {
    static final int GREEN = Color.rgb(27, 125, 74), RED = Color.rgb(180, 50, 40), INK = Color.rgb(30, 30, 30);
    LinearLayout box;
    TextView head, steps, hint;
    Button next, open, test;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        // if the app ever crashes, keep the reason and show it on the next start (so it can be sent to us)
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        final android.content.SharedPreferences cp = Geo.prefs(this);
        Thread.setDefaultUncaughtExceptionHandler((th, ex) -> {
            java.io.StringWriter sw = new java.io.StringWriter();
            ex.printStackTrace(new java.io.PrintWriter(sw));
            String st = sw.toString();
            cp.edit().putString("crash", st.length() > 1500 ? st.substring(0, 1500) : st).putLong("skipAt", 0).commit();
            if (prev != null) prev.uncaughtException(th, ex);
        });
        String crash = cp.getString("crash", null);
        try { Geo.channel(this); Geo.refresh(this); } catch (Exception e) { cp.edit().putString("crash", String.valueOf(e)).apply(); }
        long last = cp.getLong("launchAt", 0), nowT = System.currentTimeMillis();
        cp.edit().putLong("launchAt", nowT).apply();
        boolean again = nowT - last < 20_000;
        if (crash == null && !again && (ready() && battery() || System.currentTimeMillis() - cp.getLong("skipAt", 0) < 24 * 3600_000L)) {
            try { Geo.register(this, null); } catch (Exception ignored) { }
            autoOpen = true;
        }
        ScrollView sv = new ScrollView(this);
        box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        box.setPadding(dp(20), dp(28), dp(20), dp(28));
        box.setBackgroundColor(Color.rgb(250, 247, 240));
        sv.setBackgroundColor(Color.rgb(250, 247, 240));
        sv.addView(box);
        setContentView(sv);

        TextView t = text("فيلا خوفو · إعداد الحضور", 24, INK, true);
        box.addView(t);
        head = text("", 19, INK, true);
        head.setPadding(0, dp(18), 0, dp(6));
        box.addView(head);
        steps = text("", 17, INK, false);
        steps.setLineSpacing(dp(6), 1f);
        box.addView(steps);
        hint = text("", 15, Color.rgb(90, 80, 60), false);
        hint.setPadding(0, dp(10), 0, dp(10));
        box.addView(hint);
        next = button("", GREEN);
        next.setOnClickListener(v -> nextStep());
        box.addView(next);
        open = button("كمّل على الأبلكيشن", Color.rgb(140, 100, 40));
        open.setOnClickListener(v -> { Geo.prefs(this).edit().putLong("skipAt", System.currentTimeMillis()).apply(); openApp(); });
        box.addView(open);
        if (crash != null) {
            TextView ct = text("حصلت مشكلة المرة اللي فاتت · صوّر الشاشة دي وابعتها:\n\n" + crash, 12, RED, false);
            ct.setTextDirection(View.TEXT_DIRECTION_LTR);
            ct.setPadding(0, dp(12), 0, dp(12));
            ct.setTextIsSelectable(true);
            box.addView(ct, 1);
            cp.edit().remove("crash").apply();
        }
        TextView ver = text("نسخة " + versionName(), 12, Color.GRAY, false);
        box.addView(ver, 1);
        Button br = button("لو الأبلكيشن بيقفل · افتحه في كروم", Color.rgb(70, 90, 140));
        br.setOnClickListener(v -> openBrowser());
        box.addView(br);
        test = button("جرّب الإشعار", Color.rgb(110, 110, 110));
        test.setOnClickListener(v -> Geo.notify(this, 3, "📍 تجربة · إشعار الحضور",
                "كده الإشعارات شغالة · هيجيلك إشعار زي ده أول ما توصل الفندق"));
        box.addView(test);
        if (autoOpen) { hint.setText("بيفتح أبلكيشن الفندق…"); openApp(); }
    }

    boolean autoOpen;
    com.google.androidbrowserhelper.trusted.TwaLauncher twa;
    boolean launched;

    void openApp() {
        try {
            if (twa == null) twa = new com.google.androidbrowserhelper.trusted.TwaLauncher(this);
            launched = true;
            twa.launch(Uri.parse(Geo.APP_URL + "?app=1"));
        } catch (Exception e) {
            Geo.prefs(this).edit().putString("crash", "open: " + e).apply();
            openBrowser();
        }
    }

    void openBrowser() {
        launched = true;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Geo.APP_URL + "?app=1"))); } catch (Exception ignored) { }
    }

    @Override
    protected void onRestart() {
        super.onRestart();
        // back from the hotel app: close, so "back" goes home like a normal app
        if (launched) finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (twa != null) try { twa.destroy(); } catch (Exception ignored) { }
    }

    String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }


    @Override
    protected void onResume() {
        super.onResume();
        if (box == null) return;
        if (ready()) Geo.register(this, this::show);
        show();
    }

    boolean battery() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    boolean ready() { return Geo.fine(this) && Geo.background(this) && Geo.notifs(this); }

    void show() {
        boolean f = Geo.fine(this), bg = Geo.background(this), n = Geo.notifs(this), bat = battery();
        steps.setText(line(f, "إذن الموقع") + "\n" + line(bg, "الموقع «طول الوقت»") + "\n"
                + line(n, "الإشعارات") + "\n" + line(bat, "البطارية ما تقفلش الأبلكيشن"));
        if (ready() && bat) {
            head.setText("✓ كله تمام · دوس «كمّل على الأبلكيشن»");
            head.setTextColor(GREEN);
            hint.setText("أول ما توصل الفندق هيجيلك إشعار حتى لو الموبايل مقفول، تدوس عليه وتسجّل وصولك بزرار «📍 سجّل وصولي». ولما تمشي هيفكّرك تسجّل انصرافك.");
            next.setVisibility(View.GONE);
            test.setVisibility(View.VISIBLE);
            return;
        }
        head.setTextColor(RED);
        head.setText("عشان يجيلك إشعار أول ما توصل الفندق · دوس الزرار الأخضر");
        next.setVisibility(View.VISIBLE);
        test.setVisibility(n ? View.VISIBLE : View.GONE);
        if (!f) { next.setText("اسمح بالموقع"); hint.setText("اختار «أثناء استخدام التطبيق» أو «السماح»."); }
        else if (!bg) { next.setText("اسمح بالموقع طول الوقت"); hint.setText("هتفتحلك صفحة الإذن: اختار «السماح طوال الوقت» (Allow all the time) وارجع هنا."); }
        else if (!n) { next.setText("اسمح بالإشعارات"); hint.setText("اختار «السماح»."); }
        else { next.setText("سيب الأبلكيشن شغال"); hint.setText("الموبايل هيسألك: اختار «السماح» عشان البطارية ما توقفش تنبيه الحضور."); }
    }

    void nextStep() {
        if (!Geo.fine(this)) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
        } else if (!Geo.background(this)) {
            if (Build.VERSION.SDK_INT >= 30) {
                // Android 11+ shows this choice only on the app's settings page
                try { requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 2); }
                catch (Exception e) { appSettings(); }
            } else requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 2);
        } else if (!Geo.notifs(this)) {
            if (Build.VERSION.SDK_INT >= 33 && !Geo.has(this, Manifest.permission.POST_NOTIFICATIONS))
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 3);
            else startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        } else if (!battery()) {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
        }
    }

    void appSettings() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        super.onRequestPermissionsResult(code, p, r);
        // asked twice and refused: the phone won't show the dialog again, so open the settings page
        boolean denied = r.length > 0 && r[0] != 0;
        if (denied && p.length > 0 && !shouldShowRequestPermissionRationale(p[0])) appSettings();
        if (ready()) Geo.register(this, this::show);
        show();
    }

    String line(boolean ok, String s) { return (ok ? "✅ " : "⬜ ") + s; }

    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.START);
        t.setTextDirection(View.TEXT_DIRECTION_RTL);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    Button button(String s, int color) {
        Button btn = new Button(this);
        btn.setText(s);
        btn.setTextSize(18);
        btn.setTextColor(Color.WHITE);
        btn.setAllCaps(false);
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(14));
        btn.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58));
        lp.topMargin = dp(12);
        btn.setLayoutParams(lp);
        return btn;
    }
}
