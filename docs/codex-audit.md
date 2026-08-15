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

## 增量审计（第二轮，2026-08-15 下午）

审计基准：`docs/OWNER-DIRECTIVES.md` §原文留存 D-020..D-030；证据行号以本轮工作区当前内容为准。未启动服务，未读取 `~/.dsh/sessions` 原文。

### D-020..D-030 逐条判定

- D-020【未对齐】原文要求移动端与原生网页端尽量一致、代码复用，主控端执行远控逻辑且手机不运行 dsh。当前只有官方前端构建 spike；主控 App 壳、设备列表和远控界面不存在，`apps/controller` 仅有 `DESIGN.md`。证据：`docs/research/spike-official-frontend.md:5-9`、`docs/research/spike-official-frontend.md:25-30`、`docs/native-app-plan.md:4`、`docs/native-app-plan.md:63`。剩余差距：交付 Capacitor/Electron/Web 主控端并完成真实移动/桌面控制流程。
- D-021【部分对齐】错误已被承认，Kotlin/SwiftUI 源码已不在工作树，架构文档已改为官方前端移植；但 UX 文档仍把“安卓自研版有雏形”列为现状，说明旧路线语义尚未完全清除。证据：`docs/OWNER-DIRECTIVES.md:41`、`docs/native-app-plan.md:51`、`docs/remote-ux-spec.md:40-43`、`docs/PRODUCT_DESIGN.md:39`。剩余差距：删除/改写所有仍以旧自研 UI 为现状依据的文档状态。
- D-022【部分对齐】官方 DSH 前端可独立构建，插件隧道已把 `local_addr` 指向宿主 `webServer`，官方 `/api` 与 UI 可经隧道访问；但主控端移植尚未落地，且宿主无 web 时仍保留 `/api/v1` 自建 RPC 兜底。证据：`docs/research/spike-official-frontend.md:7-18`、`docs/research/spike-official-frontend.md:20-23`、`packages/plugin/src/index.ts:49-52`、`packages/plugin/src/relay.ts:148-160`、`packages/plugin/src/routes.ts:132-134`。剩余差距：交付主控壳、删除过渡 RPC，并以官方 `/api`/WS 作为唯一实际承载。
- D-023【未对齐】原文要求可直接打包 app，且包含服务器转接、电脑文件夹访问、照片上传、语音录音原生接口。当前 spike 只列为下一步；相机/相册/麦克风/文件原生桥未实现，DashScope 录音适配仍直接抛错。证据：`docs/research/spike-official-frontend.md:25-30`、`docs/remote-ux-spec.md:40-43`、`packages/plugin/src/providers/voice.ts:36-43`。剩余差距：完成 app 打包、目录 UI、原生媒体桥及真实 provider 验收。
- D-024【未对齐】三端定义和受控端插件中继代码已存在，但主控端控制 app 不存在，因此“受控端+主控端+服务端”整体仍未交付。证据：`docs/OWNER-DIRECTIVES.md:44`、`docs/native-app-plan.md:49-51`、`packages/plugin/src/index.ts:108-135`、`packages/relay/src/api.rs:38-47`、`apps/controller/DESIGN.md`（当前目录唯一文件）。剩余差距：交付不依赖 dsh 的 PC/Android/iOS/HarmonyOS 主控端，以及其与中继的实际集成。
- D-025【部分对齐】选型文档已固定 Capacitor + Electron + Web，且明确 PC 双供；但仓库没有对应主控产物或构建入口，只有设计文档。证据：`docs/OWNER-DIRECTIVES.md:45`、`docs/native-app-plan.md:4`、`docs/native-app-plan.md:63`、`apps/controller/DESIGN.md`。剩余差距：落地三个壳的最小可运行工程并纳入构建/验收。
- D-026【部分对齐】服务端已实现注册、心跳、公开在线状态、编号+密码匹配、限速锁定、一次性 grant、TLS 隧道入口；E2E 证明本机链路可通且无 IP 输入。主控端设备列表/握手仍不存在，UX 状态还写着“现在要手填 IP”，部署入口也没有公开映射 9443。证据：`packages/relay/src/api.rs:38-47`、`packages/relay/src/api.rs:96-128`、`packages/relay/src/api.rs:174-189`、`packages/plugin/src/relay.ts:106-131`、`scripts/rathole-noise-e2e.mjs:65-85`、`docs/remote-ux-spec.md:11-14`、`packages/relay/docker-compose.yml:7-13`。剩余差距：主控端设备列表/在线状态 UI 和可从公网实际到达的 TLS 隧道部署闭环。
- D-027【部分对齐】已补充成熟实现对照、先学习后构建流程，并用 rathole sidecar、Noise、TLS 和 grant 实测；但“连接逻辑已实现”只覆盖服务端/脚本，主控 app 仍缺失，且官方前端移植未形成产品。证据：`docs/security-audit.md:3-4`、`docs/security-audit.md:8-11`、`packages/relay/src/rathole.rs:35-48`、`scripts/rathole-noise-e2e.mjs:77-96`、`docs/research/spike-official-frontend.md:25-30`。剩余差距：把学习结果转成可用主控产品并覆盖离线、错密、锁定、吊销、重连用户路径。
- D-028【部分对齐】已有 UX 22 项与安全审计清单，且本轮确实补查了信道、授权、状态和污染；但修复后 UX 状态未同步，仍有代表性旧事实，且旧 `/api/v1` 兜底和构建残留未被清掉。证据：`docs/remote-ux-spec.md:3-5`、`docs/remote-ux-spec.md:9-57`、`docs/security-audit.md:3-4`、`packages/plugin/src/routes.ts:132-134`、`pnpm-lock.yaml:24`。剩余差距：每次修复后同步规范状态，并对同类代码、锁文件、生成物做完整扫描。
- D-029【部分对齐】控制面 TLS+指纹、scrypt PHC、限速/锁定分离、静态 Noise 密钥、受控端 pin、一次性 grant 和回环服务端口均有实现；但部署 compose 未发布 9443，E2E 客户端又关闭 TLS CA 校验且仅在本机测试，不能证明公网主控端实际能安全接入。证据：`packages/plugin/src/relay.ts:52-81`、`packages/relay/src/rathole.rs:35-48`、`packages/relay/src/main.rs:40-52`、`packages/relay/src/tunnel.rs:30-74`、`packages/relay/docker-compose.yml:7-13`、`scripts/rathole-noise-e2e.mjs:10-34`。剩余差距：修正 9443 监听/端口发布，增加真实部署级 TLS 指纹验证和错误证书测试。
- D-030【部分对齐】指令记录、文档重写、ADR 废止标记、污染守卫和历史私钥清理已存在；但守卫对 `routes.ts` 的 `/api/v1` 整文件豁免，`pnpm-lock.yaml` 仍含 `packages/control`，`packages/plugin/lib` 等生成物被排除扫描，UX 文档仍残留旧状态。证据：`docs/OWNER-DIRECTIVES.md:50`、`.github/scripts/check-banned-terms.sh:4-5`、`.github/scripts/check-banned-terms.sh:27-32`、`packages/plugin/src/routes.ts:132-134`、`pnpm-lock.yaml:24`、`docs/remote-ux-spec.md:13`。剩余差距：删除过渡实现和锁文件残留，收紧守卫范围，清理/重建生成物并同步所有现行状态。

