# WhaleMaid · 主控端 App 移植方案（已批准，执行中）

> 唯一现行版。依据 ADR-039/040/041：**一个前端、多个壳**；受控端 = 能跑 DSH 的端 + 插件；主控端 = 控制 App（无需 DSH）。
> 壳选型已定案（D-025）：Capacitor（Android/iOS）+ Electron（PC）+ Web，PC 双供，无 Tauri。

## 0. 一句话

**把官方 DSH web 前端（MIT）拿过来，做移动/桌面适配与原生桥，打包成 PC/Android/iOS（鸿蒙后置）的原生 App；它调用的接口从"本机 DSH"变成"经受控连接打到受控端"。**

## 1. 移植源（合法，MIT）

- 官方仓库 `deepseek-ai/deepseek-harness`（MIT）：前端相关包 `dsh-web-frontend`、`dsh-client-*`（连接/API 代理/UI 组件）、`dsh-host-apiproxy` 的浏览器侧 API 契约。
- 移植 = 复制源码 + 保留版权声明（MIT 义务），修改仅限"适配与新增"清单。

## 2. 打包壳选型（D-025 已定案）

| 端 | 壳 | 说明 |
|---|---|---|
| Android / iOS | **Capacitor** | 同一 WebView 前端；原生桥插件官方支持相机/相册/麦克风/文件/推送 |
| PC | **Electron**（+ Web 同供） | 同一前端包桌面壳；Web 版为同一构建产物直挂静态站点 |
| 鸿蒙 | WebView 壳（后置） | ArkWeb 装载同一前端 |

**回答"可以直接打包成 App 吗"：可以。** 用户拿到的是 APK / dmg / App Store 包，不出现浏览器。

## 3. 移动适配改动（轻量，保留 DSH 视觉与交互 100%）

- 视口/安全区（刘海、底部手势条）、触控目标尺寸、软键盘避让；
- 会话侧边栏 → 抽屉式导航；长列表虚拟化（官方前端已有）；
- 横屏/平板两栏保留（官方前端大概率已是响应式）。

## 4. 新增部分（超出移植，需要原生桥或新代码）

1. **设备连接管理（ToDesk 式）**：设备列表（本机记忆/远程发现）、在线状态、直连/中继标签、长短期密码、临时密码分享、吊销——新增前端模块 + 网关端点。
2. **中继接入**：服务端地址/凭据配置、经中继打到受控端（流量转接走 rathole）。
3. **电脑文件夹访问**：browse seam（官方已有 `host.listDirectory/createDirectory` wire）的移动 UI——目录树、面包屑、新建文件夹、选目录建工作区。
4. **照片上传**：原生桥（相机/相册）→ 附件 → 宿主附件管道（`dsh-attachment`）→ 视觉适配器（BYOK OCR/描述）→ 嵌入请求。
5. **语音录音**：原生桥（麦克风）→ 音频流 → 宿主 BYOK ASR → 转写回填输入框。
6. **通知**：任务完成/需审批 → 原生推送（App 内 + 系统通知）。
7. **审批流**：官方前端的审批 UI 保留（原生），经网关收发。

## 5. 认证注入点（前端零感知，2026-08-15 现行版）

- 授权全部在中继侧：`/_whalemaid/connect`（编号+密码验证，限速/锁定）→ 单连接一次性 grant → TLS/WSS 隧道入口消费；
- 主控端（apps/controller/web）把浏览器请求改写为**受控端宿主权威**并经隧道转发——官方信任栅栏放行同源请求（403 拒绝跨站，DNS-rebinding 防御）；
- **前端代码不改任何调用点**——官方 UI 继续同源调 `/api` 与 WS `/api/events.mux|host`，只是承载从"本机"变为"隧道"。
- Android 把固定本地代理 `http://127.0.0.1:43969` 配为 Capacitor `server.url`，并在 `BridgeActivity` 创建 WebView 前完成监听；该固定 origin 是 Capacitor 原生插件注入官方页面的前提，应用路径禁止随机端口回退。

## 6. 废止与清理（ADR-041/audit#3）

- 自定 RPC 协议：废止，**代码已删除**（routes/events/standalone/verifier/providers、packages/contract、scripts/smoke.mjs；git 历史备份）；
- `packages/control`（agent 工具）：废止，代码**已删除**（git 历史备份 commit 9ec7fef）；
- 自研 Android Kotlin / iOS SwiftUI 原生 UI：废止，源码**已删除**（git 历史备份 commit 9ec7fef）；插件内旧自研 PWA 构建产物 `/m` 静态服务已随清仓移除；
- 插件自建 listener / 网关：废止，插件零监听——隧道直指宿主原生 web 端口（audit#3）。

## 7. 里程碑

1. ✅ **官方前端独立构建**（docs/research/spike-official-frontend.md，commit 47f9438 冻结）；
2. ✅ **Web 版主控端**（apps/controller/web：设备管理首屏+官方 UI/API/WS 隧道反代，实测闭环）+ ✅ **PC 壳**（apps/controller/electron，smoke 过）；
3. ✅ Capacitor 壳 + 移动适配跑通（Android）：官方 UI/API/WS 真机链路、固定 origin 原生 bridge 注入、自动恢复均已验证；
4. ◐ 原生桥（D-023）：Android 已实现相机、相册、文件与麦克风录制 API（opaque cache asset + 256 KiB 分块读取 + release；系统选择器实测），WhaleMaid client module 已接入官方 `conversation.input.left` 与 `File[]` paste intake；iOS 对等桥与语音/转写接线待完成；
5. ◐ iOS 壳已完成 Swift 隧道移植与 CI macOS 构建配置（commit 8f75548）；三端一致回归待完成（ADR-039）。

## 8. 已定案

1. 壳选型（D-025 定案）：Capacitor（安卓/iOS）+ Electron（PC）+ Web，无 Tauri；
2. 设备管理模块放**登录前**（首屏设备列表，ToDesk 式）；
3. 官方前端本地构建改造：MIT 允许；构建链依赖官方 monorepo 的可能性以 spike 结论为准。
