# 贡献指南（CONTRIBUTING）

## 文档纪律（六原则）

简洁 / 有效 / 时效（旧语义只存 git 历史，唯一现行版制）/ 指导 / 与代码一一对应 / 可溯源。
**任何需求/协议/决策变更：先改文档（含 docs/adr/INDEX.md）→ 再改代码。**

## PR 要求

- 标题与描述必须填写关联编号：`REQ-xxx` / `PROTO-xxx` / `TM-xxx` / `ADR-xxx`；
- 涉及协议变更必须同步 docs/protocol.md 与 threat-model.md；
- 测试与验收标准对齐 docs/requirements.md；
- 签署 DCO（`git commit -s`）。

## 引用纪律（四步法）

1. A 档（MIT/BSD/Apache）源码可直接参考复用，保留版权声明；
2. B 档公开文档自由引用（仅用户可见行为，不能替代实现细节）；
3. RFC/标准；
4. C 档 AGPL 仅洁净室最后手段：笔记定稿（docs/research/cleanroom-notes.md）→ 冻结 → 只依笔记实现。**严禁直接复制 AGPL 代码。**

## 许可与边界

- 本仓 AGPL-3.0；
- 闭源控制管理系统在私有仓 whalemaid-console，**不接收本仓以外的代码**；
- 社区贡献代码进入闭源仓前必须签 CLA（Phase B 生效前设立）；
- 代码/注释/README 禁止出现 billing/subscription/account 等商业字样或死代码桩（ADR-021）。

## 代码头引用

模块头部一行 `SPEC: docs/protocol.md#PROTO-xxx` 即可，不写业务承诺。
