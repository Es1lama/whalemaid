# Spike S2–S5 结论（M0 任务 3 第二批）

## S2：rathole sidecar 可行性 —— ✅ 确认（ADR-032）

实测源码（v0.5 主线，Apache-2.0，克隆于 /tmp/rathole-s2）：

- 结构：`server.rs` / `client.rs` / `config.rs` / `transport/{mod,noise}.rs`；服务端=单二进制+配置文件。
- 认证：**per-service token** + nonce 摘要（`session_key = digest(token + nonce)`，失败回 `Ack::AuthFailed`）——设备身份可以自然映射为"每设备一个 service + token"。
- 加密：noise 协议（snowstorm，`NoiseParams` 可配）。
- 生命周期：**热重载**（改配置文件即可增删 service，无需重启进程）；应用层心跳（服务端 30s 间隔 / 客户端 40s 超时可关）。
- **sidecar 接法定案**：控制面（我们的 Rust）生成 rathole 配置 → 托管子进程 → 热重载增删设备条目；**吊销 = 移除该设备 service 行 + 热重载**（即时生效，无需重启隧道进程）；每设备独立 token，token 即"长期凭据"的传输层表达。
- 注意点：HTTP API 仍 WIP（不影响我们，我们走配置文件）；noise 私钥管理由控制面持有。

## S3：PWA WebCrypto 设备密钥 —— ✅ 方案确认（ADR-033）

- `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, /*extractable*/false, ['sign','verify'])`——**不可导出**私钥，签名/验签可用；公钥可导出为指纹。
- 持久化：IndexedDB 存密钥对（CryptoKey 对象可结构化克隆存入）。
- 派生用法：设备密钥 = 签名设备 ID + 握手挑战（challenge-response 代替明文密码传输）；重装 PWA（清存储）即需重新配对——符合 REQ-015 验收。
- 运行时验证留 M1（浏览器行为标准，风险低）。

## S4：DashScope 定制热词 API —— ✅ 确认（ADR-034）

- **官方"定制热词 HTTP API"存在**（千问AI平台 docs：`vocabulary` / `vocabulary_id` / `vocabulary_list` 批量增删改查词汇表），实时识别会话携带 `vocabulary_id` 生效。
- 结论：Level 2 热词库 = 我们的服务器调用官方词汇表 API（增删热词）；宿主热词插件只提交"增/删关键词表"；BYOK 用户同理可自建词汇表。
- 接口鉴权与限额需 Phase B 时以真实 key 实测（当前无 key，文档级验证完成）。

## S5：视觉模型可用性 —— ✅ 确认（ADR-035）

- **DeepSeek-OCR**：api-docs.deepseek.com/guides/ocr 存在（HTTP 200），DeepSeek API 提供 OCR 模型（deepseek-ocr）。
- **通义 VL**：qwen-vl-max / qwen-vl-plus / qwen3-vl 均可用。
- 结论：视觉适配器 BYOK 注册表首期 = deepseek-ocr + qwen-vl-max/plus；codex/grok 等海外模型为可选注册项。DeepSeek V4 主模型仍无视觉，适配器"OCR/简述→文本嵌入"方案成立（REQ-022）。
