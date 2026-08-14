// SPEC: docs/adr/INDEX.md#ADR-010 热词附加插件入口：不默认安装，安装后每轮结束宿主本地抽取并上传词表
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { extractKeywords, diffKeywords } from './extract.js'
import { HotwordStore } from './store.js'
import { createUploader, type HotwordUploaderConfig } from './upload.js'

export const name = 'whalemaid-hotwords'

export const inject = ['apiProxy', 'credentials']

export interface Config {
  /** 上传模式：http（Level 2/自建端点）| dashscope（BYOK 官方热词 API） */
  mode: 'http' | 'dashscope'
  endpoint: string
  credentialRef: string
  /** 每次上传的词数上限 */
  limit: number
}

export const Config: Schema<Config> = Schema.object({
  mode: Schema.union(['http', 'dashscope']).default('http'),
  endpoint: Schema.string().default(''),
  credentialRef: Schema.string().default(''),
  limit: Schema.number().default(30),
})

export function apply(ctx: Context, config?: Config): void {
  const cfg: Config = { mode: 'http', endpoint: '', credentialRef: '', limit: 30, ...config }
  const store = new HotwordStore()
  const apiProxy = (ctx as unknown as {
    apiProxy: { sessions: { history(r: { rpcId: string; payload: { sessionId: string; maxMessages: number } }): Promise<{ result: { ok: boolean; value?: unknown } }> } }
  }).apiProxy
  const credentials = (ctx as unknown as {
    credentials: { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
  }).credentials

  const resolveKey = async (ref: string) => (ref ? (await credentials.resolve(credentialRef(ref)))?.value : undefined)
  const uploader = createUploader(
    { mode: cfg.mode, endpoint: cfg.endpoint || undefined, credentialRef: cfg.credentialRef || undefined } satisfies HotwordUploaderConfig,
    resolveKey,
    { getVocabularyId: () => store.vocabularyId, saveVocabularyId: (id) => store.save(store.words, id) },
  )

  /** 每轮结束：读最近一条助手消息 → 抽取 → 差集 → 只上传词表 */
  const onTurnEnd = async (sessionId: unknown): Promise<void> => {
    try {
      const r = await apiProxy.sessions.history({ rpcId: 'hotwords', payload: { sessionId: String(sessionId), maxMessages: 2 } })
      if (!r.result.ok) return
      const events = (r.result.value as { events?: unknown[] })?.events ?? []
      const last = [...events].reverse().find((e) => (e as { role?: string })?.role === 'assistant')
      if (!last) return
      // 与主插件同源的文本提取（尽力而为；精确类型对齐见 HistoryEntry TODO）
      const text = JSON.stringify(last).slice(0, 8000)
      const next = extractKeywords(text, cfg.limit)
      const diff = diffKeywords(store.words, next)
      if (diff.add.length === 0 && diff.remove.length === 0) return
      await uploader.apply(diff)
      store.save(next, store.vocabularyId)
      ctx.logger.info(`[whalemaid-hotwords] 词表更新 +${diff.add.length} -${diff.remove.length}`)
    } catch (err) {
      ctx.logger.warn(`[whalemaid-hotwords] ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const bridge = (ctx as unknown as { on: (name: string, cb: (...args: unknown[]) => void) => unknown })
  try {
    bridge.on('host/session-status', (sessionId: unknown, status?: unknown) => {
      const s = typeof status === 'object' && status !== null ? (status as { running?: boolean }) : undefined
      if (s?.running === false) void onTurnEnd(sessionId)
    })
  } catch {
    ctx.logger.warn('[whalemaid-hotwords] 无法订阅会话事件（事件名未转发）')
  }
}
