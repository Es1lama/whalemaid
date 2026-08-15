# THIRD_PARTY_NOTICES — 官方 DSH 前端 vendor 产物

本目录 `vendor-dist/` 为 deepseek-ai/deepseek-harness 官方 web 前端构建产物（v0.1.0-rc.5 基线）。

- 来源：https://github.com/deepseek-ai/deepseek-harness（apps/web + packages/client/*）
- 冻结 commit：47f943859bef60e4160492346772ded9b24f765a
- 许可证：仓库根 LICENSE = MIT（DeepSeek，2026）；npm 发布包 `@deepseek-ai/dsh-web-frontend` 自声明 BSD-3-Clause，以源码仓库 MIT 为准，二者均无传染性义务；本仓库按 MIT 义务保留其 LICENSE 副本（见本目录 LICENSE）。
- 构建方式：官方 monorepo 内 `pnpm install && pnpm build:lib && pnpm --filter @deepseek-ai/dsh-web-frontend build`（docs/research/spike-official-frontend.md）。
- 修改状态：**未做任何修改**（纯复制；移动适配与设备管理模块在壳层实现，不侵入 vendor）。
- 完整第三方依赖清单（react/katex/shiki/micromark 等）在发布打包阶段生成 SBOM（TODO: M2 前完成 `pnpm licenses list` 导出）。