### 上一轮八条修复建议状态

1. **已修复（实现层）**：控制面 TLS、指纹固定、空指纹拒绝、显式 Noise、静态公钥 pin、双端正确/错误公钥测试均已存在。证据：`packages/plugin/src/index.ts:109-113`、`packages/plugin/src/relay.ts:52-81`、`packages/plugin/src/relay.ts:143-160`、`packages/relay/src/rathole.rs:35-48`、`scripts/rathole-noise-e2e.mjs:87-96`。部署级公网验证仍缺。
2. **部分修复**：产品设计/ADR/native-app-plan 已统一为官方前端 + Capacitor/Electron/Web，旧源码已删除；但主控端没有交付，`pnpm-lock.yaml:24` 仍含 `packages/control`，UX 文档仍有旧语义。证据：`docs/PRODUCT_DESIGN.md:39`、`docs/native-app-plan.md:49-63`、`docs/adr/INDEX.md:40-44`、`pnpm-lock.yaml:24`、`docs/remote-ux-spec.md:40-43`。
3. **部分修复**：官方宿主 `/api`/WS/UI 已由 `webServer` 承载并通过 rathole 实测；但宿主无 web 时仍走 `packages/plugin/src/routes.ts:132-134` 的 `/api/v1` 过渡网关，且官方前端调用端尚未交付。
4. **部分修复**：`/_whalemaid/connect`、设备状态公开查询、限速/锁定和一次性 grant 已有代码与脚本证据；没有主控端设备列表/账号范围流程，且 compose 未暴露 9443。证据：`packages/relay/src/api.rs:96-128`、`packages/relay/src/api.rs:174-189`、`packages/relay/docker-compose.yml:7-13`。
5. **部分修复**：官方前端独立构建 spike 已成功并冻结官方 commit；Capacitor/Electron/Web、原生媒体桥和真实 app 尚未交付。证据：`docs/research/spike-official-frontend.md:5-9`、`docs/research/spike-official-frontend.md:25-30`、`apps/controller/DESIGN.md`。
6. **已修复**：`/connect` 不再轮换受控端 rathole token，改发绑定设备、TTL 2 分钟、单次消费 grant；Rust 单测和 E2E 覆盖重用、伪造、过期、跨设备。证据：`packages/relay/src/api.rs:96-128`、`packages/relay/src/grants.rs:22-45`、`packages/relay/src/grants.rs:55-83`、`scripts/rathole-noise-e2e.mjs:77-85`。
7. **未动**：DashScope 热词上传和录音识别仍是 TODO/直接抛错；未见从现行 capability 或里程碑移除。证据：`packages/hotwords/src/upload.ts:25-34`、`packages/plugin/src/providers/voice.ts:36-43`、`docs/protocol.md:20-24`。
8. **部分修复**：守卫与历史清理已加入，但守卫明确豁免 `/api/v1` 过渡文件、排除 `lib/`/`dist/`/`target/`，且锁文件残留 `packages/control`；因此不是完整 D-030 清仓。证据：`.github/scripts/check-banned-terms.sh:4-5`、`.github/scripts/check-banned-terms.sh:27-32`、`packages/plugin/src/routes.ts:132-134`、`pnpm-lock.yaml:24`。

