# WhaleMaid · 信道安全对照审计（SEC-001..005 结论与方案）

> 安全优先于体验（OWNER-DIRECTIVES D-029）。每环：成熟实现做法（源码位置）→ 我们现状 → 修复方案 → 验收单测。修完回写 TM 映射。
> 学习对象：rathole / frp（Apache-2.0 源码直接读）；headscale/Tailscale、RustDesk（B 档公开文档语义）。

## SEC-001 注册通道（受控端 → 服务端）

- **成熟实现**：frp 控制面自带 TLS listener（`server/service.go:98,351`）且登录时校验 token（`server/control.go:226 completeLogin`）；rathole 控制通道走 noise（snowstorm，静态本地私钥 + 可选固定远端公钥，`src/transport/noise.rs:7-49`），服务端用 `digest(token + nonce)` 校验（`src/server.rs:314`）。
- **我们现状**：控制面管理 API 是 HTTP 明文 + 共享 ADMIN_TOKEN（Bearer）——共享令牌一漏全盘沦陷，且无传输加密。
- **修复方案**：
  1. 控制面 HTTP 换 **TLS**（axum-server + rustls；自签证书 + 受控端固定指纹/CA，TOFU 模型）；
  2. **废除共享 ADMIN_TOKEN**：受控端首次注册改用一次性安装码（服务端启动时生成、短 TTL），注册成功后服务端签发**每设备独立凭据**（随机 256-bit，0600 落盘），后续注册/心跳用该凭据；管理员操作走独立管理凭据。
- **验收单测**：无凭据注册 401；安装码重用失败；过期安装码失败；明文（无 TLS）连接被拒（CI 用 rustls 配置断言）。

## SEC-002 密码匹配（主控端 → 服务端 /connect）

- **成熟实现**：RustDesk 设备访问密码只存哈希（scrypt，B 档文档）；行业标准 = 加盐慢哈希 + 限速 + 常数时间比较。
- **我们现状**：原计划 sha256 无盐（已回退未实现）；无限速。
- **修复方案**：`argon2id`（Rust `argon2` crate）加盐哈希存服务端；`/connect` 按 (IP, deviceId) 双维度**令牌桶限速**（如 5 次/分钟）+ 连续失败锁定（5 次锁 5 分钟）；比较用常数时间（哈希比较本身即可，另加 timing 安全断言）。受控端注册时上报的密码哈希直接复用（不再自算 sha256）。
- **验收单测**：错误密码拒绝；同哈希不同盐产出不同；限速窗口内第 6 次被拒（429）；锁定后正确密码也被拒。

## SEC-003 隧道凭据下发（/connect → 主控端拿 rathole token）

- **成熟实现**：rathole per-service token 是**静态配置项**，靠 noise 信道保护传输；frp token 经 TLS 控制面下发。
- **我们现状**：计划 /connect 返回 rathole token——若走 HTTP 即明文泄露。
- **修复方案**：/connect 仅经 TLS 提供（随 SEC-001）；且**每次连接签发一次性隧道 token**（连接结束即吊销/轮换），复用 rathole 热重载移除条目；token 只出现一次。
- **验收单测**：/connect 响应含 token 且端点强制 TLS；断开后旧 token 握手被 rathole 拒绝（集成测试）。

## SEC-004 网关认证（主控端 → 受控端 /api）

- **成熟实现**：Tailscale 模型 = 长期节点身份（不可导出的设备密钥）+ 短生命周期会话密钥轮换（B 档文档）；headscale 节点注册需管理员批准。
- **我们现状**：自造 Bearer device_token（无 TTL、无轮换、明文 HTTP 承载）。
- **修复方案**：
  1. 设备身份 = 受控端持有的长期密钥对（沿用现有 WebCrypto/Keystore/SecureEnclave 不可导出模型，D-已定）；
  2. 网关签发**短 TTL（10 分钟）会话 token**（HMAC 签名，含 deviceId+exp），主控端自动续期；吊销 → 服务端与受控端双侧拒绝（已有即时吊销，保留）；
  3. 承载信道默认走中继（noise）或 TLS；**HTTP 明文仅允许 127.0.0.1 回环**（开发态显式开关）。
- **验收单测**：过期 token 拒绝；篡改 token 拒绝；吊销后旧会话 token 立即拒绝；回环例外仅在显式开启时生效。

## SEC-005 直连模式明文

- **成熟实现**：远程桌面工具直连时仍协商加密（RustDesk 为 E2E 加密直连；VNC 系默认加密隧道）。
- **我们现状**：手机→受控端 HTTP 明文（局域网）。
- **修复方案**：**默认禁用明文直连**；直连必须 HTTPS（自签证书 + 首次指纹确认，TOFU，指纹展示给用户核对）；局域网用户可选用中继（默认路径）或 Tailscale 类网络。文档与 UI 明示"明文直连仅限本机回环"。
- **验收单测**：http:// 直连（非回环）默认拒绝；https:// + 指纹不匹配告警；回环 http 仅开发开关。

## 执行顺序（先文档后代码，铁律）

1. 本文件定稿 → 2. 每环按其"验收单测"写测试（先红） → 3. 实现到绿 → 4. 回写 threat-model.md TM 映射 → 5. 提交。
