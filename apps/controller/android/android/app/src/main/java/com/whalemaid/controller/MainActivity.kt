package com.whalemaid.controller

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/** 主控端入口：直接启动隧道代理并把 WebView 指向本地代理（同源 = 页面相对请求全走隧道） */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        registerPlugin(WhaleMaidTunnelPlugin::class.java)
        TunnelProxy(applicationContext, this).start { port ->
            runOnUiThread {
                bridge?.webView?.loadUrl("http://127.0.0.1:$port/")
            }
        }
    }
}
