# 服务器部署（自托管中继，REQ-012）

> 唯一现行版。中继 = **rathole sidecar（noise 密文隧道，零知识）+ Rust 控制面**（设备注册/授权/心跳/吊销）。
> 信道安全（SEC-001/003，实测结论）：rathole 默认 transport 是 **TCP 明文**（其 config.rs `TransportType::default = Tcp`）——本中继**显式强制 noise**（`Noise_NK_25519_ChaChaPoly_BLAKE2s`）+ 服务端静态 X25519 密钥对（数据目录 `noise-key`，0600 持久化）+ 受控端 pin 服务端公钥（NK 模式防中间人）。双端实测见 scripts/rathole-noise-e2e.mjs。

## 一键部署（docker compose）

```sh
cd packages/relay
ADMIN_TOKEN='换成你的强随机密钥' ADMIN_INSTALL_CODE='换成你的首启种子' docker compose up -d --build
```

- `ADMIN_INSTALL_CODE`：仅作**首启种子**（默认单次可消费安装令牌，SEC-001 审计三轮#4 修订）。日常签发新令牌（明文仅返回一次）：
  ```sh
  curl -sk -X POST https://<服务器>:9080/_whalemaid/admin/install-tokens \
    -H "authorization: Bearer <ADMIN_TOKEN>" -H 'content-type: application/json' \
    -d '{"maxUses":1,"ttlSec":86400}'
  # → {"token":"<一次性明文>",...}；清单: GET /_whalemaid/admin/install-tokens
  ```
  每个受控端设备配一枚令牌（注册成功即消耗；令牌耗尽/过期/未知 → 401）。

- 2333：rathole 隧道控制端口（受控端 sidecar 连这里，**noise 加密**）；
- 5202+：每设备一个转发端口（**只绑 127.0.0.1**，不对外，SEC-004b）；
- 9080：控制面管理 API（**仅 HTTPS**，自签证书 + 指纹固定）；
- 9443：主控端隧道入口（**仅 TLS**，一次性 grant 校验后转发到受控端隧道；SEC-004b）。公网部署只需暴露 9080/9443。
- 环境开关：`WHALEMAID_RELAY_TRUSTED_PROXY=1`（仅在可信反代后启用 X-Forwarded-For 限速键；默认 socket peer IP）；`WHALEMAID_RELAY_MAX_DEVICES=<n>`（设备配额，enrollment secret 泄露时限制注册规模）；`WHALEMAID_RELAY_TUNNEL_LISTEN`（隧道入口监听，公网部署设 `0.0.0.0:9443`）。

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

1. 主控端首次 `POST /_whalemaid/connect` 使用设备编号+密码（失败限速 5/min、错 5 次锁 5 分钟）→ 返回 `{ deviceId, service, sessionToken, sessionTtlSec, grant, grantTtlSec, tunnelPort }`；`sessionToken` 为 15 分钟、绑定客户端 IP+设备的快速认证令牌，主控端只在进程内保存，后续逐请求以 `{ deviceId, sessionToken }` 换新 grant（响应**不含设备服务端口**，不轮换 rathole token；SEC-002/003/004b）；
2. 主控端 TLS 连接 `<服务器>:<tunnelPort>`，首行发 `GRANT <grant> <deviceId>`（2 分钟内单次消费）→ 中继校验后转发进 rathole noise 隧道 → 受控端宿主原生 web（官方 /api+WS+UI，密码只走密文，SEC-004）；浏览器/WebView 用 WSS 入口 `/_whalemaid/tunnel-ws`；
3. 设备在线状态：`GET /_whalemaid/devices/:id/status`（公开、限速，不回 IP/端口/token）。

## 运维

- 吊销：`DELETE /_whalemaid/devices/:id`（设备凭据或管理令牌），设备条目即时移除并热重载——该设备隧道立即失效（TM-005）；
- 在线状态：`GET /_whalemaid/devices`（管理令牌）返回 `online`（45s 心跳窗口）；
- 数据：`/data` 卷（devices.json 0600、rathole-server.toml 0600、noise-key 0600、relay-cert/key）；中继不存储任何会话内容（ADR-025）。

## 说明

- 控制面 API 是**开源**部分（AGPL-3.0）；账号/计费/Level 分层属私有仓 `whalemaid-console` 的控制管理系统，另文说明；
- rathole 许可 Apache-2.0，随镜像分发合法；
- 全链无明文段（SEC-004b 已闭合）：主控端→中继 = TLS（同 API 证书体系）+ 一次性 grant；中继→受控端 = rathole noise（静态密钥 + pin 公钥）；受控端内部 = 宿主原生 web（127.0.0.1 默认姿态 + 官方信任栅栏）。实测脚本 scripts/rathole-noise-e2e.mjs。
