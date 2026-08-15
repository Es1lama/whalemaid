# WhaleMaid · 信道安全对照审计计划（SEC-001..）

> 最高优先级。原则：**涉及网络安全的每一环，先对照成熟实现（许可允许直接读源码），自造面最小化；任何新安全原语必须在本表登记并引用对照来源。**
> 体验规范（UX-001..）降级为次要，安全审计先行。

## 审计环节对照表（学习对象：rathole/frp Apache-2.0 源码、Tailscale/headscale BSD-3、RustDesk 仅 B 档文档语义）

| # | 环节 | 成熟实现怎么做 | 我们现状 | 差距（P0=必须修） |
|---|---|---|---|---|
| SEC-001 | 注册通道（受控端→服务端） | TLS；受控端持独立注册凭据（非共享） | HTTP 明文 + 共享 ADMIN_TOKEN Bearer | **P0**：TLS + 每设备独立注册凭据（安装码/设备密钥签名）；共享 token 泄露=全盘沦陷 |
| SEC-002 | 密码匹配（主控端→服务端） | 加盐哈希（bcrypt/argon2）+ 限速 + 锁定 + 常数时间比较 | 计划 sha256 无盐、无限速（被 UX-008 点出） | **P0**：scrypt 加盐 + 失败限速/锁定 + timingSafeEqual |
| SEC-003 | 主控端→受控端信道 | rathole noise（已复用）；控制面返回隧道 token 必须走 TLS | /connect 计划返回 rathole token 经 HTTP | **P0**：/connect 走 TLS；token 一次性下发、用后轮换 |
| SEC-004 | 网关认证（/api） | Tailscale 模型：长期节点身份 + 短期会话密钥轮换 | 自造 Bearer device_token（无轮换、无 TTL） | **P0**：token 短期化 + 轮换；对照 headscale 节点密钥语义 |
| SEC-005 | 直连模式信道 | TLS（局域网可自签+指纹固定） | HTTP 明文（仅本地/局域网） | **P0**：默认禁用明文直连，启用需显式 + 指纹/HTTPS 提示 |
| SEC-006 | 重放防护 | nonce 一次性 + 时间窗 + 绑定挑战 | nonce 一次性（有），无时间窗 | P1：nonce 加短 TTL 时间窗（已有 60s，核对实现） |
| SEC-007 | 防爆破（网关绑定接口） | 限速 + 锁定（已实现 FailCounter） | ◐ 有雏形 | P1：与 SEC-002 统一限速策略、审计日志联动 |
| SEC-008 | 吊销传播 | 即时生效 | ✅ 网关即时拒绝 + rathole 条目移除（已实现） | 保持 |
| SEC-009 | 中继零知识 | noise 密文转发，不落地 | ✅ rathole（已实现） | 保持；补"中继不存密钥明文"审计（rathole_token 落盘 0600 已做） |
| SEC-010 | 密钥存储 | 系统钥匙串/credential 体系 | 宿主 dsh-credentials / 手机 Keystore-SecureEnclave ✅ | 保持 |
| SEC-011 | 供应链 | 零 AGPL、依赖锁定 | ✅ 已立规 | 保持；定期审计 |

## 执行顺序

1. SEC-001..005（P0 五环）逐条修：实现前先在 `docs/security-audit.md` 写"对照结论 + 修复方案"（引用 rathole/frp/headscale 源码位置）；
2. 每修一环：单测覆盖攻击路径（错误密码、重放 nonce、过期 token、吊销后重连）；
3. 修复后更新 TM（threat-model.md）编号映射，作为验收依据。

## 铁律（纠"指一修一"）

- 你指出一个安全问题 → 本表全量过一遍，同类全查；
- 新安全代码 = 先登记对照来源，否则不写；
- 不自己发明加密原语，只组装已被验证的组件（TLS/noise/scrypt/WebCrypto/SecureEnclave）。
