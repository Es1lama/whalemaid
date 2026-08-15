// SPEC: docs/PREFLIGHT.md（选项 B：插件自建 listener）
// SPEC: docs/protocol.md#PROTO-001 承载
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** 监听地址。默认 loopback；直连模式（REQ-001）用户改为 0.0.0.0 */
  host: string
  /** 监听端口，默认 3180（与 DSH GUI 3080 隔离） */
  port: number
  /** 数据目录：设备名单/token/审计。默认随 DSH_HOME/whalemaid */
  dataDir: string
  /** BYOK 语音厂商（'' = 未启用）；key 经 dsh-credentials 引用（ADR-013） */
  voiceProvider: string
  voiceCredentialRef: string
  voiceModel: string
  /** BYOK 视觉厂商（'' = 未启用） */
  visionProvider: string
  visionCredentialRef: string
  visionModel: string
  /** 中继接入（'' = 未启用，见 docs/deploy-server.md） */
  relayUrl: string
  /** SEC-001：服务端一次性安装码（受控端注册用） */
  relayInstallCode: string
  ratholeBin: string
  relayPort: number
  /** SEC-005：允许非回环明文监听（默认拒绝；直连必须走中继或后续 TLS） */
  allowPlainLan: boolean
}

export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default('127.0.0.1'),
  port: Schema.number().default(3180),
  dataDir: Schema.string().default(''),
  voiceProvider: Schema.string().default(''),
  voiceCredentialRef: Schema.string().default(''),
  voiceModel: Schema.string().default(''),
  visionProvider: Schema.string().default(''),
  visionCredentialRef: Schema.string().default(''),
  visionModel: Schema.string().default(''),
  relayUrl: Schema.string().default(''),
  relayInstallCode: Schema.string().default(''),
  ratholeBin: Schema.string().default('rathole'),
  relayPort: Schema.number().default(2333),
  allowPlainLan: Schema.boolean().default(false),
})
