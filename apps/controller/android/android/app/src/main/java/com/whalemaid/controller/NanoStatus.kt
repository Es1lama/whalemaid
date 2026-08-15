package com.whalemaid.controller

import fi.iki.elonen.NanoHTTPD

/**
 * NanoHTTPD Status.lookup 只覆盖枚举内的一小撮状态码（无 502/429/423 等），
 * 查不到时返回 null，Response.send() 会抛 "Status can't be null" 杀死进程。
 * 本对象保证任意数值状态码都能构造出 IStatus（纯 Java 依赖，JVM 可测）。
 */
object NanoStatus {
    fun of(code: Int): NanoHTTPD.Response.IStatus =
        NanoHTTPD.Response.Status.lookup(code) ?: object : NanoHTTPD.Response.IStatus {
            override fun getDescription(): String = "HTTP $code"
            override fun getRequestStatus(): Int = code
        }
}
