package com.aya7d.astrodx_score_exporter;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "AstroDXSync")
public class AstroDXSyncPlugin extends Plugin {
    private static final String TAG = "AstroDXSyncPlugin";

    private static String pendingBase64 = null;
    private static String pendingFileName = null;
    private static AstroDXSyncPlugin instance = null;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    /**
     * Resolves candidate paths across internal storage, Download, Documents, and AstroDX directories.
     */
    private List<String> getCandidatePaths() {
        Set<String> paths = new LinkedHashSet<>();

        // 1. Direct AstroDX package data path (accessible on Android <= 10 or unrestricted ROMs)
        paths.add("/sdcard/Android/data/com.Reflektone.AstroDX/files/cache");
        paths.add("/storage/emulated/0/Android/data/com.Reflektone.AstroDX/files/cache");

        // 2. Public Download folder (most common workaround for Android 11+ Scoped Storage)
        try {
            File dl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (dl != null) {
                paths.add(new File(dl, "cache").getAbsolutePath());
                paths.add(new File(dl, "cache.txt").getAbsolutePath());
            }
        } catch (Exception ignored) {}
        paths.add("/sdcard/Download/cache");
        paths.add("/storage/emulated/0/Download/cache");
        paths.add("/sdcard/Download/cache.txt");
        paths.add("/storage/emulated/0/Download/cache.txt");

        // 3. Public Documents folder
        try {
            File docs = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
            if (docs != null) {
                paths.add(new File(docs, "cache").getAbsolutePath());
                paths.add(new File(docs, "cache.txt").getAbsolutePath());
            }
        } catch (Exception ignored) {}
        paths.add("/sdcard/Documents/cache");
        paths.add("/storage/emulated/0/Documents/cache");

        // 4. AstroDX custom directories & storage root
        paths.add("/sdcard/AstroDX/cache");
        paths.add("/storage/emulated/0/AstroDX/cache");
        paths.add("/sdcard/cache");
        paths.add("/storage/emulated/0/cache");

        return new ArrayList<>(paths);
    }

    /**
     * Checks if the AstroDX cache file can be auto-detected and read.
     * If found, reads and returns it as a Base64 encoded payload.
     */
    @PluginMethod
    public void checkAndExtractCache(PluginCall call) {
        Log.d(TAG, "checkAndExtractCache called");

        // 1. Check candidate paths
        List<String> candidatePaths = getCandidatePaths();
        for (String pathStr : candidatePaths) {
            try {
                File file = new File(pathStr);
                if (file.exists() && file.canRead() && file.isFile() && file.length() > 0) {
                    byte[] bytes = readFileToBytes(file);
                    if (bytes != null && bytes.length > 0) {
                        String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        ret.put("path", pathStr);
                        ret.put("size", bytes.length);
                        ret.put("base64", b64);
                        call.resolve(ret);
                        return;
                    }
                }
            } catch (SecurityException secEx) {
                Log.w(TAG, "SecurityException reading " + pathStr + ": " + secEx.getMessage());
            } catch (Exception ex) {
                Log.w(TAG, "Error checking path " + pathStr + ": " + ex.getMessage());
            }
        }

        // 2. Check All Files Access permission
        boolean isAllFilesGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            isAllFilesGranted = Environment.isExternalStorageManager();
        }

        JSObject ret = new JSObject();
        ret.put("success", false);
        ret.put("needsPermission", !isAllFilesGranted);
        ret.put("message", isAllFilesGranted
            ? "Android restricts reading Android/data directly. Please copy 'cache' to your 'Download' folder, share it to this app, or tap 'Select Cache File'."
            : "Storage access permission required to access storage. Please grant All Files Access."
        );
        call.resolve(ret);
    }

    /**
     * Opens system Settings to request MANAGE_APP_ALL_FILES_ACCESS_PERMISSION (Android 11+)
     */
    @PluginMethod
    public void requestAllFilesPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);

                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    getActivity().startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                } catch (Exception e2) {
                    call.reject("Could not open Storage Settings: " + e2.getMessage());
                }
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("message", "Permission not required below Android 11");
            call.resolve(ret);
        }
    }

    /**
     * Reads a DocumentFile (from SAF file picker) and returns Base64
     */
    @PluginMethod
    public void readCacheFromUri(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("URI is required");
            return;
        }

        try {
            Uri uri = Uri.parse(uriStr);
            InputStream is = getContext().getContentResolver().openInputStream(uri);
            if (is == null) {
                call.reject("Could not open input stream from URI");
                return;
            }

            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[8192];
            int nRead;
            while ((nRead = is.read(data, 0, data.length)) != -1) {
                buffer.write(data, 0, nRead);
            }
            buffer.flush();
            is.close();

            byte[] bytes = buffer.toByteArray();
            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("size", bytes.length);
            ret.put("base64", b64);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error reading file URI: " + e.getMessage());
        }
    }

    /**
     * Returns pending file if app was launched via Share (ACTION_SEND / ACTION_VIEW)
     */
    @PluginMethod
    public void getPendingSharedFile(PluginCall call) {
        JSObject ret = new JSObject();
        if (pendingBase64 != null) {
            ret.put("success", true);
            ret.put("base64", pendingBase64);
            ret.put("fileName", pendingFileName != null ? pendingFileName : "shared_cache");
            // Clear after consumption
            pendingBase64 = null;
            pendingFileName = null;
        } else {
            ret.put("success", false);
        }
        call.resolve(ret);
    }

    /**
     * Intercepts incoming Share / Open With intents from other apps (e.g. system file manager)
     */
    public static void handleIncomingIntent(Activity activity, Intent intent) {
        if (intent == null || activity == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        }

        if (uri != null) {
            try {
                InputStream is = activity.getContentResolver().openInputStream(uri);
                if (is != null) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] data = new byte[8192];
                    int nRead;
                    while ((nRead = is.read(data, 0, data.length)) != -1) {
                        buffer.write(data, 0, nRead);
                    }
                    is.close();
                    byte[] bytes = buffer.toByteArray();
                    if (bytes.length > 0) {
                        pendingBase64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                        pendingFileName = "shared_cache";
                        if (instance != null) {
                            JSObject jsObj = new JSObject();
                            jsObj.put("base64", pendingBase64);
                            jsObj.put("fileName", pendingFileName);
                            instance.notifyListeners("onFileReceived", jsObj);
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error reading incoming intent URI: " + e.getMessage());
            }
        }
    }

    private byte[] readFileToBytes(File file) throws Exception {
        FileInputStream fis = new FileInputStream(file);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int bytesRead;
        while ((bytesRead = fis.read(b)) != -1) {
            bos.write(b, 0, bytesRead);
        }
        fis.close();
        return bos.toByteArray();
    }
}
