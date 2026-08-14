// SPEC: docs/requirements.md#REQ-021 抽取逻辑单测
import { describe, expect, it } from 'vitest'
import { diffKeywords, extractKeywords } from './extract.js'

const SAMPLE =
  '我们为 `session.create` 增加了 workspaceId 支持。\n' +
  'ds-host-apiproxy 的 RpcRequest 纪律要求 rpcId 回显。\n' +
  '热词API 与 ECDSA密钥 在 WebCrypto 中不可导出。\n' +
  '注意 RpcRequest 与 rpcId 的对应关系。'

describe('extractKeywords', () => {
  it('抽取代码标识符/缩写/中英混排/反引号词，且过滤低频', () => {
    const kws = extractKeywords(SAMPLE)
    expect(kws).toContain('session.create')
    expect(kws).toContain('RpcRequest')
    expect(kws).toContain('ds-host-apiproxy')
    expect(kws).toContain('ECDSA密钥')
    expect(kws).toContain('热词API')
    expect(kws.length).toBeLessThanOrEqual(30)
  })

  it('不输出未重复的停用词与单词', () => {
    const kws = extractKeywords('API HTTP OK single word')
    expect(kws).not.toContain('API')
    expect(kws).not.toContain('word')
  })
})

describe('diffKeywords', () => {
  it('只传增量', () => {
    const { add, remove } = diffKeywords(['a', 'b'], ['b', 'c'])
    expect(add).toEqual(['c'])
    expect(remove).toEqual(['a'])
  })
})
