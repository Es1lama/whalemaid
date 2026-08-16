#!/usr/bin/env bash
# D-030 清仓守卫（audit#8 升级，2026-08-16）：废止语义禁止回潮——自研移动路线/自定协议/旧事件承载/旧安全模型。
# 语义断言覆盖（不只关键词黑名单）：
#   Kotlin/SwiftUI 自研 UI 路线（ADR-037/039 已废止）；Tauri；全自研移动端；
#   /api/v1 自定 RPC（ADR-041 全链清除）；packages/control（agent 对 agent 控制，已删）；
#   自建 listener/监听（audit#3 插件零监听）；挑战-应答/网关挑战应答（audit#3 删除的安全模型）；
#   SSE 事件流/事件承载（v3 协议唯一载体 = 官方 WebSocket）；PROTO-010（废止编号）。
# 规则：
# - 代码树（packages/ apps/ 的源码与生成物 lib/ dist/ vendor-dist/）一律禁止，无豁免；
# - *.md 允许带废止标记的历史记录行（含 废止|取代|删除|定案|禁止 之一）；
# - 历史档案整档豁免（目录级白名单）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PATTERN='Kotlin|SwiftUI|全自研|Tauri|/api/v1|packages/control|自建 listener|自建监听|挑战-应答|挑战应答|网关挑战|SSE 事件流|SSE 下联|SSE 通道|PROTO-010'
ALLOWLIST_DOCS='docs/OWNER-DIRECTIVES.md|docs/codex-audit.md|docs/research/spike-S0-S1.md|docs/AGENT-LESSONS.md'

fail=0

while IFS=: read -r file line text; do
  [ -z "$file" ] && continue
  if echo "$file" | grep -Eq "^($ALLOWLIST_DOCS)$"; then continue; fi
  if [[ "$file" == *.md ]]; then
    echo "$text" | grep -Eq '废止|取代|删除|定案|禁止' && continue
  fi
  echo "BANNED [$file:$line] $text"
  fail=1
done < <(
  grep -rInE "$PATTERN" packages apps docs \
    --include='*.ts' --include='*.tsx' --include='*.rs' --include='*.js' --include='*.cjs' --include='*.mjs' \
    --include='*.kt' --include='*.java' \
    --include='*.md' --include='*.json' --include='*.yml' --include='*.yaml' \
    --include='pnpm-lock.yaml' --include='Dockerfile' \
    2>/dev/null \
    | grep -v node_modules | grep -v '/target/' | grep -v '/build/' | grep -v '/\.gradle/' | grep -v '/vendor-dist/' \
    || true
)

if [ "$fail" -ne 0 ]; then
  echo "::error::废止语义回潮，见上方 BANNED 行（D-030/audit#8）。历史记录用'废止/取代/删除/定案'标记，代码与生成物一律禁止（lib/dist/vendor-dist 也扫描——若命中，重新构建生成物）。"
fi
exit "$fail"
