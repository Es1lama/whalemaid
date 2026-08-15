# Codex 增量对齐审查

审查基准：`docs/OWNER-DIRECTIVES.md` §原文留存 D-020..030。证据行号以本次工作区当前内容为准。

## 逐条结论

- D-020【未对齐】移植方案已明确“一个前端、多个壳”及主控端无需 DSH，但仍停留在待审/不写代码，UX 基线也承认官方前端移植未开始；现行产品设计还残留 Android Kotlin、iOS SwiftUI、全自研移动端等相反路线，未做到代码复用与远控逻辑落地。证据：docs/native-app-plan.md:1；docs/native-app-plan.md:3；docs/native-app-plan.md:8；docs/remote-ux-spec.md:40；docs/PRODUCT_DESIGN.md:39；docs/PRODUCT_DESIGN.md:59
- D-021【未对齐】后续方案虽承认 Kotlin/SwiftUI 自研 UI 应由移植前端取代，但 ADR 索引与“唯一现行版”产品设计仍把 Kotlin/SwiftUI 原生路线列为有效决策，D-021 已被 D-022 修正后的废止状态没有一致传播。证据：docs/native-app-plan.md:51；docs/adr/INDEX.md:40；docs/PRODUCT_DESIGN.md:3；docs/PRODUCT_DESIGN.md:39
- D-022【未对齐】方案文字正确描述“移植官方前端、同源 `/api` 经网关打到受控端”，但插件仍只接收自定 `/api/v1` RPC，协议也继续把 `/api/v1/<method>` 定为现行承载；因此“前端调用点不改、接口改打受控 DSH”尚未实现且文档互相冲突。证据：docs/native-app-plan.md:8；docs/native-app-plan.md:43；docs/native-app-plan.md:45；packages/plugin/src/routes.ts:164；packages/plugin/src/routes.ts:171；docs/protocol.md:12
- D-023【未对齐】原生 App 壳、文件夹 UI、照片上传和语音录音均只列在待确认/里程碑中；UX 状态明确为前端移植未开始、文件夹 UI 待移植、照片与麦克风原生桥未实现，语音适配器还会因真实文件 URL 流程未完成直接报错。证据：docs/native-app-plan.md:15；docs/native-app-plan.md:35；docs/native-app-plan.md:36；docs/native-app-plan.md:37；docs/remote-ux-spec.md:40；docs/remote-ux-spec.md:42；docs/remote-ux-spec.md:43；packages/plugin/src/providers/voice.ts:40；packages/plugin/src/providers/voice.ts:42
- D-024【未对齐】三端模型在 ADR/方案中表述正确，受控插件也已具备向中继注册、心跳并启动 rathole 隧道的代码；但主控 App 尚未开始、与中继未接通，故“受控端+主控端+服务端”整体尚未闭环。证据：docs/adr/INDEX.md:43；docs/native-app-plan.md:3；packages/relay/src/api.rs:35；packages/relay/src/api.rs:37；packages/plugin/src/index.ts:105；packages/plugin/src/index.ts:126；docs/remote-ux-spec.md:14；docs/remote-ux-spec.md:40
- D-025【未对齐】所有者记录已定为 Capacitor 且 PC 同时提供 Electron 与 Web，但移植方案仍标“待确认”，PC 仍在 Electron/Tauri 二选一，既未固定 Electron+Web 双供，也未见对应主控端产物。证据：docs/OWNER-DIRECTIVES.md:45；docs/native-app-plan.md:15；docs/native-app-plan.md:19；docs/native-app-plan.md:20；docs/native-app-plan.md:63
- D-026【未对齐】后端已新增受控端注册/心跳和“设备编号+密码”连接端点，插件也会自动接入中继；但设备列表仅管理员令牌可读，没有“主控端握手/同账号设备列表”接口与 App 流程，UX 文档仍明确当前要填 IP、密码匹配和秒连未通，尚未达到 UU/ToDesk 式闭环。证据：packages/relay/src/api.rs:35；packages/relay/src/api.rs:37；packages/relay/src/api.rs:89；packages/relay/src/api.rs:144；packages/relay/src/api.rs:145；packages/plugin/src/relay.ts:87；docs/remote-ux-spec.md:13；docs/remote-ux-spec.md:21；docs/remote-ux-spec.md:23；docs/remote-ux-spec.md:31
- D-027【对齐】当前产出已把“先学习再构建”写成强制流程：先对照 rathole/frp/headscale/Tailscale/RustDesk，再列现状、修复和先红后绿验收；产品设计也要求先找轮子并优先 sidecar 复用，代码实际调用 rathole 而非重写隧道。证据：docs/security-audit.md:3；docs/security-audit.md:4；docs/security-audit.md:46；docs/security-audit.md:48；docs/security-audit-plan.md:3；docs/PRODUCT_DESIGN.md:23；docs/PRODUCT_DESIGN.md:26；packages/relay/src/rathole.rs:1；packages/relay/src/rathole.rs:7
- D-028【对齐】已把“代表性问题触发同类全查”固化为 UX 与安全两套全量清单，而非只修 IP 单点：UX 扩展到发现、授权、连接、控制台、账号、提示共 22 条，安全扩展到注册、密码、信道、认证、重放、吊销、供应链等 11 环。证据：docs/remote-ux-spec.md:4；docs/remote-ux-spec.md:7；docs/remote-ux-spec.md:17；docs/remote-ux-spec.md:27；docs/remote-ux-spec.md:36；docs/remote-ux-spec.md:45；docs/remote-ux-spec.md:52；docs/security-audit-plan.md:8；docs/security-audit-plan.md:20；docs/security-audit-plan.md:28；docs/security-audit-plan.md:30
- D-029【未对齐】虽已写成熟实现对照并给控制面加 TLS，但实际信道仍有“肉鸡风险”级缺口：rathole 生成配置只含 bind/service/token，未显式启用审计所依赖的 Noise；插件默认指纹为空，同时关闭 CA 校验，且仅在指纹非空时比较，等价于默认接受任意自签证书。安全计划把 SEC-001..005 标为 P0，而非已验收完成。证据：docs/security-audit-plan.md:10；docs/security-audit-plan.md:12；packages/relay/src/rathole.rs:9；packages/relay/src/rathole.rs:15；packages/plugin/src/index.ts:34；packages/plugin/src/relay.ts:50；packages/plugin/src/relay.ts:55；packages/plugin/src/relay.ts:72
- D-030【未对齐】指令全集与原文留存已建立，但错误污染源没有及时清除：移植方案明写 `packages/control`“代码保留待移除”，现行产品设计仍保留已被推翻的 Kotlin/SwiftUI、全自研移动端路线，协议仍把已由 ADR-041 废止的 `/api/v1` 当现行规格，无法作为无污染的长期工程基线。证据：docs/OWNER-DIRECTIVES.md:52；docs/OWNER-DIRECTIVES.md:74；docs/native-app-plan.md:49；docs/native-app-plan.md:50；docs/PRODUCT_DESIGN.md:39；docs/PRODUCT_DESIGN.md:59；docs/adr/INDEX.md:44；docs/protocol.md:12

