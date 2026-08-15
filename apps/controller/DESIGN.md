# WhaleMaid Controller 设计

> 状态：实现前设计基线。本文只定义 `apps/controller` 的移植、打包、连接、原生桥与服务端契约，不包含实现代码。
>
> 依据：`docs/OWNER-DIRECTIVES.md`、`docs/remote-ux-spec.md`、`docs/native-app-plan.md`、`docs/adr/INDEX.md`。若本文与后续独立 ADR 冲突，以更新后的 ADR 为准。

## 0. 目标与边界

### 0.1 三端实体

| 实体 | 职责 | 明确不做 |
|---|---|---|
| 受控端 | 运行 DeepSeek Harness（下称 DSH）与 WhaleMaid 插件；注册设备、维持在线、承接原生 DSH `/api`、管理本机文件与第三方凭据 | 不承载主控 App UI；不把第三方 API key 发给主控端 |
| 服务端 | 账号与设备发现、认证、连接协商、P2P/中继选择、rathole 控制、状态与风控 | 不解释或重写 DSH 会话语义；会话通道按 E2E 零知识设计 |
| 主控端 | 同一套移植前端，运行于 Web、Electron、Capacitor Android/iOS；发现并连接设备，操作受控端原生 DSH 会话 | 不要求本机安装或运行 DSH；普通流程不要求用户输入 IP/端口/协议 |

对应 ADR-039/040/041/042；ADR-038 的“agent 对 agent”模型废止。

### 0.2 产品原则

1. **移植，不复刻**：以官方 `deepseek-ai/deepseek-harness` MIT 前端为上游，保留 DSH 的信息架构、会话、审批、轨迹、设置与交互语义。
2. **一个前端，多个壳**：Web、Electron、Capacitor Android/iOS 共用业务与 UI 源码；平台差异收敛到适配层。
3. **原生 API 透明**：连接成功后，官方前端继续同源调用 `/api`；网关把请求和流式连接转发到选定受控端。
4. **连接先于控制台**：设备发现与认证闭环完成后才装载 DSH 控制台，首屏不直接暴露 DSH API 错误。
5. **服务端地址不是设备地址**：官方服务使用内置地址；自托管只在设置中一次配置服务端。IP 直连保留为高级选项，不进入主流程。
6. **开源边界清晰**：上游 MIT 文件保留版权与许可证；WhaleMaid 开源代码遵循仓库协议；闭源账号、计费、风控和运营系统只能通过公开契约接入。

## 1. 目录与模块边界

目标目录如下；名称是实现约束，具体构建工具可在 spike 后补充 ADR，但不得破坏模块边界。

```text
apps/controller/
├── DESIGN.md
├── THIRD_PARTY_NOTICES.md          # 上游 MIT 文件、版本、commit、改动记录
├── package.json
├── src/
│   ├── upstream/                   # 尽量原样保存的官方 DSH 前端源码
│   │   ├── web-frontend/
│   │   ├── client-core/
│   │   ├── client-react/
│   │   └── api-contract/
│   ├── app/                        # WhaleMaid 启动、路由、错误边界
│   ├── connection/                 # 设备发现、认证、连接状态机
│   ├── gateway/                    # /api 同源代理选择与传输适配
│   ├── native/                     # 相机/相册/麦克风/文件统一接口
│   ├── platform/                   # web/electron/capacitor 能力实现
│   ├── features/devices/           # 设备列表、编号连接、直连高级入口
│   ├── features/transfers/         # 附件与文件选择的跨端编排
│   ├── styles/                     # 安全区、触控、软键盘与响应式覆盖
│   └── main.tsx
├── electron/                       # Electron main/preload，仅桌面壳职责
├── android/                        # Capacitor 生成/维护的 Android 工程
├── ios/                            # Capacitor 生成/维护的 iOS 工程
└── public/
```

约束：

- `src/upstream/**` 不引用 WhaleMaid 服务端 SDK；反向依赖禁止。
- `src/connection/**` 不导入 Capacitor 或 Electron API，只依赖 `src/native`、`src/gateway` 暴露的接口。
- Electron renderer 不开启 Node 集成；文件与系统能力只经受限 preload IPC。
- Web 端能力不足时返回显式 `unsupported`，不得伪装成功或引入平台条件散落在 UI 中。

