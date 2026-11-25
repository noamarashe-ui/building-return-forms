package com.fieldforms.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.OutputStream;
import java.util.ArrayList;

/**
 * Saves files into a dedicated folder under the public Documents directory (MediaStore, Android 10+,
 * no storage permission needed) and opens the email app with those files attached.
 */
@CapacitorPlugin(name = "FormsFiles")
public class FormsFilesPlugin extends Plugin {

    private static String cleanFolder(String f) {
        if (f == null) return "FieldForms";
        f = f.replace("\\", "/").replace("..", "").trim();
        while (f.startsWith("/")) f = f.substring(1);
        while (f.endsWith("/")) f = f.substring(0, f.length() - 1);
        return f.isEmpty() ? "FieldForms" : f;
    }

    private static String cleanName(String n) {
        if (n == null) return "file";
        n = n.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "").trim();
        return n.isEmpty() ? "file" : n;
    }

    private Uri findExisting(ContentResolver cr, Uri collection, String name, String relPath) {
        String[] proj = new String[]{MediaStore.MediaColumns._ID};
        String sel = MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + "=?";
        try (Cursor c = cr.query(collection, proj, sel, new String[]{name, relPath}, null)) {
            if (c != null && c.moveToFirst()) {
                return ContentUris.withAppendedId(collection, c.getLong(0));
            }
        } catch (Exception ignored) {
            // fall through: treat as not found
        }
        return null;
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        String name = cleanName(call.getString("name"));
        String mime = call.getString("mime", "application/octet-stream");
        String folder = cleanFolder(call.getString("folder"));
        if (data == null) {
            call.reject("missing data");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            ContentResolver cr = getContext().getContentResolver();
            Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            String rel = "Documents/" + folder + "/";
            Uri uri = findExisting(cr, collection, name, rel);
            if (uri == null) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
                uri = cr.insert(collection, v);
            }
            if (uri == null) {
                call.reject("could not create file");
                return;
            }
            try (OutputStream os = cr.openOutputStream(uri, "wt")) {
                if (os == null) {
                    call.reject("could not open file");
                    return;
                }
                os.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("path", rel + name);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    /** Opens the email app (or share sheet if no recipients) with the given files attached. */
    @PluginMethod
    public void sendEmail(PluginCall call) {
        try {
            JSArray toArr = call.getArray("to");
            JSArray uriArr = call.getArray("uris");
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            ArrayList<Uri> uris = new ArrayList<>();
            if (uriArr != null) {
                for (int i = 0; i < uriArr.length(); i++) uris.add(Uri.parse(uriArr.getString(i)));
            }
            String[] to = new String[toArr == null ? 0 : toArr.length()];
            for (int i = 0; i < to.length; i++) to[i] = toArr.getString(i);

            Intent intent = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
            intent.setType(call.getString("type", "message/rfc822"));
            if (to.length > 0) intent.putExtra(Intent.EXTRA_EMAIL, to);
            intent.putExtra(Intent.EXTRA_SUBJECT, subject);
            intent.putExtra(Intent.EXTRA_TEXT, body);
            if (uris.size() > 1) {
                intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            } else if (uris.size() == 1) {
                intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            }
            if (!uris.isEmpty()) {
                ClipData clip = ClipData.newRawUri("attachments", uris.get(0));
                for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                intent.setClipData(clip);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            Intent chooser = Intent.createChooser(intent, call.getString("title", "Email"));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (JSONException e) {
            call.reject("bad arguments: " + e.getMessage());
        } catch (Exception e) {
            call.reject("send failed: " + e.getMessage());
        }
    }

    /** Opens a saved file in an installed viewer (e.g. a PDF reader). */
    @PluginMethod
    public void viewFile(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri", ""));
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, call.getString("type", "application/pdf"));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(Intent.createChooser(intent, "פתח"));
            call.resolve();
        } catch (Exception e) {
            call.reject("view failed: " + e.getMessage());
        }
    }
}
