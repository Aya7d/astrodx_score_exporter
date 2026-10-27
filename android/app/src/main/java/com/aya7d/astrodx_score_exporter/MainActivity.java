package com.aya7d.astrodx_score_exporter;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AstroDXSyncPlugin.class);
        super.onCreate(savedInstanceState);
        AstroDXSyncPlugin.handleIncomingIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        AstroDXSyncPlugin.handleIncomingIntent(this, intent);
    }
}
