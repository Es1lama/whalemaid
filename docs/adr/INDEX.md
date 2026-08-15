# WhaleMaid · 决策索引（ADR Index）

> M0 任务 1 的产出。每条决策 = 一行索引；**任何修订发生时，该条目升级为独立文件 `ADR-00NN.md`（状态/背景/选项/结论/影响/被引用方），索引同步更新**。
> 来源 = DESIGN（docs/PRODUCT_DESIGN.md 的 § 号）或 PREFLIGHT。状态 = 已确认。

| ID | 决策 | 结论一句话 | 来源 |
|---|---|---|---|
| ADR-001 | 项目命名 | WhaleMaid（鲸娘），代码名 whalemaid，不带 dsh 前缀 | DESIGN §0 |
| ADR-002 | 产品定位 | 覆盖 + 增强；北极星 = 用户开着电脑也愿意用手机 | DESIGN §0 |
| ADR-003 | 产品形态 | 双形态：开源核心 + 官方中继 SaaS（Happier 同构） | DESIGN §0 |
| ADR-004 | 身份模型 | 双轨：无账号（长期+临时密码）+ 手机号账号（强绑定，多设备联通） | DESIGN §4 |
| ADR-005 | 技术栈 | 中继/控制面 Rust；插件/移动端 TypeScript（React PWA） | DESIGN §3 |
| ADR-006 | 中继基底 | rathole（Rust，Apache-2.0）**sidecar 管理不重写** + 自研控制面；frp 备选 | DESIGN §2 |
| ADR-007 | 移动端 UI | 全自研；与 dsh-web-ui 零合作零复制（避免纠纷） | REQ-REJ-006 |
| ADR-008 | 工作区/文件浏览 | 接官方 browse seam，MVP 做但**不宣传**；默认限工作区根 | REQ-009 |
| ADR-009 | 语音 | BYOK（厂商可插拔）与 Level 2 双轨；使用前知情同意 | DESIGN §6 |
| ADR-010 | 热词维护 | 独立开源附加插件、不默认安装；宿主本地抽取、只传热词表；V1 发布 | REQ-021 |
| ADR-011 | 视觉适配 | 国内优先：DeepSeek-OCR + 通义 VL；目标=处理一定视觉问题，非原生 MLLM | REQ-022 |
| ADR-012 | 安全模型 | 复制远程桌面无人值守模型（一次验证后续安全）；不做手机沙盒 | DESIGN §6 |
| ADR-013 | key 落点 | 第三方 API key 只存宿主本地（dsh-credentials）；手机只持可吊销设备凭据 | REQ-015 |
| ADR-014 | 开源协议 | **AGPL-3.0 全家（已确认）** + 双许可保留 + CLA | DESIGN §1 |
| ADR-015 | 通知 | Web Push + Telegram 桥（V1） | REQ-023 |
| ADR-016 | 获客主战地 | DSH 插件市场（商店 + awesome 双列表 + dsh-plugin topic + 开发者群/linux.do/V2EX） | DESIGN §11 |
| ADR-017 | 商业区域 | 大陆先行；邮箱可注册，但不绑手机 = Level -1 | DESIGN §4 |
| ADR-018 | 服务分层 | Level -1/0/1/2；绑手机送试用（暂定 2 个月）；Level 1 设恶意/亏损阈值 | DESIGN §4 |
| ADR-019 | 直连模式 | 开源原生支持 IP 直连（REQ 级）；官方中继只是增值选项 | DESIGN §5 |
| ADR-020 | 引用顺序 | 四步法：A 档源码优先 → B 档公开文档（不能上位替代实现细节）→ RFC/标准 → C 档 AGPL 仅洁净室最后手段并留证 | DESIGN §2 |
| ADR-021 | 协议预留 | 版本化信封 + capability + 认证接口抽象 + 三通道先行；代码无 billing 字样、无死桩 | DESIGN §7 |
| ADR-022 | 文档映射 | ADR/REQ/PROTO/TM 编号体系，文档↔代码唯一映射，先文档后代码 | PREFLIGHT |
| ADR-023 | 仓库归属 | 双仓：公开 github.com/Es1lama/whalemaid（AGPL-3.0）+ 私有 Es1lama/whalemaid-console（闭源控制台）；gh 已建仓推送 | DESIGN §0 |
| ADR-024 | 会话托管 | 手机操作的是电脑上 DSH 的**原生会话**（区别于 Happy 自有会话） | REQ-005 |
| ADR-025 | 三通道 | 会话 E2E 零知识；语音/视觉为知情同意通道（BYOK 或 Level 2） | DESIGN §6 |
| ADR-026 | 工程哲学 | 复用决策程序（造轮子/复用边界/传承盈利三理论合一），每个复用 vs 自写决策过流程并记 ADR | DESIGN §2 |
| ADR-027 | 贡献者规则 | 社区代码进入闭源 SaaS 前必须签 CLA；Phase B 生效前设立 | DESIGN §1 |
| ADR-028 | 文档治理 | 六原则：简洁、有效、时效（旧版只存 git 历史）、指导、与代码一一对应、可溯源 | PREFLIGHT §2 |
| ADR-029 | 多端策略 | Web 先行；Android/iOS/鸿蒙后置；**统一 API 契约**（客户端只依赖公开 API）保证多端影响小；宿主插件三平台（macOS/Ubuntu/Windows） | DESIGN §3 |
| ADR-030 | 闭源定位 | 闭源 = **完整控制管理系统**（账号/计费/控制台/风控/工单/运营后台/Level 2），盈利性代码全部收敛于此 | DESIGN §8 |
| ADR-031 | S0/S1 结论 | 插件形态/宿主 API/browse seam/凭据/web 路由全部静态确认可行；**直连改走插件自建 listener（选项 B）**——rc.6 CLI 拒绝 `--host 0.0.0.0`，自建 server + `toFetchHandler(ctx.apiProxy)` 不依赖官方绑定 | research/spike-S0-S1 |
| ADR-036 | 双仓分离 | 开源（AGPL）与闭源控制台分仓；`packages/contract` 为边界（统一 API 契约，双仓共用）；社区代码进闭源仓须 CLA（ADR-027） | DESIGN §0 |
| ADR-037 | 原生端策略 | 手机端原生优先（Web 仅兜底）；本机无 Xcode → Android(Kotlin) 本地全验证先行，iOS(SwiftUI) 源码并行 + CI macOS runner 构建验证；两端同对 docs/protocol.md 实现 | DESIGN §3 |
| ADR-038 | ~~控制端对称~~ **已废止** | 原"agent 工具控制另一主机"模型错误；由 ADR-040 取代（主控端是控制 App，非 agent 工具） | 废止于 ADR-040 |
| ADR-039 | 前端策略 v2 | **移植 > 复刻**：官方 DSH web 前端（MIT）移植 + 移动/桌面适配 + 原生壳打包（Capacitor/Electron/Tauri），同源调用原生 /api 经网关打到受控端 | DESIGN §3 |
| ADR-040 | 三端实体模型 | 受控端=能跑 DSH 的端+插件；服务端=流量转接（中继+账号分层）；主控端=控制 App（无需 DSH：PC/安卓/iOS/鸿蒙，同一移植前端打包）；控制是人对机，非 agent 对 agent | DESIGN §0 |
| ADR-041 | 自定协议废止 | /api/v1 废止：主控端直用 DSH 原生 /api（经认证网关）；仅保留设备配对/管理最小端点并入网关；packages/control 废止 | DESIGN §5 |
| ADR-032 | S2 结论 | rathole sidecar 定案：控制面写配置+托管子进程+热重载增删；每设备一 service+token；吊销=移除条目热重载；noise 加密+心跳 | research/spike-S2-S5 |
| ADR-033 | S3 结论 | 设备密钥 = PWA WebCrypto ECDSA P-256 不可导出，IndexedDB 持久化；挑战-应答握手；重装即重新配对 | research/spike-S2-S5 |
| ADR-034 | S4 结论 | 热词库走官方定制热词 HTTP API（vocabulary 增删改查 + 实时会话带 vocabulary_id）；BYOK 同机制 | research/spike-S2-S5 |
| ADR-035 | S5 结论 | 视觉 BYOK 注册表：deepseek-ocr（官方 guides 存在）+ qwen-vl-max/plus；海外可选 | research/spike-S2-S5 |

## 升级规则

- 决策被修改/推翻 → 原条目保留"已废止"标记，新建独立 `ADR-00NN.md` 记录修订全过程；
- 实现遇到"原决策未覆盖的细节" → 新增 ADR；
- 每季度或发版前，把与本次发布相关的索引条目评审一遍。
