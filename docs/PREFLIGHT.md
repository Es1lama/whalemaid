# WhaleMaid · 启动前清单（Preflight）

> M0 已收官、M1/V1 进行中（唯一现行版，旧版只存 git 历史）。
> 环境注记：仓库现位于工作区子目录 `whalemaid/`；GitHub 走代理 `http://127.0.0.1:7890`；gh 账号 **Es1lama**；双仓已建已推（公开 whalemaid / 私有 whalemaid-console）。
> 主控端（ADR-039/040，D-025 定案）：移植官方 DSH web 前端（MIT）+ Capacitor（Android/iOS）+ Electron（PC）+ Web；自研原生 UI 路线（旧 ADR-037）已废止，源码已删除。

---

## 1. 阻塞项状态（已解决）

| # | 项 | 结论 |
|---|---|---|
| B1 | 定名 | **WhaleMaid（鲸娘）**，代码名 `whalemaid`；仓库 github.com/Es1lama/whalemaid（已建已推） |
| B2 | 技术栈 | **中继/控制面 Rust**；被控插件 Node/TS（三平台）；主控端 = 官方前端移植（React/TS）+ Capacitor/Electron/Web 三壳；SQLite；TLS+WebCrypto |
| B3 | Level 定义 | Level -1（仅邮箱：极高限速，一周停服）/ Level 0（绑手机：高限速限并发）/ Level 1（订阅：放宽+恶意/亏损阈值，绑手机送试用） / Level 2（增值） |
| B4 | 仓库归属 | gh 账号 **Es1lama**（双仓已建已推） |

## 2. 纪律声明（一劳永逸）

1. **引用顺序四步法**：A 档源码优先（frp/rathole 的 Apache-2.0 代码直接读）→ B 档公开文档（只覆盖用户可见行为，**不能上位替代实现细节**）→ RFC/标准 → C 档 AGPL 仅洁净室最后手段，留证 `docs/research/cleanroom-notes.md`。
2. **复用决策程序**（造轮子/复用边界/传承盈利三理论合一，见 DESIGN §2）：每个复用 vs 自写决策过流程并记 ADR；语言不一致优先 sidecar/进程边界复用。
3. **开源协议 AGPL-3.0（已确认）** + 双许可保留；社区贡献进闭源 SaaS 前必须 CLA（Phase B 生效前设立）。
4. **连接模式（ADR-042）**：默认 UX = 设备编号+密码、经中继连通、无 IP；IP 直连保留为自托管高级选项。
5. **不过度耦合**：代码/注释/README 禁止出现 billing/subscription/account 字样或死代码桩；预留只体现在协议接缝。
6. **文档治理六原则**：简洁 / 有效（每条只服务一个目标）/ 时效（旧语义不入工作区，只存 git 历史，唯一现行版制）/ 指导（能直接指导开发）/ 一一对应（文档↔代码唯一映射）/ 溯源（编号贯穿，报错可反查）。
7. **生产路径唯一验收（D-031）**：实现、默认配置、演示、测试和完成状态必须在普通跨设备网络、无开发者工具、无调试桥、无手工端口映射、无隐藏状态下成立；测试夹具只允许定位分段问题，不得进入用户步骤或替代上线证据。发现一项依赖夹具时，同类“已完成”声明全部撤回并重新复核，禁止静默降级。
8. **实例身份唯一归属（D-032）**：受控身份、密码、中继凭据和隧道路由必须绑定实际加载 WhaleMaid 的 DSH profile/实例；验收必须证明主控端看到的是该实例自己的会话、凭据、设置、工作区、模型、权限与审批状态。另一 profile、测试 profile 或独立空 DSH 只能做分段诊断，不能替代目标实例。

## 3. M0 任务与进度

| # | 任务 | 产出 | 状态 |
|---|---|---|---|
| 1 | 决策回溯 | `docs/adr/INDEX.md`（ADR-001..036） | ✅ |
| 2 | 需求编号表 | `docs/requirements.md`（REQ + REQ-REJ，均带验收标准） | ✅ |
| 3 | 三平台 spike + 实机冒烟 | spike 结论 + **真实 DSH 测试实例冒烟 7/7 通过** | ✅ |
| 4 | 协议 v1 | `docs/protocol.md`（PROTO-001..009） | ✅ |
| 5 | 威胁模型 v1 | `docs/threat-model.md`（TM-001..013） | ✅ |
| 6 | 仓库骨架 | monorepo + AGPL-3.0 + SECURITY + 模板 + CI（已绿） | ✅ |

