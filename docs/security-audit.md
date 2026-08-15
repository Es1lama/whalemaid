# WhaleMaid · 信道安全对照审计（SEC-001..005 结论与方案）

> 安全优先于体验（OWNER-DIRECTIVES D-029）。每环：成熟实现做法（源码位置）→ 我们现状 → 修复方案 → 验收单测。修完回写 TM 映射。
> 学习对象：rathole / frp（Apache-2.0 源码直接读）；headscale/Tailscale、RustDesk（B 档公开文档语义）。

## SEC-001 注册通道（受控端 → 服务端）

- **成熟实现**：frp 控制面自带 TLS listener（`server/service.go:98,351`）且登录时校验 token（`server/control.go:226 completeLogin`）；rathole 控制通道走 noise（snowstorm，静态本地私钥 + 可选固定远端公钥，`src/transport/noise.rs:7-49`），服务端用 `digest(token + nonce)` 校验（`src/server.rs:314`）。
- **关键事实（本次实测纠正）**：rathole `TransportType` 默认值是 **TCP 明文**（`src/config.rs` `#[default] Tcp`）——不写 transport 段就是明文隧道，绝不能依赖默认值。
- **我们现状（已修）**：控制面 API 全 TLS（axum-server + rustls 自签证书 + 受控端固定指纹，TOFU）；共享 ADMIN_TOKEN 废除，注册改一次性安装码，注册成功签发每设备独立凭据；**rathole 配置显式 `type="noise"` + `local_private_key`（静态 X25519 密钥对，`noise-key` 0600 持久化，重启不换）**，受控端经 /tunnel（TLS）拿 `serverPublicKey` 并 pin（NK 防中间人）。
- **验收单测（已绿 + 双端实测）**：无凭据注册 401；安装码校验；明文连接被拒；**真实 rathole 双端实测**（scripts/rathole-noise-e2e.mjs）：正确公钥 → 隧道建立、经服务端口 `echo:/hello?via=noise-tunnel` 通；错误公钥 → `Failed to do noise handshake: unexpected end of file`（pin 生效）；密钥对持久化往返公钥不变（单测）。

## SEC-002 密码匹配（主控端 → 服务端 /connect）

- **成熟实现**：RustDesk 设备访问密码只存哈希（scrypt，B 档文档）；行业标准 = 加盐慢哈希 + 限速 + 常数时间比较。
- **我们现状**：原计划 sha256 无盐（已回退未实现）；无限速。
- **修复方案**：`scrypt`（PHC，Node/Rust 跨语言互验，参数 ln=14,r=8,p=1）加盐哈希存服务端；`/connect` 按 (IP, deviceId) **固定窗口限速**（5 次/分钟）+ 连续失败锁定（5 次锁 5 分钟）——**窗口计数与失败计数分离**（失败不占限速预算，成功清零失败历史）；受控端注册时上报的密码哈希直接复用（服务端不碰明文密码）。
- **验收单测（已绿）**：错误密码 401；同哈希不同盐产出不同；限速窗口内第 6 次被拒 429；连续 5 次失败锁定 423、锁定期内正确密码也拒；失败不占限速预算；成功清零失败历史。

## SEC-003 隧道凭据（token 属受控端侧；主控端授权在网关侧）

- **成熟实现**：rathole per-service token 是**受控端客户端的静态凭据**（server.toml 明文、0600 权限），靠 noise 信道保护；frp token 经 TLS 控制面下发。主控端只是连服务端口的 TCP 客户端，**不持隧道 token**。
- **我们现状（已修正，Codex 审计#6）**：曾计划 /connect 返回并轮换 rathole token——轮换后受控端运行中的 sidecar 仍用旧 token，立即失配；且把 sidecar 服务 token 当主控端凭据下发属模型错误。
- **修复方案**：/connect 仅做**密码验证 + 寻址**（TLS 上，SEC-001），返回 `{ deviceId, service, port }`，**不含 token、不轮换**；隧道 token 一经注册固定，经 `/devices/:id/tunnel`（凭据鉴权）下发受控端 sidecar；主控端经服务端口进入隧道后，在受控端网关侧完成挑战应答绑定（SEC-004），密码只走 noise 密文信道。**隧道本身显式 noise**：中继侧 `[server.transport] type="noise"` + 静态密钥；受控端 `[client.transport] type="noise"` + `remote_public_key` pin（缺公钥拒绝建隧道）。
- **验收单测（已绿）**：/connect 响应不含 tunnelToken；连接前后 `/devices/:id/tunnel` 返回同一 token；错密 401、连续错 5 次锁定 423、锁定期内正确密码也拒绝；/connect 仅 TLS 提供；noise 双端实测（正确 pin 通、错误 pin 握手失败）。

