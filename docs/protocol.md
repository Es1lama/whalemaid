# WhaleMaid · 协议 v2 规格（PROTO）

> 唯一现行版（ADR-041 后）。代码模块头部引用 `SPEC: docs/protocol.md#PROTO-xxx`。
> 现行承载：主控端同源调用 **DSH 原生 `/api`**（官方前端零改动），经受控端插件网关鉴权后打到受控端；网关只保留设备配对/管理最小端点。旧版自定 `/api/v1` RPC 已废止（ADR-041），迁移路径见 PROTO-010。
> 设计约束（ADR-021）：版本化信封、capability 广播、`CredentialVerifier` 抽象、三通道先行；**禁止出现 billing/subscription/account 字样**（Level 2 路由以 `server-provided` 能力位表达，不在开源代码中实现）。

---

## PROTO-001 传输与承载

- 承载：HTTP(S) 请求 + SSE 事件流。WebSocket 留 V2。
- **现行端点（ADR-041）**：
  - 业务：`/api/**` —— DSH 原生 API，同源透传（`toFetchHandler(ctx.apiProxy)`），信封即 DSH 原生 wire 契约（`{ rpcId, result: { ok, value | error } }`），前端调用点零改动；
  - 事件：`/api/events`（SSE，见 events.ts）；SSE 不通时客户端降级轮询；
  - 网关最小端点（设备配对/管理，网关自有命名）：`bind`/`handshake`/`list`/`revoke`/`heartbeat`（认证/语义见 PROTO-003/009）。
- 直连与中继承载同一套 `/api` 语义（PROTO-004）；中继控制面在服务端 `/_whalemaid/*` 命名空间下（见 docs/deploy-server.md，与网关协议层无耦合）。
- **原生契约（已实测，2026-08-15）**：受控端宿主的 `dsh web` 服务（官方 web-app bundle）本身就是唯一 `/api` 载体——请求 `{type:"client-request", rpcId, method:"session.list", payload:{}}` → `{type:"server-response", rpcId, result:{ok,value|error}}`；WS 下联 `/api/events.mux` 与 `/api/events.host`；`GET /` 返回官方前端 + `window.__DSH_BOOT__` 注入。插件隧道 local_addr 直指宿主 web 端口（`ctx.get('webServer').port`），**不重造任何 RPC**（audit#3）。
- **迁移路径（过渡态）**：插件内旧 `/api/v1` 自建 RPC 仅在宿主无 web 服务时兜底，随主控端 App 落地后连同 packages/contract 信封一并删除；CI 禁止新代码使用 `/api/v1` 字面量阻断回潮。

## PROTO-002 capability 广播

- 握手响应（`device.handshake` / 首帧）携带 `caps: string[]`；客户端忽略未知位，宿主按位降级。
- v1 位表：`session`、`workspace-create`、`directory-browse`、`voice-byok`、`vision-byok`、`hotwords`（热词插件安装且开启才存在）、`relay`、`direct`。
- 未声明能力的方法调用返回 `cap-unsupported`。

## PROTO-003 认证与凭据（CredentialVerifier 抽象）

接口抽象：`CredentialVerifier = { verify(request) → identity | null }`，v1 两个实现：`LongTermPasswordVerifier`、`OneTimePasswordVerifier`（未来账号 token 为第三个实现，不重写协议）。

1. **设备 ID**：宿主生成 `WHALE-XXXX-XXXX`（8 字节 base32，排除易混字符），插件设置页展示。
2. **长期密码（REQ-002）**：宿主生成随机 12 字符，设置页展示、可重生成（重生成 = 吊销全部设备 token）。
3. **首次配对（挑战-应答）**：
   - 客户端 `device.handshake { deviceId, publicKey(jwk) }` → 宿主回 `{ nonce, caps }`；
   - 客户端 `device.bind { deviceId, password, nonceSignature }`（签名 = ECDSA P-256 签 nonce，私钥不可导出，见 ADR-033）→ 宿主验签+验密码 → 绑定公钥，签发 `device_token`（256-bit 随机，宿主存摘要）；
   - 后续请求头 `Authorization: Bearer <device_token>`。
4. **临时密码（REQ-003）**：宿主生成一次性/限时（默认 10 分钟）密码 → 客户端 `device.bindTemporary { deviceId, password }` 换短 TTL 临时 token；用过即焚。
5. 密码仅用于绑定流程，之后不再传输；直连 HTTP 时客户端必须提示（局域网信任或建议 HTTPS）。

## PROTO-004 会话通道（E2E 主通道）

- 承载 = DSH 原生 `/api` 会话语义（`session.list`、`session.history`、`session.create`、`session.prompt`、`session.stop`、`session.models`、`session.selectModel`、`permission.get/set`），网关薄转发、不改业务；直连与中继下完全相同。
- SSE 帧类型：`turn-status`（running/done/interrupted）、`message`（增量）、`tool-call`（折叠展示用）、`permission-request`（审批，客户端弹确认）。

