package com.whalemaid.controller

import android.app.Activity
import android.content.Context
import com.getcapacitor.BridgeActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * WhaleMaid 主控端 Android 壳适配层（薄）：代理核心 = ProxyCore（纯 JVM，本地可冒烟）。
 * 职责：SharedPreferences 指纹存储、assets 设备管理页、WebView 指向本地代理。
 * 隧道/路由/解析逻辑见 ProxyCore.kt（SPEC: docs/protocol.md、docs/security-audit.md#SEC-001）。
 */
@CapacitorPlugin(name = "WhaleMaidTunnel")
class WhaleMaidTunnelPlugin : Plugin() {

    @PluginMethod
    fun start(call: PluginCall) {
        startWhaleMaidCore(context, activity) { port ->
            val ret = JSObject()
            ret.put("port", port)
            call.resolve(ret)
        }
    }
}

/** 启动代理核心并把 WebView 指向本地代理（同源 = 页面相对请求全走隧道）；MainActivity 与插件共用 */
fun startWhaleMaidCore(
    context: Context,
    activity: Activity?,
    navigateWebView: Boolean = true,
    fallbackToRandomPort: Boolean = true,
    onReady: (Int) -> Unit,
) {
    val prefs = context.getSharedPreferences("whalemaid-tunnel", Context.MODE_PRIVATE)
    // 只持久化 relay 证书 pin；设备密码与 sessionToken 均只驻留当前 ProxyCore 进程。
    context.getSharedPreferences("whalemaid-state", Context.MODE_PRIVATE).edit().clear().apply()
    val core = ProxyCore(
        pinStore = object : PinStore {
            override fun get(key: String): String? = prefs.getString(key, null)
            override fun put(key: String, value: String) { prefs.edit().putString(key, value).apply() }
        },
        pageHtml = {
            runCatching { activity?.assets?.open("public/index.html")?.use { String(it.readBytes()) } }
                .getOrNull() ?: "<html><body>WhaleMaid</body></html>"
        },
    )
    core.start(fallbackToRandomPort) { port ->
        onReady(port)
        if (navigateWebView) {
            activity?.runOnUiThread {
                (activity as? BridgeActivity)?.bridge?.webView?.loadUrl("http://127.0.0.1:$port/")
            }
        }
    }
}
