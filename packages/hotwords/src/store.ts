// SPEC: docs/requirements.md#REQ-021 词集持久化（上次上传的词表 + dashscope vocabularyId 缓存）
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface HotwordState {
  words: string[]
  vocabularyId?: string
}

export class HotwordStore {
  private file: string
  private state: HotwordState

  constructor(dataDir?: string) {
    const base = dataDir || join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'whalemaid-hotwords')
    this.file = join(base, 'state.json')
    mkdirSync(base, { recursive: true })
    this.state = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as HotwordState) : { words: [] }
  }

  get words(): string[] {
    return this.state.words
  }

  get vocabularyId(): string | undefined {
    return this.state.vocabularyId
  }

  save(words: string[], vocabularyId?: string): void {
    this.state = { words, ...(vocabularyId ? { vocabularyId } : {}) }
    writeFileSync(this.file, JSON.stringify(this.state, null, 2), { mode: 0o600 })
  }
}
