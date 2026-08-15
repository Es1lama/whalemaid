# Spike：官方 DSH web 前端独立构建 + 原生 /api 契约实测（2026-08-15）

> 依据 docs/native-app-plan.md 里程碑 1（audit#5）与 audit#3。A 档学习对象：deepseek-ai/deepseek-harness（MIT）。

## 1. 独立构建结论：✅ 可构建

- 官方前端 `apps/web`（npm 包 `@deepseek-ai/dsh-web-frontend`）**不是独立包可构建**：其 vite 配置把 `@deepseek-ai/dsh-client-*` 别名到 monorepo 源码（CSS 必须走 vite 管道），且 `vite serve` 拒绝无 `window.__DSH_BOOT__` 的环境（只允许 build）。
- 构建路径（本仓库复现）：clone 官方仓 → `pnpm install` → `pnpm build:lib` → `pnpm --filter @deepseek-ai/dsh-web-frontend build` → 产出 `apps/web/dist/`（index.html + assets + favicon + manifest）。本机验证 exit 0。
- 冻结基线：官方 commit `47f943859bef60e4160492346772ded9b24f765a`（本次 spike 用的 checkout；`dist/index.html` 内 boot rev 同值）。移植时以该 commit 为基线 + THIRD_PARTY_NOTICES（根 LICENSE = MIT）。

## 2. 原生 /api 契约（受控端宿主自带，实测全绿）

- 宿主 = `dsh web`（web-app bundle）：`127.0.0.1:<port>` 上同时提供官方前端（`GET /` → index.html + `window.__DSH_BOOT__` 注入）与原生 API。
- 请求信封：`{type:"client-request", rpcId, method:"session.list", payload:{}}`；响应：`{type:"server-response", rpcId, result:{ok:true,value}|{ok:false,error}}`。HTTP 状态只表达载体错误（404/415/400/500），业务错误恒 200。
- 事件下联：WebSocket `/api/events.mux`、`/api/events.host`（官方 web 载体不用 SSE）。
- 信任栅栏：官方 connection 插件对 `/api` 做 DNS-rebinding/跨站防御（`isTrustedApiRequest`），同源头通过；主控端 WebView 须以宿主权威呈现请求头，或宿主启动加 `--trusted-host`。
- 服务注入：`ctx.webServer`（提供 `.port`）需在插件 `export const inject` 声明（cordis 强制）。
- 方法映射：`/api/session.list`、`session.create/prompt/...`、`host.listDirectory`、`workspace.create` 等——即官方 RPC 方法名，主控端零改动调用（PROTO-004）。

## 3. 插件隧道目标（audit#3 落地）

- 插件 rathole 客户端 `local_addr` = `ctx.get('webServer').port`（宿主原生 web 端口，127.0.0.1 默认安全姿态），**不再指向自建 /api/v1 网关**；无宿主 web 时退回自建网关（过渡态，随主控端 App 落地删除）。
- 全链实测（编号+密码 → grant → TLS 9443 → noise → 宿主 web）：官方 index.html（含 __DSH_BOOT__）经隧道返回；`POST /api/session.list` 官方信封 200 `{"ok":true,"value":{"items":[]}}`。

## 4. 下一步（主控端 App，audit#5 余下）

1. vendor 官方 dist（+LICENSE+THIRD_PARTY_NOTICES）到 apps/controller/web/；
2. Capacitor/Electron 壳：WebView 加载隧道内官方 UI（URL 权威改写层），首屏 = 设备管理（编号+密码，ToDesk 式）；
3. 原生桥：相机/相册/麦克风/文件（D-023）；
4. Web 版控制器：浏览器无法开裸 TLS 隧道连接——需 WebSocket 桥入口（SEC-004b web 变体），随壳里程碑一并设计。
