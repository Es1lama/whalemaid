# WhaleMaid（鲸娘）

> 让手机完全接管电脑上的 DeepSeek Harness：**原生会话、一次验证、后续安全**。
> for DeepSeek Harness · AGPL-3.0 · 非官方社区项目

WhaleMaid 是 DSH 的接入层：手机是电脑上 DSH 的"增强手柄"——远程时全面覆盖原生体验（历史会话、工作区、模型、权限、审批），在场时依然想用手机（语音、拍照提问、推送）。

- **原生**：手机操作的就是电脑上跑着的那个 DSH 会话（区别于 Happy 式自有会话）；
- **无人值守**：长期密码一次验证，之后免扫码（复制 ToDesk/向日葵/RustDesk 验证过的模型）；
- **零依赖**：开源版原生支持 IP 直连，不需要任何服务器；官方中继只是增值选项；
- **安全**：E2E 加密会话、中继零知识、设备吊销即时生效、权限预设沿用 DSH。

## 状态

早期开发（M0 完成，M1 骨架可用）。已实机验证：插件挂载、设备绑定（挑战-应答）、会话/工作区/目录浏览透传、直连移动 UI（8/8 接口冒烟）。语音/视觉/热词属 V1（见 docs/requirements.md）。

## 快速开始（直连模式，开发/试用）

前置：Node ≥ 24、pnpm、已安装 DeepSeek Harness（`npx @deepseek-ai/dsh`）。

```sh
# 1. 构建
pnpm install --ignore-scripts
pnpm -r build && pnpm --filter @whalemaid/mobile build && pnpm --filter @whalemaid/plugin build

# 2. 安装到你的 web profile（以实际路径为准）
dsh plugin --profile web add link:$(pwd)/packages/plugin

# 3. 重启 dsh web，插件默认监听 127.0.0.1:3180
# 4. 手机（同局域网）打开 http://<电脑IP>:3180/m
#    - 设备 ID：自定（WHALE-XXXX-XXXX，避免 0/1/I/O）
#    - 长期密码：<DSH_HOME>/whalemaid/store.json 的 longPassword
```

手机直连需插件绑定局域网：在 profile 的 cordis.patch.yml 给 `whalemaid` 行加配置 `host: 0.0.0.0`（设置界面为后续版本）。

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
