# Codex 委托任务书：主控端 App 体验实现

> 本任务交付给本机 Codex CLI（`codex exec`，运行环境需 set proxy）。
> 目标：**接近网易UU / ToDesk 的体验**。先读，后设计，再实现；实现放在新目录 `apps/controller`，不改其他包、不提交 git（由主代理审查）。

## 第一步：读上下文（顺序执行）

1. 读本仓库 `docs/remote-ux-spec.md`（UX-001..022 是唯一验收标准）、`docs/native-app-plan.md`、`docs/PRODUCT_DESIGN.md`、`docs/protocol.md`、`docs/adr/INDEX.md`（重点 ADR-039/040/041/042）。
2. 读 DSH 会话存档中**人类发送的全部消息**以理解全部需求：`~/.dsh/sessions/` 下按修改时间最新的会话目录，`session.jsonl.zstd` 用流式 zstd 解压（python `zstandard`），抽取 `type` 为 `user-rpc`/用户消息类事件里人类的文本（这是雇主与主代理的完整对话记录）。如 ~/.dsh 不可读，跳过并在报告中说明。
3. 读官方前端：`deepseek-ai/deepseek-harness`（MIT）仓库中 web 前端相关包（`dsh-web-frontend`、`dsh-client-*`），判断"可独立构建 + 指向我们网关"的最小移植面。

## 第二步：设计（先出文档，不写码）

在 `apps/controller/DESIGN.md` 输出：
- 打包壳决策：Android/iOS 用 Capacitor（WebView+原生桥）；PC 同时提供 Electron 与 Web 两种形态；
- 移植清单：官方前端哪些包/文件被引入，改动点（视口/触控/安全区/键盘）与保留点（视觉与交互 100% 保持）；
- 连接流（UX-001..008、UX-011..014 逐条对应）：受控端自动注册（设备编号+密码哈希）→ 主控端服务端地址一次性配置 → 设备列表发现（实时在线）→ 选设备输密码 → 服务端匹配 → 经中继连接；**任何界面不出现 IP/端口/协议字样**（服务端地址仅在首次配置页，且支持扫码/内置默认）；
- 原生桥清单：相机/相册、麦克风、文件选择、（后续）推送；
- 与服务端 API 的对接契约（受控端注册/心跳、主控端设备列表/connect 端点——若服务端端点缺失，在 DESIGN 中给出所需端点规格，由主代理实现 Rust 侧）。

## 第三步：实现（`apps/controller/`）

按 DESIGN 实现：移植前端 + Capacitor 壳 + 连接流 UI（设备列表/密码输入/连接状态/断线重连）+ 上述原生桥的最小可运行版。要求：不出现自造 UI 风格（沿用官方 DSH 视觉）；登录/设备管理部分按 UU/ToDesk 的简洁度。

## 报告

结束时输出：完成了什么、UX 编号覆盖表（哪些已实现/部分/未实现）、遗留问题与下一步建议。不 git commit。