### 新问题（按安全优先）

1. **高：部署声明与实际 TLS 隧道不可达。** `docs/deploy-server.md:16` 声称公网只需暴露 9080/9443；但默认 `tunnel_listen` 是 `127.0.0.1:9443`，compose 只发布 2333/9080，且没有 `WHALEMAID_RELAY_TUNNEL_LISTEN` 配置。`/connect` 返回 9443 后，公网主控端无法按文档连入。证据：`packages/relay/src/config.rs:20-29`、`packages/relay/src/main.rs:18-31`、`packages/relay/src/tunnel.rs:15-17`、`packages/relay/docker-compose.yml:7-13`。建议：新增显式隧道监听环境变量，生产 compose 绑定 `0.0.0.0:9443:9443`，Dockerfile `EXPOSE 9443`，加“外部客户端→9443→grant→受控端”部署测试；不要把默认回环改成无条件公网暴露。
2. **高：E2E 证据没有验证 TLS 指纹固定。** `scripts/rathole-noise-e2e.mjs` 的控制面请求和 TLS 隧道客户端均使用 `rejectUnauthorized:false`，且只连 `127.0.0.1`；它验证了 grant/Noise 行为，但没有验证主控端发现错误证书会拒绝。证据：`scripts/rathole-noise-e2e.mjs:10-20`、`scripts/rathole-noise-e2e.mjs:24-34`。建议：脚本读取/计算服务端证书指纹，使用自定义校验或 pin 逻辑；增加错误证书、错误指纹、外部监听地址测试，报告不要把当前脚本单独表述为完整 TLS 安全验收。
3. **中高：旧 `/api/v1` 运行时仍可用，和“唯一现行 `/api`”自相矛盾。** 协议写明旧协议废止并将在主控 App 落地后删除，但 `routes.ts` 仍实现 `/api/v1`，CI 对整个文件豁免；生成的 `packages/plugin/lib/index.js` 也保留对应运行时代码。证据：`docs/protocol.md:4`、`docs/protocol.md:18`、`packages/plugin/src/routes.ts:132-134`、`packages/plugin/lib/index.js:407-409`。建议：主控端 MVP 先依赖宿主 `webServer` 后立即删除 fallback、对应 tests/smoke、contract 和生成物，再把守卫从路径豁免改为显式历史白名单。
4. **中：现行 UX 状态未随修复回写，审计基线会误导后续实现。** 后端已有 `/connect` 和公开状态，但 `UX-003` 仍写“现在要手填受控端 IP”，`UX-008` 仍为未实现，`UX-015` 仍写“官方前端未开始（待 spike）”。证据：`packages/relay/src/api.rs:96-128`、`packages/relay/src/api.rs:174-189`、`docs/remote-ux-spec.md:13`、`docs/remote-ux-spec.md:23`、`docs/remote-ux-spec.md:40`。建议：把已实测的服务端能力与未完成的主控 UI 分开标注，补充证据日期、测试边界和剩余差距，禁止继续用旧“填 IP”描述现行路径。
5. **中：官方前端 spike 不是仓库内交付物。** spike 依赖 clone 官方仓和外部构建，仓库没有 `apps/controller/web` vendor dist、LICENSE/THIRD_PARTY_NOTICES、壳工程或 WebSocket 桥。证据：`docs/research/spike-official-frontend.md:7-9`、`docs/research/spike-official-frontend.md:25-30`、`apps/controller/DESIGN.md`。建议：以冻结 commit 生成可审计 vendor 产物，锁定来源与许可证，再接入最小 Capacitor/Electron/Web 构建。
6. **中：协议文档仍把事件承载写成 SSE，与实测官方载体 WS 不一致。** `protocol.md` 的 PROTO-001 写 HTTP(S)+SSE、`/api/events`，spike 明确官方 web 载体使用 `/api/events.mux` 与 `/api/events.host` WebSocket。证据：`docs/protocol.md:9-18`、`docs/research/spike-official-frontend.md:13-18`。建议：按官方真实 wire contract 重写事件章节，明确中继透传 WS、主控 Web 版桥接方案和兼容边界；不要让主控端按过时 SSE 路径实现。
7. **中：守卫无法证明“污染清仓”。** 守卫只扫描 `packages apps docs` 的指定扩展，排除 `lib/dist/target`，且允许 docs 含废止语义；因此 `pnpm-lock.yaml` 的 `packages/control`、生成物中的 Kotlin 字符串不会触发。证据：`.github/scripts/check-banned-terms.sh:21-32`、`pnpm-lock.yaml:24`、`packages/plugin/lib/index.js:407-409`。建议：将 lockfile、构建清单、源码生成物纳入可复现扫描；对“历史文档”使用目录级白名单，不要以全文语义自动豁免。

