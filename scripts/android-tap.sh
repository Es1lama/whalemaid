#!/bin/bash
# SPEC: docs/NEEDED-BY-OWNER 实机驱动助手：按可见文本定位控件并执行真实 input tap
# 用法: ./scripts/android-tap.sh "文本" [index]
set -e
ADB="adb"
TEXT="${1:?需要文本参数}"
IDX="${2:-0}"

"$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
"$ADB" pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1

python3 - "$TEXT" "$IDX" <<'EOF'
import re, subprocess, sys
xml = open('/tmp/ui.xml', encoding='utf-8', errors='ignore').read()
target, idx = sys.argv[1], int(sys.argv[2])
# 收集所有含目标文本的节点 bounds
nodes = re.findall(r'<node[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*?/?>', xml)
matches = []
for t, x1, y1, x2, y2 in nodes:
    if target in t:
        matches.append((t, (int(x1)+int(x2))//2, (int(y1)+int(y2))//2))
if not matches:
    print(f'NOMATCH:{target}')
    sys.exit(2)
t, x, y = matches[min(idx, len(matches)-1)]
print(f'TAP:{t}@{x},{y}')
subprocess.run(['adb', 'shell', 'input', 'tap', str(x), str(y)])
EOF