## 2. 官方 DSH 前端移植清单

### 2.1 上游冻结规则

首次 spike 必须冻结：上游仓库 URL、MIT 许可证全文、commit SHA、包管理器锁文件、引入文件清单及每个文件的本地去向。禁止只记录分支名或 `latest`。

每次同步上游执行：

1. 对照冻结 commit 生成新增/删除/修改清单；
2. 先更新 `src/upstream/**`，再重放 WhaleMaid 薄适配；
3. 对被修改的上游文件记录原因与对应 ADR/UX 编号；
4. 更新 `THIRD_PARTY_NOTICES.md`；
5. 禁止复制官方服务端、凭据或部署配置中与前端运行无关的文件。

### 2.2 引入包与文件类别

现有设计资料只确认了上游包名族，未确认目标 commit 的实际 monorepo 路径；因此下表以**包名与文件职责**作为移植清单。spike 应把“上游实际路径”补成精确路径，不得猜测后直接实现。

| 上游包/区域 | 引入文件 | 本地去向 | 处理方式 |
|---|---|---|---|
| `dsh-web-frontend` | 应用入口、路由、页面、会话侧栏、消息/轨迹、审批、设置、主题、样式、静态资源 | `src/upstream/web-frontend/` | 主体原样引入；只在入口、路由边界和响应式样式处接适配层 |
| `dsh-client-*` 核心包 | API client、请求类型、会话/任务状态、流式事件解析、错误模型、缓存或状态管理 | `src/upstream/client-core/` | 原样优先；基地址固定为同源，认证与设备选择不得侵入每个调用点 |
| `dsh-client-*` UI/React 包 | hooks、providers、UI 组件、会话与审批组件 | `src/upstream/client-react/` | 原样优先；仅替换顶层 provider 注入与平台能力入口 |
| `dsh-host-apiproxy` 浏览器侧契约 | `/api` 路由类型、fetch/SSE/流式协议、browse seam、附件相关契约 | `src/upstream/api-contract/` | 只引入浏览器所需契约；不把宿主执行逻辑打进主控端 |
| 上游共享资源 | 图标、字体、主题 token、国际化文本 | 相应 `src/upstream/**` 或 `public/` | 保持命名和版权；新增 WhaleMaid 文案独立命名空间 |
| 上游测试与 fixtures | 与被移植前端行为直接相关的单测、协议 fixture | 与模块同目录或统一测试目录 | 能运行则同步引入；依赖上游私有环境的测试记录为不可移植项 |

明确排除：

- DSH 宿主进程、模型执行器、CLI、服务端部署代码；
- 上游开发环境中的密钥、遥测配置和发布凭据；
- 与浏览器前端无关的 native/desktop 实现；
- 自定义 `/api/v1` 控制协议及已废止 `packages/control` 依赖。

### 2.3 上游文件改动点

优先通过外层包装实现，直接改上游文件仅限下列 seam：

| 改动点 | 允许改动 | 禁止改动 | 追踪 |
|---|---|---|---|
| 启动入口 | 在 DSH App 外包 `ControllerBootstrap`，先完成服务端配置、身份恢复、设备选择和连接 | 在每个页面重复连接判断 | ADR-039/040 |
| 顶层路由 | 增加 `/connect`、`/devices`、`/settings/service`；连接成功后挂载原 DSH 路由树 | 重写 DSH 会话页面路由语义 | UX-003/011 |
| API transport | 将 client 的 transport 注入为同源 `/api`；统一处理 401、断线和重连 | 批量修改每个 API 调用 URL | ADR-041、UX-012 |
| Provider | 注入 `ConnectionProvider`、`NativeBridgeProvider`、`PlatformProvider` | 让上游组件直接依赖 Capacitor/Electron | ADR-039 |
| 响应式布局 | 安全区、触控目标、软键盘避让、侧栏抽屉、横屏/平板两栏 | 改变桌面端核心信息层级与操作含义 | D-020/022/023 |
| 文件浏览 seam | 为官方 browse 契约补移动目录树、面包屑、目录选择器 | 在主控端直接读取受控端文件系统 | UX-017、ADR-008 |
| 附件入口 | 将相机、相册和本地文件结果转换为官方附件输入 | 绕过 DSH 附件管道直传第三方视觉服务 | UX-018、ADR-013/025 |
| 输入框语音 | 增加录音按钮和转写回填，不改变文本提交协议 | 将原始音频静默上传到未授权服务 | UX-018、ADR-009/025 |
| 错误边界 | 把网关错误映射为设备离线、密码错误、吊销、网络失败 | 向普通用户展示 IP、端口、rathole、SSE 等实现词 | UX-008/011/021 |

