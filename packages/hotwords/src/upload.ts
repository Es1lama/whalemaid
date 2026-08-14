// SPEC: docs/requirements.md#REQ-021 词表上传（只传词表，零知识 ADR-010）
// 两种模式：http（通用端点，Level 2 服务器/自建）与 dashscope（官方定制热词 API，BYOK）

export interface HotwordUploader {
  apply(diff: { add: string[]; remove: string[] }): Promise<void>
}

export type KeyResolver = (ref: string) => Promise<string | undefined>

/** 通用 HTTP：POST {add, remove} 到用户配置端点 */
function httpUploader(endpoint: string, resolveToken?: () => Promise<string | undefined>): HotwordUploader {
  return {
    async apply(diff) {
      const token = await resolveToken?.()
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(diff),
      })
      if (!res.ok) throw new Error(`热词端点失败: ${res.status} ${await res.text()}`)
    },
  }
}

/** DashScope 定制热词 API（官方词汇表增删改查；真实 key 实测见 NEEDED-BY-OWNER 第 1 项） */
function dashscopeUploader(resolveKey: KeyResolver, getVocabularyId: () => string | undefined, saveVocabularyId: (id: string) => void): HotwordUploader {
  return {
    async apply(_diff) {
      // TODO(REQ-021): 官方 vocabulary HTTP API 具体端点/字段待真实 key 实测后落地
      void resolveKey
      void getVocabularyId
      void saveVocabularyId
      throw new Error('dashscope 定制热词 API 待真实 key 实测（NEEDED-BY-OWNER）')
    },
  }
}

export interface HotwordUploaderConfig {
  mode: 'http' | 'dashscope'
  endpoint?: string
  credentialRef?: string
}

export function createUploader(
  cfg: HotwordUploaderConfig,
  resolveKey: KeyResolver,
  store: { getVocabularyId: () => string | undefined; saveVocabularyId: (id: string) => void },
): HotwordUploader {
  if (cfg.mode === 'http') {
    if (!cfg.endpoint) throw new Error('http 模式需要 endpoint')
    return httpUploader(cfg.endpoint, cfg.credentialRef ? () => resolveKey(cfg.credentialRef ?? '') : undefined)
  }
  return dashscopeUploader(resolveKey, store.getVocabularyId, store.saveVocabularyId)
}