## 修复建议清单

1. **先消除信道高危默认值**：`relayFingerprint` 为空时必须拒绝启动/接入，不能在 `rejectUnauthorized:false` 下跳过校验；为 rathole 服务端与受控端配置显式 Noise（含固定服务端公钥），并用真实双端集成测试证明公网端口只承载密文。
2. **统一唯一现行架构**：重写 `docs/PRODUCT_DESIGN.md` §3/§8/§11，删除 Kotlin/SwiftUI、全自研移动端和旧 `/api/v1` 路线；在 `docs/adr/INDEX.md` 明确 ADR-037 被 ADR-039/040 取代；将 D-025 固化为 Capacitor + Electron + Web，不再保留 Tauri 二选一。
3. **迁移网关而非再造 RPC**：插件提供官方 DSH 同源 `/api` 与 SSE 透传，只把设备配对/管理保留为最小网关端点；同步更新 `docs/protocol.md` 与 `packages/contract`。当前协议写 `POST /api/v1/<method>`，实现却只接收 `/api/v1`，即使旧路线内部也不一致。证据：docs/protocol.md:12；packages/plugin/src/routes.ts:171；packages/plugin/src/routes.ts:173
4. **补齐无 IP 连接闭环**：增加面向主控端、按账号/授权范围返回的设备列表与在线状态；主控 App 实际调用 `/connect`，完成“设备编号+密码→获得路径→连接网关→进入 DSH 原生界面”，并覆盖离线、错密、锁定、吊销、重连。
5. **落地主控端同源前端**：先完成官方 DSH web 前端独立构建 spike，再交付 Capacitor Android/iOS、Electron PC 与 Web；随后实现相机/相册、麦克风、文件选择/目录浏览原生桥，删除现有自研 Kotlin/SwiftUI UI。
6. **修正隧道凭据生命周期**：当前 `/connect` 轮换 rathole token 后，受控端正在运行的 sidecar 不会同步拿到新 token；应按成熟 rathole 模型重新设计主控访问授权，避免把 sidecar 服务 token 当主控客户端凭据，并为连接、断开、重连、吊销写攻击路径集成测试。证据：packages/relay/src/api.rs:118；packages/relay/src/api.rs:126；packages/plugin/src/relay.ts:133；packages/plugin/src/relay.ts:142
7. **清理未完成能力的虚假可用性**：DashScope 热词上传与录音识别仍会直接抛“待真实 key 实测”，发布前要么实现并通过真实 key 验收，要么移出 capability/现行里程碑；同步统一协议和 contract 的 provider 名称。证据：packages/hotwords/src/upload.ts:29；packages/hotwords/src/upload.ts:33；packages/plugin/src/providers/voice.ts:40；docs/protocol.md:46；packages/contract/src/channels.ts:7
8. **按 D-030 做一次污染清仓**：先 git 备份，再删除废止代码、旧构建产物和相反语义文档；清仓后用全文检索阻断 `Kotlin`、`SwiftUI`、`全自研移动端`、现行 `/api/v1`、`packages/control` 等废止语义重新进入主分支。