### 实机测试结论（2026-08-15，独立实例 3181，3080 会话本体全程无恙）

- 插件在真实 DSH host 挂载成功（`apply(ctx, config)` 惯例、`sessions` 复数签名、RpcRequest/RpcResponse 纪律透传）；
- 接口级冒烟（网关时代记录，已随自定 RPC 废止；现行验证见 scripts/rathole-noise-e2e.mjs 与 apps/controller/web 实测闭环）：
- 关键修复沉淀：信封解包、WebCrypto P1363 验签、nonce 绑定公钥、目录选择器 pin browse（禁用 auto 行 + 插入 browse 行）。

### M1 剩余（测试 loop 继续）

- ◐ REQ-003 临时密码：中继核心已实现设备凭据签发/刷新/撤销、服务端 TTL、generation 原子单次消费、临时 session 与稳定错误码；受控插件已通过官方 sidebar slot 提供设备编号、生成/刷新/复制/倒计时/撤销 UI，且终态清除明文。Web/Electron/Android 控制器已接 credential mode、进程内临时 session、稳定错误文案且临时设备不落持久设备记录；Android 已由 CI `testDebugUnitTest assembleDebug` 验证。iOS 代码已接线并等待 macOS CI，不得提前标 ✅；
- ✅ REQ-008 permission.get/set 透传（projections 基线 + /permission 命令）；
- ⬜ 主控端 App（ADR-039 移植前端）：官方前端独立构建 spike → Capacitor/Electron/Web 三壳 → 设备管理模块（ToDesk 式首屏）；旧自研移动 UI 已废止删除，不恢复；
- ✅ 受控端插件（audit#3 收尾）：不自建任何 listener——隧道直指宿主原生 web 端口（官方 /api+WS+UI 唯一载体）；设备自动注册+心跳+断线重连实测；自定 RPC/网关/PWA 已全部废止删除；
- ✅ 事件下联：官方 WS `/api/events.mux|host` 经主控端隧道桥实测可建立（SSE 事件流已随自定 RPC 废止）；
- ⬜ workspace.create 冒烟已验证（8/8）；语音/视觉/热词 = V1 范围（REQ-020..022）；
- ⬜ 精确 HistoryEntry 渲染与模型 provider 分组目录（骨架级提取，待对齐类型）。

### Spike 清单（先验证再架构，防返工）

| # | 验证点 | 目的 |
|---|---|---|
| S0 | **承载选择**：手机浏览器直连宿主 web 实测 | ✅ 结论：rc.6 CLI 拒绝 `--host 0.0.0.0` 与自建 listener 路线均废止——受控端走中继隧道直达宿主原生 web（127.0.0.1 默认姿态），实测闭环 | 
| S1 | DSH 插件注册 web 路由 + 调宿主 API（browse seam、`workspace.create`、`dsh-credentials`） | ✅ 静态：全部接口确认（见 research/spike-S0-S1.md）；实机待 M1 |
| S2 | rathole（Rust）服务端/客户端实测：noise 握手、授权语义、sidecar 管理可行性 | ✅ sidecar 定案（热重载增删设备条目、吊销=移除条目）；ADR-032 |
| S3 | ~~PWA WebCrypto 密钥对~~ **已废止** | 挑战应答绑定随自定 RPC 删除；授权全在中继侧（/connect + grant），无客户端密钥对需求 |
| S4 | DashScope 定制热词 API：鉴权 + 批量增删 | ✅ 文档级确认（vocabulary HTTP API + vocabulary_id）；真实 key 实测留 Phase B；ADR-034 |
| S5 | DeepSeek-OCR / 通义 VL 调用 | ✅ 确认（deepseek-ocr guides 存在；qwen-vl-max/plus）；ADR-035 |

## 4. 文档 ↔ 代码唯一映射机制

ADR-001..（决策）/ REQ-001..（需求+验收+代码路径）/ PROTO-001..（协议，代码头写 `SPEC: docs/protocol.md#PROTO-xxx`）/ TM-001..（威胁对策→检查点）/ architecture.md（模块→路径映射总表）。
变更规则：先改文档（含 ADR）→ 再改代码；PR 模板强制填写关联编号。

## 5. 用户待办

1. ~~创建仓库~~ ✅ 已由 gh 建仓并推送（Es1lama/whalemaid 公开 + whalemaid-console 私有）。
2. 确认试用月数（暂定 2 个月）。
3. 吉祥物草图（M2 前有即可，不阻塞）。
