package com.whalemaid.controller

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/** 主控端入口：启动本地隧道代理并把 WebView 指向代理（同源 = 页面相对请求全走隧道） */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        registerPlugin(WhaleMaidTunnelPlugin::class.java)
        startWhaleMaidCore(applicationContext, this) { /* WebView 指向由 startWhaleMaidCore 完成 */ }
    }
}
