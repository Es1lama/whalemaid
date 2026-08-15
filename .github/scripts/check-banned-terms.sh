#!/usr/bin/env bash
# D-030 清仓守卫（audit#8）：废止语义禁止回潮——Kotlin/SwiftUI/全自研/Tauri/现行 /api/v1/packages/control
# - 代码树（packages/ apps/）一律禁止（/api/v1 已全链清除，无任何豁免）；
# - *.md 允许带废止标记的历史记录行（含 废止|取代|删除|定案|禁止 之一），历史档案整档豁免。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PATTERN='Kotlin|SwiftUI|全自研|Tauri|/api/v1|packages/control|自建 listener|挑战应答|PROTO-010|SSE 事件流'
ALLOWLIST_DOCS='docs/OWNER-DIRECTIVES.md|docs/codex-audit.md|docs/research/spike-S0-S1.md'

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
    --include='*.ts' --include='*.tsx' --include='*.rs' \
    --include='*.md' --include='*.json' --include='*.yml' --include='*.yaml' \
    --include='pnpm-lock.yaml' --include='Dockerfile' \
    2>/dev/null \
    | grep -v node_modules | grep -v '/lib/' | grep -v '/target/' | grep -v '/dist/' \
    | grep -v '/vendor-dist/' \
    || true
)

if [ "$fail" -ne 0 ]; then
  echo "::error::废止语义回潮，见上方 BANNED 行（D-030/audit#8）。历史记录用'废止/取代/删除/定案'标记，代码一律禁止。"
fi
exit "$fail"
