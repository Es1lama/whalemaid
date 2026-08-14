# Spike S0/S1 结论（M0 任务 3 第一批）

> 静态验证：本地 SDK（@deepseek-ai/dsh rc.6，195 包）+ 官方插件文档 + BSD-3 参考实现（dsh-remote-web-ui）。实机加载测试留 M1（不得重启当前运行的 DSH 实例）。

## S1：插件承载移动 UI 与宿主能力 —— ✅ 可行（静态确认）

1. **插件形态**：TS 模块导出 `apply(ctx)`（函数/对象/类三形态），经 `cordis.patch.yml`（`- insert: - id: xxx / name: <包名>`）注入 profile；package.json 的 `dsh` 字段声明 bundle.patch 与 client 注入。`dsh plugin --profile <name> add <pkg>` 安装。双面（宿主+浏览器）插件模式已被参考实现验证。
2. **宿主 API 全量可用**：`ctx.apiProxy` 提供 `workspace.create({path})`、`session.create/list/history/prompt/models/selectModel`、以及 wire 方法 **`host.listDirectory` / `host.createDirectory` / `host.pickDirectory` / `host.openPath` / `host.describe`**（apiproxy client.js/handler.js 已确认）——手机端建工作区的全部原料齐备。
3. **目录浏览 seam**：`ctx.directoryPicker.capability()` → `{kind:'browse', list(path?), createDirectory(path,name)}`，官方语义"serves remote clients the native backend cannot"。错误码 wire 化（`directory-unreadable/exists/create-failed`）。
4. **凭据存储**：`ctx.credentials`（resolve/set/unset/describe，shadowing 拒绝写入）——BYOK key 落点确认。
5. **web 路由**：`ctx.webServer` 注册 `WebRoute`（exact/prefix，handler 可长持有如 SSE）；另有 `WebUpgradeRoute`（ws 升级位）。

## S0：IP 直连 —— ⚠️ 重要发现，方案需调整

- **rc.6 的 CLI 拒绝 `--host 0.0.0.0`**（dsh-web-app README 原文：It rejects `--host 0.0.0.0` before publishing that service，全接口绑定尚未官方支持）；`WebServer` 配置 schema 本身允许 `'127.0.0.1' | '0.0.0.0'`，参考实现也按 `ctx.webServer.host === '0.0.0.0'` 分支——说明绑定可通过配置层达成，只是 CLI 旗标被拒。
- **因此直连方案（REQ-001）改为：插件自建 listener（选项 B）**——被控插件自己起一个 node:http(S) server 绑定 `0.0.0.0:<端口>`，内部用 `dsh-host-apiproxy` 的 `toFetchHandler(ctx.apiProxy)` 承接 `/api`、自持认证网关与静态 `/m`，不依赖 DSH 自身的绑定行为。收益：直连不依赖官方旗标、认证闸门独立于 GUI 信任栅栏、rathole sidecar 直接对接自有端口。成本：自持载体（官方已明示"carriers 自行包装 ctx.apiProxy"，属设计内用法）。
- 备选（选项 A）：骑在 `ctx.webServer` 注册路由——绑定问题受制于官方，且认证栅栏要插入 GUI 共享面，安全面耦合。**推荐 B。**

## 待 M1 实机验证

- 插件在真实 profile 挂载、`ctx.apiProxy`/`ctx.directoryPicker` 运行时行为、选项 B 自建 listener 与 GUI 并存（端口隔离）、LAN trust fence 行为、SSE 经自有 listener 透传。