## 增量审计（第三轮，2026-08-15 晚）

审计基准：`docs/OWNER-DIRECTIVES.md:64-74` 的 D-020..D-030 原文。结论只评价当前工作区实际代码、现行文档和可重复静态/单元验证，不把主代理口头说明当证据。

### D-020..D-030 逐条判定

- D-020【未对齐】“一个前端、多个壳”和远程控制模型已经落到 Web/Electron，但 Android/iOS 主控端尚无工程，移动端代码复用与移动实机体验仍未交付。证据：`docs/native-app-plan.md:3-8`、`docs/native-app-plan.md:19-23`、`docs/native-app-plan.md:55-59`、`docs/remote-ux-spec.md:40-43`。剩余差距：交付 Capacitor Android/iOS 壳并以同一官方前端完成移动端全链实机验收。
- D-021【对齐】已停止 Kotlin/SwiftUI 自研路线，主控运行时直接使用宿主官方 UI，Electron 仅作为同源壳；当前代码树的废止词守卫执行通过。证据：`docs/native-app-plan.md:47-51`、`apps/controller/web/server.mjs:177-202`、`apps/controller/electron/main.cjs:47-58`、`.github/scripts/check-banned-terms.sh:8-29`。剩余差距：尚无移动端用户级对照，不能证明手机体验已接近原生 DSH/ToDesk。
- D-022【对齐】前端调用点不改：主控把浏览器请求改写为宿主权威并经 WSS 隧道送到受控端；插件隧道目标直接是宿主 `webServer.port`，没有自定 RPC 网关。证据：`apps/controller/web/server.mjs:78-88`、`apps/controller/web/server.mjs:177-202`、`packages/plugin/src/index.ts:30-48`、`docs/protocol.md:11-17`。剩余差距：官方 vendor dist 当前不是运行时入口，而是由受控端宿主返回 UI；移动壳仍未验证这一模式。
- D-023【未对齐】PC Electron 壳和服务器转接已存在，官方目录能力可经原生 `/api` 到达；但相机/相册、麦克风、文件原生桥均未实现，Android/iOS App 也未交付。证据：`apps/controller/electron/main.cjs:47-58`、`docs/protocol.md:36-44`、`docs/native-app-plan.md:31-39`、`docs/remote-ux-spec.md:42-43`。剩余差距：完成 Capacitor 壳、原生媒体/文件桥和真实设备验收。
- D-024【对齐】三端实体与职责已经成立：受控端是 DSH+插件，中继负责注册/授权/转发，主控端 Web/Electron 无需 DSH 并反代官方 UI/API/WS。证据：`packages/plugin/src/index.ts:26-73`、`packages/relay/src/api.rs:41-50`、`apps/controller/web/server.mjs:146-234`、`apps/controller/electron/main.cjs:25-58`。剩余差距：Android/iOS/鸿蒙实体和原生 SDK 差异尚未落地。
- D-025【对齐】方案明确 Capacitor + Electron + Web，且 PC 的 Web 与 Electron 两种入口均已有代码；Electron 静态检查通过。证据：`docs/native-app-plan.md:15-23`、`apps/controller/web/package.json:1-15`、`apps/controller/electron/package.json:1-16`、`apps/controller/electron/main.cjs:47-58`。剩余差距：Capacitor 只有选型，没有工程产物。
- D-026【未对齐】编号+密码→状态检查→验密→grant→WSS/TLS→受控端官方 UI 的无 IP 闭环已经存在；但首屏仍要求用户填写服务端地址和设备编号，没有“登录后自动设备列表/可选进程”，移动端流程也不存在。证据：`apps/controller/web/server.mjs:104-123`、`apps/controller/web/server.mjs:149-168`、`packages/relay/src/api.rs:100-132`、`docs/remote-ux-spec.md:11-15`。剩余差距：增加账号/授权范围设备列表、在线刷新和移动端秒连流程；服务端地址应进入部署/高级设置而非日常连接表单。
- D-027【对齐】当前实现复用 rathole Noise、Rustls、官方 DSH UI/API/WS 和 Electron 壳，没有重造隧道或业务 RPC；安全文档保留成熟实现对照，Noise/grant/指纹攻击路径脚本存在。证据：`docs/security-audit.md:3-11`、`packages/relay/src/rathole.rs:35-48`、`packages/plugin/src/index.ts:30-48`、`scripts/rathole-noise-e2e.mjs:18-49`。剩余差距：后述新安全问题表明“先学习后构建”尚未覆盖反向代理与反向代理头信任边界。
- D-028【未对齐】本轮确实完成了 `/api/v1` 全链同类清除，但同一轮仍遗漏主控 WSS 证书固定、可伪造的 `x-forwarded-for` 限速键、失效的密码轮换路径，以及多份现行文档中的旧网关/SSE语义，说明“代表性问题触发同类全查”未稳定执行。证据：`apps/controller/web/server.mjs:20-43`、`apps/controller/web/server.mjs:63-74`、`packages/relay/src/api.rs:111-123`、`packages/plugin/src/store.ts:65-70`、`docs/native-app-plan.md:41-49`。剩余差距：对认证、证书、来源 IP、凭据更新和文档映射分别建立全链检查表与回归测试。
- D-029【未对齐】Noise、控制面 TLS、受控端指纹固定、scrypt、grant 和回环服务端口均已实现，但主控 WSS 明确关闭 CA 校验且未做指纹比较，`/connect`/状态/WSS 限速直接信任客户端可控的 `x-forwarded-for`，长期密码轮换也不会更新服务端哈希；不能评价为肉鸡风险已闭合。证据：`apps/controller/web/server.mjs:63-74`、`apps/controller/web/server.mjs:218-229`、`packages/relay/src/api.rs:104-123`、`packages/relay/src/api.rs:178-183`、`packages/plugin/src/store.ts:65-70`、`packages/relay/src/registry.rs:103-126`。剩余差距：先修复下文三个高优先级问题，再做主控产品路径的错误证书、爆破、轮换与吊销攻击测试。
- D-030【未对齐】`/api/v1`、`packages/contract`、旧路由/provider 源码和 `scripts/smoke.mjs` 已删除，守卫当前执行通过；但“唯一现行版”仍保留自建网关、挑战应答、SSE、主控 App 未开始等失效语义，插件包描述甚至仍写“自建 listener + 认证网关”，守卫又排除 `lib/dist/vendor-dist/target`，不能证明污染源已清仓。证据：`.github/scripts/check-banned-terms.sh:21-29`、`packages/plugin/package.json:1-7`、`docs/PREFLIGHT.md:38-50`、`docs/native-app-plan.md:41-49`、`docs/deploy-server.md:33-49`、`docs/remote-ux-spec.md:59-61`。剩余差距：删除/改写全部现行旧语义，守卫改为检查语义与可复现生成物，而非只检查少量关键词。

