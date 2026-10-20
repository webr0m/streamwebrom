package lat.webrom.streamwebrom;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.*;
import java.util.ArrayList;

/** Foreground WebRTC client. The SFU continues to run on the user's server. */
public final class MainActivity extends Activity {
    private WebView web;
    private LinearLayout root;
    private EditText address;
    private Uri trusted;
    private PermissionRequest pending;
    private ValueCallback<Uri[]> fileCallback;
    private String resumeURL;
    private boolean active;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        // Keep controls clear of system bars, including Android's edge-to-edge mode.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        LinearLayout bar = new LinearLayout(this);
        address = new EditText(this);
        address.setSingleLine(true);
        address.setHint("https://tu-servidor o enlace de invitación");
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(getPreferences(0).getString("server", ""));
        bar.addView(address, new LinearLayout.LayoutParams(0, -2, 1));
        Button open = new Button(this); open.setText("Abrir");
        open.setOnClickListener(v -> open(address.getText().toString().trim()));
        bar.addView(open);
        Button browser = new Button(this); browser.setText("Navegador");
        browser.setOnClickListener(v -> {
            String url = web == null ? address.getText().toString().trim() : web.getUrl();
            if (valid(Uri.parse(url == null ? "" : url))) external(Uri.parse(url));
        });
        bar.addView(browser);
        root.addView(bar);
        TextView help = new TextView(this);
        help.setText("Conecta tu servidor HTTPS. Cámara y micrófono se solicitan al usarlos. Para compartir pantalla, usa un navegador compatible.");
        help.setPadding(12, 8, 12, 8); root.addView(help);
        setContentView(root);
    }

    private static boolean valid(Uri u) {
        return "https".equalsIgnoreCase(u.getScheme()) && u.getHost() != null
            && u.getUserInfo() == null && !u.toString().contains("\\");
    }
    private static int port(Uri u) { return u.getPort() == -1 ? 443 : u.getPort(); }
    private boolean sameOrigin(Uri u) {
        return trusted != null && valid(u) && trusted.getHost().equalsIgnoreCase(u.getHost()) && port(trusted) == port(u);
    }
    private void external(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (android.content.ActivityNotFoundException e) { message("No hay un navegador instalado"); }
    }
    private void open(String url) {
        Uri u = Uri.parse(url);
        if (!valid(u)) { message("Usa una URL HTTPS con un certificado válido"); return; }
        denyPending();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { ((LinearLayout) web.getParent()).removeView(web); web.destroy(); }
        trusted = u;
        // Never persist invitation/host keys, room passwords or room URLs.
        String origin = new Uri.Builder().scheme("https").encodedAuthority(u.getEncodedAuthority()).build().toString();
        getPreferences(0).edit().putString("server", origin).apply();
        address.setText(origin);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (sameOrigin(r.getUrl())) return false;
                if (!r.isForMainFrame() && officialVdo(r.getUrl())) return false;
                if (r.isForMainFrame() && r.hasGesture() && valid(r.getUrl())) external(r.getUrl());
                return true;
            }
            // The default SSL handler cancels invalid certificates. Never bypass it.
            @Override public void onPageFinished(WebView v, String url) {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest r) {
                runOnUiThread(() -> requestMedia(r));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest r) {
                runOnUiThread(() -> { if (pending == r) pending = null; });
            }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (!sameOrigin(Uri.parse(v.getUrl() == null ? "" : v.getUrl()))) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                try { startActivityForResult(pick, 11); }
                catch (android.content.ActivityNotFoundException e) { fileCallback = null; cb.onReceiveValue(null); }
                return true;
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        web.loadUrl(url);
    }
    private void requestMedia(PermissionRequest r) {
        if (!active || !permittedMediaOrigin(r.getOrigin())) { r.deny(); return; }
        denyPending(); pending = r;
        ArrayList<String> permissions = new ArrayList<>();
        for (String resource : r.getResources()) {
            String permission = resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) ? Manifest.permission.CAMERA
                : resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) ? Manifest.permission.RECORD_AUDIO : null;
            if (permission == null) { denyPending(); return; }
            if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) permissions.add(permission);
        }
        if (permissions.isEmpty()) grantPending();
        else requestPermissions(permissions.toArray(new String[0]), 10);
    }
    private void grantPending() {
        PermissionRequest r = pending; pending = null;
        if (r == null) return;
        if (!active || !permittedMediaOrigin(r.getOrigin())) { r.deny(); return; }
        ArrayList<String> allowed = new ArrayList<>();
        for (String resource : r.getResources()) {
            if (resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) allowed.add(resource);
            if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) allowed.add(resource);
        }
        if (allowed.size() == r.getResources().length) r.grant(allowed.toArray(new String[0])); else r.deny();
    }
    private void denyPending() { if (pending != null) { pending.deny(); pending = null; } }
    private boolean officialVdo(Uri u) {
        return "https".equalsIgnoreCase(u.getScheme()) && "vdo.ninja".equalsIgnoreCase(u.getHost())
            && (u.getPort() == -1 || u.getPort() == 443) && u.getUserInfo() == null;
    }
    private boolean permittedMediaOrigin(Uri u) {
        if (sameOrigin(u)) return true;
        Uri top = web == null || web.getUrl() == null ? null : Uri.parse(web.getUrl());
        return officialVdo(u) && top != null && sameOrigin(top) && "/vdo".equals(top.getPath());
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 10) grantPending();
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == 11 && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
    }
    @Override protected void onStart() {
        super.onStart(); active = true;
        if (web != null && resumeURL != null) { web.loadUrl(resumeURL); resumeURL = null; }
    }
    @Override protected void onStop() {
        active = false; denyPending();
        if (web != null && fileCallback == null) { resumeURL = web.getUrl(); web.loadUrl("about:blank"); }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onStop();
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        denyPending(); if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (web != null) web.destroy(); super.onDestroy();
    }
    private void message(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
