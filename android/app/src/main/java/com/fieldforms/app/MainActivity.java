package com.fieldforms.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FormsFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
