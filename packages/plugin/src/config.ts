// SPEC: docs/deploy-server.md 被控端插件配置：中继接入（授权在中继侧；插件不再自建任何 listener，隧道直指宿主原生 web 端口）
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** 数据目录：设备编号/长期密码/中继凭据。默认随 DSH_HOME/whalemaid */
  dataDir: string
  /** 中继接入（'' = 未启用，见 docs/deploy-server.md） */
  relayUrl: string
  /** SEC-001：服务端一次性安装码（受控端注册用） */
  relayInstallCode: string
  /** SEC-001：服务端 TLS 证书 SHA-256 指纹（固定，SSH 式 TOFU；relay 启动日志打印；空 = 拒绝接入） */
  relayFingerprint: string
  ratholeBin: string
  /** 中继 rathole 控制端口（默认 2333） */
  relayPort: number
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(''),
  relayUrl: Schema.string().default(''),
  relayInstallCode: Schema.string().default(''),
  relayFingerprint: Schema.string().default(''),
  ratholeBin: Schema.string().default('rathole'),
  relayPort: Schema.number().default(2333),
})