## PROTO-005 语音通道（知情同意通道）

- `voice.transcribe { audio, format, provider }` → 宿主按用户 BYOK 配置调 ASR → `{ text }`。
- `provider` 以代码注册表 `packages/contract/src/channels.ts` 的 `VOICE_PROVIDERS` 为唯一权威（v1：`dashscope`/`openai`/`groq`/`iflytek`；可插拔，见 ADR-009）。**验收状态**：DashScope 路径未经真实 key 验收（PREFLIGHT S4，发布前必须完成或移出能力位，audit#7）。
- Level 2（`server-provided`）：能力位预留，开源实现**不含**该路由；客户端据 caps 显示知情同意 UI。
- 热词（仅 `hotwords` 位存在时）：`voice.hotwords.update { add: string[], remove: string[] }`——宿主本地抽取后调用；只传词表（ADR-010）。

## PROTO-006 视觉通道（知情同意通道）

- `vision.describe { image, provider }` → 宿主调视觉 API（BYOK）→ `{ text }`；客户端把 text 嵌入下一条 `session.prompt`。
- `provider` 以 `packages/contract/src/channels.ts` 的 `VISION_PROVIDERS` 为唯一权威（v1：`deepseek-ocr`/`qwen-vl`/`openai-vision`/`grok-vision`/`gemini`，ADR-035）；`server-provided` 预留。

## PROTO-007 目录浏览与工作区创建

- 方法：`host.listDirectory { path? }`、`host.createDirectory { path, name }`、`workspace.create { path }`（直通 DSH wire 语义）。
- 范围策略（ADR-008）：默认浏览范围 = 已注册工作区根集合 + 宿主 home 的 `~/` 一级；请求 `{ scope: "full", confirm: true }` 且长期密码二次确认通过后放开全盘。宿主侧执行策略，客户端只呈现。

## PROTO-008 错误码表

| code | 语义 |
|---|---|
| `ok` | 成功 |
| `bad-request` | 信封/参数非法 |
| `auth-failed` | 密码/签名/凭据错误 |
| `device-revoked` | 设备已被吊销（REQ-004） |
| `token-expired` | 临时 token 到期或已用 |
| `rate-limited` | 触发限速（宿主本地策略） |
| `method-unknown` | 方法不存在 |
| `cap-unsupported` | 能力位未声明 |
| `directory-unreadable` / `directory-exists` / `directory-create-failed` | 转发 DSH 原语义 |
| `scope-denied` | 目录范围策略拒绝（未二次确认） |
| `server-error` | 内部错误（不含敏感信息） |

## PROTO-009 吊销与审计

- 吊销即时生效：宿主移除设备条目后，该设备下一次请求回 `device-revoked`，SSE 连接同时断开（ADR-012）。
- 宿主本地审计日志只记元数据（时间/设备/方法/结果），不记内容（REQ-016）。
- 中继（rathole）只转发密文，与协议层无耦合（ADR-032）。

## PROTO-010 网关最小端点（设备配对/管理）

> 主控端与受控端网关之间的唯一自研面。业务能力全部走 `/api` 原生透传；只有配对/管理留在网关（ADR-041）。

| 端点 | 语义 | 认证 |
|---|---|---|
| `device.handshake` | 交换 nonce + caps（PROTO-003） | 公开 |
| `device.bind` | 长期密码绑定、签发 device_token | 挑战-应答 + 密码 |
| `device.bindTemporary` | 临时密码换短 TTL token | 密码 |
| `device.list` | 受控端设备信息（自身） | Bearer device_token |
| `device.revoke` | 吊销 device_token（REQ-004） | Bearer + 密码 |
| `device.heartbeat` | 在线状态保活（TM-005） | Bearer |

服务端连接流程（ADR-042，UU/ToDesk 式，**用户不填任何 IP**）：受控端注册设备编号+密码哈希 → 主控端 `/_whalemaid/connect`（编号+密码，限速/锁定）→ 服务端签发**单连接一次性 grant**（2min）→ 主控端 TLS 连隧道入口发 `GRANT <grant> <deviceId>` → 进入 rathole noise 隧道 → 受控端宿主原生 `/api`（官方信封+官方信任栅栏，浏览器同源头）+ 官方前端（`__DSH_BOOT__`）。**断线重连 = 重新 /connect 取新 grant**（grant 单次消费）；同一隧道连接上可跑完整会话（含 WS 下联）。主控端 WebView 须以受控端宿主的权威（如 `http://127.0.0.1:<web端口>`）呈现请求头，或在宿主 `--trusted-host` 显式加入主控端权威。
