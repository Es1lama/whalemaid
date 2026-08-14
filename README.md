# WhaleMaid（鲸娘）

> 让手机完全接管电脑上的 DeepSeek Harness：**原生会话、一次验证、后续安全**。
> for DeepSeek Harness · AGPL-3.0 · 非官方社区项目

WhaleMaid 是 DSH 的接入层：手机是电脑上 DSH 的"增强手柄"——远程时全面覆盖原生体验（历史会话、工作区、模型、权限、审批），在场时依然想用手机（语音、拍照提问、推送）。

- **原生**：手机操作的就是电脑上跑着的那个 DSH 会话（区别于 Happy 式自有会话）；
- **无人值守**：长期密码一次验证，之后免扫码（复制 ToDesk/向日葵/RustDesk 验证过的模型）；
- **零依赖**：开源版原生支持 IP 直连，不需要任何服务器；官方中继只是增值选项；
- **安全**：E2E 加密会话、中继零知识、设备吊销即时生效、权限预设沿用 DSH。

## 状态

早期开发（M0/M1）。本 README 的快速开始将在 v0.1 发布时补全。

## 结构

```
docs/          设计稿、ADR、需求编号、协议规格、威胁模型（唯一现行版）
packages/contract   统一 API 契约（多端共用，双仓边界）
packages/plugin     被控插件（DSH 宿主插件：自建 listener + 认证网关）
packages/relay      Rust 中继控制面（rathole sidecar 管理）
packages/mobile     移动端 PWA（Web 先行；Android/iOS/鸿蒙对同一契约实现）
```

## 文档

- [产品设计稿](docs/PRODUCT_DESIGN.md) · [需求编号表](docs/requirements.md) · [协议 v1](docs/protocol.md) · [威胁模型](docs/threat-model.md) · [决策索引](docs/adr/INDEX.md)

## 许可

AGPL-3.0（详见 LICENSE）。闭源控制管理系统在独立私有仓库，不参与本仓分发。

## 安全

见 [SECURITY.md](SECURITY.md)。发现问题请私下报告，勿公开披露。
