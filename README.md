# WhaleMaid（鲸娘）

> 让手机完全接管电脑上的 DeepSeek Harness：**原生会话、一次验证、后续安全**。
> for DeepSeek Harness · AGPL-3.0 · 非官方社区项目

WhaleMaid 是 DSH 的接入层：手机是电脑上 DSH 的"增强手柄"——远程时全面覆盖原生体验（历史会话、工作区、模型、权限、审批），在场时依然想用手机（语音、拍照提问、推送）。

- **原生**：手机操作的就是电脑上跑着的那个 DSH 会话（区别于 Happy 式自有会话）；
- **无人值守**：设备编号 + 长期密码一次验证，之后免扫码（复制 ToDesk/向日葵/RustDesk 验证过的模型）；
- **无 IP**：任何界面不出现 IP/端口/协议，只输设备编号 + 密码（局域网直连保留为高级选项）；
- **安全**：全链无明文段（TLS/WSS + rathole noise + 证书指纹固定 + 一次性 grant），中继零知识，设备吊销即时生效，权限预设沿用 DSH。

## 架构（三端实体）

| 端 | 组成 | 职责 |
|---|---|---|
| 受控端 | 能跑 DSH 的任意端（mac/win/ubuntu）+ 一个插件 | 启动即向中继注册（设备编号+密码哈希）；隧道直指宿主原生 web（官方 /api+WS+UI 是唯一载体，插件零监听、不重造任何协议） |
| 服务端 | Rust 中继（rathole noise sidecar + 控制面 `/_whalemaid/*`） | 设备注册/在线状态/密码验证（scrypt PHC+限速锁定）/一次性 grant/隧道转发；中继不存储会话内容 |
| 主控端 | 一个前端、多个壳：Web / Electron / Capacitor(Android/iOS) | 无需 DSH；移植官方 DSH web 前端（MIT），前端调用点零改动——只是承载从"本机"变成"隧道" |

## 状态

M1 主体完成，历经三轮 Codex 安全审计 + 一轮用户原话对齐审计（全部修复并回写）；Android 壳真机闭环已验证（点连接 → 官方界面 → 事件流 → 创建工作区 → 发任务 → 改设置）。V1 主机侧已建成（语音/视觉 BYOK 官方同源路由 `/api/whalemaid/*`，key 只存宿主 dsh-credentials，单测覆盖 + 手机隧道全链实测）；客户端 UI 接入（composer 工具排按钮）进行中；dashscope 热词待真实 key 实测。

## 快速开始（自托管中继）

```sh
# 1. 服务器：docker compose 一键部署中继（见 docs/deploy-server.md）
cd packages/relay
ADMIN_TOKEN='强随机密钥' ADMIN_INSTALL_CODE='一次性安装码' docker compose up -d --build
# 2. 受控端（家里电脑）：插件配置（profile 的 cordis.patch.yml）
#    relayUrl / relayFingerprint（服务器启动日志打印，空指纹拒绝接入）/ relayInstallCode / ratholeBin
# 3. 主控端：任意壳（Web 版 / Electron / Android APK），输入 设备编号 + 密码 即连
```

局域网直连（高级/专家选项）：走宿主官方开关（`dsh web --host 0.0.0.0`），插件不自建任何监听；默认路径恒为中继。

## 结构

```
docs/          设计稿、ADR、需求编号、协议 v3、威胁模型、UX 规范（唯一现行版）
packages/plugin      被控插件（DSH 宿主插件：注册/心跳/隧道 sidecar，零监听）
packages/relay       Rust 中继控制面（rathole noise sidecar + 授权/grant/隧道入口）
packages/hotwords    热词附加插件（独立开源、不默认安装；只传词表不传正文）
apps/controller     主控端：web（设备管理+隧道反代）/ electron / android（Capacitor 壳+原生隧道代理）
```

## 文档

- [产品设计稿](docs/PRODUCT_DESIGN.md) · [需求编号表](docs/requirements.md) · [协议 v3](docs/protocol.md) · [威胁模型](docs/threat-model.md) · [决策索引](docs/adr/INDEX.md) · [信道安全审计](docs/security-audit.md) · [远程控制 UX 规范](docs/remote-ux-spec.md)

## 许可

AGPL-3.0（详见 LICENSE）。闭源控制管理系统在独立私有仓库，不参与本仓分发。

## 安全

见 [SECURITY.md](SECURITY.md) 与 docs/security-audit.md。发现问题请私下报告，勿公开披露。