### 前两轮十五条建议状态

#### 第一轮八条

1. **部分修复**：受控端空指纹拒绝、HTTPS 指纹固定、显式 Noise、静态公钥 pin 和错误指纹/公钥脚本已完成；主控 WSS 仍以 `rejectUnauthorized:false` 直连且未比较指纹。证据：`packages/plugin/src/index.ts:34-40`、`packages/plugin/src/relay.ts:52-81`、`packages/plugin/src/relay.ts:143-160`、`scripts/rathole-noise-e2e.mjs:113-127`、`apps/controller/web/server.mjs:63-74`。
2. **部分修复**：唯一架构已改为官方前端 + Capacitor/Electron/Web，旧移动源码和 `/api/v1` 已删；但 `native-app-plan`、`PREFLIGHT`、`PRODUCT_DESIGN` 仍混入网关/SSE/PROTO-010 旧语义。证据：`docs/native-app-plan.md:3-8`、`docs/native-app-plan.md:41-49`、`docs/PREFLIGHT.md:38-50`、`docs/PRODUCT_DESIGN.md:39`。
3. **已修复**：自定 RPC 网关与 `packages/contract` 已删除；插件只把 rathole `local_addr` 指向宿主官方 web，协议唯一业务面为官方 `/api`+WS。证据：`packages/plugin/src/index.ts:30-48`、`packages/plugin/src/relay.ts:147-166`、`docs/protocol.md:9-17`。
4. **部分修复**：无 IP 的编号+密码连接与 Web 首屏已闭环，离线/未知/错密有提示；账号范围设备列表、自动发现、吊销/重连 UI 和移动端流程未完成。证据：`apps/controller/web/server.mjs:104-123`、`apps/controller/web/server.mjs:149-168`、`docs/remote-ux-spec.md:11-15`、`docs/remote-ux-spec.md:31-34`。
5. **部分修复**：官方前端冻结产物、Web 主控和 Electron 壳已交付；Capacitor、相机/相册、麦克风、文件原生桥未交付，vendor dist 也未作为运行时主控前端。证据：`apps/controller/web/provenance.json:1-9`、`apps/controller/web/README.md:6-19`、`apps/controller/electron/main.cjs:47-58`、`docs/native-app-plan.md:55-59`。
6. **已修复**：`/connect` 不再轮换/下发 rathole token，改签 TTL 2 分钟、单次消费、绑定设备的 grant；单测覆盖重用、伪造、过期、跨设备。证据：`packages/relay/src/api.rs:100-132`、`packages/relay/src/grants.rs:22-44`、`packages/relay/src/grants.rs:55-90`。
7. **部分修复**：语音/视觉已从当前 RPC 能力移到未实现的 client-module 里程碑，旧 voice/vision provider 已删；但 `packages/hotwords` 的 DashScope 模式仍可选且运行时直接抛“待真实 key 实测”，PREFLIGHT 仍把热词列为 V1 范围。证据：`docs/protocol.md:36-40`、`packages/hotwords/src/upload.ts:25-34`、`packages/hotwords/src/index.ts:14-23`、`docs/PREFLIGHT.md:51-63`。
8. **部分修复**：旧 `/api/v1` 代码、contract、lockfile 引用和主插件生成物已清理，守卫无代码文件豁免并执行通过；但守卫排除已跟踪的生成目录，且未发现“自建 listener/网关/SSE”等同义污染。证据：`.github/scripts/check-banned-terms.sh:2-29`、`packages/plugin/package.json:1-7`、`docs/native-app-plan.md:41-49`。