### 2.4 移植验收

- 与同版本官方 Web 前端对比：会话创建、会话列表、消息、轨迹、审批、设置和附件的行为语义一致。
- Web、Electron、Android、iOS 使用同一前端构建产物或同一源码流水线，不维护四份业务 UI。
- 连接后所有 DSH 请求仍表现为同源 `/api`；前端业务组件不知道受控端 IP。
- 上游同步可通过清单区分“原样文件、薄改文件、WhaleMaid 新文件”。
- MIT 版权和许可证可从发行包内查看。

## 3. 打包壳设计

### 3.1 Capacitor：Android 与 iOS

- Capacitor 只负责 WebView 容器、生命周期、深链、权限和原生桥；业务 UI 继续来自共享前端。
- Android/iOS 采用相同 bridge TypeScript 接口，各自原生插件只实现平台细节。
- App 默认连接官方服务地址；自托管地址在首次配置或设置页修改，并进行 TLS 与可达性校验。
- 权限按使用时申请，不在首次启动一次性索取相机、相册、麦克风和全盘文件权限。
- WebView 只允许导航到受信任的本地 App origin；外链交给系统浏览器。
- 后台/前台切换触发连接状态复核；短时后台保持会话，系统回收后通过恢复令牌重连。

### 3.2 Electron：Windows、macOS、Linux

- Electron 是 PC 原生安装包选项；Web 版同时保留。
- renderer 使用与 Web/Capacitor 相同的前端入口。
- `contextIsolation=true`、`nodeIntegration=false`、启用 sandbox；preload 只暴露白名单 bridge。
- 文件选择使用系统对话框，返回最小必要的文件句柄/内容，不向 renderer 暴露任意文件系统 API。
- 自动更新、代码签名、系统通知属于壳能力，不得进入 DSH 上游组件。

### 3.3 Web

- Web 是无需安装的主控端与开发基线，不是移动端唯一形态。
- 使用浏览器文件选择、MediaDevices 和 IndexedDB；能力受限时提供明确降级说明。
- 设备私钥使用 WebCrypto ECDSA P-256 不可导出密钥并持久化于 IndexedDB；清站点数据视为重新配对。

### 3.4 构建产物

| 平台 | 产物 | 前端来源 | 平台专属代码 |
|---|---|---|---|
| Web | 静态站点 | 共享前端 | Service Worker、Web bridge |
| Windows/macOS/Linux | Electron 安装包 | 共享前端 | main、preload、签名/更新配置 |
| Android | APK/AAB | 共享前端 | Capacitor 工程、权限、插件实现 |
| iOS | IPA/App Store archive | 共享前端 | Capacitor 工程、entitlements、插件实现 |

## 4. 连接状态机与 UX 映射

### 4.1 状态机

```text
BOOT
  -> SERVICE_CONFIGURED
  -> CONTROLLER_AUTHENTICATED
  -> DEVICE_LIST_READY
  -> DEVICE_SELECTED
  -> AUTHORIZING
  -> PATH_NEGOTIATING
  -> CONNECTED
  -> RECONNECTING -> CONNECTED
                    -> DISCONNECTED
```

规则：

- 任一状态均可进入 `REVOKED`、`AUTH_FAILED`、`DEVICE_OFFLINE` 或 `NETWORK_ERROR`。
- `CONNECTED` 前不得挂载 DSH 控制台；`CONNECTED` 后为当前设备建立唯一活动路由上下文。
- 切换设备必须先关闭旧设备流式通道并清空仅属于旧设备的客户端缓存。
- 重连复用短期连接恢复令牌，不重新发送长期密码；恢复令牌失效才重新认证。

### 4.2 UX-001..008

