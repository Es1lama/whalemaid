# WhaleMaid（鲸娘）· 产品设计稿

> 唯一现行版。旧版只存于 git 历史，本文档只保留当前有效语义（文档治理六原则见 PREFLIGHT §2）。
> 仓库 github.com/esilama/whalemaid（待创建）。开源协议 **AGPL-3.0（已确认）**。架构母本 Happier。

---

## §0 定案

名字 WhaleMaid（鲸娘），代码名 `whalemaid`，不带 dsh 前缀；定位 = 覆盖 + 增强，北极星 = 用户开着电脑也愿意用手机；手机操作的是电脑上 DSH 的**原生会话**。

## §1 开源协议

- 插件 / 中继与控制面 / 移动端 / 热词插件：**AGPL-3.0**——第三方改码闭源商用或闭源 SaaS 必须回开源（防直接偷走盈利）。RustDesk 同款，不伤 star。
- 版权人对自己的代码不受约束：官方闭源 SaaS 可基于自有开源核心开发。
- 可吸收 Apache-2.0/MIT/BSD 代码（rathole、DSH SDK、FunASR），反向不行。
- 双许可保留（企业闭源豁免另签）；**CLA 规则**：社区贡献进闭源 SaaS 前必须签 CLA（Phase B 前设立）。

## §2 工程宪法：复用决策程序

**三条理论合一为一个判定流程，每个"复用 or 自写"决策都过一遍，结论记 ADR：**

1. **造轮子理论**：先找现成轮子（许可优先 A 档 → B 档 → 最后才考虑 C 档洁净室）。
2. **复用边界条件理论**——命中任一即倾向复用：
   - 语言/运行时一致 → 直接复用；
   - 语言不一致（Rust vs Python vs npm）→ 优先 **sidecar/进程边界复用**（跨语言用进程隔离，控制面只管配置与生命周期）；必须进程内嵌入才评估 port 成本 vs 自写；
   - 轮子性能 ≥ 自写（通常成立），除非瓶颈可证明且不可配置缓解。
3. **开源传承与污染盈利理论**：A 档直接继承；AGPL 走四步法（见下）；自写只在以下情形成立——**无人区（无轮子）/ 轮子改造成本 > 自写 / 产品一致性需求（统一协议、统一凭据、统一审计）**。

平衡点 = min(复用：接入+适配+受限；自写：开发+测试+长期维护+预期 bug+许可风险)。
当前预期自写候选（**不预设，逐项过流程**）：控制面（设备身份/授权/吊销）、协议 glue、移动 UI、热词管线、视觉适配。已知复用：隧道 = rathole sidecar、宿主能力 = DSH SDK、语音/热词/视觉 = 现成 API、加密 = TLS/WebCrypto。

**引用顺序四步法**：① A 档源码优先（frp/rathole 直接读）→ ② B 档公开文档（仅用户可见行为，不能上位替代实现细节）→ ③ RFC/标准 → ④ C 档 AGPL 仅洁净室最后手段，留证 `docs/research/cleanroom-notes.md`。

## §3 技术栈

插件/移动端 TypeScript（React PWA）；中继/控制面 Rust（axum/tokio + SQLite）；传输 TLS + WebCrypto。

## §4 服务分层

Level -1（仅邮箱：极高限速，一周停服）/ Level 0（绑手机：高限速限并发）/ Level 1（订阅：放宽 + 恶意/亏损阈值；绑手机送试用暂定 2 个月）/ Level 2（增值：官方 ASR+热词+视觉）。

## §5 直连模式（REQ 级）

开源代码原生支持 IP 直连（`http(s)://<主机IP>:<端口>/m`）；自托管中继；官方中继三种模式共用协议与移动端。

## §6 三通道

会话 E2E 零知识；语音/视觉为知情同意通道（BYOK 或 Level 2）。热词只传词表不传正文。

## §7 协议准备（不过度耦合）

版本化信封 + capability 广播、`CredentialVerifier` 接口抽象、三通道先行建模、配置前向兼容；代码/注释/README 禁止 billing/subscription/account 字样与死代码桩。

## §8 实施边界

- MVP：被控插件、Rust 中继+控制面、全自研移动端、IP 直连、工作区创建（不宣传）、目录模式、引用复制、文档/架构图/威胁模型/演示视频。
- V1：语音 BYOK、热词附加插件、视觉 BYOK（DeepSeek-OCR/通义 VL）、Web Push + Telegram、多机、临时密码分享、会话总结。
- Phase B（闭源）：手机号账号、分层计费、控制台、Level 2。
- 不做：像素远程桌面、手机沙盒、官方背书第三方 key 注入、与 dsh-web-ui 耦合、收费占位代码、非洁净室读 AGPL。

## §9 责权与合规

Phase B 前置：公司主体→短信→支付→备案→增值电信→PIPL。ToS 三原则：只控自有/授权设备；零知识不存内容；吊销即时生效。

## §10 代码参考链

| 仓库 | 许可 | 用途 |
|---|---|---|
| deepseek-ai/deepseek-harness | MIT | 宿主 SDK 全量能力 |
| rapiz1/rathole | Apache-2.0 | 隧道 sidecar（读源码学工程，不重写） |
| juanfont/headscale + tailscale | BSD-3 | 设备身份/授权语义 |
| happier-dev/happier | MIT | 架构母本：双形态、E2E、语音三态 |
| modelscope/FunASR | MIT | 热词演示 + Level 2 引擎 |
| 阿里 DashScope SDK + 定制热词 API | Apache-2.0 | BYOK 语音 + 热词库 |
| DeepSeek-OCR / 通义 VL | — | 视觉适配主力 |
| fatedier/frp | Apache-2.0 | 备选隧道（Go） |
| rustdesk / rustdesk-server | AGPL-3.0 | 仅四步法第④步洁净室对象，非必要不接触 |
| ToDesk | 闭源 | 仅公开帮助页产品行为（B 档） |

## §11 里程碑

M0（进行中）：ADR → 需求编号表 → spike S0–S5 → 协议 v1 → 威胁模型 → 仓库骨架。
M1：中继 MVP + 被控插件 + 移动端 + IP 直连。M2：完整 MVP → v0.1。M3：商店/awesome/发布帖。M4：Phase B 合规 + FunASR 预研。

## §12 开放问题

Q1 试用月数（暂定 2 个月）；Q2 吉祥物草图（M2 前，不阻塞）；Q3 短信供应商（Phase B 再定）；Q4 仓库创建（esilama/whalemaid，待用户操作）。