#### 第二轮七条新问题

1. **已修复**：生产 compose 已发布 9443，并设置 `WHALEMAID_RELAY_TUNNEL_LISTEN=0.0.0.0:9443`；Dockerfile 也暴露 9443，默认配置仍保留回环防误暴露。证据：`packages/relay/src/config.rs:20-29`、`packages/relay/src/main.rs:30-33`、`packages/relay/docker-compose.yml:7-15`、`packages/relay/Dockerfile:19-22`。
2. **已修复（原问题范围）**：E2E 脚本会先取得服务端指纹，控制面和裸 TLS 隧道均逐连接比较，并包含错误指纹拒绝断言。证据：`scripts/rathole-noise-e2e.mjs:18-49`、`scripts/rathole-noise-e2e.mjs:113-116`。产品主控 WSS 的新缺口另列下文。
3. **已修复**：旧 `/api/v1` 运行时代码、routes/events/standalone/verifier/providers、`packages/contract` 和 `scripts/smoke.mjs` 均已从现行树移除；主插件构建产物未检出 `/api/v1`。证据：`packages/plugin/src/index.ts:1-11`、`packages/plugin/package.json:14-17`、`.github/scripts/check-banned-terms.sh:2-8`。
4. **已修复**：UX 文档已把状态查询、编号+密码、grant、TLS/Noise、官方 UI 闭环回写为已实现/部分实现，不再声称当前必须填写受控端 IP。证据：`docs/remote-ux-spec.md:11-15`、`docs/remote-ux-spec.md:21-34`、`docs/remote-ux-spec.md:40-43`。
5. **部分修复**：官方 dist、LICENSE、THIRD_PARTY_NOTICES、provenance、Web 主控和 Electron 壳均已入库；Capacitor 仍无工程，且 vendor dist 只作合规存档、运行时 UI 实际来自受控端。证据：`apps/controller/web/provenance.json:1-9`、`apps/controller/web/THIRD_PARTY_NOTICES.md:1-10`、`apps/controller/web/README.md:14-19`、`apps/controller/electron/main.cjs:47-58`。
6. **已修复**：协议已改为官方 WebSocket `/api/events.mux`、`/api/events.host`，主控也实现对应 upgrade 隧道桥。证据：`docs/protocol.md:9-17`、`apps/controller/web/server.mjs:209-232`。
7. **部分修复**：守卫已纳入 `pnpm-lock.yaml` 并取消旧源码豁免，当前执行通过；但仍显式排除 `lib/dist/vendor-dist/target`，且关键词集合无法识别旧“网关/SSE/挑战应答”语义。证据：`.github/scripts/check-banned-terms.sh:8-29`、`packages/plugin/package.json:1-7`、`docs/PREFLIGHT.md:38-50`。

