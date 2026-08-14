# WhaleMaid · 启动前清单（Preflight）

> 阻塞项已全部敲定，M0 已启动。本文件是 M0 的路线图与纪律声明（唯一现行版，旧版只存 git 历史）。
> 环境注记：本机访问 GitHub 需走规则代理 `http://127.0.0.1:7890`（git 配置 `http.proxy` 同理）；git 已 init，本地提交身份 esilama。

---

## 1. 阻塞项状态（已解决）

| # | 项 | 结论 |
|---|---|---|
| B1 | 定名 | **WhaleMaid（鲸娘）**，代码名 `whalemaid`；github.com/esilama/whalemaid 已核实可用，**待用户创建仓库** |
| B2 | 技术栈 | **中继/控制面 Rust**；插件/移动端 TypeScript（React PWA）；SQLite；TLS+WebCrypto |
| B3 | Level 定义 | Level -1（仅邮箱：极高限速，一周停服）/ Level 0（绑手机：高限速限并发）/ Level 1（订阅：放宽+恶意/亏损阈值，绑手机送试用） / Level 2（增值） |
| B4 | 仓库归属 | 个人账号 **esilama** |

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
| 1 | 决策回溯 | `docs/adr/INDEX.md`（ADR-001..028） | ✅ |
| 2 | 需求编号表 | `docs/requirements.md`（REQ-001..035 + REQ-REJ-001..007，均带验收标准） | ✅ |
| 3 | 三平台 spike | 结论回写 ADR | ⬜ 下一步 |
| 4 | 协议 v1 | `docs/protocol.md`：PROTO-001.. 信封/capability/三通道/错误码 | ⬜ 依赖 3 |
| 5 | 威胁模型 v1 | `docs/threat-model.md`：TM-001.. 对策→检查点 | ⬜ 依赖 4 |
| 6 | 仓库骨架 | monorepo + LICENSE（AGPL-3.0）+ SECURITY.md + 模板 + CI | ⬜ 依赖 1、2 |

### Spike 清单（先验证再架构，防返工）

| # | 验证点 | 目的 |
|---|---|---|
| S0 | **IP 直连模式**：DSH web 绑定 0.0.0.0 后，手机浏览器直连 `/m` 路由实测 | 验证直连 REQ 与插件注册 web 路由的可行性（与 S1 合并做） |
| S1 | DSH 插件注册 web 路由 + 调宿主 API（browse seam、`workspace.create`、`dsh-credentials`） | 验证插件能承载移动 UI 与全部宿主能力 |
| S2 | rathole（Rust）服务端/客户端实测：noise 握手、授权语义、sidecar 管理可行性 | 决定中继接法（设备身份如何挂） |
| S3 | PWA WebCrypto 密钥对：生成/持久化/不可导出 | 决定设备凭据实现 |
| S4 | DashScope 定制热词 API：鉴权 + 批量增删 | 决定热词接口形状 |
| S5 | DeepSeek-OCR / 通义 VL 调用 | 决定视觉适配器接口 |

## 4. 文档 ↔ 代码唯一映射机制

ADR-001..（决策）/ REQ-001..（需求+验收+代码路径）/ PROTO-001..（协议，代码头写 `SPEC: docs/protocol.md#PROTO-xxx`）/ TM-001..（威胁对策→检查点）/ architecture.md（模块→路径映射总表）。
变更规则：先改文档（含 ADR）→ 再改代码；PR 模板强制填写关联编号。

## 5. 用户待办

1. 创建仓库 github.com/esilama/whalemaid（空仓库即可，骨架任务 6 会提交）。
2. 确认试用月数（暂定 2 个月）。
3. 吉祥物草图（M2 前有即可，不阻塞）。
