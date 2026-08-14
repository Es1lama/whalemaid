// SPEC: docs/PREFLIGHT.md（选项 B：插件自建 listener）
// SPEC: docs/protocol.md#PROTO-001 承载
import { Schema } from '@deepseek-ai/schemastery'

export interface Config {
  /** 监听地址。默认 loopback；直连模式（REQ-001）用户改为 0.0.0.0 */
  host: string
  /** 监听端口，默认 3180（与 DSH GUI 3080 隔离） */
  port: number
  /** 数据目录：设备名单/token/审计。默认 ~/.dsh/whalemaid */
  dataDir: string
}

export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default('127.0.0.1'),
  port: Schema.number().default(3180),
  dataDir: Schema.string().default(''),
})
