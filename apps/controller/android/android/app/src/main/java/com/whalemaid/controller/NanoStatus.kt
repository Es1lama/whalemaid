package com.whalemaid.controller

import fi.iki.elonen.NanoHTTPD

/**
 * NanoHTTPD Status.lookup 只覆盖枚举内的一小撮状态码（无 502/429/423 等），
 * 查不到时返回 null，Response.send() 会抛 "Status can't be null" 杀死进程。
 * 本对象保证任意数值状态码都能构造出 IStatus。
 * 注意：NanoHTTPD 的状态行 = "HTTP/1.1 " + getDescription()——自定义 IStatus 的
 * getDescription() 必须自带状态码（形如 "502 Bad Gateway"），否则产出非法状态行。
 */
object NanoStatus {
    private val REASONS = mapOf(
        400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden", 404 to "Not Found",
        405 to "Method Not Allowed", 416 to "Range Not Satisfiable", 423 to "Locked",
        429 to "Too Many Requests", 500 to "Internal Server Error", 501 to "Not Implemented",
        502 to "Bad Gateway", 503 to "Service Unavailable", 504 to "Gateway Timeout",
    )

    fun of(code: Int): NanoHTTPD.Response.IStatus =
        NanoHTTPD.Response.Status.lookup(code) ?: object : NanoHTTPD.Response.IStatus {
            override fun getDescription(): String = "$code ${REASONS[code] ?: "Status"}"
            override fun getRequestStatus(): Int = code
        }
}