| UX | 受控端 | 服务端 | 主控端 |
|---|---|---|---|
| UX-001 启动即注册 | 插件启动后以设备密钥注册，周期心跳；进程退出或超时变离线 | 保存设备编号、账号归属、能力与在线租约，不保存会话内容 | 登录后自动订阅设备状态，无需用户触发扫描 |
| UX-002 设备编号 | 首次生成并持久化短数字编号；冲突时由服务端重新分配；受控端醒目展示 | 保证编号唯一、可校验、可回收但不短期复用 | 设备卡片和手动连接框接受规范化编号 |
| UX-003 自动发现 | 同账号绑定时上报账号设备关系 | 返回同账号设备列表与实时状态 | 登录成功立即展示设备；页面不出现 IP/端口/协议 |
| UX-004 路径透明 | 提供候选网络能力并接受中继隧道 | P2P 优先，失败自动分配 rathole 中继；返回抽象路径状态 | 只显示“连接中/已连接/弱网”，高级诊断才显示路径类型 |
| UX-005 临时协助 | 生成一次性、限时临时密码或票据 | 原子消费；过期、已使用或撤销后拒绝 | 无账号可输入“设备编号+临时密码”连接，不写入长期设备列表 |
| UX-006 长期密码 | 本机设置；只提交抗离线破解的验证材料，不上传明文 | 执行挑战/验证、限速和吊销；成功签发短期连接令牌 | 用户输入编号+密码；可选安全存储可吊销的设备凭据，不保存明文密码 |
| UX-007 临时密码 | 可生成、刷新、撤销，并展示剩余有效期 | 一次性消费与 TTL 强制执行 | 明确显示过期/已使用/被撤销，不自动降级为长期认证 |
| UX-008 匹配与防爆破 | 接收连接事件并记录结果 | 按账号、设备、来源联合限次；返回稳定错误码与重试时间 | 密码错误、设备离线、被限流、被吊销分别提示；密码框不因普通网络重试被清空 |

### 4.3 UX-011..014

| UX | 交互步骤 | 实现约束 |
|---|---|---|
| UX-011 秒连 | 点设备 → 必要时输密码 → 连接中 → DSH 控制台 | 已授权设备可省略输密码；所有失败给原因和重试；普通 UI 永不出现 IP/端口/协议 |
| UX-012 自动重连 | 连接断开 → 原地显示重连 → 恢复同一设备与会话 | 使用恢复令牌与最后事件游标；重建 fetch/SSE/WebSocket；不得新建一份 DSH 会话冒充恢复 |
| UX-013 实时在线 | 设备卡片自动变更在线/离线/忙碌 | 服务端以心跳租约为准，经 SSE/WebSocket 推送；轮询只作降级；目标为秒级 UI 更新 |
| UX-014 状态标识 | 连接页和控制台顶栏显示连接状态、延迟、加密状态 | 延迟用平滑值；“已加密”只在端到端/隧道校验真实成立时显示；弱网与重连可操作 |

### 4.4 连接错误码与文案语义

| 错误码 | HTTP/通道语义 | 用户语义 | 是否自动重试 |
|---|---|---|---|
| `DEVICE_NOT_FOUND` | 404 | 设备编号不存在，请核对 | 否 |
| `DEVICE_OFFLINE` | 409 | 设备离线，请确认受控端已启动 | 可低频重试 |
| `INVALID_CREDENTIAL` | 401 | 密码错误 | 否 |
| `CREDENTIAL_EXPIRED` | 401 | 临时密码已过期 | 否 |
| `CREDENTIAL_CONSUMED` | 409 | 临时密码已使用 | 否 |
| `DEVICE_REVOKED` | 403 | 此设备授权已被撤销 | 否 |
| `RATE_LIMITED` | 429 | 尝试过多，请稍后再试 | 到 `retry_after` 后 |
| `RELAY_UNAVAILABLE` | 503 | 暂时无法建立连接 | 是，指数退避 |
| `SESSION_RESUME_FAILED` | 409 | 现场恢复失败，请重新连接 | 否，转完整连接 |
| `CLIENT_UPDATE_REQUIRED` | 426 | 客户端版本过旧，请更新 | 否 |

## 5. 原生桥清单

### 5.1 统一接口

前端只依赖以下抽象，不直接依赖 Capacitor、Electron 或浏览器对象：

