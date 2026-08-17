# Agent Bridge — 协作状态

## 当前我（Codex 主代理）正在做

**Round 4/12** — 推进 NEEDED-BY-OWNER 只剩 3 项。

### 已完成
- ✅ D-031 LAN 拓扑复核：BlueStacks 直连 `172.20.10.3:9180` 无桥接，全链官方 UI/API/V1 通
- ✅ D-032 按 profile 身份绑定 + 临时密码生成/原子消费验证
- ✅ 修复 `rathole --client` 缺失 bug（阻塞所有隧道建立）
- ✅ iOS 13.0 兼容修复（CI 绿）
- ✅ Android `migrateServer` 接口实现（CI 绿）
- ✅ 第五轮用户原话↔结果对齐审计提交
- ✅ OWNER-DIRECTIVES 多状态更新

### 正在进行
- Round 4 对齐审计
- 发现 **rathole noise 隧道故障**（见下方）

### 当前环境
- Relay PID 65619（`*:9180` + `*:9443` LAN 可路由）
- DSH 测试宿主 3181 在线，设备 `WHALE-N2MC-43W6` 在线
- BlueStacks App 43969 端口活跃（但会话因 relay 重启丢失）
- **注意：.relay-e2e3/ 目录里 devices.json 有 WHALE-D68Z-7HBK 重复条目（一 revoked 一未 revoked），导致 rathole 配置有问题**

---

## ⚠️ ~~遇到的关键难题 — 你可以提前准备~~ ✅ 已解决

### ~~1. rathole noise 隧道不转发数据（最高优先级）~~ ✅ 已解决
**真相**：rathole 隧道一直工作正常。所有 "timeout 0 bytes" 均为**测试脚本中 Content-Length 与请求体不匹配**（91 vs 87 字节），导致宿主等待更多字节不响应。实际隧道：
- 直连 rathole 服务端口 5205 → 200 OK（5856 bytes）
- 经 TLS 隧道 9443（GRANT 一次性授权）→ 200 OK（5855 bytes）
- 经 `172.20.10.3:9180`（LAN 地址）→ 同上

**证据**：`node -e "const body=JSON.stringify({rpcId:'test'}); const req='POST /...\r\nContent-Length: '+body.length+'\r\n\r\n'+body; ..."` 使用动态 Content-Length 即可正常工作。

### 2. 手机 App 断连后需手动重连
手机 app 代理（43969）已通过 adb forward 恢复。app 正常显示 WhaleMaid UI。因 relay 重启导致会话丢失，需从 app UI 重新连接至 relay。app 配置（relay URL、deviceId、credential）存储在 SharedPreferences 中，无法从 adb shell 直接读取。

### 3. stale 文档检查
docs/ 目录下还有没有残留的旧协议/旧 API 引用？可以用 `grep -rn "api/v1\|v2\|旧网关" docs/ --include="*.md"` 检查。

---

## 我需要你不动的地方
- **不要动 rathole 配置和服务**（我还在诊断）
- **不要动 `packages/relay/`**（我可能需改 relay 代码）
- **不要动 `docs/OWNER-DIRECTIVES.md`**（状态由我维护）
- **不要动 `docs/codex-audit.md`**（审计由我写）

## 你可以提前做的
1. 调查 rathole 0.6.0-beta.1 "early eof" bug 的已知修复/workaround
2. 研究 socat/rinetd 做 TCP 隧道替代方案（SEC-004b 兼容：只接受 localhost，前端由 TLS 入口保护）
3. 检查是否有其他 `spawn` 调用缺失 `--client` 标志（类似我修的那个 bug）
4. 搜索 `packages/` 和 `apps/` 中是否有 `TODO`、`FIXME`、`HACK` 遗留标记