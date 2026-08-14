# 安全策略（SECURITY）

## 支持版本

| 版本 | 状态 |
|---|---|
| main（未发布） | 开发中，无安全承诺 |

## 报告方式

发现问题请**私下**报告（GitHub Security Advisory：Security → Report a vulnerability），勿开公开 issue。48 小时内确认，修复后发布公告。

## 范围与边界

- **范围内**：packages/* 的代码与协议实现（contract/plugin/relay/mobile）、docs 中的协议与威胁模型设计缺陷。
- **范围外**：用户自身宿主机安全（宿主已沦陷场景见 docs/threat-model.md 残余风险）；第三方组件（DSH、rathole、DashScope 等）自身漏洞——我们会同步上游，不修上游。
- 官方中继 SaaS（whalemaid-console 私有仓）上线后另行发布其策略。

## 安全承诺

- 会话通道 E2E，中继零知识（不落地存储内容）；
- 第三方 API key 只存宿主本地；
- 吊销即时生效；
- 威胁模型与对策映射见 docs/threat-model.md（TM-001..013）。