```ts
interface ControllerNativeBridge {
  camera.capture(options): Promise<NativeAsset>;
  gallery.pick(options): Promise<NativeAsset[]>;
  microphone.start(options): Promise<RecordingHandle>;
  microphone.stop(handle): Promise<NativeAsset>;
  files.pick(options): Promise<NativeAsset[]>;
  files.save(options): Promise<SavedFile>;
  capabilities(): Promise<NativeCapabilities>;
}
```

`NativeAsset` 至少包含 `name`、`mimeType`、`size`、受控读取句柄和可选尺寸/时长；不得默认暴露永久绝对路径。bridge 对大文件提供流式读取，避免一次性 base64 复制。

### 5.2 相机

- 能力：拍照、前后摄像头选择、压缩质量、最大尺寸、取消。
- 流程：请求权限 → 拍摄 → 本地预览与确认 → 转为 `NativeAsset` → DSH 附件管道。
- 隐私：未确认的照片不上传；临时文件在提交完成或取消后清理；EXIF 位置默认移除。
- 降级：Web 使用 `capture`/MediaDevices；桌面无摄像头时隐藏直接拍照入口但保留文件选择。

### 5.3 相册

- 能力：单选/多选、图片/视频 MIME 过滤、原图或压缩副本。
- 权限：优先系统照片选择器的有限授权，不索取整个相册读取权限。
- 流程：选择 → 校验格式/大小 → 用户预览 → DSH 附件管道。
- 失败必须区分用户取消、权限拒绝、资源不可读和格式不支持。

### 5.4 麦克风

- 能力：开始、暂停/继续、停止、取消、时长与电平、平台统一编码元数据。
- 流程：明确知情同意 → 录音 → 本地可见录音态 → 上传受控端 BYOK ASR 或 Level 2 通道 → 文本回填输入框 → 用户确认发送。
- 原始音频不得默认进入会话；转写失败时允许保存/重试/删除。
- App 进入后台、来电或设备切换时安全暂停或终止，并向 UI 返回确定状态。

### 5.5 文件

- 主控端本地文件：系统选择器选取附件，不提供任意目录遍历权限。
- 受控端文件夹：使用官方 browse seam 在远端列目录、建目录、选工作区；这不是原生 bridge 的本地文件访问。
- Electron：preload IPC 调系统对话框；renderer 只收到受限句柄。
- Android：使用 Storage Access Framework；iOS 使用 Document Picker 与安全作用域资源；Web 使用 File API。
- 上传前执行大小、MIME、扩展名和可读性校验；服务端只转发，不把附件落到控制面数据库。

### 5.6 能力与权限矩阵

| 能力 | Web | Electron | Android/iOS Capacitor |
|---|---|---|---|
| 相机 | MediaDevices/文件输入，受浏览器权限限制 | 系统/浏览器能力，按设备可用性 | 原生相机插件 |
| 相册 | 文件选择器 | 系统文件选择器 | 系统照片选择器 |
| 麦克风 | MediaRecorder | renderer 媒体权限，经壳策略授权 | 原生录音插件 |
| 本地文件 | File API，有限 | preload 白名单 IPC | SAF / Document Picker |
| 受控端目录 | 统一 browse seam | 统一 browse seam | 统一 browse seam |

## 6. 与服务端 API 的对接契约

### 6.1 契约分层

1. **控制面 API**：设备、认证、连接协商、在线订阅、恢复与吊销。由 WhaleMaid 公开契约定义。
2. **数据面 `/api`**：DSH 原生 API、SSE/流式响应、附件与 browse seam。客户端不改调用点，网关按活动连接转发。
3. **中继通道**：P2P 或 rathole 的加密字节通道。路径选择对普通 UI 透明。

禁止新增业务版 `/api/v1` 来镜像 DSH API。WhaleMaid 控制面统一放在 `/_whalemaid/` 命名空间，避免与 DSH 原生 `/api` 冲突；若后续改名须新增 ADR。

### 6.2 通用请求约定