### 新问题（按安全优先）

1. **高：主控 WSS 隧道未执行证书指纹固定，控制面 TOFU 也只存在进程内存。** HTTPS 请求会把首次证书指纹放入内存 Map，但两个 WSS 建连点仅设置 `rejectUnauthorized:false`，没有复用 Map 或校验证书；进程重启后 Map 清空，首次连接会无提示接受任意证书。攻击者可在 WSS 路径截获一次性 grant 并代理/抢用连接。证据：`apps/controller/web/server.mjs:20-43`、`apps/controller/web/server.mjs:53-74`、`apps/controller/web/server.mjs:214-229`。建议：统一封装 HTTPS/WSS pin 校验；指纹由用户显式录入或首次确认后持久化，禁止静默 TOFU；增加错误 WSS 证书、重启后证书变化和 grant 抢用测试。
2. **高：公网控制面直接信任客户端提供的 `x-forwarded-for`，爆破/枚举限速可被任意绕过。** `/connect`、设备状态和 WSS 隧道都以该头作为限速键；compose 直接发布 9080，未见受信反代边界或真实 peer IP 提取，攻击者每次更换头值即可获得新预算。证据：`packages/relay/src/api.rs:104-123`、`packages/relay/src/api.rs:178-183`、`packages/relay/src/api.rs:213-219`、`packages/relay/docker-compose.yml:7-15`。建议：默认使用 socket peer IP；只有在显式配置可信代理 CIDR 时解析 `Forwarded/X-Forwarded-For`，且取可信链末端；增加伪造头仍触发 429/423 的集成测试。
3. **高：长期密码轮换路径实际失效，旧密码继续有效。** 插件轮换只生成新密码并清空设备凭据，随后用原 deviceId 重新注册；服务端对同一未吊销 deviceId 直接返回 `device-already-registered`，没有更新 password digest 的端点，因此旧哈希仍留在注册表。证据：`packages/plugin/src/store.ts:65-70`、`packages/plugin/src/relay.ts:91-119`、`packages/relay/src/registry.rs:103-126`、`packages/relay/src/registry.rs:135-142`。建议：新增凭据鉴权的密码更新/轮换端点，原子替换 PHC 并吊销现有 grants；或先自吊销再重新注册但必须处理端口/token 生命周期；增加“旧密码立即失败、新密码成功、在途 grant 失效”测试。
4. **中高：所谓“一次性安装码”是可无限复用的静态共享秘密。** 中继从环境读取固定 `ADMIN_INSTALL_CODE`，注册接口只做字符串相等判断，成功后不消费、不轮换；一旦泄露，攻击者可持续注册任意新 deviceId 并消耗端口/注册表。证据：`packages/relay/src/main.rs:34-35`、`packages/relay/src/api.rs:76-97`、`docs/deploy-server.md:8-10`。建议：改为可消费安装令牌（哈希存储、TTL、次数上限）或明确更名为长期 enrollment secret 并配合注册限速/配额；注册成功后默认失效并提供管理员生成新码流程。
5. **中：本地主控端使用全进程单一会话，且控制接口无 Origin/CSRF/Host 校验。** 任意本机浏览器标签页共享 `session.server/deviceId/password`；`/_ctrl/connect` 接收 JSON 后立即改写全局会话，未验证请求来源。恶意网页可探测 localhost 并尝试改变控制目标，Electron 与 Web 也共用固定 3210 端口。证据：`apps/controller/web/server.mjs:9-13`、`apps/controller/web/server.mjs:146-175`、`apps/controller/web/server.mjs:234`、`apps/controller/electron/main.cjs:8-9`。建议：使用随机本地端口、每进程不可猜 CSRF token和严格 Host/Origin 检查；会话按安全 cookie/浏览器实例隔离，密码不要放全局共享对象；Electron 使用独立 session partition。
6. **中：冻结的官方 vendor dist 不控制实际运行版本，交付物不可复现。** provenance 冻结 47f9438，但 README 明确 vendor 仅作合规存档，运行时 UI 由受控端宿主动态提供；主控行为会随受控端 DSH 版本变化，无法用仓内冻结产物复现或回归。证据：`apps/controller/web/provenance.json:1-9`、`apps/controller/web/README.md:14-19`、`apps/controller/web/server.mjs:174-202`。建议：明确二选一：要么主控实际托管冻结 dist 并只代理 `/api`/WS，要么删除“冻结运行时前端”表述并建立宿主版本兼容矩阵与协商/拒绝策略。
7. **中：现行文档仍包含已删除安全模型和错误进度，违反唯一现行版。** PRELIGHT 仍以挑战应答网关和 SSE 描述冒烟/剩余项，native-app-plan 仍写网关拦截 `/api`、SSE、PROTO-010，deploy-server/security-audit 仍写受控端网关挑战应答，插件包描述仍称自建 listener。证据：`docs/PREFLIGHT.md:38-50`、`docs/native-app-plan.md:41-49`、`docs/deploy-server.md:33-49`、`docs/security-audit.md:20-32`、`packages/plugin/package.json:1-7`。建议：以 protocol v3 为唯一源批量重写上述段落；CI 增加语义断言（现行文档不得出现“网关挑战应答/SSE/自建 listener/PROTO-010”），而非仅关键词黑名单。

### 本轮验证

- `pnpm --dir packages/plugin test`：5/5 通过；`pnpm --dir packages/plugin typecheck`：通过。
- `CARGO_HOME=$PWD/.toolchain/cargo cargo test --offline --manifest-path packages/relay/Cargo.toml`：18/18 通过。
- `pnpm --dir apps/controller/web test`、`pnpm --dir apps/controller/electron test`：均通过 Node 语法检查。
- `bash .github/scripts/check-banned-terms.sh`：通过；该结果只证明当前脚本覆盖范围内无命中，不覆盖本节指出的语义污染与排除目录。
- 未启动任何服务，未访问或修改 `127.0.0.1:3080`。
