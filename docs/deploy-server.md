# 服务器部署（自托管中继，REQ-012）

> 唯一现行版。中继 = **rathole sidecar（noise 密文隧道，零知识）+ Rust 控制面**（设备注册/授权/心跳/吊销）。
> 信道安全（SEC-001/003，实测结论）：rathole 默认 transport 是 **TCP 明文**（其 config.rs `TransportType::default = Tcp`）——本中继**显式强制 noise**（`Noise_NK_25519_ChaChaPoly_BLAKE2s`）+ 服务端静态 X25519 密钥对（数据目录 `noise-key`，0600 持久化）+ 受控端 pin 服务端公钥（NK 模式防中间人）。双端实测见 scripts/rathole-noise-e2e.mjs。

## 一键部署（docker compose）

```sh
cd packages/relay
ADMIN_TOKEN='换成你的强随机密钥' ADMIN_INSTALL_CODE='换成你的一次性安装码' docker compose up -d --build
```

- 2333：rathole 隧道控制端口（受控端 sidecar 连这里，**noise 加密**）；
- 5202+：每设备一个转发端口（主控端经此端口进入隧道，见下"主控端接入"）；
- 9080：控制面管理 API（**仅 HTTPS**，自签证书 + 指纹固定）。生产环境建议防火墙限制 9080 与 5202+ 来源。

## 被控端（家里电脑）接入

被控插件配置（profile 的 cordis.patch.yml 覆盖 `whalemaid` 行）：

```yaml
- id: whalemaid
  config:
    relayUrl: 'https://<你的服务器>:9080'
    relayFingerprint: '<服务器启动日志打印的证书 SHA-256 指纹>'   # 必填：空 = 拒绝接入（SEC-001）
    relayInstallCode: '<与服务器 ADMIN_INSTALL_CODE 一致>'
    ratholeBin: 'rathole'  # 被控机需安装 rathole（brew install rathole 或 GitHub release）
```

插件启动后：固定指纹 HTTPS 注册设备（编号+密码哈希，SEC-002）→ 凭据签发 → `/tunnel` 取隧道 token **与服务器 noise 公钥** → 渲染 rathole 客户端配置（noise + pin 公钥，缺公钥即拒绝建隧道）→ 启动客户端 sidecar（连 2333）→ 每 20s 心跳。

## 主控端接入（编号+密码，无 IP）

1. 主控端 `POST /_whalemaid/connect`（设备编号+密码，限速 5/min、错 5 次锁 5 分钟）→ 返回 `{ deviceId, service, port }`（不含 token，不轮换；SEC-003）；
2. 主控端连 `<服务器>:<port>` 进入 rathole 隧道 → 受控端网关侧挑战应答绑定（密码只走 noise 密文，SEC-004）；
3. 设备在线状态：`GET /_whalemaid/devices/:id/status`（公开、限速，不回 IP/端口/token）。

## 运维

- 吊销：`DELETE /_whalemaid/devices/:id`（设备凭据或管理令牌），设备条目即时移除并热重载——该设备隧道立即失效（TM-005）；
- 在线状态：`GET /_whalemaid/devices`（管理令牌）返回 `online`（45s 心跳窗口）；
- 数据：`/data` 卷（devices.json 0600、rathole-server.toml 0600、noise-key 0600、relay-cert/key）；中继不存储任何会话内容（ADR-025）。

## 说明

- 控制面 API 是**开源**部分（AGPL-3.0）；账号/计费/Level 分层属私有仓 `whalemaid-console` 的控制管理系统，另文说明；
- rathole 许可 Apache-2.0，随镜像分发合法；
- 主控端→中继服务端口段当前为 rathole 原生明文 TCP（rathole 设计：加密发生在中继↔受控端之间）——该段的一体化 TLS/授权正在按 SEC-004 收尾（短时授权 + 中继侧 TLS 入口），完成前**不建议把 5202+ 端口直接暴露公网**。
