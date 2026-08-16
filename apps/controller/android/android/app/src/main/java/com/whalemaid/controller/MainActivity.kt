package com.whalemaid.controller

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

/** 主控端入口：启动本地隧道代理并把 WebView 指向代理（同源 = 页面相对请求全走隧道） */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // BridgeActivity 在 super.onCreate() 内创建 bridge 并加载 server.url；插件与本地代理都必须先就绪。
        registerPlugin(WhaleMaidTunnelPlugin::class.java)
        registerPlugin(WhaleMaidNativePlugin::class.java)
        startWhaleMaidCore(
            applicationContext,
            this,
            navigateWebView = false,
            fallbackToRandomPort = false,
        ) { port -> check(port == ProxyCore.FIXED_PORT) }
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val core = WhaleMaidRuntime.core
                if (core?.session?.connected == true) {
                    core.disconnect()
                    bridge.webView.loadUrl("http://127.0.0.1:${WhaleMaidRuntime.port}/")
                    return
                }
                isEnabled = false
                this@MainActivity.onBackPressedDispatcher.onBackPressed()
            }
        })
    }
}