- HTTPS/WSS 必须；生产环境拒绝明文服务端地址。
- JSON 字段使用 `snake_case`；时间为 RFC 3339 UTC；持续时间以毫秒整数表示。
- 请求头：
  - `Authorization: Bearer <controller_access_token>`：主控账号或匿名临时会话令牌；
  - `X-WhaleMaid-Client-Version`：客户端语义版本；
  - `X-WhaleMaid-Platform`：`web|electron|android|ios`；
  - `X-Request-Id`：客户端生成，便于幂等与追踪；
  - `X-WhaleMaid-Connection`：连接建立后由网关签发的连接 ID，仅用于 `/api` 路由。
- 响应错误统一为：

```json
{
  "error": {
    "code": "DEVICE_OFFLINE",
    "message": "stable developer message",
    "request_id": "uuid",
    "retry_after_ms": 3000,
    "details": {}
  }
}
```

`message` 不直接作为用户文案；客户端按 `code` 本地化。未知错误显示通用文案并保留 `request_id`。

### 6.3 设备发现与状态

#### `GET /_whalemaid/devices`

返回当前账号可见设备：

```json
{
  "devices": [
    {
      "device_id": "stable-opaque-id",
      "device_code": "123456789",
      "name": "Work PC",
      "online": true,
      "last_seen_at": "2026-08-15T03:00:00Z",
      "capabilities": ["dsh_api", "browse", "attachments", "sse"],
      "authorization": "password_required"
    }
  ],
  "revision": "opaque-revision"
}
```

不得返回设备 IP、监听端口、rathole token 或密码验证材料。

#### `GET /_whalemaid/events`

SSE 或等价 WebSocket 订阅，事件至少包含：

- `device.online` / `device.offline` / `device.updated`；
- `connection.state`；
- `authorization.revoked`；
- 心跳注释或 ping，用于检测失活。

每个事件带单调 `event_id`；重连通过 `Last-Event-ID` 恢复，无法恢复时返回全量 revision 刷新信号。

### 6.4 设备认证

#### `POST /_whalemaid/device-auth/challenge`

请求：设备编号与认证模式；响应：短期 challenge、算法、过期时间和限流信息。长期密码不得以明文或可重放摘要直接发送。

#### `POST /_whalemaid/device-auth/verify`

请求 challenge 响应或临时凭据。成功返回短期 `device_grant`；失败使用第 4.4 节错误码。临时密码验证必须原子消费。

服务端实现可选择“服务端验证材料”或“受控端参与验证”，但公开契约必须满足：防重放、限速、challenge 过期、凭据不进入日志、成功后只签发短期可吊销 grant。

### 6.5 建立、恢复与关闭连接

#### `POST /_whalemaid/connections`

```json
{
  "device_code": "123456789",
  "device_grant": "opaque-short-lived-grant",
  "client_capabilities": ["sse", "stream_upload", "webrtc_candidate"],
  "preferred_paths": ["p2p", "relay"]
}
```

成功响应：

```json
{
  "connection_id": "opaque-id",
  "state": "negotiating",
  "resume_token": "opaque-one-device-token",
  "expires_at": "2026-08-15T04:00:00Z",
  "negotiation": {
    "mode": "automatic",
    "offer": {}
  }
}
```

`negotiation.offer` 的具体网络字段由传输层版本化，普通业务组件不得读取。P2P 失败后服务端自动切换中继，不要求用户重新输密码。

#### `POST /_whalemaid/connections/{connection_id}/resume`

携带 `resume_token`、最后 DSH 流式事件游标和客户端能力。成功后继续同一设备数据面；失败返回 `SESSION_RESUME_FAILED`，客户端转为完整连接，不自动创建 DSH 新会话。

#### `DELETE /_whalemaid/connections/{connection_id}`

幂等关闭连接并释放中继资源。App 正常退出、切换设备和用户主动断开时调用；异常失联由租约回收。

### 6.6 DSH 原生 `/api` 转发

- 客户端连接成功后，所有原生请求继续发往 App origin 的 `/api/**`。
- 网关根据 `X-WhaleMaid-Connection` 或同源安全 cookie 选择唯一受控端，并通过已认证通道转发。
- 保留 HTTP 方法、路径、查询、状态码、内容类型、流式分块和取消语义；不得把 SSE 缓冲成完整响应。
- hop-by-hop headers、客户端授权头和内部路由头不得透传到 DSH；网关注入受控端所需的最小内部身份。
- 401 分层：控制面令牌失效进入主控登录；设备 grant 失效回到设备认证；DSH 原生权限错误留给官方前端审批/登录 UI。网关必须用错误来源标识避免混淆。
- 附件采用流式上传与背压；控制面服务不持久化附件正文。
- browse seam 只访问受控端宿主允许的根目录与能力范围。

