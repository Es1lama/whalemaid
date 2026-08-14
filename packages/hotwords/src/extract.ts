// SPEC: docs/requirements.md#REQ-021 宿主本地专业词抽取（规则版，确定性、零 LLM 成本）
// 思路：从上一轮助手回复中抽取"专业术语"（代码标识符/缩写/中英混排词/反引号词），
// 与已上传词集做差集 → {add, remove}，只把词表交给服务端（ADR-010 零知识原则）。

const STOPWORDS = new Set(['API', 'HTTP', 'HTTPS', 'JSON', 'URL', 'OK', 'THE', 'AND', 'FOR', 'YOU', 'CAN', 'NOT', 'BUT', 'ALL', 'NEW', 'NOW', 'TODO'])

/** 反引号/引号内的显式术语（最高置信） */
function quotedTerms(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[`'"]{1}([A-Za-z0-9_./:+-]{2,40})[`'"]{1}/g)) out.push(m[1])
  return out
}

/** camelCase / PascalCase（至少两个词节） */
function caseTerms(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*\b|\b[A-Z][a-zA-Z0-9]*[a-z][a-zA-Z0-9]*\b/g)) out.push(m[0])
  return out
}

/** snake_case 或连字符标识符（至少两个词节） */
function snakeTerms(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]+(?:-[a-z0-9]+)+\b/g)) out.push(m[0])
  return out
}

/** 全大写缩写（2-8 字符，过滤停用词） */
function acronymTerms(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b[A-Z]{2,8}\b/g)) {
    if (!STOPWORDS.has(m[0])) out.push(m[0])
  }
  return out
}

/** 中英混排术语（如 热词API / ECDSA密钥） */
function mixedTerms(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/[\u4e00-\u9fff]{1,6}[A-Za-z][A-Za-z0-9]{1,24}|[A-Za-z][A-Za-z0-9]{1,24}[\u4e00-\u9fff]{1,6}/g)) out.push(m[0])
  return out
}

/** 主入口：抽取 + 频次/上限控制（出现 ≥2 次或反引号显式引用才保留，上限 30） */
export function extractKeywords(text: string, limit = 30): string[] {
  const count = new Map<string, number>()
  const bump = (t: string, weight = 1) => count.set(t, (count.get(t) ?? 0) + weight)
  for (const t of quotedTerms(text)) bump(t, 2)
  for (const t of caseTerms(text)) bump(t, 1)
  // 复合标识符（snake/连字符）与中英混排词本身就是强技术信号，等同显式引用
  for (const t of snakeTerms(text)) bump(t, 2)
  for (const t of acronymTerms(text)) bump(t, 1)
  for (const t of mixedTerms(text)) bump(t, 2)
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t)
}

/** 与上次词集做差集（ADR-010：只传增量） */
export function diffKeywords(prev: string[], next: string[]): { add: string[]; remove: string[] } {
  const p = new Set(prev)
  const n = new Set(next)
  return { add: next.filter((t) => !p.has(t)), remove: prev.filter((t) => !n.has(t)) }
}
