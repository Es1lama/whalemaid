# WhaleMaid · 协议 v1 规格（PROTO）

> 唯一现行版。代码模块头部引用 `SPEC: docs/protocol.md#PROTO-xxx`。承载无关：同一协议跑在直连与中继两种承载上。
> 设计约束（ADR-021）：版本化信封、capability 广播、`CredentialVerifier` 抽象、三通道先行；**禁止出现 billing/subscription/account 字样**（Level 2 路由以 `server-provided` 能力位表达，不在开源代码中实现）。

---

## PROTO-001 传输与信封

- 承载：HTTP(S) 单向请求 + SSE 事件流。WebSocket 留 V2（宿主 `WebUpgradeRoute` 已确认存在）。
- 端点（宿主自建 listener，见 ADR-031 选项 B）：
  - 请求：`POST /api/v1/<method>`，body = 信封 JSON；
  - 事件：`GET /api/v1/events`（SSE）；SSE 不通时客户端降级轮询 `GET /api/v1/poll?since=<seq>`（3s，参考 dsh-remote-web-ui 的 cloudflared 经验）。
- 请求信封：`{ "v": 1, "rpcId": "<uuid>", "method": "<name>", "payload": {} }`
- 响应信封：`{ "v": 1, "rpcId": "<uuid>", "ok": true, "data": {} }` 或 `{ "ok": false, "error": { "code": "<见 PROTO-008>", "message": "..." } }`
- SSE 帧：`data: {"v":1,"seq":<单调递增>,"type":"<见各通道>","payload":{}}`；重连用 `Last-Event-ID`。

## PROTO-002 capability 广播

- 握手响应（`device.handshake` / 首帧）携带 `caps: string[]`；客户端忽略未知位，宿主按位降级。
- v1 位表：`session`、`workspace-create`、`directory-browse`、`voice-byok`、`vision-byok`、`hotwords`（热词插件安装且开启才存在）、`relay`、`direct`。
- 未声明能力的方法调用返回 `cap-unsupported`。

## PROTO-003 认证与凭据（CredentialVerifier 抽象）

接口抽象：`CredentialVerifier = { verify(request) → identity | null }`，v1 两个实现：`LongTermPasswordVerifier`、`OneTimePasswordVerifier`（未来账号 token 为第三个实现，不重写协议）。

1. **设备 ID**：宿主生成 `WHALE-XXXX-XXXX`（8 字节 base32，排除易混字符），桌面插件设置页展示。
2. **长期密码（REQ-002）**：宿主生成随机 12 字符，设置页展示、可重生成（重生成 = 吊销全部设备 token）。
3. **首次配对（挑战-应答）**：
   - 客户端 `device.handshake { deviceId, publicKey(jwk) }` → 宿主回 `{ nonce, caps }`；
   - 客户端 `device.bind { deviceId, password, nonceSignature }`（签名 = ECDSA P-256 签 nonce，私钥不可导出，见 ADR-033）→ 宿主验签+验密码 → 绑定公钥，签发 `device_token`（256-bit 随机，宿主存摘要）；
   - 后续请求头 `Authorization: Bearer <device_token>`。
4. **临时密码（REQ-003）**：宿主生成一次性/限时（默认 10 分钟）密码 → 客户端 `device.bindTemporary { deviceId, password }` 换短 TTL 临时 token；用过即焚。
5. 密码仅用于绑定流程，之后不再传输；直连 HTTP 时客户端必须提示（局域网信任或建议 HTTPS）。

## PROTO-004 会话通道（E2E 主通道）

- 方法（一一对应 DSH 原生语义，薄转发，不改业务）：`session.list`、`session.history`、`session.create`、`session.prompt`、`session.stop`、`session.models`、`session.selectModel`、`permission.get`、`permission.set`。
- SSE 帧类型：`turn-status`（running/done/interrupted）、`message`（增量）、`tool-call`（折叠展示用）、`permission-request`（审批，客户端弹确认）。
- 承载无关：直连与中继下完全相同。

## PROTO-005 语音通道（知情同意通道）

- `voice.transcribe { audio, format, provider }` → 宿主按用户 BYOK 配置调 ASR → `{ text }`。
- `provider` 为注册表键（v1 注册表：`dashscope-paraformer`；可插拔，见 ADR-009）。
- Level 2（`server-provided`）：能力位预留，开源实现**不含**该路由；客户端据 caps 显示知情同意 UI。
- 热词（仅 `hotwords` 位存在时）：`voice.hotwords.update { add: string[], remove: string[] }`——宿主本地抽取后调用；只传词表（ADR-010）。

## PROTO-006 视觉通道（知情同意通道）

- `vision.describe { image, provider }` → 宿主调视觉 API（BYOK）→ `{ text }`；客户端把 text 嵌入下一条 `session.prompt`。
- v1 注册表：`deepseek-ocr`、`qwen-vl-max`、`qwen-vl-plus`（ADR-035）；`server-provided` 预留。

## PROTO-007 目录浏览与工作区创建

- 方法：`host.listDirectory { path? }`、`host.createDirectory { path, name }`、`workspace.create { path }`（直通 DSH wire 语义）。
- 范围策略（ADR-008）：默认浏览范围 = 已注册工作区根集合 + 宿主 home 的 `~/` 一级；请求 `{ scope: "full", confirm: true }` 且长期密码二次确认通过后放开全盘。宿主侧执行策略，客户端只呈现。

## PROTO-008 错误码表

| code | 语义 |
|---|---|
| `ok` | 成功（信封 ok:true） |
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
