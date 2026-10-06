package com.mybills.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalTransferPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