## SEC-004 网关认证（主控端 → 受控端 /api）

- **成熟实现**：Tailscale 模型 = 长期节点身份（不可导出的设备密钥）+ 短生命周期会话密钥轮换（B 档文档）；headscale 节点注册需管理员批准。
- **原方案（已随 audit#3 废止）**：自造 Bearer device_token + 滑动 TTL + 挑战应答绑定——网关 RPC 全链删除后不再存在；授权改在**中继侧**（/connect 密码验证 + 单连接一次性 grant）+ **宿主官方信任栅栏**（同源权威校验，官方 DNS-rebinding 防御）。
- **现状（实测）**：主控端每条连接 = /connect 验密签 grant（TLS/WSS 入口消费）→ rathole noise → 宿主 web（127.0.0.1 默认姿态 + 官方 403 栅栏）。密码只走密文；服务端只比对 scrypt PHC。
- **验收单测（已绿）**：grant 重用/伪造/过期/跨设备失败；错密 401、限速 429、锁定 423 且锁定期内正确密码也拒；官方栅栏 403（非宿主权威头实测拒绝）。

### SEC-004b 主控端→中继段（rathole 明文服务端口的收尾，2026-08-15）

- **事实**：rathole 的加密只在中继↔受控端之间（noise，SEC-001/003 已显式化）；中继给主控端暴露的服务端口是原生明文 TCP——该段不闭合，肉鸡风险不成立"已修"。
- **方案（授权归中继，加密用现成 TLS，不自造协议）**：
  1. rathole 服务端口**只绑 127.0.0.1**（永不直接暴露公网）；
  2. `/connect` 密码验证通过后签发**短时一次性 grant**（256-bit 随机，TTL 2 分钟，单次消费，绑定 deviceId）；
  3. 中继另开 **TLS 隧道入口**（与 API 同一自签证书/指纹体系）：客户端发 `GRANT <token>` → 校验（限速+单次消费+TTL）→ 双工转发到 `127.0.0.1:<该设备端口>`；转发内容仍受 rathole noise 保护（到受控端），故全链无明文段。
- **验收（攻击路径，先红后绿）**：grant 重用失败；过期 grant 失败；错误 grant 失败且限速；/connect 响应不含任何 IP/端口路由秘密；服务端口未绑公网地址（监听地址断言）；e2e 全链：connect→grant→TLS 入口→echo 通。

## SEC-005 直连模式明文

- **成熟实现**：远程桌面工具直连时仍协商加密（RustDesk 为 E2E 加密直连；VNC 系默认加密隧道）。
- **现状（audit#3 后）**：插件已不自建任何监听——局域网 IP 直连 = **宿主官方能力**（`dsh web --host 0.0.0.0`，D-005 兼容原始 IP 连接），但明文 HTTP 仅在用户**显式开启** `--host 0.0.0.0` 且 `--trusted-host` 加白主控端权威时可用（官方默认 127.0.0.1 安全姿态）。默认路径恒为中继（TLS/WSS+noise）。
- **验收单测**：默认宿主配置只回环监听（官方默认）；非回环 = 用户显式开关（官方 CLI 旗标），无插件侧明文路径可绕过。

## 执行顺序（先文档后代码，铁律）

1. 本文件定稿 → 2. 每环按其"验收单测"写测试（先红） → 3. 实现到绿 → 4. 回写 threat-model.md TM 映射 → 5. 提交。
