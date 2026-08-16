# 需要本人完成的事项清单（NEEDED BY OWNER）

> 本清单只列"必须由仓库所有者（你）亲自做"的事，避免来回找。做完一项在括号里写日期。
> 验收口径（goal）：**除注册邮箱/短信厂商、填入语音/视觉 key、准备一台服务器外，其余已全部完成并可部署。**

## 上架前（验收口径内仅剩这些）

1. [ ] **邮件/短信供应商注册与对接**：控制台（私有仓 whalemaid-console）已预制统一接口 + 通用 HTTP 适配器；你注册厂商后设置环境变量即用：
   - `WHALEMAID_EMAIL_ENDPOINT` / `WHALEMAID_EMAIL_TOKEN`（邮件，如 Resend/阿里云邮件推送的 HTTP 网关）
   - `WHALEMAID_SMS_ENDPOINT` / `WHALEMAID_SMS_TOKEN`（短信，如阿里云短信 HTTP 网关）
   - 真实短信验证码存储/校验：接替现在的 dev 打印模式（console src/main.ts 标注处）。
2. [ ] **填入语音/视觉 API key**：插件侧（宿主 dsh-credentials 引用名 + 配置）：
   - 语音：`voiceProvider=openai|groq|dashscope` + `voiceCredentialRef=XXX_API_KEY`（DashScope 文件识别与官方热词 API 仍需你注册后实测，见第 5 条）；
   - 视觉：`visionProvider=deepseek-ocr|qwen-vl|openai-vision|grok-vision|gemini` + `visionCredentialRef`。
3. [ ] **准备一台服务器**：`packages/relay` docker compose 一键部署（见 docs/deploy-server.md）；服务器需开放 2333（隧道）与 9080（控制面，建议防火墙限源）。

## 实机测试（我已做完桌面侧全部；剩手机端人工步骤）

4. [ ] **手机实机抽检**：Android 侧我已在 BlueStacks 全链验证（记住登录态自动重连、设备在线徽章、官方 UI/API/WS 隧道、V1 语音/视觉路由透传，2026-08-16）；你只需在自己的真机上装 APK 抽检一次（CI 产物或 `gradle assembleDebug`；电脑侧插件配置 `host: 0.0.0.0`，见 profile cordis.patch.yml）。iOS 需你本机有 Xcode 跑真机/模拟器（CI 已验证构建）。
5. [ ] **DashScope 热词 API 实测**：真实 key 验证官方「定制热词 HTTP API」端点/字段后回写（hotwords 包 dashscope 模式与 ADR-034 标注处）。

## Phase B 前（硬门槛）

6. [ ] 公司主体（大陆）+ ICP 备案。
7. [ ] 微信/支付宝商户号（订阅 3–5 元/月）。
8. [ ] 增值电信业务许可评估（中继/转发类，参照 ToDesk 资质）。
9. [ ] PIPL 合规：隐私政策、语音/图片单独同意、注销与删除权。
10. [ ] CLA 上线（社区贡献进闭源仓前，ADR-027）。
11. [ ] 试用月数定稿（暂定 2 个月，DESIGN §12-Q1）；吉祥物草图（非阻塞）。

## 发布动作（M2/M3）

12. [ ] 官方 DSH 插件商店上架；awesome 双列表 PR；开发者群/linux.do/V2EX 发布帖（用你的身份发）。
