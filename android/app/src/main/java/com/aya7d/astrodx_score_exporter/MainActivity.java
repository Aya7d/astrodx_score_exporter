package com.aya7d.astrodx_score_exporter;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AstroDXSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

