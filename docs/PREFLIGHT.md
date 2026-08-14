# WhaleMaid · 启动前清单（Preflight）

> M0 已收官、M1/V1 进行中（唯一现行版，旧版只存 git 历史）。
> 环境注记：仓库现位于工作区子目录 `whalemaid/`；GitHub 走代理 `http://127.0.0.1:7890`；gh 账号 **Es1lama**；双仓已建已推（公开 whalemaid / 私有 whalemaid-console）。
> 移动端原生（ADR-037）：Android(Kotlin) 本地先行；iOS(SwiftUI) 源码 + CI macOS 验证。

---

## 1. 阻塞项状态（已解决）

| # | 项 | 结论 |
|---|---|---|
| B1 | 定名 | **WhaleMaid（鲸娘）**，代码名 `whalemaid`；仓库 github.com/Es1lama/whalemaid（已建已推） |
| B2 | 技术栈 | **中继/控制面 Rust**；插件/移动端 TypeScript（React PWA）；SQLite；TLS+WebCrypto |
| B3 | Level 定义 | Level -1（仅邮箱：极高限速，一周停服）/ Level 0（绑手机：高限速限并发）/ Level 1（订阅：放宽+恶意/亏损阈值，绑手机送试用） / Level 2（增值） |
| B4 | 仓库归属 | gh 账号 **Es1lama**（双仓已建已推） |

## 2. 纪律声明（一劳永逸）

1. **引用顺序四步法**：A 档源码优先（frp/rathole 的 Apache-2.0 代码直接读）→ B 档公开文档（只覆盖用户可见行为，**不能上位替代实现细节**）→ RFC/标准 → C 档 AGPL 仅洁净室最后手段，留证 `docs/research/cleanroom-notes.md`。
2. **复用决策程序**（造轮子/复用边界/传承盈利三理论合一，见 DESIGN §2）：每个复用 vs 自写决策过流程并记 ADR；语言不一致优先 sidecar/进程边界复用。
3. **开源协议 AGPL-3.0（已确认）** + 双许可保留；社区贡献进闭源 SaaS 前必须 CLA（Phase B 生效前设立）。
4. **直连模式是 REQ 级要求**：开源代码必须原生支持 IP 直连。
5. **不过度耦合**：代码/注释/README 禁止出现 billing/subscription/account 字样或死代码桩；预留只体现在协议接缝。
6. **文档治理六原则**：简洁 / 有效（每条只服务一个目标）/ 时效（旧语义不入工作区，只存 git 历史，唯一现行版制）/ 指导（能直接指导开发）/ 一一对应（文档↔代码唯一映射）/ 溯源（编号贯穿，报错可反查）。

## 3. M0 任务与进度

| # | 任务 | 产出 | 状态 |
|---|---|---|---|
| 1 | 决策回溯 | `docs/adr/INDEX.md`（ADR-001..036） | ✅ |
| 2 | 需求编号表 | `docs/requirements.md`（REQ + REQ-REJ，均带验收标准） | ✅ |
| 3 | 三平台 spike + 实机冒烟 | spike 结论 + **真实 DSH 测试实例冒烟 7/7 通过** | ✅ |
| 4 | 协议 v1 | `docs/protocol.md`（PROTO-001..009） | ✅ |
| 5 | 威胁模型 v1 | `docs/threat-model.md`（TM-001..013） | ✅ |
| 6 | 仓库骨架 | monorepo + AGPL-3.0 + SECURITY + 模板 + CI（已绿） | ✅ |

### 实机测试结论（2026-08-15，独立实例 3181/3180，3080 会话本体全程无恙）

- 插件在真实 DSH host 挂载成功（`apply(ctx, config)` 惯例、`sessions` 复数签名、RpcRequest/RpcResponse 纪律透传）；
- 接口级冒烟 7/7：handshake → 挑战应答绑定 → 网关拒无 token → session.list 真实透传 → 坏凭据拒绝 → browse 目录浏览 → 全盘范围策略拒绝；
- 关键修复沉淀：信封解包、WebCrypto P1363 验签、nonce 绑定公钥、目录选择器 pin browse（禁用 auto 行 + 插入 browse 行）。

### M1 剩余（测试 loop 继续）

- ✅ REQ-003 临时密码（一次性/限时 + 短 TTL token，单测覆盖）；
- ✅ REQ-008 permission.get/set 透传（projections 基线 + /permission 命令）；
- ✅ 移动端完整视图：登录双模式/主页（工作区+会话）/目录浏览器（REQ-009）/聊天（REQ-005/006/007）+ 目录模式（REQ-010）+ 引用复制（REQ-011）；
- ✅ 插件直连服务 /m（完整移动 UI，REQ-001 闭环）；workspace.list 透传；
- ⬜ SSE 事件桥：已注册 host/session-status，事件流量验证需手机端实测；
- ⬜ workspace.create 冒烟已验证（8/8）；语音/视觉/热词 = V1 范围（REQ-020..022）；
- ⬜ 精确 HistoryEntry 渲染与模型 provider 分组目录（骨架级提取，待对齐类型）。

### Spike 清单（先验证再架构，防返工）

| # | 验证点 | 目的 |
|---|---|---|
| S0 | **IP 直连模式**：DSH web 绑定 0.0.0.0 后，手机浏览器直连 `/m` 路由实测 | ✅ 静态：rc.6 CLI 拒绝 `--host 0.0.0.0` → 改**插件自建 listener（选项 B）**；实机待 M1 | 
| S1 | DSH 插件注册 web 路由 + 调宿主 API（browse seam、`workspace.create`、`dsh-credentials`） | ✅ 静态：全部接口确认（见 research/spike-S0-S1.md）；实机待 M1 |
| S2 | rathole（Rust）服务端/客户端实测：noise 握手、授权语义、sidecar 管理可行性 | ✅ sidecar 定案（热重载增删设备条目、吊销=移除条目）；ADR-032 |
| S3 | PWA WebCrypto 密钥对：生成/持久化/不可导出 | ✅ 方案确认（ECDSA P-256 + IndexedDB + 挑战应答）；实机 M1；ADR-033 |
| S4 | DashScope 定制热词 API：鉴权 + 批量增删 | ✅ 文档级确认（vocabulary HTTP API + vocabulary_id）；真实 key 实测留 Phase B；ADR-034 |
| S5 | DeepSeek-OCR / 通义 VL 调用 | ✅ 确认（deepseek-ocr guides 存在；qwen-vl-max/plus）；ADR-035 |

## 4. 文档 ↔ 代码唯一映射机制

ADR-001..（决策）/ REQ-001..（需求+验收+代码路径）/ PROTO-001..（协议，代码头写 `SPEC: docs/protocol.md#PROTO-xxx`）/ TM-001..（威胁对策→检查点）/ architecture.md（模块→路径映射总表）。
变更规则：先改文档（含 ADR）→ 再改代码；PR 模板强制填写关联编号。

## 5. 用户待办

1. ~~创建仓库~~ ✅ 已由 gh 建仓并推送（Es1lama/whalemaid 公开 + whalemaid-console 私有）。
2. 确认试用月数（暂定 2 个月）。
3. 吉祥物草图（M2 前有即可，不阻塞）。
