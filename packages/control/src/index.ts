// SPEC: docs/PRODUCT_DESIGN.md（修订） 控制端插件：让任意一台 DSH 的 agent 控制另一台主机的 whalemaid 网关
// PC1↔PC2 互为控制端/被控端；手机只是不能跑 DSH 的薄客户端（同一协议）
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// 类型合并：ctx.tools 服务声明
import '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { WhaleNodeClient } from './client.js'

export const name = 'whalemaid-control'

export const inject = ['tools']

export interface Config {
  /** 默认被控端地址（agent 可临时指定） */
  base: string
  deviceId: string
  password: string
}

export const Config: Schema<Config> = Schema.object({
  base: Schema.string().default(''),
  deviceId: Schema.string().default(''),
  password: Schema.string().default(''),
})

function j(required: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties: Object.fromEntries(required.map((k) => [k, { type: 'string' }])),
    required,
    additionalProperties: false,
    ...extra,
  }
}

const textOut = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render: (_args: unknown, value: { text: string }) => [{ type: 'text' as const, text: value.text }],
} as unknown as ToolDefinition['output']

/** 工具定义：全部走 whalemaid 协议（docs/protocol.md），对 agent 呈现为远程控制原语 */
const TOOLS = [
  {
    name: 'whalemaid_connect',
    description: '连接一台运行 whalemaid 插件的电脑（base/deviceId/password 缺省用配置）。返回能力位。',
    params: j(['base', 'deviceId', 'password']),
  },
  {
    name: 'whalemaid_session_list',
    description: '列出被控端电脑上 DSH 的原生会话',
    params: j([]),
  },
  {
    name: 'whalemaid_session_create',
    description: '在被控端新建一个 DSH 原生会话（可指定 workspaceId）',
    params: j(['workspaceId']),
  },
  {
    name: 'whalemaid_prompt',
    description: '向被控端的原生会话布置任务（真实运行在对方电脑上）',
    params: j(['sessionId', 'text']),
  },
  {
    name: 'whalemaid_history',
    description: '读取被控端会话的对话与轨迹（事件历史）',
    params: j(['sessionId']),
  },
  {
    name: 'whalemaid_stop',
    description: '停止被控端正在运行的任务',
    params: j(['sessionId']),
  },
  {
    name: 'whalemaid_pending_approvals',
    description: '查询被控端待审批的权限请求（含可回应的 rpcId/approvalId）',
    params: j(['sessionId']),
  },
  {
    name: 'whalemaid_approval_respond',
    description: '回应被控端的权限审批（outcome: allowed-once | rejected）',
    params: j(['sessionId', 'rpcId', 'approvalId', 'outcome']),
  },
  {
    name: 'whalemaid_workspace_list',
    description: '列出被控端的工作区',
    params: j([]),
  },
  {
    name: 'whalemaid_workspace_create',
    description: '在被控端选择目录创建工作区（远程目录浏览）',
    params: j(['path']),
  },
  {
    name: 'whalemaid_list_directory',
    description: '浏览被控端主机目录',
    params: j(['path']),
  },
  {
    name: 'whalemaid_permission_set',
    description: '调整被控端会话的权限预设（/permission 语义）',
    params: j(['sessionId', 'value']),
  },
]

export function apply(ctx: Context, config?: Config): void {
  const cfg = { base: '', deviceId: '', password: '', ...config }
  const client = new WhaleNodeClient(cfg.base)

  for (const t of TOOLS) {
    ctx.tools.register({
      name: t.name,
      description: t.description,
      parameters: t.params,
      output: textOut,
      timeoutMs: 60_000,
      execute: async (args: unknown) => {
        const a = (args ?? {}) as Record<string, string>
        try {
          const text = await client.callTool(t.name.replace(/^whalemaid_/, ''), a, cfg)
          return { text }
        } catch (e) {
          return { text: `whalemaid 远程控制失败: ${e instanceof Error ? e.message : String(e)}` }
        }
      },
    })
  }
}
