package com.whalemaid.controller

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/** 主控端入口：启动本地隧道代理并把 WebView 指向代理（同源 = 页面相对请求全走隧道） */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // BridgeActivity 在 super.onCreate() 内创建 bridge；自定义插件必须在此之前注册。
        registerPlugin(WhaleMaidTunnelPlugin::class.java)
        super.onCreate(savedInstanceState)
        startWhaleMaidCore(applicationContext, this) { /* WebView 指向由 startWhaleMaidCore 完成 */ }
    }
}
