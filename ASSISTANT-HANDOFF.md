# 辅助会话交接

主任务由 DSH 会话“阅读交接Prompt确定工作 (1)”负责。本辅助会话已迁移到隔离 worktree，禁止再修改主工作区代码。

## 隔离位置

- WhaleMaid worktree：`.tmp/assist-worktrees/workspace-errors`
- WhaleMaid 分支：`assist/workspace-error-forwarding`
- DSH source worktree：`.tmp/assist-worktrees/workspace-errors/.dsh-source`
- DSH 分支：`assist/workspace-error-forwarding`

## 已完成并在主仓推送的检查点

- `d613f9a` relay TLS 完整证书固定
- `e3ced0e` Android relay client 复用与轮询防重入
- `1150b49` Android WebView 剪贴板兜底
- `38f01e6` controller/controlled-host 权限分离
- `c7921f2` relay 状态轮询独立预算

## 已验证事实

- Android 通过普通 LAN relay 加载官方 DSH UI；未使用 ADB reverse。
- Android runtime role 为 `controller`；不显示“远程协助”；通过已认证隧道调用 `/api/whalemaid/device` 返回 403。
- 3080 未重启、未修改。验收用 3182 的 UI/plugin graph 通过 acceptance-only state-owner proxy 将原生 `/api/**` 和事件升级转发给 3080，避免只读第二进程写真实 profile。
- Android 已显示真实 3080 历史会话、工作区、模型、思考强度、权限预设和附件入口。
- Android Back 从连接页会保持 WhaleMaid 前台、断开并回设备页。

## 隔离分支已完成

用户补充要求：工作区选择/创建遇到 Windows 保护目录、POSIX 权限、只读文件系统、workspace attach 失败时，必须把宿主结构化错误转发到 UI，并支持正确重试，不能静默吞掉。

DSH 隔离分支已实现：

- `EmptyWorkspaceOwnerProps.onPick` 改为 `Promise<void>`；ConversationRoot 失败回滚后重新抛出。
- WorkspacePicker 区分“文件夹选取/创建失败”和“进入工作区/Session attach 失败”。
- 进入工作区失败显示“无法进入工作区”，保留宿主错误原文，并重试同一 Workspace。
- `WorkspaceRuntime.startSession` 返回 Promise，不再在 runtime 内 `console.warn` 后吞错。
- 选择期间阻止并发工作区操作。

已通过：

- workspace picker + conversation skeleton：34 tests
- runtime/workspace/sidebar adapters：32 tests
- runtime、ui-workspace、ui-conversation、ui-sidebar、ui-agent-preset focused typecheck
- runtime/ui-conversation/ui-workspace client bundle build

提交与交付：

- WhaleMaid 辅助分支已推送：`origin/assist/workspace-error-forwarding`
- WhaleMaid handoff commit：`0b908e0`
- 错误边界审计 commit：`21e6b4a`（见 `ERROR-BOUNDARY-AUDIT.md`；最高优先级是 Web controller 的复用 socket 可跳过 TLS pin）
- DSH source commit：`013bdb0`
- 可移植补丁：辅助分支 `patches/deepseek-harness-workspace-error-forwarding.patch`
- 主会话可检查 `0b908e0`，再对目标 DSH checkout 执行补丁内的 `git am`；不要 cherry-pick 到 WhaleMaid main 后直接把 patch 当运行时代码。

最终隔离验证：86 个受影响测试通过；937 组翻译配对和 542 个 Agent Note 格式检查通过；DSH staged pre-commit lint/translation/whitespace/vendor guard 通过。完整干净 worktree 的 aggregate typecheck 仍被基线生成的 Typert `commands` merge 缺失阻塞，未声明全量绿。

## 运行态提示

- 当前网络曾从 `192.168.10.16` 切到 `172.20.10.3`；不要把旧 LAN 超时归因于代码。
- relay 后台 job `bash-84` 已自然退出；如需继续真机验收，应由主会话按当前 LAN 地址重新启动 relay，并同步 acceptance patch 的 relayUrl。
- 3182 后台 job `bash-90` 仍可能运行；主会话接管前先用 job/listener 状态确认，不要按本文件假定。