### 6.7 受控端注册契约

主控端不直接调用，但其行为决定 UX-001/002/013：

- 受控端以设备密钥向服务端注册 `device_id`、`device_code`、账号绑定、版本、能力和租约；
- 心跳更新在线租约与能力，不上传 DSH 会话内容；
- 设备编号冲突由服务端拒绝并触发受控端重新分配；
- 每设备独立中继 service/token；吊销时服务端移除配置并热重载；
- 设备离线判定与 UI SLA 分离：服务端保存精确租约状态，主控端秒级接收变化。

### 6.8 版本与能力协商

- 控制面响应包含协议版本；连接建立时双方交换 capabilities。
- 新能力必须可选，旧客户端忽略未知字段；删除或改变既有语义必须升级主版本并新增 ADR。
- 服务端可返回 `CLIENT_UPDATE_REQUIRED`，但必须给出最低版本和升级原因。
- 平台能力缺失不影响基础文字会话；相机、麦克风、文件等按 capability 隐藏或降级。

## 7. 安全与隐私约束

- 主控端只保存可吊销的访问令牌、设备 grant/恢复令牌和不可导出设备私钥；不保存长期密码明文。
- 第三方 ASR、OCR、视觉 key 只存受控端本地 `dsh-credentials`；主控端只发用户明确选择的媒体。
- 日志禁止记录密码、临时密码、challenge 响应、访问令牌、中继 token、附件正文和完整 `/api` 消息内容。
- 所有连接尝试具备审计事件；受控端提示、主动断开、历史与拉黑对应 UX-009/010，虽非本任务连接流主表，接口设计不得阻断后续实现。
- 直连高级模式必须显式警告并沿用相同认证、加密和错误模型，不能因绕过官方中继而降级为裸 `/api` 暴露。
- “已加密”标识必须由实际握手结果驱动，不得使用静态文案。

## 8. 实现阶段清单

### Phase A：上游 spike 与冻结

- [ ] 确认官方仓库、commit、MIT 文件和前端实际包路径。
- [ ] 独立构建 `dsh-web-frontend` 与所需 `dsh-client-*`。
- [ ] 确认 `dsh-host-apiproxy` 浏览器契约、SSE、browse 与附件 seam。
- [ ] 生成精确文件映射和 `THIRD_PARTY_NOTICES.md`。
- [ ] 验证同源 `/api` 可通过测试网关转发，不修改业务调用点。

### Phase B：连接闭环

- [ ] 实现 UX-001..008 对应注册、发现、认证和防爆破。
- [ ] 实现连接状态机、错误码和设备列表首屏。
- [ ] 实现 UX-011..014 的秒连、恢复、在线推送和状态标识。
- [ ] 保留 IP 直连为设置中的高级选项。

### Phase C：多壳与原生桥

- [ ] Web 基线与 Web bridge。
- [ ] Capacitor Android/iOS 壳、安全区与生命周期。
- [ ] Electron 壳、受限 preload 与系统文件选择。
- [ ] 相机、相册、麦克风、文件 bridge 及权限降级。

### Phase D：DSH 一致性回归

- [ ] 会话创建、恢复、轨迹、审批、设置与官方前端一致。
- [ ] 受控端目录、工作区创建、附件和语音转写全链路。
- [ ] Web/Electron/Android/iOS 同一契约回归。
- [ ] 断网、弱网、后台恢复、吊销、密码错误和服务端故障回归。

## 9. 非目标与待 ADR 项

本设计不决定：

- 官方上游尚未 spike 确认的精确 monorepo 文件路径；
- P2P 打洞库及其信令字段；rathole 仍是已确认中继基底；
- Electron 自动更新供应商、应用商店发布配置与签名账户；
- 推送供应商、账号计费、Level 2 商业实现；
- 鸿蒙壳的具体 ArkWeb 工程。

这些事项不得通过临时代码暗定；确认后新增或升级 ADR，并同步本文。
