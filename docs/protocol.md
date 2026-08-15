# WhaleMaid · 协议 v3 规格（PROTO）

> 唯一现行版（2026-08-15，自定 RPC 全链废止后）。代码模块头部引用 `SPEC: docs/protocol.md#PROTO-xxx`。
> 现行模型：**受控端不重造任何协议**——主控端经中继隧道直达受控端宿主原生 web（官方 `/api` + WS + UI）；WhaleMaid 自研面只剩中继控制面 `/_whalemaid/*`（docs/deploy-server.md）与隧道承载（SEC-004b）。
> 设计约束（ADR-021）：**禁止出现 billing/subscription/account 字样**（Level 2 路由以 `server-provided` 能力位表达，不在开源代码中实现）。

---

## PROTO-001 传输与承载

- 承载：HTTP(S) 请求 + **WebSocket 事件下联**（官方 web 载体实测）。
- **现行端点**：
  - 业务：`/api/**` —— DSH 原生 API（受控端宿主 `dsh web` 自带），信封 = 官方 wire 契约 `{type:"client-request", rpcId, method, payload}` → `{type:"server-response", rpcId, result:{ok,value|error}}`；主控端前端调用点零改动；
  - 事件：WebSocket `/api/events.mux`（审批/请求帧）与 `/api/events.host`（宿主帧）；
  - 前端：`GET /` 官方前端 + `window.__DSH_BOOT__` 注入。
- 隧道承载（SEC-004b，两形态）：① 裸 TLS `tls://<中继>:9443`（首行 `GRANT <grant> <deviceId>`）；② WSS `wss://<中继>/_whalemaid/tunnel-ws`（首帧同）。grant = `/connect` 密码验证后签发（2min、单次消费、绑定设备）；**断线重连 = 重新 /connect**。
- 全链无明文段：主控端→中继 = TLS/WSS；中继→受控端 = rathole noise（静态 X25519 + pin 公钥）；受控端内部 = 官方 web（127.0.0.1 默认姿态 + 官方信任栅栏）。

## PROTO-002 能力面（不再自研广播）

- 能力 = 官方 API 面本身：会话（session.*）、工作区（workspace.*）、目录浏览（host.listDirectory/createDirectory，官方 browse seam）、附件（官方 dsh-attachment 管道）、审批（官方 permission/mux）。主控端不需要能力协商——官方前端按宿主实际插件组合自适配。
- 官方前端同源经隧道后，请求头须以宿主权威呈现（`Host/Origin = 127.0.0.1:<web端口>`），由官方信任栅栏放行；宿主另可 `--trusted-host` 显式加白。

## PROTO-003 认证与授权（全部在中继侧）

1. **设备编号**：宿主插件生成 `WHALE-XXXX-XXXX`（base32 排除易混字符），受控端设置页展示。
2. **长期密码（REQ-002）**：宿主生成随机 12 字符；注册时只上报 **scrypt PHC 哈希**（ln=14,r=8,p=1，Node/Rust 跨语言互验）；重生成 = 清凭据重新注册（旧哈希随注册更新即失效）。
3. **每设备凭据（SEC-001）**：安装码注册签发随机 256-bit 凭据（受控端落盘 0600），用于隧道签发/心跳/自吊销。
4. **主控端授权（SEC-002/004b）**：`/_whalemaid/connect`（编号+密码，限速 5/min、错 5 次锁 5 分钟）→ 单连接一次性 grant → 隧道入口消费。密码只走 TLS/WSS/noise 密文，服务端只比对哈希。
5. 吊销即时生效：设备条目移除 → 隧道热重载断开 → 凭据心跳 401 → 主控端 grant 拒发。

## PROTO-004 会话通道（E2E 主通道）

官方 `/api` 会话语义（`session.list/history/create/prompt/stop/models/selectModel`、`permission.get/set`）直通透传，网关不落任何内容（中继零知识，ADR-025）。事件经官方 WS 下联：`turn-status`、`message` 增量、`permission-request` 审批弹窗等由官方前端原生渲染。

## PROTO-005/006 语音与视觉（V1 扩展里程碑，本期未实现）

- 原则不变（ADR-009/011/013/035）：BYOK（key 只存宿主 dsh-credentials）+ 知情同意 + `server-provided` 位预留。
- 承载变更：**不再自造 RPC 方法**——按官方扩展机制实现：宿主插件以 apiProxy 扩展命名空间暴露能力，官方前端以 **client module（插件运行时 bundle）** 挂载语音/视觉 UI（与官方插件同构）。未验收的 dashscope 路径不得广播能力（audit#7）。
- 移动端原生桥（录音/相册/相机/文件，D-023）在 Capacitor 壳层实现，数据经官方附件管道（dsh-attachment）进宿主。

## PROTO-007 目录浏览与工作区

- 官方 wire 语义：`host.listDirectory { path? }`、`host.createDirectory { path, name }`、`workspace.create { path }`——宿主官方插件原生实现（browse seam），范围策略由宿主执行（ADR-008），客户端只呈现。

## PROTO-008 错误语义

| 层 | 错误 | 语义 |
|---|---|---|
| 官方 /api | 官方信封 `result:{ok:false,error:{code,message}}` | 业务错误恒 200（官方契约） |
| 官方信任栅栏 | HTTP 403 | 跨站/非信任权威（DNS-rebinding 防御） |
| 中继 /connect | 401 / 429 / 423 | 密码错误或设备未知 / 限速 / 锁定（SEC-002） |
| 隧道入口 | 断连（无响应） | grant 无效/过期/已消费/设备不匹配——不泄露细节 |

## PROTO-009 吊销与审计

- 吊销即时生效（TM-005）：条目移除 → rathole 热重载 → 该设备隧道与凭据立即失效。
- 中继不存储会话内容（ADR-025）；宿主审计由官方宿主日志承担（元数据级）。

## 中继控制面端点汇总（实现于 packages/relay）

| 端点 | 语义 | 认证 |
|---|---|---|
| `POST /_whalemaid/devices` | 受控端注册（编号+密码哈希） | x-install-code |
| `POST /_whalemaid/devices/:id/heartbeat` | 心跳（45s 在线窗口） | 每设备凭据 |
| `POST /_whalemaid/devices/:id/tunnel` | 隧道签发（token+serverPublicKey，不轮换） | 每设备凭据 |
| `GET /_whalemaid/devices/:id/status` | 公开在线查询（不回路由秘密，限速） | 无 |
| `DELETE /_whalemaid/devices/:id` | 吊销（自吊销或管理令牌） | 凭据/admin |
| `POST /_whalemaid/connect` | 主控端连接：密码验证 + grant（无 IP） | 无（限速+锁定） |
| `GET /_whalemaid/tunnel-ws` | WSS 隧道入口 | grant |
| `GET /_whalemaid/devices` | 管理列表 | admin |
