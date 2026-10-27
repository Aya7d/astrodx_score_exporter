package com.aya7d.astrodx_score_exporter;

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

@CapacitorPlugin(name = "AstroDXSync")
public class AstroDXSyncPlugin extends Plugin {
    private static final String TAG = "AstroDXSyncPlugin";

    // Known paths where AstroDX stores score cache
    private static final String[] CANDIDATE_PATHS = new String[] {
        "/sdcard/Android/data/com.Reflektone.AstroDX/files/cache",
        "/storage/emulated/0/Android/data/com.Reflektone.AstroDX/files/cache",
        "/sdcard/AstroDX/cache",
        "/storage/emulated/0/AstroDX/cache"
    };

    /**
     * Checks if the AstroDX cache file can be auto-detected and read.
     * If found, reads and returns it as a Base64 encoded payload.
     */
    @PluginMethod
    public void checkAndExtractCache(PluginCall call) {
        Log.d(TAG, "checkAndExtractCache called");

        // 1. Check direct file candidate paths
        for (String pathStr : CANDIDATE_PATHS) {
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

        // 2. Fallback: check if external storage manager permission is needed on Android 11+
        boolean isAllFilesGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            isAllFilesGranted = Environment.isExternalStorageManager();
        }

        JSObject ret = new JSObject();
        ret.put("success", false);
        ret.put("needsPermission", !isAllFilesGranted);
        ret.put("message", isAllFilesGranted
            ? "AstroDX cache file not found at default paths. Please launch AstroDX once or select the file manually."
            : "Storage access permission required to access Android/data. Please grant All Files Access."
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
                // Fallback to general manage storage screen if package uri fails
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
     * Reads a DocumentFile (from SAF folder picker) and returns Base64
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
