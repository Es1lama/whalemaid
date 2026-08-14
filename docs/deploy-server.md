# 服务器部署（自托管中继，REQ-012）

> 唯一现行版。中继 = rathole sidecar（密文转发，零知识）+ Rust 控制面（设备注册/授权/心跳/吊销）。

## 一键部署（docker compose）

```sh
cd packages/relay
ADMIN_TOKEN='换成你的强随机密钥' docker compose up -d --build
```

- 2333：设备隧道端口（手机与被控端都连它）；
- 9080：控制面管理 API（Bearer ADMIN_TOKEN 鉴权；`/health` 公开）。生产环境建议防火墙限制 9080 来源。

## 被控端（家里电脑）接入

被控插件配置（profile 的 cordis.patch.yml 覆盖 `whalemaid` 行）：

```yaml
- id: whalemaid
  config:
    host: 0.0.0.0          # 本机直连场景；中继场景可保持 127.0.0.1
    relayUrl: 'https://<你的服务器>:9080'
    relayToken: '<与服务器 ADMIN_TOKEN 一致>'
    ratholeBin: 'rathole'  # 被控机需安装 rathole v0.5.0（brew install rathole 或 GitHub release）
```

插件启动后：向控制面注册设备 → 本地生成 rathole 客户端配置 → 启动客户端 sidecar（连服务器的 2333）→ 每 20s 心跳。

## 手机端连接

- 直连：`http://<被控机IP>:3180/m`（本插件自服务）；
- 中继：`http://<你的服务器>:<控制面分配的端口>/m`（端口 = 注册响应里的 `port`）。

## 运维

- 吊销：`DELETE /devices/:id`（Bearer ADMIN_TOKEN），设备条目即时移除并热重载——该设备隧道立即失效（TM-005）；
- 在线状态：`GET /devices` 返回 `online`（45s 心跳窗口）；
- 数据：`/data` 卷（devices.json 0600、rathole-server.toml）；中继不存储任何会话内容（ADR-025）。

## 说明

- 控制面 API 是**开源**部分（AGPL-3.0）；账号/计费/Level 分层属私有仓 `whalemaid-console` 的控制管理系统，另文说明；
- rathole 许可 Apache-2.0，随镜像分发合法。
