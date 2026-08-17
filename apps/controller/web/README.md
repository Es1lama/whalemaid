# @whalemaid/controller-web — Web 版主控端（Electron/Capacitor 同源复用）

> SPEC: docs/native-app-plan.md（ADR-039/040/042；D-025 三壳同源）。AGPL-3.0。
> 运行：`pnpm --dir apps/controller/web start`（或 `node server.mjs`），默认 http://127.0.0.1:3210。

## 已实现（2026-08-15 实测闭环）

1. **设备管理首屏**（ToDesk 式）：服务端地址（仅首次，localStorage）+ 设备编号 + 密码；全程无 IP/端口/协议字样（UX-001/002/006/011）；
2. **连接**：`/_ctrl/connect` → 服务端在线状态查询（UX-003）→ 密码预验证（UX-006）→ 建立会话；
3. **反向代理**：连接后 `/`（官方 index+__DSH_BOOT__）、`/plugins/*`、`/api/**` 全部经 WSS 隧道入口（`/_whalemaid/tunnel-ws`，逐连接一次性 grant）打到受控端宿主原生 web；
4. **事件下联**：`/api/events.mux|host` 浏览器 upgrade → 隧道桥（官方 WS 载体）；
5. **安全**：中继证书指纹 TOFU 固定（按服务端分表）；HTTPS/WSS 每条授权连接禁用 socket 与 TLS session 复用，取得非空证书后才接受响应，并要求 WSS 与控制面身份一致；错误密码/离线/未知设备明确提示（UX-008）。

## 未实现（下轮壳里程碑）

- Electron 壳（同 server.mjs 挂主进程即可，UI 零改）；Capacitor 壳（Android/iOS，原生层接隧道 + WebView 同源）；
- 原生桥：相机/相册、麦克风、文件（D-023）；
- grant 复用优化（当前逐请求签名，M2 优化为连接池）；
- 官方 vendor-dist 目前仅用于许可证合规存档；运行时 UI 由受控端宿主提供（官方语义保证 100% 一致）。
